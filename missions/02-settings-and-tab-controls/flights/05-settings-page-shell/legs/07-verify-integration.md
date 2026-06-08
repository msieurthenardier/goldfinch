# Leg: verify-integration

**Status**: completed
**Flight**: [Settings Page Shell + Address-Bar Chips](../flight.md)

## Objective
Run the flight's live acceptance — the `settings-shell` behavior test, the chrome + guest a11y gates, the
deferred DD2 CSP-subresource spike, and the menu/tab + `tab-scheme-guard` regressions — against the running
app, and remediate anything that fails before the flight lands.

## Context
- This flight's acceptance is **live** (SC6 recognizable shell; SC8 keyboard + a11y) — the offline unit
  tests (182, covering pure modules) cannot see the rendered shell, the chips, the lock, or a11y. DD8 fixed
  the apparatus: drive `:9222` via `scripts/cdp-driver.mjs` + a guest CDP attach; **never** the
  `chrome-devtools` MCP (false pass).
- Carries the **DD2 CSP-subresource spike** (deferred from leg 2) and the **chrome+guest a11y** gate.

## Acceptance Criteria
- [x] Offline gates green: `npm run lint`, `npm run typecheck`, `npm test` (182/182).
- [x] `settings-shell` behavior test passes (12/12) — run log committed under
  `tests/behavior/settings-shell/runs/`.
- [x] DD2 CSP spike confirmed: `settings.css` + `settings.js` load/apply under the unchanged `INTERNAL_CSP`
  (no `securitypolicyviolation`).
- [x] `npm run a11y` (chrome) — no NEW violations vs the pinned `ACCEPTED` baseline.
- [x] `npm run a11y -- --target=goldfinch://settings` (guest) — no NEW violations.
- [x] Regressions: kebab/container menu keyboard (leg-1 hoist surface) intact; `tab-scheme-guard` core
  invariant (web origin can't open/embed `goldfinch://`) holds.
- [x] Any failure remediated before landing.

## Outcome
**PASS.** All criteria met. One a11y regression found and fixed mid-leg: the `#address-chip` exposed an
un-landmarked `#address` (4 NEW `region` violations); fixed with `role="search"` on `#address-wrap`
(`src/renderer/index.html`), validated live, persisted, reloaded-from-disk, re-audited clean. The DD2 spike
passed (no CSP fallback needed). See the flight log's `verify-integration` entry + Anomalies, and the run
log `tests/behavior/settings-shell/runs/2026-06-07-18-07-42.md`.

## Notes
- Flight-Director-driven (cdp-driver + node-CDP), not the two-live-agent Witnessed crew — every verdict
  cites a raw machine-read value; see the run log's Orchestrator Notes for the deviation + compensating
  control. A future formal `/behavior-test settings-shell` can supersede the run log.

---

## Post-Completion Checklist
- [x] All acceptance criteria verified (live)
- [x] Run log committed; spec promoted `draft → active`
- [x] Flight log updated (results + DD2 resolution + the `role="search"` anomaly)
- [x] Leg status `landed`; checked off in flight.md
- [ ] Flight lands after the leg-8 HAT (operator subjective acceptance)
