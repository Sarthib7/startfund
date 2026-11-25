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
 "CREATE TABLE IF NOT EXISTS fact_runs (source TEXT PRIMARY KEY, scanned TEXT NOT NULL)",
 "CREATE TABLE IF NOT EXISTS topical_cache (key TEXT PRIMARY KEY, expires INTEGER NOT NULL, data TEXT NOT NULL)",
 "CREATE TABLE IF NOT EXISTS digest_subscriptions (profile_id TEXT PRIMARY KEY, email TEXT NOT NULL, confirmation TEXT NOT NULL, expires INTEGER NOT NULL, confirmed INTEGER, unsubscribe TEXT NOT NULL, sent TEXT)",
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
