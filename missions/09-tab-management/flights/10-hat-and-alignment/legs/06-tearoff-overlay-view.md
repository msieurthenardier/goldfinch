# Leg: L4-rebuild — tearoff-overlay-view

**Status**: completed
**Flight**: [HAT & Alignment](../flight.md)

## Objective

Rebuild L4's tear-off "release to open in a new window" pill as an always-on-top overlay
`WebContentsView` (the find/menu-overlay pattern) so it renders **over the guest page** and follows the
cursor anywhere — fixing the operator's L4 bug (a chrome-DOM element is occluded by the guest's native
view once the drag leaves the strip band).

## Context

Risk: **HIGH** — a new per-window native `WebContentsView` with a show/hide/position lifecycle; the
F6/F7 **leak class** applies (every per-window view must be destroyed at `close`). Supersedes the broken
chrome-DOM ghost committed in `589989c`. Recon mapped the exact pattern to mirror (`find-overlay-manager.js`).

**Why chrome-DOM failed:** the guest page is a separate native `WebContentsView` stacked above the
chrome's content area, so a chrome-DOM element can only paint in the strip band. An overlay view added
*after* the guest via `addChildView` sits **above** it (main.js:203-206) — the find/menu mechanism.

**Precise anchors (recon):**
- `createOverlayView` (`main.js:399-413`) — the `WebContentsView` construction (transparent bg,
  `loadFile`). Mirror as `createTearoffOverlayView()` **without any preload** and **without focus** (the
  pill is pure paint — this is the one place it MUST diverge from find/menu, which focus deliberately).
- `find-overlay-manager.js` — the lifecycle template: `ensureView()` (lazy, destroyed-recreate guard),
  `show()` (`ensureView` → `setBounds` → `addChildView` raises → `setVisible(true)`), `hide()`
  (visibility-gated `removeChildView`), `syncBounds()` (store always, apply while visible), `teardown()`.
- Per-window wiring (`createWindow` ~`main.js:1187`), `record.tearoffOverlay` (~`:1230`), **teardown in
  `win.on('close')` (~`:1247`) + null-out `rec.tearoffOverlay = null` (~`:1261`)** — the sole destruction site.
- Per-move positioning: `tab-set-bounds` (`main.js:3203`) is the fire-and-forget renderer→main bounds
  precedent; coordinate space is **1:1** (`e.clientX/clientY` DIP → overlay `setBounds`); **rAF-coalesce**
  the sends (mirror `sendActiveBounds`, `renderer.js:1933`).
- Renderer hooks to REPLACE: `trackTearoffGhost` (`renderer.js:1480`), `clearTearoffGhost` (`:1492`), wired
  from the tearOff-enter (`:1602`) / tearOff-leave (`:1608`) / `clearDragVisuals` (`:1462`, hit by
  pointerup/cancel `:1566/:1622`). Remove the `.tearoff-ghost` CSS (`styles.css:364-376`).

## Acceptance Criteria

- [ ] **AC1 — a per-window tear-off overlay view exists and layers ABOVE the guest.** New
      `src/main/tearoff-overlay-manager.js` (copy `find-overlay-manager.js`'s lifecycle, drop the
      find-session state machine; add `setPosition(x,y)` → pill-anchored `setBounds`). `createTearoffOverlayView()`
      beside `createOverlayView` — **no preload, transparent bg, tiny size** (~260×28 DIP, just the pill).
      `show()` raises it via `addChildView` after the guest so it renders over page content.
- [ ] **AC2 — it follows the cursor during a tear-off drag, over the page.** Three fire-and-forget IPC
      channels (`tearoff-overlay:show`/`:move`/`:hide`, chrome-origin, sender's record resolved), bridged in
      `chrome-preload.js` (beside `tabSetBounds`). Renderer: on tearOff-arm send show+position; on each
      pointermove while torn-off send move (**rAF-coalesced** — at most one IPC/frame); on tearOff-leave /
      pointerup / every cancel send hide. `trackTearoffGhost`/`clearTearoffGhost` rewritten to emit these;
      the `.tearoff-ghost` chrome-DOM element + its CSS are **removed**.
- [ ] **AC3 — NO focus-steal, NO input interception.** The pill view has **no preload**, `webContents.focus()`
      is **never** called on it, its HTML body is `pointer-events: none`, and the view is sized to the pill
      only (can't cover/intercept the guest). Verify tab-strip keyboard nav + page interaction are unaffected
      during and after a drag.
- [ ] **AC4 — NO leak (the F6/F7 class).** The overlay is destroyed in `win.on('close')` (`teardown()` +
      `rec.tearoffOverlay = null`), the SOLE destruction site; a transient show/hide many times per session
      reuses one lazy view and never leaks. **Two readings** (masked source-scan): `tearoffOverlay.teardown`
      appears in the `close` handler; mutate it away → the scan fails. Also: `enumerateTabs` is unaffected
      (the overlay wc never enters `tabViews` — mirror the `createOverlayView` exclusion).
- [ ] **AC5 — z-order robustness (optional per recon).** A tab activation mid-drag is rare, but if cheap,
      re-assert the tearoff overlay after the sheet block in `tab-set-active` (`main.js:~3184`) gated on
      `owner.tearoffOverlay?.isVisible()`. If not done, note it as an accepted rare edge.
- [ ] **AC6 — gates green** (`npm test` delta, `lint`, `typecheck` — standalone). The visual (pill follows
      the cursor over the page, disappears on release/cancel) is the operator's re-verify. Pin code shape:
      the overlay is created/torn-down/positioned per the ACs (masked scans).

## Files Affected
- `src/main/tearoff-overlay-manager.js` (new). `src/main/main.js` (`createTearoffOverlayView`, wiring,
  teardown, 3 IPC handlers). `src/preload/chrome-preload.js` (3 bridge methods).
- `src/renderer/renderer.js` (`trackTearoffGhost`/`clearTearoffGhost` → IPC, rAF-coalesce).
- `src/renderer/tearoff-overlay.html` (new; or a `data:` URL). `src/renderer/styles.css` (remove `.tearoff-ghost`).
- A `main.js` source-scan test for the teardown/no-leak + creation pins (AC4).

## Line Budget (DD11 — code lines)
- `tearoff-overlay-manager.js`: **≤ 90** (it's a trimmed find-overlay-manager). `main.js`: **≤ +30**.
  `renderer.js`: **≤ +15**. `chrome-preload.js`: **≤ +6**. Exceed ⇒ stop and report.

---
## Post-Completion Checklist
- [ ] ACs verified (visual = operator re-verify, stated); no-leak pinned
- [ ] flight-log leg entry; leg status `completed`; flight.md leg checked (supersedes the L4 ghost)
- [ ] Do NOT commit (flight-end review + single commit)
