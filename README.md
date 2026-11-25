# Startfund

Startup funding catalog and radar built on Vercel eve and Next.js. Browse source-backed funding records, then enter a profile and open a ranked match for an outreach draft. The core demo works without credentials.

```sh
npm ci
npm test
npm run build
npm start
```

Open http://localhost:3100. Requires Node.js 24+. Use `npm run dev` for development. Data is stored in SQLite under `.radar/`; set `RADAR_DB_PATH` to a persistent volume for a single-instance deployment.

### Public deployment on Vercel

1. Create a [Turso](https://turso.tech/) database on the free plan and a database auth token. Use a primary location near your Vercel functions.
2. [Import the repository](https://vercel.com/new) as a Next.js project with Node.js 24 and `main` as the production branch. Keep the default repository root and use `npm run build`. On Vercel, Next.js registers eve as a separate service through `withEve`; do not run `eve build` in the root build command. Local builds still build both.
3. Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` for Production, and for Preview if you also want branch deployments (prefer a separate database for previews). Startfund creates its tables on first use. It does not fall back to ephemeral SQLite on Vercel; existing local data is not migrated.
4. Deploy production and verify the production URL is accessible in a private browser without Vercel login; configure [Deployment Protection](https://vercel.com/docs/deployment-protection) as needed. `RADAR_SOURCE_CONTACT` enables SEC evidence. Model and Resend credentials are optional; the default public deployment uses template drafts and has no email delivery. Set `RADAR_EVE_URL` to the production origin if enabling model drafts, and use that origin for `RADAR_PUBLIC_ORIGIN` if enabling digest subscriptions.

- **Sources:** Grants.gov and EU Funding & Tenders provide open calls. NSF Awards, CORDIS and UKRI GtR provide sampled historical award records; they do not describe open applications or aggregate disbursements. The public YC OSS directory provides derived batch history, not published application deadlines. Hacker News supplies funding and growth signals, not applications. The curated accelerator/corporate program directory links to official pages without scraping them. Each source has a provenance/reuse note; no Outreachr seed data was imported.
- **Form D:** Set `RADAR_SOURCE_CONTACT` to a real monitored email address before enabling SEC EDGAR. Only public filing metadata is ingested. Filers are not independently vetted investors, and filings do not show portfolio checks or investor reputation.
- **Government opportunities:** TED samples recent EU contract notices with active tender deadlines in IT, software, R&D, computer equipment, consultancy, and telecom. It excludes construction works. Tenders are procurement, not grants; place of performance helps match listings but does not establish bidder eligibility. Germany’s Förderdatenbank lists recent federal and state programs verified as including a grant; these are program links, not confirmed open calls. Both sources run without API keys. Enter your company’s country and, optionally, your developers’ countries as two-letter codes to match government opportunities. Existing saved regions still work.
- **Regional grants:** UK Find a Grant samples key-free public innovation listings for private-sector applicants. Curated official program links cover the four UK nations, France (including Île-de-France), India (including Karnataka, Kerala and Tamil Nadu), California, Massachusetts, New York, Texas and Washington, plus selected programs in Ireland, Spain, Australia and Singapore. These links have no implied intake or deadline. Enter optional company or developer subdivision codes such as `US-CA`, `GB-SCT`, `FR-IDF`, or `IN-KA`; these also count toward country matches. This is sampled coverage, not an eligibility determination or a complete directory.
- **Storage:** The public `/api/catalog` and eve tools use the same catalog service. SQLite retains normalized investors, programs, opportunities, evidence, and changes. API inputs are fixed to the listed sources; raw snapshots are private, include source URL, fetch time and rights, and are retained for 14 days per active source (Grants.gov's transient token is omitted). Conditional GETs use upstream validators. Live listings cache for 20 minutes and the daily eve schedule refreshes historical evidence. Unknown values are never inferred from filings or cloud credits.
- **Matching:** confirm a profile inferred from the company’s public HTTPS homepage or enter your own details. The website reader checks robots.txt and reads only the homepage and a linked about page; it does not reuse site prose as a funding source. Topical terms query Grants.gov and EU Funding & Tenders; NSF Awards, CORDIS and UKRI add related historical evidence, not open calls. Region and prerequisites affect ranking but are not eligibility decisions. Innovate UK competitions use public, attributed metadata. The German directory and startup perks are official links, not complete coverage or guaranteed credits.
- **Agent drafts:** by default drafts are deterministic templates. Set `RADAR_MODEL_PROVIDER` to `gemini`, `groq`, or `gateway` and configure its free-tier credentials (`GOOGLE_GENERATIVE_AI_API_KEY`, `GROQ_API_KEY`, or `AI_GATEWAY_API_KEY` respectively; Vercel OIDC also supported if available). Set a strong `RADAR_AGENT_SECRET` and, when the agent is not reachable at the same process's port 3100, `RADAR_EVE_URL`. Gateway defaults to `reflection/beam-free`; verify quota and terms before changing the model with `RADAR_GATEWAY_MODEL`. Draft requests send profile/listing text but not the email address to your configured provider. Provider outages or quota limits fall back to a labelled template.
- **Weekly digest:** eve schedule runs Mondays at 13:00 UTC. Scanning never subscribes the founder. Delivery requires an explicit subscription request, a time-limited inbox confirmation and configured `RESEND_API_KEY`, verified `RADAR_EMAIL_FROM`, `RADAR_ALLOWED_RECIPIENT`, and an HTTPS `RADAR_PUBLIC_ORIGIN`. Each digest includes an unsubscribe link; outreach stays draft-only.

### MCP

With the server running, add this stdio bridge to a compatible MCP host (use the absolute path to your checkout). Tools: `search_funding`, `analyze_company`, `recommend`, and `builder_bundle`. The bridge cannot read saved startup profiles or send messages; only the parameters you supply are processed. Set `STARTFUND_URL` in the MCP host’s environment to point at another installation.

```json
{
  "mcpServers": {
    "startfund": { "command": "node", "args": ["/path/to/startfund/scripts/mcp.mjs"] }
  }
}
```
