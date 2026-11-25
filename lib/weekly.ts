import { digestHtml } from "./digest";
import { markSent, radar, subscriptions, updateDigest } from "./store";

export async function weekly(){
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-(now.getUTCDay()+6)%7));
  const week = monday.toISOString().slice(0,10);
  const key=process.env.RESEND_API_KEY, from=process.env.RADAR_EMAIL_FROM, allowed=process.env.RADAR_ALLOWED_RECIPIENT;
  const rows=subscriptions();
  for(const {id,profile,sent} of rows){
    const digest=await radar(profile);
    updateDigest(id,digest);
    if(!key||!from||!allowed||profile.email?.toLowerCase()!==allowed.toLowerCase()||sent===week) continue;
    const response=await fetch("https://api.resend.com/emails",{method:"POST",signal:AbortSignal.timeout(10000),
      headers:{authorization:`Bearer ${key}`,"content-type":"application/json","idempotency-key":`radar-${id}-${week}`},
      body:JSON.stringify({from,to:[profile.email],subject:"Your Startfund weekly radar",html:digestHtml(profile,digest)})});
    if(!response.ok) throw new Error(`Resend HTTP ${response.status}`);
    markSent(id,week);
  }
}
