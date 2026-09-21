# Squawk 0100: Kebab and page context menu go dead in a window after closing an internal tab

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-21
**Completed**: —

## Report

Reported by the operator during Mission 21 Flight 3's HAT. In one window, after
closing a `goldfinch://vault` tab and loading an ordinary web page in that window,
**every overlay-sheet menu stopped opening**: the kebab does nothing at all on
click, and right-click on a web page opens no context menu. No sheet was visibly
open at the time. A NEW window (Ctrl+N) works normally — so the fault is
per-window state, consistent with the menu-overlay sheet being a per-window lazy
singleton (`src/main/menu-overlay-manager.js`, the registry record's `sheet` slot).

Repro (as observed): open the vault page in a tab → close that tab → load a web
page in the same window → click the kebab / right-click the page. Not yet reduced
further (whether ANY internal tab triggers it, whether the closed tab had to be
the active one, whether a web tab close does too).

**Suspected pre-existing, not a Flight 3 regression**: `git diff 016e540 HEAD`
is EMPTY for every file on the sheet / tab-close / window-lifecycle path —
`menu-overlay-manager.js`, `register-overlay-ipc.js`, `register-tab-ipc.js`,
`window-factory.js`, `window-registry.js`, `overlay-menus.js`, `menu-overlay.js`,
`tab-controller.js`, `menu-overlay-preload.js`. **Confirm by reproducing on `main`.**

No uncaught exception, crash, or renderer restart appeared in the app log
(`--enable-logging`, which does surface chrome-renderer console output) — so the
symptom is stuck STATE rather than a thrown error.

## Evidence

- Kebab and page-context menu both dead in the affected window; both fine in a new
  window.
- Same symptom CLASS as squawk 0057 (completed): the sheet's bounds track the
  ACTIVE GUEST, and 0057's kebab was unclickable on a viewless welcome tab until
  `measureSlot` (`measureWebviewsSlotDIP`) was added for that case. Hypothesis:
  closing the active internal tab leaves the sheet tracking a destroyed guest's
  bounds, or a sheet `open` flag stuck `true` so every trigger toggles "close".
  **Not diagnosed** — a hypothesis only.

## Corrective Action

*(written at completion)*

Root cause is not yet known. Reproduce on `main`, reduce the repro, then read the
sheet's attach / bounds / close path for the internal-tab-close case. **If the fix
is not findable in one read pass, this fails the squawk gate and escalates.**

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —

## Disposition

Deferred — out of Mission 21 Flight 3's path; the HAT continues in a new window.
