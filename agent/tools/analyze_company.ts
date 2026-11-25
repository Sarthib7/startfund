import { defineTool } from "eve/tools";
import { z } from "zod";
import { analyzeCompany } from "../../lib/company";

export default defineTool({
 description:"Read a public company website when its robots rules allow. Return inferred, unconfirmed profile details.",
 inputSchema:z.object({company:z.string().trim().min(1).max(240)}),
 async execute({company}) {return analyzeCompany(company);},
});
