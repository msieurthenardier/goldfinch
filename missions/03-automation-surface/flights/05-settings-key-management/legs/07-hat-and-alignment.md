# Leg: hat-and-alignment

**Status**: completed
**Flight**: [Settings key management + automation UI](../flight.md)

## Objective
Guided human acceptance test of the full automation control surface in `goldfinch://settings`: the operator drives the end-to-end flow (enable → generate key → copy → connect a client → watch the indicator/log → rotate/revoke → confirm the live session dies), confirms look/feel, and elects any alignment tweaks. (DD7)

## Context
- Interactive HAT — the human performs each step; the FD guides one step at a time and fixes issues inline.
- Most of the surface is already machine-verified live in leg 6 (`settings-automation` 12/13 pass; `mcp-jar-scoping` full matrix pass). This HAT is the human look/feel + flow confirmation + an alignment opportunity.
- The current running instance (admin-env `dev:automation`, port 49707) exposes the admin-key control too, so the HAT can cover both tiers.

## Acceptance Criteria (verification steps — operator-confirmed)
- [ ] **AC1** — The Automation section reads clearly: the operator can find the enable toggle, the live MCP address + Copy, the port field + Find free port + bind-status, the per-jar key controls, the (env-gated) admin-key control, and the activity viewer — and the layout/copy is coherent.
- [ ] **AC2** — End-to-end flow feels right: enable → generate a per-jar key (show-once + Copy works) → the chrome toolbar indicator lights and names the jar while a client is connected → the audit viewer lists the session + actions → rotate/revoke behaves as expected.
- [ ] **AC3** — The admin-key control appears (admin env set) and its show-once/rotate/revoke flow works; the indicator distinguishes an admin session.
- [ ] **AC4** — Alignment: the operator notes any look/feel/wording tweaks. Known candidates surfaced in earlier legs: (a) the `automation-active` indicator's admin color (currently violet `#a371f7` — non-alarm, deliberately not red); (b) the enable-toggle live-sync lag after a key mint (Anomaly); (c) the ungraceful-disconnect indicator lingering (Anomaly / fast-follow). Decide per item: tweak inline now, defer to a fast-follow, or accept as-is.

## Verification Steps
Guided, one at a time (see the live session). Issues fixed inline (spawning a Developer if code changes are needed) and re-verified before proceeding.

## Outcome
**Pass with minor tweaks — all applied + re-verified live (2026-06-15).** Operator drove the live surface; verdict pass-with-tweaks. Four inline changes applied (operator-elected) and live-verified on fresh assets, `npm test` 612 / typecheck / lint green:
1. Show-once **Done** button (dismisses the reveal), placed beside Copy in the same row (operator-requested).
2. **Enable-toggle live re-sync** after a jar-key mint (broadcast `settings-changed`) — resolves the toggle-lag anomaly.
3. **Ungraceful-disconnect session teardown** (GET SSE-close → `noteSessionClose`) — resolves the stale-indicator anomaly; unit-test-guarded + live-verified (stage→abrupt-kill→drains to 0).
4. **MCP-config code block** in the connect-hint (ready-to-paste `.mcp.json` populated with the live address) + Copy-config button.

5. **Live port-rebind on Save** (operator-elected, supersedes DD1's next-launch — see Deviations). The running MCP server now rebinds to the new port on Save; verified live (49707↔50500: UI + `ss` + functional 401-on-new / refused-on-old). Resolves the operator-reported "port-save UI is stale" — it wasn't a backend bug (the setting persisted), but the next-launch design read as stale; live-rebind makes the change immediate.

**Deferred to fast-follow (operator-elected):** activity-log paging/show-all, a Clear-activity button, and a retention-days setting (the last needs disk persistence — DD8 excluded it, so its own flight/decision). AC1–AC3 confirmed; AC4 dispositioned (tweaks applied; the three list-control items deferred).

---

## Post-Completion Checklist
- [ ] All HAT steps confirmed (or dispositioned)
- [ ] Alignment tweaks applied / deferred (recorded)
- [ ] Update flight-log.md with the HAT outcome
- [ ] Set this leg's status to `completed`; check off in flight.md
- [ ] Commit any inline fixes (fresh commit)
