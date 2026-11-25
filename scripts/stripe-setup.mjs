import {createHash} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
import Stripe from "stripe";

const eventTypes=["checkout.session.completed","customer.subscription.updated","customer.subscription.deleted","invoice.payment_failed"];
const productId="startfund_pro";
const lookupKey="startfund_pro_usd_monthly";
const secretKey=process.env.STRIPE_SECRET_KEY?.trim();
const site=URL.parse(process.argv[2]??"");
const owner={startfund_billing:"pro"};

if(!secretKey||!site||site.protocol!=="https:"||site.username||site.password||site.pathname!=="/"||site.search||site.hash){
 console.error("Set STRIPE_SECRET_KEY and run: node scripts/stripe-setup.mjs https://your-startfund-host.example");
 process.exit(1);
}

const stripe=new Stripe(secretKey,{maxNetworkRetries:2});
const webhookUrl=new URL("/api/billing/webhook",site).href;
const originId=createHash("sha256").update(webhookUrl).digest("hex").slice(0,24);
const secretPath=`.radar/stripe-webhook-${originId}.env`;
const stop=message=>{console.error(message);process.exitCode=1;};

try{
 let product;
 try{product=await stripe.products.retrieve(productId);}
 catch(error){
  if(error?.code!=="resource_missing")throw error;
  product=await stripe.products.create({id:productId,name:"Startfund Pro",metadata:owner},{idempotencyKey:productId});
 }
 if(!product.active||product.metadata.startfund_billing!==owner.startfund_billing)throw new Error("Invalid existing product");
 const prices=await stripe.prices.list({lookup_keys:[lookupKey]});
 const price=prices.data[0]??await stripe.prices.create({
  product:product.id,lookup_key:lookupKey,currency:"usd",unit_amount:900,recurring:{interval:"month"},
 },{idempotencyKey:lookupKey});
 if(!price.active||price.product!==product.id||price.currency!=="usd"||price.unit_amount!==900||
    price.recurring?.interval!=="month"||price.recurring.interval_count!==1)throw new Error("Invalid existing price");

 let endpoint;
 for await(const candidate of stripe.webhookEndpoints.list({limit:100})){
  if(candidate.url!==webhookUrl)continue;
  if(candidate.metadata.startfund_billing!==owner.startfund_billing||endpoint)throw new Error("Existing unowned or duplicate webhook");
  endpoint=candidate;
 }
 if(endpoint){
  if(endpoint.api_version!==Stripe.API_VERSION)throw new Error("Webhook API version mismatch");
  if(endpoint.status!=="enabled"||[...endpoint.enabled_events].sort().join()!==[...eventTypes].sort().join())
   await stripe.webhookEndpoints.update(endpoint.id,{enabled_events:eventTypes,disabled:false});
  console.log(`STRIPE_PRICE_ID=${price.id}`);
  console.log("Existing webhook reused. Use its signing secret from Stripe Dashboard or the original local setup file.");
 }else{
  await mkdir(".radar",{recursive:true,mode:0o700});
  const created=await stripe.webhookEndpoints.create({
   url:webhookUrl,enabled_events:eventTypes,api_version:Stripe.API_VERSION,metadata:owner,
  },{idempotencyKey:`startfund-pro-webhook-${originId}`});
  console.log(`STRIPE_PRICE_ID=${price.id}`);
  if(!created.secret)throw new Error("Webhook signing secret not returned");
  await writeFile(secretPath,`STRIPE_WEBHOOK_SECRET=${created.secret}\n`,{mode:0o600,flag:"wx"});
  console.log(`New webhook signing secret saved to ${secretPath} (private file; do not print or commit it).`);
 }
}catch{
 stop("Stripe setup did not complete. Check the key’s permissions and the existing Startfund product, price, and webhook in Stripe Dashboard; a created webhook’s signing secret is available there.");
}
