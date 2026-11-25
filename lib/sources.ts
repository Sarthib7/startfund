import { z } from "zod";
import type { Opportunity } from "./domain";
import { corporateProgramRows } from "./facts";
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
const usRow = z.object({id: z.string().regex(/^\d+$/), title: str, closeDate: z.string().optional()});
const detailsSchema = z.object({ data: z.object({ synopsis: z.object({ awardCeiling: z.unknown(), applicantEligibilityDesc: z.string().nullish() }) }) });
export function parseUs(raw: unknown, fetchedAt: string): Opportunity[] {
  const items = z.object({errorcode: z.literal(0), data:z.object({oppHits:z.array(z.unknown())})}).parse(raw);
  return items.data.oppHits.flatMap(rawRow => {
    const {data:r} = usRow.safeParse(rawRow);
    return r ? [{id:`us-${r.id}`, title:r.title, kind:"Grant", region:"US", source:"Grants.gov", url:`https://www.grants.gov/search-results-detail/${r.id}`, deadline:date(r.closeDate), amount:null,currency:"USD",eligibility:null,fetchedAt}] : [];
  });
}
const euRow = z.object({reference:str,url:str,metadata:z.object({title:z.array(str).min(1), deadlineDate:z.array(z.string()).optional(), status:z.array(z.string()), identifier:z.array(z.string()).optional()})});
export function parseEu(raw:unknown,fetchedAt:string):Opportunity[] {
  const {results} = z.object({results:z.array(z.unknown())}).parse(raw);
  return results.flatMap(x => {
    const {data:r} = euRow.safeParse(x);
    if (!r || /\bcancell?ed\b/i.test(r.metadata.title[0]) || !r.metadata.status.some(s => s === "31094501" || s === "31094502")) return [];
    const url = safeUrl(r.url);
    if (!url || new URL(url).hostname !== "ec.europa.eu") return [];
    const deadlines = (r.metadata.deadlineDate ?? []).map(date).filter(d => d !== null).sort();
    const deadline = deadlines.find(d => d >= fetchedAt.slice(0,10)) ?? deadlines.at(-1) ?? null;
    const identifier = r.metadata.identifier?.[0];
    const listing = identifier && /^[A-Z0-9-]+$/i.test(identifier) ? `https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/${identifier}` : url;
    return [{id:`eu-${identifier || r.reference}`,title:r.metadata.title[0],kind:"Grant",region:"EU",source:"EU Funding & Tenders",url:listing,deadline,amount:null,currency:"EUR",eligibility:null,fetchedAt}];
  });
}
const hnRow = z.object({objectID:z.string().regex(/^\d+$/),title:str,url:z.string().nullable().optional()});
export function parseHn(raw:unknown,fetchedAt:string,kind:"VC"|"Growth"):Opportunity[] {
  return z.object({hits:z.array(z.unknown())}).parse(raw).hits.flatMap(x => {
    const {data:r}=hnRow.safeParse(x);
    return r ? [{id:`hn-${r.objectID}`, title:r.title,kind,region:"Global",source:"Hacker News",url:r.url && safeUrl(r.url) || `https://news.ycombinator.com/item?id=${r.objectID}`,deadline:null,amount:null,currency:"USD",eligibility:null,fetchedAt,signal:true}] : [];
  });
}
export const sources = {
  "Grants.gov":async (at:string, read:Reader=reader()) => {
    const rows=parseUs(await post(read,"https://api.grants.gov/v1/api/search2",{rows:18,keyword:"small business",oppStatuses:"posted",eligibilities:"23"}),at);
    return Promise.all(rows.map(async (r,i) => {
      if (i>=6) return r;
      try {
        const {data:{synopsis}}=detailsSchema.parse(await post(read,"https://api.grants.gov/v1/api/fetchOpportunity",{opportunityId:Number(r.id.slice(3))}));
        return {...r,amount:cash(synopsis.awardCeiling),eligibility:synopsis.applicantEligibilityDesc?.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,520)||null};
      } catch {return r;}
    }));
  },
  "EU Funding & Tenders":async(at:string,read:Reader=reader())=>{
    const params=new URLSearchParams({apiKey:"SEDIA",text:"startup",pageSize:"30"});
    const form=new FormData();
    form.set("query",new Blob([JSON.stringify({bool:{must:[{terms:{type:["1","2","8"]}},{terms:{status:["31094501","31094502"]}},{terms:{language:["en"]}}]}})],{type:"application/json"}));
    form.set("sort",new Blob([JSON.stringify({field:"deadlineDate",order:"DESC"})],{type:"application/json"}));
    const items = parseEu(await read("https://api.tech.ec.europa.eu/search-api/prod/rest/search?"+params,{method:"POST",body:form}),at);
    return [...new Map(items.map(item=>[item.id,item])).values()];
  },
  "Hacker News":async(at:string,read:Reader=reader())=>{
    const base="https://hn.algolia.com/api/v1/search_by_date?";
    const requests=[["startup venture funding","VC"],["startup launch","Growth"]] as const;
    const outputs=await Promise.all(requests.map(async ([query,kind])=>parseHn(await read(base+new URLSearchParams({query,tags:"story",hitsPerPage:"7",numericFilters:`created_at_i>${Math.floor(Date.parse(at)/1000)-30*86400}`})),at,kind)));
    return [...new Map(outputs.flat().map(o=>[o.id,o])).values()];
  },
  "Accelerator directory":async(at:string):Promise<Opportunity[]>=> [
    {id:"yc",title:"Y Combinator",url:"https://www.ycombinator.com/apply", eligibility:"Official application page; confirm batch dates and eligibility. Early-stage founders."},
    {id:"ts",title:"Techstars Accelerators",url:"https://www.techstars.com/accelerators",eligibility:"Official program directory; confirm each program’s dates and eligibility. Early-stage founders."},
  ].map((o):Opportunity=>({...o,kind:"Accelerator",region:"Global",source:"Accelerator directory",deadline:null,amount:null,currency:"USD",fetchedAt:at,programId:o.id})).concat(corporateProgramRows(at)),
};
export type Source = keyof typeof sources;
