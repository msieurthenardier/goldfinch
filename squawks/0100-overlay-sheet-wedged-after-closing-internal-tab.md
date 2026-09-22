# Squawk 0100: Kebab and page context menu go dead in a window after closing an internal tab

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-21
**Completed**: 2026-09-22

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

**Reproduced by the operator** (Mission 21 Flight 4 HAT, step 8) with a live,
instrumented repro: regular tab → kebab → Secrets (`goldfinch://vault` opens) →
on the vault page click Unlock (the `vault-unlock` sheet opens) → click back to
the original tab. From that point, every later kebab/right-click menu opens
correctly in main/sheet/chrome state but never paints — dead for the rest of the
window's life.

**Root cause (confirmed by a second, live-instrumented FD diagnosis pass,
`document.visibilityState` logged on the sheet document itself, one fresh app
per experiment)**: `register-tab-ipc.js`'s `tab-set-active` handler, on a tab
SWITCH while the sheet is VISIBLE, ran `owner.sheet?.syncBounds(rounded)` —
applying the NEW active tab's bounds — and, in the very same tick, immediately
followed with `owner.sheet?.closeMenuOverlay('tab-switch')` → `hide()` →
`removeChildView`. An internal↔web switch is exactly the case that resizes:
internal tabs have no bookmarks bar, so the guest/sheet bounds differ (`y=89`
vs `y=119` in the live repro); a web→web switch keeps the same bounds and never
exhibits the bug. A syncBounds that resizes the STILL-VISIBLE sheet, followed
in the same tick by `removeChildView`, leaves the sheet webContents' page
visibility stuck `'hidden'` for the rest of the window's life: every LATER
`openMenu` still runs its full main/sheet/chrome protocol correctly and
`show()` still calls `v.setVisible(true)`, but the surface never repaints.
State is correct everywhere; only pixels are missing — and this is
structurally invisible to automation, since the kebab/page-context menuTypes
are not in `AUTOMATABLE_MENU_TYPES` and are redacted from every capture, and
`captureWindow` composites the sheet layer by `capturePage` regardless of page
visibility (consistent with the two failed automation diagnosis passes noted
under Disposition below).

**First remedy, tried and disproven**: an earlier attempt added
`view.setVisible(false)` to `menu-overlay-manager.js`'s `hide()` (alongside its
existing `removeChildView`), reasoning that the view's tracked `visible` flag
had desynced from reality and needed an explicit false→true toggle to force a
real `WasShown`. The operator re-tested against the live app and the sheet was
**still stuck hidden** — the FD's second live diagnosis pass then proved the
mechanism is the same-tick resize-then-remove sequence itself, not a stale
`setVisible` flag, and reverted that change entirely.

**Fix** (`register-tab-ipc.js`'s `tab-set-active` handler): reorder, not a view
API change. On a genuine tab SWITCH, `closeMenuOverlay('tab-switch')` now runs
**before** `syncBounds` — so `hide()`'s `removeChildView` never follows a
same-tick resize of a still-visible sheet. The same-tab re-activation branch
(`isMenuOpen()` → `show()`) is unchanged: `syncBounds` then `show()`, in that
order, since that path never closes the menu and can't hit this mechanism.
Both live diagnosis passes (FD's live repro at the top of Corrective Action,
tested with the reorder placed both at the top of the `if (entry)` block and
immediately before the old `syncBounds` line) confirmed the fix. Checked the
same resize-then-remove-in-one-tick shape at every other sheet-touching call
site in the file: `tab-set-bounds` only ever calls `syncBounds` on the sheet,
never `closeMenuOverlay`/`hide` — no resize-then-remove shape, no fix needed.
`tab-hide` and `tab-close` both call `closeMenuOverlay` but neither is preceded
by a sheet `syncBounds` call in the same handler — no resize-then-remove shape
either. `moveTabIntoWindow`'s own `target.sheet?.closeMenuOverlay('tab-switch')`
call (the cross-window move's synchronous target-side close) is likewise never
preceded by a `target.sheet?.syncBounds` call anywhere in that function — clear
as well. `tab-set-active` was the only site with the shape.

## Verification

**Unit test** (`test/unit/register-tab-ipc.test.js`): two new tests using the
suite's existing fake `sheet`/`log` scaffolding. "squawk 0100: a tab SWITCH
closes the menu BEFORE syncBounds (never the reverse)" activates a different
tab and asserts the `close-menu` log entry's index precedes `sync-menu`'s, and
that `show-menu` never fires on a switch. "squawk 0100: same-tab re-activation
with a menu open keeps syncBounds THEN show() (unchanged order)" re-activates
the SAME tab with `isMenuOpen()` stubbed true and asserts `sync-menu` precedes
`show-menu`, with `close-menu` never firing — pinning that the same-tab branch
was left untouched.

**Neuter check**: swapped `tab-set-active`'s `syncBounds`/`closeMenuOverlay`
calls back to the old (pre-fix) resize-then-close order, re-ran the suite —
exactly the new switch-order test went red (`not ok`); the new same-tab-order
test and all other 91 tests in the file stayed green (order-insensitive to this
one swap, as expected). Restored the fix; full 93/93 green again.

Full project gates run clean after this fix (see the flight log entry for the
exact `npm test` / `npm run lint` / `npm run typecheck` / `npm run format:check`
results).

**Live verification: PASS** (operator, Mission 21 Flight 4 HAT step 8, 2026-09-22).
With the reorder, the exact repro (tab → kebab → Secrets → Unlock → switch back) was
run, plus a repeat in the same window and the Settings-page variant. The kebab and
right-click menus paint every time.

## Sign-Off

**Reviewer**: HAT-fix Reviewer (agent); operator live HAT
**Verdict**: confirmed
**Commit**: branch `flight/04-in-field-affordance` (Mission 21 Flight 4, PR #230); see that branch's HAT commit

## Disposition

Deferred — out of Mission 21 Flight 3's path; the HAT continues in a new window.

**Re-deferred (M21 F4, 2026-09-21):** two automation diagnosis passes could not reproduce it.
The kebab and page-context sheets are unobservable to automation by design, and the
instrumented bounds/viewport chain was healthy. Operator ruling: reproduce by hand at
Mission 21 Flight 4's HAT (see that flight's log).
