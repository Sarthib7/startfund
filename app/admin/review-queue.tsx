"use client";
import { useState } from "react";
import type { pendingSuggestions } from "../../lib/suggestions";

export function ReviewQueue({initial}:{initial:Awaited<ReturnType<typeof pendingSuggestions>>}){
 const [pending,setPending]=useState(initial),[token,setToken]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 async function review(id:string,decision:"approved"|"rejected"){
  setBusy(true);setMessage("");
  try{
   const response=await fetch("/api/admin/suggestions",{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({id,decision})});
   if(!response.ok)throw new Error(response.status===404?"Check the operator token.":"Review not saved. Reload to check the queue.");
   setPending(rows=>rows.filter(row=>row.id!==id));
   setMessage(decision==="approved"?"Suggestion approved.":"Suggestion rejected.");
  }catch(error){setMessage(error instanceof Error?error.message:"Review not saved.");}
  finally{setBusy(false);}
 }
 return <section className="panel detail"><h2>Pending suggestions</h2>
  {pending.length>0&&<label>Operator token<input type="password" autoComplete="off" value={token} onChange={event=>setToken(event.target.value)}/></label>}
  <p role="status">{message}</p>
  {pending.length?<ul className="rows">{pending.map(item=><li key={item.id}><div>
   <p className="rowtag">{item.type} · {item.region}{item.deadline?" · "+item.deadline:""}{item.amount?" · "+item.amount+" "+item.currency:""}</p>
   <a className="rowtitle" href={item.url} target="_blank" rel="noreferrer">{item.name} ↗</a>
   <p>{item.description}</p>{item.email&&<p className="meta">Submitter: {item.email}</p>}
   <div className="action-strip"><button className="primary" disabled={!token||busy} onClick={()=>void review(item.id,"approved")}>Approve</button>
    <button className="secondary" disabled={!token||busy} onClick={()=>void review(item.id,"rejected")}>Reject</button></div>
  </div></li>)}</ul>:<p>No pending suggestions.</p>}
 </section>;
}
