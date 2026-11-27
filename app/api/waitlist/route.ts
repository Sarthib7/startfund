import { z } from "zod";
import { joinWaitlist } from "../../../lib/waitlist";
import { withUsage } from "../../../lib/usage";

const inputSchema=z.object({email:z.email().max(254)});
export async function POST(request:Request){
 if(request.headers.get("sec-fetch-site")==="cross-site"||!request.headers.get("content-type")?.startsWith("application/json"))
  return Response.json({error:"Invalid request."},{status:403});
 return withUsage(request,"submission","waitlist:join",async()=>{
  const input=inputSchema.safeParse(await request.json().catch(()=>null));
  if(!input.success)return Response.json({error:"Enter a valid email address."},{status:400});
  const state=await joinWaitlist(input.data.email);
  return Response.json({state},{status:state==="joined"?201:200,headers:{"Cache-Control":"no-store"}});
 });
}
