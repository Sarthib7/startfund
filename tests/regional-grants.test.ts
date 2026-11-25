import test from "node:test";
import assert from "node:assert/strict";
import { demo, listingStatus, opportunityLocation, profileSchema, rank } from "../lib/domain";
import { parseUkGovernmentGrants, sources } from "../lib/sources";
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
