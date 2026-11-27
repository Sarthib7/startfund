import { agentUpdates, agentUpdateTypes } from "../../../../lib/store";
import { withUsage } from "../../../../lib/usage";

export const dynamic="force-dynamic";
const bearer=(request:Request)=>request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1];
export async function GET(request:Request){
 const p=new URL(request.url).searchParams;
 const cursorText=p.get("cursor")??"0", limitText=p.get("limit")??"50";
 if(!/^\d+$/.test(cursorText)||!/^\d+$/.test(limitText))return Response.json({error:"Invalid updates query"},{status:400});
 const cursor=Number(cursorText), limit=Number(limitText), type=p.get("type");
 if(!Number.isSafeInteger(cursor)||!Number.isInteger(limit)||limit<1||limit>100||(type!==null&&!agentUpdateTypes.includes(type)))return Response.json({error:"Invalid updates query"},{status:400});
 if(!bearer(request))return Response.json({error:"Bearer API key required."},{status:401});
 return withUsage(request,"agent_updates","agent:updates",async()=>Response.json(await agentUpdates(cursor,limit,type??undefined)),{proOnly:true});
}
