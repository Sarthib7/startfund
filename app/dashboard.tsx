"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { kinds, listingStatus, regions, type Profile, type Radar, type Match, type Opportunity } from "../lib/domain";
import { digestHtml } from "../lib/digest";

type Draft={why:string;subject:string;body:string;mode:string};
const names={Grant:"Grants",Accelerator:"Accelerators",VC:"Investors",Perks:"Free builder bundle",Growth:"Growth"} as const;
const formatDate=(value:string)=>new Intl.DateTimeFormat("en",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}).format(new Date(value));
const money=(value:number,m:Match)=>new Intl.NumberFormat("en",{style:"currency",currency:m.currency,maximumFractionDigits:0}).format(value);
const dueLabel=(m:Match)=>m.noticeExpires?"Next due":listingStatus(m)==="Late applications"?"On-time deadline":"Due";
const initialClean=(p:Profile)=>({...p,name:"",description:"",sector:"",email:"",priorNihAward:undefined,plansClinicalTrial:undefined});

export default function Dashboard({initialProfile,initialRadar,initialSample}:{initialProfile:Profile;initialRadar:Radar;initialSample:boolean}){
 const [profile,setProfile]=useState(initialProfile),[saved,setSaved]=useState(initialProfile),[radar,setRadar]=useState(initialRadar);
 const [sample,setSample]=useState(initialSample),[edit,setEdit]=useState(false),[confirmation,setConfirmation]=useState(false);
 const [pending,setPending]=useState(false),[error,setError]=useState(""),[filter,setFilter]=useState<string>("All");
 const [bundle,setBundle]=useState<Opportunity[]|null>(null);
 const [prompt,setPrompt]=useState(""),[looking,setLooking]=useState(false),[turns,setTurns]=useState<{question:string;answer:string}[]>([]);
 const [selected,setSelected]=useState<Match|null>(null),[draft,setDraft]=useState<Draft|null>(null),[draftError,setDraftError]=useState(""),[copy,setCopy]=useState("");
 const [digest,setDigest]=useState(false),[digestState,setDigestState]=useState("off"),[digestEmail,setDigestEmail]=useState(""),
 [digestError,setDigestError]=useState(""),[digestBusy,setDigestBusy]=useState(false);
 const resultsRef=useRef<HTMLElement>(null),digestRef=useRef<HTMLElement>(null),companyRef=useRef<HTMLInputElement>(null);
 const lastListing=useRef<Match|null>(null);
 const scrollTo=(element:HTMLElement|null)=>{element?.scrollIntoView({block:"start",behavior:"smooth"});element?.focus({preventScroll:true});};
 useEffect(()=>{
  if(!digest)return;
  scrollTo(digestRef.current);
  const refresh=()=>fetch("/api/digest").then(r=>r.json()).then(data=>setDigestState(data.state)).catch(()=>{});
  void refresh();
  window.addEventListener("focus",refresh);
  return ()=>window.removeEventListener("focus",refresh);
 },[digest]);
 useEffect(()=>{
  if(!selected)return;
  const controller=new AbortController();
  fetch("/api/draft",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:selected.id}),signal:controller.signal})
   .then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error);if(!controller.signal.aborted)setDraft(data);})
   .catch(e=>{if(!controller.signal.aborted)setDraftError(e.message||"Draft unavailable.");});
  return ()=>controller.abort();
 },[selected]);
 async function scan(event?:FormEvent){
  event?.preventDefault();setPending(true);setError("");
  try{
   const res=await fetch("/api/radar",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(profile)});
   const data=await res.json();if(!res.ok)throw new Error(data.error);
   setSaved(profile);setRadar(data);setFilter("All");setBundle(null);setSelected(null);setSample(false);setConfirmation(false);setEdit(false);
   requestAnimationFrame(()=>scrollTo(resultsRef.current));
  }catch(e){setError(e instanceof Error?e.message:"Scan unavailable.");}
  finally{setPending(false);}
 }
 async function ask(event:FormEvent){
  event.preventDefault();const question=prompt.trim();if(!question)return;
  setPrompt("");setLooking(true);let answer="";
  try{
   if(/\b(?:due|deadline|closing|soon)\b/i.test(question)){
    const next=radar.matches.filter(m=>m.deadline&&listingStatus(m)==="Open").sort((a,b)=>a.deadline!.localeCompare(b.deadline!)).slice(0,3);
    answer=next.length?next.map(m=>`${m.title} — ${formatDate(m.deadline!)}`).join("\n"):"No open matches have a listed deadline.";
   }else if(/\bwhy\b/i.test(question)){
    const listing=radar.matches.find(m=>question.toLowerCase().includes(m.title.toLowerCase()))??lastListing.current??radar.matches[0];
    answer=listing?`${listing.title}: ${listing.reason}.`:"Run a scan first to see why a listing matched.";
   }else if(/\b(?:perks|bundle|credits|free apis?)\b/i.test(question)&&(!question.includes(".")||/\s/.test(question))){
    const {email:_email,...bundleProfile}=saved;
    const res=await fetch("/api/assistant",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"builder_bundle",profile:bundleProfile})});
    if(!res.ok)throw new Error("Builder bundle unavailable.");
    setBundle(await res.json());setFilter("Perks");
    requestAnimationFrame(()=>scrollTo(resultsRef.current));
    answer="I opened the Free builder bundle. Each item links to the provider’s current terms.";
   }else if(question.includes(".")&&!/\s/.test(question)){
    const res=await fetch("/api/assistant",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"analyze_company",company:question})});
    const reply=await res.json();
    if(reply.profile){
     setProfile(reply.profile);setConfirmation(true);setEdit(!reply.profile.sector||!reply.profile.description);
     answer="I found these details on the company website. Review them before scanning.";
    }else{setEdit(true);answer=reply.message??reply.error??"Couldn’t read the website. Enter the company details below.";}
   }else{
    setProfile({...initialClean(profile),name:question.slice(0,80)});setEdit(true);setConfirmation(false);
    answer="Share the company’s website so I can read it, or enter a short description and sector below.";
   }
  }catch{answer="I couldn’t complete that request. Try again or enter your company details.";}
  finally{setTurns(previous=>[...previous.slice(-4),{question,answer}]);setLooking(false);}
 }
 async function digestAction(action:"subscribe"|"unsubscribe"){
  setDigestBusy(true);setDigestError("");
  try{
   const res=await fetch("/api/digest",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,email:digestEmail})});
   const data=await res.json();if(!res.ok)throw new Error(data.error);setDigestState(data.state);
  }catch(e){setDigestError(e instanceof Error?e.message:"Couldn’t update the subscription.");}
  finally{setDigestBusy(false);}
 }
 async function copyDraft(){
  if(!draft)return;
  try{await navigator.clipboard.writeText(draft.subject+"\n\n"+draft.body);setCopy("Copied");}
  catch{setCopy("Couldn’t copy. Select the text to copy it.");}
 }
 const shown=radar.matches.filter(m=>filter==="All"||m.kind===filter);
 const shownBundle=filter==="Perks"?bundle:null;
 const resultCount=shownBundle?.length??shown.length;
 function choose(m:Match){lastListing.current=m;setDraft(null);setCopy("");setDraftError("");setSelected(m);}
 return <div className="shell">
  <header><Link href="/" className="brand"><span aria-hidden>◎</span> Startfund</Link><span className="topline">FUNDING RADAR</span><Link className="secondary nav-link" href="/catalog">Funding catalog ↗</Link><button className="secondary" onClick={()=>setDigest(!digest)} aria-expanded={digest}>{digest?"Close digest":"Weekly digest ↗"}</button></header>
  <main>
   <div className="hero"><p className="eyebrow"><span className="live"/> STARTUP INTELLIGENCE</p><h1>Your funding radar<span>.</span></h1><p>Find grants, investors, and free tools for your startup.</p></div>
   <section className="panel intake" aria-label="Funding assistant">
    <form onSubmit={ask}><label htmlFor="company">What’s your company? <span className="muted">(name or website)</span></label><div className="ask"><input id="company" ref={companyRef} required maxLength={240} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="Company website or a follow-up question"/><button className="primary" disabled={looking}>{looking?"Working…":"Ask →"}</button></div></form>
    {turns.length>0&&<div className="turns" aria-live="polite">{turns.map((turn,i)=><p key={i}><strong>{turn.question}</strong><br/>{turn.answer}</p>)}</div>}
    <div className="intake-actions">{sample&&<span className="badge">Sample: {initialProfile.name}</span>}<button className="secondary" onClick={()=>setEdit(!edit)}>{edit?"Hide details":"Edit details"}</button><button className="secondary" onClick={()=>{setProfile(initialClean(initialProfile));setConfirmation(false);setEdit(true);}}>Clear</button></div>
    {confirmation&&<div className="profile-confirm"><div className="intake-actions">{[profile.name,profile.sector,regions[profile.region],profile.stage].filter(Boolean).map((value,i)=><button key={i} className="secondary" onClick={()=>setEdit(true)}>{value}</button>)}</div><p>{profile.description}</p><button className="primary" disabled={pending||!profile.description||!profile.sector} onClick={()=>scan()}>{pending?"Scanning…":"Confirm and scan →"}</button></div>}
    {error&&!edit&&<p className="error" role="alert">{error}</p>}
   </section>
   <div className={edit?"workspace":"workspace single"}>
    {edit&&<section className="panel setup"><div className="section-kicker">01 / SETUP</div><h2>Startup profile</h2>
     <form onSubmit={scan}>
     <label>Startup<input required maxLength={80} value={profile.name} onChange={e=>setProfile({...profile,name:e.target.value})}/></label>
     <label>What you do<textarea required rows={3} maxLength={400} value={profile.description} onChange={e=>setProfile({...profile,description:e.target.value})}/></label>
     <div className="cols"><label>Stage<select value={profile.stage} onChange={e=>setProfile({...profile,stage:e.target.value as Profile["stage"]})}>{["Idea","Pre-seed","Seed","Growth"].map(x=><option key={x}>{x}</option>)}</select></label>
     <label>Region<select value={profile.region} onChange={e=>setProfile({...profile,region:e.target.value as Profile["region"]})}>{Object.entries(regions).map(([code,label])=><option value={code} key={code}>{label}</option>)}</select></label></div>
     <label>Sector<input required maxLength={80} value={profile.sector} onChange={e=>setProfile({...profile,sector:e.target.value})}/></label>
     <fieldset><legend>Looking for</legend><div className="choices">{kinds.map(x=><label className="chip" key={x}><input type="checkbox" checked={profile.needs.includes(x)} onChange={e=>setProfile({...profile,needs:e.target.checked?[...profile.needs,x]:profile.needs.filter(n=>n!==x)})}/>{names[x]}</label>)}</div></fieldset>
     {/biotech|medical|health/i.test(profile.sector)&&<fieldset><legend>NIH prerequisites</legend><label className="chip"><input type="checkbox" checked={profile.priorNihAward===true} onChange={e=>setProfile({...profile,priorNihAward:e.target.checked})}/>Prior NIH SBIR/STTR award</label><label className="chip"><input type="checkbox" checked={profile.plansClinicalTrial===true} onChange={e=>setProfile({...profile,plansClinicalTrial:e.target.checked})}/>Planning a clinical trial</label></fieldset>}
     <button className="primary" disabled={pending} type="submit">{pending?"Scanning…":"Scan opportunities →"}</button>
     {error&&<p className="error" role="alert">{error}</p>}
     </form>
    </section>}
    <section className="panel results" ref={resultsRef} tabIndex={-1} aria-busy={pending}>
     <div className="section-kicker">02 / DISCOVER</div><div className="result-title"><h2>{shownBundle?"Free builder bundle":"Ranked opportunities"}</h2><span className="muted" aria-live="polite">{resultCount} {shownBundle?"perks":"matches"}</span></div>
     <p className="meta">For {saved.name} <span>·</span> Scanned {formatDate(radar.scannedAt)} UTC</p>
     <nav className="filters" aria-label="Filter opportunities">{(["All",...kinds] as const).map(x=><button type="button" key={x} className={filter===x?"selected":""} aria-pressed={filter===x} onClick={()=>setFilter(x)}>{x==="All"?x:names[x]}</button>)}</nav>
     {radar.warnings.length>0&&<p className="warning">{radar.warnings.join(" · ")}</p>}
     <ul className="rows">{shownBundle ? shownBundle.map(item=><li key={item.id}><div className="rowmain">
      <div className="rowtag">{item.source}</div><a className="rowtitle" href={item.url} target="_blank" rel="noreferrer">{item.title} ↗</a>
      <p className="rowmeta">{item.eligibility}</p>
     </div></li>) : shown.map(m=><li key={m.id}><div className="rowmain">
      <div className="rowtag">{m.kind} · {m.source} · {listingStatus(m)}</div>
      <button className="rowtitle" onClick={()=>choose(m)}>{m.title} <span aria-hidden>›</span></button>
      <div className="rowmeta">{m.opensAt&&listingStatus(m)==="Forthcoming"&&<span>Opens {formatDate(m.opensAt)}</span>}
       {m.deadline&&<span>{dueLabel(m)} {formatDate(m.deadline)}</span>}{m.noticeExpires&&<span>Notice expires {formatDate(m.noticeExpires)}</span>}
       {m.amount&&<span>Award ceiling {money(m.amount,m)}</span>}<a href={m.url} target="_blank" rel="noreferrer">Source ↗</a>
      </div>{m.regionNote&&<small className="warning">{m.regionNote}</small>}{m.prerequisites?.length?<small className="warning"> {m.prerequisites.join(" · ")}</small>:null}
      {m.kind==="Perks"&&<p className="rowmeta">{m.eligibility}</p>}
     </div><div className="score"><b>{m.score}%</b><span>FIT</span></div></li>)}</ul>
     {!resultCount&&<p className="empty">{filter==="VC"?"No investor matches for this profile. Product launches aren’t investor opportunities.":"No matches in this view. Try another category or edit your profile."}</p>}
     {!!radar.evidence?.length&&<details><summary>Related past funding ({radar.evidence.length})</summary><ul className="fact-list">{radar.evidence.map(f=><li key={f.id}><a href={f.url} target="_blank" rel="noreferrer">{f.title} ↗</a><small>{f.source} · {f.kind} · Not open for applications</small></li>)}</ul></details>}
    </section>
   </div>
   {digest&&<section className="panel detail" ref={digestRef} tabIndex={-1} aria-label="Digest preview"><h2>Weekly digest preview</h2><p className="muted">Top five matches · Mondays at 13:00 UTC</p>
    <p aria-live="polite">{digestState==="subscribed"?"Subscribed":digestState==="pending"?"Check your inbox to confirm":"Not subscribed"}</p>
    {digestState==="off"?<form className="ask" onSubmit={e=>{e.preventDefault();void digestAction("subscribe");}}><input aria-label="Email for weekly digest" type="email" required value={digestEmail} onChange={e=>setDigestEmail(e.target.value)} placeholder="you@company.com"/><button className="secondary" disabled={digestBusy}>Subscribe</button></form>:<button className="secondary" disabled={digestBusy} onClick={()=>digestAction("unsubscribe")}>{digestState==="pending"?"Cancel request":"Unsubscribe"}</button>}
    {digestError&&<p className="error" role="alert">{digestError}</p>}
    <iframe title="Weekly radar email" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={digestHtml(saved,radar)}/>
   </section>}
   {selected&&<div className="modal" onClick={()=>setSelected(null)}><section className="panel detail dialog" role="dialog" aria-modal="true" aria-labelledby="listing" onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==="Escape")setSelected(null);}}>
    <div className="result-title"><div className="section-kicker">{selected.kind} · {selected.source}</div><button autoFocus className="secondary" onClick={()=>setSelected(null)} aria-label="Close draft">Close ×</button></div>
    <h2 id="listing">{selected.title}</h2><details><summary>Eligibility · more</summary><p className="muted">{selected.eligibility??"Check eligibility at the source."}</p><a href={selected.url} target="_blank" rel="noreferrer">Full eligibility notice ↗</a></details>
    {selected.deadlineNote&&<p className="meta">{selected.deadlineNote}</p>}
    {selected.awardFloor!=null&&<p className="meta">Award floor: {money(selected.awardFloor,selected)}</p>}
    {selected.programFunding&&<p className="meta">Total program funding: {money(selected.programFunding,selected)}</p>}
    <p className="meta">Fetched {formatDate(selected.verifiedAt??selected.fetchedAt)} UTC · <a href={selected.url} target="_blank" rel="noreferrer">Visit source ↗</a></p>
    <hr/><div className="result-title"><h3>Outreach draft</h3>{draft&&<span className="badge">{draft.mode}</span>}</div>
    {!draft&&!draftError&&<p aria-live="polite">Preparing draft…</p>}{draftError&&<p role="alert">{draftError}</p>}
    {draft&&<><p><strong>Why it fits:</strong> {draft.why}</p><p><strong>To:</strong> {selected.contact??"Add a recipient in your mail app"}</p>
     <label className="draft-field">Subject<input value={draft.subject} onChange={e=>setDraft({...draft,subject:e.target.value})}/></label>
     <label className="draft-field">Message<textarea rows={8} value={draft.body} onChange={e=>setDraft({...draft,body:e.target.value})}/></label>
     <div className="intake-actions"><button className="secondary" onClick={copyDraft}>Copy</button><a className="secondary" href={`mailto:${selected.contact??""}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`}>Open in mail ↗</a><span aria-live="polite">{copy}</span></div>
    </>}
   </section></div>}
  </main><footer>STARTFUND <span>·</span> Built with eve <span>·</span> Fit is a heuristic, not an eligibility decision.</footer>
 </div>;
}
