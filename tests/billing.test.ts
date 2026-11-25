import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import Stripe from "stripe";
import {billingHandlers} from "../lib/billing";
import {billingAccount,billingConfig} from "../lib/billing-state";
import {db} from "../lib/database";
import {meterUsage,usageIdentity} from "../lib/usage";

process.env.RADAR_DB_PATH=":memory:";
const origin="https://startfund.example";
const config={secretKey:"sk_test_mock",webhookSecret:"whsec_mock",priceId:"price_mock"};
const request=(action:string,cookie?:string,body:object={})=>new Request(`${origin}/api/billing/${action}`,{
 method:"POST",headers:{"Content-Type":"application/json","Origin":origin,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body),
});
const statusRequest=(cookie?:string)=>new Request(`${origin}/api/billing/status`,{headers:cookie?{Cookie:cookie}:{}});

test("Stripe is disabled unless all billing settings are configured",async()=>{
 assert.equal(billingConfig(),null);
 assert.equal((await billingHandlers().browser(request("checkout"),"checkout")).status,503);
 assert.equal((await billingHandlers().webhook(request("webhook"))).status,503);
 assert.deepEqual(await (await billingHandlers().status(statusRequest())).json(),{enabled:false,pro:false,issued:false,customer:false});
 process.env.STRIPE_SECRET_KEY=config.secretKey;
 try{assert.equal(billingConfig(),null);}
 finally{delete process.env.STRIPE_SECRET_KEY;}
});

test("signed Stripe events drive shared Pro quotas, one-time recovery, and Portal",async()=>{
 process.env.STRIPE_SECRET_KEY=config.secretKey;
 process.env.STRIPE_WEBHOOK_SECRET=config.webhookSecret;
 process.env.STRIPE_PRICE_ID=config.priceId;
 const signer=new Stripe(config.secretKey).webhooks;
 let checkout:Stripe.Checkout.SessionCreateParams|undefined;
 let customerCreates=0,retrievals=0,subscriptionStatus="trialing";
 let unitAmount=900;
 let latestSession:{id:string;status:string;url:string|null}|undefined;
 const checkoutKeys:(string|undefined)[]=[];
 const stripe={
  webhooks:signer,
  customers:{async create(){customerCreates++;return {id:"cus_mock"};}},
  prices:{async retrieve(){return {active:true,currency:"usd",unit_amount:unitAmount,recurring:{interval:"month",interval_count:1}};}},
  checkout:{sessions:{
   async list(){return {data:latestSession?[latestSession]:[]};},
   async create(input:Stripe.Checkout.SessionCreateParams,options:Stripe.RequestOptions){
    checkout=input;checkoutKeys.push(options.idempotencyKey);return {url:"https://checkout.stripe.test/start"};
   },
  }},
  subscriptions:{
   async list(){return {data:[],has_more:false};},
   async retrieve(id:string){retrievals++;return {id,customer:"cus_mock",status:subscriptionStatus,items:{data:[{price:{id:config.priceId}}]}};},
  },
  billingPortal:{sessions:{async create(input:Stripe.BillingPortal.SessionCreateParams){
   assert.deepEqual(input,{customer:"cus_mock",return_url:`${origin}/pricing`});
   return {url:"https://billing.stripe.test/manage"};
  }}},
 } as unknown as Stripe;
 const handlers=billingHandlers(config,stripe);
 const event=(id:string,type:string,created:number,object:object,valid=true)=>{
  const payload=JSON.stringify({id,type,created,data:{object}});
  const signature=signer.generateTestHeaderString({payload,secret:valid?config.webhookSecret:"whsec_invalid"});
  return new Request(`${origin}/api/billing/webhook`,{method:"POST",headers:{"stripe-signature":signature},body:payload});
 };
 try{
  unitAmount=999;
  assert.equal((await handlers.browser(request("checkout"),"checkout")).status,502);
  assert.equal(customerCreates,0);
  unitAmount=900;
  const checkoutResponse=await handlers.browser(request("checkout"),"checkout");
  assert.equal(checkoutResponse.status,200);
  assert.deepEqual(await checkoutResponse.json(),{url:"https://checkout.stripe.test/start"});
  const cookie=checkoutResponse.headers.get("set-cookie")!.split(";")[0];
  assert.ok(checkout);
  const visitor=checkout.client_reference_id!;
  assert.ok(cookie.includes(visitor+"."));
  assert.deepEqual(checkout,{mode:"subscription",customer:"cus_mock",client_reference_id:visitor,
   line_items:[{price:config.priceId,quantity:1}],success_url:`${origin}/pricing/success`,cancel_url:`${origin}/pricing`});
  latestSession={id:"cs_mock",status:"open",url:"https://checkout.stripe.test/reuse"};
  const repeated=await handlers.browser(request("checkout",cookie),"checkout");
  assert.deepEqual(await repeated.json(),{url:"https://checkout.stripe.test/reuse"});
  assert.deepEqual(checkoutKeys,["startfund-checkout-cus_mock-first"]);
  assert.equal(customerCreates,1);
  assert.equal((await usageIdentity(statusRequest(cookie)))?.plan,"Free");
  assert.equal((await handlers.browser(request("claim",cookie),"claim")).status,409);
  assert.equal((await handlers.browser(request("portal"),"portal")).status,404);

  const completed={mode:"subscription",customer:"cus_mock",subscription:"sub_mock",client_reference_id:visitor};
  assert.equal((await handlers.webhook(event("evt_checkout","checkout.session.completed",100,completed,false))).status,400);
  assert.equal(retrievals,0);
  assert.equal((await handlers.webhook(event("evt_unrelated","checkout.session.completed",100,{...completed,client_reference_id:"different"}))).status,200);
  assert.equal(retrievals,0);
  for(let i=0;i<2;i++)assert.equal((await handlers.webhook(event("evt_checkout","checkout.session.completed",101,completed))).status,200);
  assert.equal(retrievals,1);
  const owner=(await usageIdentity(statusRequest(cookie)))!;
  assert.equal(owner.plan,"Pro");
  const now=Date.UTC(2026,10,25);
  for(let i=0;i<6;i++)assert.equal((await meterUsage(owner,"scan","radar",now+i*60_000)).allowed,true);

  const claims=await Promise.all([handlers.browser(request("claim",cookie),"claim"),handlers.browser(request("claim",cookie),"claim")]);
  assert.deepEqual(claims.map(response=>response.status).sort(),[200,409]);
  const response=claims.find(r=>r.ok)!;
  assert.equal(response.headers.get("cache-control"),"no-store");
  const {key}=await response.json();
  const [stored]=await (await db()).all("SELECT key_hash FROM billing_customers WHERE visitor=?",visitor);
  assert.ok(stored.key_hash===createHash("sha256").update(key).digest("hex"));
  const apiRequest=new Request(origin,{headers:{Authorization:"Bearer "+key}});
  assert.deepEqual(await usageIdentity(apiRequest),owner);
  const restored=await handlers.browser(request("restore",undefined,{key}),"restore");
  assert.equal(restored.status,200);
  const restoredCookie=restored.headers.get("set-cookie")!.split(";")[0];
  assert.deepEqual(await usageIdentity(statusRequest(restoredCookie)),owner);
  const portal=await handlers.browser(request("portal",restoredCookie),"portal");
  assert.deepEqual(await portal.json(),{url:"https://billing.stripe.test/manage"});

  const sub={id:"sub_mock",customer:"cus_mock"};
  const invoice={customer:"cus_mock",parent:{subscription_details:{subscription:"sub_mock"}}};
  subscriptionStatus="past_due";
  assert.equal((await handlers.webhook(event("evt_failed","invoice.payment_failed",102,invoice))).status,200);
  assert.equal((await usageIdentity(statusRequest(cookie)))?.plan,"Free");
  assert.equal(await usageIdentity(apiRequest),null);
  for(const status of ["past_due","unpaid"]){
   if(status==="unpaid"){
    subscriptionStatus=status;
    assert.equal((await handlers.webhook(event("evt_unpaid","customer.subscription.updated",102,sub))).status,200);
   }
   const recovery=await handlers.browser(request("restore",undefined,{key}),"restore");
   assert.equal(recovery.status,200,status);
   const billingCookie=recovery.headers.get("set-cookie")!.split(";")[0];
   const identity=await usageIdentity(statusRequest(billingCookie));
   assert.equal(identity?.actor,owner.actor,status);
   assert.equal(identity?.plan,"Free",status);
   assert.equal(await usageIdentity(apiRequest),null,status);
   assert.deepEqual(await (await handlers.browser(request("portal",billingCookie),"portal")).json(),{url:"https://billing.stripe.test/manage"});
  }
  subscriptionStatus="active";
  assert.equal((await handlers.webhook(event("evt_active","customer.subscription.updated",103,sub))).status,200);
  assert.equal((await billingAccount(visitor))?.pro,true);
  subscriptionStatus="canceled";
  assert.equal((await handlers.webhook(event("evt_cancel","customer.subscription.deleted",105,sub))).status,200);
  subscriptionStatus="active";
  assert.equal((await handlers.webhook(event("evt_late","customer.subscription.updated",104,sub))).status,200);
  assert.equal((await billingAccount(visitor))?.pro,false);
  assert.equal((await usageIdentity(statusRequest(restoredCookie)))?.plan,"Free");
  assert.equal((await handlers.browser(request("restore",undefined,{key}),"restore")).status,401);
  assert.equal((await handlers.browser(request("claim",cookie,{rotate:true}),"claim")).status,409);
  const [count]=await (await db()).all("SELECT count(*) AS n FROM billing_events");
  assert.equal(Number(count.n),6);

  assert.equal((await handlers.webhook(event("evt_restarted","customer.subscription.updated",106,sub))).status,200);
  assert.equal((await handlers.browser(request("claim",undefined,{rotate:true}),"claim")).status,404);
  assert.equal((await handlers.browser(request("claim",cookie),"claim")).status,409);
  const replacement=await handlers.browser(request("claim",cookie,{rotate:true}),"claim");
  assert.equal(replacement.status,200);
  assert.equal(replacement.headers.get("cache-control"),"no-store");
  const {key:newKey}=await replacement.json();
  assert.notEqual(newKey,key);
  const [updated]=await (await db()).all("SELECT key_hash FROM billing_customers WHERE visitor=?",visitor);
  assert.equal(updated.key_hash,createHash("sha256").update(newKey).digest("hex"));
  assert.equal(await usageIdentity(apiRequest),null);
  assert.equal((await handlers.browser(request("restore",undefined,{key}),"restore")).status,401);
  assert.deepEqual(await usageIdentity(new Request(origin,{headers:{Authorization:"Bearer "+newKey}})),owner);
  assert.equal((await handlers.browser(request("restore",undefined,{key:newKey}),"restore")).status,200);
 }finally{
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_PRICE_ID;
 }
});
