import test from "node:test";
import assert from "node:assert/strict";
import { demo, listingStatus, opportunityLocation, profileSchema, rank, selectProfileRegion, shortlist, type Opportunity } from "../lib/domain";
import { parseInnovateUk, parseUkGovernmentGrants, sources } from "../lib/sources";
import { mergeOpportunities } from "../lib/store";

const at="2026-11-25T12:00:00Z";
const sample={
 grantName:"Innovation software for energy", label:"innovation-software-grant-1",grantApplicantType:["Private Sector"],
 grantLocation:["National","England","Scotland"],grantShortDescription:"<p>Industrial innovation funding.</p>",
 grantMaximumAward:75000,grantApplicationOpenDate:"2026-11-20T09:00",grantApplicationCloseDate:"2026-12-20T17:00",
};
const html=(searchResult:unknown[],totalGrants=searchResult.length)=>
 `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({props:{pageProps:{searchResult,totalGrants}}})}</script>`;

test("UK Find a Grant reads official private-sector entries and preserves national or devolved scope",async()=>{
 const page=html([sample,
  {...sample,label:"scotland-1",grantLocation:["Scotland"],grantApplicationOpenDate:"2027-01-01",grantApplicationCloseDate:"2027-03-01"},
  {...sample,label:"england-1",grantLocation:["Midlands"],grantApplicationCloseDate:undefined},
  {...sample,label:"public-1",grantApplicantType:["Public Sector"]},
  {...sample,label:"bad/url"},
 ],11);
 const {rows,totalGrants}=parseUkGovernmentGrants(page,at);
 assert.equal(totalGrants,11);
 assert.deepEqual(rows.map(r=>[r.id,r.countries,r.subdivisions,r.status]),[
  ["gb-find-innovation-software-grant-1",["GB"],undefined,"Open"],
  ["gb-find-scotland-1",["GB"],["GB-SCT"],"Forthcoming"],
  ["gb-find-england-1",["GB"],["GB-ENG"],"Program link"],
 ]);
 assert.equal(rows[0].amount,75000);
 assert.equal(rows[0].description,"Industrial innovation funding.");
 assert.equal(rows[0].url,"https://www.find-government-grants.service.gov.uk/grants/innovation-software-grant-1");
 assert.throws(()=>parseUkGovernmentGrants("<html>Service unavailable</html>",at));
 const requested:string[]=[];
 const results=await sources["UK Find a Grant"](at,async url=>{
  requested.push(url);
  return new URL(url).searchParams.has("page")?html([sample,{...sample,label:"page-two-1"}]):page;
 });
 assert.equal(requested.length,2);
 assert.equal(results.length,4);
 const england=profileSchema.parse({...demo,companySubdivision:"GB-ENG"});
 assert.deepEqual(rank(rows,england,Date.parse(at)).map(r=>r.id).sort(),["gb-find-england-1","gb-find-innovation-software-grant-1"]);
});

test("curated programs use country or exact subdivision from either company or developer locations",async()=>{
 const programs=await sources["Government program links"](at);
 assert.ok(programs.every(r=>r.status==="Program link" && r.deadline===null && r.url.startsWith("https:")));
 const ids=(location:Partial<typeof demo>)=>rank(programs,profileSchema.parse({...demo,...location}),Date.parse(at)).map(r=>r.id);
 const california=ids({companySubdivision:" us-ca "});
 assert.ok(california.includes("us-ca-grants"));
 assert.ok(!california.includes("us-ny-img"));
 assert.ok(!ids({companyCountry:"US"}).includes("us-ca-grants"));
 const france=ids({companyCountry:"JP",developerSubdivisions:["fr-idf"]});
 assert.ok(france.includes("fr-french-tech") && france.includes("fr-innovup"));
 assert.ok(!ids({companyCountry:"FR"}).includes("fr-innovup"));
 const india=ids({companySubdivision:"IN-KA"});
 assert.ok(india.includes("in-seed-fund") && india.includes("in-elevate") && !india.includes("in-ksum"));
 assert.equal(opportunityLocation(programs.find(r=>r.id==="in-elevate")!),"Program location: IN-KA");
 assert.equal(opportunityLocation(programs.find(r=>r.id==="in-seed-fund")!),"Program location: IN");
 const scotland=ids({companyCountry:"UK",companySubdivision:"GB-SCT"});
 assert.ok(scotland.includes("gb-scot-scale") && !scotland.includes("gb-wales-smart"));
 assert.equal(profileSchema.safeParse({...demo,companyCountry:"FR",companySubdivision:"US-CA"}).success,false);
});

test("UK Find a Grant honors GMT and BST closing times, including for cached listings",()=>{
 const winter={...sample,grantApplicationCloseDate:"2026-11-25T11:00"};
 const summer={...sample,grantApplicationOpenDate:"2027-03-01",grantApplicationCloseDate:"2027-07-01T11:00"};
 const {rows}=parseUkGovernmentGrants(html([winter,summer]),at);
 assert.equal(rows[0].deadline,"2026-11-25T11:00:00.000Z");
 assert.equal(rows[0].status,"Closed");
 assert.equal(rows[1].deadline,"2027-07-01T10:00:00.000Z");
 assert.equal(listingStatus({...rows[1],status:"Open"},"2027-07-01T10:00:00Z"),"Closed");
});

test("cross-feed duplicate competitions keep the direct listing and exact deadline without merging different rounds",()=>{
 const [find]=parseUkGovernmentGrants(html([{...sample,grantName:"Battery Innovation: Concept Development Rd 3"}]),at).rows;
 const innovate={...find,id:"innovate-uk-2572",source:"Innovate UK",title:"Battery Innovation – Concept Development Rd 3",
  url:"https://apply-for-innovation-funding.service.gov.uk/competition/2572/overview/id",deadline:"2026-12-20",amount:null,description:undefined};
 const next={...find,id:"another-call",deadline:"2027-03-01"};
 const [first,second]=mergeOpportunities([innovate,find,next]);
 assert.equal(first.id,innovate.id);
 assert.equal(first.url,innovate.url);
 assert.equal(first.deadline,find.deadline);
 assert.equal(first.amount,find.amount);
 assert.equal(second.id,next.id);
 const sameUrl={...find,title:"Different spelling",url:innovate.url+"/?utm_source=find"};
 assert.deepEqual(mergeOpportunities([sameUrl,innovate]).map(o=>o.id),[innovate.id]);
});

test("a deduplicated Innovate UK competition retains the subdivision from Find a Grant",()=>{
 const [find]=parseUkGovernmentGrants(html([{...sample,grantLocation:["Scotland"]}]),at).rows;
 const innovate=parseInnovateUk(`<a href="/competition/2624/overview/0d597772-a841-4b82-ab80-51c09cda2206">${sample.grantName}</a><dl class="date-definition-list"><dt>Opened:</dt><dd>20 November 2026</dd><dt>Closes:</dt><dd>20 December 2026</dd></dl>`,at);
 assert.equal(innovate.length,1);
 const merged=mergeOpportunities([find,...innovate]);
 assert.equal(merged.length,1);
 assert.equal(merged[0].id,innovate[0].id);
 assert.deepEqual(merged[0].subdivisions,["GB-SCT"]);
 assert.equal(rank(merged,{...demo,companyCountry:"GB",companySubdivision:"GB-ENG"},Date.parse(at)).length,0);
 assert.equal(rank(merged,{...demo,companyCountry:"GB",companySubdivision:"GB-SCT"},Date.parse(at)).length,1);
});

test("international UK Find a Grant listings reach UK teams when the publisher or invitation supports it",()=>{
 const international={...sample,grantLocation:["International"]};
 const {rows}=parseUkGovernmentGrants(html([
  {...international,label:"aria-1",grantFunder:"Advanced Research and Invention Agency"},
  {...international,label:"invited-1",grantShortDescription:"UK-based businesses are eligible to bid."},
  {...international,label:"unknown-1"},
  {...international,label:"scotland-international-1",grantFunder:"Innovate UK",grantLocation:["International","Scotland"]},
 ]),at);
 assert.deepEqual(rank(rows,{...demo,companyCountry:"GB"},Date.parse(at)).map(r=>r.id).sort(),["gb-find-aria-1","gb-find-invited-1"]);
 assert.deepEqual(rank(rows,{...demo,companyCountry:"IN"},Date.parse(at)),[]);
});

test("curated grant fit differentiates scope, stage and sector for the same founder",async()=>{
 const items=await sources["Government program links"](at);
 const founder={...demo,companySubdivision:"IN-KA",sector:"Technology",description:"Building a proof of concept and prototype."};
 const early=rank(items,founder,Date.parse(at));
 const elevate=early.find(row=>row.id==="in-elevate")!;
 const seed=early.find(row=>row.id==="in-seed-fund")!;
 assert.ok(elevate.score>seed.score);
 assert.match(elevate.reason,/Matches your state or region.*Matches your stage/);
 assert.ok(seed.score>rank(items,{...founder,stage:"Growth"},Date.parse(at)).find(r=>r.id===seed.id)!.score);
 assert.ok(early.find(r=>r.id==="in-birac")!.score<30);
 const biotech=rank(items,{...founder,sector:"Biotechnology",description:"Developing healthcare medical devices."},Date.parse(at));
 assert.ok(biotech.find(r=>r.id==="in-birac")!.score>early.find(r=>r.id==="in-birac")!.score);
});

test("automatic region follows company country without replacing explicit or legacy region values",()=>{
 for(const [companyCountry,region] of [["FR","EU"],["GB","UK"],["US","US"],["DE","DE"],["IN","Other"]]){
  assert.equal(profileSchema.parse({...demo,region:undefined,companyCountry}).region,region);
  assert.equal(profileSchema.parse({...demo,regionExplicit:false,companyCountry}).region,region);
 }
 assert.equal(profileSchema.parse({...demo,companyCountry:"FR",regionExplicit:true}).region,"US");
 assert.equal(profileSchema.parse({...demo,region:"UK"}).region,"UK");
 assert.equal(profileSchema.parse({...demo,regionExplicit:false,companySubdivision:"IN-KA"}).region,"Other");
});

test("switching back to Automatic restores the company region inferred without a country code",()=>{
 const inferred={...demo,region:"DE",regionExplicit:false} as const;
 const manual=selectProfileRegion(selectProfileRegion(inferred,"US"),"UK");
 const saved=profileSchema.parse(JSON.parse(JSON.stringify(manual)));
 assert.equal(saved.region,"UK");
 const automatic=profileSchema.parse(selectProfileRegion(saved));
 assert.equal(automatic.region,"DE");
 assert.equal(automatic.regionExplicit,false);
 assert.equal(selectProfileRegion({...saved,companyCountry:"FR"}).region,"EU");
 assert.equal(selectProfileRegion({...saved,inferredRegion:undefined}).region,"Other");
});

test("the shortlist reserves two slots for matched national and regional grants among higher-ranked EU calls",async()=>{
 const programs=await sources["Government program links"](at);
 const profile=profileSchema.parse({...demo,companyCountry:"FR",companySubdivision:"FR-IDF",regionExplicit:false,needs:["Grant"],
  sector:"Climate tech and manufacturing",description:"We build industrial decarbonisation and clean energy software for manufacturing."});
 const eu:Opportunity={id:"eu",title:"Industrial decarbonisation, manufacturing and clean energy",kind:"Grant",
  source:"EU Funding & Tenders",region:"EU",deadline:"2026-11-28",status:"Open",amount:1_000_000,currency:"EUR",
  eligibility:null,url:"https://ec.europa.eu/",fetchedAt:at};
 const calls=Array.from({length:16},(_,i)=>({...eu,id:"eu-"+i}));
 const matches=rank([...calls,...programs],profile,Date.parse(at));
 assert.ok(matches.slice(0,14).every(row=>row.region==="EU"));
 const selected=shortlist(matches);
 assert.equal(selected.length,14);
 assert.equal(selected.filter(row=>row.region==="EU").length,12);
 assert.deepEqual(selected.filter(row=>row.localGovernmentGrant).map(row=>row.id).sort(),["fr-2030","fr-innovup"]);
 assert.deepEqual(shortlist(matches.filter(row=>row.id!=="fr-innovup" && row.id!=="fr-french-tech"))
  .filter(row=>row.localGovernmentGrant).map(row=>row.id),["fr-2030"]);
});
