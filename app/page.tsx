import Link from "next/link";
import { BrandMark } from "./brand-mark";
import { WaitlistForm } from "./waitlist-form";

const productCards=[
 {title:"Source-backed discovery",body:"Scan grants, tenders, investors, corporate programs, and open-source funding paths. Every match keeps a link back to its source."},
 {title:"Fit-ranked shortlists",body:"Enter the company profile once. Startfund ranks deadlines, regions, prerequisites, and funding type before you spend time applying."},
 {title:"Agent-ready monitoring",body:"Track opportunity changes through the API and MCP feed. Weekly digests keep the shortlist current without another manual search."},
];
const lanes=["Grants","Tenders","Investors","Open-source funding","Startup credits"];

export default function Landing(){
 return <div className="landing-shell">
  <header className="landing-nav">
   <Link href="/" className="brand"><BrandMark/> Startfund</Link>
   <nav aria-label="Primary"><a href="#product">Product</a><a href="#access">Access</a><Link href="/pricing">Pricing</Link></nav>
   <div className="landing-nav-actions"><Link className="landing-login" href="/login?next=%2Fapp">Sign in</Link><a className="landing-button dark small" href="#waitlist">Request access</a></div>
  </header>
  <main>
   <section className="landing-hero">
    <div className="landing-copy"><p className="eyebrow"><span className="live"/> PRIVATE BETA</p><h1>Find the funding your startup is missing.</h1></div>
    <div className="landing-aside"><p>Startfund scans public funding sources, ranks what fits your company, and prepares the first outreach. Builders see the evidence before they spend time applying.</p><div className="landing-cta"><a className="landing-button dark" href="#waitlist">Request access</a><Link className="landing-button light" href="/login?next=%2Fapp">Sign in</Link></div></div>
    <ul className="lane-strip" aria-label="Funding lanes">{lanes.map(lane=><li key={lane}>{lane}</li>)}</ul>
    <div className="product-stage" id="product">
     <div className="product-frame" aria-label="Startfund product preview">
      <aside><div className="preview-brand"><BrandMark size={24}/> Startfund</div><span className="side-active">Funding radar</span><span>Catalog</span><span>Agent updates</span><span>Weekly digest</span><div className="side-note">Private beta workspace</div></aside>
      <section className="preview-main">
       <div className="preview-top"><div><span>Canopy Labs</span><strong>Funding command center</strong></div><span className="preview-action">Run scan</span></div>
       <div className="preview-alert">14 ranked opportunities · 3 closing soon</div>
       <div className="preview-grid">
        <article className="score-card"><small>TOP MATCH FIT</small><strong>88<span>/100</span></strong><p>Heuristic fit, not an eligibility decision.</p></article>
        <article className="chart-card"><small>FUNDING MIX</small><div className="bars"><i style={{height:"42%"}}/><i style={{height:"68%"}}/><i style={{height:"54%"}}/><i style={{height:"86%"}}/><i style={{height:"62%"}}/><i style={{height:"74%"}}/></div><p>Grants, credits, tenders, and investor signals.</p></article>
        <article className="deadline-card"><small>NEXT DEADLINE</small><strong>Jan 3</strong><p>NLnet open-source infrastructure grants.</p></article>
       </div>
       <div className="preview-list"><span>Open-source paths <b>Direct grants</b></span><span>Startup programs <b>Credits labeled</b></span><span>Evidence links <b>Included</b></span></div>
      </section>
     </div>
    </div>
   </section>
   <section className="landing-section">
    <div className="section-heading"><p>ONE FUNDING SURFACE</p><h2>Search less. Apply with better evidence.</h2></div>
    <div className="landing-card-grid">{productCards.map(card=><article key={card.title}><h3>{card.title}</h3><p>{card.body}</p></article>)}</div>
   </section>
   <section className="landing-split">
    <div><p className="eyebrow"><span className="live"/> OPEN-SOURCE PATHS</p><h2>Built for maintainers and venture-backed teams.</h2></div>
    <div><p>Direct open-source grants sit beside startup-dependent credits. Credits are labeled as credits, not cash. Closed programs do not inflate the count.</p><p>The catalog separates official program links from live opportunities, so builders can tell what is actually open.</p></div>
   </section>
   <section className="waitlist-section" id="waitlist">
    <div><p className="eyebrow"><span className="live"/> PRIVATE BETA ACCESS</p><h2>Join the waitlist.</h2><p>Leave your email. Invites are released in small batches while the beta stays private.</p></div>
    <div className="waitlist-card" id="access"><WaitlistForm/><p className="signin-note">Already invited? <Link href="/login?next=%2Fapp">Sign in with your invite code</Link>.</p></div>
   </section>
  </main>
  <footer className="landing-footer"><span>Startfund</span><span>Source-backed funding intelligence for builders.</span></footer>
 </div>;
}
