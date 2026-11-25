function configuration() {
  const key=process.env.RESEND_API_KEY, from=process.env.RADAR_EMAIL_FROM, allowed=process.env.RADAR_ALLOWED_RECIPIENT;
  const origin=process.env.RADAR_PUBLIC_ORIGIN;
  if (!key || !from || !origin || !allowed) return null;
  try {
    const url=new URL(origin);
    return url.protocol==="https:" ? {key,from,origin:url.origin,allowed} : null;
  } catch { return null; }
}
export const digestEmailAvailable=()=>Boolean(configuration());
export function digestDelivery(email:string) {
  const config=configuration();
  return config && email.toLowerCase()===config.allowed.toLowerCase() ? config : null;
}
export function digestLink(origin:string,mode:"confirm"|"unsubscribe",token:string) {
  return new URL("/api/digest?"+new URLSearchParams({mode,token}),origin).href;
}
export async function sendDigestEmail(delivery:{key:string;from:string},mail:{to:string;subject:string;html:string},id:string) {
  const response=await fetch("https://api.resend.com/emails",{method:"POST",signal:AbortSignal.timeout(10000),
    headers:{authorization:`Bearer ${delivery.key}`,"content-type":"application/json","idempotency-key":id},
    body:JSON.stringify({...mail,from:delivery.from,to:[mail.to]})});
  if (!response.ok) throw new Error(`Digest email HTTP ${response.status}`);
}
