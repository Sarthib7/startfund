import { defineTool } from "eve/tools";
import { z } from "zod";
import { profileSchema } from "../../lib/domain";
import { builderBundle } from "../../lib/store";

export default defineTool({
 description:"Find official startup credits, free APIs and dev tools; review each item's eligibility and caps.",
 inputSchema:z.object({profile:profileSchema.optional()}),
 async execute({profile}){return builderBundle(profile);},
});
