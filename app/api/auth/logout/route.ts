import {clearBetaSessionCookie} from "../../../../lib/beta-auth";

export const runtime="nodejs";
export async function POST(request:Request){
 if(request.headers.get("sec-fetch-site")==="cross-site")return Response.json({error:"Invalid request."},{status:403});
 const response=Response.json({ok:true});
 response.headers.append("Set-Cookie",clearBetaSessionCookie(request));
 return response;
}
