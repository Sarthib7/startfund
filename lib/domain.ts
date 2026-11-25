import { z } from "zod";
import type { Fact } from "./facts";

export const kinds = ["Grant", "Accelerator", "VC", "Perks", "Growth"] as const;
export const regions = {US:"United States", DE:"Germany", UK:"United Kingdom", EU:"European Union", Other:"Other / Global"} as const;
export const profileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(400),
  stage: z.enum(["Idea", "Pre-seed", "Seed", "Growth", "Not sure"]),
  region: z.enum(regionsKeys()),
  sector: z.string().trim().min(1).max(80),
  needs: z.array(z.enum(kinds)).min(1).max(kinds.length),
  email: z.union([z.email().max(254), z.literal("")]).optional(),
  priorNihAward:z.boolean().optional(),
  plansClinicalTrial:z.boolean().optional(),
});
export type Profile = z.infer<typeof profileSchema>;
function regionsKeys(){ return Object.keys(regions) as (keyof typeof regions)[]; }
export const demo: Profile = { name: "Canopy Labs", description: "AI software to help small manufacturers reduce energy use and waste.", stage: "Pre-seed", region: "US", sector: "Climate tech", needs: [...kinds] };
export type ListingStatus = "Open"|"Forthcoming"|"Closed"|"Program link"|"Late applications";
export type Opportunity = {
  id: string; title: string; kind: (typeof kinds)[number] | "Market signal"; region: "US" | "EU" | "DE" | "UK" | "Global";
  source: string; url: string; deadline: string | null; amount: number | null; currency: "USD" | "EUR" | "GBP";
  eligibility: string | null; fetchedAt: string; signal?: boolean; programId?: string; description?: string;
  status?: ListingStatus; opensAt?: string|null; programme?: string; postedAt?:string; generic?:boolean; contact?:string;
  verifiedAt?:string; noticeExpires?:string; deadlineNote?:string; applicationGuide?:string;
  awardFloor?:number|null; programFunding?:number|null; prerequisites?:string[];
};
export type Match = Opportunity & { score: number; reason: string; regionNote?: string; matchedTerms?:string[] };
export type Radar = { matches: Match[]; warnings: string[]; scannedAt: string; evidence?: Fact[] };
const minimumRadarScore = 30;
const nonTopicalWords = new Set([
  "with","that","their","from","help","this","and","for","the","use",
  "small","business","businesses","startup","startups","company","companies",
  "tech","technology","technologies","program","funding","solution","solutions","reduce","reducing",
  "build","building","make","making","platform","using","people","teams","users","into",
]);
const topicWords = (text: string) => (text.toLowerCase().match(/\b(?:ai|[a-z][a-z0-9]{2,})\b/g) ?? [])
  .filter(word => !nonTopicalWords.has(word));
const stem=(word:string)=>word === "existing" ? word : word.replace(/^([a-z]{5,}?)(?:ers?|ing|s)$/, "$1");
const keywords = (text: string) => new Set(topicWords(text).map(stem));
const topicGroups = [
  [/\b(?:energy|electricity|decarboni[sz]\w*)\b/i, ["energy efficiency", "clean energy"]],
  [/\bmanufactur\w*\b/i, ["advanced manufacturing", "industrial efficiency"]],
  [/\b(?:climate|decarboni[sz]\w*)\b/i, ["decarbonization", "decarbonisation"]],
  [/\bwaste\b/i, ["waste reduction", "resource efficiency"]],
] as const;
function relatedTopics(profileText: string) {
  return topicGroups.flatMap(([pattern, terms]) => pattern.test(profileText) ? [...terms] : []);
}
export function profileQueries(p: Profile): string[] {
  const sector = p.sector.toLowerCase().match(/[a-z][a-z0-9-]{1,}/g)?.slice(0,4).join(" ") ?? "";
  const subject = p.sector + " " + p.description;
  const descriptionTerms = topicWords(p.description).filter(word => !genericGrantWords.has(stem(word))).slice(0,4);
  const primary = topicGroups.flatMap(([pattern, terms]) => pattern.test(subject) ? [terms[0]] : []);
  return [...new Set([...primary, sector, ...relatedTopics(subject), ...descriptionTerms].filter(Boolean))].slice(0,7);
}
function phraseMatcher(phrase: string) {
  return new RegExp("\\b" + phrase.replaceAll(" ", "[-\\s]+") + "\\b", "i");
}
function topicHits(text: string, tokens: Map<string,string>, phrases: string[]) {
  const words = keywords(text);
  return { overlap:[...tokens].filter(([key])=>words.has(key)).map(([,value])=>value),
    related:phrases.filter(phrase=>phraseMatcher(phrase).test(text)) };
}
function profileTopics(subject:string) {
  return {words:new Map(topicWords(subject).map(word=>[stem(word),word])),phrases:relatedTopics(subject)};
}
const genericGrantWords=keywords("AI artificial intelligence software SaaS digital innovation innovative automated automation agencies phase seeking university research");
const biomedical = /\b(?:health(?:care)?|medical|bio(?:tech\w*|medical)|clinical|therapeutic\w*|diagnostic\w*|pharma\w*|patient\w*)\b/i;
const biomedicalGrant = /\b(?:nih|nidcr|nichd|nhlbi|clinical trials?)\b/i;
const grantTopic = /^(?:climate|energy|electricity|manufactur\w*|decarboni[sz]\w*|waste)$/i;
const fintech = /\b(?:fintech|financial technolog\w*|bookkeeping|accounting (?:software|tools?|automation|platforms?)|cash[ -]?flow (?:forecast\w*|management|analysis)|open banking|(?:digital|electronic|mobile|instant|cross[- ]border) payments?|payment (?:systems?|platforms?|processing)|finance teams?|financial ERP)\b/i;
function grantTerms(o:Opportunity,p:Profile,profileText:string,words:Map<string,string>,phrases:string[]) {
  const scope=o.title+" "+(o.description??"");
  const sector=new Map([...keywords(p.sector)].filter(word=>!genericGrantWords.has(word)).map(word=>[word,words.get(word)??word]));
  const scopeHits=topicHits(scope,words,phrases);
  const fintechHit=fintech.test(profileText) ? scope.match(fintech)?.[0] : undefined;
  const sectorHits=topicHits(scope,sector,[]).overlap;
  const biomedicalHits=biomedical.test(profileText) ? [...(o.title.match(biomedicalGrant)??[]).slice(0,1),...(scope.match(biomedical)??[]).slice(0,1)] : [];
  const qualifying=[...sectorHits,...scopeHits.related,...scopeHits.overlap.filter(term=>grantTopic.test(term)),
    ...(fintechHit?[fintechHit]:[]),...biomedicalHits].map(term=>term.toLowerCase());
  if(!qualifying.length) return [];
  const terms=[...qualifying,...scopeHits.overlap.filter(term=>!genericGrantWords.has(stem(term)))];
  return [...new Map(terms.map(term=>[stem(term),term])).values()];
}
export function relevantEvidence(facts: Fact[], profile: Profile): Fact[] {
  const subject = profile.sector + " " + profile.description;
  const {words,phrases}=profileTopics(subject);
  return [...new Map(facts.map(fact => [fact.id,fact])).values()]
    .map(fact => ({fact, hits:topicHits(fact.title,words,phrases)}))
    .filter(({hits}) => hits.overlap.length || hits.related.length)
    .sort((a,b) => (b.hits.related.length-a.hits.related.length) || (b.hits.overlap.length-a.hits.overlap.length) ||
      (b.fact.observed??"").localeCompare(a.fact.observed??""))
    .map(({fact}) => fact);
}
function regionalNote(o: Opportunity, p: Profile) {
  const text = o.eligibility ?? "";
  const restriction = text.match(/\b(UK|United Kingdom|EU|European Union|US|U\.S\.|United States)[- ](?:based[- ]only|only)\b|\bonly\s+(UK|United Kingdom|EU|European Union|US|U\.S\.|United States)\b/i);
  const label = restriction?.[1] ?? restriction?.[2];
  const region = label ? /^(?:uk|united kingdom)$/i.test(label) ? "UK" : /^(?:eu|european union)$/i.test(label) ? "EU" : "US" : o.region;
  const local = region === p.region || (p.region==="DE" && region==="EU");
  return { local, note: !local && region !== "Global" ?
    label ? `${region}-only per source; outside your region` : `${region} call; check eligibility for your region` : undefined };
}
export function listingStatus(o:Opportunity,day=new Date().toISOString().slice(0,10)):ListingStatus {
  if (o.status==="Late applications") return o.deadline && o.deadline>=day ? "Open" : o.status;
  if (o.deadline && o.deadline<day) return "Closed";
  if (o.opensAt && o.opensAt>day) return "Forthcoming";
  return o.status ?? "Program link";
}
const statusOrder:Record<ListingStatus,number>={Open:0,"Late applications":0,Forthcoming:1,"Program link":2,Closed:3};
export const byListingStatus=(a:Opportunity,b:Opportunity)=>statusOrder[listingStatus(a)]-statusOrder[listingStatus(b)];
export const catalogWords=(text:string)=>(text.toLowerCase().match(/[\p{L}\p{N}]+/gu)??[]).map(stem);
export function catalogMatch(query:string,text:string) {
  const words=new Set(catalogWords(text));
  return catalogWords(query).every(word=>words.has(word));
}

export function rank(items: Opportunity[], p: Profile, now = Date.now()): Match[] {
  const day = new Date(now).toISOString().slice(0,10);
  const profileText = (p.sector + " " + p.description).toLowerCase();
  const {words,phrases}=profileTopics(profileText);
  return items.filter(o => o.kind!=="Market signal" && p.needs.includes(o.kind) && listingStatus(o,day)!=="Closed")
    .map(o => {
      const text = (o.title + " " + (o.eligibility ?? "")).toLowerCase();
      const {overlap,related} = topicHits(text,words,phrases);
      const synopsis = topicHits(o.description ?? "",words,phrases);
      const matchedTerms=o.kind==="Grant"?grantTerms(o,p,profileText,words,phrases):
        [...new Set([...overlap,...related,...synopsis.related,...(synopsis.overlap.length>=2 ? synopsis.overlap : [])])];
      const topicScore = Math.min(4,keywords(matchedTerms.join(" ")).size);
      const broadProgram = o.kind!=="Grant" && (o.generic ?? (o.source === "Accelerator directory" && Boolean(o.programId)));
      const early = p.stage === "Idea" || p.stage === "Pre-seed";
      const stageFit = p.stage!=="Not sure" && (early ? /pre-seed|early.stage|phase i\b|accelerat/.test(text) : /scale|growth|phase ii\b/.test(text));
      const domainMismatch = o.kind === "Grant" && biomedicalGrant.test(o.title) && !biomedical.test(profileText);
      const fit = domainMismatch ? 4 : broadProgram ? 40 : topicScore===1 ? 43 : topicScore>1 ? 53 + topicScore*6 : 8;
      const days = o.deadline ? Math.max(0,(Date.parse(o.deadline)-Date.parse(day))/86400000) : Infinity;
      const urgency = days <= 14 ? 5 : days <= 45 ? 2 : 0;
      const amount = o.amount ? Math.min(3, Math.log10(1 + o.amount)/2) : 0;
      const region = regionalNote(o,p);
      const score = fit + (region.local ? 6 : region.note ? -16 : 0) + (stageFit ? 3 : 0) + urgency + amount -
        (o.signal ? 4 : 0) - (listingStatus(o,day)==="Forthcoming" ? 10 : 0);
      const topic = domainMismatch ? "Biomedical grant outside your stated focus" : broadProgram ? "General startup program" :
        matchedTerms.length ? `Matched: ${matchedTerms.join(", ")}` : "No topical match";
      const needsPrior=o.prerequisites?.includes("Requires prior NIH SBIR/STTR award") && !p.priorNihAward;
      const needsTrial=o.prerequisites?.includes("Clinical trial required") && p.plansClinicalTrial!==true;
      const cap = domainMismatch ? 15 : !broadProgram && !topicScore ? 20 : needsPrior || needsTrial ? 36 : !broadProgram && topicScore===1 ? 57 : 99;
      return {...o, score: Math.max(0,Math.round(Math.min(cap,score))), regionNote:region.note,matchedTerms,
        reason: [topic, region.local ? "Matches your region" : region.note ?? "Global listing", ...(o.prerequisites??[]), stageFit ? "Stage signal" : "", days <= 14 ? "Closing soon" : "", o.signal ? "News signal, not an open application" : "Confirm eligibility at the source"].filter(Boolean).join(" · ")};
    }).sort((a,b) => b.score-a.score || (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999") || a.id.localeCompare(b.id));
}
export function template(p: Profile, m: Match) {
  const federal = m.source==="Grants.gov" || m.id==="nsf-seed";
  const purpose = federal ? "Could you clarify whether our project falls within the scope of the notice and whether any prerequisites apply before we prepare an application?" :
    m.signal ? "Could you point me to the right person to ask about relevant founder opportunities?" : "Could you confirm whether we may be a fit and share the best next step?";
  const amount=m.amount ? new Intl.NumberFormat("en",{style:"currency",currency:m.currency,maximumFractionDigits:0}).format(m.amount) : null;
  const terms=m.matchedTerms?.length ? `The listing’s focus on ${m.matchedTerms.join(", ")} stood out to us. ` : "";
  const details=[m.deadline ? `listed deadline: ${m.deadline}`:null,amount ? `listed award: ${amount}`:null].filter(Boolean).join("; ");
  return { why: m.reason, subject: `${p.name} — ${m.title}`,
    body: `Hello${federal?" Program Officer":""},\n\nI’m reaching out from ${p.name}, a ${p.stage==="Not sure"?"":p.stage.toLowerCase()+" "}startup working on ${p.sector}. ${p.description}\n\nI came across “${m.title}”${details ? ` (${details})` : ""}. ${terms}${purpose}${m.applicationGuide ? `\n\nApplication checklist: ${m.applicationGuide}` : ""}\n\nThank you,\nThe ${p.name} team`, mode: "Template" };
}

export function shortlist(matches: Match[], limit = 14): Match[] {
  matches = matches.filter(m => m.score >= minimumRadarScore);
  const priority = new Set(kinds.flatMap(kind => matches.filter(m => m.kind === kind).slice(0, 2).map(m => m.id)));
  const selected = new Set([...new Set([...priority, ...matches.map(m => m.id)])].slice(0, limit));
  return matches.filter(m => selected.has(m.id));
}
