import { defineSchedule } from "eve/schedules";
import { catalog } from "../../lib/store";
export default defineSchedule({cron:"17 9 * * *",timezone:"UTC",async run(){await catalog({limit:1});}});
