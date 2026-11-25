import { isAdmin } from "../../../../lib/admin";
import { createBetaInvite } from "../../../../lib/beta-auth";

export const runtime="nodejs";
export async function POST(request:Request){
 if(!isAdmin(request.headers))return new Response(null,{status:404});
 if(request.headers.get("sec-fetch-site")==="cross-site")return Response.json({error:"Invalid request."},{status:403});
 const invite=await createBetaInvite();
 return Response.json({code:invite.code,expiresAt:new Date(invite.expires).toISOString()},{status:201,headers:{"Cache-Control":"no-store"}});
}
