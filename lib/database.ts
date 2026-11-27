import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient } from "@libsql/client/web";
import { catalogMatch } from "./domain";

type Scalar=string|number|null;
type Row=Record<string,unknown>;
export type Statement={sql:string;args?:Scalar[]};
type Database={
 remote:boolean;
 all(sql:string,...args:Scalar[]):Promise<Row[]>;
 run(sql:string,...args:Scalar[]):Promise<number>;
 batch(statements:Statement[]):Promise<void>;
};
const schema=[
 "CREATE TABLE IF NOT EXISTS sources (name TEXT PRIMARY KEY, scanned TEXT NOT NULL, data TEXT NOT NULL)",
 "CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, data TEXT NOT NULL, digest TEXT, sent TEXT, updated TEXT NOT NULL)",
 "CREATE TABLE IF NOT EXISTS raw_snapshots (id INTEGER PRIMARY KEY, source TEXT NOT NULL, url TEXT NOT NULL, fetched TEXT NOT NULL, rights TEXT NOT NULL, body TEXT NOT NULL, etag TEXT, modified TEXT)",
 "CREATE INDEX IF NOT EXISTS raw_lookup ON raw_snapshots(source,url,id DESC)",
 "CREATE TABLE IF NOT EXISTS investors (id TEXT PRIMARY KEY, name TEXT NOT NULL)",
 "CREATE TABLE IF NOT EXISTS programs (id TEXT PRIMARY KEY, name TEXT NOT NULL)",
 "CREATE TABLE IF NOT EXISTS opportunities (id TEXT PRIMARY KEY, source TEXT NOT NULL, program_id TEXT, data TEXT NOT NULL)",
 "CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, source TEXT NOT NULL, entity_id TEXT NOT NULL, data TEXT NOT NULL)",
 "CREATE TABLE IF NOT EXISTS signals (id TEXT PRIMARY KEY, source TEXT NOT NULL, observed TEXT NOT NULL, data TEXT NOT NULL)",
 "CREATE TABLE IF NOT EXISTS signal_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, signal_id TEXT NOT NULL, source TEXT NOT NULL, observed TEXT NOT NULL, data TEXT NOT NULL)",
 "INSERT INTO signal_events(signal_id,source,observed,data) SELECT id,source,observed,data FROM signals WHERE NOT EXISTS (SELECT 1 FROM signal_events) ORDER BY rowid",
 `CREATE TRIGGER IF NOT EXISTS signal_events_insert AFTER INSERT ON signals BEGIN
  INSERT INTO signal_events(signal_id,source,observed,data) VALUES (NEW.id,NEW.source,NEW.observed,NEW.data);
 END`,
 `CREATE TRIGGER IF NOT EXISTS signal_events_update AFTER UPDATE ON signals
 WHEN OLD.observed<>NEW.observed OR json_remove(OLD.data,'$.fetchedAt')<>json_remove(NEW.data,'$.fetchedAt') BEGIN
  INSERT INTO signal_events(signal_id,source,observed,data) VALUES (NEW.id,NEW.source,NEW.observed,NEW.data);
 END`,
 "CREATE TABLE IF NOT EXISTS fact_runs (source TEXT PRIMARY KEY, scanned TEXT NOT NULL)",
 "CREATE TABLE IF NOT EXISTS topical_cache (key TEXT PRIMARY KEY, expires INTEGER NOT NULL, data TEXT NOT NULL)",
 "CREATE TABLE IF NOT EXISTS digest_subscriptions (profile_id TEXT PRIMARY KEY, email TEXT NOT NULL, confirmation TEXT NOT NULL, expires INTEGER NOT NULL, confirmed INTEGER, unsubscribe TEXT NOT NULL, sent TEXT)",
 "CREATE TABLE IF NOT EXISTS usage_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
 "CREATE TABLE IF NOT EXISTS usage_daily (day INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, endpoint TEXT NOT NULL, runs INTEGER NOT NULL, ip TEXT NOT NULL, minute INTEGER NOT NULL, plan TEXT NOT NULL, PRIMARY KEY(day,actor,action,endpoint))",
 "CREATE TABLE IF NOT EXISTS usage_network (day INTEGER NOT NULL, ip TEXT NOT NULL, action TEXT NOT NULL, plan TEXT NOT NULL, runs INTEGER NOT NULL, PRIMARY KEY(day,ip,action,plan))",
 "CREATE TABLE IF NOT EXISTS usage_bursts (minute INTEGER NOT NULL, ip TEXT NOT NULL, action TEXT NOT NULL, runs INTEGER NOT NULL, PRIMARY KEY(minute,ip,action))",
 "CREATE TABLE IF NOT EXISTS usage_totals (day INTEGER PRIMARY KEY, runs INTEGER NOT NULL)",
 ...["INSERT","UPDATE OF runs"].map((event,i)=>`CREATE TRIGGER IF NOT EXISTS usage_count_${i} AFTER ${event} ON usage_daily
 BEGIN
  INSERT INTO usage_bursts VALUES (NEW.minute,NEW.ip,NEW.action,1)
   ON CONFLICT(minute,ip,action) DO UPDATE SET runs=runs+1;
  INSERT INTO usage_network SELECT NEW.day,NEW.ip,NEW.action,NEW.plan,1 WHERE NEW.action<>'catalog'
   ON CONFLICT(day,ip,action,plan) DO UPDATE SET runs=runs+1;
  INSERT INTO usage_totals SELECT NEW.day,1 WHERE NEW.action<>'catalog'
   ON CONFLICT(day) DO UPDATE SET runs=runs+1;
 END`),
 "CREATE TABLE IF NOT EXISTS usage_limit_hits (day INTEGER NOT NULL, endpoint TEXT NOT NULL, hits INTEGER NOT NULL, PRIMARY KEY(day,endpoint))",
 "CREATE TABLE IF NOT EXISTS completed_scans (key TEXT PRIMARY KEY, expires INTEGER NOT NULL, data TEXT NOT NULL)",
 "CREATE INDEX IF NOT EXISTS completed_scans_expiry ON completed_scans(expires)",
 "CREATE TABLE IF NOT EXISTS shared_scans (id TEXT PRIMARY KEY, data TEXT NOT NULL)",
 "CREATE TABLE IF NOT EXISTS opportunity_suggestions (id TEXT PRIMARY KEY, status TEXT NOT NULL, created TEXT NOT NULL, reviewed TEXT, data TEXT NOT NULL)",
 "CREATE INDEX IF NOT EXISTS suggestion_status ON opportunity_suggestions(status,created)",
 "CREATE TABLE IF NOT EXISTS billing_customers (visitor TEXT PRIMARY KEY, customer TEXT NOT NULL UNIQUE, key_hash TEXT UNIQUE)",
 "CREATE TABLE IF NOT EXISTS billing_subscriptions (id TEXT PRIMARY KEY, customer TEXT NOT NULL, status TEXT NOT NULL, event_created INTEGER NOT NULL)",
 "CREATE INDEX IF NOT EXISTS billing_subscription_customer ON billing_subscriptions(customer,status)",
 "CREATE TABLE IF NOT EXISTS billing_events (id TEXT PRIMARY KEY, created INTEGER NOT NULL, customer TEXT NOT NULL, subscription TEXT NOT NULL, status TEXT NOT NULL)",
 `CREATE TRIGGER IF NOT EXISTS billing_apply_event AFTER INSERT ON billing_events BEGIN
  INSERT INTO billing_subscriptions(id,customer,status,event_created) VALUES (NEW.subscription,NEW.customer,NEW.status,NEW.created)
  ON CONFLICT(id) DO UPDATE SET status=excluded.status,event_created=excluded.event_created
  WHERE billing_subscriptions.customer=excluded.customer AND excluded.event_created>=billing_subscriptions.event_created;
 END`,
];
async function open():Promise<Database>{
 const url=process.env.TURSO_DATABASE_URL,authToken=process.env.TURSO_AUTH_TOKEN;
 if(url||authToken||process.env.VERCEL==="1"){
  if(!url||!authToken||!["libsql:","https:"].includes(URL.parse(url)?.protocol??""))
   throw new Error("Set TURSO_DATABASE_URL (libsql:// or https://) and TURSO_AUTH_TOKEN for durable deployment storage.");
  const client=createClient({url,authToken,fetch:(input:RequestInfo|URL,init?:RequestInit)=>fetch(input,{...init,signal:AbortSignal.timeout(8000)})});
  await client.batch(schema,"write");
  return {
   remote:true,
   async all(sql,...args){return (await client.execute({sql,args})).rows;},
   async run(sql,...args){return (await client.execute({sql,args})).rowsAffected;},
   async batch(statements){await client.batch(statements,"write");},
  };
 }
 const configured=process.env.RADAR_DB_PATH;
 const path=configured===":memory:"?configured:resolve(/*turbopackIgnore: true*/ configured||".radar/startfund.sqlite");
 if(path!==":memory:")mkdirSync(dirname(path),{recursive:true});
 const db=new DatabaseSync(path);
 db.function("catalog_match",(q,value)=>Number(catalogMatch(String(q),String(value))));
 db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=4000;");
 db.exec(schema.join(";"));
 return {
  remote:false,
  async all(sql,...args){return db.prepare(sql).all(...args);},
  async run(sql,...args){return Number(db.prepare(sql).run(...args).changes);},
  async batch(statements){
   db.exec("BEGIN IMMEDIATE");
   try{
    for(const {sql,args=[]} of statements)db.prepare(sql).run(...args);
    db.exec("COMMIT");
   }catch(e){db.exec("ROLLBACK");throw e;}
  },
 };
}
let database:Promise<Database>|undefined;
export function db(){
 return database??=open().catch(error=>{database=undefined;throw error;});
}
