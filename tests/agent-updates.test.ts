import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../lib/database";
import { agentUpdates } from "../lib/store";
import { GET } from "../app/api/agent/updates/route";

process.env.RADAR_DB_PATH=":memory:";

test("agent updates use rowid cursor order, stable types, and safe fields",async()=>{
 const store=await db();
 const insert=async(id:string,kind:string,url:string,observed:string)=>store.run("INSERT INTO signals VALUES (?,?,?,?)",id,"Test source",observed,JSON.stringify({
  id,title:`${kind} title`,kind,source:"Test source",url,observed,rights:"Test rights",postedAt:"2024-12-01",fetchedAt:observed,searchText:" internal search text ",
 }));
 await insert("new-1","Newly observed","https://example.com/new","2025-01-05T00:00:00.000Z");
 await insert("deadline-2","Deadline changed","https://example.com/deadline","2025-01-02T00:00:00.000Z");
 await insert("market-3","Market signal","https://example.com/market","2025-01-04T00:00:00.000Z");
 await insert("unknown-4","constructor","https://example.com/custom","2025-01-03T00:00:00.000Z");
 await insert("unsafe-5","Newly observed","http://example.com/unsafe","2025-01-06T00:00:00.000Z");
 await insert("safe-6","Market signal","https://example.com","2025-01-01T00:00:00.000Z");
 const rowid=async(id:string)=>Number((await store.all("SELECT rowid AS cursor FROM signals WHERE id=?",id))[0].cursor);

 const first=await agentUpdates(0,2);
 assert.deepEqual(first.events.map(event=>event.id),["new-1","deadline-2"]);
 assert.deepEqual(first.events.map(event=>event.type),["opportunity.new","opportunity.deadline_changed"]);
 assert.equal(first.cursor,String(await rowid("deadline-2")));
 assert.equal(first.hasMore,true);
 assert.equal(first.events[0].observedAt,"2025-01-05T00:00:00.000Z");
 assert.equal(first.events[0].postedAt,"2024-12-01");
 assert.equal(first.events[0].fetchedAt,"2025-01-05T00:00:00.000Z");
 assert.equal(first.events[0].rights,"Test rights");

 const second=await agentUpdates(Number(first.cursor),2);
 assert.deepEqual(second.events.map(event=>event.id),["market-3","unknown-4"]);
 assert.deepEqual(second.events.map(event=>event.type),["market.signal","signal.unknown"]);
 assert.equal(second.events[1].kind,"constructor");
 assert.equal(second.cursor,String(await rowid("unknown-4")));
 assert.equal(second.hasMore,true);

 const third=await agentUpdates(Number(second.cursor),2);
 assert.deepEqual(third.events.map(event=>event.id),["safe-6"]);
 assert.equal(third.events[0].url,"https://example.com");
 assert.equal(third.cursor,String(await rowid("safe-6")));
 assert.equal(third.hasMore,false);

 const ids=[...first.events,...second.events,...third.events].map(event=>event.id);
 assert.equal(new Set(ids).size,ids.length);
 assert.deepEqual(ids,["new-1","deadline-2","market-3","unknown-4","safe-6"]);
 const serialized=JSON.stringify([first,second,third]);
 assert.ok(!serialized.includes("searchText"));
 assert.ok(!serialized.includes("internal search text"));
 assert.ok(!serialized.includes("http://example.com/unsafe"));

 await insert("filing-7","Form D pooled investment fund notice","https://example.com/filing","2025-01-07T00:00:00.000Z");
 const fourth=await agentUpdates(Number(third.cursor),1);
 assert.deepEqual(fourth.events.map(event=>event.type),["market.regulatory_filing"]);
});

test("updates route validates input, requires a bearer Pro key, and applies agent burst quota",async t=>{
 const key="test-key-longer-than-24-characters";
 const previous=process.env.RADAR_API_KEYS;
 process.env.RADAR_API_KEYS=key;
 const now=Date.UTC(2026,10,25,12);
 t.mock.method(Date,"now",()=>now);
 try{
  const url="https://example.com/api/agent/updates";
  const authorized=(suffix="")=>new Request(url+suffix,{headers:{authorization:"Bearer "+key}});
  assert.equal((await GET(authorized("?cursor=nope"))).status,400);
  assert.equal((await GET(authorized("?limit=0"))).status,400);
  assert.equal((await GET(new Request(url))).status,401);
  assert.equal((await GET(new Request(url,{headers:{authorization:"Bearer invalid-invalid-invalid-invalid"}}))).status,401);

  const first=await GET(authorized());
  assert.equal(first.status,200);
  const body=await first.json();
  assert.ok(Array.isArray(body.events));
  assert.equal(typeof body.cursor,"string");
  assert.equal(typeof body.hasMore,"boolean");
  assert.ok(!JSON.stringify(body).includes("searchText"));
  for(let i=1;i<8;i++)assert.equal((await GET(authorized())).status,200);
  const blocked=await GET(authorized());
  assert.equal(blocked.status,429);
  assert.equal(blocked.headers.get("Retry-After"),"60");
 }finally{
  if(previous===undefined)delete process.env.RADAR_API_KEYS;
  else process.env.RADAR_API_KEYS=previous;
 }
});
