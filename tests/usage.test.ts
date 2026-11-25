import test from "node:test";
import assert from "node:assert/strict";
import { routeAuth } from "eve/channels/auth";
import { meteredAgentAuth } from "../agent/channels/eve";
import { db } from "../lib/database";
import { dayMs, meterUsage, usageIdentity, usageReport, withUsage } from "../lib/usage";
import { completedRadar } from "../lib/store";
import { demo } from "../lib/domain";
import { outbound } from "../lib/outbound";
import { stripeCheckoutConfig } from "../lib/checkout";

process.env.RADAR_DB_PATH=":memory:";
const start=Date.UTC(2026,10,25,11);
const anonymous={actor:"visitor:one",ip:"hash-1",plan:"Free"} as const;

test("atomic metering applies burst, free quota, global cap and UTC reset", async t=>{
 t.mock.method(Date,"now",()=>start);
 const outcomes=await Promise.all(Array.from({length:5},()=>meterUsage(anonymous,"scan","scan")));
 assert.equal(outcomes.filter(x=>x.allowed).length,3);
 assert.deepEqual(outcomes.filter(x=>!x.allowed),[
  {allowed:false,bucket:"burst",retryAfter:60},{allowed:false,bucket:"burst",retryAfter:60},
 ]);
 for(let i=0;i<2;i++)assert.equal((await meterUsage(anonymous,"scan","scan",start+60_000)).allowed,true);
 const limited=await meterUsage(anonymous,"scan","scan",start+60_000);
 assert.deepEqual(limited,{allowed:false,bucket:"daily",retryAfter:46_740});
 for(let i=0;i<3;i++)assert.equal((await meterUsage(anonymous,"draft","draft",start)).allowed,true);
 assert.equal((await meterUsage(anonymous,"draft","draft",start)).allowed,false);
 assert.equal((await meterUsage(anonymous,"scan","scan",start+dayMs)).allowed,true);
 const previous=process.env.RADAR_GLOBAL_DAILY_LIMIT;
 process.env.RADAR_GLOBAL_DAILY_LIMIT="1";
 try{
  const future=start+2*dayMs;
  assert.equal((await meterUsage(anonymous,"lookup","assistant:analyze_company",future)).allowed,true);
  assert.deepEqual(await meterUsage({...anonymous,actor:"visitor:two",ip:"hash-2"},"draft","draft",future),
   {allowed:false,bucket:"global",retryAfter:46_800});
  assert.equal((await meterUsage(anonymous,"catalog","mcp:catalog",future)).allowed,true);
  const report=await usageReport(future);
  assert.ok(report.hits.some(row=>row.endpoint==="scan"&&Number(row.hits)===3));
  assert.ok(report.endpoints.some(row=>row.endpoint==="mcp:catalog"&&Number(row.runs)===1));
 }finally{
  if(previous===undefined)delete process.env.RADAR_GLOBAL_DAILY_LIMIT;
  else process.env.RADAR_GLOBAL_DAILY_LIMIT=previous;
 }
});

test("signed cookie reuse and operator API keys use pseudonymous identifiers", async t=>{
 const key="test-key-longer-than-24-characters";
 t.mock.method(Date,"now",()=>start+3*dayMs);
 const old=process.env.RADAR_API_KEYS;
 process.env.RADAR_API_KEYS=key;
 try{
  const request=(headers?:HeadersInit)=>new Request("https://example.com/api/radar",{headers});
  const a=await usageIdentity(request());
  assert.ok(a?.cookie);
  assert.ok(a.cookie.includes("HttpOnly; SameSite=Lax"));
  assert.ok(a.cookie.includes("Secure"));
  const cookie=a.cookie.split(";")[0];
  assert.equal((await usageIdentity(request({cookie})))?.actor,a.actor);
  assert.notEqual((await usageIdentity(request({cookie:cookie.slice(0,-1)+(cookie.endsWith("A")?"B":"A")})))?.actor,a.actor);
  const api=await usageIdentity(request({authorization:"Bearer "+key}));
  assert.equal(api?.plan,"Pro");
  assert.ok(api?.actor.startsWith("key:")&&!api.actor.includes(key));
  assert.equal(await usageIdentity(request({authorization:"Bearer invalid"})),null);
  const identity=await usageIdentity(request({cookie}));
  for(let i=0;i<3;i++)assert.equal((await meterUsage(identity!,"draft","draft")).allowed,true);
  const response=await withUsage(request({cookie}),"draft","draft",async()=>{throw new Error("quota should skip work");});
  assert.equal(response.status,429);
  assert.equal(response.headers.get("Retry-After"),"46800");
  assert.match((await response.json()).error,/used today’s free drafts/);
 }finally{
  if(old===undefined)delete process.env.RADAR_API_KEYS;
  else process.env.RADAR_API_KEYS=old;
 }
});

test("catalog API and MCP share a burst limit, aggregate counts, and prune old usage", async t=>{
 const date=start+4*dayMs;
 let now=date;
 t.mock.method(Date,"now",()=>now);
 const request=(mcp:boolean)=>new Request("https://example.com/api/catalog",{
  headers:mcp?{"x-startfund-client":"mcp"}:{},
 });
 const search=()=>Promise.resolve(Response.json({ok:true}));
 for(let i=0;i<30;i++)
  assert.equal((await withUsage(request(i%2===0),"catalog","catalog",search)).status,200);
 const blocked=await withUsage(request(true),"catalog","catalog",async()=>assert.fail("blocked work ran"));
 assert.equal(blocked.status,429);
 assert.equal(blocked.headers.get("Retry-After"),"60");
 now+=60_000;
 assert.equal((await withUsage(request(true),"catalog","catalog",search)).status,200);
 const store=await db();
 const day=date-date%dayMs;
 assert.deepEqual((await store.all("SELECT endpoint,runs FROM usage_daily WHERE day=? ORDER BY endpoint",day)).map(r=>[r.endpoint,Number(r.runs)]),
  [["catalog",15],["mcp:catalog",16]]);
 now+=36*dayMs;
 assert.equal((await withUsage(request(true),"catalog","catalog",search)).status,200);
 for(const table of ["usage_daily","usage_network","usage_bursts","usage_totals","usage_limit_hits"]){
  const [old]=await store.all(`SELECT count(*) AS n FROM ${table} WHERE ${table==="usage_bursts"?"minute":"day"}<=?`,date);
  assert.equal(Number(old.n),0,table);
 }
});

test("Eve auth returns 429 and Retry-After when agent usage is exhausted", async t=>{
 t.mock.method(Date,"now",()=>start+41*dayMs);
 const secret="test-agent-password";
 const auth=meteredAgentAuth(secret);
 const request=new Request("https://example.com/eve/v1/sessions",{
  method:"POST",headers:{authorization:"Basic "+Buffer.from("radar:"+secret).toString("base64")},
 });
 for(let i=0;i<8;i++)assert.ok(!((await routeAuth(request,auth)) instanceof Response));
 const response=await routeAuth(request,auth);
 assert.ok(response instanceof Response);
 assert.equal(response.status,429);
 assert.equal(response.headers.get("Retry-After"),"60");
 assert.equal((await response.json()).code,"rate_limited");
});

test("completed scans coalesce and persist for the same ranking inputs and actor", async t=>{
 let now=start, loads=0;
 t.mock.method(Date,"now",()=>now);
 const load=async()=>({matches:[],warnings:[],scannedAt:String(++loads)});
 const first=await Promise.all([completedRadar(demo,"one",load),completedRadar(demo,"one",load)]);
 assert.deepEqual(first.map(r=>r.scannedAt),["1","1"]);
 const copy={...demo,name:"Different name",email:"example@example.com",needs:[...demo.needs].reverse()};
 assert.equal((await completedRadar(copy,"one",load)).scannedAt,"1");
 assert.equal((await completedRadar(copy,"two",load)).scannedAt,"2");
 assert.equal((await completedRadar({...copy,plansClinicalTrial:true},"one",load)).scannedAt,"3");
 now+=300_000;
 assert.equal((await completedRadar(copy,"one",load)).scannedAt,"4");
 const [row]=await (await db()).all("SELECT count(*) AS n FROM completed_scans");
 assert.equal(Number(row.n),1);
});

test("completed scans distinguish company and team locations within a region", async ()=>{
 let loads=0;
 const load=async()=>({matches:[],warnings:[],scannedAt:String(++loads)});
 const base={...demo,region:"EU"} as const;
 const profiles=[base,{...base,companyCountry:"FR"},{...base,companySubdivision:"FR-IDF"},
  {...base,developerCountries:["NL"]},{...base,developerSubdivisions:["NL-NH"]}];
 for(const [i,profile] of profiles.entries())
  assert.equal((await completedRadar(profile,"regional",load)).scannedAt,String(i+1));
 assert.equal((await completedRadar(profiles[3],"regional",load)).scannedAt,"4");
});

test("outbound fetch work is capped at eight concurrent requests",async()=>{
 let release!:()=>void, running=0, peak=0;
 const gate=new Promise<void>(r=>{release=r;});
 const jobs=Array.from({length:13},()=>outbound(async()=>{
  peak=Math.max(peak,++running);
  await gate;
  running--;
 }));
 assert.equal(running,8);
 release();
 await Promise.all(jobs);
 assert.equal(peak,8);
 assert.equal(running,0);
});

test("Stripe checkout configuration is disabled without both server credentials",()=>{
 const secret=process.env.STRIPE_SECRET_KEY,price=process.env.STRIPE_PRO_PRICE_ID;
 try{
  delete process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_PRO_PRICE_ID="price_test";
  assert.equal(stripeCheckoutConfig(),null);
  process.env.STRIPE_SECRET_KEY="test-only";
  assert.equal(stripeCheckoutConfig()?.priceId,"price_test");
 }finally{
  if(secret===undefined)delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY=secret;
  if(price===undefined)delete process.env.STRIPE_PRO_PRICE_ID;
  else process.env.STRIPE_PRO_PRICE_ID=price;
 }
});
