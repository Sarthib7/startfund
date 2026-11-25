import { defineTool } from "eve/tools";
import { z } from "zod";
import { sourceRows } from "../../lib/store";

export default defineTool({description:"Read cached opportunities or signals from Grants.gov.",inputSchema:z.object({}),async execute(){const result=await sourceRows("Grants.gov");return {...result,items:result.items.slice(0,8)};}});
