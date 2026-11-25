import { defineTool } from "eve/tools";
import { z } from "zod";
import { sourceRows } from "../../lib/store";

export default defineTool({description:"Read cached opportunities or signals from Hacker News.",inputSchema:z.object({}),async execute(){const result=await sourceRows("Hacker News");return {...result,items:result.items.slice(0,8)};}});
