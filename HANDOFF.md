# Startfund handoff

## Canonical local tree

VERIFIED: `devin/release-integration` is the canonical local release-candidate branch. It merges these local branches:

- `devin/premium-brand` at `4455cfb`, Folio Turn brand assets.
- `devin/invite-beta-access` at `34feeab`, invite beta access and beta documentation.
- `devin/agent-updates` at `8d68b82`, durable agent update journal.
- `devin/innovate-date-fix` at `965460c`, timezone-independent Innovate UK date parsing.
- `devin/open-source-programs` at `ef95755`, open-source and startup program paths.
- `devin/test-workflow` at `c2177ac`, pull-request test, typecheck, and build workflow.

VERIFIED: no push, merge into `main`, deployment, or external publication has been performed in this session.

VERIFIED: `/Volumes/Sarthi MAC/OSS/startfund` is not the canonical clean tree. It still has uncommitted duplicate brand and date-fix work plus untracked local artifacts. Use `/Volumes/Sarthi MAC/OSS/startfund-release-integration` for release verification.

## Production state

VERIFIED: `https://startfund.ironvale.llc/` returned HTTP 200 on 2026-11-27. The HTML contained `Funding that fits` and did not contain `Enter your invite code`. This supports the earlier report that production still serves the older public pre-beta build. This check does not identify the exact deployed commit.

VERIFIED: `gh pr checks 10` showed the remote Vercel check as failed for PR10. VERIFIED: Vercel logs for deployment `dpl_FUwyeCGhSSYEVFex6FDmzBx8YGHZ`, commit `d4a3b5f`, show `tests/beta-auth.test.ts(9,38): error TS2345` and `tests/beta-auth.test.ts(18,106): error TS2339`, then `Failed to type check.` The local beta branch now has fixes that the remote branch lacks. The same logs show Node.js 26 because `package.json` allows `node: >=24`; local verification used Node.js `v24.19.0`.

## Verification evidence

VERIFIED: in `devin/release-integration`, `RADAR_DB_PATH=:memory: npm test` finished with:

```text
tests 90
pass 90
fail 0
```

VERIFIED: `npx tsc --noEmit` exited 0.

VERIFIED: `npm run build` exited 0. The route list included `/api/agent/updates`.

VERIFIED: a local production server passed these smoke checks:

- `/api/agent/updates` without a bearer key returned 401 `Authentication required.` from the beta proxy.
- The same route with an invalid bearer key returned 401 `Invalid API key.`
- The same route with a valid operator key returned 200 and a JSON update page.
- `/catalog` without a beta session redirected to `/login` with status 307.
- `/s/not-a-real-share` without a beta session returned 404, not a login redirect.
- An MCP-style update request with `type=market.signal&limit=1` returned 200, an empty `events` array, and `hasMore:true`. This is documented scan-cursor behavior, not a failed request.

VERIFIED in Brave: the login page invite field now uses the full form width. The catalog renders the Folio Turn brand and shows 5 direct open-source apply-now possibilities plus 15 startup-dependent apply-now possibilities. These are tracked curated rows only. They are not a total market count.

## Product decisions now implemented

- Folio Turn is the implemented brand direction. SVG and binary icon assets were regenerated.
- Invite codes are one-time use and expire after 30 days.
- Beta sessions expire after 7 days. They are stateless. Rotating `RADAR_AUTH_SECRET` revokes all sessions. Individual session revocation is not available.
- Shared `/s/` report pages and their image routes remain public during beta.
- API requests with bearer credentials pass the beta proxy, then each endpoint validates the credential. The proxy does not validate the key itself.
- Agent update requests use the separate `agent_updates` quota. Pro keys get 500 requests per UTC day and an 8-per-minute burst limit.

## Agent update contract

VERIFIED: `signal_events` is an append-only SQLite journal with durable `seq` values. Existing `signals` rows are backfilled once in old `rowid` order. Insert and update triggers append immutable copies.

VERIFIED: a market-signal update appends a new journal event. A refresh that only changes `fetchedAt` does not append an event.

The public cursor is the sequence of the last scanned journal row. Rows hidden by `type`, malformed rows, and rows with unsafe URLs still advance the cursor. `hasMore` means another unscanned journal row exists. It does not promise a matching event. This contract is documented in `README.md` and in the MCP tool description.

LIMITATION: the remote Turso/libsql path was not exercised. Verification used local SQLite and temporary SQLite files. libsql supports SQLite triggers and JSON functions, but production migration still needs a smoke test after deploy.

## Open-source program evidence

VERIFIED: the catalog implementation separates direct open-source opportunities from startup-dependent opportunities. Only open, rolling, and late-application rows count. Credits keep `amount:null` because credits are not cash.

REPORTED: prior official-source research found the xAI startup program active and documented venture backing and live-product requirements. VERIFIED in this session: direct `webfetch` and Brave access to `x.ai/startups` were blocked by Cloudflare, while web search results for the official `x.ai/startups` and `x.ai/startups/apply` pages showed active application text. Treat the Grok row as lower-confidence than rows whose official pages were directly fetched. Do not silently treat absence of access as evidence that the program is closed.

## Merge risks

1. `devin/open-source-programs` conflicts with the premium catalog page. The release branch resolves the conflict by keeping both `BrandMark` and `sourceRows` imports.
2. `devin/agent-updates` conflicts with invite beta access in `lib/plans.ts` and `lib/usage.ts`. The release branch resolves the conflict by keeping both `auth` and `agent_updates` quota entries.
3. PR10 is stacked on `devin/premium-brand`. If PR9 is squash-merged, regenerate or rebase the invite branch before merging it. Otherwise overlapping brand changes can become real conflicts.
4. The exact verified tree is `devin/release-integration`. Merging the independent branches one by one requires the same conflict resolutions.

## Remaining release gates

1. Choose release mechanics: one release-candidate PR from `devin/release-integration`, or updated stacked PRs with manual conflict resolution.
2. Push branches only after explicit user approval.
3. Create or update PRs, then inspect the test workflow and Vercel checks.
4. Configure production secrets before deployment. At minimum verify `RADAR_AUTH_SECRET`, `RADAR_USAGE_SECRET`, `RADAR_ADMIN_TOKEN`, `TURSO_DATABASE_URL`, and `TURSO_AUTH_TOKEN`.
5. Verify Vercel Deployment Protection and the intended Stripe mode before exposing checkout.
6. Deploy only after explicit user approval, then smoke test login, catalog, shared reports, agent updates, MCP access, and the Turso journal migration.

## Local artifacts

- `.brand-preview/` and `agent/skills/` are local artifacts in the main worktree. They are not release inputs.
- `node_modules` in some secondary worktrees is a symlink. Tests can use it, but Turbopack production builds require a real local `node_modules` copy.
- CORRECTED: an earlier revision of this handoff said `AGENTS.md` was not part of the release candidate. The generated file says committing it keeps the tree clean. It is now tracked in the release candidate. Do not edit its contents manually.
