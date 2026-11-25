import Stripe from "stripe";
import {
 billingAccount,billingConfig,billingEventSeen,billingVisitor,
 claimProKey,recordBillingEvent,rememberBillingCustomer,visitorForProKey,
} from "./billing-state";
import {proPrice} from "./plans";
import {browserVisitor,checkoutBrowserProof,ownerVisitorCookie,restoreVisitorCookie,withUsage} from "./usage";

const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
const invalid=()=>json({error:"Invalid billing request."},403);
const unavailable=()=>json({error:"Billing is coming soon."},503);
const failed=()=>json({error:"Billing is temporarily unavailable. Try again."},502);
const stripeId=(object:string|{id:string}|null|undefined)=>typeof object==="string"?object:object?.id;
const canCheckout=(status:string)=>status==="canceled"||status==="incomplete_expired";
type Config=NonNullable<ReturnType<typeof billingConfig>>;
type BrowserAction="checkout"|"confirm"|"portal"|"restore"|"claim";

function siteOrigin(request:Request){
 const configured=process.env.RADAR_PUBLIC_ORIGIN ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL?`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`:request.url);
 const url=new URL(configured);
 if(url.protocol!=="https:"&&!(url.protocol==="http:"&&["localhost","127.0.0.1","[::1]"].includes(url.hostname)))throw new Error("Invalid billing origin");
 return url.origin;
}

export function billingHandlers(config:Config|null=billingConfig(),stripe=config?new Stripe(config.secretKey,{timeout:8000,maxNetworkRetries:1}):null){
 return {
  async status(request:Request){
   if(!config)return json({enabled:false,pro:false,issued:false,customer:false});
   const {id,cookie,restored}=await browserVisitor(request);
   const account=cookie?null:await billingAccount(id);
   const response=json({enabled:true,pro:account?.pro??false,issued:account?.issued??false,customer:Boolean(account),...(restored?{restored}:{})});
   if(cookie)response.headers.append("Set-Cookie",cookie);
   return response;
  },
  async browser(request:Request,action:BrowserAction){
   if(!config||!stripe)return unavailable();
   if(request.headers.get("authorization")||request.headers.get("sec-fetch-site")==="cross-site"||
    !request.headers.get("content-type")?.startsWith("application/json")||
    (request.headers.has("origin")&&request.headers.get("origin")!==new URL(request.url).origin))return invalid();
   try{
    if(action==="checkout")return await withUsage(request,"checkout","billing_checkout",async identity=>{
     const visitor=identity.actor.slice("visitor:".length),origin=siteOrigin(request);
     const browserProof=checkoutBrowserProof(identity.cookie??request.headers.get("cookie"));
     if(!browserProof)return invalid();
     const account=await billingAccount(visitor);
     if(account?.pro)return json({error:"Pro is already active. Use Manage billing."},409);
     const price=await stripe.prices.retrieve(config.priceId);
     if(!price.active||price.currency!=="usd"||price.unit_amount!==proPrice*100||
      price.recurring?.interval!=="month"||price.recurring.interval_count!==1)return failed();
     const customer=account?.customer??await rememberBillingCustomer(visitor,(await stripe.customers.create({
      metadata:{startfund_visitor:visitor},
     },{idempotencyKey:`startfund-customer-${visitor}`})).id);
     const subscriptions=await stripe.subscriptions.list({customer,status:"all",limit:100});
     if(subscriptions.data.some(s=>!canCheckout(s.status))||subscriptions.has_more)
      return json({error:"You already have a subscription. Use Manage billing."},409);
     const [latest]=(await stripe.checkout.sessions.list({customer,limit:1})).data;
     if(latest?.status==="open"){
      if(latest.metadata?.startfund_browser!==browserProof)return json({error:"A checkout is already open in another browser."},409);
      return latest.url?json({url:latest.url}):failed();
     }
     const session=await stripe.checkout.sessions.create({
      mode:"subscription",customer,client_reference_id:visitor,line_items:[{price:config.priceId,quantity:1}],
      metadata:{startfund_browser:browserProof},
      success_url:`${origin}/pricing/success?session_id={CHECKOUT_SESSION_ID}`,cancel_url:`${origin}/pricing`,
     },{idempotencyKey:`startfund-checkout-${customer}-${latest?.id??"first"}`});
     return session.url?json({url:session.url}):failed();
    });
    if(action==="restore"){
     const input=await request.json().catch(()=>null);
     const key=typeof input?.key==="string"?input.key.trim():"";
     const visitor=await visitorForProKey(key,"restore");
     if(!visitor)return json({error:"This key can’t restore a billing account."},401);
     const response=json({ok:true});
     const browser=await browserVisitor(request);
     if(!browser.cookie&&browser.id===visitor)return response;
     response.headers.append("Set-Cookie",await restoreVisitorCookie(request,visitor,key));
     return response;
    }
    const {id,cookie,restored}=await browserVisitor(request);
    if(cookie)return json({error:"No billing account found on this device."},404);
    const account=await billingAccount(id);
    if(!account)return json({error:"No billing account found on this device."},404);
    if(action==="confirm"){
     const input=await request.json().catch(()=>null);
     if(typeof input?.sessionId!=="string"||!/^cs_(test|live)_[a-zA-Z0-9]+$/.test(input.sessionId))return invalid();
     const session=await stripe.checkout.sessions.retrieve(input.sessionId);
     const proof=checkoutBrowserProof(request.headers.get("cookie"));
     if((restored&&(!proof||session.metadata?.startfund_browser!==proof))||session.client_reference_id!==id||
      stripeId(session.customer)!==account.customer||session.mode!=="subscription"||session.status!=="complete"||
      !session.subscription||(session.payment_status!=="paid"&&session.payment_status!=="no_payment_required"))return invalid();
     const response=json({ok:true});
     if(restored)response.headers.append("Set-Cookie",await ownerVisitorCookie(request,id));
     return response;
    }
    if(action==="claim"){
     if(restored)return json({error:"Use the browser you used for Checkout to manage your Pro API key."},403);
     if(!account.pro)return json({error:"Pro is not active yet."},409);
     const input=await request.json().catch(()=>null);
     const rotate=input?.rotate===true;
     const key=await claimProKey(id,rotate);
     return key?json({key}):json({error:rotate?"Couldn’t replace your Pro API key. Check your billing status and try again.":"A Pro API key has already been issued."},409);
    }
    const portal=await stripe.billingPortal.sessions.create({customer:account.customer,return_url:`${siteOrigin(request)}/pricing`});
    return json({url:portal.url});
   }catch{
    return failed();
   }
  },
  async webhook(request:Request){
   if(!config||!stripe)return unavailable();
   const signature=request.headers.get("stripe-signature");
   if(!signature)return json({error:"Invalid Stripe signature."},400);
   let event:Stripe.Event;
   try{
    const raw=await request.text();
    event=stripe.webhooks.constructEvent(raw,signature,config.webhookSecret);
   }catch{
    return json({error:"Invalid Stripe signature."},400);
   }
   try{
    let customer:string|undefined,subscription:string|undefined,reference:string|null=null;
    switch(event.type){
     case "checkout.session.completed":{
      const session=event.data.object;
      if(session.mode!=="subscription")return json({ok:true});
      customer=stripeId(session.customer);subscription=stripeId(session.subscription);reference=session.client_reference_id;
      if(!reference)return json({ok:true});
      break;
     }
     case "customer.subscription.updated":
     case "customer.subscription.deleted":
      customer=stripeId(event.data.object.customer);subscription=event.data.object.id;
      break;
     case "invoice.payment_failed":
      customer=stripeId(event.data.object.customer);
      subscription=stripeId(event.data.object.parent?.subscription_details?.subscription);
      break;
     default:return json({ok:true});
    }
    if(!customer||!subscription||await billingEventSeen(event.id))return json({ok:true});
    const visitor=await billingVisitor(customer);
    if(!visitor||(reference&&visitor!==reference))return json({ok:true});
    const current=await stripe.subscriptions.retrieve(subscription);
    if(stripeId(current.customer)!==customer)return json({ok:true});
    const status=current.items.data.some(item=>item.price.id===config.priceId)?current.status:"unentitled";
    await recordBillingEvent(event.id,event.created,customer,subscription,status);
    return json({ok:true});
   }catch{
    return json({error:"Could not process Stripe event. Retry later."},500);
   }
  },
 };
}
