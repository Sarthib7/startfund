import { listingStatus, type Opportunity } from "./domain";

export function catalogOverview(listings:Opportunity[],today:string) {
  const tally=(key:(row:Opportunity)=>string)=>[...listings.reduce((counts,row)=>{
    const label=key(row);
    return counts.set(label,(counts.get(label)??0)+1);
  },new Map<string,number>())].map(([label,count])=>({label,count})).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label));
  const active=listings.filter(row=>["Open","Rolling","Late applications"].includes(listingStatus(row,today)));
  const deadlines=active.filter(row=>row.deadline&&row.deadline>=today&&listingStatus(row,today)==="Open")
    .sort((a,b)=>a.deadline!.localeCompare(b.deadline!)||a.title.localeCompare(b.title)).slice(0,4);
  return {
    total:listings.length,
    open:active.length,
    withAmount:active.filter(row=>row.kind==="Grant"&&row.amount).length,
    byType:tally(row=>row.kind==="VC"?"Investor":row.kind),
    byRegion:tally(row=>({US:"United States",EU:"European Union",DE:"Germany",UK:"United Kingdom",Global:"Global"})[row.region]),
    byStatus:tally(row=>listingStatus(row,today)),
    deadlines:deadlines.map(row=>({id:row.id,title:row.title,url:row.url,source:row.source,date:row.deadline!})),
  };
}
