import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { db } from "../lib/database";
import { catalog } from "../lib/store";
import { parseUs } from "../lib/sources";

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
