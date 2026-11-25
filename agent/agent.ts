import { google } from "@ai-sdk/google";
import { groq } from "@ai-sdk/groq";
import { defineAgent, defineDynamic } from "eve";

export default defineAgent({
  model: defineDynamic(() => process.env.RADAR_MODEL_PROVIDER === "gemini" ? {model:google("gemini-3.1-flash-lite"),modelContextWindowTokens:32768} :
    process.env.RADAR_MODEL_PROVIDER === "groq" ? {model:groq("openai/gpt-oss-20b"),modelContextWindowTokens:8192} :
    process.env.RADAR_GATEWAY_MODEL || "reflection/beam-free"),
  defaultTools:false,
  limits:{sessionUsage:({total})=>total.inputTokens>12000 || total.outputTokens>2000},
});
