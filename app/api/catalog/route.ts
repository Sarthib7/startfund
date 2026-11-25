import { catalogInput } from "../../../lib/catalog-input";
import { catalog } from "../../../lib/store";
import { withUsage } from "../../../lib/usage";

export const dynamic="force-dynamic";
export async function GET(request:Request){
 const p=new URL(request.url).searchParams;
 const input=catalogInput.safeParse({q:p.get("q")??undefined, source:p.get("source")??undefined,limit:p.has("limit")?Number(p.get("limit")):undefined});
 if(!input.success)return Response.json({error:"Invalid catalog query"},{status:400});
 return withUsage(request,"catalog","catalog",async()=>Response.json(await catalog(input.data)));
}
