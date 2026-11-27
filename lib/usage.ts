import {createHash,createHmac,randomBytes,randomUUID,timingSafeEqual} from "node:crypto";
import {isIP} from "node:net";
import {billingAccount,billingConfig,currentProKeyHash,proKeyHash,visitorForProKey} from "./billing-state";
import {db} from "./database";
import {plans} from "./plans";

export const dayMs=86_400_000;
const burstMs=60_000;
const burst={scan:3,draft:5,lookup:4,assistant:8,agent:8,agent_updates:8,catalog:30,share:3,submission:2,checkout:3,auth:3} as const;
const visitorCookie="startfund-visitor";
type Action=keyof typeof burst;
type Identity={actor:string;ip:string;plan:keyof typeof plans;cookie?:string};
type Bucket="daily"|"burst"|"network"|"global";
type Decision={allowed:true}|{allowed:false;bucket:Bucket;retryAfter:number};
const digest=(value:string)=>createHash("sha256").update(value).digest();
export const sameSecret=(a:string,b:string)=>timingSafeEqual(digest(a),digest(b));
const mac=(secret:string,value:string)=>createHmac("sha256",secret).update(value).digest("base64url");
let signingKey:Promise<string>|undefined;
export function usageSecret(){
 if(process.env.RADAR_USAGE_SECRET)return Promise.resolve(process.env.RADAR_USAGE_SECRET);
 return signingKey??=(async()=>{
  const store=await db();
  await store.run("INSERT OR IGNORE INTO usage_settings VALUES ('signing_key',?)",randomBytes(32).toString("hex"));
  const [row]=await store.all("SELECT value FROM usage_settings WHERE key='signing_key'");
  return String(row.value);
 })().catch(e=>{signingKey=undefined;throw e;});
}
const bearer=(request:Request)=>request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1];
const visitorMatch=(cookies:string|null)=>cookies?.match(/(?:^|;\s*)startfund-visitor=([a-f0-9-]{36})\.([\w-]{43})(?:\.r\.([a-f0-9-]{36}))?(?:;|$)/);
const ownerSignature=(secret:string,id:string)=>mac(secret,"visitor:"+id);
const restoredSignature=(secret:string,id:string,keyHash:string,nonce:string)=>mac(secret,"restored-visitor:"+id+":"+keyHash+":"+nonce);
function signedVisitorCookie(request:Request,value:string){
 const secure=new URL(request.url).protocol==="https:"?"; Secure":"";
 return `${visitorCookie}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7776000${secure}`;
}
export async function ownerVisitorCookie(request:Request,id:string){
 return signedVisitorCookie(request,`${id}.${ownerSignature(await usageSecret(),id)}`);
}
export function checkoutBrowserProof(cookies:string|null){
 const value=visitorMatch(cookies);
 return value?digest(value[2]).toString("hex"):null;
}
export async function restoreVisitorCookie(request:Request,id:string,key:string){
 const nonce=randomUUID();
 return signedVisitorCookie(request,`${id}.${restoredSignature(await usageSecret(),id,proKeyHash(key),nonce)}.r.${nonce}`);
}
async function readVisitor(request:Request,secret:string){
 const value=visitorMatch(request.headers.get("cookie"));
 if(value){
  const [,id,signature,nonce]=value;
  if(!nonce&&sameSecret(signature,ownerSignature(secret,id)))return {id,restored:false};
  if(nonce){
   const keyHash=await currentProKeyHash(id);
   if(keyHash&&sameSecret(signature,restoredSignature(secret,id,keyHash,nonce)))return {id,restored:true};
  }
 }
 const id=randomUUID();
 return {id,cookie:signedVisitorCookie(request,`${id}.${ownerSignature(secret,id)}`),restored:false};
}
export async function browserVisitor(request:Request){
 return readVisitor(request,await usageSecret());
}
export async function usageIdentity(request:Request,serviceKey?:string):Promise<Identity|null>{
 const supplied=bearer(request);
 const configured=supplied&&process.env.RADAR_API_KEYS?.split(",").map(key=>key.trim()).some(key=>key.length>=24&&sameSecret(key,supplied));
 const stripeEnabled=Boolean(billingConfig());
 const paidVisitor=supplied&&!configured&&stripeEnabled?await visitorForProKey(supplied):null;
 if(supplied&&!configured&&!paidVisitor)return null;
 const secret=await usageSecret();
 const forwarded=process.env.VERCEL==="1"?request.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim():undefined;
 const ip=mac(secret,"ip:"+(forwarded&&isIP(forwarded)?forwarded:"unavailable"));
 if(paidVisitor&&!serviceKey)return {actor:"visitor:"+paidVisitor,ip,plan:"Pro"};
 const key=serviceKey??supplied;
 if(key)return {actor:"key:"+mac(secret,"key:"+key),ip,plan:"Pro"};
 const {id,cookie}=await readVisitor(request,secret);
 const pro=stripeEnabled&&!cookie&&(await billingAccount(id))?.pro;
 return {actor:"visitor:"+id,ip,plan:pro?"Pro":"Free",...(cookie?{cookie}:{})};
}

function globalCap(){
 const n=Number(process.env.RADAR_GLOBAL_DAILY_LIMIT);
 return Number.isSafeInteger(n)&&n>0?n:1000;
}
const firstOfDay=(now:number)=>Math.floor(now/dayMs)*dayMs;
const actionNames={scan:"scans",draft:"drafts",lookup:"company lookups",assistant:"assistant requests",agent:"agent requests",agent_updates:"agent update requests",catalog:"catalog requests",share:"share links",submission:"submissions",checkout:"checkout attempts",auth:"login attempts"};
let pruning:{day:number;task:Promise<void>}|undefined;
function pruneUsage(day:number,store:Awaited<ReturnType<typeof db>>){
 if(pruning&&pruning.day>=day)return pruning.task;
 const task=(async()=>{
  const cutoff=day-35*dayMs;
  const [legacy]=await store.all("SELECT name FROM sqlite_schema WHERE type='table' AND name='usage_events'");
  await store.batch([
   ...["usage_daily","usage_network","usage_totals","usage_limit_hits"].map(table=>({sql:`DELETE FROM ${table} WHERE day<?`,args:[cutoff]})),
   {sql:"DELETE FROM usage_bursts WHERE minute<?",args:[day]},
   ...(legacy?[{sql:"DELETE FROM usage_events WHERE at<?",args:[cutoff]}]:[]),
  ]);
 })().catch(e=>{if(pruning?.task===task)pruning=undefined;throw e;});
 pruning={day,task};
 return task;
}
export async function meterUsage(identity:Identity,action:Action,endpoint:string,now=Date.now()):Promise<Decision>{
 const store=await db();
 const {ip,plan}=identity;
 const actor=action==="catalog"&&identity.cookie?"network:"+ip:identity.actor;
 const day=firstOfDay(now);
 await pruneUsage(day,store);
 const daily=action==="catalog"?0:plans[plan][action];
 const networkLimit=daily*2;
 const minute=Math.floor(now/burstMs)*burstMs;
 const [entry]=await store.all(`INSERT INTO usage_daily (day,actor,action,endpoint,runs,ip,minute,plan)
 SELECT ?,?,?,?,1,?,?,?
 WHERE coalesce((SELECT runs FROM usage_bursts WHERE minute=? AND ip=? AND action=?),0)<?
   AND (?='catalog' OR (
    (SELECT coalesce(sum(runs),0) FROM usage_daily WHERE day=? AND actor=? AND action=?)<?
    AND coalesce((SELECT runs FROM usage_network WHERE day=? AND ip=? AND action=? AND plan=?),0)<?
    AND coalesce((SELECT runs FROM usage_totals WHERE day=?),0)<?
   ))
 ON CONFLICT(day,actor,action,endpoint) DO UPDATE
  SET runs=usage_daily.runs+1,ip=excluded.ip,minute=excluded.minute,plan=excluded.plan
 RETURNING runs`,day,actor,action,endpoint,ip,minute,plan,minute,ip,action,burst[action],
 action,day,actor,action,daily,day,ip,action,plan,networkLimit,day,globalCap());
 if(entry)return {allowed:true};
 let bucket:Bucket="burst";
 if(action!=="catalog"){
  const [counts]=await store.all(`SELECT
   (SELECT coalesce(sum(runs),0) FROM usage_daily WHERE day=? AND actor=? AND action=?) AS actor,
   (SELECT runs FROM usage_network WHERE day=? AND ip=? AND action=? AND plan=?) AS network,
   (SELECT runs FROM usage_totals WHERE day=?) AS global`,day,actor,action,day,ip,action,plan,day);
  bucket=Number(counts.actor)>=daily?"daily":Number(counts.global)>=globalCap()?"global":
   Number(counts.network)>=networkLimit?"network":"burst";
 }
 await store.run(`INSERT INTO usage_limit_hits VALUES (?,?,1)
 ON CONFLICT(day,endpoint) DO UPDATE SET hits=hits+1`,day,endpoint);
 return {allowed:false,bucket,retryAfter:Math.max(1,Math.ceil(((bucket==="burst"?minute+burstMs:day+dayMs)-now)/1000))};
}

export function usageError(action:Action,plan:keyof typeof plans,decision:Extract<Decision,{allowed:false}>){
 const {bucket,retryAfter}=decision;
 const wait=bucket==="burst"?`${retryAfter} s`:`${Math.ceil(retryAfter/3600)} h`;
 const error=bucket==="daily"?`You’ve used today’s ${plan==="Free"?"free ":""}${actionNames[action]} — try again in ${wait}.`:
  bucket==="burst"?`Too many requests at once — try again in ${wait}.`:`Startfund has reached a shared usage limit — try again in ${wait}.`;
 return Response.json({error,pricing:plan==="Free"?"/pricing":undefined},{
  status:429,headers:{"Retry-After":String(retryAfter),"Cache-Control":"no-store"},
 });
}

export async function withUsage(request:Request,action:Action,endpoint:string,handler:(identity:Identity)=>Promise<Response>,options:{proOnly?:boolean}={}){
 const identity=await usageIdentity(request);
 if(!identity)return Response.json({error:"Invalid API key."},{status:401});
 if(options.proOnly&&identity.plan!=="Pro")return Response.json({error:"Pro API access required."},{status:403});
 const decision=await meterUsage(identity,action,request.headers.get("x-startfund-client")==="mcp"?"mcp:"+endpoint:endpoint);
 const response=!decision.allowed?usageError(action,identity.plan,decision):await handler(identity);
 if(identity.cookie)response.headers.append("Set-Cookie",identity.cookie);
 return response;
}

export async function usageReport(now=Date.now()){
 const store=await db(), from=firstOfDay(now)-6*dayMs;
 const [days,endpoints,hits]=await Promise.all([
  store.all("SELECT day,sum(runs) AS runs FROM usage_daily WHERE day>=? GROUP BY day ORDER BY day DESC",from),
  store.all("SELECT endpoint,sum(runs) AS runs FROM usage_daily WHERE day>=? GROUP BY endpoint ORDER BY runs DESC,endpoint",from),
  store.all("SELECT endpoint,sum(hits) AS hits FROM usage_limit_hits WHERE day>=? GROUP BY endpoint ORDER BY hits DESC,endpoint",from),
 ]);
 return {days,endpoints,hits};
}
