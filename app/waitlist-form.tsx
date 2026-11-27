"use client";
import {useState,type FormEvent} from "react";

export function WaitlistForm(){
 const [email,setEmail]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
 async function submit(event:FormEvent){
  event.preventDefault();setBusy(true);setError("");setMessage("");
  try{
   const response=await fetch("/api/waitlist",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email})});
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(typeof body.error==="string"?body.error:"Could not join the waitlist.");
   setMessage(body.state==="existing"?"You’re already on the waitlist.":"You’re on the waitlist.");
   setEmail("");
  }catch(error){setError(error instanceof Error?error.message:"Could not join the waitlist.");}
  finally{setBusy(false);}
 }
 return <form className="waitlist-form" onSubmit={submit}>
  <label><span>Work email</span><input type="email" value={email} onChange={event=>setEmail(event.target.value)} placeholder="you@company.com" maxLength={254} required/></label>
  <button className="landing-button dark" disabled={busy}>{busy?"Joining…":"Request access"}</button>
  {message&&<p className="waitlist-success" role="status">{message}</p>}
  {error&&<p className="waitlist-error" role="alert">{error}</p>}
 </form>;
}
