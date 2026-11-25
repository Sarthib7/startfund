import test from "node:test";
import assert from "node:assert/strict";
import { catalogMatch, demo, profileQueries, rank, shortlist, template, type Opportunity } from "../lib/domain";
import { digestHtml } from "../lib/digest";
import { parseEu, parseHn, parseInnovateUk, parseUs } from "../lib/sources";
import { cordisFacts, nsfFacts, secFacts, ukriFact, ycFacts } from "../lib/facts";

const at="2026-11-25T12:00:00Z";
const [grant]=parseUs({errorcode:0,data:{oppHits:[{id:"12",title:"Energy software Phase I",closeDate:"12/02/2026"}]}},at);
test("US grants validate dates, URLs, and response status",()=>{
 assert.equal(grant.deadline,"2026-12-02");
 assert.equal(grant.url,"https://www.grants.gov/search-results-detail/12");
 assert.equal(grant.amount,null);
 assert.throws(()=>parseUs({errorcode:1,data:{oppHits:[]}},at));
 assert.equal(parseUs({errorcode:0,data:{oppHits:[{id:"13",title:"Grant",closeDate:"02/30/2027"}]}},at)[0].deadline,null);
});
test("EU calls keep future deadlines and exclude third-party URLs",()=>{
 const row={reference:"x",url:"https://ec.europa.eu/test",metadata:{title:["EU call"],deadlineDate:["2026-10-01","2027-04-01"],status:["31094502"]}};
 assert.equal(parseEu({results:[row]},at)[0].deadline,"2027-04-01");
 assert.deepEqual(parseEu({results:[{...row,url:"https://other.net"},{...row,metadata:{...row.metadata,status:["closed"]}}]},at),[]);
});
test("competitive calls retain their own identity, URL, deadline and status",()=>{
 const row=(id:string,status:string,start:string)=>({reference:id+"COMPETITIVE_CALLen",
  url:`https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/competitive-calls-cs/${id}`,
  metadata:{type:["8"],identifier:["HORIZON-SHARED"],title:["Parent topic"],callccm2Id:[id],callTitle:[`Competition ${id}`],
   status:[status],startDate:[start],deadlineDate:["2027-01-01"]}});
 const first=row("1","31094502","2026-11-22"), second=row("2","31094501","2026-12-01"), third=row("3","31094503","2026-10-01");
 const items=parseEu({results:[first,second,third]},at);
 assert.deepEqual(items.map(o=>[o.id,o.title,o.url,o.status,o.opensAt]),[
  ["eu-competitive-1","Competition 1",first.url,"Open","2026-11-22"],
  ["eu-competitive-2","Competition 2",second.url,"Forthcoming","2026-12-01"],
  ["eu-competitive-3","Competition 3",third.url,"Closed","2026-10-01"],
 ]);
});
test("HN results are signals and unsafe links fall back to the discussion",()=>{
 const [result]=parseHn({hits:[{objectID:"123",title:"VC news",url:"javascript:evil()",created_at_i:Date.parse("2026-11-18T09:00:00Z")/1000}]},at);
 assert.equal(result.signal,true);
 assert.equal(result.kind,"Market signal");
 assert.equal(result.postedAt,"2026-11-18T09:00:00.000Z");
 assert.equal(result.url,"https://news.ycombinator.com/item?id=123");
});
test("ranking rewards urgency and local eligibility, flags other regions and filters expired or unrequested listings",()=>{
 const variant=(id:string,patch:Partial<Opportunity>):Opportunity=>({...grant,id,...patch});
 const matches=rank([variant("later",{deadline:"2027-07-02"}),grant,variant("no",{region:"EU"}),variant("old",{deadline:"2026-09-01"})],demo,Date.parse(at));
 assert.deepEqual(matches.map(m=>m.id),["us-12","later","no"]);
 assert.match(matches[2].regionNote??"",/EU call/);
 assert.ok(matches[0].score>matches[1].score);
 assert.equal(rank([grant],{...demo,needs:["VC"]},Date.parse(at)).length,0);
 const draft=template(demo,matches[0]);
 assert.equal(draft.mode,"Template");
 assert.match(draft.subject,/Canopy Labs/);
});
test("digest escapes model-independent listing and profile content",()=>{
 const matches=rank([{...grant,title:"<script>alert(1)</script>"}],demo,Date.parse(at));
 const html=digestHtml({...demo,name:"A&B"},{matches,warnings:[],scannedAt:at});
 assert.match(html,/A&amp;B/);assert.doesNotMatch(html,/<script>/);
});
test("the shortlist keeps distinct needs visible even when one dominates",()=>{
 const grants=Array.from({length:18},(_,i)=>({...grant,id:`grant-${i}`}));
 const accelerator={...grant,id:"acc",kind:"Accelerator" as const,region:"Global" as const,deadline:null,title:"Accelerator",source:"Accelerator directory",programId:"acc"};
 const results=shortlist(rank([...grants,accelerator],demo,Date.parse(at)));
 assert.equal(results.length,14);
 assert.ok(results.some(x=>x.id==="acc"));
 assert.equal(results[0].kind,"Grant");
});
test("broad keyword matches do not overrate biomedical grants for a non-medical startup",()=>{
 const nih={...grant,id:"nih",title:"NIH energy software Phase I trial"};
 const [first,second]=rank([nih,grant],demo,Date.parse(at));
 assert.equal(first.id,grant.id);
 assert.match(second.reason,/outside your stated focus/);
 assert.match(rank([{...nih,title:"Clinical Trials Not Allowed"}],demo,Date.parse(at))[0].reason,/outside your stated focus/);
});
test("topical listings outrank broad programs and urgent high-value unrelated grants",()=>{
 const relevant={...grant,id:"manufacturing",title:"Support for manufacturing",deadline:null};
 const quantum={...grant,id:"qubit",title:"LPS Qubit Collaboratory (LQC)",deadline:"2026-11-26",amount:100_000_000,
  eligibility:"Small businesses are eligible for this Phase I funding program."};
 const clinical={...quantum,id:"nih",title:"NIH Small Business Technology Transfer Grant (Clinical Trial Optional)"};
 const aws={...grant,id:"aws",title:"AWS Activate",kind:"Growth" as const,source:"Accelerator directory",programId:"aws",region:"Global" as const,deadline:null};
 const matches=rank([quantum,clinical,aws,relevant],demo,Date.parse(at));
 assert.deepEqual(matches.map(m=>m.id),["manufacturing","aws","qubit","nih"]);
 assert.match(matches[0].reason,/Matched: manufacturers/);
 assert.ok(matches[0].score<61);
 assert.match(matches[1].reason,/General startup program/);
 assert.match(matches[2].reason,/No topical match/);
 assert.ok(matches[0].score>matches[1].score && matches[1].score>=40 && matches[2].score<25);
 assert.deepEqual(shortlist(matches).map(m=>m.id),["manufacturing","aws"]);
});
test("category reservations do not add off-topic signals or grants",()=>{
 const growth={...grant,id:"news",kind:"Growth" as const,title:"New smartphone announced",signal:true};
 const matches=rank([growth,{...grant,id:"nih",title:"NIH energy software Phase I trial"},grant],demo,Date.parse(at));
 assert.deepEqual(shortlist(matches).map(m=>m.id),[grant.id]);
});
test("profile queries expand energy and manufacturing without sending the name or email",()=>{
 const queries=profileQueries({...demo,email:"founder@example.com"});
 for(const expected of ["climate tech","energy efficiency","advanced manufacturing","decarbonization","clean energy"]) assert.ok(queries.includes(expected));
 assert.ok(queries.length<=7);
 assert.doesNotMatch(queries.join(" "),/canopy|founder@example/);
});
test("catalog query respects word boundaries",()=>{
 assert.equal(catalogMatch("NSF","Industrial products that transform the market"),false);
 assert.equal(catalogMatch("EXIST","existing programme"),false);
 assert.equal(catalogMatch("Horizon hydrogen","Horizon Europe clean hydrogen calls"),true);
 assert.equal(catalogMatch("accelerator","YC accelerators"),true);
});
test("NIH distinguishes the next standard due date, expiration and prerequisites",()=>{
 const [parent,phase2,trial]=parseUs({errorcode:0,data:{oppHits:[
  {id:"1",agencyCode:"HHS-NIH11",title:"NIH SBIR for medical devices (R43/R44)",closeDate:"04/05/2027"},
  {id:"2",agencyCode:"HHS-NIH11",title:"NIH SBIR Phase IIB for medical devices (R44)",closeDate:"04/05/2027"},
  {id:"3",agencyCode:"HHS-NIH11",title:"NIH medical devices (R03 Clinical Trial Required)",closeDate:"03/01/2027"},
 ]}},at);
 assert.equal(parent.deadline,"2027-01-05");
 assert.equal(parent.noticeExpires,"2027-04-05");
 assert.deepEqual(phase2.prerequisites,["Requires prior NIH SBIR/STTR award"]);
 const matches=rank([phase2,trial,parent],{...demo,sector:"Medical devices",description:"SBIR for diagnostic devices",plansClinicalTrial:false},Date.parse(at));
 assert.equal(matches[0].id,parent.id);
 assert.ok(matches.slice(1).every(m=>m.score<=36));
});
test("Innovate UK parses competition facts and links, not page boilerplate",()=>{
 const [row]=parseInnovateUk('<a class="govuk-link" href="/competition/2624/overview/0d597772-a841-4b82-ab80-51c09cda2206">Energy Efficiency</a><dl class="date-definition-list"><dt>Opened:</dt><dd>24 November 2026</dd><dt>Closes:</dt><dd>20 January 2027</dd></dl>',at);
 assert.equal(row.deadline,"2027-01-20");
 assert.equal(row.status,"Open");
 assert.equal(row.region,"UK");
 assert.match(row.url,/service\.gov\.uk\/competition\/2624/);
});
test("award and contribution amounts retain currency and evidence semantics",()=>{
 const [nsf]=nsfFacts({response:{award:[{id:"7",title:"SBIR",fundsObligatedAmt:"250,000",date:"11/20/2026"}]}},at);
 assert.equal(nsf.amount,250000);
 assert.equal(nsf.currency,"USD");
 const [eu]=cordisFacts({hits:{hit:[{project:{id:"8",title:"Pilot",ecMaxContribution:"30000",startDate:"2025-01-01"}}]}},at);
 assert.equal(eu.kind,"Committed project contribution");
 assert.equal(eu.currency,"EUR");
 const uk=ukriFact({id:"3",valuePounds:{currencyCode:"GBP",amount:1500},start:1515024000000},{id:"4",title:"Project"},at);
 assert.equal(uk.amount,1500);
 assert.equal(uk.currency,"GBP");
});
test("batch and SEC evidence do not imply grants, commitments, or investor checks",()=>{
 const [batch]=ycFacts([{batch:"Summer 2026"},{batch:"Summer 2026"},{batch:"Winter 2027"}],at);
 assert.equal(batch.title,"Summer 2026 · 2 directory listings");
 const [file]=secFacts({hits:{hits:[{_source:{ciks:["0002166991"],display_names:["Example Fund (CIK 0002166991)"],file_date:"2026-11-24",adsh:"0002166991-26-000001"}}]}},at);
 assert.equal(file.amount,null);
 assert.equal(file.entity,"Example Fund");
 assert.match(file.url,/2166991\/000216699126000001\//);
});
