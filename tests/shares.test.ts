import test from "node:test";
import assert from "node:assert/strict";
import { createShare, getShare } from "../lib/shares";
import { demo, type Match } from "../lib/domain";

process.env.RADAR_DB_PATH=":memory:";

test("stored public snapshot includes only explicit public fields and safe links",async()=>{
 const profile={...demo,email:"private@example.com",description:"Private notes",developerSubdivisions:["DE-BE"]};
 const match:Match={id:"a",title:"Seed fund",kind:"Grant",region:"Global",source:"Official source",
  url:"https://example.org/grant",deadline:null,amount:null,currency:"USD",eligibility:"Private-ish text",
  fetchedAt:"2026-11-25",score:75,reason:"Private inference"};
 const id=await createShare(profile,{matches:[match,{...match,url:"javascript:alert(1)"}],warnings:["Private warning"],scannedAt:"2026-11-25"});
 assert.match(id,/^[\w-]{32}$/);
 assert.deepEqual(await getShare(id),{
  company:{name:profile.name,sector:profile.sector,region:profile.region,stage:profile.stage},
  matches:[{title:match.title,kind:match.kind,source:match.source,url:match.url,score:match.score}],
  scannedAt:"2026-11-25",
  matchCount:2,topScore:75,
 });
 assert.equal(await getShare("not-a-link"),null);
});
