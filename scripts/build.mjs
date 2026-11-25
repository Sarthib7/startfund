import { execSync } from "node:child_process";

if (!process.env.VERCEL) execSync("eve build", { stdio: "inherit" });
execSync("next build", { stdio: "inherit" });
