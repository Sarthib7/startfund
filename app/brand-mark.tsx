export function BrandMark({size=24}:{size?:number}){
 return <svg className="brand-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
  <rect width="64" height="64" rx="15" fill="#0d2b20"/>
  <path d="M13 54V31C13 18 21 10 32 10s19 8 19 21v23" fill="none" stroke="#f4efe4" strokeWidth="9"/>
  <path d="M20 38h24" fill="none" stroke="#b99659" strokeWidth="7" strokeLinecap="round"/>
 </svg>;
}
