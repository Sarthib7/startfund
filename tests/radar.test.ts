import test from "node:test";
import assert from "node:assert/strict";
import { catalogMatch, demo, profileQueries, rank, shortlist, template, type Opportunity } from "../lib/domain";
import { digestHtml } from "../lib/digest";
import { parseEu, parseHn, parseInnovateUk, parseUs, sources } from "../lib/sources";
import { cordisFacts, nsfFacts, secFacts, ukriFact, ycFacts } from "../lib/facts";
import { curatedProgramRows } from "../lib/programs";
import { catalogOverview } from "../lib/catalog-overview";

const at="2026-11-25T12:00:00Z";
const [grant]=parseUs({errorcode:0,data:{oppHits:[{id:"12",title:"Energy software Phase I",closeDate:"12/02/2026"}]}},at);
test("catalog analytics only count and link the displayed cohort",()=>{
 const data=catalogOverview([
  {...grant,id:"open",amount:15000},
  {...grant,id:"closed",deadline:"2026-11-24",amount:20000},
  {...grant,id:"rolling",status:"Rolling",deadline:null},
  {...grant,id:"future",status:"Forthcoming",opensAt:"2026-12-01"},
 ],"2026-11-25");
 assert.equal(data.total,4);
 assert.equal(data.open,2);
 assert.equal(data.withAmount,1);
 assert.deepEqual(data.byType,[{label:"Grant",count:4}]);
 assert.deepEqual(data.deadlines.map(row=>row.id),["open"]);
});
test("grant evidence matches core sectors, not disbursements, clinical labels or generic words",()=>{
 const candidate=(id:string,title:string,description:string,eligibility?:string)=>({...grant,id,title,description,eligibility:eligibility??null});
 const fintech={...demo,sector:"Fintech SaaS",description:"Automated bookkeeping and cashflow forecasting for small agencies"};
 const thermo={...demo,region:"DE" as const,sector:"Climate hardware",description:"High temperature heat pumps for industrial process heat and decarbonization"};
 const biotech={...demo,sector:"Biotechnology",description:"University team developing therapeutics"};
 const quantum={...demo,sector:"Deep tech",description:"Quantum processors for fault tolerant computing"};
 assert.ok(rank([candidate("quantum","Quantum processor pilot","Developing quantum processors")],quantum,Date.parse(at))[0].score>=40);
 assert.ok(rank([candidate("pay","Technology innovation","Payments are disbursed quarterly")],fintech,Date.parse(at))[0].score<40);
 assert.ok(rank([candidate("trial","NIH investigator award (Clinical Trial Optional)","University research")],biotech,Date.parse(at))[0].score<40);
 const thermal=rank([
  candidate("hot","Industrial heat pump pilot","Decarbonize industrial process heat"),
  candidate("reservoir","Geothermal reservoirs","High temperature energy engineering"),
 ],thermo,Date.parse(at));
 assert.equal(thermal[0].id,"hot");
 assert.ok(thermal[1].score<40);
 const [restricted]=rank([candidate("msi","Biotechnology pilot","Therapeutic development","Only Minority Serving Institutions may apply.")],biotech,Date.parse(at));
 assert.ok(restricted.score<30);
 assert.match(restricted.reason,/Applicant type is restricted/);
});
test("Grants.gov normalizes rolling and stale notices and decodes title entities",()=>{
 const [rolling,stale,expired]=parseUs({errorcode:0,data:{oppHits:[
  {id:"41",title:"Law &amp; Science &ndash; rolling",closeDate:"10/15/2076"},
  {id:"42",title:"EONS 2018",openDate:" 02/22/2018 "},
  {id:"43",title:"Expired",closeDate:"05/22/2018"},
 ]}},at);
 assert.equal(rolling.title,"Law & Science – rolling");
 assert.equal(rolling.deadline,null);
 assert.equal(rolling.status,"Rolling");
 assert.equal(stale.status,"Closed");
 assert.equal(expired.status,"Closed");
});
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
test("Horizon Europe association matches UK and other associated countries without widening other EU calls",()=>{
 const call=(identifier:string,title:string)=>({reference:identifier,url:"https://ec.europa.eu/test",metadata:{
  identifier:[identifier],title:[title],deadlineDate:["2027-04-01"],status:["31094502"],
 }});
 const items=parseEu({results:[
  call("HORIZON-CL4-2027-01","Manufacturing energy software"),
  call("HORIZON-EIC-2027-ACCELERATOR-01","Manufacturing energy software"),
  call("HORIZON-EIC-2027-ACCELERATOR-02","Equity-only manufacturing energy software"),
  call("DIGITAL-2027-01","Manufacturing energy software"),
 ]},at);
 const ids=(country:string)=>rank(items,{...demo,companyCountry:country},Date.parse(at)).map(row=>row.id).sort();
 assert.deepEqual(ids("GB"),["eu-HORIZON-CL4-2027-01","eu-HORIZON-EIC-2027-ACCELERATOR-01"]);
 for(const code of ["NO","IS","CH","IL","TR","UA"]) assert.equal(ids(code).length,3);
 assert.deepEqual(ids("CA"),["eu-HORIZON-CL4-2027-01"]);
 assert.deepEqual(ids("US"),[]);
 assert.equal(ids("FR").length,4);
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
 const html=digestHtml({...demo,name:"A&B"},{matches,warnings:["NSF Awards: topical search unavailable"],scannedAt:at});
 assert.doesNotMatch(html,/topical search unavailable/);
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
test("LedgerFlow needs real fintech scope, not generic grant language or applicant eligibility",()=>{
 const ledger={...demo,name:"LedgerFlow",sector:"Fintech SaaS",description:"Automated bookkeeping and cashflow forecasting SaaS for freelance designers and small agencies"};
 const listing=(id:string,title:string,patch:Partial<Opportunity>={}):Opportunity=>({...grant,id,title,...patch});
 const rows=[
  listing("tuna","SEFSC Bluefin Tuna Research Program",{eligibility:"Federal agencies or institutions are not eligible."}),
  listing("cipher","CIPHER Open Call 1",{description:"Test an automated cyber security SaaS platform."}),
  listing("materials","Automated Scientific Discovery — Materials Science",{description:"Materials designers run automated experiments."}),
  listing("mission","General AI and Software Innovation",{description:"AI software innovation for small businesses.",eligibility:"Financial technology businesses may apply."}),
  listing("finance","Pilot for cash flow forecasting",{description:"Research grants for small businesses testing accounting tools."}),
  ...curatedProgramRows(at),
 ];
 assert.deepEqual(shortlist(rank(rows,ledger,Date.parse(at))).filter(m=>m.kind==="Grant").map(m=>m.id),["finance"]);
 assert.ok(!shortlist(rank(rows,{...ledger,sector:"Fintech AI software innovation"},Date.parse(at))).some(m=>m.id==="mission"));
});
test("the top ten still include climate grants and parent NIH awards with real scope",()=>{
 const curated=curatedProgramRows(at);
 const genesis={...grant,id:"genesis",title:"The Genesis Mission: Transforming Science and Energy with AI",description:"Advanced manufacturing and biotechnology are listed topic areas."};
 const nasa={...grant,id:"nasa",title:"NASA University Research and Education",description:"University teams compete for Phase I SBIR and STTR."};
 const nih=[{...grant,id:"nih-sbir",title:"NIH Parent SBIR (Clinical Trial Optional)"},
   {...grant,id:"nih-sttr",title:"NIH Parent STTR (Clinical Trial Optional)"}];
 const top=(profile:typeof demo)=>shortlist(rank([genesis,nasa,...nih,...curated],profile,Date.parse(at))).slice(0,10).map(m=>m.id);
 assert.ok(["genesis","nsf-seed"].every(id=>top(demo).includes(id)));
 const biotech={...demo,name:"Biotech Lab",sector:"Biotechnology",description:"University spinout commercializing biotechnology and seeking Phase I SBIR STTR."};
 const biotechTop=top(biotech);
 assert.ok(["nsf-seed","nih-sbir","nih-sttr"].every(id=>biotechTop.includes(id)));
 assert.ok(!biotechTop.includes("nasa"));
});
test("pre-seed biomedical startups see company-eligible mechanisms before research and training",()=>{
 const listing=(id:string,title:string,eligibility?:string):Opportunity=>({...grant,id,title,
   description:"Developing diagnostics, biotechnology, medical devices, and therapeutics",eligibility:eligibility??null});
 const rows=[
  listing("parent-sbir","NIH Parent Small Business Innovation Research (SBIR R43/R44)"),
  listing("parent-sttr","NIH Parent Small Business Technology Transfer (STTR R41/R42)"),
  ...curatedProgramRows(at).filter(row=>row.id==="nsf-seed"),
  listing("small-business","Commercialization award","Small businesses may apply."),
  listing("r21","Exploratory research (R21)"),
  listing("r03","Small Research Grant (R03)"),
  listing("u01","Cooperative research agreements (U01)"),
  listing("f31","Predoctoral fellowships (F31)"),
  listing("k99","Pathway to Independence (K99/R00)"),
  listing("t15","Institutional award (T15)"),
  listing("institution","Diagnostic development","Only research institutions may apply."),
  listing("excluded","Diagnostic award for organizations","Small businesses are not eligible."),
  listing("irrelevant","SBIR for bridge inspections"),
 ];
 rows.find(row=>row.id==="irrelevant")!.description="Inspections of roadway infrastructure";
 const favored=["parent-sbir","parent-sttr","nsf-seed","small-business"];
 for(const sector of ["Biotechnology","Medtech"]){
  const profile={...demo,sector,description:"We build diagnostics and medical devices for healthcare.",needs:["Grant"] as typeof demo.needs};
  const matches=rank(rows,profile,Date.parse(at));
  assert.deepEqual(matches.slice(0,4).map(row=>row.id).sort(),[...favored].sort());
  assert.match(matches.find(row=>row.id==="r21")!.reason,/Research mechanism/);
  assert.match(matches.find(row=>row.id==="t15")!.reason,/Training or career-development/);
  assert.match(matches.find(row=>row.id==="institution")!.reason,/Institution-only eligibility/);
  assert.ok(["institution","excluded","irrelevant"].every(id=>!shortlist(matches).some(row=>row.id===id)));
 }
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
 const [parent,phase2,trial,abbreviatedTrial]=parseUs({errorcode:0,data:{oppHits:[
  {id:"1",agencyCode:"HHS-NIH11",title:"NIH SBIR for medical devices (R43/R44)",closeDate:"04/05/2027"},
  {id:"2",agencyCode:"HHS-NIH11",title:"NIH SBIR Phase IIB for medical devices (R44)",closeDate:"04/05/2027"},
  {id:"3",agencyCode:"HHS-NIH11",title:"NIH medical devices (R03 Clinical Trial Required)",closeDate:"03/01/2027"},
  {id:"4",agencyCode:"HHS-NIH11",title:"NIH medical devices (R33 CT Required)",closeDate:"03/01/2027"},
 ]}},at);
 assert.equal(parent.deadline,"2027-01-05");
 assert.equal(parent.noticeExpires,"2027-04-05");
 assert.deepEqual(phase2.prerequisites,["Requires prior NIH SBIR/STTR award"]);
 const matches=rank([phase2,trial,abbreviatedTrial,parent],{...demo,sector:"Medical devices",description:"SBIR for diagnostic devices",plansClinicalTrial:false},Date.parse(at));
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
test("Innovate UK follows the next link, deduplicates competitions and caps requests",async()=>{
 const visited:string[]=[];
 const competition=(id:number)=>`<a href="/competition/${id}/overview/0d597772-a841-4b82-ab80-51c09cda2206">Competition ${id}</a><dl class="date-definition-list"><dt>Opened:</dt><dd>24 November 2026</dd><dt>Closes:</dt><dd>20 January 2027</dd></dl>`;
 const rows=await sources["Innovate UK"](at,async (url,init)=>{
  assert.equal(new Headers(init?.headers).get("accept"),"text/html");
  const parsed=new URL(url);
  visited.push(parsed.origin+parsed.pathname);
  const index=Number(parsed.searchParams.get("page")??0);
  return competition(1)+competition(index+2)+`<a href="?page=${index+1}" rel="next">Next</a>`;
 });
 assert.equal(visited.length,5);
 assert.ok(visited.every(url=>url==="https://apply-for-innovation-funding.service.gov.uk/competition/search"));
 assert.deepEqual(rows.map(row=>row.id),[1,2,3,4,5,6].map(id=>`innovate-uk-${id}`));
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
