import { randomBytes } from "node:crypto";
import { ForbiddenError, httpBasic } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";
import { meterUsage, usageIdentity } from "../../lib/usage";

const secret=process.env.RADAR_AGENT_SECRET || randomBytes(32).toString("hex");
const authenticate=httpBasic({username:"radar",password:secret});
export default eveChannel({auth:async request=>{
 const principal=await authenticate(request);
 if(principal&&request.method==="POST"){
  const identity=await usageIdentity(request,secret);
  if(identity&&!(await meterUsage(identity,"agent","agent")).allowed)
   throw new ForbiddenError({message:"Agent usage limit reached."});
 }
 return principal;
}});
