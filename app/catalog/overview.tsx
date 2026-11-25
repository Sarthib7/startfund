"use client";
import { useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { catalogOverview } from "../../lib/catalog-overview";

const groups={byType:"Type",byRegion:"Region",byStatus:"Status"} as const;
const dateFormat=new Intl.DateTimeFormat("en",{month:"short",day:"numeric",timeZone:"UTC"});
export function Overview({data}:{data:ReturnType<typeof catalogOverview>}){
 const [group,setGroup]=useState<keyof typeof groups>("byRegion");
 const rows=data[group];
 return <section className="panel funding-overview" aria-labelledby="funding-overview">
  <div className="overview-head"><div><div className="section-kicker">CATALOG INSIGHTS</div><h2 id="funding-overview">Catalog at a glance</h2><p className="meta">Counts reflect the listings in this view, not the whole funding market.</p></div>
   <dl className="overview-stats"><div><dt>Listings</dt><dd>{data.total}</dd></div><div><dt>Accepting applications</dt><dd>{data.open}</dd></div><div><dt>Open grants with amounts</dt><dd>{data.withAmount}</dd></div></dl>
  </div>
  <div className="overview-grid">
   <div className="overview-mix analytics-card"><div className="overview-subhead"><h3>Listing mix</h3><div className="overview-controls" role="group" aria-label="Group listings by">
    {(Object.keys(groups) as (keyof typeof groups)[]).map(key=><button key={key} type="button" aria-pressed={group===key} onClick={()=>setGroup(key)}>{groups[key]}</button>)}
   </div></div>
   {rows.length?<><div className="overview-chart" aria-hidden="true"><ResponsiveContainer width="100%" height={Math.max(154,rows.length*34)} minWidth={0}>
    <BarChart layout="vertical" data={rows} margin={{right:12}} accessibilityLayer={false}>
     <XAxis type="number" hide allowDecimals={false}/>
     <YAxis type="category" dataKey="label" width={108} axisLine={false} tickLine={false} tick={{fontSize:12,fill:"var(--overview-ink)"}}/>
     <Tooltip cursor={{fill:"var(--overview-wash)"}} contentStyle={{borderColor:"var(--overview-line)",borderRadius:8}} formatter={value=>[String(value),"Listings"]}/>
     <Bar dataKey="count" fill="var(--overview-green)" radius={[0,4,4,0]} maxBarSize={15} isAnimationActive={false}/>
    </BarChart>
   </ResponsiveContainer></div><ul className="overview-legend" aria-label={`Counts by ${groups[group].toLowerCase()}`}>{rows.map(row=><li key={row.label}>{row.label} <strong>{row.count}</strong></li>)}</ul></>:
    <p className="meta">No listings in this view. Try a different search or source.</p>}
   </div>
   <div className="overview-timeline analytics-card"><h3>Next deadlines</h3>
    {data.deadlines.length?<ol>{data.deadlines.map(row=><li key={row.id}><time dateTime={row.date}>{dateFormat.format(new Date(row.date))}</time><div><a href={row.url} target="_blank" rel="noreferrer">{row.title}</a><small>{row.source}</small></div></li>)}</ol>:
     <p className="meta">No dated open calls in this view.</p>}
   </div>
  </div>
 </section>;
}
