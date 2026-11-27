import { NextResponse, type NextRequest } from "next/server";
import { readBetaSession } from "./lib/beta-auth";

const apiPath=(path:string)=>path.startsWith("/api/")||path.startsWith("/eve/v1/");
function internalNext(request:NextRequest){
 const path=request.nextUrl.pathname;
 if(!path.startsWith("/")||path.startsWith("//")||path.includes("\\"))return "/";
 return path+request.nextUrl.search;
}
function loginRedirect(request:NextRequest){
 const url=request.nextUrl.clone();
 const next=internalNext(request);
 url.pathname="/login";
 url.search="";
 url.searchParams.set("next",next);
 return NextResponse.redirect(url);
}

export default function proxy(request:NextRequest){
 const path=request.nextUrl.pathname;
 const api=apiPath(path);
 if(api&&request.headers.has("authorization"))return NextResponse.next();
 if(readBetaSession(request.headers))return NextResponse.next();
 if(api)return NextResponse.json({error:"Authentication required."},{status:401,headers:{"Cache-Control":"no-store"}});
 return loginRedirect(request);
}

export const config={
 matcher:[
  "/((?!login|admin/sign-in|api/auth|api/billing/webhook|s/|_next/static|_next/image|favicon.ico|icon.svg|icon.png|apple-icon.png|sitemap.xml|robots.txt|brand/).*)",
 ],
};
