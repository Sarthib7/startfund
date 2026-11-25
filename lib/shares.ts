import { randomBytes } from "node:crypto";
import { db } from "./database";
import type { Profile, Radar } from "./domain";

export function publicSnapshot(profile:Profile, radar:Radar){
 return {
  company:{name:profile.name,sector:profile.sector,region:profile.region,stage:profile.stage},
  scannedAt:radar.scannedAt,
  matchCount:radar.matches.length,
  topScore:radar.matches.length?Math.max(...radar.matches.map(m=>m.score)):null,
  matches:radar.matches.slice(0,8).flatMap(({title,kind,source,url,score})=>{
   const link=URL.parse(url);
   return link?.protocol==="https:"&&!link.username&&!link.password?[{title,kind,source,url:link.href,score}]:[];
  }),
 };
}
type PublicSnapshot=ReturnType<typeof publicSnapshot>;
export async function createShare(profile:Profile, radar:Radar){
 const id=randomBytes(24).toString("base64url");
 await (await db()).run("INSERT INTO shared_scans VALUES (?,?)",id,JSON.stringify(publicSnapshot(profile,radar)));
 return id;
}
export async function getShare(id:string){
 if(!/^[\w-]{32}$/.test(id))return null;
 const [row]=await (await db()).all("SELECT data FROM shared_scans WHERE id=?",id);
 return row?JSON.parse(String(row.data)) as PublicSnapshot:null;
}
