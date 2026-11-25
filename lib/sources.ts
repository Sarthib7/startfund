import { z } from "zod";
import { decodeHTML } from "entities";
import { euCountryCodes, type Opportunity } from "./domain";
import { corporateProgramRows } from "./facts";
import { governmentProgramRows } from "./government-programs";
import { curatedProgramRows } from "./programs";
import { post, reader, type Reader } from "./transport";
const str = z.string().min(1);
const date = (value?: string) => {
  value=value?.trim();
  const m = value?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = m ? `${m[3]}-${m[1]}-${m[2]}` : value?.slice(0,10);
  return iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) && Number.isFinite(Date.parse(iso)) && new Date(iso).toISOString().slice(0,10) === iso ? iso : null;
};
const cash = (v: unknown) => {
  const n = typeof v === "string" || typeof v === "number" ? Number(String(v).replace(/[,$]/g,"")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
function safeUrl(v: string) {
  try { const u = new URL(v); return u.protocol === "https:" || u.protocol === "http:" ? u.href : null; } catch { return null; }
}
const usRow = z.object({id: z.string().regex(/^\d+$/), title: str, agencyCode:z.string().optional(),closeDate: z.string().nullish(),openDate:z.string().nullish(),postDate:z.string().nullish(),archiveDate:z.string().nullish(),oppStatus:z.string().optional()});
const detailsSchema = z.object({data:z.object({ost:z.string().nullish(),synopsis:z.object({
  awardCeiling:z.unknown(),awardFloor:z.unknown(),estimatedFunding:z.unknown(), applicantEligibilityDesc:z.string().nullish(), synopsisDesc:z.string().nullish(),
  closeDate:z.string().nullish(),responseDateStr:z.string().nullish(),responseDate:z.string().nullish(),responseDateDesc:z.string().nullish(),archiveDate:z.string().nullish(),
})})});
const usClosed=(status?:string|null)=>/^(?:closed|archived)$/i.test(status??"");
function usDate(value?:string|null){
  const standard=date(value??undefined);
  if(standard)return standard;
  const m=value?.trim().match(/^([a-z]{3,9})\s+(\d{1,2}),\s+(\d{4})\b/i);
  if(!m)return null;
  const month="jan feb mar apr may jun jul aug sep oct nov dec".split(" ").indexOf(m[1].slice(0,3).toLowerCase())+1;
  return month?date(`${m[3]}-${String(month).padStart(2,"0")}-${m[2].padStart(2,"0")}`):null;
}
function usDeadline(value:string|null,today:string){
  const horizon=`${Number(today.slice(0,4))+5}${today.slice(4)}`;
  return value&&value<=horizon?value:null;
}
export function cleanText(value:string|null|undefined, limit:number) {
  const text=value && decodeHTML(value.replace(/<[^>]*>/g," ")).replace(/\s+/g," ").trim();
  return !text ? null : text.length<=limit ? text : text.slice(0,limit+1).replace(/\s+\S*$/,"")+"…";
}
const nihCalendar="https://grants.nih.gov/grants-process/submit/submission-policies/standard-due-dates";
export function nextNihDue(asOf:string,expires:string|null) {
  if (!expires) return null;
  for(let year=Number(asOf.slice(0,4));year<=Number(expires.slice(0,4));year++){
    for(const day of ["01-05","04-05","09-05"]){
      const candidate=`${year}-${day}`;
      if(candidate>=asOf && candidate<=expires) return candidate;
    }
  }
  return null;
}
function federalTerms(title:string,agency:string|undefined,expires:string|null,fetchedAt:string) {
  const nih=/^HHS-NIH/.test(agency??"") || /\b(?:NIH|NIDCR|NICHD|NHLBI)\b/i.test(title);
  const parent=nih && /\b(?:R41|R42|R43|R44|SB1)\b/i.test(title);
  const prior=nih && /\b(?:CRP|commercialization readiness pilot|phase iib|phase ii[- ]only)\b/i.test(title);
  const trial=/\b(?:clinical trials?|CT)\s*(?:[-:–]\s*)?required\b/i.test(title);
  const next=parent ? nextNihDue(fetchedAt.slice(0,10),expires) : null;
  return {deadline:next??expires,noticeExpires:next?expires??undefined:undefined,
    deadlineNote:next?"Standard NIH due date; verify the exact cycle in the NOFO.":undefined,
    applicationGuide:next?nihCalendar:"https://www.grants.gov/applicants/apply-for-grants",
    ...(parent ? {contact:"SEEDinfo@nih.gov"} : {}),
    prerequisites:[...(prior?["Requires prior NIH SBIR/STTR award"]:[]),...(trial?["Clinical trial required"]:[])]};
}
export function parseUs(raw: unknown, fetchedAt: string): Opportunity[] {
  const items = z.object({errorcode: z.literal(0), data:z.object({oppHits:z.array(z.unknown())})}).parse(raw);
  return items.data.oppHits.flatMap(rawRow => {
    const {data:r} = usRow.safeParse(rawRow);
    if(!r || (r.oppStatus && r.oppStatus.toLowerCase()!=="posted" && !usClosed(r.oppStatus)) || /^(?:rfi\b|request for information\b|noi\b|notice of intent\b)/i.test(r.title))return [];
    const title=cleanText(r.title,600)??r.title, today=fetchedAt.slice(0,10), postedAt=date(r.postDate??undefined)??date(r.openDate??undefined)??undefined;
    const deadline=usDeadline(usDate(r.closeDate),today), archived=usDate(r.archiveDate);
    const sourceClosed=usClosed(r.oppStatus)||(archived!==null&&archived<=today);
    const status=sourceClosed||(deadline&&deadline<today)?"Closed":deadline?"Open":"Unknown";
    return [{id:`us-${r.id}`,title,kind:"Grant",region:"US",source:"Grants.gov",url:`https://www.grants.gov/search-results-detail/${r.id}`,
      ...federalTerms(title,r.agencyCode,deadline,fetchedAt),status,...(sourceClosed?{sourceClosed}:{}),postedAt,amount:null,currency:"USD",eligibility:null,fetchedAt}];
  });
}
const euRow = z.object({reference:str,url:str,metadata:z.object({
  title:z.array(str).min(1), deadlineDate:z.array(z.string()).optional(), status:z.array(z.string()),
  identifier:z.array(z.string()).optional(), startDate:z.array(z.string()).optional(),
  type:z.array(z.string()).optional(), callccm2Id:z.array(z.string()).optional(), callTitle:z.array(z.string()).optional(),
  description:z.array(z.string()).optional(), descriptionByte:z.array(z.string()).optional(),
})});
export function parseEu(raw:unknown,fetchedAt:string):Opportunity[] {
  const {results} = z.object({results:z.array(z.unknown())}).parse(raw);
  return results.flatMap(x => {
    const {data:r} = euRow.safeParse(x);
    if (!r || /\bcancell?ed\b/i.test(r.metadata.title[0])) return [];
    const url = safeUrl(r.url);
    if (!url || new URL(url).hostname !== "ec.europa.eu") return [];
    const deadlines = (r.metadata.deadlineDate ?? []).map(date).filter(d => d !== null).sort();
    const today = fetchedAt.slice(0,10);
    const opensAt = (r.metadata.startDate ?? []).map(date).filter(d => d !== null).sort()[0] ?? null;
    const deadline = deadlines.find(d => d >= today) ?? deadlines.at(-1) ?? null;
    const codes = r.metadata.status;
    const status = codes.includes("31094503") || (deadline && deadline<today) ? "Closed" :
      codes.includes("31094501") || (opensAt && opensAt>today) ? "Forthcoming" :
      codes.includes("31094502") ? "Open" : null;
    if (!status) return [];
    const identifier = r.metadata.identifier?.[0];
    const competitive=r.metadata.type?.includes("8") || /COMPETITIVE_CALL/i.test(r.reference);
    const key=competitive ? r.metadata.callccm2Id?.[0] ?? r.reference : identifier ?? r.reference;
    const listing = !competitive && identifier && /^[A-Z0-9-]+$/i.test(identifier) ? `https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/${identifier}` : url;
    const programme = identifier?.startsWith("HORIZON") ? "Horizon Europe" : identifier?.startsWith("DIGITAL") ? "Digital Europe" : identifier?.startsWith("LIFE") ? "LIFE" : undefined;
    const eic=identifier?.match(/^HORIZON-EIC-(20\d{2})-ACCELERATOR-/)?.[1];
    const title=competitive ? r.metadata.callTitle?.[0] ?? r.metadata.title[0] :
      eic ? `EIC Accelerator ${eic} — ${r.metadata.title[0]}` : r.metadata.title[0];
    return [{id:`eu-${competitive?"competitive-":""}${key}`,title,kind:"Grant",region:"EU",source:"EU Funding & Tenders",url:listing,deadline,status,opensAt,programme,
      description:cleanText((r.metadata.description ?? r.metadata.descriptionByte ?? []).join(" "),4500)??undefined,amount:null,currency:"EUR",eligibility:null,fetchedAt}];
  });
}
const hnRow = z.object({objectID:z.string().regex(/^\d+$/),title:str,url:z.string().nullable().optional(),created_at_i:z.number().nonnegative().optional()});
export function parseHn(raw:unknown,fetchedAt:string):Opportunity[] {
  return z.object({hits:z.array(z.unknown())}).parse(raw).hits.flatMap(x => {
    const {data:r}=hnRow.safeParse(x);
    const postedAt=r?.created_at_i && r.created_at_i<=Date.parse(fetchedAt)/1000 ? new Date(r.created_at_i*1000).toISOString() : undefined;
    return r ? [{id:`hn-${r.objectID}`, title:r.title,kind:"Market signal",region:"Global",source:"Hacker News",url:r.url && safeUrl(r.url) || `https://news.ycombinator.com/item?id=${r.objectID}`,deadline:null,amount:null,currency:"USD",eligibility:null,fetchedAt,postedAt,signal:true}] : [];
  });
}
export async function searchUs(at:string, read:Reader, keyword?:string) {
  const rows=parseUs(await post(read,"https://api.grants.gov/v1/api/search2",{
    rows:18,keyword:keyword??"small business",oppStatuses:"posted",eligibilities:keyword?"23|99":"23",
  }),at);
  const undated=rows.filter(row=>row.status==="Unknown"&&row.postedAt)
    .sort((a,b)=>a.postedAt!.localeCompare(b.postedAt!)).slice(0,2);
  const checked=new Map((await Promise.all(undated.map(row=>enrichUs(row,read)))).map(row=>[row.id,row]));
  return rows.map(row=>checked.get(row.id)??row);
}
export async function enrichUs(row:Opportunity, read:Reader):Promise<Opportunity> {
  try {
    const {data:{ost,synopsis}}=detailsSchema.parse(await post(read,"https://api.grants.gov/v1/api/fetchOpportunity",{opportunityId:Number(row.id.slice(3))}));
    const eligibility=cleanText(synopsis.applicantEligibilityDesc,2400);
    const prior=row.contact && eligibility && /\b(?:previously received|prior (?:phase|award)|phase i awardee)\b/i.test(eligibility);
    const description=cleanText(synopsis.synopsisDesc,4500)??undefined;
    const today=row.fetchedAt.slice(0,10), archived=usDate(synopsis.archiveDate);
    const dueText=synopsis.responseDateDesc?.match(/\b(?:applications?|proposals?)\s+due\s*:\s*([a-z]{3,9}\s+\d{1,2},\s+\d{4})\b/i)?.[1];
    const expires=[synopsis.closeDate,synopsis.responseDateStr,synopsis.responseDate,dueText]
      .map(value=>usDeadline(usDate(value),today)).find(value=>value!==null)??null;
    const sourceClosed=row.sourceClosed||usClosed(ost)||(archived!==null&&archived<=today);
    const closed=sourceClosed||(expires?expires<today:row.status==="Closed");
    const rolling=!expires&&/\b(?:applications?|proposals?)\s+(?:(?:are|will be|may be)\s+)?accepted\s+(?:at any time|anytime|on a rolling basis)\b/i.test((description??"")+" "+(synopsis.responseDateDesc??""));
    const dateFields=expires?federalTerms(row.title,row.contact?"HHS-NIH":undefined,expires,row.fetchedAt):undefined;
    return {...row,...dateFields,...(sourceClosed?{sourceClosed}:{}),...(expires||rolling?{synopsisStatusVerified:true}:{}),
      ...(closed?{status:"Closed" as const}:rolling?{deadline:null,noticeExpires:undefined,deadlineNote:undefined,status:"Rolling" as const}:expires?{status:"Open" as const}:{}),
      amount:cash(synopsis.awardCeiling),awardFloor:cash(synopsis.awardFloor),programFunding:cash(synopsis.estimatedFunding),eligibility,
      prerequisites:[...new Set([...(row.prerequisites??[]),...(dateFields?.prerequisites??[]),...(prior ? ["Requires prior NIH SBIR/STTR award"]:[])])],
      description};
  } catch {return row;}
}
export async function searchEu(at:string,read:Reader,keyword?:string) {
    const params=new URLSearchParams({apiKey:"SEDIA",text:keyword??"startup",pageSize:keyword?"40":"30"});
    const form=new FormData();
    form.set("query",new Blob([JSON.stringify({bool:{must:[{terms:{type:["1","2","8"]}},{terms:{status:["31094501","31094502"]}},{terms:{language:["en"]}}]}})],{type:"application/json"}));
    const items = parseEu(await read("https://api.tech.ec.europa.eu/search-api/prod/rest/search?"+params,{method:"POST",body:form}),at);
    return [...new Map(items.map(item=>[item.id,item])).values()];
}
const ifs="https://apply-for-innovation-funding.service.gov.uk";
const ifsSearch=new URL("/competition/search",ifs);
export function parseInnovateUk(html:string,fetchedAt:string):Opportunity[] {
  const links=[...html.matchAll(/<a\b[^>]*href="(\/competition\/(\d+)\/overview\/[\da-f-]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  return links.flatMap((link,i)=>{
    const block=html.slice(link.index!+link[0].length,links[i+1]?.index);
    const dates=block.match(/<dl class="date-definition-list[^"]*"[^>]*>([\s\S]*?)<\/dl>/i)?.[1]??"";
    const dateOf=(label:string)=>{
      const raw=dates.match(new RegExp(`<dt>\\s*${label}:\\s*<\\/dt>\\s*<dd[^>]*>([^<]+)<\\/dd>`,"i"))?.[1];
      return raw && /^\d{1,2} [a-z]+ \d{4}$/i.test(raw.trim()) && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString().slice(0,10) : null;
    };
    const deadline=dateOf("Closes"),opensAt=dateOf("Opened")??dateOf("Opens");
    const title=cleanText(link[3],500);
    if (!title || !deadline || !opensAt) return [];
    const today=fetchedAt.slice(0,10);
    const status=deadline<today?"Closed":opensAt>today?"Forthcoming":"Open";
    return [{id:`innovate-uk-${link[2]}`,title,kind:"Grant",status,opensAt,deadline,region:"UK",source:"Innovate UK",
      url:ifs+link[1],currency:"GBP",amount:null,eligibility:"UK competition; check registration, lead applicant and consortium requirements in the source.",fetchedAt}];
  });
}
const startupCpvPrefixes=["72","48","73","302","793","794","642","713"];
const constructionCpvPrefix="45";
const tedCpvFields=["main-classification-proc","main-classification-lot","additional-classification-proc","additional-classification-lot"] as const;
export function hasStartupTenderCpv(codes:string[]|undefined) {
  return Boolean(codes?.some(code=>/^\d{8}$/.test(code) && startupCpvPrefixes.some(prefix=>code.startsWith(prefix))) &&
    !codes.some(code=>code.startsWith(constructionCpvPrefix)));
}
export function hasCompleteTenderCpv(o:Opportunity) {
  return o.cpvScope==="procedure-and-lots" && hasStartupTenderCpv(o.cpvCodes);
}
const tedRow=z.object({
  "publication-number":z.string().regex(/^\d+-\d{4}$/),
  "notice-title":z.record(z.string(),str),
  "main-classification-proc":z.array(z.string()).optional(),
  "main-classification-lot":z.array(z.string()).optional(),
  "additional-classification-proc":z.array(z.string()).optional(),
  "additional-classification-lot":z.array(z.string()).optional(),
  "deadline-receipt-tender-date-lot":z.array(z.string()),
  "deadline-receipt-tender-time-lot":z.array(z.string()).optional(),
  "place-of-performance-country-lot":z.array(z.string()).optional(),
  "place-of-performance-country-proc":z.array(z.string()).optional(),
  "publication-date":z.string().optional(),
});
const tedCountry=(code:string)=>Object.entries(euCountryCodes).find(([,alpha3])=>alpha3===code)?.[0];
export function parseTed(raw:unknown,fetchedAt:string):Opportunity[] {
  const {notices,timedOut}=z.object({notices:z.array(z.unknown()),timedOut:z.boolean().optional()}).parse(raw);
  if(timedOut) throw new Error("TED search timed out");
  return notices.flatMap(row=>{
    const {data:r}=tedRow.safeParse(row);
    if(!r) return [];
    const primary=[...(r["main-classification-proc"]??[]),...(r["main-classification-lot"]??[])];
    const cpvCodes=[...new Set(tedCpvFields.flatMap(field=>r[field]??[]))];
    if(!hasStartupTenderCpv(primary) || !hasStartupTenderCpv(cpvCodes)) return [];
    const dates=r["deadline-receipt-tender-date-lot"], times=r["deadline-receipt-tender-time-lot"];
    const deadline=dates.flatMap((raw,index)=>{
      const day=date(raw);
      if(!day) return [];
      const time=times?.length===dates.length?times[index]:undefined;
      const offset=raw.slice(10).match(/^(?:Z|[+-]\d{2}:\d{2})$/)?.[0];
      const match=time?.match(/^(\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:\d{2})?$/);
      const stamp=match && (match[2] || offset) ? Date.parse(day+"T"+match[1]+(match[2]??offset)) : NaN;
      if(Number.isFinite(stamp)) return stamp>Date.parse(fetchedAt)?[new Date(stamp).toISOString()]:[];
      return day>=fetchedAt.slice(0,10)?[day]:[];
    }).sort()[0];
    const countries=[...new Set([...(r["place-of-performance-country-lot"]??[]),...(r["place-of-performance-country-proc"]??[])]
      .map(tedCountry).filter(c=>c!==undefined))];
    const title=cleanText(r["notice-title"].eng??Object.values(r["notice-title"])[0],600);
    if(!deadline || !countries.length || !title) return [];
    const id=r["publication-number"];
    return [{id:`ted-${id}`,title,kind:"Tender",region:"EU",countries,cpvCodes,cpvScope:"procedure-and-lots",source:"TED",url:`https://ted.europa.eu/en/notice/-/detail/${id}`,
      deadline,status:"Open",amount:null,currency:"EUR",eligibility:"Place of performance is not bidder eligibility; check the original notice.",
      postedAt:date(r["publication-date"])??undefined,fetchedAt}];
  });
}
export async function searchTed(at:string,read:Reader,countries:string[]=Object.keys(euCountryCodes)) {
  const codes=Object.entries(euCountryCodes).filter(([country])=>countries.includes(country)).map(([,code])=>code).join(", ");
  if(!codes) return [];
  const cpv=startupCpvPrefixes.map(prefix=>prefix+"*").join(", ");
  const exclude=tedCpvFields.map(field=>`NOT ${field} = ${constructionCpvPrefix}*`).join(" AND ");
  const query=`notice-type IN (cn-standard, cn-social, cn-desg) AND deadline-receipt-tender-date-lot >= today() AND publication-date >= today(-60) AND (main-classification-proc IN (${cpv}) OR main-classification-lot IN (${cpv})) AND ${exclude} AND (place-of-performance-country-lot IN (${codes}) OR place-of-performance-country-proc IN (${codes}))`;
  return parseTed(await post(read,"https://api.ted.europa.eu/v3/notices/search",{
    query,fields:Object.keys(tedRow.shape),scope:"ACTIVE",limit:60,page:1,
  }),at);
}

const germanHost="www.foerderdatenbank.de";
const germanStates:Record<string,string>={
 "Baden-Württemberg":"BW","Baden-Wuerttemberg":"BW",Bayern:"BY",Berlin:"BE",Brandenburg:"BB",Bremen:"HB",Hamburg:"HH",
 Hessen:"HE","Mecklenburg-Vorpommern":"MV",Niedersachsen:"NI","Nordrhein-Westfalen":"NW",NRW:"NW","Rheinland-Pfalz":"RP",
 Saarland:"SL",Sachsen:"SN","Sachsen-Anhalt":"ST","Schleswig-Holstein":"SH",Thüringen:"TH",Thueringen:"TH",
};
const germanFeed=`https://${germanHost}/FDB/DE/Service/RSS/Functions/foerderprogram_rssnewsfeed.xml`;
const xmlText=(value:string)=>value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1")
  .replace(/&#(x[\da-f]+|\d+);/gi,(entity,raw:string)=>{
    const code=raw[0].toLowerCase()==="x"?Number.parseInt(raw.slice(1),16):Number(raw);
    return code>0 && code<=0x10ffff?String.fromCodePoint(code):entity;
  }).replace(/&amp;/g,"&");
export function parseGermanFeed(xml:string) {
  if(!/<rss\b[\s\S]*<\/rss>/i.test(xml)) throw new Error("Invalid Förderdatenbank feed");
  const entries=[...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].flatMap(([,item])=>{
    const field=(name:string)=>xmlText(item.match(new RegExp(`<${name}>([\\s\\S]*?)<\/${name}>`,"i"))?.[1]??"").trim();
    const url=safeUrl(field("link"));
    const title=cleanText(field("title"),500);
    if(!url || !title) return [];
    const listing=new URL(url);
    if(listing.protocol!=="https:" || listing.host!==germanHost ||
      !/^\/FDB\/Content\/DE\/Foerderprogramm\/(?:Bund|Land)\/[\w/-]+\.html$/i.test(listing.pathname)) return [];
    const posted=Date.parse(field("pubDate"));
    const description=cleanText(field("description"),3500)??undefined;
    const grantType=/\b(?:mit Zuschüssen|als Zuschuss|einen Zuschuss (?:von|erhalten))\b/i.test(description??"");
    return [{title,description,url:listing.origin+listing.pathname,postedAt:Number.isFinite(posted)?new Date(posted).toISOString().slice(0,10):undefined,grantType}];
  });
  return [...new Map(entries.map(item=>[item.url,item])).values()];
}
export function parseGermanGrant({grantType,...entry}:ReturnType<typeof parseGermanFeed>[number],html:string,fetchedAt:string):Opportunity|null {
  const fields=new Map([...html.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)]
    .map(([,key,value])=>[cleanText(key,100),cleanText(value,500)]));
  const type=fields.get("Förderart:");
  if(!type && !grantType) throw new Error("Förderdatenbank detail metadata unavailable");
  if(type && !/\bZuschuss\b/i.test(type)) return null;
  const area=fields.get("Fördergebiet:")??(entry.url.includes("/Land/")?"State program":"Federal program");
  const applicants=fields.get("Förderberechtigte:");
  const land=new URL(entry.url).pathname.split("/Land/")[1]?.split("/")[0];
  const state=germanStates[area]??(land?germanStates[land]:undefined);
  return {...entry,id:"de-grant-"+new URL(entry.url).pathname,kind:"Grant",region:"DE",source:"Förderdatenbank",
    countries:["DE"],...(state?{subdivisions:[`DE-${state}`]}:{}),
    programme:area??undefined,eligibility:applicants??null,deadline:null,status:"Program link",amount:null,currency:"EUR",fetchedAt};
}
async function searchGermanGrants(at:string,read:Reader) {
  const feed=parseGermanFeed(String(await read(germanFeed,{headers:{accept:"application/rss+xml"}})));
  const outcomes=await Promise.allSettled(feed.slice(0,12).map(async entry=>{
    const html=await read(entry.url,{headers:{accept:"text/html"}}).catch(error=>{
      if(!entry.grantType) throw error;
      return "";
    });
    return parseGermanGrant(entry,String(html),at);
  }));
  if(outcomes.length && outcomes.every(outcome=>outcome.status==="rejected")) throw new Error("Förderdatenbank details unavailable");
  return outcomes.flatMap(outcome=>outcome.status==="fulfilled" && outcome.value ? [outcome.value] : []);
}
async function innovateUk(at:string,read:Reader) {
  const rows=new Map<string,Opportunity>(),visited=new Set<string>();
  let page=ifsSearch;
  for(let i=0;i<5;i++){
    if(visited.has(page.href)) break;
    visited.add(page.href);
    const html=String(await read(page.href,{headers:{accept:"text/html"}}));
    for(const row of parseInnovateUk(html,at)) rows.set(row.id,row);
    const nextTag=html.match(/<a\b[^>]*\brel=(?:"next"|'next')[^>]*>/i)?.[0];
    const href=nextTag?.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if(!href) break;
    const next=URL.parse(href.replaceAll("&amp;","&"),page);
    if(!next||next.origin!==ifsSearch.origin||next.pathname!==ifsSearch.pathname||!/^\d+$/.test(next.searchParams.get("page")??"")) break;
    page=next;
  }
  return [...rows.values()];
}
const ukGrantList="https://www.find-government-grants.service.gov.uk/grants";
const ukGrantRow=z.object({
 label:z.string().regex(/^[a-z0-9-]+$/),grantName:str,grantApplicantType:z.array(z.string()),
 grantLocation:z.array(z.string()),grantShortDescription:z.string().optional(),grantFunder:z.string().optional(),
 grantMaximumAward:z.unknown(),grantApplicationOpenDate:z.string().optional(),grantApplicationCloseDate:z.string().optional(),
});
const ukRegions:Record<string,string>={England:"GB-ENG",Scotland:"GB-SCT",Wales:"GB-WLS","Northern Ireland":"GB-NIR"};
const londonOffset=new Intl.DateTimeFormat("en",{timeZone:"Europe/London",timeZoneName:"longOffset"});
function ukGrantDeadline(value:string|undefined) {
 const day=date(value);
 if(!day || !value || value===day) return day;
 const match=value.match(/^\d{4}-\d{2}-\d{2}T((?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?)(Z|[+-]\d{2}:\d{2})?$/);
 if(!match) return day;
 const clock=day+"T"+match[1];
 const zone=(instant:number)=>londonOffset.formatToParts(instant).find(p=>p.type==="timeZoneName")?.value.slice(3)||"Z";
 const stamp=Date.parse(clock+(match[2]??zone(Date.parse(clock+"Z"))));
 return Number.isFinite(stamp)?new Date(stamp).toISOString():day;
}
export function parseUkGovernmentGrants(html:string,at:string) {
 const script=html.match(/<script\b[^>]*\bid="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
 if(!script) throw new Error("Find a Grant listing data unavailable");
 const {props:{pageProps:{searchResult,totalGrants}}}=z.object({props:z.object({pageProps:z.object({
  searchResult:z.array(z.unknown()),totalGrants:z.number().int().nonnegative(),
 })})}).parse(JSON.parse(script[1]));
 const today=at.slice(0,10);
 const rows=searchResult.flatMap((raw):Opportunity[]=>{
  const {data:r}=ukGrantRow.safeParse(raw);
  if(!r?.grantApplicantType.includes("Private Sector")) return [];
  const title=cleanText(r.grantName,500);
  if(!title || /\((?:Fellowship|Bursary)\)\s*$/i.test(title)) return [];
  const description=cleanText(r.grantShortDescription,3500)??undefined;
  const subdivisions=r.grantLocation.map(area=>ukRegions[area]??(area.endsWith(" England")||area==="Midlands"?"GB-ENG":undefined))
   .filter((area):area is string=>area!==undefined);
  const ukFunder=/\b(?:advanced research and invention agency|innovate uk|uk research and innovation|ukri|uk government|department for (?:business|science|international trade)|foreign, commonwealth and development office)\b/i.test(r.grantFunder??"");
  const invitesUk=/\b(?:UK|United Kingdom)[ -](?:based[ -])?(?:businesses|companies|organisations|organizations|applicants)\b[^.!?]{0,60}\b(?:can|may|eligible|welcome|invited)\b/i.test(description??"");
  const national=r.grantLocation.includes("National") ||
   (!subdivisions.length && r.grantLocation.includes("International") && (ukFunder || invitesUk));
  if(!national && !subdivisions.length) return [];
  const opensAt=date(r.grantApplicationOpenDate), deadline=ukGrantDeadline(r.grantApplicationCloseDate);
  const closed=deadline && (deadline.includes("T")?Date.parse(deadline)<=Date.parse(at):deadline<today);
  const status=closed?"Closed":opensAt && opensAt>today?"Forthcoming":opensAt && deadline?"Open":"Program link";
  return [{id:"gb-find-"+r.label,title,kind:"Grant",region:"UK",countries:["GB"],
   ...(!national?{subdivisions:[...new Set(subdivisions)]}:{}),
   description,eligibility:"Listed for private-sector applicants; check the individual grant’s rules.",
   source:"UK Find a Grant",url:ukGrantList+"/"+r.label,opensAt,deadline,status,currency:"GBP",amount:cash(r.grantMaximumAward),fetchedAt:at}];
 });
 return {rows,totalGrants};
}
async function searchUkGovernmentGrants(at:string,read:Reader) {
 const url=ukGrantList+"?searchTerm=innovation";
 const load=async (page:number)=>parseUkGovernmentGrants(String(await read(url+(page>1?`&page=${page}`:""),{headers:{accept:"text/html"}})),at);
 const first=await load(1);
 const rest=await Promise.allSettled(Array.from({length:Math.min(4,Math.max(0,Math.ceil(first.totalGrants/10)-1))},(_,i)=>load(i+2)));
 const rows=[...first.rows,...rest.flatMap(result=>result.status==="fulfilled"?result.value.rows:[])];
 return [...new Map(rows.map(row=>[row.id,row])).values()];
}
export const sources = {
  "Grants.gov":async (at:string,read:Reader=reader()) => {
    const rows=await searchUs(at,read);
    return Promise.all(rows.map((row,i) => i<6 && !row.description && !row.eligibility ? enrichUs(row,read) : row));
  },
  "EU Funding & Tenders":async(at:string,read:Reader=reader())=>{
    const [general,eic]=await Promise.allSettled([searchEu(at,read),searchEu(at,read,"EIC Accelerator")]);
    if (general.status==="rejected" && eic.status==="rejected") throw general.reason;
    const rows=[...(general.status==="fulfilled"?general.value:[]),...(eic.status==="fulfilled"?eic.value:[])];
    return [...new Map(rows.filter(o=>o.status!=="Closed").map(o=>[o.id,o])).values()];
  },
  "Innovate UK":async(at:string,read:Reader=reader())=>innovateUk(at,read),
  "UK Find a Grant":async(at:string,read:Reader=reader())=>searchUkGovernmentGrants(at,read),
  "Government program links":async(at:string)=>governmentProgramRows(at),
  "TED":async(at:string,read:Reader=reader())=>searchTed(at,read),
  "Förderdatenbank":async(at:string,read:Reader=reader())=>searchGermanGrants(at,read),
  "Hacker News":async(at:string,read:Reader=reader())=>{
    const base="https://hn.algolia.com/api/v1/search_by_date?";
    const requests=["startup venture funding","startup launch"];
    const outputs=await Promise.all(requests.map(async query=>parseHn(await read(base+new URLSearchParams({query,tags:"story",hitsPerPage:"7",numericFilters:`created_at_i>${Math.floor(Date.parse(at)/1000)-30*86400}`})),at)));
    return [...new Map(outputs.flat().map(o=>[o.id,o])).values()];
  },
  "Accelerator directory":async(at:string):Promise<Opportunity[]>=> [
    {id:"yc",title:"Y Combinator — Winter 2027",url:"https://www.ycombinator.com/apply", eligibility:"On-time applications closed November 2 at 8 p.m. Pacific; late applications are accepted. Early-stage founders.",
      deadline:"2026-11-02",status:"Late applications" as const,verifiedAt:"2026-11-25"},
    {id:"ts",title:"Techstars Accelerators",url:"https://www.techstars.com/accelerators",eligibility:"Official program directory; confirm each program’s dates and eligibility. Early-stage founders."},
  ].map((o):Opportunity=>({deadline:null,...o,kind:"Accelerator",region:"Global",source:"Accelerator directory",amount:null,currency:"USD",fetchedAt:at,programId:o.id})).concat(corporateProgramRows(at)),
  "Official program links":async(at:string)=>curatedProgramRows(at),
};
export type Source = keyof typeof sources;
