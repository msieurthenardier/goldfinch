# Leg: L2 — keyboard-cycling-rearm

**Status**: completed
**Flight**: [HAT & Alignment](../flight.md)

## Objective

Fix the HAT bug (T3): with focus in **page content**, the first `Ctrl+<n>` jump works but subsequent
tab-cycling/jump chords do nothing until a tab is clicked — because activation never re-focuses the
newly-active guest, orphaning OS keyboard focus.

## Context

Risk: **HIGH** — keyboard-focus lifecycle across `WebContentsView`s; a wrong fix regresses tab-strip
keyboard navigation. Per `/agentic-workflow` 2a, design review.

**Root cause (recon):** `ipcMain.on('tab-set-active', …)` (`main.js:~3083`) makes the incoming guest
visible + top-of-stack (`setVisible(true)`, `addChildView`, `:3099–3106`) and hides the outgoing
(`setVisible(false)`, `:3153`) but **never calls `entry.view.webContents.focus()`**. So after a
guest-focused jump, the old focused guest is hidden and the new one is unfocused → OS key events reach no
guest's `before-input-event` → subsequent chords are dropped. The first chord only worked because the old
guest still held focus. `before-input-event` IS wired per guest at creation (`wireGuestContents`
`main.js:1536/1574`, called at `:2618`) — the listener is not the gap; **focus is.**

**The fix must be CONDITIONAL** — focusing the incoming guest on *every* activation would steal focus from
tab-strip keyboard nav (AC5, `main.js:3118–3120`).

**Design-review mechanism (main-only `isFocused()`, not a plumbed flag).** The review found the
renderer-flag approach fragile (`onChromeShortcutAction` is NOT guest-only — the sheet accelerator
`main.js:472` and cross-view-nav also feed it; and a main-side flag at the forward site goes stale on
no-op/out-of-range jumps). The clean signal is already available in `tab-set-active`: **read whether the
OUTGOING active guest holds OS focus** (`getTabContents(owner.activeTabWcId)?.webContents.isFocused()`)
BEFORE the visibility swap, and focus the incoming guest **iff the outgoing was focused**. This captures
"focus was in the page" exactly:
- page-content chord → outgoing guest focused → **focus incoming** (bug fixed);
- strip arrow/Enter nav or mouse-on-strip → chrome focused, outgoing guest not focused → **don't** (AC5 preserved);
- find overlay focused → outgoing guest not focused → **don't** (find preserved, no extra guard needed);
- sheet open → sheet focused → **don't**.

**Zero renderer/preload/`renderer-globals.d.ts` surface** (renderer budget → +0); self-correcting on no-op
jumps; inherently find-safe. The focus-then-act pattern is established (`page-context-correct`
`main.js:3360`; cross-view `:1467`). **The one caveat — WSLg `isFocused()` reliability** (the repo flags
WSLg focus-*event* quirks at `main.js:306`, but that's events, not `isFocused()` *queries*): confirm in the
live verification pass. **Fallback:** if the live pass shows the query unreliable, revert to the plumbed
`focusGuest` flag (with an `isSessionActive(wcId)` find guard). Record the choice + rationale.

## Acceptance Criteria

- [ ] **AC1 — activation re-focuses the incoming guest iff the outgoing guest held OS focus.** In
      `tab-set-active`, capture `wasPageFocused = getTabContents(owner.activeTabWcId)?.webContents.isFocused()`
      **before** the visibility swap; after making the incoming guest visible+top, if `wasPageFocused` and
      `!entry.view.webContents.isDestroyed()`, `entry.view.webContents.focus()`. Never focus when the
      outgoing wasn't page-focused (preserves AC5 strip nav, find, sheet). **Internal/trusted incoming tabs
      are focused too** (deliberate — cycling *into* a `goldfinch://` page must not re-orphan focus).
- [ ] **AC2 — main-only; no renderer/preload change.** The fix lives entirely in `main.js`
      `tab-set-active`; no `activateTab`/`tabSetActive`/preload/`renderer-globals.d.ts` change (the
      `isFocused()` signal removes the flag plumbing). `typecheck` green.
- [ ] **AC3 — the bug is fixed, verified live in the F10 verification pass.** From page-content focus,
      **two consecutive** `Ctrl+<n>` jumps (and `Ctrl+Tab`) both work with **no intervening click**. This is
      the MANUAL HAT reading (real OS focus). Pin code shape here: a masked scan that `tab-set-active` reads
      the outgoing guest's `isFocused()` and conditionally focuses the incoming.
- [ ] **AC4 — regression net asserts the REAL observable (design-review fix).** The MCP `pressKey` injects
      via `sendInputEvent`-by-wcId, which **bypasses OS focus routing** — so a "two-chords-no-click" step
      would pass whether or not the bug is fixed (it forwards regardless). Instead, the automated
      `tab-cycling` net must assert **the incoming guest holds OS focus after a guest-forwarded chord**:
      `evaluate(incoming, "document.hasFocus()") === true` (the same `hasFocus()` technique the spec's Steps
      4/5 already use on the *outgoing* guest). The two-chords-no-click framing lives in AC3's MANUAL pass
      (only real OS focus exercises it). `chrome-guest-keyboard-nav.md` (DD13 focus-handoff) still holds.
- [ ] **AC5 — gates green** (`npm test` delta, `lint`, `typecheck` — standalone).

## Files Affected
- `src/main/main.js` — `tab-set-active` (`:3083`): capture outgoing `isFocused()` + conditional incoming
  `focus()`. **Main-only** — no renderer/preload change.
- `tests/behavior/tab-cycling.md` — the incoming-guest `hasFocus()` assertion after a guest-forwarded chord (AC4).
- A `main.js` source-scan test for the code-shape pin (AC3).

## Line Budget (DD11 — code lines)
- `main.js`: **≤ +8** (est. ~4). `renderer.js`: **+0**. Exceed ⇒ stop and report.

---
## Post-Completion Checklist
- [x] ACs verified (AC3 runtime deferred to the verification pass, stated honestly): AC1/AC2 main-only
      `isFocused()`→conditional `focus()` in `tab-set-active`, +4 code lines, no renderer/preload change,
      typecheck green; AC3 code-shape pinned by `test/unit/keyboard-rearm.test.js` (both mutation
      directions), runtime = manual HAT pass; AC4 `tab-cycling.md` Step 4 asserts incoming-guest
      `hasFocus()`; AC5 gates green (test 1953 / lint / typecheck).
- [x] flight-log leg entry; leg status `completed`; flight.md leg checked
- [ ] Do NOT commit (flight-end review + single commit)
