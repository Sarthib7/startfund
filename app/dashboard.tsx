"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { kinds, type Profile, type Radar, type Match } from "../lib/domain";
import { digestHtml } from "../lib/digest";
type Draft={why:string;subject:string;body:string;mode:string};
const amount=(m:Match)=>m.amount ? new Intl.NumberFormat("en",{style:"currency",currency:m.currency,maximumFractionDigits:0}).format(m.amount) : "—";
const date=(value:string|null)=>value ? new Intl.DateTimeFormat("en",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}).format(new Date(value)) : "—";
export default function Dashboard({initialProfile,initialRadar}:{initialProfile:Profile;initialRadar:Radar}){
 const [profile,setProfile]=useState(initialProfile),[saved,setSaved]=useState(initialProfile),[radar,setRadar]=useState(initialRadar);
 const [pending,setPending]=useState(false),[error,setError]=useState(""),[filter,setFilter]=useState("All"),[selected,setSelected]=useState<Match|null>(null),
 [draft,setDraft]=useState<Draft|null>(null),[draftError,setDraftError]=useState(""),[digest,setDigest]=useState(false);
 useEffect(()=>{
  if(!selected) return;
  const controller=new AbortController();
  fetch("/api/draft",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:selected.id}),signal:controller.signal})
   .then(async r=>{const data=await r.json();if(!r.ok) throw new Error(data.error);if(!controller.signal.aborted)setDraft(data);})
   .catch(e=>{if(!controller.signal.aborted)setDraftError(e.message || "Draft unavailable.");});
  return ()=>controller.abort();
 },[selected]);
 async function scan(event:FormEvent){
  event.preventDefault();setPending(true);setError("");
  try{
   const res=await fetch("/api/radar",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(profile)});
   const data=await res.json(); if(!res.ok)throw new Error(data.error);
   setSaved(profile);setRadar(data);setFilter("All");setSelected(null);
  }catch(e){setError(e instanceof Error ? e.message : "Scan unavailable.");}
  finally{setPending(false);}
 }
 const shown=radar.matches.filter(m=>filter==="All"||m.kind===filter);
 return <div className="shell">
   <header><a href="/" className="brand"><span aria-hidden>◎</span> Startfund</a><span className="topline">FUNDING RADAR</span><Link className="secondary nav-link" href="/catalog">Funding catalog ↗</Link><button className="secondary" onClick={()=>setDigest(!digest)} aria-expanded={digest}>{digest ? "Close digest" : "Weekly digest ↗"}</button></header>
   <main>
    <div className="hero"><p className="eyebrow"><span className="live"/> STARTUP INTELLIGENCE</p><h1>Your funding radar<span>.</span></h1><p>Find grants, accelerators, and funding signals that fit your startup.</p></div>
    <div className="workspace">
      <section className="panel setup"><div className="section-kicker">01 / SETUP</div><h2>Startup profile</h2>
        <form onSubmit={scan}>
          <label>Startup<input required maxLength={80} value={profile.name} onChange={e=>setProfile({...profile,name:e.target.value})}/></label>
          <label>What you do<textarea required rows={3} maxLength={400} value={profile.description} onChange={e=>setProfile({...profile,description:e.target.value})}/></label>
          <div className="cols"><label>Stage<select value={profile.stage} onChange={e=>setProfile({...profile,stage:e.target.value as Profile["stage"]})}>{["Idea","Pre-seed","Seed","Growth"].map(x=><option key={x}>{x}</option>)}</select></label>
          <label>Region<select value={profile.region} onChange={e=>setProfile({...profile,region:e.target.value as Profile["region"]})}><option value="US">United States</option><option value="EU">European Union</option><option value="Other">Other / Global</option></select></label></div>
          <label>Sector<input required value={profile.sector} maxLength={80} onChange={e=>setProfile({...profile,sector:e.target.value})}/></label>
          <fieldset><legend>Looking for</legend><div className="choices">{kinds.map(x=><label className="chip" key={x}><input type="checkbox" checked={profile.needs.includes(x)} onChange={e=>setProfile({...profile,needs:e.target.checked?[...profile.needs,x]:profile.needs.filter(n=>n!==x)})}/>{x}</label>)}</div></fieldset>
          <label>Weekly email <span className="muted">(optional)</span><input value={profile.email ?? ""} type="email" maxLength={254} placeholder="founder@example.com" onChange={e=>setProfile({...profile,email:e.target.value})}/></label>
          <button className="primary" disabled={pending} type="submit">{pending ? "Scanning…" : "Scan opportunities →"}</button>
          {error&&<p className="error" role="alert">{error}</p>}
        </form>
      </section>
      <section className="panel results">
        <div className="section-kicker">02 / DISCOVER</div><div className="result-title"><h2>Ranked opportunities</h2><span className="muted">{radar.matches.length} matches</span></div>
        <p className="meta">For {saved.name} <span>·</span> Scanned {date(radar.scannedAt)} UTC</p>
        <nav className="filters" aria-label="Filter opportunities">{["All",...kinds].map(x=><button type="button" key={x} className={filter===x ? "selected":""} aria-pressed={filter===x} onClick={()=>setFilter(x)}>{x}</button>)}</nav>
        {radar.warnings.length>0 && <p className="warning">{radar.warnings.join(" · ")}</p>}
        <ul className="rows">{shown.map(m=><li key={m.id}><div className="rowmain"><div className="rowtag">{m.kind} <span>·</span> {m.source}{m.signal ? " · Signal" : ""}</div><button className="rowtitle" onClick={()=>{setDraft(null);setDraftError("");setSelected({...m});}}>{m.title}</button><div className="rowmeta"><span>Due {date(m.deadline)}</span><span>Award {amount(m)}</span><a href={m.url} target="_blank" rel="noreferrer">Source ↗</a></div></div><div className="score"><b>{m.score}%</b><span>FIT</span></div></li>)}</ul>
        {!shown.length&&<p className="empty">No matches in this view. Try another category or edit your profile.</p>}
      </section>
    </div>
    {digest&&<section className="panel detail" aria-label="Digest preview"><h2>Weekly digest preview</h2><p className="muted">Top five matches · Mondays at 13:00 UTC · Email delivery is opt-in and must be enabled by the operator.</p><iframe title="Weekly radar email" sandbox="" srcDoc={digestHtml(saved,radar)}/></section>}
    {selected&&<div className="modal" onClick={()=>setSelected(null)}><section className="panel detail dialog" role="dialog" aria-modal="true" aria-labelledby="listing" onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==="Escape")setSelected(null);}}>
      <div className="result-title"><div className="section-kicker">{selected.kind} · {selected.source}</div><button autoFocus className="secondary" onClick={()=>setSelected(null)} aria-label="Close draft">Close ×</button></div>
      <h2 id="listing">{selected.title}</h2><p className="muted">{selected.eligibility || (selected.signal ? "Funding or growth news; not an application." : "Check eligibility at the source.")}</p>
      <p className="meta">Fetched {date(selected.fetchedAt)} UTC · <a href={selected.url} target="_blank" rel="noreferrer">Visit source ↗</a></p>
      <hr/><div className="result-title"><h3>Outreach draft</h3>{draft&&<span className="badge">{draft.mode}</span>}</div>
      {!draft&&!draftError&&<p aria-live="polite">Preparing draft…</p>}{draftError&&<p role="alert">{draftError}</p>}
      {draft&&<><p><strong>Why it fits:</strong> {draft.why}</p><p><strong>Subject:</strong> {draft.subject}</p><pre>{draft.body}</pre></>}
    </section></div>}
   </main><footer>STARTFUND <span>·</span> Built with eve <span>·</span> Fit is a heuristic, not an eligibility decision.</footer>
 </div>;
}
