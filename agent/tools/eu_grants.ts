import { defineTool } from "eve/tools";
import { z } from "zod";
import { sourceRows } from "../../lib/store";

export default defineTool({description:"Read cached opportunities or signals from EU Funding & Tenders.",inputSchema:z.object({}),async execute(){const result=await sourceRows("EU Funding & Tenders");return {...result,items:result.items.slice(0,8)};}});
