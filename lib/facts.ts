import { z } from "zod";
import type { Reader } from "./transport";
import type { Opportunity } from "./domain";

export type Fact = {
 id:string; entityId:string; entity:string; entityType:"Investor"|"Program"; title:string;
 kind:"Award"|"Committed project contribution"|"Batch observed"|"Regulatory filing"|"Program terms";
 source:string; url:string; amount:number|null; currency:"USD"|"EUR"|"GBP"|null; observed:string|null; fetchedAt:string; rights:string;
};
export const rights:Record<string,string>={
 "Grants.gov":"Official federal source; opportunity metadata and links. Check any third-party attachments at source.",
 "EU Funding & Tenders":"European Commission reuse notice; subject to exceptions and third-party rights.",
 "Hacker News":"Public Algolia API; link and factual title only; no article text.",
 "Accelerator directory":"Curated official links and independently phrased descriptions; no provider page copy.",
 "NSF Awards":"Official federal award facts; no contact information or abstracts displayed.",
 "CORDIS":"European Commission reuse notice; project facts only, no third-party media.",
 "UKRI GtR":"Public research-funding facts with attribution; no investigator data displayed.",
 "Innovate UK":"From Innovate UK’s public Innovation Funding Service; factual competition metadata under the Open Government Licence, with links to original notices.",
 "TED":"EU Publications Office TED Search API; published procurement facts and links to original notices.",
 "Förderdatenbank":"German federal funding database; factual program metadata and official source links.",
 "UK Find a Grant":"UK Government Find a Grant service; listing metadata and official source links.",
 "Government program links":"Curated links to the official government publisher; confirm terms and availability on the linked page.",
 "Official program links":"Curated official links and factual program summaries; check terms and availability at the source.",
 "YC batches":"Third-party public index; derived batch and count only, no company records redistributed.",
 "SEC EDGAR":"Public SEC filings; link and factual issuer name only, no individual contacts.",
};
const s=z.string().min(1);
const money=(v:unknown)=>{
 const n=typeof v==="number"||typeof v==="string" ? Number(String(v).replace(/,/g,"")) : NaN;
 return Number.isFinite(n)&&n>0 ? n : null;
};
const at=(v:unknown)=>typeof v==="number" ? new Date(v).toISOString().slice(0,10) : typeof v==="string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString().slice(0,10) : null;

export function nsfFacts(input:unknown,fetchedAt:string):Fact[]{
 const {response} = z.object({response:z.object({award:z.array(z.object({id:s.regex(/^\d+$/),title:s, fundsObligatedAmt:z.unknown(),date:z.unknown()})).optional()})}).parse(input);
 return (response.award??[]).map(r=>{const seed=/\b(?:SBIR|STTR)\b/.test(r.title);return {id:`nsf-${r.id}`,entityId:seed?"nsf-sbir":"nsf-research",entity:seed?"NSF SBIR / STTR":"NSF research awards",entityType:"Program",title:r.title,kind:"Award",source:"NSF Awards",url:`https://www.nsf.gov/awardsearch/showAward?AWD_ID=${r.id}`,amount:money(r.fundsObligatedAmt),currency:"USD",observed:at(r.date),fetchedAt,rights:rights["NSF Awards"]};});
}
export function cordisFacts(input:unknown,fetchedAt:string):Fact[]{
 const {hits}=z.object({hits:z.object({hit:z.array(z.object({project:z.object({id:s.regex(/^\d+$/),title:s,ecMaxContribution:z.unknown(),startDate:z.unknown()})})).optional()}).optional()}).parse(input);
 return (hits?.hit??[]).map(({project:r})=>({id:`cordis-${r.id}`,entityId:"eu-research",entity:"EU research & innovation funding",entityType:"Program",title:r.title,kind:"Committed project contribution",source:"CORDIS",url:`https://cordis.europa.eu/project/id/${r.id}`,amount:money(r.ecMaxContribution),currency:"EUR",observed:at(r.startDate),fetchedAt,rights:rights.CORDIS}));
}
const fundSchema=z.object({id:s,valuePounds:z.object({currencyCode:z.literal("GBP"),amount:z.unknown()}).nullish(),start:z.unknown()});
export function ukriFact(input:unknown,project:{id:string;title:string},fetchedAt:string):Fact{
 const r=fundSchema.parse(input);
 return {id:`ukri-${r.id}`,entityId:"ukri-innovation",entity:"UKRI innovation research",entityType:"Program",title:project.title,kind:"Award",source:"UKRI GtR",url:`https://gtr.ukri.org/projects?ref=${encodeURIComponent(project.id)}`,amount:money(r.valuePounds?.amount),currency:"GBP",observed:at(r.start),fetchedAt,rights:rights["UKRI GtR"]};
}
export function ycFacts(input:unknown,fetchedAt:string):Fact[]{
 const rows=z.array(z.object({batch:z.string().nullish()})).parse(input);
 const counts=new Map<string,number>();
 for(const {batch} of rows){
  if(!batch || !/^(Spring|Fall|Winter|Summer) (20\d{2})$/.test(batch))continue;
  counts.set(batch,(counts.get(batch)??0)+1);
 }
 const months:Record<string,string>={Winter:"01",Spring:"04",Summer:"07",Fall:"10"};
 return [...counts.entries()].map(([batch,count]):Fact=>{
  const [season,year]=batch.split(" ");
  return {id:`yc-${season}-${year}`,entityId:"yc",entity:"Y Combinator",entityType:"Program",title:`${batch} · ${count} directory listings`,kind:"Batch observed",source:"YC batches",url:"https://www.ycombinator.com/companies",amount:null,currency:null,observed:`${year}-${months[season]}-01`,fetchedAt,rights:rights["YC batches"]};
 }).filter(f=>f.observed!<=fetchedAt.slice(0,10)).sort((a,b)=>b.observed!.localeCompare(a.observed!)).slice(0,12);
}
const secRow=z.object({_source:z.object({ciks:z.array(s).min(1),display_names:z.array(s).min(1),file_date:s,adsh:s})});
export function secFacts(input:unknown,fetchedAt:string):Fact[]{
 const {hits}=z.object({hits:z.object({hits:z.array(z.unknown())})}).parse(input);
 return hits.hits.flatMap(raw=>{
  const {data:row}=secRow.safeParse(raw);if(!row)return [];
  const r=row._source,cik=r.ciks[0],key=r.adsh.replaceAll("-","");
  const name=r.display_names[0].replace(/\s+\(CIK \d+\)$/,"").trim();
  if(!/^\d{10}$/.test(cik)||!/^\d{18}$/.test(key)||!name)return [];
  return [{id:`sec-${r.adsh}`,entityId:`sec-${cik}`,entity:name,entityType:"Investor",title:"Form D pooled investment fund notice",kind:"Regulatory filing",source:"SEC EDGAR",url:`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${key}/${r.adsh}-index.htm`,amount:null,currency:null,observed:at(r.file_date),fetchedAt,rights:rights["SEC EDGAR"]}];
 });
}
export const corporate:readonly {id:string;name:string;url:string;terms:string}[]=[
 {id:"aws",name:"AWS Activate",url:"https://aws.amazon.com/startups/credits/",terms:"Cloud credits for eligible startups; self-funded startups can apply for up to $5,000 and Activate Portfolio startups for up to $200,000. Credits are not cash."},
 {id:"google",name:"Google for Startups Cloud Program",url:"https://cloud.google.com/startup",terms:"Cloud credits and technical support; official tiers range from $2,000 for early startups to $200,000, or $350,000 for qualifying AI startups. Credits are not cash."},
 {id:"microsoft",name:"Microsoft for Startups",url:"https://www.microsoft.com/en-us/startups",terms:"Azure credits and startup support; qualifying startups can unlock up to $150,000 in credits over time. Credits are not cash."},
 {id:"nvidia",name:"NVIDIA Inception",url:"https://www.nvidia.com/en-us/startups/",terms:"Free rolling startup program with technical support, preferred pricing, and partner cloud-credit offers; not a cash grant."}
];
export function corporateProgramRows(fetchedAt:string):Opportunity[]{
 return corporate.map(r=>({id:r.id,title:r.name,kind:"Perks",region:"Global",source:"Accelerator directory",url:r.url,deadline:null,amount:null,currency:"USD",eligibility:r.terms,status:"Rolling",openSourceEligibility:"startup-dependent",verifiedAt:"2026-11-27",fetchedAt,programId:r.id}));
}

export async function searchNsf(read:Reader,t:string,keyword="SBIR"){
 return nsfFacts(await read("https://api.nsf.gov/services/v1/awards.json?"+new URLSearchParams({keyword,rpp:keyword==="SBIR"?"12":"20"})),t);
}
export async function searchCordis(read:Reader,t:string,keyword="European Innovation Council"){
 return cordisFacts(await read("https://cordis.europa.eu/search/en?"+new URLSearchParams({q:`contenttype='project' AND '${keyword}'`,p:"1",num:"10",format:"json"})),t);
}
export async function searchUkri(read:Reader,t:string,keyword="innovation"){
  const projects=z.object({project:z.array(z.object({id:s,title:s,links:z.object({link:z.array(z.object({rel:s,href:s}))})})).optional()})
   .parse(await read("https://gtr.ukri.org/gtr/api/projects?"+new URLSearchParams({q:keyword,s:"10"}))).project ?? [];
  const results=await Promise.allSettled(projects.slice(0,6).flatMap(p=>{
   const path=p.links.link.find(l=>l.rel==="FUND")?.href.match(/^https?:\/\/gtr\.ukri\.org\/gtr\/api\/funds\/([0-9A-F-]{36})$/i)?.[1];
   return path ? [read(`https://gtr.ukri.org/gtr/api/funds/${path}`).then(raw=>ukriFact(raw,p,t))] : [];
  }));
  if(results.length && results.every(r=>r.status==="rejected"))throw new Error("No UKRI detail requests succeeded");
  return results.flatMap(r=>r.status==="fulfilled"?[r.value]:[]);
}
export const factSources={
 "NSF Awards":searchNsf,
 "CORDIS":searchCordis,
 "UKRI GtR":searchUkri,
 "YC batches":async (read:Reader,t:string)=>ycFacts(await read("https://yc-oss.github.io/api/companies/all.json"),t),
 "SEC EDGAR":async (read:Reader,t:string)=>{
  const from=new Date(Date.parse(t)-30*86400000).toISOString().slice(0,10);
  return secFacts(await read("https://efts.sec.gov/LATEST/search-index?"+new URLSearchParams({forms:"D",dateRange:"custom",startdt:from,enddt:t.slice(0,10),q:'"Venture Capital Fund"',from:"0",size:"15"})),t);
 },
 "Accelerator directory":async (_read:Reader,t:string):Promise<Fact[]>=>corporate.map(r=>({id:r.id+"-terms",entityId:r.id,entity:r.name,entityType:"Program",title:r.terms,kind:"Program terms",source:"Accelerator directory",url:r.url,amount:null,currency:null,observed:null,fetchedAt:t,rights:rights["Accelerator directory"]})),
};
export type FactSource=keyof typeof factSources;
