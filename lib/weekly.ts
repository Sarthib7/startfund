import { digestHtml } from "./digest";
import { canDeliverDigest, markSent, radar, subscriptions, updateDigest } from "./store";
import { digestDelivery, digestLink, sendDigestEmail } from "./digest-delivery";

export async function weekly(){
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-(now.getUTCDay()+6)%7));
  const week = monday.toISOString().slice(0,10);
  const rows=await subscriptions();
  for(const {id,profile,sent,email,unsubscribe,version} of rows){
    const delivery=digestDelivery(email);
    if (!delivery || sent===week) continue;
    const digest=await radar(profile);
    if (!(await updateDigest(id,digest,version)) || !(await canDeliverDigest(id,unsubscribe))) continue;
    await sendDigestEmail(delivery,{to:email,subject:"Your Startfund weekly radar",
      html:digestHtml(profile,digest,digestLink(delivery.origin,"unsubscribe",unsubscribe))},`radar-${id}-${week}`);
    await markSent(id,week);
  }
}
