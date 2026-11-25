import Link from "next/link";
import { catalog } from "../../lib/store";
import { rights, type Fact } from "../../lib/facts";
export const dynamic="force-dynamic";
const format=(f:Fact)=>f.amount&&f.currency ? new Intl.NumberFormat("en",{style:"currency",currency:f.currency,maximumFractionDigits:0}).format(f.amount) : "—";
export default async function FundingCatalog({searchParams}:{searchParams:Promise<{q?:string;source?:string}>}){
 const p=await searchParams;
 const q=typeof p.q==="string"?p.q.slice(0,120):"";
 const source=typeof p.source==="string"&&Object.hasOwn(rights,p.source)?p.source:undefined;
 const data=await catalog({q,source,limit:60});
 const groups=new Map<string,Fact[]>();
 for(const evidence of data.evidence)groups.set(evidence.entityId,[...(groups.get(evidence.entityId)??[]),evidence]);
 return <div className="shell"><header><Link href="/" className="brand"><span aria-hidden>◎</span> Startfund</Link><span className="topline">FUNDING CATALOG</span><Link className="secondary nav-link" href="/">Radar ↗</Link></header>
 <main><div className="hero"><p className="eyebrow"><span className="live"/> SOURCE-BACKED DATA</p><h1>Funding catalog<span>.</span></h1><p>Compare programs and public filing signals. Follow the evidence, not a reputation score.</p></div>
 <form className="panel catalog-search"><label>Search<input name="q" placeholder="e.g. SBIR or accelerator" defaultValue={q} maxLength={120}/></label><label>Source<select name="source" defaultValue={source??""}><option value="">All sources</option>{Object.keys(rights).map(s=><option key={s}>{s}</option>)}</select></label><button className="primary">Search →</button></form>
 {data.warnings.length>0&&<p className="meta">{data.warnings.join(" · ")}</p>}
 <section className="panel detail"><div className="section-kicker">01 / MARKET MAP</div><h2>Programs &amp; filing entities</h2><p className="meta">Amounts are individual source records, not a lifetime total. An SEC filing does not verify legitimacy or typical checks.</p>
 <div className="table-wrap"><table><thead><tr><th>Entity</th><th>Observed track record</th><th>Example amount</th><th>Typical check / terms</th><th>Evidence</th></tr></thead><tbody>
 {[...groups.entries()].map(([id,rows])=>{const first=rows[0],amount=rows.find(x=>x.amount),terms=rows.find(x=>x.kind==="Program terms"),batches=rows.filter(x=>x.kind==="Batch observed");return <tr key={id}><th scope="row">{first.entity}<small>{first.entityType==="Investor"?"Filing entity":"Program"} · {first.source}</small></th><td>{batches.length ? `${batches.length} batches in sample` : terms ? "Official program page" : `${rows.length} ${first.entityType==="Investor" ? "filing" : "record"}${rows.length===1?"":"s"} in sample`}</td><td>{amount ? format(amount) : "—"}</td><td>{terms?.title ?? "Not disclosed"}</td><td><details><summary>{rows.length} source{rows.length===1?"":" records"}</summary><ul className="fact-list">{rows.map(f=><li key={f.id}><a href={f.url} target="_blank" rel="noreferrer">{f.title} ↗</a><small>{f.kind} · {f.observed ? f.kind==="Batch observed" ? "Estimated season " + f.observed.slice(0,7) : f.observed : "Date not stated"} · {format(f)} · Fetched {f.fetchedAt.slice(0,10)}</small><small>{f.rights}</small></li>)}</ul></details></td></tr>;})}
 </tbody></table></div>
 {!groups.size&&<p className="empty">No evidence records matched this query.</p>}</section>
 <section className="panel detail"><div className="section-kicker">02 / APPLICATIONS</div><h2>Open listings</h2><ul className="rows">{data.opportunities.map(o=><li key={o.id}><div><div className="rowtag">{o.kind} · {o.source}</div><a className="rowtitle" href={o.url} target="_blank" rel="noreferrer">{o.title} ↗</a><div className="rowmeta">{o.deadline ? "Due "+o.deadline : "Deadline not listed"} · {o.amount ? new Intl.NumberFormat("en",{style:"currency",currency:o.currency,maximumFractionDigits:0}).format(o.amount) : "Amount not listed"}</div></div></li>)}</ul>{!data.opportunities.length&&<p className="empty">No listings matched this query.</p>}</section>
 <section className="panel detail"><div className="section-kicker">03 / CHANGE LOG</div><h2>Signals</h2><ul className="rows">{data.signals.map(o=><li key={o.id}><div><div className="rowtag">{o.kind} · {o.source} · {o.observed.slice(0,10)}</div><a className="rowtitle" href={o.url} target="_blank" rel="noreferrer">{o.title} ↗</a></div></li>)}</ul>{!data.signals.length&&<p className="empty">No signals matched this query.</p>}</section>
 </main><footer>STARTFUND <span>·</span> Evidence is observational, not a recommendation.</footer></div>;
}
