import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { confirmSubscription, digestSubscription, removeSubscription, requestSubscription, saved, unsubscribeDigest } from "../../../lib/store";
import { digestDelivery, digestLink, sendDigestEmail } from "../../../lib/digest-delivery";

async function profileId(){ return (await cookies()).get("startfund-profile")?.value; }
const tokenPattern=/^[a-f0-9]{64}$/;
const createToken=()=>randomBytes(32).toString("hex");
function linkAction(request:Request) {
  const {searchParams}=new URL(request.url);
  const mode=searchParams.get("mode"), token=searchParams.get("token")??"";
  return (mode==="confirm" || mode==="unsubscribe") && tokenPattern.test(token) ? {mode,token} : null;
}
function page(message:string,button?:string) {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Startfund digest</title><main><h1>${message}</h1>${button ? `<form method="post"><button>${button}</button></form>` : '<a href="/">Back to Startfund</a>'}</main></html>`,
    {headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","referrer-policy":"no-referrer"}});
}
export async function GET(request:Request) {
  const action=linkAction(request);
  if (action) return action.mode==="confirm" ? page("Confirm your weekly digest subscription","Confirm subscription") :
    page("Unsubscribe from the weekly digest","Unsubscribe");
  const id=await profileId();
  return Response.json({state:id ? digestSubscription(id) : "off"},{headers:{"cache-control":"no-store"}});
}
export async function POST(request:Request) {
  if (request.headers.get("sec-fetch-site")==="cross-site") return new Response(null,{status:403});
  const action=linkAction(request);
  if (action) {
    if (action.mode==="confirm") return page(confirmSubscription(action.token) ? "You’re subscribed to the weekly digest." : "This confirmation link has expired or was already used.");
    return page(unsubscribeDigest(action.token) ? "You’re unsubscribed." : "This subscription is no longer active.");
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) return new Response(null,{status:415});
  const id=await profileId();
  if (!id || !saved(id)) return Response.json({error:"Scan opportunities before subscribing."},{status:400});
  const value=z.union([z.object({action:z.literal("unsubscribe")}),z.object({action:z.literal("subscribe"),email:z.email().max(254)})])
    .safeParse(await request.json().catch(()=>null));
  if (!value.success) return Response.json({error:"Enter a valid email address."},{status:400});
  if (value.data.action==="unsubscribe") {
    removeSubscription(id);
    return Response.json({state:"off"});
  }
  const {email}=value.data, delivery=digestDelivery(email);
  if (!delivery) return Response.json({error:"Email subscription is unavailable for this address. You can still preview the digest."},{status:503});
  const token=createToken();
  if (!requestSubscription(id,email,token,createToken())) return Response.json({state:digestSubscription(id)});
  try {
    const link=digestLink(delivery.origin,"confirm",token).replaceAll("&","&amp;");
    await sendDigestEmail(delivery,{to:email,subject:"Confirm your Startfund weekly digest",
      html:`<p><a href="${link}">Confirm your weekly digest subscription</a>. This link expires in 24 hours.</p>`},`digest-confirm-${token}`);
  } catch {
    removeSubscription(id);
    return Response.json({error:"Could not send the confirmation. Try again later."},{status:503});
  }
  return Response.json({state:"pending"});
}
