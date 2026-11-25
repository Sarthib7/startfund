import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { sources, type Source } from "./sources";
import { rank, shortlist, type Opportunity, type Profile, type Radar } from "./domain";
import { factSources, rights, type Fact, type FactSource } from "./facts";
import { reader, type Snapshot } from "./transport";

let database: DatabaseSync | undefined;
function db() {
  if (!database) {
    const configured=process.env.RADAR_DB_PATH;
    const path = configured===":memory:" ? configured : resolve(/*turbopackIgnore: true*/ configured || ".radar/startfund.sqlite");
    if (path!==":memory:") mkdirSync(dirname(path),{recursive:true});
    database = new DatabaseSync(path);
    database.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=4000; CREATE TABLE IF NOT EXISTS sources (name TEXT PRIMARY KEY, scanned TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, data TEXT NOT NULL, digest TEXT, sent TEXT, updated TEXT NOT NULL);");
    database.exec(`
      CREATE TABLE IF NOT EXISTS raw_snapshots (id INTEGER PRIMARY KEY, source TEXT NOT NULL, url TEXT NOT NULL, fetched TEXT NOT NULL, rights TEXT NOT NULL, body TEXT NOT NULL, etag TEXT, modified TEXT);
      CREATE INDEX IF NOT EXISTS raw_lookup ON raw_snapshots(source,url,id DESC);
      CREATE TABLE IF NOT EXISTS investors (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS programs (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS opportunities (id TEXT PRIMARY KEY, source TEXT NOT NULL, program_id TEXT, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, source TEXT NOT NULL, entity_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS signals (id TEXT PRIMARY KEY, source TEXT NOT NULL, observed TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS fact_runs (source TEXT PRIMARY KEY, scanned TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS digest_subscriptions (profile_id TEXT PRIMARY KEY, email TEXT NOT NULL,
        confirmation TEXT NOT NULL, expires INTEGER NOT NULL, confirmed INTEGER, unsubscribe TEXT NOT NULL, sent TEXT);
    `);
  }
  return database;
}
const ttl = 20*60*1000;
const inFlight = new Map<Source,Promise<{items: Opportunity[]; warning?: string}>>();
function auditedRead(name:Source|FactSource,at:string){
  const store=db(), terms=rights[name];
  return reader({contact:process.env.RADAR_SOURCE_CONTACT,
    lookUp(url){return store.prepare("SELECT url,body,etag,modified FROM raw_snapshots WHERE source=? AND url=? ORDER BY id DESC LIMIT 1").get(name,url) as Snapshot|undefined;},
    capture(s){
      store.prepare("INSERT INTO raw_snapshots (source,url,fetched,rights,body,etag,modified) VALUES (?,?,?,?,?,?,?)").run(name,s.url,at,terms,s.body,s.etag,s.modified);
      store.prepare("DELETE FROM raw_snapshots WHERE source=? AND fetched<?").run(name,new Date(Date.parse(at)-14*86400000).toISOString());
    },
  });
}
export async function sourceRows(name: Source) {
  const running = inFlight.get(name);
  if (running) return running;
  const task = (async () => {
    const store = db();
    const previous = store.prepare("SELECT scanned,data FROM sources WHERE name = ?").get(name) as {scanned:string;data:string}|undefined;
    const stored: Opportunity[] = previous ? JSON.parse(previous.data) : [];
    if (previous && Date.now()-Date.parse(previous.scanned) < ttl) return {items: stored};
    const at = new Date().toISOString();
    try {
      const items = await sources[name](at,auditedRead(name,at));
      store.exec("BEGIN IMMEDIATE");
      try {
        store.prepare("DELETE FROM opportunities WHERE source=?").run(name);
        for(const item of items){
          if(item.programId) store.prepare("INSERT INTO programs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name").run(item.programId,item.title);
          store.prepare("INSERT INTO opportunities VALUES (?,?,?,?)").run(item.id,name,item.programId??null,JSON.stringify(item));
          const before=stored.find(x=>x.id===item.id);
          const change=item.signal ? "Source signal" : before && before.deadline!==item.deadline ? "Deadline changed" : !before && previous ? "Newly observed" : null;
          if(change){
            const id=item.signal ? item.id : `${item.id}-${at}`;
            store.prepare("INSERT OR IGNORE INTO signals VALUES (?,?,?,?)").run(id,name,at,JSON.stringify({id,title:item.title,kind:change,source:name,url:item.url,observed:at,rights:rights[name]}));
          }
        }
        store.prepare("INSERT INTO sources VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET scanned=excluded.scanned,data=excluded.data").run(name,at,JSON.stringify(items));
        store.exec("COMMIT");
      }catch(e){store.exec("ROLLBACK");throw e;}
      return {items};
    } catch {
      return {items:stored, warning: `${name}: ${previous ? "showing cached listings" : "temporarily unavailable"}`};
    }
  })();
  inFlight.set(name,task);
  try { return await task; } finally { inFlight.delete(name); }
}
const ongoing=new Map<FactSource,Promise<string|undefined>>();
export function refreshFacts(name:FactSource):Promise<string|undefined>{
  const existing=ongoing.get(name);if(existing)return existing;
  const task=(async()=>{
    if(name==="SEC EDGAR" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.RADAR_SOURCE_CONTACT??"")) return "SEC EDGAR: set a crawler contact email to enable";
    const store=db();
    const last=store.prepare("SELECT scanned FROM fact_runs WHERE source=?").get(name)?.scanned;
    if(typeof last==="string"&&Date.now()-Date.parse(last)<86400000)return;
    const at=new Date().toISOString();
    try{
      const rows=await factSources[name](auditedRead(name,at),at);
      store.exec("BEGIN IMMEDIATE");
      try{
        for(const f of rows){
          const table=f.entityType==="Investor" ? "investors" : "programs";
          store.prepare(`INSERT INTO ${table} VALUES (?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name`).run(f.entityId,f.entity);
          store.prepare("INSERT INTO evidence VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(f.id,name,f.entityId,JSON.stringify(f));
          if(f.kind==="Regulatory filing"){
            store.prepare("INSERT OR IGNORE INTO signals VALUES (?,?,?,?)").run(f.id,name,at,JSON.stringify({id:f.id,title:f.entity,kind:f.title,source:name,url:f.url,observed:f.observed??at,rights:f.rights}));
          }
        }
        store.prepare("INSERT INTO fact_runs VALUES (?,?) ON CONFLICT(source) DO UPDATE SET scanned=excluded.scanned").run(name,at);
        store.exec("COMMIT");
      }catch(e){store.exec("ROLLBACK");throw e;}
      return;
    }catch{return `${name}: ${last?"showing cached evidence":"temporarily unavailable"}`;}
  })().finally(()=>ongoing.delete(name));
  ongoing.set(name,task);return task;
}
type Signal={id:string;title:string;kind:string;source:string;url:string;observed:string;rights:string};
export async function catalog(query:{q?:string; source?:string; limit?:number}={}){
  const [opportunities,factWarnings]=await Promise.all([
    Promise.all((Object.keys(sources) as Source[]).filter(n=>!query.source||n===query.source).map(sourceRows)),
    Promise.all((Object.keys(factSources) as FactSource[]).filter(n=>!query.source||n===query.source).map(refreshFacts)),
  ]);
  const store=db(), term=query.q?.toLowerCase().trim()??"", limit=query.limit??24;
  const isMatch=(s:string)=>s.toLowerCase().includes(term);
  const filter=(s:string)=>!query.source||query.source===s;
  const warnings=[...opportunities.flatMap(x=>x.warning?[x.warning]:[]),...factWarnings.filter(s=>typeof s==="string")];
  return {
    opportunities:opportunities.flatMap(x=>x.items).filter(x=>!x.signal && (!x.deadline||x.deadline>=new Date().toISOString().slice(0,10)) && isMatch(x.title+" "+(x.eligibility??""))).slice(0,limit),
    evidence:store.prepare("SELECT data FROM evidence ORDER BY rowid DESC").all().map(row=>JSON.parse(String(row.data)) as Fact).filter(x=>filter(x.source)&&isMatch(x.entity+" "+x.title)).sort((a,b)=>(b.observed??"").localeCompare(a.observed??"")).slice(0,limit),
    signals:store.prepare("SELECT data FROM signals ORDER BY observed DESC LIMIT 250").all().map(row=>JSON.parse(String(row.data)) as Signal).filter(x=>filter(x.source)&&isMatch(x.title)).slice(0,limit),
    warnings,
  };
}
export async function radar(p: Profile):Promise<Radar>{
  const outputs=await Promise.all((Object.keys(sources) as Source[]).map(sourceRows));
  return {matches:shortlist(rank(outputs.flatMap(o=>o.items),p)),warnings:outputs.flatMap(o=>o.warning?[o.warning]:[]),scannedAt:new Date().toISOString()};
}
export function saved(id:string){
  const row=db().prepare("SELECT data,digest FROM profiles WHERE id=?").get(id) as {data:string;digest:string|null}|undefined;
  return row ? {profile:JSON.parse(row.data) as Profile,digest:row.digest ? JSON.parse(row.digest) as Radar : null} : null;
}
export function save(id:string,p:Profile,digest:Radar){
  db().prepare("INSERT INTO profiles (id,data,digest,updated) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,digest=excluded.digest,updated=excluded.updated").run(id,JSON.stringify(p),JSON.stringify(digest),new Date(Date.now()).toISOString());
}
const tokenHash=(token:string)=>createHash("sha256").update(token).digest("hex");
export function digestSubscription(id:string) {
  const row=db().prepare("SELECT confirmed,expires FROM digest_subscriptions WHERE profile_id=?").get(id);
  return row?.confirmed ? "subscribed" : row && Number(row.expires)>Date.now() ? "pending" : "off";
}
export function requestSubscription(id:string,email:string,token:string,unsubscribe:string) {
  return db().prepare(`INSERT INTO digest_subscriptions (profile_id,email,confirmation,expires,unsubscribe)
    VALUES (?,?,?,?,?) ON CONFLICT(profile_id) DO UPDATE SET email=excluded.email,confirmation=excluded.confirmation,
    expires=excluded.expires,unsubscribe=excluded.unsubscribe,confirmed=NULL,sent=NULL
    WHERE digest_subscriptions.confirmed IS NULL AND digest_subscriptions.expires <= ?`)
    .run(id,email,tokenHash(token),Date.now()+86400000,unsubscribe,Date.now()).changes>0;
}
export function confirmSubscription(token:string) {
  return db().prepare("UPDATE digest_subscriptions SET confirmed=? WHERE confirmation=? AND expires>? AND confirmed IS NULL")
    .run(Date.now(),tokenHash(token),Date.now()).changes>0;
}
export function removeSubscription(id:string) {
  db().prepare("DELETE FROM digest_subscriptions WHERE profile_id=?").run(id);
}
export function unsubscribeDigest(token:string) {
  return db().prepare("DELETE FROM digest_subscriptions WHERE unsubscribe=?").run(token).changes>0;
}
export function subscriptions(){
  return db().prepare(`SELECT p.id,p.data,p.updated,s.sent,s.email,s.unsubscribe FROM profiles p JOIN digest_subscriptions s
    ON p.id=s.profile_id WHERE s.confirmed IS NOT NULL`).all()
    .map(row=>({id:String(row.id),profile:JSON.parse(String(row.data)) as Profile,sent:row.sent ? String(row.sent) : null,
      email:String(row.email),unsubscribe:String(row.unsubscribe),version:String(row.updated)}));
}
export function updateDigest(id:string,digest:Radar,version:string){
  return db().prepare("UPDATE profiles SET digest=? WHERE id=? AND updated=?").run(JSON.stringify(digest),id,version).changes>0;
}
export function canDeliverDigest(id:string,unsubscribe:string){
  return Boolean(db().prepare("SELECT 1 FROM digest_subscriptions WHERE profile_id=? AND unsubscribe=? AND confirmed IS NOT NULL").get(id,unsubscribe));
}
export function markSent(id:string,week:string){
  db().prepare("UPDATE digest_subscriptions SET sent=? WHERE profile_id=?").run(week,id);
}
