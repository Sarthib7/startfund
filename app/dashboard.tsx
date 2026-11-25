"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { kinds, listingStatus, opportunityLocation, regions, selectProfileRegion, type Profile, type Radar, type Match, type Opportunity } from "../lib/domain";
import { digestHtml } from "../lib/digest";
import { ShareControls } from "./share-controls";
import { SuggestOpportunity } from "./suggest-opportunity";
import { MatchAnalytics } from "./match-analytics";
import { plans } from "../lib/plans";
import { ReportSummary } from "./report-summary";

type Draft={why:string;subject:string;body:string;mode:string};
class UsageLimitError extends Error {}
function requestError(res:Response,data:{error?:string;pricing?:string},fallback:string){
 const message=data.error??fallback;
 return res.status===429 ? new UsageLimitError(message+(data.pricing?" Pro is coming soon.":"")) : new Error(message);
}
const names={Grant:"Grants",Tender:"Tenders",Accelerator:"Accelerators",VC:"Investors",Perks:"Free builder bundle",Growth:"Growth"} as const;
const formatDate=(value:string)=>new Intl.DateTimeFormat("en",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}).format(new Date(value));
const money=(value:number,m:Match)=>new Intl.NumberFormat("en",{style:"currency",currency:m.currency,maximumFractionDigits:0}).format(value);
const dueLabel=(m:Match)=>m.noticeExpires?"Next due":listingStatus(m)==="Late applications"?"On-time deadline":"Due";
const initialClean=(p:Profile)=>selectProfileRegion({...p,name:"",description:"",sector:"",email:"",companyCountry:undefined,developerCountries:undefined,companySubdivision:undefined,developerSubdivisions:undefined,priorNihAward:undefined,plansClinicalTrial:undefined});

export default function Dashboard({initialProfile,initialRadar,initialSample,initialNow}:{initialProfile:Profile;initialRadar:Radar;initialSample:boolean;initialNow:string}){
 const [profile,setProfile]=useState(initialProfile),[saved,setSaved]=useState(initialProfile),[radar,setRadar]=useState(initialRadar);
 const [teamCountries,setTeamCountries]=useState(initialProfile.developerCountries?.join(", ")??"");
 const [teamSubdivisions,setTeamSubdivisions]=useState(initialProfile.developerSubdivisions?.join(", ")??"");
 const [sample,setSample]=useState(initialSample),[edit,setEdit]=useState(false),[confirmation,setConfirmation]=useState(false);
 const [pending,setPending]=useState(false),[error,setError]=useState(""),[filter,setFilter]=useState<string>("All");
 const [bundle,setBundle]=useState<Opportunity[]|null>(null);
 const [prompt,setPrompt]=useState(""),[looking,setLooking]=useState(false),[turns,setTurns]=useState<{question:string;answer:string}[]>([]);
 const [selected,setSelected]=useState<Match|null>(null),[draft,setDraft]=useState<Draft|null>(null),[draftError,setDraftError]=useState(""),[copy,setCopy]=useState("");
 const [digest,setDigest]=useState(false),[digestState,setDigestState]=useState("off"),[digestEmail,setDigestEmail]=useState(""),
 [digestError,setDigestError]=useState(""),[digestBusy,setDigestBusy]=useState(false),[emailAvailable,setEmailAvailable]=useState<boolean|null>(null);
 const resultsRef=useRef<HTMLElement>(null),digestRef=useRef<HTMLElement>(null),companyRef=useRef<HTMLInputElement>(null);
 const lastListing=useRef<Match|null>(null);
 const setupRef=useRef<HTMLElement>(null);
 const missingFields=[...(!profile.description.trim()?["description"]:[]),...(!profile.sector.trim()?["sector"]:[])];
 const automaticProfile=selectProfileRegion(profile);
 const scrollTo=(element:HTMLElement|null)=>{element?.scrollIntoView({block:"start",behavior:"smooth"});element?.focus({preventScroll:true});};
 function editField(name:string){
  setEdit(true);
  requestAnimationFrame(()=>scrollTo(setupRef.current?.querySelector<HTMLElement>(`[name="${name}"]`)??null));
 }
 useEffect(()=>{
  if(!digest)return;
  scrollTo(digestRef.current);
  const refresh=()=>fetch("/api/digest").then(r=>r.json()).then(data=>{setDigestState(data.state);setEmailAvailable(data.available);}).catch(()=>{});
  void refresh();
  window.addEventListener("focus",refresh);
  return ()=>window.removeEventListener("focus",refresh);
 },[digest]);
 useEffect(()=>{
  if(!selected)return;
  const controller=new AbortController();
  fetch("/api/draft",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:selected.id}),signal:controller.signal})
   .then(async r=>{const data=await r.json();if(!r.ok)throw requestError(r,data,"Draft unavailable.");if(!controller.signal.aborted)setDraft(data);})
   .catch(e=>{if(!controller.signal.aborted)setDraftError(e.message||"Draft unavailable.");});
  return ()=>controller.abort();
 },[selected]);
 async function scan(event?:FormEvent){
  event?.preventDefault();setPending(true);setError("");
  try{
   const input={...(profile.regionExplicit?profile:automaticProfile),developerCountries:teamCountries.split(/[\s,]+/).filter(Boolean),developerSubdivisions:teamSubdivisions.split(/[\s,]+/).filter(Boolean)};
   const res=await fetch("/api/radar",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
   const data=await res.json();if(!res.ok)throw requestError(res,data,"Scan unavailable.");
   setSaved(input);setRadar(data);setFilter("All");setBundle(null);setSelected(null);setSample(false);setConfirmation(false);setEdit(false);
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
   }else if(/\b(?:perks|bundle|credits|free apis?)\b/i.test(question)&&
     (/^(?:what|where|which|how|can|could|do|are|is|show|find|list|tell|give)\b/i.test(question)||/\?$/.test(question)||
     (!sample&&/^(?:perks|credits|builder bundle|free builder bundle|free apis?)$/i.test(question)))){
    const {email:_email,...bundleProfile}=saved;
    const res=await fetch("/api/assistant",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"builder_bundle",profile:bundleProfile})});
    const data=await res.json();
    if(!res.ok)throw requestError(res,data,"Builder bundle unavailable.");
    setBundle(data);setFilter("Perks");
    requestAnimationFrame(()=>scrollTo(resultsRef.current));
    answer="I opened the Free builder bundle. Each item links to the provider’s current terms.";
   }else if(question.includes(".")&&!/\s/.test(question)){
    const res=await fetch("/api/assistant",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"analyze_company",company:question})});
    const reply=await res.json();
    if(res.status===429)throw requestError(res,reply,"Company lookup unavailable.");
    if(reply.profile){
     setProfile(reply.profile);setTeamCountries("");setTeamSubdivisions("");setConfirmation(true);setEdit(!reply.profile.sector||!reply.profile.description);
     answer="I found these details on the company website. Review them before scanning.";
    }else{setEdit(true);answer=reply.message??reply.error??"Couldn’t read the website. Enter the company details below.";}
   }else{
    setProfile({...initialClean(profile),name:question.slice(0,80)});setTeamCountries("");setTeamSubdivisions("");setEdit(true);setConfirmation(false);
    answer="Share the company’s website so I can read it, or enter a short description and sector below.";
   }
  }catch(e){answer=e instanceof UsageLimitError?e.message:"I couldn’t complete that request. Try again or enter your company details.";}
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
   <div className="hero"><p className="eyebrow"><span className="live"/> STARTUP INTELLIGENCE</p><h1>Your funding radar<span>.</span></h1><p>Find grants, tenders, investors, and free tools for your startup.</p><div className="hero-plan"><span>Free: {plans.Free.scan} scans and {plans.Free.draft} drafts per day</span><Link className="secondary nav-link pricing-link" href="/pricing">Compare Free and Pro ↗</Link></div></div>
   <section className="panel intake" aria-label="Funding assistant">
    <form onSubmit={ask}><label htmlFor="company">Company website or name</label><div className="ask"><input id="company" ref={companyRef} required maxLength={240} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="e.g. yourcompany.com"/><button className="primary" disabled={looking}>{looking?"Working…":"Continue →"}</button></div><p className="meta">Review your company profile, then run a scan to build a scored funding report.</p></form>
    {turns.length>0&&<div className="turns" aria-live="polite">{turns.map((turn,i)=><p key={i}><strong>{turn.question}</strong><br/>{turn.answer}</p>)}</div>}
    <div className="intake-actions">{sample&&<span className="badge">Sample: {initialProfile.name}</span>}<button className="secondary" onClick={()=>setEdit(!edit)}>{edit?"Hide details":"Edit details"}</button><button className="secondary" onClick={()=>{setProfile(initialClean(initialProfile));setTeamCountries("");setTeamSubdivisions("");setConfirmation(false);setEdit(true);}}>Clear</button></div>
    {confirmation&&<div className="profile-confirm"><div className="intake-actions">{[profile.name,profile.sector,profile.companyCountry??regions[profile.region],profile.stage].filter(Boolean).map((value,i)=><button key={i} className="secondary" onClick={()=>setEdit(true)}>{value}</button>)}</div><p>{profile.description}</p>{missingFields.length?<button className="secondary" onClick={()=>editField(missingFields[0])}>Add {missingFields.map(field=>"a "+field).join(" and ")} to scan</button>:<button className="primary" disabled={pending} onClick={()=>scan()}>{pending?"Scanning…":"Confirm and scan →"}</button>}</div>}
    {error&&!edit&&<p className="error" role="alert">{error}</p>}
   </section>
   <div className={edit?"workspace":"workspace single"}>
    {edit&&<section className="panel setup" ref={setupRef}><div className="section-kicker">01 / SETUP</div><h2>Startup profile</h2>
     <form onSubmit={scan}>
     <label>Startup<input required maxLength={80} value={profile.name} onChange={e=>setProfile({...profile,name:e.target.value})}/></label>
     <label>What you do<textarea name="description" required rows={3} maxLength={400} value={profile.description} onChange={e=>setProfile({...profile,description:e.target.value})}/></label>
     <div className="cols"><label>Stage<select value={profile.stage} onChange={e=>setProfile({...profile,stage:e.target.value as Profile["stage"]})}>{["Idea","Pre-seed","Seed","Growth","Not sure"].map(x=><option key={x}>{x}</option>)}</select></label>
     <label>Region fallback {!profile.regionExplicit&&<span className="muted">(auto)</span>}<select value={profile.regionExplicit?profile.region:""} onChange={e=>setProfile(selectProfileRegion(profile,(e.target.value||undefined) as Profile["region"]|undefined))}><optgroup label="Automatic"><option value="">{regions[automaticProfile.region]}</option></optgroup><optgroup label="Set manually">{Object.entries(regions).map(([code,label])=><option value={code} key={code}>{label}</option>)}</optgroup></select></label></div>
     <label>Company country code <span className="muted">(optional)</span><input maxLength={2} pattern="[A-Za-z]{2}" placeholder="e.g. DE" value={profile.companyCountry??""} onChange={e=>setProfile({...profile,companyCountry:e.target.value.toUpperCase()||undefined})}/></label>
     <label>Developer country codes <span className="muted">(optional, up to 8)</span><input maxLength={40} pattern="[A-Za-z]{2}([, ]+[A-Za-z]{2}){0,7}[, ]*" placeholder="e.g. FR, ES" value={teamCountries} onChange={e=>setTeamCountries(e.target.value.toUpperCase())}/></label>
     <label>Company state or region code <span className="muted">(optional)</span><input maxLength={6} pattern="[A-Za-z]{2}-[A-Za-z0-9]{1,3}" placeholder="e.g. US-CA" value={profile.companySubdivision??""} onChange={e=>setProfile({...profile,companySubdivision:e.target.value.toUpperCase()||undefined})}/></label>
     <label>Developer state or region codes <span className="muted">(optional, up to 8)</span><input maxLength={64} placeholder="e.g. GB-SCT, IN-KA" value={teamSubdivisions} onChange={e=>setTeamSubdivisions(e.target.value.toUpperCase())}/></label>
     <label>Sector<input name="sector" required maxLength={80} value={profile.sector} onChange={e=>setProfile({...profile,sector:e.target.value})}/></label>
     <fieldset><legend>Looking for</legend><div className="choices">{kinds.map(x=><label className="chip" key={x}><input type="checkbox" checked={profile.needs.includes(x)} onChange={e=>setProfile({...profile,needs:e.target.checked?[...profile.needs,x]:profile.needs.filter(n=>n!==x)})}/>{names[x]}</label>)}</div></fieldset>
     {/biotech|medical|health/i.test(profile.sector)&&<fieldset><legend>NIH prerequisites</legend><label className="chip"><input type="checkbox" checked={profile.priorNihAward===true} onChange={e=>setProfile({...profile,priorNihAward:e.target.checked})}/>Prior NIH SBIR/STTR award</label><label className="chip"><input type="checkbox" checked={profile.plansClinicalTrial===true} onChange={e=>setProfile({...profile,plansClinicalTrial:e.target.checked})}/>Planning a clinical trial</label></fieldset>}
     <button name="scan" className="primary" disabled={pending} type="submit">{pending?"Scanning…":"Scan opportunities →"}</button>
     {error&&<p className="error" role="alert">{error}</p>}
     </form>
    </section>}
    <section className="panel results" ref={resultsRef} tabIndex={-1} aria-busy={pending}>
     <div className="section-kicker">02 / DISCOVER</div><div className="result-title"><h2>{shownBundle?"Free builder bundle":"Ranked opportunities"}</h2><span className="muted" aria-live="polite">{resultCount} {shownBundle?"perks":"matches"}</span></div>
     <p className="meta">For {saved.name} <span>·</span> Scanned {formatDate(radar.scannedAt)} UTC</p>
     {!shownBundle&&<ReportSummary score={radar.matches.length?Math.max(...radar.matches.map(m=>m.score)):null} total={radar.matches.length}/>}
     <div className="action-strip">{!sample&&radar.scanId&&<ShareControls key={radar.scanId} scanId={radar.scanId}/>}<SuggestOpportunity/></div>
     {!shownBundle&&<MatchAnalytics radar={radar} initialNow={initialNow}/>}
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
       {m.amount&&<span>Award ceiling {money(m.amount,m)}</span>}{opportunityLocation(m)&&<span>{opportunityLocation(m)}</span>}<a href={m.url} target="_blank" rel="noreferrer">Source ↗</a>
      </div>{m.regionNote&&<small className="warning">{m.regionNote}</small>}{m.prerequisites?.length?<small className="warning"> {m.prerequisites.join(" · ")}</small>:null}
      {m.kind==="Perks"&&<p className="rowmeta">{m.eligibility}</p>}
     </div><div className="score"><b>{m.score}%</b><span>FIT</span></div></li>)}</ul>
     {!resultCount&&<p className="empty">{filter==="VC"?"No investor matches for this profile. Product launches aren’t investor opportunities.":"No matches in this view. Try another category or edit your profile."}</p>}
     {!!radar.evidence?.length&&<details><summary>Related past funding ({radar.evidence.length})</summary><ul className="fact-list">{radar.evidence.map(f=><li key={f.id}><a href={f.url} target="_blank" rel="noreferrer">{f.title} ↗</a><small>{f.source} · {f.kind} · Not open for applications</small></li>)}</ul></details>}
    </section>
   </div>
   {digest&&<section className="panel detail" ref={digestRef} tabIndex={-1} aria-label="Digest preview"><h2>Weekly digest preview</h2><p className="muted">Top five matches · Mondays at 13:00 UTC</p>
    <p aria-live="polite">{digestState==="subscribed"?"Subscribed":digestState==="pending"?"Check your inbox to confirm":"Not subscribed"}</p>
    {digestState==="off"?<>{sample&&<button className="secondary" onClick={()=>editField("scan")}>Scan first</button>}{emailAvailable===false?<p className="muted">Email delivery isn’t set up yet — preview below.</p>:!sample&&emailAvailable&&<form className="ask" onSubmit={e=>{e.preventDefault();void digestAction("subscribe");}}><input aria-label="Email for weekly digest" type="email" required value={digestEmail} onChange={e=>setDigestEmail(e.target.value)} placeholder="you@company.com"/><button className="secondary" disabled={digestBusy}>Subscribe</button></form>}</>:<button className="secondary" disabled={digestBusy} onClick={()=>digestAction("unsubscribe")}>{digestState==="pending"?"Cancel request":"Unsubscribe"}</button>}
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
  </main><footer>STARTFUND <span>·</span> <Link className="secondary nav-link pricing-link" href="/pricing">Pricing ↗</Link> <span>·</span> Fit is a heuristic, not an eligibility decision.</footer>
 </div>;
}
