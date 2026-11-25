import Link from "next/link";
import { BrandMark } from "../../brand-mark";
import {billingConfig} from "../../../lib/billing-state";
import {BillingControls} from "../billing-controls";

export const metadata={title:"Confirm Pro — Startfund"};
export const dynamic="force-dynamic";

export default function BillingSuccess(){
 return <div className="shell">
  <header><Link href="/" className="brand"><BrandMark/> Startfund</Link></header>
  <main><section className="panel detail">
   <div className="section-kicker">STARTFUND PRO</div><h1>Confirm your subscription</h1>
   {billingConfig()?<BillingControls success/>:<p className="badge">Coming soon</p>}
   <Link href="/pricing" className="secondary nav-link pricing-link">Back to pricing</Link>
  </section></main>
 </div>;
}
