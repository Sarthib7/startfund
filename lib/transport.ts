export type Reader = (url:string, init?:RequestInit)=>Promise<unknown>;
export type Snapshot = { url:string; body:string; etag:string|null; modified:string|null };
export function reader(options:{contact?:string; lookUp?:(url:string)=>Snapshot|undefined; capture?:(s:Snapshot)=>void}={}):Reader{
 return async (url,init)=>{
  const headers=new Headers(init?.headers);
  if (!headers.has("accept")) headers.set("accept","application/json");
  const text=["text/html","text/plain","application/rss+xml","application/xml","text/xml"].includes(headers.get("accept")??"");
  headers.set("user-agent",["Startfund/0.1", options.contact || "https://github.com/Sarthib7/startfund"].join(" "));
  const previous=(!init?.method || init.method==="GET") ? options.lookUp?.(url) : undefined;
  if(previous?.etag) headers.set("if-none-match",previous.etag);
  if(previous?.modified) headers.set("if-modified-since",previous.modified);
  const r=await fetch(url,{...init,headers,signal:AbortSignal.timeout(8000),cache:"no-store"});
  if(r.status===304 && previous) return text ? previous.body : JSON.parse(previous.body);
  if(!r.ok) throw new Error(`Source HTTP ${r.status}`);
  const original=await r.text();
  const parsed=text ? original : JSON.parse(original);
  let body=original;
  if(new URL(url).hostname==="api.grants.gov" && typeof parsed==="object" && parsed?.token){
    const {token:_token,...rest}=parsed;
    body=JSON.stringify(rest);
  }
  options.capture?.({url,body,etag:r.headers.get("etag"),modified:r.headers.get("last-modified")});
  return parsed;
 };
}
export function post(read:Reader,url:string,data:object){
 return read(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)});
}
