import test from "node:test";
import assert from "node:assert/strict";
import { demo, rank, shortlist, template, type Opportunity } from "../lib/domain";
import { digestHtml } from "../lib/digest";
import { parseEu, parseHn, parseUs } from "../lib/sources";
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
test("HN results are signals and unsafe links fall back to the discussion",()=>{
 const [result]=parseHn({hits:[{objectID:"123",title:"VC news",url:"javascript:evil()"}]},at,"VC");
 assert.equal(result.signal,true);
 assert.equal(result.url,"https://news.ycombinator.com/item?id=123");
});
test("ranking rewards relevant, urgent listings and filters expired, regions and needs",()=>{
 const variant=(id:string,patch:Partial<Opportunity>):Opportunity=>({...grant,id,...patch});
 const matches=rank([variant("later",{deadline:"2027-07-02"}),grant,variant("no",{region:"EU"}),variant("old",{deadline:"2026-09-01"})],demo,Date.parse(at));
 assert.deepEqual(matches.map(m=>m.id),["us-12","later"]);
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
 const accelerator={...grant,id:"acc",kind:"Accelerator" as const,region:"Global" as const,deadline:null,title:"Accelerator"};
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
