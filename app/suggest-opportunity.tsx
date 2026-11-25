"use client";
import { useRef, useState, type FormEvent } from "react";

export function SuggestOpportunity(){
 const dialog=useRef<HTMLDialogElement>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[sent,setSent]=useState(false);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setBusy(true);setError("");
  const raw=Object.fromEntries(new FormData(event.currentTarget));
  try{
   const response=await fetch("/api/suggestions",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({...raw,amount:raw.amount?Number(raw.amount):null})});
   const data=await response.json();
   if(!response.ok)throw new Error(data.error??"Suggestion not sent.");
   setSent(true);
  }catch(error){setError(error instanceof Error?error.message:"Suggestion not sent.");}
  finally{setBusy(false);}
 }
 return <>
  <button type="button" className="secondary" onClick={()=>{setSent(false);setError("");dialog.current?.showModal();}}>Suggest an opportunity +</button>
  <dialog className="panel suggest-dialog" ref={dialog} aria-label="Suggest an opportunity">
   <div className="result-title"><h2>Suggest an opportunity</h2><button className="secondary" onClick={()=>dialog.current?.close()}>Close</button></div>
   {sent?<p role="status">Thanks! We’ll review your suggestion before it appears in the catalog.</p>:<>
    <p className="meta">Share the official source. A reviewer will check it before publication.</p>
    <form onSubmit={submit} className="suggest-form">
     <label>Type<select name="type"><option>Accelerator</option><option value="VC">Venture capital</option><option>Grant</option><option>Other</option></select></label>
     <label>Region<select name="region"><option value="Global">Global / other</option><option value="US">United States</option><option value="EU">European Union</option><option value="DE">Germany</option><option value="UK">United Kingdom</option></select></label>
     <label className="span-all">Opportunity name<input name="name" required maxLength={120}/></label>
     <label className="span-all">Official HTTPS URL<input name="url" type="url" placeholder="https://" required maxLength={500}/></label>
     <label className="span-all">Deadline (optional)<input type="date" name="deadline"/></label>
     <label>Amount (optional)<input name="amount" type="number" min="0.01" max="1000000000000" step="0.01"/></label>
     <label>Currency<select name="currency">{["USD","EUR","GBP","INR","AUD","SGD"].map(c=><option key={c}>{c}</option>)}</select></label>
     <label className="span-all">Short description<textarea name="description" required maxLength={600}/></label>
     <label className="span-all">Your email (optional, reviewers only)<input name="email" type="email" maxLength={254}/></label>
     <label className="suggest-trap" aria-hidden="true">Leave empty<input name="website" tabIndex={-1} autoComplete="off"/></label>
     {error&&<p role="alert" className="warning span-all">{error}</p>}
     <button className="primary span-all" disabled={busy}>{busy?"Sending…":"Send for review"}</button>
    </form>
   </>}
  </dialog>
 </>;
}
