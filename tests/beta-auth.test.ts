import test from "node:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import {
 betaAuthConfigured,
 betaCookie,
 betaInviteMs,
 betaSessionMs,
 canonicalInviteCode,
 createBetaInvite,
 createBetaSession,
 redeemBetaInvite,
 verifyBetaSession,
} from "../lib/beta-auth";
import { db } from "../lib/database";
import { POST as redeemRoute } from "../app/api/auth/redeem/route";
import { POST as invitesRoute } from "../app/api/admin/invites/route";

process.env.RADAR_DB_PATH=":memory:";
process.env.RADAR_AUTH_SECRET="test-only-beta-auth-secret-with-32-bytes";
const globalStore=globalThis as typeof globalThis&{AsyncLocalStorage?:typeof AsyncLocalStorage};
globalStore.AsyncLocalStorage??=AsyncLocalStorage;

const adminToken="test-only-admin-token";
const invitePattern=/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/;
const redeemRequest=(code:string)=>new Request("https://startfund.test/api/auth/redeem",{
 method:"POST",
 headers:{"content-type":"application/json"},
 body:JSON.stringify({code}),
});
const cookies=(response:Response)=>(response.headers as Headers&{getSetCookie?:()=>string[]}).getSetCookie?.()??[];

test("admin generates a one-time invite and the redeem route sets a signed session once",async t=>{
 const now=Date.UTC(2027,0,4,12);
 t.mock.method(Date,"now",()=>now);
 const oldAdmin=process.env.RADAR_ADMIN_TOKEN;
 process.env.RADAR_ADMIN_TOKEN=adminToken;
 try{
  const denied=await invitesRoute(new Request("https://startfund.test/api/admin/invites",{method:"POST"}));
  assert.equal(denied.status,404);
  const generated=await invitesRoute(new Request("https://startfund.test/api/admin/invites",{
   method:"POST",headers:{authorization:`Bearer ${adminToken}`},
  }));
  assert.equal(generated.status,201);
  const body=await generated.json();
  assert.match(body.code,invitePattern);
  assert.equal(body.expiresAt,new Date(now+betaInviteMs).toISOString());
  assert.equal(Object.keys(body).sort().join(","),"code,expiresAt");

  const [stored]=await (await db()).all("SELECT code_hash,used FROM beta_invites WHERE created=?",now);
  assert.equal(String(stored.code_hash).length,64);
  assert.notEqual(stored.code_hash,body.code);
  assert.notEqual(stored.code_hash,body.code.replaceAll("-",""));

  const response=await redeemRoute(redeemRequest(body.code));
  assert.equal(response.status,200);
  const cookie=cookies(response).find(value=>value.startsWith(betaCookie+"="));
  assert.ok(cookie);
  assert.match(cookie,/Path=\/; HttpOnly; SameSite=Lax/);
  assert.match(cookie,/Secure/);
  assert.match(cookie,new RegExp(`Max-Age=${betaSessionMs/1000}`));
  const token=cookie.split(";")[0].slice(betaCookie.length+1);
  assert.ok(verifyBetaSession(token,now));
  assert.equal(verifyBetaSession(token.slice(0,-1)+(token.endsWith("A")?"B":"A"),now),null);

  const reused=await redeemRoute(redeemRequest(body.code));
  assert.equal(reused.status,401);
  assert.deepEqual(await reused.json(),{error:"Invalid or expired invite code."});
 }finally{
  if(oldAdmin===undefined)delete process.env.RADAR_ADMIN_TOKEN;
  else process.env.RADAR_ADMIN_TOKEN=oldAdmin;
 }
});

test("atomic redemption allows only one concurrent use",async t=>{
 const now=Date.UTC(2027,0,5,12);
 t.mock.method(Date,"now",()=>now);
 const invite=await createBetaInvite(now);
 const attempts=await Promise.all([
  redeemBetaInvite(invite.code,now),
  redeemBetaInvite(invite.code.replaceAll("-",""),now),
 ]);
 assert.equal(attempts.filter(Boolean).length,1);
 assert.equal(await redeemBetaInvite(invite.code,now),null);
});

test("expired, unknown, malformed, and ambiguous invite codes fail",async()=>{
 const now=Date.UTC(2027,0,6,12);
 const invite=await createBetaInvite(now);
 assert.equal(await redeemBetaInvite(invite.code,now+betaInviteMs),null);
 assert.equal(await redeemBetaInvite(invite.code,now+betaInviteMs+1),null);
 assert.equal(await redeemBetaInvite("0123-4567-89AB-CDEF",now),null);
 assert.equal(await redeemBetaInvite("short",now),null);
 const ambiguous="I"+invite.code.replaceAll("-","").slice(1);
 assert.equal(canonicalInviteCode(ambiguous),null);
 assert.equal(await redeemBetaInvite(ambiguous,now),null);
 assert.ok(canonicalInviteCode(invite.code.toLowerCase()));
});

test("wrong code attempts are rate limited",async t=>{
 const now=Date.UTC(2027,0,7,12);
 t.mock.method(Date,"now",()=>now);
 for(let i=0;i<3;i++){
  const response=await redeemRoute(redeemRequest("0123-4567-89AB-CDEF"));
  assert.equal(response.status,401);
  assert.deepEqual(await response.json(),{error:"Invalid or expired invite code."});
 }
 const limited=await redeemRoute(redeemRequest("0123-4567-89AB-CDEF"));
 assert.equal(limited.status,429);
 assert.ok(Number(limited.headers.get("Retry-After"))>0);
});

test("RADAR_USAGE_SECRET is the signing fallback and missing secrets fail closed",async()=>{
 const oldAuth=process.env.RADAR_AUTH_SECRET,oldUsage=process.env.RADAR_USAGE_SECRET;
 try{
  delete process.env.RADAR_AUTH_SECRET;
  delete process.env.RADAR_USAGE_SECRET;
  assert.equal(betaAuthConfigured(),false);
  assert.equal(createBetaSession(),null);
  process.env.RADAR_USAGE_SECRET="test-only-usage-secret-with-32-bytes";
  const session=createBetaSession();
  assert.ok(session);
  assert.ok(verifyBetaSession(session.value));
 }finally{
  if(oldAuth===undefined)delete process.env.RADAR_AUTH_SECRET;
  else process.env.RADAR_AUTH_SECRET=oldAuth;
  if(oldUsage===undefined)delete process.env.RADAR_USAGE_SECRET;
  else process.env.RADAR_USAGE_SECRET=oldUsage;
 }
});

test("proxy requires a signed session and matcher leaves public beta paths reachable",async t=>{
 const now=Date.UTC(2027,0,8,12);
 t.mock.method(Date,"now",()=>now);
 const [{default:proxy,config},testing,server]=await Promise.all([
  import("../proxy"),
  import("next/experimental/testing/server.js"),
  import("next/server"),
 ]);
 for(const url of [
  "/login",
  "/admin/sign-in",
  "/api/auth/redeem",
  "/api/billing/webhook",
  "/_next/static/chunk.js",
  "/_next/image",
  "/favicon.ico",
  "/brand/startfund-icon-512.png",
 ])assert.equal(testing.unstable_doesMiddlewareMatch({config,url}),false,url);
 for(const url of ["/","/pricing","/api/radar","/eve/v1/sessions"])
  assert.equal(testing.unstable_doesMiddlewareMatch({config,url}),true,url);

 const anonymous=await proxy(new server.NextRequest("https://startfund.test/pricing?plan=pro"));
 assert.equal(anonymous.status,307);
 const loginUrl=new URL(anonymous.headers.get("location")!);
 assert.equal(loginUrl.pathname,"/login");
 assert.equal(loginUrl.searchParams.get("next"),"/pricing?plan=pro");

 const openRedirect=await proxy(new server.NextRequest("https://startfund.test//evil.example/path"));
 assert.equal(new URL(openRedirect.headers.get("location")!).searchParams.get("next"),"/");

 const api=await proxy(new server.NextRequest("https://startfund.test/api/radar"));
 assert.equal(api.status,401);
 const apiWithKey=await proxy(new server.NextRequest("https://startfund.test/api/radar",{headers:{authorization:"Bearer invalid"}}));
 assert.notEqual(apiWithKey.status,401);
 assert.equal(apiWithKey.headers.get("location"),null);

 const session=createBetaSession(now);
 assert.ok(session);
 const signed=await proxy(new server.NextRequest("https://startfund.test/",{
  headers:{cookie:`${betaCookie}=${session.value}`},
 }));
 assert.notEqual(signed.status,307);
 assert.equal(signed.headers.get("location"),null);
 const tampered=await proxy(new server.NextRequest("https://startfund.test/",{
  headers:{cookie:`${betaCookie}=${session.value.slice(0,-1)}${session.value.endsWith("A")?"B":"A"}`},
 }));
 assert.equal(tampered.status,307);
});
