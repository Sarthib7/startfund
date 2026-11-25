import { defineSchedule } from "eve/schedules";
import { weekly } from "../../lib/weekly";

export default defineSchedule({ cron:"0 13 * * 1",timezone:"UTC",async run(){await weekly();} });
