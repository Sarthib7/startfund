import { ImageResponse } from "next/og";
import { getShare } from "../../../lib/shares";

export const size={width:1200,height:630};
export const contentType="image/png";
export const alt="Startfund funding snapshot";

const outer="M14 52V30C23 22 35 15 50 10V52H14Z M22 52V40C31 32 41 27 49 24V30C40 33 31 39 28 45V52Z";
const brass="M41 14C45 12 48 10 50 10V21L47 22L43 23Z";

function Mark(){
 return <svg width="58" height="58" viewBox="0 0 64 64">
  <g transform="translate(32 33) scale(1.2) translate(-32 -32)">
   <path fill="#0B2B22" fillRule="evenodd" d={outer}/>
   <path fill="#C4A15D" d={brass}/>
  </g>
 </svg>;
}

export default async function Preview({params}:{params:Promise<{id:string}>}){
 const snapshot=await getShare((await params).id);
 if(!snapshot)return new Response(null,{status:404});
 return new ImageResponse(<div style={{display:"flex",flexDirection:"column",justifyContent:"space-between",height:"100%",width:"100%",padding:65,background:"#F4EFE3",color:"#0B2B22"}}>
  <div style={{display:"flex",alignItems:"center",gap:14,fontSize:34}}><Mark/> Startfund</div>
  <div style={{display:"flex",flexDirection:"column"}}>
   <div style={{display:"flex",fontSize:29,color:"#A9823F",letterSpacing:2}}>SHARED FUNDING SNAPSHOT</div>
   <div style={{display:"flex",fontSize:68,marginTop:18}}>{snapshot.company.name}</div>
   <div style={{display:"flex",fontSize:33,marginTop:18,color:"#607066"}}>{snapshot.company.sector}</div>
  </div>
  <div style={{display:"flex",fontSize:30}}>{snapshot.topScore===null?"No ranked opportunities":`${snapshot.topScore}/100 top match fit · ${snapshot.matchCount} ranked opportunities`}</div>
 </div>,size);
}
