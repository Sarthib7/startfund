import { sameSecret } from "./usage";

export function isAdmin(headers:Headers){
 const token=process.env.RADAR_ADMIN_TOKEN;
 const supplied=headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
 return !!token&&!!supplied&&sameSecret(token,supplied);
}
