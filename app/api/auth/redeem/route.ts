import { betaAuthConfigured, betaSessionCookie, redeemBetaInvite } from "../../../../lib/beta-auth";
import { withUsage } from "../../../../lib/usage";

export const runtime="nodejs";
const invalidInvite=()=>Response.json({error:"Invalid or expired invite code."},{status:401,headers:{"Cache-Control":"no-store"}});

export async function POST(request:Request){
 if(request.headers.get("sec-fetch-site")==="cross-site"||!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
  return Response.json({error:"Invalid request."},{status:403});
 return withUsage(request,"auth","auth:redeem",async()=>{
  if(!betaAuthConfigured())
   return Response.json({error:"Beta sign-in is unavailable."},{status:503,headers:{"Cache-Control":"no-store"}});
  const body=await request.json().catch(()=>null);
  const code=typeof body?.code==="string"?body.code:"";
  const session=code.length<=64?await redeemBetaInvite(code):null;
  if(!session)return invalidInvite();
  const response=Response.json({ok:true},{headers:{"Cache-Control":"no-store"}});
  response.headers.append("Set-Cookie",betaSessionCookie(request,session.value,session.expires));
  return response;
 });
}
