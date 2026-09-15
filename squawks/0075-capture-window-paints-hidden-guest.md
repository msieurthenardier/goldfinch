# Squawk 0075: `captureWindow` composites a hidden guest over chrome-DOM panels (Wayland fallback)

**Status**: deferred
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-15
**Completed**: —

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

_(written at completion)_ Gate the guest layer the way the overlay layers
are gated: skip the guest capture/paint when `activeEntry.view.getVisible()`
is false (re-checked after the await, like the overlays), so the chrome's
own paint shows through. One function, no interface change.

## Verification

Live: on a failed tab `captureWindow` shows the load-failure panel (matches
`captureScreenshot(chromeWcId)`); on a healthy tab the guest still
composites. A unit pin is possible only if the guest-layer decision is
extracted into a pure predicate — optional.

## Sign-Off

_(written at completion)_

## Disposition

**Deferred**: out of Mission 20 Flight 1's scope (main.js capture code is
untouched by the flight) — revisit before Mission 20 Flight 3's crash-surface
behavior run, or the next time `grabWindow` is touched, whichever is first.
