import { z } from "zod";
import { rights } from "./facts";
import { communitySource } from "./suggestions";
export const catalogInput=z.object({
 q:z.string().trim().max(120).optional(),
 source:z.string().refine(s=>Object.hasOwn(rights,s)||s===communitySource,"Unknown source").optional(),
 limit:z.number().int().min(1).max(60).optional(),
});
