import {createHash,randomBytes} from "node:crypto";
import {db} from "./database";

export function billingConfig(){
 const secretKey=process.env.STRIPE_SECRET_KEY?.trim();
 const webhookSecret=process.env.STRIPE_WEBHOOK_SECRET?.trim();
 const priceId=process.env.STRIPE_PRICE_ID?.trim();
 return secretKey&&webhookSecret&&priceId?{secretKey,webhookSecret,priceId}:null;
}

const subscriptionExists=(statuses:string)=>`EXISTS (SELECT 1 FROM billing_subscriptions s
 WHERE s.customer=c.customer AND s.status IN (${statuses}))`;
const entitlement=subscriptionExists("'active','trialing'");
const canRestore=subscriptionExists("'active','trialing','past_due','unpaid'");
const hashKey=(key:string)=>createHash("sha256").update(key).digest("hex");
const keyPattern=/^sf_pro_[A-Za-z0-9_-]{43}$/;

export async function billingAccount(visitor:string){
 const [row]=await (await db()).all(`SELECT customer,${entitlement} AS pro,key_hash IS NOT NULL AS issued
  FROM billing_customers c WHERE visitor=?`,visitor);
 return row?{customer:String(row.customer),pro:Boolean(Number(row.pro)),issued:Boolean(Number(row.issued))}:null;
}

export async function rememberBillingCustomer(visitor:string,customer:string){
 const store=await db();
 await store.run("INSERT INTO billing_customers(visitor,customer) VALUES (?,?) ON CONFLICT(visitor) DO NOTHING",visitor,customer);
 const [row]=await store.all("SELECT customer FROM billing_customers WHERE visitor=?",visitor);
 return String(row.customer);
}

export async function billingVisitor(customer:string){
 const [row]=await (await db()).all("SELECT visitor FROM billing_customers WHERE customer=?",customer);
 return row?String(row.visitor):null;
}

export async function billingEventSeen(id:string){
 const [row]=await (await db()).all("SELECT 1 FROM billing_events WHERE id=?",id);
 return Boolean(row);
}

export async function recordBillingEvent(id:string,created:number,customer:string,subscription:string,status:string){
 await (await db()).run("INSERT OR IGNORE INTO billing_events VALUES (?,?,?,?,?)",id,created,customer,subscription,status);
}

export async function claimProKey(visitor:string,rotate=false){
 const key="sf_pro_"+randomBytes(32).toString("base64url");
 const updated=await (await db()).run(`UPDATE billing_customers AS c SET key_hash=?
  WHERE visitor=? AND key_hash IS ${rotate?"NOT NULL":"NULL"} AND ${entitlement}`,hashKey(key),visitor);
 return updated?key:null;
}

export async function visitorForProKey(key:string,purpose:"api"|"restore"="api"){
 if(!keyPattern.test(key))return null;
 const [row]=await (await db()).all(`SELECT visitor FROM billing_customers c WHERE key_hash=? AND ${purpose==="restore"?canRestore:entitlement}`,hashKey(key));
 return row?String(row.visitor):null;
}
