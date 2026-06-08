# Leg: verify-integration

**Status**: completed
**Flight**: [Wire Existing Controls (Shields + Home Page) into Settings](../flight.md)

## Objective
Run the flight's live acceptance — the `settings-controls` behavior test, the origin-check security
assertion, chrome + guest a11y, and the menu/tab + `tab-scheme-guard` regressions — against the running app,
and remediate anything that fails before the flight lands.

## Acceptance Criteria
- [x] Offline gates green: `npm run lint`, `npm run typecheck`, `npm test` (**211/211**).
- [x] `settings-controls` behavior test passes — run log at `tests/behavior/settings-controls/runs/`
  (spec promoted `draft → active`). Covers: controls present + full bridge surface; Shields toggle from
  settings persists (`shields.json`) + two-way syncs with the panel (both directions); home page set from
  settings persists (`settings.json`) + a new tab opens to it; invalid home rejected with a surfaced error;
  the origin-check security assertion; guest a11y.
- [x] **Security (origin-check)**: `window.goldfinchInternal` undefined in a web tab; the chrome **page**
  context cannot reach `ipcRenderer`/`internal-*` channels; main-side sender check is unit-tested. In-session
  vector documented (not driven) per DD5.
- [x] `npm run a11y` (chrome) + `--target=goldfinch://settings` (guest, wired controls) — no NEW violations.
- [x] Regression: `tab-scheme-guard` core holds (web spoof → no new internal tab); settings shell intact.

## Outcome
**PASS.** SC7 + SC8 verified live. No remediation needed (the one non-blocking review finding — the bridge
`!!` precision — was already hardened pre-commit). DD2 origin-check confirmed closing the Flight-4/5 Known
Issue for all drivable vectors. See the flight log's `verify-integration` entry + the run log
`tests/behavior/settings-controls/runs/2026-06-07-21-23-58.md`.

## Notes
- Flight-Director-driven (cdp-driver + node-CDP + filesystem reads), not the two-live-agent Witnessed crew —
  every verdict cites a raw machine-read value; see the run log's Orchestrator Notes for the deviation +
  compensating control. A future formal `/behavior-test settings-controls` can supersede the run log.

---

## Post-Completion Checklist
- [x] All acceptance criteria verified (live)
- [x] Run log committed; spec promoted `draft → active`
- [x] Flight log updated
- [x] Leg status `landed`; checked off in flight.md
- [ ] Flight lands after the leg-7 HAT (operator subjective acceptance)
