import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { db } from "../lib/database";
import { agentUpdates } from "../lib/store";

const directory=mkdtempSync(join(tmpdir(),"startfund-agent-updates-"));
const databasePath=join(directory,"legacy.sqlite");
process.env.RADAR_DB_PATH=databasePath;

test("existing signal rows are backfilled into the durable event journal",async t=>{
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const legacy=new DatabaseSync(databasePath);
 legacy.exec("CREATE TABLE signals (id TEXT PRIMARY KEY, source TEXT NOT NULL, observed TEXT NOT NULL, data TEXT NOT NULL)");
 const data=(id:string)=>JSON.stringify({id,title:`${id} title`,kind:"Market signal",source:"Test source",url:`https://example.com/${id}`,observed:"2025-01-01T00:00:00.000Z",rights:"Test rights"});
 const insert=legacy.prepare("INSERT INTO signals VALUES (?,?,?,?)");
 insert.run("older-signal","Test source","2025-01-01T00:00:00.000Z",data("older-signal"));
 insert.run("newer-signal","Test source","2025-01-02T00:00:00.000Z",data("newer-signal"));
 legacy.close();

 const store=await db();
 const journal=await store.all("SELECT seq,signal_id AS signalId FROM signal_events ORDER BY seq");
 assert.deepEqual(journal.map(row=>[Number(row.seq),row.signalId]),[[1,"older-signal"],[2,"newer-signal"]]);
 const initial=await agentUpdates(0,10);
 assert.deepEqual(initial.events.map(event=>event.id),["older-signal","newer-signal"]);
 assert.equal(initial.cursor,"2");
 assert.equal(initial.hasMore,false);

 await store.run("INSERT INTO signals VALUES (?,?,?,?)","after-migration","Test source","2025-01-03T00:00:00.000Z",data("after-migration"));
 const next=await agentUpdates(Number(initial.cursor),10);
 assert.deepEqual(next.events.map(event=>event.id),["after-migration"]);
 assert.equal(next.cursor,"3");
 assert.equal(next.hasMore,false);
});
