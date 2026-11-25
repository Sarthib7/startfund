"use client";

import Link from "next/link";
import {useEffect,useState,type FormEvent} from "react";

type BillingStatus={enabled:boolean;pro:boolean;issued:boolean;customer:boolean};

export function BillingControls({success=false}:{success?:boolean}){
 const [status,setStatus]=useState<BillingStatus>();
 const [error,setError]=useState("");
 const [busy,setBusy]=useState(false);
 const [restore,setRestore]=useState(false);
 const [key,setKey]=useState("");
 const [waiting,setWaiting]=useState(success);
 const [attempt,setAttempt]=useState(0);

 useEffect(()=>{
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>;
  let checks=0;
  async function load(){
   try{
    const response=await fetch("/api/billing/status",{cache:"no-store",signal:controller.signal});
    if(!response.ok)throw new Error();
    const current:BillingStatus=await response.json();
    if(controller.signal.aborted)return;
    setStatus(current);
    if(success&&current.enabled&&!current.pro&&++checks<15)timer=setTimeout(load,2000);
    else setWaiting(false);
   }catch{
    if(!controller.signal.aborted){setError("Could not check billing status. Try refreshing this page.");setWaiting(false);}
   }
  }
  void load();
  return ()=>{controller.abort();clearTimeout(timer);};
 },[success,attempt]);

 async function act(action:"checkout"|"portal"|"restore"|"claim",input:object={}){
  setBusy(true);setError("");
  try{
   const response=await fetch(`/api/billing/${action}`,{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input),
   });
   const data=await response.json();
   if(!response.ok)throw new Error(data.error??"Billing is temporarily unavailable.");
   if(data.url)window.location.assign(data.url);
   if(action==="claim"){setKey(data.key);setStatus(previous=>previous&&({...previous,issued:true}));}
   if(action==="restore"){setRestore(false);setAttempt(previous=>previous+1);}
  }catch(e){
   setError(e instanceof Error?e.message:"Billing is temporarily unavailable.");
   if(action==="claim")setAttempt(previous=>previous+1);
  }
  finally{setBusy(false);}
 }
 function restorePro(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  const input=new FormData(event.currentTarget).get("proKey");
  void act("restore",{key:input});
 }

 return <>
  {!status&&!error&&<p className="muted" role="status">Checking billing status…</p>}
  {status&&!status.enabled&&<p className="badge">Coming soon</p>}
  {status?.enabled&&<>
   {status.pro?<p className="badge" role="status">Pro is active</p>:
    success?<p className="muted" role="status">{waiting?"Waiting for Stripe to confirm your subscription…":"Pro hasn’t been confirmed on this device yet. Check again or restore using your existing key."}</p>:null}
   {key&&<label>Save this Pro API key now. It won’t be shown again.
    <input type="text" value={key} readOnly onFocus={event=>event.currentTarget.select()}/>
   </label>}
   {status.pro&&status.issued&&!key&&<p className="muted">Use your saved key to restore Pro on another device. If you lost it, replacing it will invalidate the old key.</p>}
   <div className="action-strip">
    {!success&&!status.pro&&<button className="primary" disabled={busy} onClick={()=>void act("checkout")}>Upgrade to Pro ↗</button>}
    {success&&!status.pro&&!waiting&&<button className="secondary" onClick={()=>{setWaiting(true);setAttempt(previous=>previous+1);}}>Check again</button>}
    {status.pro&&!status.issued&&<button className="primary" disabled={busy} onClick={()=>void act("claim")}>Show my Pro API key</button>}
    {status.pro&&status.issued&&!key&&<button className="secondary" disabled={busy} onClick={()=>void act("claim",{rotate:true})}>Replace Pro API key</button>}
    {status.customer&&<button className="secondary" disabled={busy} onClick={()=>void act("portal")}>Manage billing ↗</button>}
    {!status.pro&&<button className="secondary" aria-expanded={restore} onClick={()=>setRestore(!restore)}>Restore Pro</button>}
    {success&&status.pro&&<Link className="secondary nav-link pricing-link" href="/">Open funding radar ↗</Link>}
   </div>
   {restore&&<form onSubmit={restorePro}>
    <label>Pro API key<input name="proKey" type="password" required maxLength={50} autoComplete="off"/></label>
    <button className="secondary" disabled={busy}>Restore on this device</button>
   </form>}
  </>}
  {error&&<p className="error" role="alert">{error}</p>}
 </>;
}
