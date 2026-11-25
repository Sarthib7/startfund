import { ImageResponse } from "next/og";
import { getShare } from "../../../lib/shares";

export const size={width:1200,height:630};
export const contentType="image/png";
export const alt="Startfund funding snapshot";

export default async function Preview({params}:{params:Promise<{id:string}>}){
 const snapshot=await getShare((await params).id);
 if(!snapshot)return new Response(null,{status:404});
 return new ImageResponse(<div style={{display:"flex",flexDirection:"column",justifyContent:"space-between",height:"100%",width:"100%",padding:65,background:"#eef5eb",color:"#173328"}}>
  <div style={{display:"flex",alignItems:"center",gap:12,fontSize:34}}>
   <div style={{width:24,height:24,border:"4px solid #407855",borderRadius:"50%"}}/> Startfund
  </div>
  <div style={{display:"flex",flexDirection:"column"}}>
   <div style={{display:"flex",fontSize:29,color:"#407855"}}>SHARED FUNDING SNAPSHOT</div>
   <div style={{display:"flex",fontSize:68,marginTop:18}}>{snapshot.company.name}</div>
   <div style={{display:"flex",fontSize:33,marginTop:18}}>{snapshot.company.sector}</div>
  </div>
  <div style={{display:"flex",fontSize:30}}>{snapshot.topScore===null?"No ranked opportunities":`${snapshot.topScore}/100 top match fit · ${snapshot.matchCount} ranked opportunities`}</div>
 </div>,size);
}
