import { listingStatus, type Match } from "./domain";

export function resultOverview(matches:Match[],asOf:string){
 const today=asOf.slice(0,10);
 const limit=new Date(Date.parse(today)+90*86_400_000).toISOString().slice(0,10);
 const scores=[{label:"Below 50",count:0},{label:"50–69",count:0},{label:"70–84",count:0},{label:"85–100",count:0}];
 const kinds=new Map<string,number>(),amounts=new Map<Match["currency"],number[]>();
 let covered=0;
 for(const match of matches){
  ++scores[match.score>=85?3:match.score>=70?2:match.score>=50?1:0].count;
  const type=match.kind==="VC"?"Investor":match.kind;
  kinds.set(type,(kinds.get(type)??0)+1);
  if(match.amount&&match.amount>0){
   ++covered;
   amounts.set(match.currency,[...(amounts.get(match.currency)??[]),match.amount]);
  }
 }
 const deadlines=matches.filter(row=>row.deadline&&row.deadline.slice(0,10)>=today&&row.deadline.slice(0,10)<=limit&&["Open","Forthcoming"].includes(listingStatus(row,asOf)))
  .sort((a,b)=>a.deadline!.localeCompare(b.deadline!));
 return {scores,types:[...kinds].map(([label,count])=>({label,count})).sort((a,b)=>b.count-a.count),
  deadlines,covered,amounts:[...amounts].map(([currency,values])=>({currency,count:values.length,min:Math.min(...values),max:Math.max(...values)}))};
}
