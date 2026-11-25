import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./style.css";
export const metadata:Metadata={title:"Startfund — Funding radar",description:"A funding radar for your startup."};
export default function Layout({children}:{children:ReactNode}){
 return <html lang="en"><body>{children}</body></html>;
}
