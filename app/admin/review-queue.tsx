"use client";
import { useState, type FormEvent } from "react";
import type { pendingSuggestions } from "../../lib/suggestions";

export function ReviewQueue({initial=null}:{initial?:Awaited<ReturnType<typeof pendingSuggestions>>|null}){
 const [pending,setPending]=useState(initial),[token,setToken]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[invite,setInvite]=useState<{code:string;expiresAt:string}|null>(null);
 async function unlock(event:FormEvent){
  event.preventDefault();setBusy(true);setMessage("");
  try{
   const response=await fetch("/api/admin/suggestions",{headers:{authorization:`Bearer ${token}`}});
   if(!response.ok)throw new Error(response.status===404?"Check the operator token.":"Couldn’t load the review queue.");
   setPending(await response.json());
  }catch(error){setMessage(error instanceof Error?error.message:"Couldn’t load the review queue.");}
  finally{setBusy(false);}
 }
 async function generateInvite(){
  setBusy(true);setMessage("");setInvite(null);
  try{
   const response=await fetch("/api/admin/invites",{method:"POST",headers:{authorization:`Bearer ${token}`}});
   if(!response.ok)throw new Error(response.status===404?"Check the operator token.":"Couldn’t generate an invite.");
   const body=await response.json();
   if(typeof body.code!=="string"||typeof body.expiresAt!=="string")throw new Error("Couldn’t generate an invite.");
   setInvite({code:body.code,expiresAt:body.expiresAt});setMessage("Invite generated. Copy it now. It is shown once.");
  }catch(error){setMessage(error instanceof Error?error.message:"Couldn’t generate an invite.");}
  finally{setBusy(false);}
 }
 async function review(id:string,decision:"approved"|"rejected"){
  setBusy(true);setMessage("");
  try{
   const response=await fetch("/api/admin/suggestions",{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({id,decision})});
   if(!response.ok)throw new Error(response.status===404?"Check the operator token.":"Review not saved. Reload to check the queue.");
   setPending(rows=>rows?.filter(row=>row.id!==id)??null);
   setMessage(decision==="approved"?"Suggestion approved.":"Suggestion rejected.");
  }catch(error){setMessage(error instanceof Error?error.message:"Review not saved.");}
  finally{setBusy(false);}
 }
 return <section className="panel detail"><h2>Pending suggestions</h2>
  {(!pending||pending.length>0)&&<form onSubmit={unlock}>
   <label>Operator token<input type="password" autoComplete="off" value={token} onChange={event=>setToken(event.target.value)}/></label>
   <button className="primary" disabled={!token||busy}>Load review queue</button>
  </form>}
  <div className="profile-confirm"><button type="button" className="secondary" disabled={!token||busy} onClick={()=>void generateInvite()}>Generate one-time invite</button>
   {invite&&<p><output><code>{invite.code}</code></output><span className="meta">Expires {new Date(invite.expiresAt).toLocaleDateString()}</span></p>}
  </div>
  <p role="status">{message}</p>
  {pending?.length?<ul className="rows">{pending.map(item=><li key={item.id}><div>
   <p className="rowtag">{item.type} · {item.region}{item.deadline?" · "+item.deadline:""}{item.amount?" · "+item.amount+" "+item.currency:""}</p>
   <a className="rowtitle" href={item.url} target="_blank" rel="noreferrer">{item.name} ↗</a>
   <p>{item.description}</p>{item.email&&<p className="meta">Submitter: {item.email}</p>}
   <div className="action-strip"><button className="primary" disabled={!token||busy} onClick={()=>void review(item.id,"approved")}>Approve</button>
    <button className="secondary" disabled={!token||busy} onClick={()=>void review(item.id,"rejected")}>Reject</button></div>
  </div></li>)}</ul>:pending&&<p>No pending suggestions.</p>}
 </section>;
}
