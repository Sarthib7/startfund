import { db } from "./database";

export async function joinWaitlist(email:string,now=Date.now()){
 const normalized=email.trim().toLowerCase();
 const changed=await (await db()).run("INSERT INTO waitlist_signups(email,created) VALUES (?,?) ON CONFLICT(email) DO NOTHING",normalized,now);
 return changed?"joined":"existing";
}

export async function waitlistEntries(limit=200){
 const rows=await (await db()).all("SELECT email,created FROM waitlist_signups ORDER BY created DESC,email LIMIT ?",limit);
 return rows.map(row=>({email:String(row.email),createdAt:new Date(Number(row.created)).toISOString()}));
}
