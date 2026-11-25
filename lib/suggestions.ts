import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "./database";
import type { Opportunity } from "./domain";

export const communitySource="Community-submitted · reviewed";
export const suggestionSchema=z.object({
 type:z.enum(["Accelerator","VC","Grant","Other"]),
 name:z.string().trim().min(1).max(120),
 url:z.string().max(500).pipe(z.url({protocol:/^https$/,hostname:z.regexes.domain})).refine(value=>{
  const url=new URL(value);
  return !url.username&&!url.password;
 },"Use an official HTTPS URL without credentials."),
 region:z.enum(["Global","US","EU","DE","UK"]),
 deadline:z.union([z.iso.date(),z.literal("")]),
 amount:z.number().positive().max(1_000_000_000_000).nullable(),
 currency:z.enum(["USD","EUR","GBP","INR","AUD","SGD"]),
 description:z.string().trim().min(1).max(600),
 email:z.union([z.email().max(254),z.literal("")]).optional(),
});

type Suggestion=z.infer<typeof suggestionSchema>;
export async function submitSuggestion(input:Suggestion){
 await (await db()).run("INSERT INTO opportunity_suggestions(id,status,created,data) VALUES (?,'pending',?,?)",
  randomUUID(),new Date().toISOString(),JSON.stringify(input));
}

export async function pendingSuggestions(){
 const rows=await (await db()).all("SELECT id,data FROM opportunity_suggestions WHERE status='pending' ORDER BY created,id LIMIT 50");
 return rows.map(row=>({id:String(row.id),...JSON.parse(String(row.data)) as Suggestion}));
}

export async function reviewSuggestion(id:string,decision:"approved"|"rejected"){
 return (await (await db()).run("UPDATE opportunity_suggestions SET status=?,reviewed=? WHERE id=? AND status='pending'",
  decision,new Date().toISOString(),id))>0;
}

export async function approvedOpportunities():Promise<Opportunity[]>{
 const rows=await (await db()).all("SELECT id,reviewed,data FROM opportunity_suggestions WHERE status='approved' ORDER BY created,id");
 return rows.map(row=>{
  const {name,type,url,region,deadline,amount,currency,description}=JSON.parse(String(row.data)) as Suggestion;
  return {id:"community-"+row.id,title:name,source:communitySource,url,kind:type==="Other"?"Growth":type,region,
   deadline:deadline||null,status:deadline?"Open":"Program link",amount,currency,description,eligibility:null,fetchedAt:String(row.reviewed)};
 });
}

export async function communityRevision(){
 const [row]=await (await db()).all("SELECT count(*) AS n FROM opportunity_suggestions WHERE status='approved'");
 return Number(row.n);
}
