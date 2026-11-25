import { createShare } from "../../../lib/shares";
import { saved } from "../../../lib/store";
import { withUsage } from "../../../lib/usage";

export async function POST(request:Request){
 if(request.headers.get("sec-fetch-site")==="cross-site"||!request.headers.get("content-type")?.startsWith("application/json"))
  return Response.json({error:"Invalid request."},{status:403});
 const id=request.headers.get("cookie")?.match(/(?:^|;\s*)startfund-profile=([0-9a-f-]{36})(?:;|$)/i)?.[1];
 const {scanId}=(await request.json().catch(()=>null))??{};
 if(typeof scanId!=="string"||!/^[0-9a-f-]{36}$/.test(scanId))
  return Response.json({error:"Run a scan before sharing."},{status:400});
 return withUsage(request,"share","share",async()=>{
  const record=id?await saved(id):null;
  if(!record?.digest)return Response.json({error:"Run a scan before sharing."},{status:404});
  if(record.digest.scanId!==scanId)
   return Response.json({error:"This scan is no longer current. Reload the radar or scan again before sharing."},{status:409});
  const snapshot=await createShare(record.profile,record.digest);
  return Response.json({path:`/s/${snapshot}`},{status:201,headers:{"Cache-Control":"no-store"}});
 });
}
