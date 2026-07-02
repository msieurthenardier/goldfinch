# Leg: scaffold-overlay

**Status**: completed
**Flight**: [Floating Overlay Find Bar](../flight.md)

## Objective

Create the find-overlay surface (page + preload + CSS) and the main-process overlay-view lifecycle —
lazy creation, positioning in the guest-bounds path, z-order re-assert on tab switch, removal on
internal tabs / freeze / teardown — proven with a static (non-wired) bar UI behind a temporary dev
trigger. **No find routing** (that is Leg 2).

## Context

- **DD1**: dedicated overlay `WebContentsView` hosting the find UI; `addChildView` after the guest
  z-orders it above (spike-proven). Chrome-class trust domain (`file://`, mirrors `chrome-preload.js`).
  Lazy creation on first show; reused via show/hide + add/removeChildView, never churned per open.
- **DD2**: position-sync lives in main's guest-bounds path — the `tab-set-active` and `tab-set-bounds`
  handlers. Invariant: on `tab-set-active`, re-add the overlay **after** the guest re-add, or the guest
  buries it. Bounds arriving from the renderer are already DIP.
- **DD5**: menu freeze hides the guest via the renderer's `freezeGuest()` → `tabHide(t.wcId)`; the
  overlay must come out of the stack then. Restore rides `unfreezeGuest()` → `tabSetActive(...)` → the
  `tab-set-active` re-add. No separate restore mechanism.
- **DD7**: on internal `goldfinch://` tabs the overlay is `removeChildView`'d (presence-gated), NOT
  `setVisible(false)` — a hidden-but-present sibling still occupies the compositing stack.
- **DD1 teardown**: remove on last-web-tab-close / all-internal; destroy the overlay `webContents` on
  window `closed` (mirrors the `chromeView` cleanup).
- Key recon facts (2026-07-01, re-verified at leg design): internal tabs ALSO ride `tab-set-active`
  (`src/renderer/renderer.js:856` — "All tabs (web + internal)"), and main can gate DD7 by
  `entry.trusted` (`src/main/main.js:1418` — `tabViews.set(wcId, { view, partition, trusted, active })`).
  The overlay's webContents never enters `tabViews`, so automation `enumerateTabs` (which reads
  `tabViews` via the engine deps) is unaffected — the overlay is not MCP-enumerable by construction.
- Deferred to Leg 2: DD3 (count path B), DD4 (IPC channel set), DD6 (focus), real open/close semantics.
  Deferred to Leg 3: DD8 (inset removal), DD11 (`#find-bar` retirement). This leg leaves the existing
  inset find bar fully functional and unchanged.

## Inputs

- Branch `flight/07-find-overlay-view` (off `mission/05-webcontentsview-migration`), post-Flight-4 code.
- `src/main/main.js` — `chromeView` construction pattern (`main.js:411-425`), `mainWindow.on('closed')`
  (`main.js:441-444`), `tab-set-active` (`main.js:1473`), `tab-set-bounds` (`main.js:1500`), `tab-close`
  (`main.js:1434`), `tab-hide` (`main.js:1445`).
- `src/renderer/index.html:135-148` — `#find-bar` markup to mirror (NOT removed this leg).
- `src/renderer/styles.css:556-608` — `#find-bar` CSS blocks to adapt (NOT removed this leg; the
  section ends at `:608` — the flight's DD11 range `556-606` under-counts by two lines, corrected
  here so the Leg-3 removal doesn't leave a dangling tail).
- `eslint.config.mjs` — per-file preload globs (no `src/preload/**` catch-all; new preload must be
  added explicitly).
- `src/preload/chrome-preload.js` — preload pattern to mirror.

## Outputs

- New: `src/renderer/find-overlay.html`, `src/renderer/find-overlay.css`, `src/renderer/find-overlay.js`,
  `src/preload/find-overlay-preload.js`, `src/main/find-overlay-geometry.js`,
  `test/unit/find-overlay-geometry.test.js`.
- Modified: `src/main/main.js` (overlay module state + helpers + four handler touches + closed-cleanup).
- Behavior: with `GOLDFINCH_FIND_OVERLAY_DEV=1`, a static find bar floats top-right over the active web
  guest and tracks geometry; without the env var, zero behavior change.

## Acceptance Criteria

- [x] **AC1 — Overlay surface exists.** `src/renderer/find-overlay.html` renders the find-bar controls
  mirroring `#find-bar` (`index.html:135-148`): search input, count `role="status"`
  `aria-live="polite"` `aria-atomic="true"`, prev/next/close buttons with `aria-label`s, container
  `role="search"` (DD12 carry-over). `find-overlay.css` adapts the `styles.css:556-606` blocks;
  `find-overlay.js` may be minimal (controls inert this leg); `find-overlay-preload.js` exposes a
  minimal `window.findOverlay` stub via `contextBridge` (channels come in Leg 2).
- [x] **AC2 — Lazy singleton view.** Main creates the overlay `WebContentsView` at most once
  (module-level `overlayView`, created on first show), with chrome-class webPreferences
  (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`, preload =
  `find-overlay-preload.js`), loading `find-overlay.html` via `loadFile`. Show =
  `addChildView` + `setVisible(true)`; hide = `removeChildView` (never `setVisible(false)`-only —
  DD7: a hidden-but-present sibling still occupies the compositing stack). The view is never
  destroyed except at window `closed`.
- [x] **AC3 — Stacks and tracks.** With the dev trigger on and a web tab active: the overlay is added
  **after** the guest add in `tab-set-active` (`main.js:1486`) so it sits above; it repositions to the
  top-right strip of the guest bounds on `tab-set-bounds`; resize/maximize/panel-toggle keep it anchored
  (these all reach `tab-set-bounds` via `sendActiveBounds`/ResizeObserver/`trigger-send-bounds`).
- [x] **AC4 — Internal tabs presence-gated (DD7).** Activating an internal tab (`entry.trusted`)
  `removeChildView`s the overlay (not `setVisible(false)`). Switching back to a web tab restores it.
- [x] **AC5 — Freeze/unfreeze (DD5).** `tab-hide` of the active tab (the freeze path,
  `renderer.js:1068`) removes the overlay; unfreeze (`renderer.js:1085` → `tabSetActive`) restores it
  via the `tab-set-active` re-add. No overlay artifact while a chrome menu (kebab / container /
  site-info / page context) is open over a web tab.
- [x] **AC6 — Teardown.** Closing the last web tab (or all-web-tabs-closed with internal remaining)
  removes the overlay from the stack; window `closed` destroys the overlay webContents and nulls
  `overlayView` (alongside the existing `chromeView` null-out at `main.js:441-444`).
- [x] **AC7 — Zero regression without the trigger.** With `GOLDFINCH_FIND_OVERLAY_DEV` unset, no
  overlay view is ever created; Ctrl+F still opens the existing inset `#find-bar` exactly as before.
- [x] **AC8 — Geometry helper unit-tested.** `computeFindOverlayBounds(guestBounds)` lives in
  `src/main/find-overlay-geometry.js` (pure, no Electron imports) with a `node --test` unit test
  covering: normal anchor (top-right, margins), narrow-guest clamp (width ≤ guest width, x ≥ guest x),
  and integer (rounded) output. Vertical overhang on a guest shorter than ~56 DIP is a documented
  non-goal (unreachable at the window's `minHeight: 600`) — assert current behavior in a fourth test
  case rather than adding a clamp.
- [x] **AC9 — Gates green.** `npm test`, `npm run typecheck`, `npm run lint` all pass.

## Verification Steps

- AC1: open the four new files; check markup/attribute presence (grep `role="search"`, `aria-live`).
- AC2: grep `new WebContentsView` in `main.js` — the overlay construction must be inside the lazy
  `ensureFindOverlayView()` (or equivalent) only; confirm `loadFile` + webPreferences shape.
- AC3–AC6 (live): `GOLDFINCH_FIND_OVERLAY_DEV=1 npm run dev:automation` with
  `GOLDFINCH_AUTOMATION_DEV_MINT=1` and a pinned free `GOLDFINCH_MCP_PORT`; browse a web page, then:
  switch to `goldfinch://settings` and back; open/close the kebab menu; toggle the media panel; resize.
  Confirm via `captureWindow` through the loopback MCP that the bar composites over the guest and
  vanishes on the internal tab / during the menu.
  **Known apparatus caveat** (flight log): the WSLg *fallback* capture path does not composite
  overlay views — if `captureWindow` provably takes that path, record the pixel checks as
  deferred-to-HAT (Leg 4 covers them on-screen) and verify the structural behavior instead (no crash,
  no error, existing `#find-bar` inset behavior intact).
- AC7: unset the env var, run, Ctrl+F on a web page → inset bar opens as today.
- **Expected co-existence (not a defect)**: with the dev trigger ON, Ctrl+F still opens the inset
  `#find-bar` while the static overlay is also visible — the double bar is expected this leg, and the
  overlay re-anchors when the inset pushes the guest down (inset changes guest bounds →
  `tab-set-bounds`). Both go away at Leg 3's cutover / Leg 2's trigger removal respectively.
- AC8/AC9: `npm test && npm run typecheck && npm run lint`.

## Implementation Guidance

1. **Geometry helper (`src/main/find-overlay-geometry.js`)** — pure module:
   ```js
   const FIND_OVERLAY_WIDTH = 380;   // DIP; clamped to guest width
   const FIND_OVERLAY_HEIGHT = 48;   // bar + breathing room for shadow
   const FIND_OVERLAY_MARGIN_TOP = 8;
   const FIND_OVERLAY_MARGIN_RIGHT = 12;
   function computeFindOverlayBounds(guest) { /* top-right strip, rounded ints */ }
   module.exports = { computeFindOverlayBounds, FIND_OVERLAY_HEIGHT, ... };
   ```
   `x = guest.x + guest.width - width - MARGIN_RIGHT` clamped to `>= guest.x`;
   `width = min(FIND_OVERLAY_WIDTH, guest.width)`; `y = guest.y + MARGIN_TOP`. Mirrors the current CSS
   anchor (`top: 8px; right: 12px` — `styles.css:558-560`).

2. **Overlay page.** `find-overlay.html` — standalone document, same control set/IDs as `#find-bar`
   (`find-input`, `find-count`, `find-prev`, `find-next`, `find-close`), `role="search"`, aria
   attributes carried over verbatim (DD12). `find-overlay.css` — adapt `styles.css:556-606`: the bar
   fills the view (the *view* is the floating rect; drop `position:absolute/top/right/z-index`), keep
   the dark-theme tokens as literal values (the overlay doc doesn't load `styles.css`; copy the few
   `--bg-2`/`--border`/`--fg` values it needs). Transparent `body` background; attempt
   `overlayView.setBackgroundColor('#00000000')` for rounded corners — if WSLg renders it opaque,
   accept an opaque themed rect (flight "acceptable variation": theming refined at HAT).
   `find-overlay.js` — placeholder module (controls inert; Leg 2 wires them).

3. **Preload (`src/preload/find-overlay-preload.js`)** — mirror `chrome-preload.js` shape:
   `contextBridge.exposeInMainWorld('findOverlay', { platform: process.platform })` — nothing more
   this leg (DD4 channels land in Leg 2).

3b. **ESLint coverage (`eslint.config.mjs`)** — the config uses per-file preload globs (each existing
   preload is matched explicitly; there is NO `src/preload/**` catch-all). Add
   `src/preload/find-overlay-preload.js` to the node-globals block that already matches
   `src/preload/chrome-preload.js` — without this, the new file falls through to bare recommended
   config and `require`/`process`/`module` trip `no-undef` (AC9 fails). This grouping is part of the
   DD1 "chrome-class trust domain mirrors chrome-preload" contract — Leg 2 grows this preload with
   `ipcRenderer` channels and must keep it in the node-globals block, not move it to a
   browser-globals one.

4. **Main-process state + helpers (`src/main/main.js`)** — near the `chromeView` module state:
   ```js
   let overlayView = null;        // DD3 (Leg 2) reads this at event time — module-level is load-bearing
   let overlayVisible = false;    // tracks stack presence (removeChildView of a non-child is undefined)
   let lastGuestBounds = null;    // latest active-guest DIP bounds, for repositioning on show
   const FIND_OVERLAY_DEV = process.env.GOLDFINCH_FIND_OVERLAY_DEV === '1';
   function isFindOverlayActive() { return FIND_OVERLAY_DEV; }  // Leg-2 seam: real per-tab find state
   ```
   `ensureFindOverlayView()` — lazy-construct + `loadFile('src/renderer/find-overlay.html')`;
   `showFindOverlay()` — ensure, then `if (lastGuestBounds) setBounds(computeFindOverlayBounds(lastGuestBounds))`
   (guard required — the pure helper does not tolerate null; if no guest bounds have ever been seen,
   skip and let the next `tab-set-bounds` correct it), `mainWindow.contentView.addChildView(overlayView)`
   (re-add of an existing child raises it — the same idiom the guest re-add uses at `main.js:1484-1487`),
   `setVisible(true)`, `overlayVisible = true`;
   `hideFindOverlay()` — if present, `removeChildView`, `overlayVisible = false`.

5. **`tab-set-active` (`main.js:1473`)** — inside the `if (entry)` block, AFTER the guest
   `addChildView(entry.view)` at `main.js:1486`:
   ```js
   if (entry.trusted) hideFindOverlay();                       // DD7
   else if (isFindOverlayActive()) {
     if (bounds) lastGuestBounds = /* rounded bounds */;
     showFindOverlay();                                        // DD2 invariant: re-add after guest
   }
   ```
   (The handler currently rounds inline in the `setBounds` argument at `main.js:1478` — hoist the
   rounded object into a local so both the guest `setBounds` and `lastGuestBounds` use it.)

6. **`tab-set-bounds` (`main.js:1500`)** — after the guest `setBounds`: if `wcId === activeTabWcId`,
   update `lastGuestBounds`; if `overlayVisible`, `overlayView.setBounds(computeFindOverlayBounds(...))`.

7. **`tab-hide` (`main.js:1445`)** — at the top: `if (wcId === activeTabWcId) hideFindOverlay();`
   (covers the freeze path `renderer.js:1068` AND the pending-activation hide `renderer.js:862`).
   Restore needs no code here — unfreeze/late-activation both land in `tab-set-active` (step 5).

8. **`tab-close` (`main.js:1434`)** — capture `const wasActive = activeTabWcId === wcId` BEFORE the
   existing null-out at `main.js:1442` (`if (activeTabWcId === wcId) activeTabWcId = null;`) — one
   line lower and the comparison is always false (or simply branch inside that existing `if`). If
   `wasActive`, `hideFindOverlay()`; additionally, if no remaining entry has `trusted === false`,
   `hideFindOverlay()` (DD1 teardown: last web tab gone / all-internal).

9. **Window `closed` (`main.js:441-444`)** — alongside the existing null-outs:
   ```js
   if (overlayView && !overlayView.webContents.isDestroyed()) overlayView.webContents.destroy();
   overlayView = null; overlayVisible = false;
   ```

10. **Unit test (`test/unit/find-overlay-geometry.test.js`)** — `node --test` style matching the
    existing suite; cover the three AC8 cases.

## Edge Cases

- **Guest re-add raising above the overlay mid-session**: every `tab-set-active` re-adds the guest —
  the step-5 ordering (overlay re-add strictly after) is the invariant; do not "optimize" it away when
  the overlay is already visible.
- **`removeChildView` when not a child**: gate all removals on `overlayVisible` to keep the call
  well-defined.
- **`tab-set-active` without `bounds`**: fall back to the stored `lastGuestBounds`; if both are absent
  (no guest bounds ever seen), skip the `setBounds` — the next `tab-set-bounds` corrects it.
- **Narrow guest (< overlay width)**: clamp per AC8 — never let the overlay overhang the guest strip.
- **Overlay load failure** (`loadFile` rejects): `.catch` + `console.warn`, mirroring the
  `tab-create` loadURL pattern (`main.js:1428-1430`); the app must not crash.
- **DPR ≠ 1**: bounds are DIP end-to-end (renderer `getBoundingClientRect` is DIP; `setBounds` takes
  DIP) — no scaling math anywhere; on-screen confirmation at DPR≠1 is a HAT item, not this leg's.
- **No automation drift**: do NOT register the overlay in `tabViews`; nothing else needed —
  `enumerateTabs` reads `tabViews` only.

## Files Affected

- `src/renderer/find-overlay.html` — new: static overlay find-bar document
- `src/renderer/find-overlay.css` — new: adapted `#find-bar` styles
- `src/renderer/find-overlay.js` — new: placeholder page module
- `src/preload/find-overlay-preload.js` — new: minimal chrome-class preload stub
- `src/main/find-overlay-geometry.js` — new: pure bounds helper
- `test/unit/find-overlay-geometry.test.js` — new: AC8 unit test
- `src/main/main.js` — overlay state/helpers; touches in `tab-set-active`, `tab-set-bounds`,
  `tab-hide`, `tab-close`, window-`closed`
- `eslint.config.mjs` — add `find-overlay-preload.js` to the node-globals block (step 3b)

## Workaround Log

- **`GOLDFINCH_FIND_OVERLAY_DEV` env trigger**: temporary stand-in for real find-open state so this
  leg's lifecycle is exercisable without find routing. **Why**: DD4's open/close IPC belongs to Leg 2;
  wiring it partially here would split one contract across two legs. **Removed**: Leg 2 replaces
  `isFindOverlayActive()`'s body with real per-tab overlay-active state and deletes the env var.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`** (batch flight: review + commit are
deferred to flight end — do NOT commit, do NOT set `completed`):

- [x] All acceptance criteria verified (pixel checks ran for real — the capture apparatus took the
  primary desktopCapturer path, not the WSLg fallback; see flight log)
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header)

---

## Citation Audit

Verified against current code on `flight/07-find-overlay-view` at leg design time (2026-07-02):

- `src/main/main.js:411-425` chromeView construction — **OK**
- `src/main/main.js:429` `addChildView(chromeView)` — **OK**
- `src/main/main.js:441-444` `mainWindow.on('closed')` null-outs — **OK**
- `src/main/main.js:1418` `tabViews.set(wcId, { view, partition, trusted, active })` — **OK**
- `src/main/main.js:1428-1430` loadURL `.catch` pattern — **OK**
- `src/main/main.js:1434` `ipcMain.on('tab-close')` — **OK**
- `src/main/main.js:1445` `ipcMain.on('tab-hide')` — **OK**
- `src/main/main.js:1473` `ipcMain.on('tab-set-active')`; `:1486` guest re-add — **OK**
- `src/main/main.js:1500` `ipcMain.on('tab-set-bounds')` — **OK**
- `src/renderer/renderer.js:856` internal tabs also send `tabSetActive` — **OK**
- `src/renderer/renderer.js:862` pending-activation `tabHide` — **OK**
- `src/renderer/renderer.js:1068` freeze `tabHide(t.wcId)` — **OK**
- `src/renderer/renderer.js:1085` unfreeze `tabSetActive` restore — **OK**
- `src/renderer/index.html:135-148` `#find-bar` markup — **OK**
- `src/renderer/styles.css:556-608` `#find-bar` CSS (anchor at `:558-560`) — **drifted (repaired)**:
  the flight's DD11 cites `556-606`, but the section's final rule ends at `:608`
  (`#find-bar .icon-btn:focus-visible`); range corrected in this leg's Inputs.

15 citations verified (14 clean, 1 range repaired). Design review (2026-07-02, Developer agent,
approve-with-changes) re-verified all 15 against the working tree and surfaced the ESLint preload-glob
gap (step 3b) — all review issues incorporated.
