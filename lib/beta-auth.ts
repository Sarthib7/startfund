import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export const betaCookie="startfund-beta";
export const betaSessionMs=7*24*60*60*1000;
export const betaInviteMs=30*24*60*60*1000;
const alphabet="0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const invitePattern=/^[0-9A-HJKMNP-TV-Z]{16}$/;

function secret(){
 return process.env.RADAR_AUTH_SECRET||process.env.RADAR_USAGE_SECRET||null;
}
export function betaAuthConfigured(){
 return Boolean(secret());
}
const digest=(value:string)=>createHash("sha256").update(value).digest();
const hash=(value:string)=>digest(value).toString("hex");
const mac=(value:string,key:string)=>createHmac("sha256",key).update(value).digest("base64url");
const sameMac=(a:string,b:string)=>timingSafeEqual(digest(a),digest(b));

function randomCode(){
 const bytes=randomBytes(16);
 let raw="";
 for(let i=0;i<16;i++)raw+=alphabet[bytes[i]&31];
 return raw.replace(/(.{4})(?=.)/g,"$1-");
}
export function canonicalInviteCode(value:string){
 const code=value.trim().toUpperCase().replace(/[\s-]/g,"");
 return invitePattern.test(code)?code:null;
}
async function database(){
 return (await import("./database")).db();
}

export async function createBetaInvite(now=Date.now()){
 const code=randomCode(), canonical=canonicalInviteCode(code);
 if(!canonical)throw new Error("Generated invite code was invalid.");
 const expires=now+betaInviteMs;
 await (await database()).run(
  "INSERT INTO beta_invites (id,code_hash,created,expires) VALUES (?,?,?,?)",
  randomUUID(),hash(canonical),now,expires,
 );
 return {code,expires};
}

function sessionValue(expires:number,nonce:string,key:string){
 const payload=`v1.${expires}.${nonce}`;
 return `${payload}.${mac(payload,key)}`;
}
export function createBetaSession(now=Date.now()){
 const key=secret();
 if(!key)return null;
 const expires=now+betaSessionMs;
 return {expires,value:sessionValue(expires,randomBytes(24).toString("base64url"),key)};
}
export function verifyBetaSession(value:string|undefined,now=Date.now()){
 const key=secret();
 const parts=value?.split(".")??[];
 if(!key||parts.length!==4||parts[0]!=="v1")return null;
 const [,expiresText,nonce,signature]=parts;
 const expires=Number(expiresText);
 if(!Number.isSafeInteger(expires)||expires<=now||expires>now+betaSessionMs+1000)return null;
 if(!/^[A-Za-z0-9_-]{32}$/.test(nonce)||!/^[A-Za-z0-9_-]{43}$/.test(signature))return null;
 const payload=`v1.${expiresText}.${nonce}`;
 return sameMac(signature,mac(payload,key))?{expires}:null;
}

export async function redeemBetaInvite(input:string,now=Date.now()){
 const code=canonicalInviteCode(input);
 const session=createBetaSession(now);
 if(!code||!session)return null;
 const updated=await (await database()).run(
  "UPDATE beta_invites SET used=? WHERE code_hash=? AND used IS NULL AND expires>?",
  now,hash(code),now,
 );
 return updated?session:null;
}

function secureCookie(request:Request){
 return request.headers.get("x-forwarded-proto")==="https"||new URL(request.url).protocol==="https:";
}
export function betaSessionCookie(request:Request,value:string,expires:number,now=Date.now()){
 const secure=secureCookie(request)?"; Secure":"";
 return `${betaCookie}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(1,Math.floor((expires-now)/1000))}${secure}`;
}
export function clearBetaSessionCookie(request:Request){
 const secure=secureCookie(request)?"; Secure":"";
 return `${betaCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
export function readBetaSession(headers:Headers,now=Date.now()){
 const value=headers.get("cookie")?.match(/(?:^|;\s*)startfund-beta=([^;]+)/)?.[1];
 return verifyBetaSession(value,now);
}
