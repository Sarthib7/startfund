"use client";
import {useState,type FormEvent} from "react";

function formatInviteCode(value:string){
 return value.toUpperCase().replace(/[^0-9A-Z]/g,"").slice(0,16).replace(/(.{4})(?=.)/g,"$1-");
}

export function LoginForm({next}:{next:string}){
 const [code,setCode]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const target=next.startsWith("/")&&!next.startsWith("//")&&!next.includes("\\")?next:"/app";
 async function submit(event:FormEvent){
  event.preventDefault();setBusy(true);setError("");
  try{
   const response=await fetch("/api/auth/redeem",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code})});
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(typeof body.error==="string"?body.error:"Invalid or expired invite code.");
   window.location.assign(target);
  }catch(error){setError(error instanceof Error?error.message:"Invalid or expired invite code.");setBusy(false);}
 }
 return <form className="login-form setup" onSubmit={submit}>
  <label>Invite code<input type="text" value={code} onChange={event=>setCode(formatInviteCode(event.target.value))} autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX-XXXX-XXXX" maxLength={19} required/></label>
  <button className="primary" disabled={busy||!code.trim()}>{busy?"Checking…":"Sign in"}</button>
  <p role="alert">{error}</p>
 </form>;
}
