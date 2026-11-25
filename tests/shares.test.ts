import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { POST as share } from "../app/api/share/route";
import { createShare, getShare } from "../lib/shares";
import { save } from "../lib/store";
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

test("sharing requires the displayed scan ID to match the visitor's saved result",async()=>{
 const profileId=randomUUID(),otherProfileId=randomUUID(),oldScanId=randomUUID(),scanId=randomUUID();
 const radar={matches:[],warnings:[],scannedAt:"2026-11-25T12:00:00Z",scanId};
 await save(profileId,demo,radar);
 await save(otherProfileId,{...demo,name:"Other company"},{...radar,scanId:oldScanId});
 const publish=(id:string,scanId:string)=>share(new Request("https://example.org/api/share",{method:"POST",
  headers:{"content-type":"application/json",cookie:`startfund-profile=${id}`},body:JSON.stringify({scanId})}));
 assert.equal((await publish(profileId,oldScanId)).status,409);
 assert.equal((await publish(otherProfileId,scanId)).status,409);
 const response=await publish(profileId,scanId);
 assert.equal(response.status,201);
 const snapshot=await getShare((await response.json()).path.split("/").at(-1));
 assert.equal(snapshot?.company.name,demo.name);
});
