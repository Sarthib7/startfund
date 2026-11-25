import { z } from "zod";
import type { Fact } from "./facts";

export const kinds = ["Grant", "Tender", "Accelerator", "VC", "Perks", "Growth"] as const;
export const regions = {US:"United States", DE:"Germany", UK:"United Kingdom", EU:"European Union", Other:"Other / Global"} as const;
export const euCountryCodes={AT:"AUT",BE:"BEL",BG:"BGR",HR:"HRV",CY:"CYP",CZ:"CZE",DK:"DNK",EE:"EST",FI:"FIN",FR:"FRA",DE:"DEU",
  GR:"GRC",HU:"HUN",IE:"IRL",IT:"ITA",LV:"LVA",LT:"LTU",LU:"LUX",MT:"MLT",NL:"NLD",PL:"POL",PT:"PRT",RO:"ROU",SK:"SVK",SI:"SVN",ES:"ESP",SE:"SWE"};
const countryNames=new Intl.DisplayNames(["en"],{type:"region",fallback:"none"});
const country=z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).transform(code=>code==="UK"?"GB":code)
  .refine(code=>/^[A-Z]{2}$/.test(code) && !["EU","UN","ZZ"].includes(code) && countryNames.of(code)!==undefined,"Enter a valid country code");
const subdivision=z.string().trim().toUpperCase().regex(/^[A-Z]{2}-[A-Z0-9]{1,3}$/)
  .refine(code=>code.slice(0,2)!=="UK" && country.safeParse(code.slice(0,2)).success,"Use a country-region code such as US-CA or GB-SCT");
export const profileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(400),
  stage: z.enum(["Idea", "Pre-seed", "Seed", "Growth", "Not sure"]),
  region: z.enum(regionsKeys()),
  companyCountry: country.optional(),
  developerCountries: z.array(country).max(8).optional(),
  companySubdivision: subdivision.optional(),
  developerSubdivisions: z.array(subdivision).max(8).optional(),
  sector: z.string().trim().min(1).max(80),
  needs: z.array(z.enum(kinds)).min(1).max(kinds.length),
  email: z.union([z.email().max(254), z.literal("")]).optional(),
  priorNihAward:z.boolean().optional(),
  plansClinicalTrial:z.boolean().optional(),
}).refine(p=>!p.companyCountry || !p.companySubdivision || p.companySubdivision.startsWith(p.companyCountry+"-"),{
 message:"Company region must belong to its country",path:["companySubdivision"],
});
export type Profile = z.infer<typeof profileSchema>;
function regionsKeys(){ return Object.keys(regions) as (keyof typeof regions)[]; }
export const demo: Profile = { name: "Canopy Labs", description: "AI software to help small manufacturers reduce energy use and waste.", stage: "Pre-seed", region: "US", sector: "Climate tech", needs: [...kinds] };
export type ListingStatus = "Open"|"Rolling"|"Forthcoming"|"Closed"|"Program link"|"Late applications";
export type Opportunity = {
  id: string; title: string; kind: (typeof kinds)[number] | "Market signal"; region: "US" | "EU" | "DE" | "UK" | "Global";
  source: string; url: string; deadline: string | null; amount: number | null; currency: "USD" | "EUR" | "GBP" | "INR" | "AUD" | "SGD";
  eligibility: string | null; fetchedAt: string; signal?: boolean; programId?: string; description?: string;
  status?: ListingStatus; opensAt?: string|null; programme?: string; postedAt?:string; generic?:boolean; contact?:string;
  verifiedAt?:string; noticeExpires?:string; deadlineNote?:string; applicationGuide?:string;
  awardFloor?:number|null; programFunding?:number|null; prerequisites?:string[]; countries?:string[]; subdivisions?:string[];
  cpvCodes?:string[]; cpvScope?:"procedure-and-lots";
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
const genericGrantWords=keywords("AI artificial intelligence software SaaS digital innovation innovative automated automation agencies phase seeking university research developing development high temperature data science technology hardware system systems design designer program federal university academic general project applied engineering implementation pilot tool testing test solutions advanced startup competitive standard technologies industrial applications device equipment process deep infrastructure SBIR STTR");
const biomedical = /\b(?:health(?:care)?|medical|med[- ]?tech\w*|bio(?:tech\w*|medical)|clinical|therapeutic\w*|diagnostic\w*|pharma\w*|patient\w*)\b/i;
const biomedicalGrant = /\b(?:nih|nidcr|nichd|nhlbi)\b/i;
const grantTopic = /^(?:climate|energy|electricity|manufactur\w*|decarboni[sz]\w*|waste)$/i;
const fintech = /\b(?:fintech|financial technolog\w*|bookkeeping|accounting (?:software|tools?|automation|platforms?)|cash[ -]?flow (?:forecast\w*|management|analysis)|open banking|(?:digital|electronic|mobile|instant|cross[- ]border) payments?|payment (?:systems?|platforms?|processing)|finance teams?|financial ERP)\b/i;
const trialLabel = /\b(?:clinical trials?|CT)\s*(?:[-:–]\s*)?(?:optional|required|not allowed|not permitted)\b/gi;
const thermal = /\b(?:heat[- ]pumps?|(?:industrial )?process heat|industrial heating|thermal decarboni[sz]\w*|decarboni[sz]\w* (?:industrial )?(?:process )?heat)\b/i;
function grantTerms(o:Opportunity,p:Profile,profileText:string,words:Map<string,string>,phrases:string[]) {
  const scope=(o.title+" "+(o.description??"")).replace(trialLabel," ");
  const thematic=new Map([...words].filter(([word])=>!genericGrantWords.has(word)));
  if(fintech.test(profileText))return [...new Set((scope.match(new RegExp(fintech.source,"gi"))??[]).map(term=>term.toLowerCase()))];
  if(thermal.test(profileText)){
    const match=scope.match(thermal)?.[0]??scope.match(/\bindustrial decarboni[sz]\w*\b/i)?.[0];
    return match?[match.toLowerCase()]:[];
  }
  const sector=new Map([...keywords(p.sector)].filter(word=>thematic.has(word)).map(word=>[word,thematic.get(word)!]));
  const scopeHits=topicHits(scope,thematic,phrases);
  const sectorHits=topicHits(scope,sector,[]).overlap;
  const isParentNih=/\bNIH\b.*\b(?:parent|SBIR|STTR)\b/i.test(o.title);
  const biomedicalHits=biomedical.test(profileText) ? [...(isParentNih?["NIH"]:[]),...(scope.match(biomedical)??[]).slice(0,1)] : [];
  const qualifying=[...sectorHits,...scopeHits.related,...scopeHits.overlap.filter(term=>grantTopic.test(term)),
    ...(scopeHits.overlap.length>=2?scopeHits.overlap:[]),...biomedicalHits].map(term=>term.toLowerCase());
  if(!qualifying.length) return [];
  const terms=[...qualifying,...scopeHits.overlap.filter(term=>!genericGrantWords.has(stem(term)))];
  return [...new Map(terms.map(term=>[stem(term),term])).values()];
}
function exclusiveApplicant(eligibility:string){
  return /\b(?:only|limited to|restricted to|must be)\s+(?:(?:accredited|eligible|public|private|designated|a|an|the)\s+)*(?:minority[- ]serving institutions?|MSIs?|non[- ]?profits?|universit(?:y|ies)|state governments?)\b|\b(?:minority[- ]serving institutions?|MSIs?|non[- ]?profits?|universit(?:y|ies)|state governments?)\s+(?:only|are the only eligible applicants)\b/i.test(eligibility);
}
function biomedicalStartupFit(o:Opportunity,restricted:boolean) {
  const eligibility=o.eligibility??"";
  const federal=o.source==="Grants.gov";
  if(restricted || /\b(?:only|limited to|restricted to|must be)\s+(?:(?:an?|the|eligible|qualified)\s+)*(?:research|academic|educational|degree[- ]granting) institutions?\b|\b(?:research|academic|educational|degree[- ]granting) institutions?\s+(?:only|are the only eligible applicants)\b/i.test(eligibility))return "institution";
  if(federal && /\b(?:[TK]\d{2}|F\d{2}|R25|research training|training grants?|career development award|fellowships?)\b/i.test(o.title))return "training";
  if(/\b(?:small business(?:es| concerns?)?|startups?)\s+(?:(?:are|is)\s+)?(?:not eligible|ineligible|may not apply|cannot apply)\b|\b(?:excluding|except|other than)\s+(?:for\s+)?(?:small business(?:es| concerns?)?|startups?)\b/i.test(eligibility))return "ineligible";
  const explicitlyEligible=/^\s*(?:U\.?S\.?\s+)?(?:small businesses|small business concerns|startups)\s*[.]?\s*$|\b(?:small businesses|small business concerns|startups)\s+(?:only|are eligible|may apply|can apply)\b|\b(?:only|open to|eligible applicants include)\s+(?:U\.?S\.?\s+)?(?:small businesses|small business concerns|startups)\b/i.test(eligibility);
  if(o.id==="nsf-seed" || (federal && /\b(?:SBIR|STTR|Small Business Innovation Research|Small Business Technology Transfer)\b/i.test(o.title)) || explicitlyEligible)return "startup";
  if(federal && /\b(?:R(?:01|03|21)|U01)\b/i.test(o.title))return "research";
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
export function profileLocations(p:Profile) {
  const base=p.companyCountry ?? p.companySubdivision?.slice(0,2) ?? (p.region==="US" || p.region==="DE" ? p.region : p.region==="UK" ? "GB" : undefined);
  const subdivisions=[...(p.companySubdivision?[p.companySubdivision]:[]),...(p.developerSubdivisions??[])];
  const countries=[...new Set([...(base?[base]:[]),...(p.developerCountries??[]),...subdivisions.map(code=>code.slice(0,2))])];
  return {countries,subdivisions,eu:(!p.companyCountry && !p.companySubdivision && p.region==="EU") || countries.some(c=>Object.hasOwn(euCountryCodes,c))};
}
const horizonAssociated=new Set(["AL","AM","BA","CH","EG","FO","GB","GE","IL","IS","MD","ME","MK","NO","RS","TN","TR","UA","XK"]);
const horizonPillarTwoAssociated=new Set(["CA","JP","KR","NZ"]);
function horizonLocation(o:Opportunity,countries:string[]) {
  if(o.source!=="EU Funding & Tenders" || o.programme!=="Horizon Europe") return false;
  const cluster=/\bHORIZON-CL[1-6]-/.test(o.id);
  const equityOnly=/\b(?:equity|investment)[ -]only\b/i.test(o.title);
  return countries.some(code=>horizonAssociated.has(code) && !(code==="GB" && equityOnly) ||
    cluster && horizonPillarTwoAssociated.has(code));
}
function regionalNote(o: Opportunity, locations:ReturnType<typeof profileLocations>) {
  const text = o.eligibility ?? "";
  const restriction = text.match(/\b(UK|United Kingdom|EU|European Union|US|U\.S\.|United States)[- ](?:based[- ]only|only)\b|\bonly\s+(UK|United Kingdom|EU|European Union|US|U\.S\.|United States)\b/i);
  const label = restriction?.[1] ?? restriction?.[2];
  const region = label ? /^(?:uk|united kingdom)$/i.test(label) ? "UK" : /^(?:eu|european union)$/i.test(label) ? "EU" : "US" : o.region;
  const local=o.subdivisions?.length ? o.subdivisions.some(code=>locations.subdivisions.includes(code)) :
    o.countries?.length ? o.countries.some(c=>locations.countries.includes(c)) :
    region==="EU" ? locations.eu || (!label && horizonLocation(o,locations.countries)) : locations.countries.includes(region==="UK"?"GB":region);
  return { local, restricted:region!=="Global" || Boolean(o.countries?.length), note: !local && region !== "Global" ?
    o.countries?.length ? `Place of performance: ${o.countries.join(", ")}` :
    label ? `${region}-only per source; outside your region` : `${region} call; check eligibility for your region` : undefined };
}
export function listingStatus(o:Opportunity,asOf=new Date().toISOString()):ListingStatus {
  const day=asOf.slice(0,10);
  if (o.status==="Late applications") return o.deadline && o.deadline>=day ? "Open" : o.status;
  if (o.deadline && (o.deadline.includes("T") ? Date.parse(o.deadline)<=Date.parse(asOf) : o.deadline<day)) return "Closed";
  if (o.opensAt && o.opensAt>day) return "Forthcoming";
  return o.status ?? "Program link";
}
const statusOrder:Record<ListingStatus,number>={Open:0,Rolling:0,"Late applications":0,Forthcoming:1,"Program link":2,Closed:3};
export const byListingStatus=(a:Opportunity,b:Opportunity)=>statusOrder[listingStatus(a)]-statusOrder[listingStatus(b)];
export const catalogWords=(text:string)=>(text.toLowerCase().match(/[\p{L}\p{N}]+/gu)??[]).map(stem);
export function catalogMatch(query:string,text:string) {
  const words=new Set(catalogWords(text));
  return catalogWords(query).every(word=>words.has(word));
}

export function rank(items: Opportunity[], p: Profile, now = Date.now()): Match[] {
  const asOf = new Date(now).toISOString();
  const day = asOf.slice(0,10);
  const profileText = (p.sector + " " + p.description).toLowerCase();
  const {words,phrases}=profileTopics(profileText);
  const locations=profileLocations(p);
  const explicitLocation=Boolean(p.companyCountry || p.companySubdivision || p.developerCountries?.length || p.developerSubdivisions?.length);
  const biomedicalPreSeed=p.stage==="Pre-seed"&&biomedical.test(profileText);
  return items.filter(o => o.kind!=="Market signal" && p.needs.includes(o.kind) && listingStatus(o,asOf)!=="Closed")
    .flatMap(o => {
      const region = regionalNote(o,locations);
      if(!region.local && (o.kind==="Tender" || (o.kind==="Grant" && (o.countries?.length || o.subdivisions?.length || (explicitLocation && region.restricted))))) return [];
      const text = (o.title + " " + (o.eligibility ?? "")).toLowerCase();
      const {overlap,related} = topicHits(text,words,phrases);
      const synopsis = topicHits(o.description ?? "",words,phrases);
      const matchedTerms=o.kind==="Grant"?grantTerms(o,p,profileText,words,phrases):
        [...new Set([...overlap,...related,...synopsis.related,...(synopsis.overlap.length>=2 ? synopsis.overlap : [])])];
      const topicScore = Math.min(4,keywords(matchedTerms.join(" ")).size);
      const broadProgram = o.kind==="Grant" ? region.local && o.status==="Program link" && o.generic===true :
        (o.generic ?? (o.source === "Accelerator directory" && Boolean(o.programId)));
      const early = p.stage === "Idea" || p.stage === "Pre-seed";
      const stageFit = p.stage!=="Not sure" && (early ? /pre-seed|early.stage|phase i\b|accelerat/.test(text) : /scale|growth|phase ii\b/.test(text));
      const domainMismatch = o.kind === "Grant" && (biomedicalGrant.test(o.title)||/\bclinical trials?\b/i.test(o.title)) && !biomedical.test(profileText);
      const fit = domainMismatch ? 4 : broadProgram ? 40 : topicScore===1 ? 43 : topicScore>1 ? 53 + topicScore*6 : 8;
      const days = o.deadline ? Math.max(0,(Date.parse(o.deadline)-Date.parse(day))/86400000) : Infinity;
      const urgency = days <= 14 ? 5 : days <= 45 ? 2 : 0;
      const amount = o.amount ? Math.min(3, Math.log10(1 + o.amount)/2) : 0;
      const restricted=o.kind==="Grant" && exclusiveApplicant(o.eligibility??"");
      const startupFit=biomedicalPreSeed && o.kind==="Grant" ? biomedicalStartupFit(o,restricted) : undefined;
      const startupBoost=startupFit==="startup" && !region.note;
      const startupAdjustment=startupBoost?22:startupFit==="research"?-18:startupFit==="training"?-25:0;
      const score = fit + (region.local ? 6 : region.note ? -16 : 0) + (stageFit ? 3 : 0) + urgency + amount -
        (o.signal ? 4 : 0) - (listingStatus(o,asOf)==="Forthcoming" ? 10 : 0) + startupAdjustment;
      const topic = domainMismatch ? "Biomedical grant outside your stated focus" : broadProgram ? "General startup program" :
        matchedTerms.length ? `Matched: ${matchedTerms.join(", ")}` : "No topical match";
      const needsPrior=o.prerequisites?.includes("Requires prior NIH SBIR/STTR award") && !p.priorNihAward;
      const needsTrial=o.prerequisites?.includes("Clinical trial required") && p.plansClinicalTrial!==true;
      const cap = domainMismatch ? 15 : !broadProgram && !topicScore ? 20 : restricted || startupFit==="institution" || startupFit==="ineligible" ? 27 :
        needsPrior || needsTrial ? 36 : startupFit==="training" ? 44 : startupFit==="research" ? 55 : !broadProgram && !startupBoost && topicScore===1 ? 57 : 99;
      const startupNote=startupBoost?"Small-business funding mechanism":startupFit==="research"?"Research mechanism; lower priority for a pre-seed startup":
        startupFit==="training"?"Training or career-development mechanism":startupFit==="institution"&&!restricted?"Institution-only eligibility":
        startupFit==="ineligible"?"Small businesses are excluded by the listing":"";
      return {...o, score: Math.max(0,Math.round(Math.min(cap,score))), regionNote:region.note,matchedTerms,
        reason: [topic, region.local ? "Matches your region" : region.note ?? "Global listing", ...(o.prerequisites??[]), restricted?"Applicant type is restricted; startups may not qualify":"", startupNote, stageFit ? "Stage signal" : "", days <= 14 ? "Closing soon" : "", o.signal ? "News signal, not an open application" : "Confirm eligibility at the source"].filter(Boolean).join(" · ")};
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
