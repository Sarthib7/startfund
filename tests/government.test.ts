import test from "node:test";
import assert from "node:assert/strict";
import { catalogMatch, demo, profileSchema, rank, type Opportunity } from "../lib/domain";
import { parseGermanFeed, parseGermanGrant, parseTed, searchTed, sources } from "../lib/sources";
import { save, saved } from "../lib/store";
import { reader } from "../lib/transport";

const at="2026-11-25T12:00:00Z";
const notice={
 "publication-number":"123456-2026",
 "notice-title":{deu:"Energie und Software",eng:"Energy and manufacturing software"},
 "main-classification-proc":["72200000"],
 "place-of-performance-country-lot":["DEU","DEU","FRA"],
 "place-of-performance-country-proc":["NLD"],
 "publication-date":"2026-11-23+01:00",
 "deadline-receipt-tender-date-lot":["2026-11-22+01:00","2026-12-15+01:00","2026-12-02+01:00"],
};
const feed=`<?xml version="1.0"?><rss version="2.0"><channel>
 <item><title><![CDATA[Energy &amp; manufacturing software]]></title><link>https://www.foerderdatenbank.de/FDB/Content/DE/Foerderprogramm/Land/NRW/energy.html?campaign=rss&amp;id=1</link><pubDate>Tue, 24 Nov 2026 15:41:00 +0100</pubDate><description><![CDATA[<p>Photonics and optics prototyping.</p>]]></description></item>
 <item><title>F&#246;rderung</title><link>https://www.foerderdatenbank.de/FDB/Content/DE/Foerderprogramm/Bund/BMDS/research.html</link><description>Der Bund unterstützt Unternehmen mit Zuschüssen.</description></item>
 <item><title>Untrusted</title><link>https://example.com/FDB/Content/DE/Foerderprogramm/Bund/BMDS/research.html</link></item>
 </channel></rss>`;
const detail=`<dl class="document-info-fundingprogram">
 <dt> Förderart: </dt><dd> Zuschuss </dd><dt> Fördergebiet: </dt><dd> Nordrhein-Westfalen </dd>
 <dt> Förderberechtigte: </dt><dd> Unternehmen </dd></dl>`;
const [tender]=parseTed({notices:[notice]},at);

test("TED normalizes currently open procurement, keeping place-of-performance countries and the next lot deadline",async()=>{
 assert.equal(tender.kind,"Tender");
 assert.equal(tender.title,notice["notice-title"].eng);
 assert.deepEqual(tender.countries,["DE","FR","NL"]);
 assert.equal(tender.deadline,"2026-12-02");
 assert.equal(tender.url,"https://ted.europa.eu/en/notice/-/detail/123456-2026");
 assert.deepEqual(parseTed({notices:[{...notice,"deadline-receipt-tender-date-lot":["2026-11-22"]}]},at),[]);
 assert.throws(()=>parseTed({notices:[],timedOut:true},at));
 const rows=await searchTed(at,async(url,init)=>{
  assert.equal(url,"https://api.ted.europa.eu/v3/notices/search");
  const request=JSON.parse(String(init?.body));
  assert.equal(request.scope,"ACTIVE");
  assert.ok(request.fields.includes("main-classification-proc"));
  assert.match(request.query,/main-classification-proc IN \(72\*, 48\*, 73\*, 302\*, 793\*, 794\*, 642\*, 713\*\)/);
  for(const field of ["main-classification-proc","main-classification-lot","additional-classification-proc","additional-classification-lot"]){
   assert.ok(request.fields.includes(field));
   assert.ok(request.query.includes(`NOT ${field} = 45*`));
  }
  assert.match(request.query,/place-of-performance-country-lot IN \(DEU\)/);
  return {notices:[notice]};
 },["DE"]);
 assert.deepEqual(rows,[tender]);
});

test("TED drops construction and unclassified notices even when the API returns them",()=>{
 const construction={...notice,"publication-number":"123457-2026","main-classification-proc":["45231300"]};
 const mixed={...notice,"publication-number":"123458-2026","main-classification-proc":["72200000","45310000"]};
 const unknown={...notice,"publication-number":"123459-2026","main-classification-proc":undefined};
 assert.deepEqual(parseTed({notices:[construction,mixed,unknown,notice]},at).map(o=>o.id),[tender.id]);
});

test("TED rejects 685481-2026 when construction is listed as an additional procedure or lot CPV",()=>{
 const engineering={...notice,"publication-number":"685481-2026","main-classification-proc":["71300000"],"main-classification-lot":["71300000"]};
 for(const field of ["additional-classification-proc","additional-classification-lot","main-classification-lot"]){
  assert.deepEqual(parseTed({notices:[{...engineering,[field]:["45220000"]}]},at),[]);
 }
 assert.deepEqual(parseTed({notices:[{...engineering,"additional-classification-lot":["48000000"]}]},at)[0].cpvCodes,["71300000","48000000"]);
});

test("saved radar results do not surface tenders from before CPV filtering",async t=>{
 const previous=process.env.RADAR_DB_PATH;
 process.env.RADAR_DB_PATH=":memory:";
 t.after(()=>{if(previous===undefined) delete process.env.RADAR_DB_PATH; else process.env.RADAR_DB_PATH=previous;});
 const match={...tender,score:82,reason:"Matched software"};
 await save("legacy-tenders",demo,{matches:[{...match,id:"legacy",cpvScope:undefined},match],warnings:[],scannedAt:at});
 assert.deepEqual((await saved("legacy-tenders"))?.digest?.matches,[match]);
});

test("Förderdatenbank verifies subsidy type on federal and Länder details without assuming an application window",async()=>{
 const entries=parseGermanFeed(feed);
 assert.equal(entries.length,2);
 assert.equal(entries[0].postedAt,"2026-11-24");
 assert.equal(entries[0].title,"Energy & manufacturing software");
 assert.equal(entries[1].title,"Förderung");
 assert.match(entries[0].url,/energy\.html$/);
 assert.equal(parseGermanGrant(entries[1],detail.replace("Zuschuss","Darlehen"),at),null);
 assert.equal(parseGermanGrant(entries[1],"<html>Unavailable</html>",at)?.programme,"Federal program");
 assert.throws(()=>parseGermanGrant(entries[0],"<html>Unavailable</html>",at));
 assert.throws(()=>parseGermanFeed("<html>Service unavailable</html>"));
 const rows=await sources["Förderdatenbank"](at,async(url,init)=>{
  if(url.endsWith(".xml")) {
   assert.equal(new Headers(init?.headers).get("accept"),"application/rss+xml");
   return feed;
  }
  return url===entries[1].url ? detail.replace("Nordrhein-Westfalen","Bundesweit") : detail;
 });
 assert.deepEqual(rows.map(o=>[o.kind,o.status,o.region,o.programme,o.deadline]),[
  ["Grant","Program link","DE","Nordrhein-Westfalen",null],["Grant","Program link","DE","Bundesweit",null],
 ]);
 assert.equal(rows[0].description,"Photonics and optics prototyping.");
 assert.equal(catalogMatch("photonics",rows[0].description??""),true);
 const matches=rank(rows,{...demo,companySubdivision:"DE-NW",sector:"Photonics",description:"Photonics and optics prototyping"},Date.parse(at));
 assert.ok(matches.find(o=>o.id===rows[0].id)?.matchedTerms?.includes("photonics"));
});

test("transport reads and reuses RSS as text rather than parsing JSON",async t=>{
 const mock=t.mock.method(globalThis,"fetch",async()=>new Response(feed,{headers:{etag:'"v1"'}}));
 const read=reader({lookUp:url=>({url,body:feed,etag:'"v1"',modified:null})});
 const url="https://www.foerderdatenbank.de/example.xml", init={headers:{accept:"application/rss+xml"}};
 assert.equal(await read(url,init),feed);
 mock.mock.mockImplementation(async()=>new Response(null,{status:304}));
 assert.equal(await read(url,init),feed);
});

test("company and developer countries match national grants and tenders, while EU grants match any EU base",()=>{
 const company=profileSchema.parse({...demo,companyCountry:" us ",developerCountries:[" fr ","uk"],needs:["Grant","Tender"]});
 assert.deepEqual(company.developerCountries,["FR","GB"]);
 assert.equal(profileSchema.safeParse({...demo,companyCountry:"XX"}).success,false);
 const eu:Opportunity={...tender,id:"eu",kind:"Grant",countries:undefined,source:"EU Funding & Tenders"};
 const uk:Opportunity={...eu,id:"uk",region:"UK",source:"Innovate UK"};
 const de:Opportunity={...eu,id:"de",region:"DE",source:"Förderdatenbank"};
 const items=[tender,eu,uk,de], now=Date.parse(at);
 assert.deepEqual(rank(items,company,now).map(o=>o.id).sort(),["eu",tender.id,"uk"].sort());
 assert.deepEqual(rank(items,{...company,companyCountry:"ES",developerCountries:[]},now).map(o=>o.id),["eu"]);
 assert.deepEqual(rank(items,{...demo,region:"DE"},now).find(o=>o.id===tender.id)?.countries,tender.countries);
 assert.equal(rank(items,{...demo,region:"EU"},now).some(o=>o.kind==="Tender"),false);
});
