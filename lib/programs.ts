import type { Opportunity, Profile } from "./domain";

type Program = Pick<Opportunity,"id"|"title"|"kind"|"region"|"url"|"eligibility"> &
  Partial<Pick<Opportunity,"description"|"status"|"deadline"|"amount"|"contact"|"verifiedAt"|"deadlineNote">>;

const seeded:Program[]=[
 {id:"exist",title:"EXIST Business Startup Grant",kind:"Grant",region:"DE",url:"https://exist.de/",eligibility:"Germany-only: university or research institution affiliation is generally required. Apply through the host institution.",description:"Pre-seed research spinouts and technology startups."},
 {id:"kfw",title:"KfW startup financing",kind:"Growth",region:"DE",url:"https://www.kfw.de/inlandsfoerderung/Unternehmen/Gr%C3%BCndung-und-Nachfolge/",eligibility:"Germany-only: check location, loan terms and application via a financing partner. Not a cash grant."},
 {id:"bmwk",title:"BMWK / Federal Ministry Funding Database (Förderdatenbank)",kind:"Growth",region:"DE",url:"https://www.foerderdatenbank.de/FDB/DE/Home/home.html",eligibility:"Official federal and regional funding directory; individual program eligibility varies.",description:"German SME startup research innovation energy efficiency funding directory."},
 {id:"htgf",title:"High-Tech Gründerfonds (HTGF)",kind:"VC",region:"DE",url:"https://www.htgf.de/en/about-us/",eligibility:"Pre-seed and seed deep-tech companies; check German presence requirements. Equity investment, not a grant.",description:"Industrial manufacturing, robotics, climate tech, energy efficiency, life sciences, software and digital tech."},
 {id:"climate-kic",title:"Climate KIC ClimAccelerator",kind:"Accelerator",region:"Global",url:"https://www.climate-kic.org/programmes/climate-entrepreneurship/climaccelerator/",eligibility:"Climate innovation startups; application windows and countries vary by cohort.",description:"Climate hardware, decarbonisation, clean energy, resource efficiency and industrial manufacturing."},
 {id:"innoenergy",title:"EIT InnoEnergy for Startups",kind:"Accelerator",region:"EU",url:"https://innoenergy.com/startups/",eligibility:"Energy innovators; check technology maturity, location and current investment terms.",description:"Clean energy, energy efficiency, industrial decarbonisation and sustainable manufacturing."},
 {id:"elemental",title:"Elemental Impact",kind:"Accelerator",region:"US",url:"https://elementalimpact.com/",eligibility:"Climate companies; check the current application window and deployment requirements.",description:"Climate technology, energy efficiency, manufacturing and decarbonization project deployment."},
 {id:"a16z-speedrun",title:"a16z speedrun",kind:"Accelerator",region:"US",url:"https://speedrun.a16z.com/",eligibility:"Early-stage teams; check the current cohort and investment terms.",description:"Seed AI software, infrastructure, consumer technology and developer tools."},
 {id:"pre-seed-bolt",title:"Bolt",kind:"VC",region:"US",url:"https://bolt.io/",eligibility:"Early-stage investing; individual investment decisions and terms are not guaranteed.",description:"Pre-seed hardware, industrial manufacturing, software and physical products."},
 {id:"pear",title:"Pear VC",kind:"VC",region:"US",url:"https://pear.vc/",eligibility:"Pre-seed and seed investing; see the firm's official site for contact and current programs.",description:"AI software, enterprise SaaS, fintech, health and deep tech."},
 {id:"hcvc",title:"HCVC",kind:"VC",region:"Global",url:"https://www.hcvc.co/",eligibility:"Check the fund’s geographic scope and investment process.",description:"Pre-seed and seed industrial technology, hardware, manufacturing and decarbonization."},
 {id:"lowercarbon",title:"Lowercarbon Capital",kind:"VC",region:"Global",url:"https://lowercarboncapital.com/",eligibility:"Climate-focused investment, not a grant or guaranteed check.",description:"Climate hardware, decarbonization, energy efficiency and industrial manufacturing."},
 {id:"nsf-seed",title:"America’s Seed Fund — NSF SBIR/STTR",kind:"Grant",region:"US",url:"https://seedfund.nsf.gov/solicitations/",eligibility:"US small businesses; start with a Project Pitch. Full proposals require an invitation. Up to $2M across phases, zero equity.",description:"Biotechnology, medical devices, advanced manufacturing, clean energy, AI software and deep-tech R&D.",status:"Open",deadline:"2027-03-04",contact:"sbir@nsf.gov",verifiedAt:"2026-11-25",deadlineNote:"Invited full proposal; start with a Project Pitch."},
 {id:"github-startups",title:"GitHub for Startups",kind:"Perks",region:"Global",url:"https://github.com/enterprise/startups",eligibility:"Check funding, company age and GitHub Enterprise account requirements.",description:"Developer tools and source control for software teams."},
 {id:"cloudflare-startups",title:"Cloudflare for Startups",kind:"Perks",region:"Global",url:"https://www.cloudflare.com/forstartups/",eligibility:"Subject to startup eligibility and the current program terms.",description:"Cloud and developer infrastructure credits for SaaS and AI software."},
 {id:"gemini-api",title:"Google Gemini API free tier",kind:"Perks",region:"Global",url:"https://ai.google.dev/gemini-api/docs/pricing",eligibility:"Free-tier availability, quotas and applicable data-use terms depend on model and region.",description:"AI API for software prototypes and machine learning."},
 {id:"supabase-free",title:"Supabase Free plan",kind:"Perks",region:"Global",url:"https://supabase.com/pricing",eligibility:"Free-plan usage and project caps apply. Review official pricing before scaling.",description:"Database, storage and authentication for web software and SaaS."},
];
export const curatedProgramRows=(fetchedAt:string):Opportunity[]=>seeded.map(p=>({
 deadline:null,amount:null,status:"Program link",...p,source:"Official program links",fetchedAt,programId:p.id,
 currency:p.region==="EU"||p.region==="DE"?"EUR":"USD",
}));
export function perkScore(item:Opportunity,profile?:Profile) {
 if(!profile) return 0;
 const terms=new Set((profile.sector+" "+profile.description).toLowerCase().match(/[a-z]{3,}/g));
 const words=new Set((item.title+" "+(item.description??"")).toLowerCase().match(/[a-z]{3,}/g));
 return [...terms].filter(term=>words.has(term)).length;
}
