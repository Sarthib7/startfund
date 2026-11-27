import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist } from "next/font/google";
import "./style.css";

const geist=Geist({subsets:["latin"]});

export const metadata:Metadata={title:"Startfund — Funding radar",description:"A funding radar for your startup."};
export default function Layout({children}:{children:ReactNode}){
 return <html lang="en" className={geist.className}><body>{children}</body></html>;
}
