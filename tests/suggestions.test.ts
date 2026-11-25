import test from "node:test";
import assert from "node:assert/strict";
import { POST as suggest } from "../app/api/suggestions/route";
import { POST as review } from "../app/api/admin/suggestions/route";
import { approvedOpportunities, communitySource, pendingSuggestions } from "../lib/suggestions";
import { catalog, completedRadar } from "../lib/store";
import { demo, rank } from "../lib/domain";

process.env.RADAR_DB_PATH=":memory:";
const input={type:"Grant",name:"Climate hardware clean energy grant",url:"https://example.org/community",region:"Global",description:"A grant for clean energy and heat pumps.",deadline:"",amount:5000,currency:"USD",email:"submitter@example.com"};
const request=(path:string,body:unknown,token?:string)=>new Request("https://example.org"+path,{method:"POST",
 headers:{"content-type":"application/json",...(token?{authorization:"Bearer "+token}:{})},body:JSON.stringify(body)});
const submit=(data:unknown)=>suggest(request("/api/suggestions",data));
const moderate=(id:string,decision:string,token?:string)=>review(request("/api/admin/suggestions",{id,decision},token));

test("submissions validate HTTPS, ignore honeypots and enter the approval queue",async t=>{
 let now=Date.UTC(2026,10,25,11);
 t.mock.method(Date,"now",()=>now);
 assert.equal((await submit({...input,url:"http://example.org/invalid"})).status,400);
 assert.equal((await submit({...input,website:"spam"})).status,202);
 assert.equal((await submit(input)).status,429);
 assert.equal((await pendingSuggestions()).length,0);
 now+=86_400_000;
 assert.equal((await submit(input)).status,202);
 assert.equal((await submit({...input,name:"Reject me"})).status,202);
 assert.equal((await pendingSuggestions()).length,2);
 assert.deepEqual(await approvedOpportunities(),[]);
 assert.deepEqual((await catalog({source:communitySource})).opportunities,[]);
});

test("only authorized approval publishes an opportunity and invalidates its scan cache",async()=>{
 const token="test-operator-token";
 const previous=process.env.RADAR_ADMIN_TOKEN;
 process.env.RADAR_ADMIN_TOKEN=token;
 try{
  const pending=await pendingSuggestions();
  const candidate=pending.find(row=>row.name===input.name)!;
  const reject=pending.find(row=>row.name==="Reject me")!;
  const profile={...demo,sector:"Clean energy",description:"Developing climate hardware and heat pumps"};
  const load=async()=>({matches:rank(await approvedOpportunities(),profile),warnings:[],scannedAt:"2026-11-25"});
  assert.equal((await completedRadar(profile,"test",load)).matches.length,0);
  assert.equal((await moderate(candidate.id,"approved")).status,404);
  assert.equal((await moderate(candidate.id,"approved","wrong")).status,404);
  assert.equal((await moderate(reject.id,"rejected",token)).status,200);
  assert.equal((await moderate(candidate.id,"approved",token)).status,200);
  assert.equal((await moderate(candidate.id,"rejected",token)).status,409);
  assert.equal((await pendingSuggestions()).length,0);
  const listings=(await catalog({source:communitySource})).opportunities;
  assert.equal(listings.length,1);
  assert.equal(listings[0].source,communitySource);
  assert.equal(listings[0].url,input.url);
  assert.equal(JSON.stringify(listings).includes(input.email),false);
  assert.equal((await completedRadar(profile,"test",load)).matches[0]?.id,listings[0].id);
 }finally{
  if(previous===undefined)delete process.env.RADAR_ADMIN_TOKEN;
  else process.env.RADAR_ADMIN_TOKEN=previous;
 }
});
