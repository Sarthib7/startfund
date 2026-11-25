import { z } from "zod";
import { rights } from "./facts";
export const catalogInput=z.object({
 q:z.string().trim().max(120).optional(),
 source:z.string().refine(s=>Object.hasOwn(rights,s),"Unknown source").optional(),
 limit:z.number().int().min(1).max(60).optional(),
});
