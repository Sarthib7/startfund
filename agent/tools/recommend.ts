import { defineTool } from "eve/tools";
import { profileSchema } from "../../lib/domain";
import { completedRadar } from "../../lib/store";

export default defineTool({
 description:"Rank funding opportunities for a confirmed profile. Historical records are separate, not open funding.",
 inputSchema:profileSchema,
 async execute(profile){return completedRadar(profile,"agent");},
});
