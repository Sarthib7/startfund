import { Resolver } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { kinds, type Profile } from "./domain";
import { cleanText } from "./sources";

const resolver=new Resolver({timeout:2000,tries:1});
const denied=new BlockList();
for(const [address,bits] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",3]] as const) denied.addSubnet(address,bits,"ipv4");
const userAgent="Startfund";
const maxRobotsBytes=512*1024;
const maxRobotsRules=512;
export function companyUrl(input:string) {
  let url:URL;
  try {url=new URL(input.includes("://")?input:`https://${input}`);} catch{return null;}
  if (url.protocol!=="https:" || url.username || url.password || url.port || isIP(url.hostname) ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]+$/i.test(url.hostname) ||
    /\.(?:localhost|local|test|invalid|internal|onion|example)$/i.test(url.hostname)) return null;
  return new URL(url.origin);
}
type Page={status:number;body:string;location?:string};
const ok=(status:number)=>status>=200&&status<300;
async function webPage(url:URL,limit:number):Promise<Page> {
  const addresses=await resolver.resolve4(url.hostname);
  if(!addresses.length || addresses.some(ip=>denied.check(ip,"ipv4"))) throw new Error("Website address is not public");
  return new Promise((resolve,reject)=>{
    const timeout=AbortSignal.timeout(4000);
    const req=request(url,{agent:false,family:4,signal:timeout,
      headers:{"user-agent":"Startfund/0.1 (+https://github.com/Sarthib7/startfund)","accept":"text/html, text/plain"},
      lookup:(_host,_options,callback)=>callback(null,addresses[0],4)},res=>{
      const status=res.statusCode??0;
      if(!ok(status)||status===204||status===205){res.resume();resolve({status,body:"",location:res.headers.location});return;}
      if(!/^(?:text\/html|text\/plain|application\/xhtml\+xml)(?:;|$)/i.test(String(res.headers["content-type"]??""))){
        res.resume();reject(new Error("Unsupported website response"));return;
      }
      const chunks:Buffer[]=[];let size=0;
      res.on("data",(chunk:Buffer)=>{size+=chunk.length;if(size>limit){res.destroy(new Error("Page too large"));return;}chunks.push(chunk);});
      res.on("error",reject);
      res.on("end",()=>resolve({status,body:Buffer.concat(chunks).toString("utf8")}));
    });
    req.on("error",reject);
    req.end();
  });
}
export async function readCompanyPages(start:URL,read=webPage) {
  const policies=new Map<string,string>();
  async function follow(first:URL,limit:number,check?: (url:URL)=>Promise<void>) {
    let url=first;
    const seen=new Set<string>();
    for(let hop=0;hop<=5;hop++){
      if(!companyUrl(url.href)||seen.has(url.href))break;
      seen.add(url.href);
      await check?.(url);
      const page=await read(url,limit);
      if(![301,302,303,307,308].includes(page.status))return {page,url};
      if(!page.location)break;
      url=new URL(page.location,url);
      url.hash="";
    }
    throw new Error("Website redirects were invalid or exceeded the limit");
  }
  async function check(url:URL){
    if(!policies.has(url.origin)){
      const {page}=await follow(new URL("/robots.txt",url),maxRobotsBytes);
      if(!ok(page.status)&&![404,410].includes(page.status))throw new Error("Website does not allow automated reading");
      policies.set(url.origin,/^\s*(?:<!doctype html|<html\b)/i.test(page.body)?"":page.body);
    }
    if(!robotsAllows(policies.get(url.origin)!,url.pathname+url.search))throw new Error("Website does not allow automated reading");
  }
  const {page:home,url}=await follow(start,640_000,check);
  if(!ok(home.status)||!home.body)throw new Error("Website could not be read");
  const aboutPath=home.body.match(/href=["'](\/(?:about(?:-us)?|company)\/?)["']/i)?.[1];
  const about=aboutPath ? await follow(new URL(aboutPath,url),250_000,check).then(({page})=>ok(page.status)?page.body:"").catch(()=>"") : "";
  return {home:home.body,about,url};
}
function findLiteral(path:string,part:string,start:number,end:number) {
  const links=new Uint32Array(part.length);
  for(let i=1,prefix=0;i<part.length;i++){
    while(prefix && part[i]!==part[prefix])prefix=links[prefix-1];
    if(part[i]===part[prefix])prefix++;
    links[i]=prefix;
  }
  for(let i=start,matched=0;i<end;i++){
    while(matched && path[i]!==part[matched])matched=links[matched-1];
    if(path[i]===part[matched] && ++matched===part.length)return i+1;
  }
  return -1;
}
function robotsMatch(rule:string,path:string) {
  const anchored=rule.endsWith("$");
  const parts=(anchored?rule.slice(0,-1):rule).split("*");
  const first=parts[0];
  if(!path.startsWith(first))return false;
  if(parts.length===1)return !anchored||path.length===first.length;
  let start=first.length,end=path.length;
  if(anchored){
    const last=parts.pop()!;
    if(!path.endsWith(last))return false;
    end-=last.length;
    if(end<start)return false;
  }
  for(let i=1;i<parts.length;i++){
    if(!parts[i])continue;
    start=findLiteral(path,parts[i],start,end);
    if(start<0)return false;
  }
  return true;
}
export function robotsAllows(robots:string,path:string) {
  if(Buffer.byteLength(robots)>maxRobotsBytes)return false;
  const groups:{agents:string[];rules:{allow:boolean;path:string}[]}[]=[];
  let rules=0;
  for(const row of robots.split(/\r?\n/)){
    const value=row.replace(/#.*/,"").trim().match(/^(user-agent|disallow|allow)\s*:\s*(.*)$/i);
    if(!value) continue;
    const field=value[1].toLowerCase(),argument=value[2].trim();
    const last=groups.at(-1);
    if(field==="user-agent"){
      if(last && !last.rules.length) last.agents.push(argument.toLowerCase());
      else groups.push({agents:[argument.toLowerCase()],rules:[]});
    }else if(last && argument.startsWith("/")){
      if(++rules>maxRobotsRules)return false;
      last.rules.push({allow:field==="allow",path:argument});
    }
  }
  const named=groups.filter(g=>g.agents.includes(userAgent.toLowerCase()));
  const candidates=named.length?named:groups.filter(g=>g.agents.includes("*"));
  let best:{allow:boolean;path:string}|undefined;
  for(const {rules} of candidates)for(const rule of rules){
    if(best&&(best.path.length>rule.path.length||(best.path.length===rule.path.length&&best.allow)))continue;
    if(robotsMatch(rule.path,path))best=rule;
  }
  return best?.allow??true;
}
function metadata(html:string,keys:string[]) {
  for(const tag of html.match(/<meta\b[^>]+>/gi)??[]){
    const attrs=Object.fromEntries([...tag.matchAll(/([a-z:-]+)\s*=\s*(["'])(.*?)\2/gi)].map(value=>[value[1].toLowerCase(),value[3]]));
    if(keys.includes((attrs.name??attrs.property??"").toLowerCase()) && attrs.content) return attrs.content;
  }
  return "";
}
export function inferCompany(html:string,about:string,url:URL) {
  const title=cleanText(metadata(html,["og:title"]) || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1],200)??url.hostname;
  const titleParts=title.split(/[|—▶]/).map(part=>part.trim());
  const hostBrand=url.hostname.replace(/^www\./,"").split(".")[0].replace(/[^\p{L}\p{N}]/gu,"");
  const brand=metadata(html,["og:site_name"])||
    titleParts.find(part=>part.toLowerCase().replace(/[^\p{L}\p{N}]/gu,"")===hostBrand)||titleParts[0];
  const heading=html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const description=cleanText(metadata(html,["description","og:description"]) || metadata(about,["description","og:description"]) ||
    [heading,about.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1]].filter(Boolean).join(". "),400)??"";
  const text=`${title} ${description}`;
  const sector=/\b(climate|decarbon\w*|solar|renewable|clean energy|green hydrogen|electroly[sz]\w*|wärmepump\w*|photovolta\w*)\b/i.test(text)?"Climate tech":
    /\b(biotech\w*|therapeutic\w*|genomic\w*)\b/i.test(text)?"Biotechnology":
    /\b(fintech|banking|payments|ERP|finance teams?)\b/i.test(text)?"Fintech / B2B SaaS":
    /\b(manufactur\w*|industrial)\b/i.test(text)?"Manufacturing":
    /\b(AI|artificial intelligence|machine learning)\b/i.test(text)?"AI software":
    /\b(software|SaaS)\b/i.test(text)?"Software":"";
  const region=url.hostname.endsWith(".de")||/<html\b[^>]*\blang=["']de(?:-[a-z]+)?["']|\bImpressum\b|\b(?:based in|headquartered in) Germany\b/i.test(html+" "+about)?"DE":
    url.hostname.endsWith(".uk")||/\b(?:based in|headquartered in) (?:the )?(?:UK|United Kingdom)\b/i.test(text+" "+about)?"UK":
    url.hostname.endsWith(".us")||/\b(?:based in|headquartered in) (?:the )?(?:U\.S\.|United States)\b/i.test(text+" "+about)?"US":
    url.hostname.endsWith(".eu")?"EU":"Other";
  const stage=/\b(?:series [a-d]|growth.stage)\b/i.test(text)?"Growth":/\bpre.seed\b/i.test(text)?"Pre-seed":/\bseed (?:round|funding|stage)\b/i.test(text)?"Seed":"Not sure";
  return {name:cleanText(brand,80)??url.hostname,description,sector,region,stage,needs:[...kinds]} satisfies Profile;
}
const cache=new Map<string,{until:number;profile:Profile;url:string}>();
let active=0;
export async function analyzeCompany(input:string):Promise<{profile?:Profile;url?:string;message?:string}> {
  const url=companyUrl(input.trim());
  if(!url)return {message:"Enter the company’s public HTTPS website, or choose Edit details to tell us about it."};
  const cached=cache.get(url.origin);
  if(cached && cached.until>Date.now())return {url:cached.url,profile:cached.profile};
  if(active>=4)return {message:"Website lookup is busy. Try again or enter your details manually."};
  active++;
  try {
    const pages=await readCompanyPages(url);
    const profile=inferCompany(pages.home,pages.about,pages.url);
    if(cache.size>=50)cache.delete(cache.keys().next().value!);
    cache.set(url.origin,{until:Date.now()+20*60_000,profile,url:pages.url.href});
    return {profile,url:pages.url.href};
  } catch {
    return {message:"We couldn’t read that site. Try its exact HTTPS address or enter your details manually."};
  } finally {active--;}
}
