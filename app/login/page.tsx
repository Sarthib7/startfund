import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readBetaSession } from "../../lib/beta-auth";
import { BrandMark } from "../brand-mark";
import { LoginForm } from "./login-form";

export const dynamic="force-dynamic";
export const metadata={title:"Private beta access - Startfund",robots:{index:false,follow:false}};
function safeNext(value:string|undefined){
 return value?.startsWith("/")&&!value.startsWith("//")&&!value.includes("\\")?value:"/app";
}

export default async function Login({searchParams}:{searchParams:Promise<{next?:string|string[]}>}){
 const params=await searchParams;
 const next=safeNext(Array.isArray(params.next)?params.next[0]:params.next);
 if(readBetaSession(await headers()))redirect(next);
 return <div className="auth-shell">
  <header className="auth-nav"><Link href="/" className="brand"><BrandMark size={30}/> Startfund</Link><Link className="auth-access" href="/#waitlist">Request access</Link></header>
  <main className="auth-main">
   <section className="auth-intro">
    <p className="eyebrow"><span className="live"/> PRIVATE BETA</p>
    <h1>Funding intelligence for invited builders.</h1>
    <p>Sign in with your one-time invite code. Access opens the private funding radar.</p>
   </section>
   <section className="auth-card" aria-labelledby="signin-title">
    <div className="auth-card-head"><p className="eyebrow">SIGN IN</p><h2 id="signin-title">Access the beta.</h2><p>Enter the invite code sent to you. Codes use four groups of four characters.</p></div>
    <LoginForm next={next}/>
    <p className="auth-alt">Need an invite? <Link href="/#waitlist">Join the waitlist</Link>.</p>
   </section>
  </main>
 </div>;
}
