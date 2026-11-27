import Link from "next/link";
import { BrandMark } from "../brand-mark";
import { catalog, sourceRows } from "../../lib/store";
import { rights, type Fact } from "../../lib/facts";
import { listingStatus } from "../../lib/domain";
import { catalogOverview, openSourceProgramGroups } from "../../lib/catalog-overview";
import { Overview } from "./overview";
import { SuggestOpportunity } from "../suggest-opportunity";
import { communitySource } from "../../lib/suggestions";
export const dynamic="force-dynamic";
const format=(f:Fact)=>f.amount&&f.currency ? new Intl.NumberFormat("en",{style:"currency",currency:f.currency,maximumFractionDigits:0}).format(f.amount) : "—";
export default async function FundingCatalog({searchParams}:{searchParams:Promise<{q?:string;source?:string}>}){
 const p=await searchParams;
 const q=typeof p.q==="string"?p.q.slice(0,120):"";
 const source=typeof p.source==="string"&&(Object.hasOwn(rights,p.source)||p.source===communitySource)?p.source:undefined;
 const asOf=new Date().toISOString();
 const data=await catalog({q,source,limit:60});
 const showPathways=!q&&!source;
 const pathwaySources=showPathways?await Promise.all([sourceRows("Official program links"),sourceRows("Accelerator directory")]):[];
 const pathways=showPathways?openSourceProgramGroups(pathwaySources.flatMap(result=>result.items),asOf):[];
 const pathwayIds=new Set(pathways.flatMap(group=>group.listings.map(o=>o.id)));
 const listings=showPathways?data.opportunities.filter(o=>!pathwayIds.has(o.id)):data.opportunities;
 const groups=new Map<string,Fact[]>();
 for(const evidence of data.evidence)groups.set(evidence.entityId,[...(groups.get(evidence.entityId)??[]),evidence]);
 return <div className="shell"><header><Link href="/" className="brand"><BrandMark/> Startfund</Link><span className="topline">FUNDING CATALOG</span><Link className="secondary nav-link" href="/app">Radar ↗</Link></header>
 <main><div className="hero catalog-hero"><div><p className="eyebrow"><span className="live"/> SOURCE-BACKED DATA</p><h1>Funding catalog<span>.</span></h1><p>Compare programs and public filing signals. Follow the evidence, not a reputation score.</p></div><svg aria-hidden="true" viewBox="0 0 208 112" className="catalog-radar"><g fill="none" stroke="currentColor"><path d="M13 92a91 91 0 0 1 182 0M39 92a65 65 0 0 1 130 0M65 92a39 39 0 0 1 78 0M91 92a13 13 0 0 1 26 0M13 92h182M104 92l65-64"/><path d="M104 92V9" strokeDasharray="3 5"/></g><g fill="currentColor"><circle cx="51" cy="53" r="4"/><circle cx="151" cy="45" r="5"/><circle cx="124" cy="77" r="3"/></g></svg></div>
 <div className="action-strip"><SuggestOpportunity/></div>
 <form className="panel catalog-search"><label>Search<input name="q" placeholder="e.g. SBIR or accelerator" defaultValue={q} maxLength={120}/></label><label>Source<select name="source" defaultValue={source??""}><option value="">All sources</option>{[...Object.keys(rights),communitySource].map(s=><option key={s}>{s}</option>)}</select></label><button className="primary">Search →</button></form>
 {data.warnings.some(value=>!value.startsWith("SEC EDGAR: set"))&&<p className="meta">{data.warnings.filter(value=>!value.startsWith("SEC EDGAR: set")).join(" · ")}</p>}
 <Overview data={catalogOverview(data.opportunities,asOf)}/>
 {showPathways&&<section className="panel detail program-paths"><div className="section-kicker">01 / PROGRAM PATHS</div><h2>Open-source and startup programs</h2><p className="meta">Direct open-source opportunities are separated from startup-dependent programs. Counts cover tracked official programs, not every program in the market. Credits are not cash.</p>
 <div className="plan-grid">{pathways.map(group=><section key={group.id} className="analytics-card"><h3>{group.title}</h3><p className="meta">{group.description}</p><p className="amount-coverage">{group.applyNow}<span> tracked apply-now {group.applyNow===1?"possibility":"possibilities"}</span></p><ul className="rows">{group.listings.map(o=><li key={o.id}><div className="rowmain"><div className="rowtag">{o.kind} · {o.source} · {listingStatus(o,asOf)}</div><a className="rowtitle" href={o.url} target="_blank" rel="noreferrer">{o.title} ↗</a><p className="meta">{o.eligibility}</p><div className="rowmeta">{o.amount&&<span>{new Intl.NumberFormat("en",{style:"currency",currency:o.currency,maximumFractionDigits:0}).format(o.amount)}</span>}{o.deadlineNote&&<span>{o.deadlineNote}</span>}{o.verifiedAt&&<span>Checked {o.verifiedAt}</span>}</div></div></li>)}</ul></section>)}</div></section>}
 <section className="panel detail"><div className="section-kicker">02 / MARKET MAP</div><h2>Programs &amp; filing entities</h2><p className="meta">Amounts are individual source records, not a lifetime total. An SEC filing does not verify legitimacy or typical checks.</p>
 <div className="table-wrap"><table><thead><tr><th>Entity</th><th>Observed track record</th><th>Example amount</th><th>Typical check / terms</th><th>Evidence</th></tr></thead><tbody>
 {[...groups.entries()].map(([id,rows])=>{const first=rows[0],amount=rows.find(x=>x.amount),terms=rows.find(x=>x.kind==="Program terms"),batches=rows.filter(x=>x.kind==="Batch observed");return <tr key={id}><th scope="row">{first.entity}<small>{first.entityType==="Investor"?"Filing entity":"Program"} · {first.source}</small></th><td><span className="mobile-label">Observed track record</span>{batches.length ? `${batches.length} batches in sample` : terms ? "Official program page" : `${rows.length} ${first.entityType==="Investor" ? "filing" : "record"}${rows.length===1?"":"s"} in sample`}</td><td><span className="mobile-label">Example amount</span>{amount ? format(amount) : "—"}</td><td><span className="mobile-label">Typical check / terms</span>{terms?.title ?? "Not disclosed"}</td><td><span className="mobile-label">Evidence</span><details><summary>{rows.length} source{rows.length===1?"":" records"}</summary><ul className="fact-list">{rows.map(f=><li key={f.id}><a href={f.url} target="_blank" rel="noreferrer">{f.title} ↗</a><small>{f.kind} · {f.observed ? f.kind==="Batch observed" ? "Estimated season " + f.observed.slice(0,7) : f.observed : "Date not stated"} · {format(f)} · Fetched {f.fetchedAt.slice(0,10)}</small><small>{f.rights}</small></li>)}</ul></details></td></tr>;})}
 </tbody></table></div>
 {!groups.size&&<p className="empty">No evidence records matched this query.</p>}</section>
 <section className="panel detail"><div className="section-kicker">03 / APPLICATIONS</div><h2>Funding listings</h2><ul className="rows">{listings.map(o=><li key={o.id}><div><div className="rowtag">{o.kind} · {o.source}{o.programme ? " · "+o.programme : ""} · {listingStatus(o,asOf)}</div><a className="rowtitle" href={o.url} target="_blank" rel="noreferrer">{o.title} ↗</a><div className="rowmeta">{listingStatus(o,asOf)==="Forthcoming"&&o.opensAt&&<span>Opens {o.opensAt}</span>}{o.deadline&&<span>{o.noticeExpires?"Next due":listingStatus(o,asOf)==="Late applications"?"On-time deadline":"Due"} {o.deadline}</span>}{o.noticeExpires&&<span>Notice expires {o.noticeExpires}</span>}{o.amount&&<span>{new Intl.NumberFormat("en",{style:"currency",currency:o.currency,maximumFractionDigits:0}).format(o.amount)}</span>}{o.verifiedAt&&<span>Checked {o.verifiedAt}</span>}</div></div></li>)}</ul>{!listings.length&&<p className="empty">No listings matched this query.</p>}</section>
 <section className="panel detail"><div className="section-kicker">04 / CHANGE LOG</div><h2>Signals</h2><ul className="rows">{data.signals.map(o=><li key={o.id}><div><div className="rowtag">{o.kind} · {o.source}</div><a className="rowtitle" href={o.url} target="_blank" rel="noreferrer">{o.title} ↗</a><div className="rowmeta">{o.postedAt&&<span>Posted {o.postedAt.slice(0,10)}</span>}<span>{o.fetchedAt?"Fetched":"Observed"} {(o.fetchedAt??o.observed).slice(0,10)}</span></div></div></li>)}</ul>{!data.signals.length&&<p className="empty">No signals matched this query.</p>}</section>
 </main><footer>STARTFUND <span>·</span> Evidence is observational, not a recommendation.</footer></div>;
}
