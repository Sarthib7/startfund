# Startfund

Startup funding catalog and radar built on Vercel eve and Next.js. Browse source-backed funding records, then enter a profile and open a ranked match for an outreach draft. The core demo works without credentials.

```sh
npm ci
npm test
npm run build
npm start
```

Open http://localhost:3100. Requires Node.js 24+. Use `npm run dev` for development. Data is stored in SQLite under `.radar/`; set `RADAR_DB_PATH` to a persistent volume for a single-instance deployment. Do not deploy this storage on an ephemeral filesystem if you need persistent profiles/digests.

- **Sources:** Grants.gov and EU Funding & Tenders provide open calls. NSF Awards, CORDIS and UKRI GtR provide sampled historical award records; they do not describe open applications or aggregate disbursements. The public YC OSS directory provides derived batch history, not published application deadlines. Hacker News supplies funding and growth signals, not applications. The curated accelerator/corporate program directory links to official pages without scraping them. Each source has a provenance/reuse note; no Outreachr seed data was imported.
- **Form D:** Set `RADAR_SOURCE_CONTACT` to a real monitored email address before enabling SEC EDGAR. Only public filing metadata is ingested. Filers are not independently vetted investors, and filings do not show portfolio checks or investor reputation.
- **Storage:** The public `/api/catalog` and eve tools use the same catalog service. SQLite retains normalized investors, programs, opportunities, evidence, and changes. API inputs are fixed to the listed sources; raw snapshots are private, include source URL, fetch time and rights, and are retained for 14 days per active source (Grants.gov's transient token is omitted). Conditional GETs use upstream validators. Live listings cache for 20 minutes and the daily eve schedule refreshes historical evidence. Unknown values are never inferred from filings or cloud credits.
- **Matching:** an explainable heuristic uses region, stage, keywords, deadline urgency, and stated awards. It does not verify eligibility. US and EU grant coverage is partial, and other regions see only global links/signals. No private funding feeds or automated fundraising outreach.
- **Agent drafts:** by default drafts are deterministic templates. Set `RADAR_MODEL_PROVIDER` to `gemini`, `groq`, or `gateway` and configure its free-tier credentials (`GOOGLE_GENERATIVE_AI_API_KEY`, `GROQ_API_KEY`, or `AI_GATEWAY_API_KEY` respectively; Vercel OIDC also supported if available). Set a strong `RADAR_AGENT_SECRET` and, when the agent is not reachable at the same process's port 3100, `RADAR_EVE_URL`. Gateway defaults to `reflection/beam-free`; verify quota and terms before changing the model with `RADAR_GATEWAY_MODEL`. Draft requests send profile/listing text but not the email address to your configured provider. Provider outages or quota limits fall back to a labelled template.
- **Weekly digest:** eve schedule runs Mondays at 13:00 UTC. Built on-demand for preview; scheduled scans refresh saved profiles. Sending is disabled unless `RESEND_API_KEY`, a verified `RADAR_EMAIL_FROM`, and `RADAR_ALLOWED_RECIPIENT` are set and that recipient explicitly entered the address in their profile. Only the digest is ever sent; outreach drafts are never sent. The demo has no paid subscription flow.

### MCP

With the server running, add this stdio tool to a compatible MCP host (use the absolute path to your checkout). It exposes only the public catalog, never startup profiles or sending actions. Set `STARTFUND_URL` in the MCP host's environment to point at another installation.

```json
{
  "mcpServers": {
    "startfund": { "command": "node", "args": ["/path/to/startfund/scripts/mcp.mjs"] }
  }
}
```
