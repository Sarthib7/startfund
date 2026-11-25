import {createHash,createHmac,randomBytes,randomUUID,timingSafeEqual} from "node:crypto";
import {isIP} from "node:net";
import {db} from "./database";
import {plans} from "./plans";

export const dayMs=86_400_000;
const burstMs=60_000;
const burst={scan:3,draft:5,lookup:4,assistant:8,agent:8} as const;
const visitorCookie="startfund-visitor";
type PaidAction=keyof typeof burst;
type Action=PaidAction|"catalog";
type Identity={actor:string;ip:string;plan:keyof typeof plans;cookie?:string};
type Bucket="daily"|"burst"|"network"|"global";
type Decision={allowed:true}|{allowed:false;bucket:Bucket;retryAfter:number};
const digest=(value:string)=>createHash("sha256").update(value).digest();
export const sameSecret=(a:string,b:string)=>timingSafeEqual(digest(a),digest(b));
const mac=(secret:string,value:string)=>createHmac("sha256",secret).update(value).digest("base64url");
let signingKey:Promise<string>|undefined;
function usageSecret(){
 if(process.env.RADAR_USAGE_SECRET)return Promise.resolve(process.env.RADAR_USAGE_SECRET);
 return signingKey??=(async()=>{
  const store=await db();
  await store.run("INSERT OR IGNORE INTO usage_settings VALUES ('signing_key',?)",randomBytes(32).toString("hex"));
  const [row]=await store.all("SELECT value FROM usage_settings WHERE key='signing_key'");
  return String(row.value);
 })().catch(e=>{signingKey=undefined;throw e;});
}
const bearer=(request:Request)=>request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1];
export async function usageIdentity(request:Request,serviceKey?:string):Promise<Identity|null>{
 const supplied=bearer(request);
 if(supplied&&!process.env.RADAR_API_KEYS?.split(",").map(key=>key.trim()).some(key=>key.length>=24&&sameSecret(key,supplied)))return null;
 const secret=await usageSecret();
 const key=serviceKey??supplied;
 const forwarded=process.env.VERCEL==="1"?request.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim():undefined;
 const ip=mac(secret,"ip:"+(forwarded&&isIP(forwarded)?forwarded:"unavailable"));
 if(key)return {actor:"key:"+mac(secret,"key:"+key),ip,plan:"Pro"};
 const value=request.headers.get("cookie")?.match(/(?:^|;\s*)startfund-visitor=([a-f0-9-]{36})\.([\w-]{43})(?:;|$)/);
 if(value&&sameSecret(value[2],mac(secret,"visitor:"+value[1])))return {actor:"visitor:"+value[1],ip,plan:"Free"};
 const id=randomUUID();
 const secure=new URL(request.url).protocol==="https:"?"; Secure":"";
 return {actor:"visitor:"+id,ip,plan:"Free",cookie:`${visitorCookie}=${id}.${mac(secret,"visitor:"+id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7776000${secure}`};
}

function globalCap(){
 const n=Number(process.env.RADAR_GLOBAL_DAILY_LIMIT);
 return Number.isSafeInteger(n)&&n>0?n:1000;
}
const firstOfDay=(now:number)=>Math.floor(now/dayMs)*dayMs;
const actionNames={scan:"scans",draft:"drafts",lookup:"company lookups",assistant:"assistant requests",agent:"agent requests"};
export async function meterUsage(identity:Identity,action:Action,endpoint:string,now=Date.now()):Promise<Decision>{
 const store=await db();
 const {actor,ip,plan}=identity;
 const day=firstOfDay(now);
 if(action==="catalog"){
  await store.run("INSERT INTO usage_events (at,actor,ip,action,endpoint) VALUES (?,?,?,?,?)",now,actor,ip,action,endpoint);
  return {allowed:true};
 }
 const daily=plans[plan][action];
 const networkLimit=daily*2;
 const actorScope=plan==="Free"?"visitor:*":"key:*";
 const minute=Math.floor(now/burstMs)*burstMs;
 const [entry]=await store.all(`INSERT INTO usage_events (at,actor,ip,action,endpoint)
 SELECT ?,?,?,?,?
 WHERE (SELECT count(*) FROM usage_events WHERE actor=? AND action=? AND at>=?)<?
   AND (SELECT count(*) FROM usage_events WHERE ip=? AND action=? AND at>=? AND actor GLOB ?)<?
   AND (SELECT count(*) FROM usage_events WHERE ip=? AND action=? AND at>=?)<?
   AND (SELECT count(*) FROM usage_events WHERE at>=? AND action<>'catalog')<?
 RETURNING id`,now,actor,ip,action,endpoint,actor,action,day,daily,ip,action,day,actorScope,networkLimit,
 ip,action,minute,burst[action],day,globalCap());
 if(entry)return {allowed:true};
 const [counts]=await store.all(`SELECT
 (SELECT count(*) FROM usage_events WHERE actor=? AND action=? AND at>=?) AS actor,
 (SELECT count(*) FROM usage_events WHERE ip=? AND action=? AND at>=? AND actor GLOB ?) AS network,
 (SELECT count(*) FROM usage_events WHERE at>=? AND action<>'catalog') AS global`,
 actor,action,day,ip,action,day,actorScope,day);
 const bucket:Bucket=Number(counts.actor)>=daily?"daily":Number(counts.global)>=globalCap()?"global":
  Number(counts.network)>=networkLimit?"network":"burst";
 await store.run(`INSERT INTO usage_limit_hits VALUES (?,?,1)
 ON CONFLICT(day,endpoint) DO UPDATE SET hits=hits+1`,day,endpoint);
 return {allowed:false,bucket,retryAfter:Math.max(1,Math.ceil(((bucket==="burst"?minute+burstMs:day+dayMs)-now)/1000))};
}

export function usageError(action:PaidAction,plan:keyof typeof plans,decision:Extract<Decision,{allowed:false}>){
 const {bucket,retryAfter}=decision;
 const wait=bucket==="burst"?`${retryAfter} s`:`${Math.ceil(retryAfter/3600)} h`;
 const error=bucket==="daily"?`You’ve used today’s ${plan==="Free"?"free ":""}${actionNames[action]} — try again in ${wait}.`:
  bucket==="burst"?`Too many requests at once — try again in ${wait}.`:`Startfund has reached a shared usage limit — try again in ${wait}.`;
 return Response.json({error,pricing:plan==="Free"?"/pricing":undefined},{
  status:429,headers:{"Retry-After":String(retryAfter),"Cache-Control":"no-store"},
 });
}

export async function withUsage(request:Request,action:Action,endpoint:string,handler:(identity:Identity)=>Promise<Response>){
 const identity=await usageIdentity(request);
 if(!identity)return Response.json({error:"Invalid API key."},{status:401});
 const decision=await meterUsage(identity,action,request.headers.get("x-startfund-client")==="mcp"?"mcp:"+endpoint:endpoint);
 const response=!decision.allowed&&action!=="catalog"?usageError(action,identity.plan,decision):await handler(identity);
 if(identity.cookie)response.headers.append("Set-Cookie",identity.cookie);
 return response;
}

export async function usageReport(now=Date.now()){
 const store=await db(), from=firstOfDay(now)-6*dayMs;
 const [days,endpoints,hits]=await Promise.all([
  store.all("SELECT at-at%? AS day,count(*) AS runs FROM usage_events WHERE at>=? GROUP BY day ORDER BY day DESC",dayMs,from),
  store.all("SELECT endpoint,count(*) AS runs FROM usage_events WHERE at>=? GROUP BY endpoint ORDER BY runs DESC,endpoint",from),
  store.all("SELECT endpoint,sum(hits) AS hits FROM usage_limit_hits WHERE day>=? GROUP BY endpoint ORDER BY hits DESC,endpoint",from),
 ]);
 return {days,endpoints,hits};
}
