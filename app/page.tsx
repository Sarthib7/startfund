import { cookies } from "next/headers";
import { demo } from "../lib/domain";
import { completedRadar, saved } from "../lib/store";
import Dashboard from "./dashboard";
export const dynamic="force-dynamic";
export default async function Home(){
 const id=(await cookies()).get("startfund-profile")?.value;
 const current=id ? await saved(id) : null;
 const profile=current?.profile ?? demo;
 const initialRadar=current?.digest?.scanId||current?.digest?.evidence ? current.digest : await completedRadar(profile,current&&id?id:"demo");
 return <Dashboard initialProfile={profile} initialRadar={initialRadar} initialSample={!current} />;
}
