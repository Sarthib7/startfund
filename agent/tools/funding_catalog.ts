import { defineTool } from "eve/tools";
import { catalogInput } from "../../lib/catalog-input";
import { catalog } from "../../lib/store";

export default defineTool({
 description:"Search Startfund’s public funding catalog for open opportunities, sourced historical awards, accelerator batches, and Form D filing signals. A filing is not an endorsement or an investment check.",
 inputSchema:catalogInput,
 async execute(input){return catalog({...input,limit:Math.min(input.limit??10,10)});},
});
