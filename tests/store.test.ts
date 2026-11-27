import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { db } from "../lib/database";
import { agentUpdates, catalog } from "../lib/store";
import { parseUs, sources } from "../lib/sources";

test("a persisted topical cache hit expires in memory at the stored deadline",async t=>{
 process.env.RADAR_DB_PATH=":memory:";
 let now=Date.now();
 const at=new Date(now).toISOString();
 t.mock.method(Date,"now",()=>now);
 const store=await db(), query={q:"widget",source:"Grants.gov"};
 const key=createHash("sha256").update(JSON.stringify([query.source,"keyword:widget"])).digest("hex");
 const cached={id:"1",title:"Cached widget",closeDate:"12/31/2029"};
 const upstream={id:"2",title:"Fresh widget",closeDate:"12/31/2029"};
 const response=(row:typeof cached)=>({errorcode:0,data:{oppHits:[row]}});
 await store.run("INSERT INTO sources VALUES (?,?,?)",query.source,at,"[]");
 await store.run("INSERT INTO topical_cache VALUES (?,?,?)",key,now+1000,JSON.stringify(parseUs(response(cached),at)));
 const fetch=t.mock.method(globalThis,"fetch",async()=>Response.json(response(upstream)));
 assert.deepEqual((await catalog(query)).opportunities.map(row=>row.id),["us-1"]);
 assert.equal(fetch.mock.callCount(),0);
 now+=1000;
 assert.deepEqual((await catalog(query)).opportunities.map(row=>row.id),["us-2"]);
 assert.equal(fetch.mock.callCount(),1);
 assert.deepEqual((await catalog(query)).opportunities.map(row=>row.id),["us-2"]);
 assert.equal(fetch.mock.callCount(),1);
});

test("deadline change signals use the fetch time rather than the original publication date",async t=>{
 process.env.RADAR_DB_PATH=":memory:";
 const store=await db();
 const source="Grants.gov", original="2020-08-08";
 const [prior]=parseUs({errorcode:0,data:{oppHits:[{id:"99",title:"Changed notice",openDate:original,closeDate:"2040-12-31"}]}},original);
 await store.run("INSERT INTO sources VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET scanned=excluded.scanned,data=excluded.data",source,original,JSON.stringify([prior]));
 let fetched="";
 t.mock.method(sources,source,async (at:string)=>{
  fetched=at;
  return [{...prior,deadline:"2030-12-31",fetchedAt:at}];
 });
 const {signals}=await catalog({source});
 assert.equal(signals.length,1);
 const [signal]=signals;
 assert.equal(signal.kind,"Deadline changed");
 assert.equal(signal.observed,fetched);
 assert.equal(signal.fetchedAt,fetched);
 assert.equal(signal.postedAt,original);
 const row=(await store.all("SELECT observed FROM signals WHERE id=?",signal.id))[0];
 assert.equal(row.observed,fetched);
 const events=(await agentUpdates(0,10)).events;
 assert.deepEqual(events.map(event=>event.type),["opportunity.deadline_changed"]);
 assert.equal(events[0].newDeadline,"2030-12-31");
});
