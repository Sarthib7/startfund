import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isAdmin } from "../../lib/admin";
import { pendingSuggestions } from "../../lib/suggestions";
import { ReviewQueue } from "./review-queue";

export const dynamic="force-dynamic";
export const metadata={title:"Opportunity review — Startfund",robots:{index:false,follow:false}};
export default async function Admin(){
 if(!isAdmin(await headers()))notFound();
 const pending=await pendingSuggestions();
 return <div className="shell">
  <header><Link href="/" className="brand"><span aria-hidden>◎</span> Startfund</Link><span className="topline">OPERATOR</span><Link className="secondary nav-link pricing-link" href="/admin/usage">Usage ↗</Link></header>
  <main><div className="hero"><p className="eyebrow"><span className="live"/> MODERATION</p><h1>Opportunity review<span>.</span></h1><p>Verify the official source and terms before adding a community suggestion to the catalog.</p></div>
   <ReviewQueue initial={pending}/>
  </main>
 </div>;
}
