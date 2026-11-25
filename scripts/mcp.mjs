import { createInterface } from "node:readline";

const url=new URL("/api/catalog",process.env.STARTFUND_URL||"http://127.0.0.1:3100");
const spec={name:"search_funding",description:"Search startup funding opportunities, evidence, and news/filing signals. Historical awards and filings are not open funding.",inputSchema:{
 type:"object",properties:{q:{type:"string",maxLength:120},source:{type:"string"},limit:{type:"integer",minimum:1,maximum:30}},additionalProperties:false
}};
const profile={type:"object",properties:{name:{type:"string"},description:{type:"string"},sector:{type:"string"},stage:{enum:["Idea","Pre-seed","Seed","Growth","Not sure"]},region:{enum:["US","DE","UK","EU","Other"]},needs:{type:"array",items:{enum:["Grant","Accelerator","VC","Perks","Growth"]}}},required:["name","description","sector","stage","region","needs"]};
const specs=[spec,
 {name:"analyze_company",description:"Infer a draft profile from a public company website.",inputSchema:{type:"object",properties:{company:{type:"string",maxLength:240}},required:["company"]}},
 {name:"recommend",description:"Rank funding opportunities by a confirmed startup profile.",inputSchema:{type:"object",properties:{profile},required:["profile"]}},
 {name:"builder_bundle",description:"Find official free tiers and startup credits.",inputSchema:{type:"object",properties:{profile}}},
];
const version="2025-11-25";
const supported=new Set([version,"2025-06-18","2025-03-26","2024-11-05"]);
const reply=(id,value)=>process.stdout.write(JSON.stringify({jsonrpc:"2.0",id,...value})+"\n");
async function respond(m){
 if(typeof m?.method!=="string"||m.jsonrpc!=="2.0")return reply(m?.id??null,{error:{code:-32600,message:"Invalid request"}});
 if(!Object.hasOwn(m,"id"))return;
 const result=value=>reply(m.id,{result:value});
 const error=(code,message)=>reply(m.id,{error:{code,message}});
 switch(m.method){
  case "initialize":
   return result({protocolVersion:supported.has(m.params?.protocolVersion)?m.params.protocolVersion:version,capabilities:{tools:{}},serverInfo:{name:"startfund",version:"0.1.0"}});
  case "ping":return result({});
  case "tools/list":return result({tools:specs});
  case "tools/call":{
   const name=m.params?.name;
   if(!specs.some(tool=>tool.name===name))return error(-32602,"Unknown tool");
   const args=m.params.arguments??{};
   const catalog=name===spec.name;
   const target=new URL(catalog?"/api/catalog":"/api/assistant",url);
   if(catalog)for(const k of ["q","source","limit"])if(args[k]!==undefined)target.searchParams.set(k,String(args[k]));
   try{
    const r=await fetch(target,{signal:AbortSignal.timeout(30000),
     ...(catalog?{}:{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...args,action:name})})});
    if(!r.ok)throw new Error(`Startfund HTTP ${r.status}`);
    return result({content:[{type:"text",text:JSON.stringify(await r.json())}]});
   }catch(e){return result({isError:true,content:[{type:"text",text:String(e.message)}]});}
  }
  default:return error(-32601,"Method not found");
 }
}
for await (const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
 try{await respond(JSON.parse(line));}catch{reply(null,{error:{code:-32700,message:"Invalid JSON"}});}
}
