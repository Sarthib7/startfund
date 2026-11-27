export function BrandMark({size=24}:{size?:number}){
 return <svg className="brand-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" shapeRendering="geometricPrecision">
  <g transform="translate(32 33) scale(1.2) translate(-32 -32)">
   <path fill="currentColor" fillRule="evenodd" d="M14 52V30C23 22 35 15 50 10V52H14Z M22 52V40C31 32 41 27 49 24V30C40 33 31 39 28 45V52Z"/>
   <path style={{fill:"var(--brand-mark-brass)"}} d="M41 14C45 12 48 10 50 10V21L47 22L43 23Z"/>
  </g>
 </svg>;
}
