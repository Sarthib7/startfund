import { z } from "zod";

export const kinds = ["Grant", "Accelerator", "VC", "Growth"] as const;
export const profileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(400),
  stage: z.enum(["Idea", "Pre-seed", "Seed", "Growth"]),
  region: z.enum(["US", "EU", "Other"]),
  sector: z.string().trim().min(1).max(80),
  needs: z.array(z.enum(kinds)).min(1).max(4),
  email: z.union([z.email().max(254), z.literal("")]).optional(),
});
export type Profile = z.infer<typeof profileSchema>;
export const demo: Profile = { name: "Canopy Labs", description: "AI software to help small manufacturers reduce energy use and waste.", stage: "Pre-seed", region: "US", sector: "Climate tech", needs: ["Grant","Accelerator","VC","Growth"] };
export type Opportunity = {
  id: string; title: string; kind: (typeof kinds)[number]; region: "US" | "EU" | "Global";
  source: string; url: string; deadline: string | null; amount: number | null; currency: "USD" | "EUR";
  eligibility: string | null; fetchedAt: string; signal?: boolean; programId?: string;
};
export type Match = Opportunity & { score: number; reason: string };
export type Radar = { matches: Match[]; warnings: string[]; scannedAt: string };
const minimumRadarScore = 30;
const nonTopicalWords = new Set([
  "with","that","their","from","help","this","and","for","the","use",
  "small","business","businesses","startup","startups","company","companies",
  "tech","technology","technologies","program","funding","solution","solutions",
]);
const keywords = (text: string) => new Set((text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])
  .filter(word => !nonTopicalWords.has(word))
  .map(word => word.replace(/^([a-z]{5,}?)(?:ers?|ing|s)$/, "$1")));

export function rank(items: Opportunity[], p: Profile, now = Date.now()): Match[] {
  const day = new Date(now).toISOString().slice(0,10);
  const profileText = (p.sector + " " + p.description).toLowerCase();
  const biomedical = /\b(?:health(?:care)?|medical|bio(?:tech|medical)|clinical|therapeutic|diagnostic|pharma\w*|patient\w*)\b/;
  const tokens = [...keywords(profileText)];
  return items.filter(o => p.needs.includes(o.kind) && (o.region === "Global" || o.region === p.region) && (!o.deadline || o.deadline >= day))
    .map(o => {
      const text = (o.title + " " + (o.eligibility ?? "")).toLowerCase();
      const listingTokens = keywords(text);
      const overlap = tokens.filter(t => listingTokens.has(t)).length;
      const broadProgram = o.source === "Accelerator directory" && Boolean(o.programId);
      const early = p.stage === "Idea" || p.stage === "Pre-seed";
      const stageFit = early ? /pre-seed|early.stage|phase i\b|accelerat/.test(text) : /scale|growth|phase ii\b/.test(text);
      const domainMismatch = o.kind === "Grant" && /\b(?:nih|nidcr|clinical trials?)\b/i.test(o.title) && !biomedical.test(profileText);
      const fit = domainMismatch ? 4 : broadProgram ? 42 : overlap ? 64 + Math.min(overlap,4)*6 : 8;
      const days = o.deadline ? Math.max(0,(Date.parse(o.deadline)-Date.parse(day))/86400000) : Infinity;
      const urgency = days <= 14 ? 5 : days <= 45 ? 2 : 0;
      const amount = o.amount ? Math.min(3, Math.log10(1 + o.amount)/2) : 0;
      const score = fit + (o.region === p.region ? 3 : 0) + (stageFit ? 3 : 0) + urgency + amount - (o.signal ? 4 : 0);
      const topic = domainMismatch ? "Biomedical grant outside your stated focus" : broadProgram ? "General startup program" :
        overlap ? `${overlap} profile keyword${overlap === 1 ? "" : "s"} matched` : "No topical match";
      return {...o, score: Math.round(Math.min(99,score)),
        reason: [topic, o.region === p.region ? "Matches your region" : "Global listing", stageFit ? "Stage signal" : "", days <= 14 ? "Closing soon" : "", o.signal ? "News signal, not an open application" : "Confirm eligibility at the source"].filter(Boolean).join(" · ")};
    }).sort((a,b) => b.score-a.score || (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999") || a.id.localeCompare(b.id));
}
export function template(p: Profile, m: Match) {
  const purpose = m.signal ? "Could you point me to the right person to ask about relevant founder opportunities?" : "Could you confirm whether we may be a fit and share the best next step?";
  return { why: m.reason, subject: `${p.name} — ${m.signal ? "Introduction" : "Opportunity inquiry"}`,
    body: `Hello,\n\nI’m reaching out from ${p.name}, a ${p.stage.toLowerCase()} startup working on ${p.sector}. ${p.description}\n\nI came across “${m.title}” and wanted to learn whether there’s a relevant path for us. ${purpose}\n\nThank you,\nThe ${p.name} team`, mode: "Template" };
}

export function shortlist(matches: Match[], limit = 14): Match[] {
  matches = matches.filter(m => m.score >= minimumRadarScore);
  const priority = new Set(kinds.flatMap(kind => matches.filter(m => m.kind === kind).slice(0, 2).map(m => m.id)));
  const selected = new Set([...new Set([...priority, ...matches.map(m => m.id)])].slice(0, limit));
  return matches.filter(m => selected.has(m.id));
}
