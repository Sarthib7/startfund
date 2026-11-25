import { Client } from "eve/client";
import { cookies } from "next/headers";
import { z } from "zod";
import { demo, template, type Match, type Profile } from "../../../lib/domain";
import { radar, saved } from "../../../lib/store";
const schema=z.object({why:z.string().min(1).max(700),subject:z.string().min(1).max(160),body:z.string().min(1).max(2000)});
type Draft=z.infer<typeof schema>&{mode:string};
const memo=new Map<string,{expires:number;draft:Draft}>();
const clientRuns=new Map<string,number>();
let active=0;
let windowStart=0;
let runs=0;
const configured=()=>{
 const provider=process.env.RADAR_MODEL_PROVIDER;
 return provider==="gemini" ? Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY) : provider==="groq" ? Boolean(process.env.GROQ_API_KEY) :
 provider==="gateway" && Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
};
async function generate(p:Profile,m:Match,clientId:string|null):Promise<Draft>{
 const secret=process.env.RADAR_AGENT_SECRET;
 if(!secret||!configured()||!clientId) return template(p,m);
 const {email:_email,...profile}=p;
 const key=JSON.stringify([profile,m]);
 const old=memo.get(key);
 if(old && old.expires>Date.now()) return old.draft;
 if(Date.now()-windowStart>3600000){windowStart=Date.now();runs=0;clientRuns.clear();}
 const used=clientRuns.get(clientId)??0;
 if(active>=2||runs>=10||used>=2) return {...template(p,m),mode:"Template · agent busy"};
 clientRuns.set(clientId,used+1);
 active++;runs++;
 try{
  const client=new Client({baseUrl:process.env.RADAR_EVE_URL || "http://127.0.0.1:3100",auth:{basic:{username:"radar",password:secret}}});
  const signal=AbortSignal.timeout(25000);
  const {delivery}=await client.sessions.create({message:JSON.stringify({profile,opportunity:m}),outputSchema:schema,signal});
  const result=await delivery.result({signal});
  const data=schema.safeParse(result.data);
  if(result.status!=="completed" || !data.success) return {...template(p,m),mode:"Template · agent unavailable"};
  const draft={...data.data,mode:"eve agent"};
  if(memo.size>=100) memo.delete(memo.keys().next().value!);
  memo.set(key,{draft,expires:Date.now()+3600000});
  return draft;
 }catch{return {...template(p,m),mode:"Template · agent unavailable"};}
 finally{active--;}
}
export async function POST(request:Request){
 if(request.headers.get("sec-fetch-site")==="cross-site" || !request.headers.get("content-type")?.startsWith("application/json")) return Response.json({error:"Invalid request"},{status:403});
 const input=z.object({id:z.string().min(1).max(160)}).safeParse(await request.json().catch(()=>null));
 if(!input.success) return Response.json({error:"Invalid listing"},{status:400});
 const id=(await cookies()).get("startfund-profile")?.value;
 const record=id ? await saved(id) : null;
 const profile=record?.profile ?? demo;
 const snapshot=record?.digest?.evidence ? record.digest : await radar(profile);
 const match=snapshot.matches.find(m=>m.id===input.data.id);
 if(!match) return Response.json({error:"Listing not found. Scan again."},{status:404});
 const clientId=record && id ? process.env.VERCEL==="1" ? request.headers.get("x-vercel-forwarded-for") ?? id : id : null;
 return Response.json(await generate(profile,match,clientId));
}
