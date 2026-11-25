import { z } from "zod";
import { analyzeCompany } from "../../../lib/company";
import { profileSchema } from "../../../lib/domain";
import { builderBundle, completedRadar } from "../../../lib/store";
import { withUsage } from "../../../lib/usage";

const input=z.discriminatedUnion("action",[
 z.object({action:z.literal("analyze_company"),company:z.string().trim().min(1).max(240)}),
 z.object({action:z.literal("recommend"),profile:profileSchema}),
 z.object({action:z.literal("builder_bundle"),profile:profileSchema.optional()}),
]);
export async function POST(request:Request) {
 if (request.headers.get("sec-fetch-site")==="cross-site" || !request.headers.get("content-type")?.startsWith("application/json"))
  return Response.json({error:"Invalid request"},{status:403});
 const result=input.safeParse(await request.json().catch(()=>null));
 if(!result.success)return Response.json({error:"Check the company or profile details."},{status:400});
 const value=result.data;
 const action=value.action==="analyze_company"?"lookup":value.action==="recommend"?"scan":"assistant";
 return withUsage(request,action,`assistant:${value.action}`,async identity=>{
  if(value.action==="analyze_company")return Response.json(await analyzeCompany(value.company));
  if(value.action==="recommend")return Response.json(await completedRadar(value.profile,identity.actor));
  return Response.json(await builderBundle(value.profile));
 });
}
