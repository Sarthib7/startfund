import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { enrichUs, searchEu, searchTed, searchUs, sources, type Source } from "./sources";
import { byListingStatus, catalogMatch, euCountryCodes, listingStatus, profileLocations, profileQueries, relevantEvidence, rank, shortlist, type Opportunity, type Profile, type Radar } from "./domain";
import { factSources, rights, searchCordis, searchNsf, searchUkri, type Fact, type FactSource } from "./facts";
import { reader, type Snapshot } from "./transport";
import { perkScore } from "./programs";

let database: DatabaseSync | undefined;
function db() {
  if (!database) {
    const configured=process.env.RADAR_DB_PATH;
    const path = configured===":memory:" ? configured : resolve(/*turbopackIgnore: true*/ configured || ".radar/startfund.sqlite");
    if (path!==":memory:") mkdirSync(dirname(path),{recursive:true});
    database = new DatabaseSync(path);
    database.function("catalog_match",(q,text)=>Number(catalogMatch(String(q),String(text))));
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
    const current = name==="Hacker News" ? stored.every(o=>o.kind==="Market signal") :
      name==="EU Funding & Tenders" || name==="Grants.gov" ? stored.every(o=>o.status) :
      name==="Accelerator directory" ? stored.every(o=>o.kind!=="Growth") : true;
    if (previous && current && Date.now()-Date.parse(previous.scanned) < ttl) return {items: stored};
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
          const change=item.signal ? "Market signal" : before && before.deadline!==item.deadline ? "Deadline changed" : !before && previous ? "Newly observed" : null;
          if(change){
            const id=item.signal ? item.id : `${item.id}-${at}`;
            store.prepare("INSERT INTO signals VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET observed=excluded.observed,data=excluded.data")
              .run(id,name,item.postedAt??at,JSON.stringify({id,title:item.title,kind:change,source:name,url:item.url,observed:item.postedAt??at,postedAt:item.postedAt,fetchedAt:at,rights:rights[name]}));
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
type Signal={id:string;title:string;kind:string;source:string;url:string;observed:string;rights:string;postedAt?:string;fetchedAt?:string};
type QueryResult<T>={items:T[];warning?:string};
const topicalCache=new Map<string,{until:number;result:Promise<QueryResult<unknown>>}>();
const activeQueries=new Map<string,Promise<QueryResult<unknown>>>();
function topicalRows<T>(name:Source|FactSource,key:string,load:(read:ReturnType<typeof auditedRead>,at:string)=>Promise<T[]>):Promise<QueryResult<T>> {
  const id=JSON.stringify([name,key]),cached=topicalCache.get(id),running=activeQueries.get(id);
  if(running) return running as Promise<QueryResult<T>>;
  if(cached&&cached.until>Date.now()) return cached.result as Promise<QueryResult<T>>;
  if(activeQueries.size>=36) return Promise.resolve({items:[],warning:`${name}: topical search busy`});
  const at=new Date().toISOString();
  const result=load(auditedRead(name,at),at).then(items=>({items})).catch(()=>({items:[],warning:`${name}: topical search unavailable`}));
  activeQueries.set(id,result);
  void result.then(value=>{
    activeQueries.delete(id);
    topicalCache.delete(id);
    if(topicalCache.size>=128) topicalCache.delete(topicalCache.keys().next().value!);
    topicalCache.set(id,{until:Date.now()+(("warning" in value) ? 60_000 : ttl),result});
  });
  return result;
}
function mergeOpportunities(rows:Opportunity[]) {
  const byId=new Map<string,Opportunity>();
  for(const row of rows){
    const earlier=byId.get(row.id);
    if(!earlier || row.description || (!earlier.description&&row.fetchedAt>earlier.fetchedAt)) byId.set(row.id,row);
  }
  return [...byId.values()];
}
function queriedUs(q:string){return topicalRows("Grants.gov","keyword:"+q,(read,at)=>searchUs(at,read,q));}
function queriedEu(q:string){return topicalRows("EU Funding & Tenders","keyword:"+q,(read,at)=>searchEu(at,read,q));}
function opportunityText(o:Opportunity){
  return [o.title,o.source,o.kind,o.description,o.programme,o.eligibility,o.kind==="VC"?"venture capital investor":"",o.id].join(" ");
}
export async function catalog(query:{q?:string; source?:string; limit?:number}={}){
  const term=query.q?.trim()??"", queryTerm=term.toLowerCase().match(/[a-z0-9][a-z0-9-]*/g)?.slice(0,6).join(" ")??"";
  const topical = queryTerm && !/^(?:accelerator|grant|tender|vc|perks|growth|nsf)$/i.test(queryTerm) ?
    [...(!query.source||query.source==="Grants.gov"?[queriedUs(queryTerm)]:[]),...(!query.source||query.source==="EU Funding & Tenders"?[queriedEu(queryTerm)]:[])] : [];
  const [general,factWarnings,extra]=await Promise.all([
    Promise.all((Object.keys(sources) as Source[]).filter(n=>!query.source||n===query.source).map(sourceRows)),
    Promise.all((Object.keys(factSources) as FactSource[]).filter(n=>!query.source||n===query.source).map(refreshFacts)),
    Promise.all(topical),
  ]);
  const store=db(), limit=query.limit??24;
  const isMatch=(s:string)=>catalogMatch(term,s);
  const filter=(s:string)=>!query.source||query.source===s;
  const warnings=[...new Set([...general,...extra].flatMap(x=>x.warning?[x.warning]:[]).concat(factWarnings.filter((s):s is string=>!!s)))];
  return {
    opportunities:mergeOpportunities([...general,...extra].flatMap(x=>x.items)).filter(x=>!x.signal && (term || listingStatus(x)!=="Closed") && isMatch(opportunityText(x))).sort(byListingStatus).slice(0,limit),
    evidence:store.prepare("SELECT data FROM evidence ORDER BY rowid DESC").all().map(row=>JSON.parse(String(row.data)) as Fact).filter(x=>filter(x.source)&&isMatch([x.source,x.entity,x.title].join(" "))).sort((a,b)=>(b.observed??"").localeCompare(a.observed??"")).slice(0,limit),
    signals:store.prepare(`SELECT data FROM signals WHERE (?1 IS NULL OR source=?1)
      AND catalog_match(?2,json_extract(data,'$.title')) ORDER BY observed DESC LIMIT ?3`)
      .all({"?1":query.source??null,"?2":term,"?3":limit}).map(row=>JSON.parse(String(row.data)) as Signal),
    warnings,
  };
}
export async function radar(p: Profile):Promise<Radar>{
  const terms=p.needs.includes("Grant") ? profileQueries(p) : [];
  const tenderCountries=p.needs.includes("Tender") ? profileLocations(p).countries.filter(c=>Object.hasOwn(euCountryCodes,c)) : [];
  const evidenceTerms=terms.slice(0,2);
  const historical=evidenceTerms.flatMap(q=>[
    topicalRows("NSF Awards",q,(read,at)=>searchNsf(read,at,q)),
    topicalRows("CORDIS",q,(read,at)=>searchCordis(read,at,q)),
    topicalRows("UKRI GtR",q,(read,at)=>searchUkri(read,at,q).catch(()=>searchUkri(read,at,q.split(" ").at(-1)))),
  ]);
  const [general,us,eu,tenders,facts]=await Promise.all([
    Promise.all((Object.keys(sources) as Source[]).filter(name=>name!=="Hacker News" && name!=="TED").map(sourceRows)),
    Promise.all(terms.map(queriedUs)),Promise.all(terms.map(queriedEu)),
    Promise.all(tenderCountries.map(country=>topicalRows("TED","country:"+country,(read,at)=>searchTed(at,read,[country])))),
    Promise.all(historical),
  ]);
  const usRows=mergeOpportunities(us.flatMap(result=>result.items.filter(o=>!o.prerequisites?.length && !/clinical trials?|\bNIH\b/i.test(o.title)).slice(0,5)));
  const enrich=await Promise.all(usRows.slice(0,12).map(row=>topicalRows("Grants.gov",row.id,async read=>[await enrichUs(row,read)])));
  const all=mergeOpportunities([...general,...us,...eu,...tenders,...enrich].flatMap(x=>x.items));
  const warnings=[...new Set([...general,...us,...eu,...tenders,...facts].flatMap(r=>r.warning?[r.warning]:[]))];
  return {matches:shortlist(rank(all,p)),evidence:relevantEvidence(facts.flatMap(r=>r.items),p).slice(0,8),warnings,scannedAt:new Date().toISOString()};
}
export async function builderBundle(profile?:Profile) {
  const results=await Promise.all([sourceRows("Accelerator directory"),sourceRows("Official program links")]);
  return results.flatMap(r=>r.items).filter(item=>item.kind==="Perks")
    .sort((a,b)=>perkScore(b,profile)-perkScore(a,profile));
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
