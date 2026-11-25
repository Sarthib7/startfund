import test from "node:test";
import assert from "node:assert/strict";
import type { Match } from "../lib/domain";
import { resultOverview } from "../lib/result-overview";

test("result insights separate score bands, upcoming deadlines and reported currencies",()=>{
 const match:Match={id:"a",title:"Grant",kind:"Grant",source:"Source",region:"Global",url:"https://example.org",
  deadline:"2027-01-01",status:"Open",amount:200,currency:"USD",eligibility:null,fetchedAt:"2026-11-25",score:71,reason:"Topic"};
 const result=resultOverview([match,{...match,id:"b",score:88,kind:"VC",amount:300,currency:"EUR",deadline:"2027-03-01"},
  {...match,id:"c",score:49,amount:null,deadline:"2026-11-24"}],"2026-11-25T00:00:00Z");
 assert.deepEqual(result.scores.map(row=>row.count),[1,0,1,1]);
 assert.deepEqual(result.types,[{label:"Grant",count:2},{label:"Investor",count:1}]);
 assert.deepEqual(result.deadlines.map(row=>row.id),["a"]);
 assert.equal(result.covered,2);
 assert.deepEqual(result.amounts.map(row=>[row.currency,row.min,row.max]),[["USD",200,200],["EUR",300,300]]);
 assert.deepEqual(resultOverview([match],"2027-01-02T00:00:00Z").deadlines,[]);
});
