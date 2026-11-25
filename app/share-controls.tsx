"use client";
import { useState } from "react";

export function ShareControls({publicPath,scanId}:{publicPath?:string;scanId?:string}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[url,setUrl]=useState(""),[message,setMessage]=useState("");
 async function publish(){
  setBusy(true);setMessage("");
  try{
   const response=await fetch("/api/share",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({scanId})});
   const data=await response.json();
   if(!response.ok)throw new Error(data.error??"Could not create link.");
   setUrl(new URL(data.path,location.origin).href);
  }catch(error){setMessage(error instanceof Error?error.message:"Could not create link.");}
  finally{setBusy(false);}
 }
 return <div className="share-controls">
  <button type="button" className="secondary" aria-expanded={open} onClick={()=>{
   if(publicPath)setUrl(new URL(publicPath,location.origin).href);
   setOpen(!open);
  }}>Share report ↗</button>
  {open&&<div className="share-sheet">
   {!publicPath&&<p>Anyone with the link can view your company name, sector, region, stage and top matches. Your email and profile notes aren’t included.</p>}
   {!url?<button type="button" className="primary" disabled={busy} onClick={publish}>{busy?"Creating…":"Create public link"}</button>:<>
    <label>Public link<input readOnly value={url} onFocus={event=>event.currentTarget.select()}/></label>
    <div className="action-strip">
     {!publicPath&&<a className="secondary nav-link pricing-link" href={url}>Open public report ↗</a>}
     <button type="button" className="secondary" onClick={()=>navigator.clipboard.writeText(url).then(()=>setMessage("Link copied.")).catch(()=>setMessage("Select the link above to copy it."))}>Copy link</button>
     {typeof navigator.share==="function"&&<button type="button" className="secondary" onClick={()=>void navigator.share({url}).catch(()=>{})}>Share…</button>}
     <a className="secondary nav-link pricing-link" href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer">X ↗</a>
     <a className="secondary nav-link pricing-link" href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer">LinkedIn ↗</a>
    </div>
   </>}
   {message&&<p role="status">{message}</p>}
  </div>}
 </div>;
}
