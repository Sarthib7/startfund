import test from "node:test";
import assert from "node:assert/strict";
import { listingStatus } from "../lib/domain";
import { openSourceProgramGroups } from "../lib/catalog-overview";
import { curatedProgramRows } from "../lib/programs";
import { corporateProgramRows } from "../lib/facts";
import { builderBundle, catalog } from "../lib/store";

process.env.RADAR_DB_PATH=":memory:";
const at="2026-11-27T12:00:00Z";
const rows=[...curatedProgramRows(at),...corporateProgramRows(at)];
const byId=new Map(rows.map(row=>[row.id,row]));
const directIds=["nlnet-restack","nlnet-codesupply","sovereign-tech-fund","aws-open-source-credits","openai-codex-oss"];
const startupIds=["vercel-x","vercel-startups","devin-startups","grok-startups","databricks-startups","posthog-startups","datadog-startups","mongodb-startups","stripe-startups","github-startups","cloudflare-startups","aws","google","microsoft","nvidia"];

test("curated startup and open-source programs exist with truthful types and amounts",()=>{
 for(const id of [...directIds,...startupIds])assert.ok(byId.has(id),id);
 assert.deepEqual(directIds.map(id=>byId.get(id)?.openSourceEligibility),Array(5).fill("direct"));
 assert.deepEqual(startupIds.map(id=>byId.get(id)?.openSourceEligibility),Array(15).fill("startup-dependent"));
 assert.equal(byId.get("nlnet-restack")?.kind,"Grant");
 assert.equal(byId.get("nlnet-restack")?.amount,50000);
 assert.equal(byId.get("nlnet-restack")?.currency,"EUR");
 for(const row of rows.filter(row=>row.openSourceEligibility&&row.kind==="Perks"))assert.equal(row.amount,null,row.id);
 for(const row of rows.filter(row=>row.openSourceEligibility)){
  assert.match(row.url,/^https:\/\//,row.id);
  assert.ok(row.status&&row.status!=="Program link",row.id);
  assert.ok(row.verifiedAt,row.id);
 }
});

test("open-source opportunities are counted separately from startup-dependent programs",()=>{
 const [direct,startup]=openSourceProgramGroups(rows,at);
 assert.equal(direct.applyNow,5);
 assert.equal(startup.applyNow,15);
 assert.deepEqual(new Set(direct.listings.map(row=>row.id)),new Set(directIds));
 assert.deepEqual(new Set(startup.listings.map(row=>row.id)),new Set(startupIds));
});

test("closed deadlines are not counted and Vercel X closes after November 29",()=>{
 const vercel=byId.get("vercel-x")!;
 const before="2026-11-30T07:59:58Z";
 const after="2026-11-30T08:00:00Z";
 assert.equal(listingStatus(vercel,before),"Open");
 assert.equal(openSourceProgramGroups(rows,before)[1].applyNow,15);
 assert.equal(listingStatus(vercel,after),"Closed");
 assert.equal(openSourceProgramGroups(rows,after)[1].applyNow,14);
 assert.ok(!openSourceProgramGroups(rows,after)[1].listings.some(row=>row.id==="vercel-x"));
});

test("only open, rolling, and late-application rows count as apply-now possibilities",()=>{
 const base=byId.get("nlnet-restack")!;
 const synthetic=[
  {...base,id:"program-link",status:"Program link" as const,deadline:null},
  {...base,id:"closed",deadline:"2026-01-01"},
  {...base,id:"forthcoming",deadline:null,opensAt:"2999-01-01"},
  {...base,id:"late",status:"Late applications" as const,deadline:"2027-01-01"},
 ];
 const [direct]=openSourceProgramGroups(synthetic,at);
 assert.equal(direct.applyNow,1);
 assert.deepEqual(direct.listings.map(row=>row.id),["late"]);
});

test("catalog and builder bundle expose the open-source eligibility marker",async()=>{
 const data=await catalog({source:"Official program links",limit:100});
 assert.equal(data.opportunities.find(row=>row.id==="devin-startups")?.openSourceEligibility,"startup-dependent");
 assert.equal(data.opportunities.find(row=>row.id==="aws-open-source-credits")?.openSourceEligibility,"direct");
 const bundle=await builderBundle();
 assert.equal(bundle.find(row=>row.id==="devin-startups")?.openSourceEligibility,"startup-dependent");
 assert.equal(bundle.find(row=>row.id==="aws")?.openSourceEligibility,"startup-dependent");
});
