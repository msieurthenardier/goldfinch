# Squawk 0075: `captureWindow` composites a hidden guest over chrome-DOM panels (Wayland fallback)

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-15
**Completed**: 2026-10-24

## Report

Under the Wayland ozone backend `captureWindow` uses the `capturePage`
composite fallback in `src/main/main.js`'s `grabWindow`. That composite
draws the ACTIVE tab's guest `capturePage()` at the guest view's bounds
unconditionally — it never consults whether the guest view is visible. Since
Mission 20 Flight 1 a failed tab's guest is deliberately hidden
(`applyGuestVisibility`, DD1) while the chrome renders the load-failure
panel in the guest slot, so the composite paints a blank white guest OVER
the panel: the capture shows an empty page area where the operator sees the
explanatory surface. Observed at every failed-tab capture of the
`navigation-failure-surface` Witnessed run (2026-09-15); the run used
`captureScreenshot(chromeWcId)` as the faithful rendered observable instead.
Any future hidden-guest state (Flight 3's crash surface) inherits the same
artifact.

Reproduce: dev launch on WSLg (Wayland), open a tab to a refusing address
(`http://127.0.0.2:<free port>/`), call `captureWindow` — the page area is
white although the chrome view shows the panel.

## Evidence

- `src/main/main.js` `grabWindow` — guest layer: `activeEntry =
  grabRec.tabViews.get(grabRec.activeTabWcId)` (`:635`), `atc.capturePage()`
  (`:649`), `guestBounds = activeEntry.view.getBounds()` (`:659`); no
  `getVisible()`/`entry.loadFailure` check. Contrast the find-overlay and
  sheet layers, which ARE gated on `isVisible()` (`:686`, `:714`, with
  post-await re-checks at `:698`, `:738`).
- Run log `tests/behavior/navigation-failure-surface/runs/2026-09-15-15-01-54.md`
  (Orchestrator Notes, "Rendered observable ruling"; Executor closing (2)).

## Corrective Action

**Satisfied by squawk 0155, commit 3c8c72e** (picked up and verified at the 2026-10-23 turnaround; no new code or test).

`grabWindow` (`src/main/main.js`) now layers the guest only while `activeEntry.view.getVisible()` is true: `const atc = activeWc && !activeWc.isDestroyed() && activeEntry.view.getVisible() ? activeWc : null`, and the same check is repeated inside the retried `captureGuest` thunk. A skipped guest leaves the chrome capture, which carries the panel. This is the exact gate this squawk proposed.

Scenario coverage:
- Load-failure / TLS interstitial and crash panel: `applyGuestVisibility` (`register-tab-ipc.js`) calls `view.setVisible(active && !guestTakenOver(entry))`, and `guestTakenOver` covers load-failure and crash. The view is hidden, so `getVisible()` is false and the guest is skipped. 0155 reproduced this live.
- Welcome / viewless tab: `wcId === null` records are never in `tabViews`, so `activeEntry` is null, `atc` is null and no guest is drawn.
- Inactive, moved or closed tabs: the other `setVisible(false)` sites feed the same `getVisible()` gate.
- No uncovered scenario found.

Pins already asserting the gate: `test/unit/capture-window-failure-pins.test.js` P4-gate-atc and P4-gate-retry (wrap-insensitive source scan over `grabWindow`), with `neuter P4` (dropping either gate goes red, `assertMutated`-guarded). No pin added.

## Verification

- Read the current `grabWindow`, the 0155 squawk, and the P4 pins; all hold on the real source (`node --test test/unit/capture-window-failure-pins.test.js` passes).
- 0155's recorded live verification covers the Report's reproduction: the TLS-interstitial `captureWindow` shows the panel, matching chrome-only `captureScreenshot`, and a healthy http tab still composites its guest.
- Not re-run live (the dev MCP server was not attached); the crash panel shares the same `guestTakenOver` / `setVisible(false)` path.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped, turnaround batch)
**Verdict**: confirmed, with no blocking issues. The disposition matches the evidence: it is satisfied by 0155's `getVisible()` gate. The cited pins are `capture-window-failure-pins.test.js` P4-gate-atc and P4-gate-retry, and the neuter test passes in the full suite. The batch gates were `npm test` 6041 (6037 pass, 0 fail, 4 todo), with typecheck, lint and format:check clean.
**Commit**: the `squawk: turnaround 2026-10-23` commit on `squawk/turnaround-2026-10-23`

## Disposition

**Deferred**: out of Mission 20 Flight 1's scope (main.js capture code is
untouched by the flight) — revisit before Mission 20 Flight 3's crash-surface
behavior run, or the next time `grabWindow` is touched, whichever is first.

**Pickup**: 2026-10-23 turnaround. Found already fixed by squawk 0155; deferral above retained for history.
