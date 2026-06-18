# Leg: verify-and-close

**Status**: completed
**Flight**: [External-consumer enablement + README reframe](../flight.md)

## Objective
Confirm the documented production getting-started actually works end to end (the SC6 demonstration),
reconcile any doc drift, and close out SC6 + Flight 10.

## Context
- **DD1** (flight): SC6 is closed by documentation + a live getting-started confirmation, not a new
  behavior test. The drive capability is already demonstrated (operator drove Goldfinch from the-one).
- **Architect**: the live run uses the (leg-3-fixed) example client over HTTP-transport tools only — not
  blocked by the WSLg apparatus ceiling (no coordinate-click / detached DevTools).
- The example client now requires `GOLDFINCH_MCP_KEY`; the dev path mints a key via
  `GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`.

## Inputs
- Legs 1–4 landed (README reframe, Consumer Contract + getting-started, example-client auth fix,
  CLAUDE.md pattern).
- A running app with the automation surface enabled (GUI / WSLg) for the live half.

## Outputs
- Recorded confirmation that the documented getting-started works (or a recorded disposition).
- SC6 marked met in the mission; Flight 10 ticked; flight status → landed (in the commit step).

## Acceptance Criteria
- [x] **Regression guard green** — `npm test` (773 pass / 0 fail), `npm run typecheck` (clean),
      `npm run lint` (clean), `node --check scripts/mcp-example-client.mjs` (OK). No engine source
      touched, so this guards the one example-client edit + confirms nothing broke.
- [x] **Doc-drift reconciliation** — tool count is 21 everywhere (no stale "17"); README links
      `docs/mcp-automation.md` exactly twice; DOWNLOADS block byte-for-byte unchanged; logo retained;
      `GOLDFINCH_MCP_KEY` consistent across the example client and the docs; port 49707 consistent.
- [x] **Independent review** — Reviewer confirmed all four legs meet acceptance criteria; correctness
      cross-checked against code (Settings toggle is the sole production bind gate `mcp-server.js:488`;
      Bearer construction matches `scripts/lib/mcp-client.mjs`; env vars correct). One non-blocking nit
      (usage-comment env-var placement) fixed.
- [x] **Live getting-started confirmation (SC6)** — **operator-waived (2026-06-17).** SC6 is already
      empirically demonstrated by the-one driving Goldfinch end-to-end over this surface; the
      example-client auth fix is now character-for-character identical to the proven `scripts/lib/mcp-client.mjs`
      harness; and the independent review cross-checked the auth gate / env var / tool count / bind gate
      against source. The operator accepted the static verification + demonstration as sufficient and
      waived the belt-and-suspenders live example-client run (low marginal value). A doc/example bug, if
      ever surfaced, is a one-line follow-up, not a flight blocker.
- [x] **SC6 marked met** in the mission + **Flight 10 ticked** (commit step).

## Verification Steps
- Static guard (DONE): `npm test`, `npm run typecheck`, `npm run lint`, `node --check`.
- Live (PENDING): `GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation` (terminal 1, capture the
  printed `AUTOMATION_DEV_MINT` key) → `GOLDFINCH_MCP_KEY=<key> node scripts/mcp-example-client.mjs`
  (terminal 2) → expect tool discovery (21) + the open/navigate/screenshot/readDom sequence to succeed.

## Implementation Guidance
1. Static guard + drift reconciliation (DONE — see flight log).
2. Live confirmation: operator-run or FD-guided (GUI required); record the outcome in the flight log.
3. On a green live run (or operator acceptance of the static verification as sufficient), mark SC6 met
   in `missions/03-automation-surface/mission.md` and tick the Flight 10 box; the commit step sets the
   flight status to landed.

## Edge Cases
- **WSLg / GUI availability**: the live run needs a display. If unavailable, the operator runs it on
  their session; the static verification + independent review already establish the docs are accurate.
- **Live run reveals a doc bug**: that is a divert signal (DD/Adaptation) — fix the doc in a follow-up,
  do not paper over it.

## Files Affected
- `missions/03-automation-surface/mission.md` — SC6 checkbox + Flight 10 tick (commit step).
- Flight artifacts (status/log) — FD-managed.

---
