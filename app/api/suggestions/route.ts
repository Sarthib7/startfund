import { submitSuggestion, suggestionSchema } from "../../../lib/suggestions";
import { withUsage } from "../../../lib/usage";

export async function POST(request:Request){
 if(request.headers.get("sec-fetch-site")==="cross-site"||!request.headers.get("content-type")?.startsWith("application/json"))
  return Response.json({error:"Invalid request."},{status:403});
 return withUsage(request,"submission","submission",async()=>{
  const raw=await request.json().catch(()=>null);
  if(raw?.website)return Response.json({ok:true},{status:202});
  const input=suggestionSchema.safeParse(raw);
  if(!input.success)return Response.json({error:"Check the opportunity details, including the official HTTPS URL."},{status:400});
  await submitSuggestion(input.data);
  return Response.json({ok:true},{status:202});
 });
}
