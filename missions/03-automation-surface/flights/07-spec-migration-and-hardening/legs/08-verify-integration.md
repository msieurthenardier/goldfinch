# Leg: verify-integration

**Status**: completed
**Flight**: [Bulk spec migration + ungated-path hardening (scoped)](../flight.md)

## Objective
Verify, live and FD-driven with cited machine-read evidence, that the migrated specs' apparatus runs on the admin MCP surface (NOT `cdp-driver.mjs`/`:9222`), confound-free; that full gates pass; and that the hardened `:9222` still serves the deferred `a11y-audit` + `farbling` path.

## Context
- The flight's Verification standard: the migrated subset passes driven by the admin MCP client + `getChromeTarget`/guest `wcId`, NOT `cdp-driver`/`:9222`; **confound-free check** — at least one migrated apparatus exercised with `dev:debug`/`:9222` NOT running. Mission standard (M02 debrief): FD-driven runs with cited machine-read evidence are accepted; the two-agent Witnessed pattern is optional.
- Run live by the Flight Director (operator-authorized "you run them, I guide" → FD drove directly). Evidence at the ephemeral path (not committed): `/tmp/behavior-tests/goldfinch/verify-integration/2026-06-16-19-42-35/` (`driver.mjs`, `verify-output.txt`).
- The audit-paging UI + the indicator hidden-at-true-zero frame are HAT-verified (leg 9) — not MCP-observable (the harness is itself an admin session; an MCP read cannot observe zero sessions).

## Acceptance Criteria
- [x] **AC1 (MCP-surface apparatus live)** — A real admin MCP client (`@modelcontextprotocol/sdk` `StreamableHTTPClientTransport`, `Authorization: Bearer <adminKey>` on `127.0.0.1:49707/mcp`) drove every primitive the migrated specs rely on, against `npm run dev:automation` (auto-mint). Evidence (`verify-output.txt`):
  - `listTools` → **17 tools**, `getChromeTarget` present.
  - `getChromeTarget` (admin-only) → `{wcId:1, kind:'chrome', url:index.html}` — admin auth + chrome-target read path.
  - `readDom(chrome)` → `{url, title:"Goldfinch", html:11976b}`.
  - `readAxTree(chrome)` → **352 AX nodes** (the a11y-tree read path; focused-node absent pre-anchor, as expected).
  - `captureWindow` → 114460-byte PNG (screenshot/coordinate-locate path).
  - `pressKey(chrome, 'M', ['control'])` → `{ok:true}` — the **leg-1 modifier-chord capability live** (toolbar-pins Step 6 path).
  - `openTab('https://example.com/')` → wcId 3; `enumerateTabs` lists the guest; `readDom(guest).url = https://example.com/` with body "Example Domain" — the guest-nav + URL read path (param-strip / scheme-guard / core-browsing specs).
- [x] **AC2 (confound-free)** — `dev:automation` opened **no `:9222`** (curl `http://127.0.0.1:9222/json/version` → connection refused) while the full MCP-surface drive succeeded. The migrated apparatus is genuinely off `:9222`/`cdp-driver`.
- [x] **AC3 (auth gate)** — the MCP port refused an unauthenticated request (`HTTP 401` to `/mcp` without a Bearer); admin tools succeeded only with the admin Bearer.
- [x] **AC4 (full gates green)** — `npm test` 692 pass / 0 fail; `npm run typecheck` clean; `npm run lint` clean (confirmed at the batched review + leg-7 land).
- [x] **AC5 (hardened `:9222` still serves the deferred path)** — `npm run a11y` (the deferred axe harness, Node-`WebSocket` no-Origin client) attached + ran the full axe rule set over the **narrowed** `:9222` (`--remote-allow-origins=http://127.0.0.1:9222`) in leg 7; `farbling`'s local chrome-devtools-MCP attach is also admitted (probe arm1=no-Origin 101 + arm3=loopback-Origin 101; only foreign origins blocked). No regression to the deferred consumers.
- [x] **AC6 (audit-paging + indicator hidden-at-zero deferred to HAT)** — recorded: the leg-6 paging UI and the settings-automation zero-state/indicator-hidden frame are verified in the leg-9 HAT (not MCP-observable). Not silently dropped.

## Verification Steps
- AC1/AC2/AC3: see the evidence (`driver.mjs` + `verify-output.txt`); FD-driven against a live `dev:automation` launch with `:9222` confirmed down.
- AC4: `npm test && npm run typecheck && npm run lint`.
- AC5: the leg-7 probe + `npm run a11y` run (flight-log Leg 7 entry).
- AC6: carried to leg 9.

## Notes
- **Independent a11y finding (carried forward, NOT a F7 regression):** the leg-7 `npm run a11y` run reported 2 NEW axe violations — `scrollable-region-focusable` (serious) on `.ps-list` in the privacy-panel + lightbox. These are chrome-UI a11y issues unrelated to F7's spec-migration/hardening (and unrelated to leg-6's settings-guest paging). Flagged for a future a11y leg/flight; recorded in the flight-log Anomalies.
- The migrated chrome specs' per-spec live runs (full step-by-step Witnessed runs) remain available via the apparatus proven here; this leg verifies the apparatus end-to-end + the confound-free property, which is the load-bearing risk the migration introduced.

## Files Affected
- None (verification leg; evidence is ephemeral, not committed). Artifacts: this leg doc + the flight-log entry.

---

## Post-Completion Checklist
- [x] All acceptance criteria verified
- [x] Update flight-log.md with leg progress entry + evidence path
- [x] Set this leg's status to `completed`
- [ ] Check off this leg in flight.md (at flight commit / landing)
- [ ] Batched flight — committed with the flight-landing block (after leg 9)
