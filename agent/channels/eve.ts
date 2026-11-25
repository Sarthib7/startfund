import { httpBasic } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

const secret=process.env.RADAR_AGENT_SECRET;
export default eveChannel({auth:secret ? httpBasic({username:"radar",password:secret}) : []});
