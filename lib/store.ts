import { createHash } from "node:crypto";
import { enrichUs, hasCompleteTenderCpv, searchEu, searchTed, searchUs, sources, type Source } from "./sources";
import { byListingStatus, catalogMatch, catalogWords, euCountryCodes, listingStatus, profileLocations, profileQueries, relevantEvidence, rank, shortlist, type Opportunity, type Profile, type Radar } from "./domain";
import { factSources, rights, searchCordis, searchNsf, searchUkri, type Fact, type FactSource } from "./facts";
import { reader, type Snapshot } from "./transport";
import { perkScore } from "./programs";

import { db, type Statement } from "./database";

const ttl = 20*60*1000;
const inFlight = new Map<Source,Promise<{items: Opportunity[]; warning?: string}>>();
function auditedRead(name:Source|FactSource,at:string){
  const terms=rights[name];
  return reader({contact:process.env.RADAR_SOURCE_CONTACT,
    async lookUp(url){return (await (await db()).all("SELECT url,body,etag,modified FROM raw_snapshots WHERE source=? AND url=? ORDER BY id DESC LIMIT 1",name,url))[0] as Snapshot|undefined;},
    async capture(s){
      await (await db()).batch([
        {sql:"INSERT INTO raw_snapshots (source,url,fetched,rights,body,etag,modified) VALUES (?,?,?,?,?,?,?)",args:[name,s.url,at,terms,s.body,s.etag,s.modified]},
        {sql:"DELETE FROM raw_snapshots WHERE source=? AND fetched<?",args:[name,new Date(Date.parse(at)-14*86400000).toISOString()]},
      ]);
    },
  });
}
export async function sourceRows(name: Source) {
  const running = inFlight.get(name);
  if (running) return running;
  const task = (async () => {
    const store = await db();
    const previous = (await store.all("SELECT scanned,data FROM sources WHERE name = ?",name))[0] as {scanned:string;data:string}|undefined;
    const stored: Opportunity[] = previous ? JSON.parse(previous.data) : [];
    const current = name==="Hacker News" ? stored.every(o=>o.kind==="Market signal") :
      name==="EU Funding & Tenders" || name==="Grants.gov" ? stored.every(o=>o.status) :
      name==="Accelerator directory" ? stored.every(o=>o.kind!=="Growth") :
      name==="TED" ? stored.every(hasCompleteTenderCpv) : true;
    if (previous && current && Date.now()-Date.parse(previous.scanned) < ttl) return {items: stored};
    const at = new Date().toISOString();
    try {
      const items = await sources[name](at,auditedRead(name,at));
      const writes:Statement[]=[{sql:"DELETE FROM opportunities WHERE source=?",args:[name]}];
      for(const item of items){
        if(item.programId) writes.push({sql:"INSERT INTO programs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name",args:[item.programId,item.title]});
        writes.push({sql:"INSERT INTO opportunities VALUES (?,?,?,?)",args:[item.id,name,item.programId??null,JSON.stringify(item)]});
        const before=stored.find(x=>x.id===item.id);
        const change=item.signal ? "Market signal" : before && before.deadline!==item.deadline ? "Deadline changed" : !before && previous ? "Newly observed" : null;
        if(change){
          const id=item.signal ? item.id : `${item.id}-${at}`;
          writes.push({sql:"INSERT INTO signals VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET observed=excluded.observed,data=excluded.data",
            args:[id,name,item.postedAt??at,signalJson({id,title:item.title,kind:change,source:name,url:item.url,observed:item.postedAt??at,postedAt:item.postedAt,fetchedAt:at,rights:rights[name]})]});
        }
      }
      writes.push({sql:"INSERT INTO sources VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET scanned=excluded.scanned,data=excluded.data",args:[name,at,JSON.stringify(items)]});
      await store.batch(writes);
      return {items};
    } catch {
      const items=name==="TED" ? stored.filter(hasCompleteTenderCpv) : stored;
      return {items, warning: `${name}: ${previous && (name!=="TED" || items.length) ? "showing cached listings" : "temporarily unavailable"}`};
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
    const store=await db();
    const last=(await store.all("SELECT scanned FROM fact_runs WHERE source=?",name))[0]?.scanned;
    if(typeof last==="string"&&Date.now()-Date.parse(last)<86400000)return;
    const at=new Date().toISOString();
    try{
      const rows=await factSources[name](auditedRead(name,at),at);
      const writes:Statement[]=[];
      for(const f of rows){
        const table=f.entityType==="Investor" ? "investors" : "programs";
        writes.push({sql:`INSERT INTO ${table} VALUES (?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name`,args:[f.entityId,f.entity]});
        writes.push({sql:"INSERT INTO evidence VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",args:[f.id,name,f.entityId,JSON.stringify(f)]});
        if(f.kind==="Regulatory filing"){
          writes.push({sql:"INSERT OR IGNORE INTO signals VALUES (?,?,?,?)",args:[f.id,name,at,signalJson({id:f.id,title:f.entity,kind:f.title,source:name,url:f.url,observed:f.observed??at,rights:f.rights})]});
        }
      }
      writes.push({sql:"INSERT INTO fact_runs VALUES (?,?) ON CONFLICT(source) DO UPDATE SET scanned=excluded.scanned",args:[name,at]});
      await store.batch(writes);
      return;
    }catch{return `${name}: ${last?"showing cached evidence":"temporarily unavailable"}`;}
  })().finally(()=>ongoing.delete(name));
  ongoing.set(name,task);return task;
}
type Signal={id:string;title:string;kind:string;source:string;url:string;observed:string;rights:string;postedAt?:string;fetchedAt?:string};
const signalJson=(signal:Signal)=>JSON.stringify({...signal,searchText:" "+catalogWords(signal.title).join(" ")+" "});
type QueryResult<T>={items:T[];warning?:string};
const topicalCache=new Map<string,{until:number;result:Promise<QueryResult<unknown>>}>();
const activeQueries=new Map<string,Promise<QueryResult<unknown>>>();
function topicalRows<T>(name:Source|FactSource,key:string,load:(read:ReturnType<typeof auditedRead>,at:string)=>Promise<T[]>):Promise<QueryResult<T>> {
  const id=JSON.stringify([name,key]),cached=topicalCache.get(id),running=activeQueries.get(id);
  if(running) return running as Promise<QueryResult<T>>;
  if(cached&&cached.until>Date.now()) return cached.result as Promise<QueryResult<T>>;
  if(activeQueries.size>=36) return Promise.resolve({items:[],warning:`${name}: topical search busy`});
  const at=new Date().toISOString();
  const persistentKey=createHash("sha256").update(id).digest("hex");
  const result=(async():Promise<QueryResult<T>>=>{
    const store=await db();
    const stored=(await store.all("SELECT data FROM topical_cache WHERE key=? AND expires>?",persistentKey,Date.now()))[0];
    if(stored)return {items:JSON.parse(String(stored.data)) as T[]};
    const items=await load(auditedRead(name,at),at);
    await store.batch([
      {sql:"INSERT INTO topical_cache VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET expires=excluded.expires,data=excluded.data",args:[persistentKey,Date.now()+ttl,JSON.stringify(items)]},
      {sql:"DELETE FROM topical_cache WHERE expires<=? OR key IN (SELECT key FROM topical_cache ORDER BY expires DESC,key LIMIT -1 OFFSET 256)",args:[Date.now()]},
    ]);
    return {items};
  })().catch(()=>({items:[],warning:`${name}: topical search unavailable`}));
  activeQueries.set(id,result);
  void result.then(value=>{
    activeQueries.delete(id);
    topicalCache.delete(id);
    if(topicalCache.size>=128) topicalCache.delete(topicalCache.keys().next().value!);
    topicalCache.set(id,{until:Date.now()+(("warning" in value) ? 60_000 : ttl),result});
  });
  return result;
}
const ukCompetitionTitle=(title:string)=>title.toLowerCase().replace(/&/g," and ").match(/[\p{L}\p{N}]+/gu)?.join(" ");
const ukCompetitionUrl=(url:string)=>{
  const parsed=URL.parse(url);
  return parsed && parsed.hostname.replace(/^www\./,"")+parsed.pathname.replace(/\/+$/,"");
};
export function mergeOpportunities(rows:Opportunity[]) {
  const byId=new Map<string,Opportunity>();
  for(const row of rows){
    const earlier=byId.get(row.id);
    if(!earlier || row.description || (!earlier.description&&row.fetchedAt>earlier.fetchedAt)) byId.set(row.id,row);
  }
  const innovate=[...byId.values()].filter(row=>row.source==="Innovate UK");
  for(const row of byId.values()){
    if(row.source!=="UK Find a Grant") continue;
    const url=ukCompetitionUrl(row.url),title=ukCompetitionTitle(row.title),day=row.deadline?.slice(0,10);
    const exact=url && innovate.find(candidate=>ukCompetitionUrl(candidate.url)===url);
    const similar=title && day ? innovate.filter(candidate=>ukCompetitionTitle(candidate.title)===title &&
      candidate.deadline?.slice(0,10)===day) : [];
    const match=exact || (similar.length===1 ? similar[0] : undefined);
    if(!match) continue;
    const current=byId.get(match.id)!;
    const timed=row.deadline?.includes("T") && row.deadline.slice(0,10)===current.deadline?.slice(0,10);
    byId.set(match.id,{...current,description:current.description??row.description,amount:current.amount??row.amount,
      ...(timed?{deadline:row.deadline,status:row.status}:{})});
    byId.delete(row.id);
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
  const store=await db(), limit=query.limit??24;
  const isMatch=(s:string)=>catalogMatch(term,s);
  const filter=(s:string)=>!query.source||query.source===s;
  const warnings=[...new Set([...general,...extra].flatMap(x=>x.warning?[x.warning]:[]).concat(factWarnings.filter((s):s is string=>!!s)))];
  const signalWords=[...new Set(catalogWords(term))];
  const [evidence,signals]=await Promise.all([
    store.all("SELECT data FROM evidence WHERE (?1 IS NULL OR source=?1) ORDER BY rowid DESC",query.source??null),
    store.remote ? store.all(`SELECT json_remove(data,'$.searchText') AS data FROM signals WHERE (?1 IS NULL OR source=?1)${signalWords.map(()=> " AND instr(json_extract(data,'$.searchText'),?)>0").join("")} ORDER BY observed DESC LIMIT ?`,query.source??null,...signalWords.map(word=>" "+word+" "),limit) :
      store.all(`SELECT json_remove(data,'$.searchText') AS data FROM signals WHERE (?1 IS NULL OR source=?1)
       AND catalog_match(?2,json_extract(data,'$.title')) ORDER BY observed DESC LIMIT ?3`,query.source??null,term,limit),
  ]);
  return {
    opportunities:mergeOpportunities([...general,...extra].flatMap(x=>x.items)).filter(x=>!x.signal && (term || listingStatus(x)!=="Closed") && isMatch(opportunityText(x))).sort(byListingStatus).slice(0,limit),
    evidence:evidence.map(row=>JSON.parse(String(row.data)) as Fact).filter(x=>filter(x.source)&&isMatch([x.source,x.entity,x.title].join(" "))).sort((a,b)=>(b.observed??"").localeCompare(a.observed??"")).slice(0,limit),
    signals:signals.map(row=>JSON.parse(String(row.data)) as Signal),
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
    Promise.all(tenderCountries.map(country=>topicalRows("TED","procedure-and-lots:"+country,(read,at)=>searchTed(at,read,[country])))),
    Promise.all(historical),
  ]);
  const detailed=new Set(general.flatMap(result=>result.items.filter(o=>o.source==="Grants.gov"&&(o.description||o.eligibility)).map(o=>o.id)));
  const usRows=mergeOpportunities(us.flatMap(result=>result.items.filter(o=>!detailed.has(o.id)&&!o.prerequisites?.length && !/clinical trials?|\bNIH\b/i.test(o.title)).slice(0,5)));
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
export async function saved(id:string){
  const row=(await (await db()).all("SELECT data,digest FROM profiles WHERE id=?",id))[0] as {data:string;digest:string|null}|undefined;
  if(!row) return null;
  const digest=row.digest ? JSON.parse(row.digest) as Radar : null;
  if(digest) digest.matches=digest.matches.filter(o=>o.source!=="TED" || hasCompleteTenderCpv(o));
  return {profile:JSON.parse(row.data) as Profile,digest};
}
export async function save(id:string,p:Profile,digest:Radar){
  await (await db()).run("INSERT INTO profiles (id,data,digest,updated) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,digest=excluded.digest,updated=excluded.updated",id,JSON.stringify(p),JSON.stringify(digest),new Date(Date.now()).toISOString());
}
const tokenHash=(token:string)=>createHash("sha256").update(token).digest("hex");
export async function digestSubscription(id:string) {
  const row=(await (await db()).all("SELECT confirmed,expires FROM digest_subscriptions WHERE profile_id=?",id))[0];
  return row?.confirmed ? "subscribed" : row && Number(row.expires)>Date.now() ? "pending" : "off";
}
export async function requestSubscription(id:string,email:string,token:string,unsubscribe:string) {
  return (await (await db()).run(`INSERT INTO digest_subscriptions (profile_id,email,confirmation,expires,unsubscribe)
    VALUES (?,?,?,?,?) ON CONFLICT(profile_id) DO UPDATE SET email=excluded.email,confirmation=excluded.confirmation,
    expires=excluded.expires,unsubscribe=excluded.unsubscribe,confirmed=NULL,sent=NULL
    WHERE digest_subscriptions.confirmed IS NULL AND digest_subscriptions.expires <= ?`,id,email,tokenHash(token),Date.now()+86400000,unsubscribe,Date.now()))>0;
}
export async function confirmSubscription(token:string) {
  return (await (await db()).run("UPDATE digest_subscriptions SET confirmed=? WHERE confirmation=? AND expires>? AND confirmed IS NULL",Date.now(),tokenHash(token),Date.now()))>0;
}
export async function removeSubscription(id:string) {
  await (await db()).run("DELETE FROM digest_subscriptions WHERE profile_id=?",id);
}
export async function unsubscribeDigest(token:string) {
  return (await (await db()).run("DELETE FROM digest_subscriptions WHERE unsubscribe=?",token))>0;
}
export async function subscriptions(){
  return (await (await db()).all(`SELECT p.id,p.data,p.updated,s.sent,s.email,s.unsubscribe FROM profiles p JOIN digest_subscriptions s
    ON p.id=s.profile_id WHERE s.confirmed IS NOT NULL`))
    .map(row=>({id:String(row.id),profile:JSON.parse(String(row.data)) as Profile,sent:row.sent ? String(row.sent) : null,
      email:String(row.email),unsubscribe:String(row.unsubscribe),version:String(row.updated)}));
}
export async function updateDigest(id:string,digest:Radar,version:string){
  return (await (await db()).run("UPDATE profiles SET digest=? WHERE id=? AND updated=?",JSON.stringify(digest),id,version))>0;
}
export async function canDeliverDigest(id:string,unsubscribe:string){
  return Boolean((await (await db()).all("SELECT 1 FROM digest_subscriptions WHERE profile_id=? AND unsubscribe=? AND confirmed IS NOT NULL",id,unsubscribe))[0]);
}
export async function markSent(id:string,week:string){
  await (await db()).run("UPDATE digest_subscriptions SET sent=? WHERE profile_id=?",week,id);
}
