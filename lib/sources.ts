import { z } from "zod";
import type { Opportunity } from "./domain";
import { corporateProgramRows } from "./facts";
import { curatedProgramRows } from "./programs";
import { post, reader, type Reader } from "./transport";
const str = z.string().min(1);
const date = (value?: string) => {
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
const usRow = z.object({id: z.string().regex(/^\d+$/), title: str, agencyCode:z.string().optional(),closeDate: z.string().optional(), oppStatus:z.string().optional()});
const detailsSchema = z.object({data:z.object({synopsis:z.object({
  awardCeiling:z.unknown(),awardFloor:z.unknown(),estimatedFunding:z.unknown(), applicantEligibilityDesc:z.string().nullish(), synopsisDesc:z.string().nullish(),
})})});
export function cleanText(value:string|null|undefined, limit:number) {
  const text=value?.replace(/<[^>]*>/g," ").replace(/&nbsp;|&#160;/g," ").replace(/&amp;/g,"&").replace(/&#x27;|&#39;|&apos;/g,"'").replace(/\s+/g," ").trim();
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
  const trial=/\bclinical trials? required\b/i.test(title);
  const next=parent ? nextNihDue(fetchedAt.slice(0,10),expires) : null;
  return {deadline:next??expires,...(next ? {noticeExpires:expires??undefined,deadlineNote:"Standard NIH due date; verify the exact cycle in the NOFO.",applicationGuide:nihCalendar} :
    {applicationGuide:"https://www.grants.gov/applicants/apply-for-grants"}),
    ...(parent ? {contact:"SEEDinfo@nih.gov"} : {}),
    prerequisites:[...(prior?["Requires prior NIH SBIR/STTR award"]:[]),...(trial?["Clinical trial required"]:[])]};
}
export function parseUs(raw: unknown, fetchedAt: string): Opportunity[] {
  const items = z.object({errorcode: z.literal(0), data:z.object({oppHits:z.array(z.unknown())})}).parse(raw);
  return items.data.oppHits.flatMap(rawRow => {
    const {data:r} = usRow.safeParse(rawRow);
    return r && (!r.oppStatus || r.oppStatus === "posted") && !/^(?:rfi\b|request for information\b|noi\b|notice of intent\b)/i.test(r.title)
      ? [{id:`us-${r.id}`, title:cleanText(r.title,600)??r.title, kind:"Grant", region:"US", source:"Grants.gov", url:`https://www.grants.gov/search-results-detail/${r.id}`, ...federalTerms(r.title,r.agencyCode,date(r.closeDate),fetchedAt), status:"Open", amount:null,currency:"USD",eligibility:null,fetchedAt}] : [];
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
  return parseUs(await post(read,"https://api.grants.gov/v1/api/search2",{
    rows:18,keyword:keyword??"small business",oppStatuses:"posted",eligibilities:keyword?"23|99":"23",
  }),at);
}
export async function enrichUs(row:Opportunity, read:Reader):Promise<Opportunity> {
  try {
    const {data:{synopsis}}=detailsSchema.parse(await post(read,"https://api.grants.gov/v1/api/fetchOpportunity",{opportunityId:Number(row.id.slice(3))}));
    const eligibility=cleanText(synopsis.applicantEligibilityDesc,2400);
    const prior=row.contact && eligibility && /\b(?:previously received|prior (?:phase|award)|phase i awardee)\b/i.test(eligibility);
    return {...row,amount:cash(synopsis.awardCeiling),awardFloor:cash(synopsis.awardFloor),programFunding:cash(synopsis.estimatedFunding),eligibility,
      prerequisites:[...new Set([...(row.prerequisites??[]),...(prior ? ["Requires prior NIH SBIR/STTR award"]:[])])],
      description:cleanText(synopsis.synopsisDesc,4500) ?? undefined};
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
export const sources = {
  "Grants.gov":async (at:string,read:Reader=reader()) => {
    const rows=await searchUs(at,read);
    return Promise.all(rows.map((row,i) => i<6 ? enrichUs(row,read) : row));
  },
  "EU Funding & Tenders":async(at:string,read:Reader=reader())=>{
    const [general,eic]=await Promise.allSettled([searchEu(at,read),searchEu(at,read,"EIC Accelerator")]);
    if (general.status==="rejected" && eic.status==="rejected") throw general.reason;
    const rows=[...(general.status==="fulfilled"?general.value:[]),...(eic.status==="fulfilled"?eic.value:[])];
    return [...new Map(rows.filter(o=>o.status!=="Closed").map(o=>[o.id,o])).values()];
  },
  "Innovate UK":async(at:string,read:Reader=reader())=>parseInnovateUk(String(await read(ifs+"/competition/search",{headers:{accept:"text/html"}})),at),
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
