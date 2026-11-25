import test from "node:test";
import assert from "node:assert/strict";
import { companyUrl, inferCompany, robotsAllows } from "../lib/company";

test("company analysis rejects literal private addresses, credentials and non-HTTPS endpoints",()=>{
 for(const input of ["http://company.com","https://127.0.0.1","https://[::1]","https://user@company.com","https://company.com:8000","https://company.local","A company name"]) assert.equal(companyUrl(input),null);
 assert.equal(companyUrl("company.com/about")?.href,"https://company.com/");
});
test("company analysis obeys crawler-specific path rules and infers editable public facts",()=>{
 const robots="User-agent: *\nDisallow: /\n\nUser-agent: Startfund\nDisallow: /private*\nAllow: /private/about$";
 assert.equal(robotsAllows(robots,"/"),true);
 assert.equal(robotsAllows(robots,"/private/secret"),false);
 assert.equal(robotsAllows(robots,"/private/about"),true);
 const profile=inferCompany('<title>Werk Energy</title><meta content="Pre-seed team making clean energy hardware." name="description">',"",new URL("https://werk-energy.de"));
 assert.equal(profile.name,"Werk Energy");
 assert.equal(profile.sector,"Climate tech");
 assert.equal(profile.stage,"Pre-seed");
 assert.equal(profile.region,"DE");
 assert.equal(profile.companyCountry,"DE");
 assert.equal(inferCompany("","",new URL("https://example.fr")).companyCountry,"FR");
});
