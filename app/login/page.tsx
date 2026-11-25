import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readBetaSession } from "../../lib/beta-auth";
import { LoginForm } from "./login-form";

export const dynamic="force-dynamic";
export const metadata={title:"Private beta — Startfund",robots:{index:false,follow:false}};
function safeNext(value:string|undefined){
 return value?.startsWith("/")&&!value.startsWith("//")&&!value.includes("\\")?value:"/";
}

export default async function Login({searchParams}:{searchParams:Promise<{next?:string|string[]}>}){
 const params=await searchParams;
 const next=safeNext(Array.isArray(params.next)?params.next[0]:params.next);
 if(readBetaSession(await headers()))redirect(next);
 return <div className="shell">
  <header><span className="brand"><span aria-hidden>◎</span> Startfund</span><span className="topline">PRIVATE BETA</span></header>
  <main><div className="hero"><p className="eyebrow"><span className="live"/> PRIVATE BETA</p>
   <h1>Enter your invite code<span>.</span></h1><p>Startfund is open to invited builders during the private beta.</p>
  </div><section className="panel detail setup"><LoginForm next={next}/></section></main>
 </div>;
}
