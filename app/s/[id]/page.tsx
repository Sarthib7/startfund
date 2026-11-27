import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "../../brand-mark";
import { notFound } from "next/navigation";
import { regions } from "../../../lib/domain";
import { getShare } from "../../../lib/shares";
import { ReportSummary } from "../../report-summary";
import { ShareControls } from "../../share-controls";

type Props={params:Promise<{id:string}>};
export async function generateMetadata({params}:Props):Promise<Metadata>{
 const {id}=await params;
 const snapshot=await getShare(id);
 const title=snapshot?`${snapshot.company.name} funding snapshot — Startfund`:"Funding snapshot — Startfund";
 const description="A read-only shortlist of source-linked funding opportunities.";
 return {title,description,robots:{index:false,follow:false},openGraph:{title,description,type:"website"},twitter:{card:"summary_large_image",title,description}};
}

export default async function SharedScan({params}:Props){
 const {id}=await params;
 const snapshot=await getShare(id);
 if(!snapshot)notFound();
 const {company,matches,scannedAt}=snapshot;
 return <div className="shell">
  <header><Link href="/" className="brand"><BrandMark/> Startfund</Link><Link href="/app" className="secondary nav-link pricing-link">Run a scan ↗</Link></header>
  <main><div className="hero"><p className="eyebrow"><span className="live"/> SHARED FUNDING SNAPSHOT</p><h1>{company.name}<span>.</span></h1><p>{company.sector} · {regions[company.region]} · {company.stage}</p></div>
  <section className="panel detail" aria-label="Report summary"><ReportSummary score={snapshot.topScore} total={snapshot.matchCount}/>
   <p className="meta">Public, read-only snapshot · {scannedAt.slice(0,10)} UTC</p>
   <ShareControls publicPath={`/s/${id}`}/>
  </section>
  <section className="panel detail"><h2>Top matches</h2>
   {matches.length?<ul className="rows">{matches.map((m,i)=><li key={i}><div><div className="rowtag">{m.kind} · {m.source}</div><a className="rowtitle" href={m.url} rel="noreferrer" target="_blank">{m.title} ↗</a></div><span className="badge">{m.score}% fit</span></li>)}</ul>:<p>No source-linked matches in this scan.</p>}
  </section></main><footer>Fit is a heuristic, not an eligibility decision.</footer>
 </div>;
}
