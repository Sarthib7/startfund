import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { db } from "../lib/database";
import { plans } from "../lib/plans";
import { agentUpdates } from "../lib/store";
import { meterUsage, withUsage } from "../lib/usage";
import { GET } from "../app/api/agent/updates/route";

process.env.RADAR_DB_PATH=":memory:";
type Store=Awaited<ReturnType<typeof db>>;
const clean=async()=>{
 const store=await db();
 await store.batch([{sql:"DELETE FROM signal_events"},{sql:"DELETE FROM signals"}]);
};
const insert=async(store:Store,id:string,kind:string,url:string,observed:string,extra:Record<string,unknown>={})=>store.run("INSERT INTO signals VALUES (?,?,?,?)",id,"Test source",observed,JSON.stringify({
 id,title:`${kind} title`,kind,source:"Test source",url,observed,rights:"Test rights",postedAt:"2024-12-01",fetchedAt:observed,searchText:" internal search text ",...extra,
}));
const sequence=async(store:Store,id:string)=>Number((await store.all("SELECT seq FROM signal_events WHERE signal_id=? ORDER BY seq DESC LIMIT 1",id))[0].seq);

test("agent updates scan the durable event journal with explicit cursor and filter semantics",async()=>{
 const store=await db();
 await clean();
 await insert(store,"new-1","Newly observed","https://example.com/new","2025-01-05T00:00:00.000Z");
 await insert(store,"deadline-2","Deadline changed","https://example.com/deadline","2025-01-02T00:00:00.000Z",{deadline:"2026-03-04"});
 await insert(store,"market-3","Market signal","https://example.com/market","2025-01-04T00:00:00.000Z");
 await insert(store,"unknown-4","constructor","https://example.com/custom","2025-01-03T00:00:00.000Z");
 await insert(store,"unsafe-5","Newly observed","http://example.com/unsafe","2025-01-06T00:00:00.000Z");
 await insert(store,"safe-6","Market signal","https://example.com","2025-01-01T00:00:00.000Z");

 const first=await agentUpdates(0,2);
 assert.deepEqual(first.events.map(event=>event.id),["new-1","deadline-2"]);
 assert.deepEqual(first.events.map(event=>event.type),["opportunity.new","opportunity.deadline_changed"]);
 assert.equal(first.cursor,String(await sequence(store,"deadline-2")));
 assert.equal(first.hasMore,true);
 assert.equal(first.events[0].observedAt,"2025-01-05T00:00:00.000Z");
 assert.equal(first.events[0].postedAt,"2024-12-01");
 assert.equal(first.events[0].fetchedAt,"2025-01-05T00:00:00.000Z");
 assert.equal(first.events[0].rights,"Test rights");
 assert.equal(first.events[1].newDeadline,"2026-03-04");

 const second=await agentUpdates(Number(first.cursor),2);
 assert.deepEqual(second.events.map(event=>event.id),["market-3","unknown-4"]);
 assert.deepEqual(second.events.map(event=>event.type),["market.signal","signal.unknown"]);
 assert.equal(second.events[1].kind,"constructor");
 assert.equal(second.cursor,String(await sequence(store,"unknown-4")));
 assert.equal(second.hasMore,true);

 const third=await agentUpdates(Number(second.cursor),2);
 assert.deepEqual(third.events.map(event=>event.id),["safe-6"]);
 assert.equal(third.events[0].url,"https://example.com");
 assert.equal(third.cursor,String(await sequence(store,"safe-6")));
 assert.equal(third.hasMore,false);

 const emptyFilteredPage=await agentUpdates(0,2,"market.signal");
 assert.deepEqual(emptyFilteredPage.events,[]);
 assert.equal(emptyFilteredPage.cursor,String(await sequence(store,"deadline-2")));
 assert.equal(emptyFilteredPage.hasMore,true);
 const matchingFilteredPage=await agentUpdates(Number(emptyFilteredPage.cursor),2,"market.signal");
 assert.deepEqual(matchingFilteredPage.events.map(event=>event.id),["market-3"]);
 assert.equal(matchingFilteredPage.cursor,String(await sequence(store,"unknown-4")));
 assert.equal(matchingFilteredPage.hasMore,true);

 const serialized=JSON.stringify([first,second,third]);
 assert.ok(!serialized.includes("searchText"));
 assert.ok(!serialized.includes("internal search text"));
 assert.ok(!serialized.includes("http://example.com/unsafe"));

 await insert(store,"filing-7","Form D pooled investment fund notice","https://example.com/filing","2025-01-07T00:00:00.000Z");
 const fourth=await agentUpdates(Number(third.cursor),1);
 assert.deepEqual(fourth.events.map(event=>event.type),["market.regulatory_filing"]);

 await insert(store,"unsafe-tail","Market signal","http://example.com/unsafe-tail","2025-01-08T00:00:00.000Z");
 const unsafeTail=await agentUpdates(Number(fourth.cursor),2);
 assert.deepEqual(unsafeTail.events,[]);
 assert.equal(unsafeTail.cursor,String(await sequence(store,"unsafe-tail")));
 assert.equal(unsafeTail.hasMore,false);

 await store.run("INSERT INTO signals VALUES (?,?,?,?)","malformed-json","Test source","2025-01-08T00:00:00.000Z","not json");
 const malformed=await agentUpdates(Number(unsafeTail.cursor),1);
 assert.deepEqual(malformed.events,[]);
 assert.equal(malformed.cursor,String(await sequence(store,"malformed-json")));

 await insert(store,"deadline-null","Deadline changed","https://example.com/cleared","2025-01-09T00:00:00.000Z",{deadline:null});
 const cleared=await agentUpdates(Number(malformed.cursor),1);
 assert.equal(cleared.events[0].newDeadline,null);

 const empty=await agentUpdates(999999,2);
 assert.deepEqual(empty.events,[]);
 assert.equal(empty.cursor,"999999");
 assert.equal(empty.hasMore,false);
});

test("upserted market signals append journal events without relying on the signal rowid",async()=>{
 const store=await db();
 await clean();
 const write=(title:string,observed:string,fetchedAt=observed)=>store.run("INSERT INTO signals VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET observed=excluded.observed,data=excluded.data",
  "market-upsert","Test source",observed,JSON.stringify({id:"market-upsert",title,kind:"Market signal",source:"Test source",url:"https://example.com/market",observed,rights:"Test rights",fetchedAt}));
 await write("Original market title","2026-01-01T00:00:00.000Z");
 const initial=await agentUpdates(0,10);
 assert.deepEqual(initial.events.map(event=>event.title),["Original market title"]);
 const rowid=String((await store.all("SELECT rowid AS id FROM signals WHERE id=?","market-upsert"))[0].id);

 await write("Original market title","2026-01-01T00:00:00.000Z","2026-01-01T01:00:00.000Z");
 assert.equal((await store.all("SELECT count(*) AS count FROM signal_events WHERE signal_id=?","market-upsert"))[0].count,1);

 await write("Corrected market title","2026-01-02T00:00:00.000Z");
 const journal=await store.all("SELECT seq,data FROM signal_events WHERE signal_id=? ORDER BY seq","market-upsert");
 assert.equal(journal.length,2);
 assert.ok(Number(journal[1].seq)>Number(journal[0].seq));
 assert.match(String(journal[0].data),/Original market title/);
 assert.match(String(journal[1].data),/Corrected market title/);

 const next=await agentUpdates(Number(initial.cursor),10);
 assert.deepEqual(next.events.map(event=>event.title),["Corrected market title"]);
 assert.equal(next.cursor,String(journal[1].seq));
 assert.notEqual(next.cursor,rowid);
 assert.equal(next.hasMore,false);
});

test("updates route validates input, requires bearer auth, and accounts agent_updates separately",async t=>{
 const store=await db();
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
  assert.equal((await GET(authorized("?type=not-a-type"))).status,400);
  assert.equal((await GET(new Request(url))).status,401);
  assert.equal((await GET(new Request(url,{headers:{authorization:"Bearer invalid-invalid-invalid-invalid"}}))).status,401);
  assert.equal((await withUsage(new Request(url),"agent_updates","agent:updates",async()=>Response.json({}),{proOnly:true})).status,403);

  await clean();
  await insert(store,"route-other","Newly observed","https://example.com/route-other","2026-01-03T00:00:00.000Z");
  await insert(store,"route-market","Market signal","https://example.com/route-market","2026-01-03T00:00:00.000Z");
  const first=await GET(authorized("?type=market.signal&limit=2"));
  assert.equal(first.status,200);
  const body=await first.json();
  assert.ok(Array.isArray(body.events));
  assert.equal(body.events.length,1);
  assert.equal(body.events[0].type,"market.signal");
  assert.equal(typeof body.cursor,"string");
  assert.equal(typeof body.hasMore,"boolean");
  assert.ok(!JSON.stringify(body).includes("searchText"));
  const usageRows=await store.all("SELECT action,endpoint,runs FROM usage_daily WHERE action IN ('agent','agent_updates')");
  assert.deepEqual(usageRows.map(row=>[row.action,row.endpoint,Number(row.runs)]),[["agent_updates","agent:updates",1]]);

  for(let i=1;i<8;i++)assert.equal((await GET(authorized())).status,200);
  const blocked=await GET(authorized());
  assert.equal(blocked.status,429);
  assert.equal(blocked.headers.get("Retry-After"),"60");
  assert.equal(plans.Free.agent_updates,0);
  assert.equal(plans.Pro.agent_updates,500);
  assert.deepEqual(await meterUsage({actor:"visitor:free-updates",ip:"free-updates-ip",plan:"Free"},"agent_updates","agent:updates",now),{allowed:false,bucket:"daily",retryAfter:43200});
  assert.equal((await meterUsage({actor:"key:pro-updates",ip:"pro-updates-ip",plan:"Pro"},"agent_updates","agent:updates",now)).allowed,true);
  const proQuota={actor:"key:pro-quota",ip:"pro-quota-ip",plan:"Pro"} as const;
  for(let i=0;i<500;i++)assert.equal((await meterUsage(proQuota,"agent_updates","agent:updates",now+i*60_000)).allowed,true);
  assert.deepEqual(await meterUsage(proQuota,"agent_updates","agent:updates",now+500*60_000),{allowed:false,bucket:"daily",retryAfter:13200});
 }finally{
  if(previous===undefined)delete process.env.RADAR_API_KEYS;
  else process.env.RADAR_API_KEYS=previous;
 }
});

test("MCP bridge documents and routes get_funding_updates",async()=>{
 const requests:{url:string;authorization:unknown;client:unknown}[]=[];
 const server=createServer((request,response)=>{
  requests.push({url:request.url??"",authorization:request.headers.authorization,client:request.headers["x-startfund-client"]});
  response.writeHead(200,{"content-type":"application/json"});
  response.end(JSON.stringify({cursor:"9",hasMore:false,events:[]}));
 });
 server.listen(0,"127.0.0.1");
 await once(server,"listening");
 const address=server.address();
 if(!address||typeof address==="string")throw new Error("MCP test server did not bind a port");
 const key="test-key-longer-than-24-characters";
 const root=fileURLToPath(new URL("../",import.meta.url));
 const script=fileURLToPath(new URL("../scripts/mcp.mjs",import.meta.url));
 const child=spawn(process.execPath,[script],{
  cwd:root,stdio:["pipe","pipe","pipe"],
  env:{...process.env,STARTFUND_URL:`http://127.0.0.1:${address.port}`,STARTFUND_API_KEY:key},
 });
 const lines=createInterface({input:child.stdout});
 const iterator=lines[Symbol.asyncIterator]();
 const nextMessage=async()=>{
  const line=await iterator.next();
  if(line.done)throw new Error("MCP bridge exited");
  return JSON.parse(line.value) as {id:number;result?:any;error?:{message:string}};
 };
 const rpc=async(message:Record<string,unknown>)=>{
  child.stdin.write(JSON.stringify(message)+"\n");
  let timer:NodeJS.Timeout;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("Timed out waiting for MCP bridge")),5000);});
  try{return await Promise.race([nextMessage(),timeout]);}finally{clearTimeout(timer!);}
 };
 try{
  await rpc({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-11-25"}});
  const list=await rpc({jsonrpc:"2.0",id:2,method:"tools/list"});
  const tool=(list.result.tools as {name:string;description:string;inputSchema:{properties?:Record<string,{enum?:string[]}>}}[]).find(entry=>entry.name==="get_funding_updates");
  assert.ok(tool);
  assert.match(tool.description,/Pro-only/);
  assert.match(tool.description,/cursor/);
  assert.match(tool.description,/500 requests per UTC day/);
  assert.deepEqual(tool.inputSchema.properties?.type?.enum,["opportunity.new","opportunity.deadline_changed","market.signal","market.regulatory_filing","signal.unknown"]);

  const call=await rpc({jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"get_funding_updates",arguments:{cursor:"7",limit:3,type:"market.signal"}}});
  assert.equal(call.error,undefined);
  assert.deepEqual(JSON.parse(call.result.content[0].text),{cursor:"9",hasMore:false,events:[]});
  assert.equal(requests.length,1);
  const target=new URL(requests[0].url,"http://127.0.0.1");
  assert.equal(target.pathname,"/api/agent/updates");
  assert.equal(target.searchParams.get("cursor"),"7");
  assert.equal(target.searchParams.get("limit"),"3");
  assert.equal(target.searchParams.get("type"),"market.signal");
  assert.equal(requests[0].authorization,"Bearer "+key);
  assert.equal(requests[0].client,"mcp");
 }finally{
  child.kill("SIGKILL");
  server.close();
  await once(server,"close");
 }
});
