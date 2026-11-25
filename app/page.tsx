import { cookies } from "next/headers";
import { demo } from "../lib/domain";
import { radar, saved } from "../lib/store";
import Dashboard from "./dashboard";
export const dynamic="force-dynamic";
export default async function Home(){
 const id=(await cookies()).get("startfund-profile")?.value;
 const current=id ? saved(id) : null;
 const profile=current?.profile ?? demo;
 return <Dashboard initialProfile={profile} initialRadar={current?.digest ?? await radar(profile)} />;
}
