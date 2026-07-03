# Leg: scaffold-sheet

**Status**: completed
**Flight**: [Menu Overlay Sheet](../flight.md)

## Objective

Create the menu-overlay sheet surface (transparent page + preload + CSS) and the extracted
main-process sheet-lifecycle module (`src/main/menu-overlay-manager.js`) — lazy singleton, bounds
slaved to the active guest, z-order re-assert, teardown — proven by the **CP1 WSLg transparency
probe on pixels** behind a temporary dev gate (`GOLDFINCH_MENU_OVERLAY_DEV`). **No menu protocol, no
menu rendering, no chrome changes** (those are Legs 2–4). This leg is the flight's go/no-go gate:
if the probe fails, the flight diverts per DD2 (sized-to-menu fallback, operator options-review).

## Context

- **DD2 (flight)**: one lazy-singleton `WebContentsView` whose bounds always equal the active
  guest's bounds; page background fully transparent (`#00000000`, the F7-proven setting). **Gate**:
  the Leg-1 pixel probe — a guest-sized transparent sheet over a live guest must show the guest
  rendering through it on `captureWindow`'s OS-grab path. F7 proved transparency at find-bar scale
  on this exact compositing path (child view of `contentView`); F3's "transparent renders black"
  was a different mechanism (transparent *window* overlay). Full-guest scale is the residual unknown.
- **DD9 (flight)**: lifecycle parity with the find overlay — lazy singleton; show = `addChildView`
  **after** the guest (z-order invariant, F7 DD2); hide = `removeChildView`, never
  `setVisible(false)`-only (F7 DD7: a hidden-but-present sibling still occupies the compositing
  stack); `render-process-gone` teardown-and-rebuild; teardown on window `closed`. Geometry follows
  the active guest through the existing `tab-set-bounds`/`tab-set-active` paths.
- **DD7 (flight — opposite of find's DD7)**: internal `goldfinch://` tabs are **IN scope** — the
  sheet stacks above whichever view is active, web or internal. This leg's presence/geometry logic
  must NOT gate on `entry.trusted`.
- **DD8 (flight)**: the sheet never enters `tabViews` — invisible to `enumerateTabs`/automation by
  construction; addressable by probed wcId for test driving (F7 enumerable-vs-addressable rule).
  Chrome-class `webPreferences`. (The resolver-level `isTabViewWcId` admin-tier hardening is
  **Leg 2**, with the IPC channels.)
- **DD12 (flight)**: the sheet covers the **guest region only** — bounds identity with the active
  guest's bounds delivers this with no geometry math (unlike F7's top-right-strip helper).
- **Extraction from day one** (flight Technical Approach step 1): `main.js` is ~2,230 lines; the
  sheet lifecycle lives in an extracted `src/main/menu-overlay-manager.js`. Follow the codebase's
  established injected-dependency pattern (`src/main/automation/resolve.js` takes injected
  `fromId`; `createEngine` at `src/main/main.js:487` injects accessors) so the manager is
  **Electron-free and unit-testable**: main.js injects `getContentView` and `createSheetView`;
  Electron construction (webPreferences, `setBackgroundColor`, `loadFile`) stays in main.js's
  ~15-line `createSheetView`.
- **F7 pattern source**: the find-overlay scaffold (`src/main/main.js:186-341` — teardown, ensure,
  show/hide, module state) is the proven template. This leg replicates its shape through the
  manager module; it does NOT modify the find-overlay code.
- **Freeze machinery untouched this leg**: `freezeGuest` (`src/renderer/renderer.js:1008`),
  `unfreezeGuest` (`renderer.js:1030`), `capture-active-guest` (`main.js:1852`) all stay; old menus
  keep working exactly as today. Deletion is Leg 5.
- Deferred to Leg 2: DD4 channel set + sender validation, pending-init queue payloads, DD5
  find-bar hide/restore wiring, `closeMenuOverlay(reason)` close family, DD13 accelerator
  forwarding, DD8 resolver hardening. Deferred to Leg 6: the `menu-overlay` behavior spec run.

## Inputs

- Branch `flight/08-menu-overlay-sheet` (off `mission/05-webcontentsview-migration`), post-Flight-7
  code (find overlay shipped; freeze-frame menus still live).
- `src/main/main.js` — find-overlay lifecycle as template (`:186` `teardownFindOverlayView`, `:206`
  `ensureFindOverlayView`, `:217 — "overlayView = new WebContentsView({"`, `:241`
  `render-process-gone` listener, `:247 — "overlayView.setBackgroundColor('#00000000')"`, `:258`
  `showFindOverlay`, `:273` `hideFindOverlay`); handler touch points (`:1643` `tab-close`, `:1667`
  `tab-hide`, `:1699` `tab-set-active` with guest re-add at `:1716` and find z-order re-assert at
  `:1721`, `:1747` `tab-set-bounds` with `lastGuestBounds` update at `:1755-1756`); window `closed`
  (`:636-643`); guest `before-input-event` capture (`:743-805`, modifier gate at `:755`,
  `Ctrl+Shift+I` branch at `:797` as the chord-branch pattern) — the dev-stimulus hook point.
- `src/main/find-overlay-geometry.js` + `test/unit/find-overlay-geometry.test.js` — the
  Electron-free-module + `node --test` pattern.
- `src/preload/find-overlay-preload.js` / `src/preload/chrome-preload.js` — preload shape to mirror.
- `eslint.config.mjs:10 — "files: ['src/main/**', 'src/shared/**', 'src/preload/chrome-preload.js',
  'src/preload/find-overlay-preload.js', ...]"` — per-file preload globs; new preload must be added
  explicitly (F7 Leg-1 lesson, step 3b there).
- `src/shared/keydown-action.js:64 — "if (key === 'm') return 'toggle-panel'"` — Ctrl+M is taken
  (chrome-focused panel toggle); the dev stimulus must be **Ctrl+Shift+M** to avoid collision.
- `tests/behavior/menu-overlay.md` (draft) — step-1 liveness-fixture description this leg's fixture
  must satisfy (ticking seconds display; a link placed away from the top-right / bottom-left
  preferred; under `tests/behavior/fixtures/`).
- Apparatus: `npm run dev:automation` with `GOLDFINCH_AUTOMATION_DEV_MINT=1`
  `GOLDFINCH_AUTOMATION_ADMIN=1`, pinned free `GOLDFINCH_MCP_PORT`; loopback MCP tools
  (`captureWindow`, `enumerateTabs`, `getChromeTarget`, `openTab`, `navigate`, **`pressKey`**).
  `pressKey` against the guest wcId is the **canonical stimulus driver** for the live steps: it
  delivers via `sendInputEvent` to the guest webContents, firing `before-input-event` regardless of
  OS focus — this sidesteps the dev-mode focus trap (once the sheet is shown, it covers the guest
  region, so a page click focuses the *sheet*, where no key handler exists, and chrome ignores
  Ctrl+Shift+M; an OS-keyboard-only flow would strand the toggle after any chrome interaction).
  Verify `pressKey`-fires-`before-input-event` once at the canary step. Fixtures are served
  the a11y way: `python3 -m http.server <port> --directory tests/behavior/fixtures/<name>`
  (`scripts/a11y-audit.mjs:42-43`).

## Outputs

- New: `src/main/menu-overlay-manager.js`, `src/renderer/menu-overlay.html`,
  `src/renderer/menu-overlay.css`, `src/renderer/menu-overlay.js`,
  `src/preload/menu-overlay-preload.js`, `test/unit/menu-overlay-manager.test.js`,
  `tests/behavior/fixtures/menu-overlay/index.html`.
- Modified: `src/main/main.js` (manager wiring + `createSheetView` + dev-stimulus branch + four
  handler touches + `closed` teardown), `eslint.config.mjs` (preload glob).
- Behavior: with `GOLDFINCH_MENU_OVERLAY_DEV=1`, Ctrl+Shift+M (guest-focused) toggles a transparent
  full-guest sheet above the live guest that tracks geometry and shows a small probe badge; without
  the env var, zero behavior change. **CP1 verdict recorded in the flight log with pixel evidence.**

## Acceptance Criteria

- [x] **AC1 — CP1 transparency probe passes on pixels (GATE).** With the dev gate on and a web tab
  showing the ticking fixture: after confirming the OS-grab capture path (see Verification), toggle
  the sheet on and take two `captureWindow` grabs ~2s apart. All three hold: (a) the probe badge is
  visible (sheet present and top-of-stack); (b) the fixture's ticking region is legible through the
  sheet and **differs between the two grabs** (guest live and visible through the transparency —
  no black/opaque wash, no frozen still); (c) the guest renders full-height with no push-down or
  strip artifacts. Verdict + evidence paths recorded in the flight log. **On failure: stop; signal
  `[BLOCKED:cp1-probe-failed]` — flight diverts per DD2. Do not improvise a fallback.**
- [x] **AC2 — Extracted, Electron-free manager.** `src/main/menu-overlay-manager.js` exports
  `createMenuOverlayManager(deps)` with **no `require('electron')`**; main.js injects
  `{ getContentView, createSheetView }`. The manager owns the singleton state machine:
  lazy creation on first show, destroyed-recreate guard, `did-finish-load` readiness flag,
  `render-process-gone` self-teardown, `show()` = add-after-guest + `setVisible(true)`, `hide()` =
  `removeChildView` gated on visibility (never `setVisible(false)`-only), `syncBounds(rounded)`
  storing the latest active-guest DIP bounds and applying them 1:1 while visible, `teardown()`
  destroying the webContents and resetting all state. Two explicit contracts (design-review):
  `show()` **never focuses** the sheet's webContents in this leg (the guest must keep focus — the
  keyboard toggle-off and Leg-1 semantics depend on it; real focus handling arrives with Leg 2's
  protocol), and `show()` is a **state-preserving no-op** when `getContentView()` returns null
  (F7 parity — `showFindOverlay` early-returns on `!mainWindow` before mutating state,
  `main.js:259-261`; `visible` must NOT flip).
- [x] **AC3 — Chrome-class sheet construction in main.js.** `createSheetView()` builds the
  `WebContentsView` with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`,
  preload = `menu-overlay-preload.js`; calls `setBackgroundColor('#00000000')`; `loadFile`s
  `menu-overlay.html` (with `{ query: { probe: '1' } }` only when the dev gate is on); `.catch` +
  `console.warn` on load failure. The sheet's webContents is **never** added to `tabViews`.
- [x] **AC4 — Sheet surface exists and is transparent.** `menu-overlay.html` is a standalone
  document with a fully transparent background (html/body), an empty `#menu-root` container, and a
  small corner probe badge (e.g. `#probe-badge`) rendered **only** when `?probe=1` is in the query
  string; `menu-overlay.css` styles both; `menu-overlay.js` reads `location.search` and toggles the
  badge; `menu-overlay-preload.js` exposes a minimal `window.menuOverlay` stub via `contextBridge`
  (channels come in Leg 2).
- [x] **AC5 — Geometry-follow at identity.** While the sheet is shown: `tab-set-bounds` for the
  active tab re-applies the rounded guest bounds to the sheet 1:1; `tab-set-active` syncs bounds
  and re-adds the sheet **after** the guest re-add (and after the find-overlay re-assert at
  `main.js:1721-1734`, so a dev-mode co-visible find bar sits under the sheet). Resize, maximize,
  and panel toggle all keep the sheet coincident with the guest (they funnel into
  `tab-set-bounds`).
- [x] **AC6 — Internal tabs included (DD7).** With the sheet toggled on, activating an internal
  `goldfinch://` tab keeps the sheet stacked above the internal view at its bounds (no
  `entry.trusted` gating in the sheet path). Switching back to a web tab keeps it above the web
  guest.
- [x] **AC7 — Hide/teardown safety.** `tab-hide` of the active tab hides the sheet (freeze path +
  pending-activation both); `tab-close` of the active tab hides it; window `closed` tears down the
  sheet webContents alongside the find-overlay teardown; after `render-process-gone`, the next show
  rebuilds a fresh view (no dead-view re-show).
- [x] **AC8 — Zero regression without the gate.** With `GOLDFINCH_MENU_OVERLAY_DEV` unset: no sheet
  view is ever created, Ctrl+Shift+M does nothing, and all five freeze-frame menus behave exactly
  as today.
- [x] **AC9 — Manager unit-tested.** `test/unit/menu-overlay-manager.test.js` (`node --test`, fake
  injected deps) covers: single creation across repeated shows; show applies stored bounds and
  add-then-setVisible ordering; show with null `getContentView()` is a state-preserving no-op
  (`visible` stays false, no throw); show never calls `webContents.focus()`; hide is
  visibility-gated and idempotent; `syncBounds` while visible re-applies bounds and while hidden
  only stores; destroyed-recreate guard; `render-process-gone` causes the next ensure to rebuild;
  `teardown` destroys and resets so a later show recreates.
- [x] **AC10 — Gates green.** `npm test`, `npm run typecheck`, `npm run lint` all pass.

## Verification Steps

- **Capture-path canary (before AC1 is trusted)**: launch
  `GOLDFINCH_MENU_OVERLAY_DEV=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1
  GOLDFINCH_MCP_PORT=<free> npm run dev:automation`; run the apparatus-wiring litmus
  (`getChromeTarget` + `enumerateTabs` list THIS instance — F4 carry). Open a web tab, press
  Ctrl+F (via `pressKey` on the guest wcId — also verifies the pressKey→`before-input-event` path
  once), `captureWindow`: the find bar **visible in pixels** proves the OS-grab path (the WSLg
  fallback composites chrome + active guest only and cannot render overlay views — a probe run on
  the fallback is void). **Disambiguate before blocking** (design-review): if the bar is absent
  from the grab, first corroborate that find actually opened via a non-pixel signal (e.g.
  `readDom` on the probed find-overlay wcId, or confirm guest focus and retry) — "find never
  opened" is a stimulus failure, not a capture-path failure. Only when the bar is provably open
  yet absent from pixels, signal `[BLOCKED:capture-apparatus]` — the operator can eyeball the
  probe on-screen instead; do not record a CP1 verdict from fallback grabs. Close find (Esc)
  before the probe.
- AC1: serve the fixture (`python3 -m http.server <port> --directory
  tests/behavior/fixtures/menu-overlay`), navigate the tab to it, Ctrl+Shift+M via `pressKey` on
  the guest wcId, `captureWindow` twice ~2s apart; compare per AC1(a–c). Toggle off (Ctrl+Shift+M
  via `pressKey` — works regardless of OS focus), final grab: sheet + badge gone, guest at
  baseline. Save grabs under
  `/tmp/behavior-tests/goldfinch/menu-overlay-cp1-probe/<ts>/` and reference paths in the flight
  log (evidence stays outside the repo).
- AC2/AC3: `grep -n "require('electron')" src/main/menu-overlay-manager.js` → no match;
  `grep -n "new WebContentsView" src/main/main.js` → sheet construction only inside
  `createSheetView`; confirm webPreferences shape and absence of any `tabViews.set` for the sheet.
- AC4: open the four new files; grep `#menu-root`, `probe`, `contextBridge`.
- AC5/AC6 (live): with sheet on — resize the window; maximize; toggle the media panel (Ctrl+M from
  chrome focus); switch to `goldfinch://settings` and back. `captureWindow` after each: sheet badge
  stays anchored to the guest region, guest visible through, including over the internal page.
  Drive all toggling via `pressKey` on the guest wcId (the chrome interactions move OS focus; see
  Apparatus note on the focus trap).
- AC7 (live): open the kebab menu (old freeze path) with the sheet on → sheet hides with the guest,
  returns on unfreeze (dismiss menu); close the active tab → no sheet residue; relaunch check not
  required for `closed` (structural review of the handler suffices alongside AC9's teardown test).
- AC8: relaunch without `GOLDFINCH_MENU_OVERLAY_DEV`; Ctrl+Shift+M does nothing; open/dismiss all
  five menus (kebab ⋮, container ▾, right-click context, toolbar-unpin, site-info 🔒) — behavior
  identical to today; `grep -rn "menu-overlay" src/` shows the new files but no behavioral hook
  outside the gated paths.
- AC9/AC10: `npm test && npm run typecheck && npm run lint`.

## Implementation Guidance

1. **Fixture (`tests/behavior/fixtures/menu-overlay/index.html`)** — light background; a large
   ticking seconds display (`setInterval` updating `textContent` each second) centered/upper-left;
   a plainly visible link anchored bottom-left (the behavior spec's step-3 outside-click target —
   creating it now satisfies the spec's "create at Leg-6 design if not yet present" note). No
   external resources.

2. **Manager (`src/main/menu-overlay-manager.js`)** — CommonJS, Electron-free, `// @ts-check` +
   JSDoc types (sibling convention — `jsconfig.json` has `checkJs: true` over `src/**`, so the
   file is type-checked either way; `test/**` is excluded):
   ```js
   function createMenuOverlayManager({ getContentView, createSheetView }) {
     let view = null, visible = false, ready = false, lastGuestBounds = null;
     function teardown() { /* remove if visible; destroy wc if !isDestroyed; null/reset all */ }
     function ensureView() { /* destroyed-recreate guard; create via createSheetView();
       wire did-finish-load → ready = true; render-process-gone → teardown(); */ }
     function show() { /* const cv = getContentView(); if (!cv) return;  // state-preserving no-op
       ensureView; if (lastGuestBounds) view.setBounds(lastGuestBounds);
       cv.addChildView(view); view.setVisible(true); visible = true
       — NEVER webContents.focus() (AC2) */ }
     function hide() { /* if (!visible) return; getContentView()?.removeChildView(view);
       visible = false */ }
     function syncBounds(rounded) { lastGuestBounds = rounded;
       if (visible && view) view.setBounds(rounded); }
     return { ensureView, show, hide, syncBounds, teardown,
              isVisible: () => visible, getView: () => view };
   }
   module.exports = { createMenuOverlayManager };
   ```
   No `warn` dep — the load-failure warn lives in main.js's `createSheetView` (an unused
   destructured param would trip the repo's `no-unused-vars`, which only ignores `_`-prefixed
   args). Bounds are DIP end-to-end (F7 rule); identity mapping, no math, hence no
   geometry-helper module. Keep the readiness flag even though nothing consumes it yet — Leg 2's
   pending-init queue slots into the same `did-finish-load` listener (F7 pattern), and installing
   the listener at construction is the load-bearing part.

3. **Main wiring (`src/main/main.js`)** — near the find-overlay state block:
   ```js
   const { createMenuOverlayManager } = require('./menu-overlay-manager');
   const MENU_OVERLAY_DEV = process.env.GOLDFINCH_MENU_OVERLAY_DEV === '1';
   let menuOverlayDevShown = false; // dev-stimulus toggle state (this leg only)
   function createSheetView() { /* new WebContentsView({ webPreferences: { preload:
     …menu-overlay-preload.js, contextIsolation: true, nodeIntegration: false, sandbox: false }});
     setBackgroundColor('#00000000'); loadFile(menu-overlay.html, MENU_OVERLAY_DEV ?
     { query: { probe: '1' } } : undefined).catch(warn); return view; */ }
   const menuOverlay = createMenuOverlayManager({
     getContentView: () => (mainWindow ? mainWindow.contentView : null),
     createSheetView });
   ```
   Do NOT register the sheet in `tabViews`; do NOT wire it through `wireGuestContents`.

4. **Dev stimulus** — in the guest `before-input-event` block (`main.js:743-805`), inside the
   modifier-gated section (after `:755`), mirroring the `Ctrl+Shift+I` branch shape (`:797`):
   ```js
   // Dev-only stimulus; ctrl-only (no meta) is intentional — WSLg dev rig, deleted at Leg 5.
   if (MENU_OVERLAY_DEV && input.control && input.shift && (input.key === 'M' || input.key === 'm')) {
     if (!input.isAutoRepeat) {
       menuOverlayDevShown = !menuOverlayDevShown;
       if (menuOverlayDevShown) menuOverlay.show(); else menuOverlay.hide();
     }
     event.preventDefault();
     return;
   }
   ```
   Guest-focused only (internal tabs excluded by the outer `__goldfinchInternal` skip — acceptable:
   AC6 verifies internal-tab presence via tab-switch persistence, not via toggling on an internal
   tab). `menuOverlayDevShown` is the Leg-1 stand-in for "a menu is open"; Leg 2 replaces it with
   real open state (Workaround Log).

5. **`tab-set-active` (`main.js:1699`)** — inside the `if (entry)` block, strictly AFTER the guest
   re-add (`:1716`) and after the existing find-overlay re-assert block (`:1721-1734`):
   ```js
   if (rounded) menuOverlay.syncBounds(rounded);
   if (menuOverlayDevShown) menuOverlay.show(); // re-add raises above guest + find overlay
   ```
   No `entry.trusted` gate (DD7). The handler already hoists `rounded` at `:1704-1706`.

6. **`tab-set-bounds` (`main.js:1747`)** — alongside the existing `lastGuestBounds` update for the
   active tab (`:1755-1756`): `menuOverlay.syncBounds(rounded)` (manager stores always, applies
   only while visible).

7. **`tab-hide` (`main.js:1667`)** — next to the existing `hideFindOverlay()` line
   (`if (wcId === activeTabWcId)`): also `menuOverlay.hide()`. Restore rides `tab-set-active`
   (step 5) — same as the find overlay. (Do not clear `menuOverlayDevShown` — the freeze round-trip
   should restore the sheet, which is exactly what step 5 does.)

8. **`tab-close` (`main.js:1643`)** — in the existing `wasActive` block (`:1662`):
   `menuOverlay.hide()`. Do NOT mirror the find overlay's "no web tabs left" extra hide — the sheet
   serves internal tabs too (DD7); active-tab lifecycle covers it.

9. **Window `closed` (`main.js:636-643`)** — alongside `teardownFindOverlayView()`:
   `menuOverlay.teardown(); menuOverlayDevShown = false;`.

10. **ESLint (`eslint.config.mjs:10`)** — add `src/preload/menu-overlay-preload.js` to the
    node-globals `files` array (chrome-class trust domain, same block as the other two preloads —
    without it, `require`/`process` trip `no-undef` and AC10 fails). The renderer-side files
    (`menu-overlay.{html,css,js}`) need NO config change — the `src/renderer/**/*.js`
    browser-globals block (`eslint.config.mjs:41-48`) already covers them; do not over-edit.

11. **Unit test (`test/unit/menu-overlay-manager.test.js`)** — fake deps: `createSheetView`
    returns `{ webContents: fakeEmitter({ on, isDestroyed, destroy, loadFile: n/a }), setBounds,
    setVisible }` with call recording; `getContentView` returns `{ addChildView, removeChildView }`
    recorder or `null` (null-window tolerance). Cover the AC9 cases.

## Edge Cases

- **Probe verdict on the wrong capture path**: the WSLg fallback grab would show the guest
  "through" the sheet even if the sheet composited opaque-black on screen (the fallback never
  composites overlay views) — a false PASS. The canary step is mandatory before any AC1 verdict.
- **Sheet visible while the OLD freeze menus open** (dev-mode overlap): freeze hides the guest via
  `tab-hide` → step 7 hides the sheet too; unfreeze restores both via `tab-set-active`. No special
  casing.
- **`removeChildView` when not a child**: the manager gates `hide()` on `visible` (F7 rule —
  removing a non-child is undefined behavior).
- **`tab-set-active` without `bounds`**: manager falls back to stored `lastGuestBounds`; if none
  ever seen, `show()` skips `setBounds` and the next `tab-set-bounds` corrects it (F7 rule).
- **Load failure** (`loadFile` rejects): `.catch` + `console.warn`, app must not crash (mirrors
  `main.js:248-250`).
- **Crash recovery**: after `render-process-gone` the WebContents object stays alive
  (`isDestroyed()` false) — the construction-time listener's `teardown()` is what guarantees
  rebuild (F7 comment at `main.js:237-243`); the destroyed-recreate guard alone never fires for a
  crash.
- **DPR ≠ 1**: DIP end-to-end, no scaling math; on-screen DPR≠1 confirmation is a HAT item (F7
  precedent), not this leg's.
- **Automation drift**: sheet never in `tabViews` → `enumerateTabs` unaffected by construction; no
  other action needed this leg.

## Files Affected

- `src/main/menu-overlay-manager.js` — new: Electron-free sheet lifecycle manager
- `src/renderer/menu-overlay.html` — new: transparent sheet document (+ query-gated probe badge)
- `src/renderer/menu-overlay.css` — new: transparency + badge styles
- `src/renderer/menu-overlay.js` — new: probe-badge toggle module
- `src/preload/menu-overlay-preload.js` — new: minimal chrome-class preload stub
- `test/unit/menu-overlay-manager.test.js` — new: manager state-machine unit test
- `tests/behavior/fixtures/menu-overlay/index.html` — new: ticking liveness fixture (shared with
  the Leg-6 behavior spec)
- `src/main/main.js` — manager wiring, `createSheetView`, dev-stimulus branch, touches in
  `tab-set-active` / `tab-set-bounds` / `tab-hide` / `tab-close`, `closed` teardown
- `eslint.config.mjs` — add `menu-overlay-preload.js` to the node-globals block

## Workaround Log

- **`GOLDFINCH_MENU_OVERLAY_DEV` env gate + Ctrl+Shift+M toggle + `menuOverlayDevShown` flag +
  probe badge**: temporary stand-ins for real menu-open state and protocol so the lifecycle and the
  CP1 probe are exercisable without the DD4 channel set. **Why**: DD4 belongs to Leg 2; splitting
  the protocol across legs would fracture one contract. **Removed**: Leg 2 replaces the toggle flag
  with real open state and the stimulus branch; the env gate itself and the probe badge are deleted
  at Leg 5 cutover (the badge's `?probe=1` gating keeps it out of every production path
  meanwhile).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`** (batch flight: review + commit
are deferred to flight end — do NOT commit, do NOT set `completed`):

- [x] All acceptance criteria verified (AC1 probe verdict + evidence paths recorded in the flight
  log)
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)
- [x] Update flight-log.md with leg progress entry (including CP1 checkpoint verdict)
- [x] Set this leg's status to `landed` (in this file's header)

---

## Citation Audit

Verified against current code on `flight/08-menu-overlay-sheet` at leg design time (2026-07-02):

- `src/main/main.js:186` `teardownFindOverlayView`, `:206` `ensureFindOverlayView`, `:217`
  `new WebContentsView`, `:227` `did-finish-load`, `:241` `render-process-gone`, `:247`
  `setBackgroundColor('#00000000')`, `:258` `showFindOverlay`, `:273` `hideFindOverlay` — **OK**
- `src/main/main.js:487` `createEngine` injected-deps call — **OK**
- `src/main/main.js:636-643` window `closed` handler (incl. `teardownFindOverlayView()` at `:642`) — **OK**
- `src/main/main.js:743-805` guest `before-input-event` (modifier gate `:755`, Ctrl+Shift+I `:797`) — **OK**
- `src/main/main.js:1643` `tab-close` (wasActive hide at `:1662`), `:1667` `tab-hide`, `:1699`
  `tab-set-active` (guest re-add `:1716`, find re-assert `:1721-1734`, hoisted `rounded`
  `:1704-1706`), `:1747` `tab-set-bounds` (`lastGuestBounds` `:1755-1756`) — **OK**
- `src/main/main.js:1852` `capture-active-guest` handler (context only, untouched) — **OK**
- `src/renderer/renderer.js:1008` `freezeGuest` / `:1030` `unfreezeGuest` (context only, untouched) — **OK**
- `src/main/main.js:145` `tabViews` Map / `:147` `activeTabWcId` — **OK**
- `eslint.config.mjs:10` per-file preload `files` glob list — **OK**
- `src/shared/keydown-action.js:64` Ctrl+M → `toggle-panel` — **OK**
- `scripts/a11y-audit.mjs:42-43` fixture-serving pattern — **OK**
- `tests/behavior/menu-overlay.md` step-1 fixture description + apparatus-limit notes — **OK**

24 citation groups verified, all clean (no drift — the flight was designed against this same tree
earlier today).
