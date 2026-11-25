import { Resolver } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { kinds, type Profile } from "./domain";
import { cleanText } from "./sources";

const resolver=new Resolver({timeout:2000,tries:1});
const denied=new BlockList();
for(const [address,bits] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",3]] as const) denied.addSubnet(address,bits,"ipv4");
const userAgent="Startfund";
export function companyUrl(input:string) {
  let url:URL;
  try {url=new URL(input.includes("://")?input:`https://${input}`);} catch{return null;}
  if (url.protocol!=="https:" || url.username || url.password || url.port || isIP(url.hostname) ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]+$/i.test(url.hostname) ||
    /\.(?:localhost|local|test|invalid|internal|onion|example)$/i.test(url.hostname)) return null;
  return new URL(url.origin);
}
async function webPage(url:URL,limit:number):Promise<{status:number;body:string}> {
  const addresses=await resolver.resolve4(url.hostname);
  if(!addresses.length || addresses.some(ip=>denied.check(ip,"ipv4"))) throw new Error("Website address is not public");
  return new Promise((resolve,reject)=>{
    const timeout=AbortSignal.timeout(4000);
    const req=request(url,{agent:false,family:4,signal:timeout,
      headers:{"user-agent":"Startfund/0.1 (+https://github.com/Sarthib7/startfund)","accept":"text/html, text/plain"},
      lookup:(_host,_options,callback)=>callback(null,addresses[0],4)},res=>{
      if(res.statusCode!==200){res.resume();resolve({status:res.statusCode??0,body:""});return;}
      if(!/^(?:text\/html|text\/plain|application\/xhtml\+xml)(?:;|$)/i.test(String(res.headers["content-type"]??""))){
        res.resume();reject(new Error("Unsupported website response"));return;
      }
      const chunks:Buffer[]=[];let size=0;
      res.on("data",(chunk:Buffer)=>{size+=chunk.length;if(size>limit){res.destroy(new Error("Page too large"));return;}chunks.push(chunk);});
      res.on("error",reject);
      res.on("end",()=>resolve({status:200,body:Buffer.concat(chunks).toString("utf8")}));
    });
    req.on("error",reject);
    req.end();
  });
}
export function robotsAllows(robots:string,path:string) {
  const groups:{agents:string[];rules:{allow:boolean;path:string}[]}[]=[];
  for(const row of robots.split(/\r?\n/)){
    const value=row.replace(/#.*/,"").trim().match(/^(user-agent|disallow|allow)\s*:\s*(.*)$/i);
    if(!value) continue;
    const field=value[1].toLowerCase(),argument=value[2].trim();
    const last=groups.at(-1);
    if(field==="user-agent"){
      if(last && !last.rules.length) last.agents.push(argument.toLowerCase());
      else groups.push({agents:[argument.toLowerCase()],rules:[]});
    }else if(last && argument.startsWith("/")) last.rules.push({allow:field==="allow",path:argument});
  }
  const named=groups.filter(g=>g.agents.includes(userAgent.toLowerCase()));
  const candidates=named.length?named:groups.filter(g=>g.agents.includes("*"));
  const match=candidates.flatMap(g=>g.rules).filter(rule=>{
    const end=rule.path.endsWith("$");
    const pattern=(end?rule.path.slice(0,-1):rule.path).replace(/[\\^$+?.()|[\]{}]/g,"\\$&").replaceAll("*",".*");
    return new RegExp("^"+pattern+(end?"$":"")).test(path);
  }).sort((a,b)=>b.path.length-a.path.length || Number(b.allow)-Number(a.allow))[0];
  return match?.allow??true;
}
function metadata(html:string,keys:string[]) {
  for(const tag of html.match(/<meta\b[^>]+>/gi)??[]){
    const attrs=Object.fromEntries([...tag.matchAll(/([a-z:-]+)\s*=\s*(["'])(.*?)\2/gi)].map(value=>[value[1].toLowerCase(),value[3]]));
    if(keys.includes((attrs.name??attrs.property??"").toLowerCase()) && attrs.content) return attrs.content;
  }
  return "";
}
export function inferCompany(html:string,about:string,url:URL) {
  const title=metadata(html,["og:site_name","og:title"]) || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || url.hostname;
  const heading=html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const description=cleanText(metadata(html,["description","og:description"]) || metadata(about,["description","og:description"]) ||
    [heading,about.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1]].filter(Boolean).join(". "),400)??"";
  const text=`${title} ${description}`;
  const sector=/\b(climate|decarbon\w*|solar|renewable|clean energy)\b/i.test(text)?"Climate tech":
    /\b(biotech\w*|therapeutic\w*|genomic\w*)\b/i.test(text)?"Biotechnology":
    /\b(fintech|banking|payments)\b/i.test(text)?"Fintech":
    /\b(manufactur\w*|industrial)\b/i.test(text)?"Manufacturing":
    /\b(AI|artificial intelligence|machine learning)\b/i.test(text)?"AI software":
    /\b(software|SaaS)\b/i.test(text)?"Software":"";
  const region=url.hostname.endsWith(".de")?"DE":url.hostname.endsWith(".uk")?"UK":url.hostname.endsWith(".eu")?"EU":url.hostname.endsWith(".us")?"US":"Other";
  const stage=/\b(?:series [a-d]|growth.stage)\b/i.test(text)?"Growth":/\bpre.seed\b/i.test(text)?"Pre-seed":/\bseed\b/i.test(text)?"Seed":"Idea";
  return {name:cleanText(title,80)??url.hostname,description,sector,region,stage,needs:[...kinds]} satisfies Profile;
}
const cache=new Map<string,{until:number;profile:Profile}>();
let active=0;
export async function analyzeCompany(input:string):Promise<{profile?:Profile;url?:string;message?:string}> {
  const url=companyUrl(input.trim());
  if(!url)return {message:"Enter the company’s public HTTPS website, or choose Edit details to tell us about it."};
  const cached=cache.get(url.origin);
  if(cached && cached.until>Date.now())return {url:url.origin,profile:cached.profile};
  if(active>=4)return {message:"Website lookup is busy. Try again or enter your details manually."};
  active++;
  try {
    const robots=await webPage(new URL("/robots.txt",url),40_000);
    if((robots.status!==200 && robots.status!==404 && robots.status!==410) || !robotsAllows(robots.body,"/")) throw new Error("Website does not allow automated reading");
    const home=await webPage(url,400_000);
    if(home.status!==200) throw new Error("Website could not be read");
    const aboutPath=home.body.match(/href=["'](\/(?:about(?:-us)?|company)\/?)["']/i)?.[1];
    const about=aboutPath && robotsAllows(robots.body,aboutPath) ? await webPage(new URL(aboutPath,url),250_000).then(x=>x.body).catch(()=>"") : "";
    const profile=inferCompany(home.body,about,url);
    if(cache.size>=50)cache.delete(cache.keys().next().value!);
    cache.set(url.origin,{until:Date.now()+20*60_000,profile});
    return {profile,url:url.origin};
  } catch {
    return {message:"We couldn’t read that site. Try its exact HTTPS address or enter your details manually."};
  } finally {active--;}
}
