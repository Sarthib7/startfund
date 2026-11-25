import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { profileSchema } from "../../../lib/domain";
import { radar, save } from "../../../lib/store";
export async function POST(request:Request){
 if(request.headers.get("sec-fetch-site")==="cross-site" || !request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({error:"Invalid request"},{status:403});
 const raw=await request.json().catch(()=>null);
 const profile=profileSchema.safeParse(raw);
 if(!profile.success) return NextResponse.json({error:"Check your startup profile and select at least one need."},{status:400});
 const current=request.headers.get("cookie")?.match(/(?:^|;\s*)startfund-profile=([0-9a-f-]{36})(?:;|$)/i)?.[1];
 const id=current ?? randomUUID();
 const result=await radar(profile.data);
 await save(id,profile.data,result);
 const response=NextResponse.json(result);
 response.cookies.set("startfund-profile",id,{httpOnly:true,sameSite:"lax",path:"/",secure:request.headers.get("x-forwarded-proto")==="https" || new URL(request.url).protocol==="https:",maxAge:60*60*24*90});
 return response;
}
