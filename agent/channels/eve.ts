import { randomBytes } from "node:crypto";
import { httpBasic } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

const secret=process.env.RADAR_AGENT_SECRET || randomBytes(32).toString("hex");
export default eveChannel({auth:httpBasic({username:"radar",password:secret})});
