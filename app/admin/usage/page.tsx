import Link from "next/link";
import {headers} from "next/headers";
import {notFound} from "next/navigation";
import {usageReport} from "../../../lib/usage";
import {isAdmin} from "../../../lib/admin";

export const dynamic="force-dynamic";
export const metadata={title:"Usage — Startfund",robots:{index:false,follow:false}};

export default async function UsagePage(){
 if(!isAdmin(await headers()))notFound();
 const {days,endpoints,hits}=await usageReport();
 return <div className="shell">
  <header><Link href="/" className="brand"><span aria-hidden>◎</span> Startfund</Link><span className="topline">OPERATOR</span></header>
  <main><div className="hero"><p className="eyebrow"><span className="live"/> OPERATIONS</p><h1>Usage<span>.</span></h1><p>Accepted requests and rate-limit hits over the last seven UTC days.</p></div>
   <div className="plan-grid">
    <section className="panel detail"><h2>Runs per day</h2>{days.length?<ul>{days.map(row=><li key={String(row.day)}>{new Date(Number(row.day)).toISOString().slice(0,10)} · {String(row.runs)}</li>)}</ul>:<p>No runs yet.</p>}</section>
    <section className="panel detail"><h2>Top endpoints</h2>{endpoints.length?<ul>{endpoints.map(row=><li key={String(row.endpoint)}>{String(row.endpoint)} · {String(row.runs)}</li>)}</ul>:<p>No runs yet.</p>}</section>
    <section className="panel detail"><h2>Limit hits</h2>{hits.length?<ul>{hits.map(row=><li key={String(row.endpoint)}>{String(row.endpoint)} · {String(row.hits)}</li>)}</ul>:<p>No limit hits yet.</p>}</section>
   </div>
  </main>
 </div>;
}
