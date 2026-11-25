import Link from "next/link";
import { notFound } from "next/navigation";
import { ReviewQueue } from "../review-queue";

export const dynamic="force-dynamic";
export const metadata={title:"Operator sign-in — Startfund",robots:{index:false,follow:false}};

export default function AdminSignIn(){
 if(!process.env.RADAR_ADMIN_TOKEN)notFound();
 return <div className="shell">
  <header><Link href="/" className="brand"><span aria-hidden>◎</span> Startfund</Link><span className="topline">OPERATOR</span></header>
  <main><div className="hero"><p className="eyebrow"><span className="live"/> MODERATION</p>
   <h1>Opportunity review<span>.</span></h1><p>Enter the operator token to load pending suggestions.</p>
  </div><ReviewQueue/></main>
 </div>;
}
