import { randomBytes } from "node:crypto";
import { TooManyRequestsError, httpBasic } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";
import { meterUsage, usageIdentity } from "../../lib/usage";

const secret=process.env.RADAR_AGENT_SECRET || randomBytes(32).toString("hex");
export function meteredAgentAuth(secret:string){
 const authenticate=httpBasic({username:"radar",password:secret});
 return async (request:Request)=>{
  const principal=await authenticate(request);
  if(principal&&request.method==="POST"){
   const identity=await usageIdentity(request,secret);
   if(identity){
    const decision=await meterUsage(identity,"agent","agent");
    if(!decision.allowed)
     throw new TooManyRequestsError({message:"Agent usage limit reached.",retryAfter:decision.retryAfter});
   }
  }
  return principal;
 };
}

export default eveChannel({auth:meteredAgentAuth(secret)});
