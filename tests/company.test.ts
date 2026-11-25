import test from "node:test";
import assert from "node:assert/strict";
import { companyUrl, inferCompany, readCompanyPages, robotsAllows } from "../lib/company";

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
 assert.equal(inferCompany("","",new URL("https://example.fr")).region,"EU");
 const german=inferCompany('<html lang="de"><title>Sauberer Strom | 1KOMMA5°</title><h1>Solar und Wärmepumpen</h1>',"",new URL("https://1komma5.com/de/"));
 assert.equal(german.name,"1KOMMA5°");
 assert.equal(german.region,"DE");
});
test("robots wildcard rules match literal path segments with bounded input",()=>{
 const policy="User-agent: *\nDisallow: /a*aba*ab$\nDisallow: /literal?file[1].txt$\nDisallow: /tie$\nAllow: /tie$";
 assert.equal(robotsAllows(policy,"/aXababaYab"),false);
 assert.equal(robotsAllows(policy,"/aXababaYab/more"),true);
 assert.equal(robotsAllows(policy,"/aabab"),true);
 assert.equal(robotsAllows(policy,"/literal?file[1].txt"),false);
 assert.equal(robotsAllows(policy,"/literalXfile1.txt"),true);
 assert.equal(robotsAllows(policy,"/tie"),true);
 assert.equal(robotsAllows("User-agent: *\nDisallow: /"+"a*".repeat(1024)+"b$", "/"+ "a".repeat(4096)),true);
 assert.equal(robotsAllows("User-agent: *\n"+"Disallow: /other\n".repeat(513),"/"),false);
 assert.equal(robotsAllows("User-agent: *\n#"+"x".repeat(512*1024),"/"),false);
});
test("company reader checks robots again at the redirected host and accepts successful HTML",async()=>{
 const calls:string[]=[];
 const read=async(url:URL)=>{
  calls.push(url.href);
  if(url.pathname==="/robots.txt")return {status:404,body:""};
  if(url.hostname==="rillet.com")return {status:308,body:"",location:"https://www.rillet.com/home"};
  return {status:202,body:"<title>Rillet | AI-native ERP</title><h1>Finance teams</h1>"};
 };
 const pages=await readCompanyPages(new URL("https://rillet.com"),read);
 assert.deepEqual(calls,["https://rillet.com/robots.txt","https://rillet.com/","https://www.rillet.com/robots.txt","https://www.rillet.com/home"]);
 const profile=inferCompany(pages.home,pages.about,pages.url);
 assert.equal(profile.name,"Rillet");
 assert.equal(profile.sector,"Fintech / B2B SaaS");
 assert.equal(profile.stage,"Not sure");
 await assert.rejects(readCompanyPages(new URL("https://rillet.com"),url=>
  url.hostname==="www.rillet.com"?Promise.resolve({status:200,body:"User-agent: *\nDisallow: /"}):read(url)),/does not allow/);
});
