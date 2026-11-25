"use client";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Radar } from "../lib/domain";
import { resultOverview } from "../lib/result-overview";

const dateFormat=new Intl.DateTimeFormat("en",{month:"short",day:"numeric",timeZone:"UTC"});
const amount=(amount:number,currency:string)=>new Intl.NumberFormat("en",{style:"currency",currency,maximumFractionDigits:0}).format(amount);

function Counts({rows}:{rows:{label:string;count:number}[]}){
 return <>
  <div className="analytics-chart" aria-hidden="true"><ResponsiveContainer width="100%" height={145} minWidth={0}>
   <BarChart data={rows} margin={{left:0,right:6,top:8,bottom:0}} accessibilityLayer={false}>
    <CartesianGrid vertical={false} stroke="#e4ede2"/>
    <XAxis dataKey="label" hide/>
    <YAxis width={24} tickLine={false} axisLine={false} allowDecimals={false} tick={{fontSize:11}}/>
    <Tooltip cursor={{fill:"#edf4ec"}} formatter={value=>[value,"Matches"]}/>
    <Bar dataKey="count" fill="var(--overview-green)" radius={[4,4,0,0]} maxBarSize={32} isAnimationActive={false}/>
   </BarChart>
  </ResponsiveContainer></div>
  <ul className="overview-legend">{rows.map(row=><li key={row.label}>{row.label} <strong>{row.count}</strong></li>)}</ul>
 </>;
}

export function MatchAnalytics({radar,initialNow}:{radar:Radar;initialNow:string}){
 const [now,setNow]=useState(initialNow);
 useEffect(()=>{
  const refresh=()=>setNow(new Date().toISOString());
  refresh();
  const timer=setInterval(refresh,60_000);
  return ()=>clearInterval(timer);
 },[]);
 const data=resultOverview(radar.matches,now);
 return <section className="match-analytics" aria-label="Scan analytics">
  <div><div className="section-kicker">SCAN INSIGHTS</div><h3>Shortlist at a glance</h3><p className="meta">Based on all {radar.matches.length} ranked matches, before filters.</p></div>
  {radar.matches.length?<div className="analytics-grid">
   <section className="analytics-card"><h4>Fit score distribution</h4><p className="meta">Heuristic fit, not an eligibility decision.</p><Counts rows={data.scores}/></section>
   <section className="analytics-card"><h4>Matches by type</h4><p className="meta">Where your shortlist is concentrated.</p><Counts rows={data.types}/></section>
   <section className="analytics-card overview-timeline"><h4>Deadlines · next 90 days</h4>
    {data.deadlines.length?<ol>{data.deadlines.map(row=><li key={row.id}><time dateTime={row.deadline!}>{dateFormat.format(new Date(row.deadline!))}</time><div><a href={row.url} target="_blank" rel="noreferrer">{row.title}</a><small>{row.source}</small></div></li>)}</ol>:<p className="meta">No dated application deadlines in this window.</p>}
   </section>
   <section className="analytics-card"><h4>Published amounts</h4>
    <p className="amount-coverage">{data.covered}<span> / {radar.matches.length} matches report an amount</span></p>
    {data.amounts.length>0&&<ul className="amount-ranges">{data.amounts.map(row=><li key={row.currency}><strong>{row.currency}</strong> {amount(row.min,row.currency)}{row.min!==row.max?` – ${amount(row.max,row.currency)}`:""} <small>· {row.count} listed</small></li>)}</ul>}
    <p className="meta">Ranges show listed figures by currency. Awards, budgets, and investment amounts aren’t added together.</p>
   </section>
  </div>:<p className="meta">No matches to chart. Try broadening the sector or selecting more opportunity types.</p>}
 </section>;
}
