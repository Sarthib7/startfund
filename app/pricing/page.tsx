import Link from "next/link";
import { BrandMark } from "../brand-mark";
import {billingConfig} from "../../lib/billing-state";
import {plans,proPrice} from "../../lib/plans";
import {BillingControls} from "./billing-controls";

export const metadata={title:"Pricing — Startfund"};
export const dynamic="force-dynamic";

export default function Pricing(){
 return <div className="shell">
  <header><Link href="/" className="brand"><BrandMark/> Startfund</Link><span className="topline">PRICING</span><Link href="/catalog" className="secondary nav-link pricing-link">Funding catalog ↗</Link></header>
  <main>
   <div className="hero"><p className="eyebrow"><span className="live"/> STARTUP INTELLIGENCE</p><h1>Startfund plans<span>.</span></h1><p>Browse the catalog for free. Choose how often you want to scan and draft.</p></div>
   <div className="plan-grid">
    <section className="panel detail plan-card"><div className="section-kicker">01 / FREE</div><h2>Free</h2><p className="plan-price">$0 <small>/ month</small></p><ul>
     <li>Unlimited catalog browsing</li><li>{plans.Free.scan} scans per day</li><li>{plans.Free.draft} drafts per day</li>
    </ul><Link href="/" className="secondary nav-link pricing-link">Open funding radar ↗</Link></section>
    <section className="panel detail plan-card plan-pro"><div className="section-kicker">02 / PRO</div><h2>Pro</h2><p className="plan-price">${proPrice} <small>/ month</small></p><ul>
     <li>{plans.Pro.scan} scans and {plans.Pro.draft} drafts per day</li><li>Weekly funding digest</li><li>MCP and API keys</li><li>Saved profiles</li>
    </ul>{billingConfig()?<BillingControls/>:<><p className="badge">Coming soon</p><p className="muted">No payment or sign-up yet.</p></>}</section>
   </div>
  </main>
 </div>;
}
