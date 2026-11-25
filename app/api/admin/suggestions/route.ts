import { isAdmin } from "../../../../lib/admin";
import { pendingSuggestions, reviewSuggestion } from "../../../../lib/suggestions";

export async function GET(request:Request){
 if(!isAdmin(request.headers))return new Response(null,{status:404});
 return Response.json(await pendingSuggestions(),{headers:{"Cache-Control":"no-store"}});
}

export async function POST(request:Request){
 if(!isAdmin(request.headers))return new Response(null,{status:404});
 if(request.headers.get("sec-fetch-site")==="cross-site"||!request.headers.get("content-type")?.startsWith("application/json"))
  return Response.json({error:"Invalid request."},{status:403});
 const input=await request.json().catch(()=>null);
 if(typeof input?.id!=="string"||!["approved","rejected"].includes(input?.decision))
  return Response.json({error:"Invalid review decision."},{status:400});
 if(!await reviewSuggestion(input.id,input.decision))
  return Response.json({error:"This suggestion is no longer pending."},{status:409});
 return Response.json({ok:true});
}
