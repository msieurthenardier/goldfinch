# Squawk 0057: Kebab menu unclickable on the new-install homepage/search-engine setup page until set and a new page loads

**Status**: completed
**Type**: defect
**Severity**: routine
**Completed**: 2026-09-02
**Reported**: 2026-09-01

## Report

Operator-observed on a fresh profile (new install, dev profile restored
2026-09-01 during Mission 18 Flight 2 leg-5 setup): on the initial
set-homepage / set-search-engine page shown to new installs, the chrome
kebab menu does not respond to clicks. It becomes clickable only after
the choices are set and a new page has loaded. Expected: the kebab (and
chrome controls generally) are operable regardless of the welcome
surface's state.

Likely neighborhood: the welcome/first-run surface and its interaction
with chrome menu dispatch (see `welcome-controller.js` and the chrome
menu wiring); fix approach expected to be a focus/enable-state or
overlay/pointer-events issue — discoverable in one read pass.

## Evidence

- Operator reproduction, 2026-09-01, dev profile fresh install (WSLg).
  Kebab unresponsive on the welcome/setup surface; responsive after
  setting values and navigating.
- Not investigated further mid-flight (logged from Flight 2 leg-5 setup;
  deferred per the mid-flight squawk protocol).

## Corrective Action

**Root cause** — not focus, pointer-events, or dispatch gating: the menu
sheet (the per-window WebContentsView every chrome dropdown renders on)
had no bounds to open at. The causal chain, in one line per link:

1. On a fresh install the window's only tab is a *viewless* welcome
   record — no guest WebContentsView exists.
2. The chrome sends geometry only for tabs with a live `wcId`
   (`src/renderer/chrome/tab-controller.js:1042`), and main's
   `tab-set-bounds` handler drops anything without a live guest entry
   (`src/main/register-tab-ipc.js:1047-1048`) — so no bounds ever reach
   the sheet manager (`lastGuestBounds` stays null,
   `src/main/menu-overlay-manager.js:154`).
3. A kebab click did fire and did reach main; `menu-overlay:open`
   resolved the sheet bounds from the active guest view — null for a
   viewless tab (pre-fix `src/main/register-overlay-ipc.js`, the
   `activeEntry` resolve).
4. `show()` sets sheet bounds only when it has some
   (`src/main/menu-overlay-manager.js:285`), so the sheet attached at a
   WebContentsView's default zero bounds — the menu opened invisible and
   unhittable. Every click just toggled an invisible zero-size sheet, so
   the kebab (and the ▾ container picker and site-info chip — all
   overlay menus) appeared dead.
5. First real page load attaches a guest → bounds sync → menus work,
   matching the reported recovery.

**Fix** — ride the chrome-measured `#webviews` slot rect on every menu
open as a viewless-tab fallback; the live guest bounds stay
authoritative when a guest exists:

- `src/renderer/chrome/overlay-menus.js:60,70` — `createOverlayMenus`
  gains an optional `measureSlot` dep; `open()` adds
  `slotBounds: measureSlot()` to the channel-1 payload (after the
  options spread, so an options bag can never smuggle a forged rect).
- `src/renderer/renderer.js:509` — injects the existing
  `measureWebviewsSlotDIP` (the same measurer `tabSetBounds`/
  `tabSetActive` already trust for guest geometry — no new authority).
- `src/main/register-overlay-ipc.js:36-43` (`sanitizeSlotBounds`:
  finite-number shape check, tab-set-bounds-style rounding, degenerate
  rects rejected) and `:130-140` — `menu-overlay:open` prefers live
  guest bounds, falls back to the sanitized `slotBounds`, and strips the
  transport-only field before forwarding, keeping the sheet's
  `MenuOpenPayload` contract unchanged.
- `test/unit/seam-contract.test.js:164-168` — deliberate +1
  `RENDERER_LINE_BUDGET` bump (1835 → 1836) for the one dep line,
  documented per the file's own findTabByWcId one-dep-line precedent.

**Confinement** — one coherent defect (sheet placement when no guest
view has ever existed); no design decision: the sheet's bounds contract
("identity with the guest region", F8 DD12) is unchanged — the fallback
supplies the *same* region from the chrome's existing measurement when
no guest view can be measured, over the same sender-identity-checked
channel. No welcome-surface, focus, or chrome-layout behavior touched.

## Verification

- Regression tests at the layer that would have caught it
  (`test/unit/register-overlay-ipc.test.js:729-814`, "Squawk 0057"
  block): (1) viewless active tab → menu opens on the rounded
  slotBounds fallback and the forwarded payload carries no `slotBounds`;
  (2) live guest bounds win over a payload slotBounds; (3) malformed /
  degenerate slotBounds (non-object, non-finite, missing member,
  zero/negative size) resolve to null bounds, never a bogus rect.
- Chrome-side contract test (`test/unit/overlay-menus.test.js:204-255`):
  `open()` rides `measureSlot()` as `slotBounds`, the measurement
  overrides any options-bag value, and an un-injected client keeps the
  historical payload shape (no `slotBounds` key).
- Full battery: **4135 pass, 0 fail** (baseline 4131 + these 4);
  `npm run typecheck`, `npm run lint`, `npm run format:check` all clean
  (2026-09-02, alongside the batch's uncommitted 0058/0059 work).
- Live reproduction not run: the dev profile has welcome completed, and
  re-triggering requires a profile with no guest-bounds history in a
  fresh window — unit-level reproduction against the real
  `menu-overlay:open` handler and `createOverlayMenus` exercises the
  exact failing resolve (null active-guest bounds) and its fix.

## Sign-Off

**Reviewer**: independent batch Reviewer (squawk turnaround 2026-09-02, scoped to the diff)
**Verdict**: confirmed — root-cause chain (viewless welcome tab → no guest bounds → zero-bounds sheet) proven link by link against tab-controller/register-tab-ipc/menu-overlay-manager; sanitized slotBounds fallback subordinate to authoritative guest bounds, transport field stripped; budget bump documented; regression netted by 4 tests against the real handler.
**Commit**: `squawk/turnaround-2026-09-02` (via its PR)
