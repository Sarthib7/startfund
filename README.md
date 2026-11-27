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

### Invite beta access

The beta deployment requires a signed beta session for browser pages and most API routes. Operators generate one-time invite codes from `/admin/sign-in` with `RADAR_ADMIN_TOKEN`. Invite codes expire after 30 days. Beta sessions expire after 7 days.

Set `RADAR_AUTH_SECRET` before using the beta gate. `RADAR_USAGE_SECRET` is a supported fallback, but a dedicated secret is safer to rotate. Sessions are stateless. Rotation revokes all beta sessions; individual session revocation is not available in this version.

Shared report URLs under `/s/` remain public. They are read-only snapshots and do not include email addresses or profile notes. The Stripe webhook, login routes, static assets, and invite redemption route also remain reachable. API clients still authenticate at each endpoint. The beta proxy does not accept a bearer key by itself.

### Plans and usage

- Free visitors get 5 scans and 3 drafts per UTC day. Catalog browsing has no daily quota; the catalog API and MCP share a short per-network burst limit. Expensive requests also share a deployment-wide daily cap. Set `RADAR_GLOBAL_DAILY_LIMIT` to override the default cap of 1000. Usage is aggregated daily and retained for about 35 days.
- `RADAR_USAGE_SECRET` optionally sets the HMAC key for signing anonymous visitor cookies and hashing network and API-key identifiers. If unset, Startfund generates and stores one key in the database. Do not rotate it casually: rotation resets these identities. On Vercel the app uses the platform's forwarded IP; on standalone hosts without a trusted client IP, the network bucket is shared.
- For operator-provisioned API access, set `RADAR_API_KEYS` to comma-separated high-entropy keys of at least 24 characters. Send a key as `Authorization: Bearer <key>` or set `STARTFUND_API_KEY` for the stdio MCP adapter. Provisioned keys use the Pro limits of 50 scans and 30 drafts per UTC day. This does not create a paid subscription.
- `/admin/usage` requires `Authorization: Bearer <RADAR_ADMIN_TOKEN>` and returns 404 without valid authorization. It shows aggregate seven-day usage, not identifiers.
- After scanning, create a public read-only report from **Share report**. It includes the company name, sector, region, stage and source-linked top matches, but not email or profile notes. Anyone with the URL can view it.
- Visitors can suggest opportunities from the radar or catalog. Open `/admin/sign-in` to enter the operator token in a browser. `/admin` and the review API use the same bearer authorization as `/admin/usage`; reviewers verify the source and approve or reject each suggestion. Only approved records feed the catalog and ranking.
- Pro is $9/month. Checkout is disabled until `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PRICE_ID` are all configured. Active and trialing subscriptions get Pro limits after Stripe confirms them; renewals that put the subscription in a non-active state revert it to Free. Pro browser and API requests share one quota.
- In Stripe test mode first, set `STRIPE_SECRET_KEY` in your shell, then run `node scripts/stripe-setup.mjs https://your-startfund-host.example`. It creates or reuses the product, monthly USD price, and signed webhook destination at `/api/billing/webhook`. Set the printed price ID and the webhook signing secret from the private `.radar/stripe-webhook-*.env` file or Stripe Dashboard, along with the secret API key. Keep test and live Stripe credentials and databases separate. Use the same public origin in `RADAR_PUBLIC_ORIGIN` and enable the Customer Portal in Stripe Dashboard. Verify the full flow with a test card before enabling live payments.
- After Checkout, save your Pro API key: it’s shown once and Startfund only stores its hash. Use **Restore Pro** on Pricing to activate another browser, or use the key as an API bearer token. Keep it private: it restores access to the subscription and billing portal as well as the quota. If you lose it, use **Replace Pro API key** on the browser you used for Checkout while Pro is active. This invalidates the old key and signs out browsers restored with it.

- **Sources:** Grants.gov and EU Funding & Tenders provide open calls. NSF Awards, CORDIS and UKRI GtR provide sampled historical award records; they do not describe open applications or aggregate disbursements. The public YC OSS directory provides derived batch history, not published application deadlines. Hacker News supplies funding and growth signals, not applications. The curated accelerator/corporate program directory links to official pages without scraping them. Each source has a provenance/reuse note; no Outreachr seed data was imported.
- **Form D:** Set `RADAR_SOURCE_CONTACT` to a real monitored email address before enabling SEC EDGAR. Only public filing metadata is ingested. Filers are not independently vetted investors, and filings do not show portfolio checks or investor reputation.
- **Government opportunities:** TED samples recent EU contract notices with active tender deadlines in IT, software, R&D, computer equipment, consultancy, and telecom. It excludes construction works. Tenders are procurement, not grants; place of performance helps match listings but does not establish bidder eligibility. Germany’s Förderdatenbank lists recent federal and state programs verified as including a grant; these are program links, not confirmed open calls. Both sources run without API keys. Enter your company’s country and, optionally, your developers’ countries as two-letter codes to match government opportunities. Existing saved regions still work.
- **Regional grants:** UK Find a Grant samples key-free public innovation listings for private-sector applicants. Curated official program links cover the four UK nations, France (including Île-de-France), India (including Karnataka, Kerala and Tamil Nadu), California, Massachusetts, New York, Texas and Washington, plus selected programs in Ireland, Spain, Australia and Singapore. These links have no implied intake or deadline. Enter optional company or developer subdivision codes such as `US-CA`, `GB-SCT`, `FR-IDF`, or `IN-KA`; these also count toward country matches. This is sampled coverage, not an eligibility determination or a complete directory.
- **Open-source and startup programs:** the catalog separates direct open-source opportunities from startup-dependent programs. Apply-now counts include only tracked official rows that are open, rolling, or accepting late applications. Closed and forthcoming programs do not count. Credits are not cash. This is sampled coverage, not a complete directory or an eligibility decision.
- **Storage:** The public `/api/catalog` and eve tools use the same catalog service. SQLite retains normalized investors, programs, opportunities, evidence, and changes. API inputs are fixed to the listed sources; raw snapshots are private, include source URL, fetch time and rights, and are retained for 14 days per active source (Grants.gov's transient token is omitted). Conditional GETs use upstream validators. Live listings cache for 20 minutes and the daily eve schedule refreshes historical evidence. Unknown values are never inferred from filings or cloud credits.
- **Matching:** confirm a profile inferred from the company’s public HTTPS homepage or enter your own details. The website reader checks robots.txt and reads only the homepage and a linked about page; it does not reuse site prose as a funding source. Topical terms query Grants.gov and EU Funding & Tenders; NSF Awards, CORDIS and UKRI add related historical evidence, not open calls. Region and prerequisites affect ranking but are not eligibility decisions. Innovate UK competitions use public, attributed metadata. The German directory and startup perks are official links, not complete coverage or guaranteed credits.
- **Agent drafts:** by default drafts are deterministic templates. Set `RADAR_MODEL_PROVIDER` to `gemini`, `groq`, or `gateway` and configure its free-tier credentials (`GOOGLE_GENERATIVE_AI_API_KEY`, `GROQ_API_KEY`, or `AI_GATEWAY_API_KEY` respectively; Vercel OIDC also supported if available). Set a strong `RADAR_AGENT_SECRET` and, when the agent is not reachable at the same process's port 3100, `RADAR_EVE_URL`. Gateway defaults to `reflection/beam-free`; verify quota and terms before changing the model with `RADAR_GATEWAY_MODEL`. Draft requests send profile/listing text but not the email address to your configured provider. Provider outages or quota limits fall back to a labelled template.
- **Weekly digest:** eve schedule runs Mondays at 13:00 UTC. Scanning never subscribes the founder. Delivery requires an explicit subscription request, a time-limited inbox confirmation and configured `RESEND_API_KEY`, verified `RADAR_EMAIL_FROM`, `RADAR_ALLOWED_RECIPIENT`, and an HTTPS `RADAR_PUBLIC_ORIGIN`. Each digest includes an unsubscribe link; outreach stays draft-only.

### Agent updates API

`GET /api/agent/updates` is a Pro-only JSON feed for funding opportunity and market changes. Send `Authorization: Bearer <key>` with a Pro API key or an operator key configured in `RADAR_API_KEYS`. The stdio MCP bridge sends `STARTFUND_API_KEY` as the same bearer credential.

Query parameters:

- `cursor`: decimal event sequence to start after. The default is `0`.
- `limit`: maximum journal rows scanned in one request. The default is `50`; the range is `1` to `100`.
- `type`: optional exact event type. Values are `opportunity.new`, `opportunity.deadline_changed`, `market.signal`, `market.regulatory_filing`, and `signal.unknown`.

The response contains `events`, `cursor`, and `hasMore`. `cursor` is the sequence of the last journal row scanned in the page. Rows hidden by `type` advance the cursor. Rows also advance the cursor when they are malformed or do not have a safe URL. If no journal row is scanned, the response returns the supplied cursor unchanged. Use the returned cursor for the next request. Events are ordered by durable ingestion sequence, not `observedAt`.

`hasMore` means at least one unscanned journal row existed after the page when the query ran. It does not mean another row matches `type`. Because `limit` caps scanned rows, a filtered page can be empty. Keep paging while `hasMore` is true.

Each event has `id`, `type`, `observedAt`, `source`, `title`, `url`, and `kind`. Events can also have `postedAt`, `fetchedAt`, and `rights`. `id` identifies the signal record. It can repeat when a market signal is corrected because each correction is a new journal event. For `opportunity.deadline_changed` events, `newDeadline` is the replacement deadline as a string. It is `null` when the deadline was cleared or became unknown. Events written before this field existed can omit it.

A safe URL uses HTTPS and has no credentials. Only events with safe URLs are emitted. Malformed payloads and unsafe URLs are not emitted. They still count as scanned journal rows for the cursor, so a page can contain fewer events than `limit`.

Update requests use the separate `agent_updates` usage action. Pro keys get 500 requests per UTC day across the API and MCP, with an 8-per-minute burst limit. Free accounts get no update-feed quota. The interactive eve agent keeps its separate `agent` quota.

### MCP

With the server running, add this stdio bridge to a compatible MCP host (use the absolute path to your checkout). Tools: `search_funding`, `analyze_company`, `recommend`, `builder_bundle`, and `get_funding_updates`. The update tool requires `STARTFUND_API_KEY` with Pro access and uses the cursor contract above. The bridge cannot read saved startup profiles or send messages; only the parameters you supply are processed. Set `STARTFUND_URL` in the MCP host’s environment to point at another installation.

```json
{
  "mcpServers": {
    "startfund": { "command": "node", "args": ["/path/to/startfund/scripts/mcp.mjs"] }
  }
}
```
