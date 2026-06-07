# Leg: custom-window-controls

**Status**: completed
**Flight**: [Tab-Bar Control Restructure](../flight.md)

## Objective
Fill the reserved right-side zone (Windows/Linux) with custom **minimize / maximize-restore /
close** buttons wired through a new preload IPC bridge, and build the **maximize-state read path**
(button accessible name + icon + `data-state` kept in sync by `main`'s `maximize`/`unmaximize`
events over IPC) that the `responsive-tab-strip` behavior test consumes — landing together with
leg 4 so a frameless win/linux window never ships without a close affordance (DD6 + DD7; SC9, SC8).

## Context
- Flight **DD6**: Windows/Linux get our own minimize / maximize-restore / close buttons in the
  reserved right zone; macOS shows the native traffic lights (no custom buttons). **Quit-path
  consistency (Architect)**: the custom close button must call `win.close()` (→ `closed` →
  `window-all-closed` → `app.quit()` on non-darwin, `main.js:520-522`), **not** `app.quit()`
  directly — so it matches the mac path and the future kebab-Exit path (mission SC4).
- Flight **DD7** (the read path that would otherwise become a mid-flight scramble): window maximize
  state has **no** existing observable surface. This leg MUST expose one: the maximize/restore
  button's **accessible name** (`aria-label` toggling `Maximize`↔`Restore`), **icon** (glyph swap),
  and a **`data-state`** attribute (`normal`↔`maximized`), kept in sync by forwarding `main`'s
  `maximize`/`unmaximize` window events to the renderer over IPC. The behavior test reads any of
  these. (DD7 open question — encoding: this leg ships **all three** (aria-label + icon +
  data-state) so the test has a robust read path regardless of which it samples.)
- **Lands with leg 4 (DD6)**: leg 4 created the frameless frame + reserved `#window-controls` zone +
  `platform-{x}` class but **no controls**. This leg adds the controls; the two are committed
  together at the flight-level commit. Do not ship leg 4 alone as a user-facing build.
- **Minimize read path (DD7, scoped out)**: minimize has no toggled state to display (unlike
  maximize/restore), and the *rendered* minimized effect is not CDP-screenshot-observable, so the
  visual check stays manual. This leg wires minimize as fire-and-forget (the button minimizes); it
  does **not** add a minimize state-readback. (DD7 notes minimize could ride the same IPC seam
  "nearly free", but with no display state to sync it adds nothing the test reads — kept out to
  hold scope.)
- **macOS**: leg 4's CSS hides `#window-controls` on `html.platform-darwin`, so the buttons exist
  in the DOM but are not shown on mac (native traffic lights handle window controls). The wiring is
  harmless when hidden; no platform branch is needed in the JS.
- **Drag regions**: leg 4 made `#tabstrip` a drag region and marked `#newtab-pill`/`.tab` `no-drag`,
  but **not** the (then-empty) `#window-controls`. This leg's buttons sit in the drag region, so
  they **must** be marked `-webkit-app-region: no-drag` or they can't be clicked.
- The bridge is **statically typed**: `src/renderer/renderer-globals.d.ts` mirrors the preload
  surface via `GoldfinchBridge`. Every method added to the preload in this leg must be added to
  that interface or `npm run typecheck` fails (same rule that bit leg 4's `platform`).
- Live verification is `responsive-tab-strip` **Step 7** (maximize toggles button state via the
  read path; WSLg-maximize-reliability is an open question → may be `needs-human-recheck`) plus the
  flight's **manual** Close/minimize checks — all deferred to `verify-integration`. In-leg
  verification is code/markup presence + offline gates.
- **Tooling**: new `els.*` button lookups follow the existing JSDoc-cast pattern (`els` entries are
  `/** @type {HTMLButtonElement} */ (...)`). Offline gates (`npm test`/typecheck/lint/prettier)
  must stay green.

## Inputs
What must be true before this leg runs:
- Leg 4 landed (working tree, uncommitted): frameless frame branch in `main.js`;
  `goldfinch.platform` exposed + mirrored in the d.ts; `<html>` `platform-{x}` class; empty
  `#window-controls` (`index.html:29`) as the last child of `#tabstrip`; `#window-controls` zone
  styles (`styles.css:52`) + `platform-darwin` hide rule (`styles.css:64`).
- `src/main/main.js` — `createWindow()` / `new BrowserWindow` (`:22`); `mainWindow.on('closed')`
  (`:52`); `ipcMain.on(...)` pattern (e.g. `shields-farble` `:419`) and `ipcMain.handle(...)`
  pattern; `window-all-closed` → `app.quit()` (non-darwin) (`:520-522`).
- `src/preload/chrome-preload.js` — `goldfinch` bridge surface (now incl. `platform`).
- `src/renderer/renderer-globals.d.ts` — `GoldfinchBridge` interface.
- `src/renderer/renderer.js` — `els` block; one-time init/wiring area.
- Offline gates green.

## Outputs
What exists after this leg completes:
- Three `<button>`s (minimize, maximize-restore, close) in `#window-controls`, each
  `-webkit-app-region: no-drag`, with `aria-label`s, keyboard-operable.
- Preload bridge: `windowMinimize()`, `windowToggleMaximize()`, `windowClose()`,
  `windowIsMaximized()`, `onWindowMaximizedChange(cb)` — mirrored in the d.ts.
- `main.js`: `ipcMain` handlers for minimize/toggle-maximize/close + `window-is-maximized`;
  `maximize`/`unmaximize` window events forwarded to the renderer.
- Maximize button reflects window state via `aria-label` + icon + `data-state` (DD7 read path).
- Close button calls `win.close()` (DD6 quit consistency).
- Offline gates green. Live maximize/Close/minimize checks deferred to `verify-integration`.

## Acceptance Criteria
- [x] `index.html` adds three buttons inside `#window-controls`: `#win-min` (`aria-label="Minimize"`),
  `#win-max` (`aria-label="Maximize"`, `data-state="normal"`), `#win-close` (`aria-label="Close"`),
  each with a glyph and an `icon-btn`-style class.
- [x] `styles.css`: the window-control buttons are `-webkit-app-region: no-drag` (clickable in the
  drag region); the close button has a destructive hover (e.g. red bg / light glyph); buttons are
  sized to fit the reserved 138px zone (≈46px each).
- [x] `chrome-preload.js` adds to the `goldfinch` bridge: `windowMinimize`, `windowToggleMaximize`,
  `windowClose` (all `ipcRenderer.send`), `windowIsMaximized` (`ipcRenderer.invoke`), and
  `onWindowMaximizedChange` (subscribes to a `window-maximized-change` event).
- [x] `renderer-globals.d.ts` — `GoldfinchBridge` gains all five new methods (correct signatures),
  mirroring the preload.
- [x] `main.js` adds `ipcMain.on('window-minimize'…)` → `mainWindow.minimize()`,
  `ipcMain.on('window-toggle-maximize'…)` → `isMaximized() ? unmaximize() : maximize()`,
  `ipcMain.on('window-close'…)` → `mainWindow.close()`, and
  `ipcMain.handle('window-is-maximized'…)` → `!!mainWindow?.isMaximized()`. The close handler uses
  `mainWindow.close()` (NOT `app.quit()`), preserving the existing quit chain.
- [x] `main.js` (in `createWindow`, after the window exists) forwards window state:
  `mainWindow.on('maximize', …send('window-maximized-change', true))` and
  `mainWindow.on('unmaximize', …send('window-maximized-change', false))`.
- [x] `renderer.js` wires the three buttons to the bridge; a `setMaximized(isMax)` helper sets the
  `#win-max` button's `aria-label` (`Restore`/`Maximize`), `data-state` (`maximized`/`normal`),
  `title`, and glyph; on init it calls `windowIsMaximized()` to set initial state and subscribes via
  `onWindowMaximizedChange(setMaximized)`.
- [x] New `els.*` entries for the three buttons use the existing `/** @type {HTMLButtonElement} */`
  cast style.
- [x] The window-control buttons are keyboard-operable real `<button>`s with visible focus rings
  (they pick up the global `.icon-btn:focus-visible` gold ring against the dark strip — visible,
  unlike the pill; no override needed) and accessible names — no new `npm run a11y` violations
  (full a11y check deferred to verify).
- [x] `npm test`, `npm run typecheck` (0 errors), `npm run lint` (0 problems), and
  `npx prettier --check` on changed files all clean.

## Verification Steps
- `grep -n "win-min\|win-max\|win-close" src/renderer/index.html` → three buttons in
  `#window-controls`; `#win-max` has `data-state`.
- `grep -n "win-ctrl\|no-drag\|win-close" src/renderer/styles.css` → buttons `no-drag` + close
  hover styling.
- `grep -n "windowMinimize\|windowToggleMaximize\|windowClose\|windowIsMaximized\|onWindowMaximizedChange" src/preload/chrome-preload.js src/renderer/renderer-globals.d.ts` → present in BOTH (preload + d.ts mirror).
- `grep -n "window-minimize\|window-toggle-maximize\|window-close\|window-is-maximized\|window-maximized-change" src/main/main.js` → handlers + the maximize/unmaximize forwarders.
- `grep -n "setMaximized\|windowToggleMaximize\|win-max" src/renderer/renderer.js` → buttons wired
  + state sync.
- Confirm by reading that `ipcMain.on('window-close'…)` calls `mainWindow.close()`, **not**
  `app.quit()`.
- `npm run typecheck` → 0 errors; `npm run lint` → exit 0; `npm test` → all pass;
  `npx prettier --check` on changed files → clean.
- Deferred to `verify-integration`: `responsive-tab-strip` Step 7 (maximize/restore toggles the
  read path — `needs-human-recheck` if WSLg maximize is flaky) + manual Close (quits win/linux) +
  manual minimize (hides/restores).

## Implementation Guidance

1. **`index.html` — controls in `#window-controls` (`:29`).** Replace the empty div:
   ```html
   <div id="window-controls">
     <button id="win-min" class="icon-btn win-ctrl" title="Minimize" aria-label="Minimize">—</button>
     <button id="win-max" class="icon-btn win-ctrl" title="Maximize" aria-label="Maximize" data-state="normal">□</button>
     <button id="win-close" class="icon-btn win-ctrl win-close" title="Close" aria-label="Close">✕</button>
   </div>
   ```

2. **`chrome-preload.js` — window-control bridge.** Add to the `exposeInMainWorld('goldfinch', …)`
   object (e.g. a `// --- window controls ---` group):
   ```js
   windowMinimize: () => ipcRenderer.send('window-minimize'),
   windowToggleMaximize: () => ipcRenderer.send('window-toggle-maximize'),
   windowClose: () => ipcRenderer.send('window-close'),
   windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),
   onWindowMaximizedChange: (cb) => ipcRenderer.on('window-maximized-change', (_e, isMax) => cb(isMax)),
   ```

3. **`renderer-globals.d.ts` — mirror the bridge.** Add to `GoldfinchBridge`:
   ```ts
   // --- window controls ---
   windowMinimize(): void;
   windowToggleMaximize(): void;
   windowClose(): void;
   windowIsMaximized(): Promise<boolean>;
   onWindowMaximizedChange(cb: (isMax: boolean) => void): void;
   ```

4. **`main.js` — IPC handlers (near the other `ipcMain` handlers).**
   ```js
   ipcMain.on('window-minimize', () => mainWindow && mainWindow.minimize());
   ipcMain.on('window-toggle-maximize', () => {
     if (!mainWindow) return;
     if (mainWindow.isMaximized()) mainWindow.unmaximize();
     else mainWindow.maximize();
   });
   ipcMain.on('window-close', () => mainWindow && mainWindow.close()); // DD6: close(), not app.quit()
   ipcMain.handle('window-is-maximized', () => !!(mainWindow && mainWindow.isMaximized()));
   ```

5. **`main.js` — forward state (inside `createWindow`, after `mainWindow` is created, near the
   `closed` handler `:52`).**
   ```js
   mainWindow.on('maximize', () => mainWindow.webContents.send('window-maximized-change', true));
   mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-maximized-change', false));
   ```

6. **`renderer.js` — els + wiring + state sync.** Add els entries (button cast style):
   ```js
   winMin: /** @type {HTMLButtonElement} */ (document.getElementById('win-min')),
   winMax: /** @type {HTMLButtonElement} */ (document.getElementById('win-max')),
   winClose: /** @type {HTMLButtonElement} */ (document.getElementById('win-close')),
   ```
   Then near other one-time wiring:
   ```js
   els.winMin.addEventListener('click', () => window.goldfinch.windowMinimize());
   els.winMax.addEventListener('click', () => window.goldfinch.windowToggleMaximize());
   els.winClose.addEventListener('click', () => window.goldfinch.windowClose());
   function setMaximized(isMax) {
     els.winMax.setAttribute('data-state', isMax ? 'maximized' : 'normal');
     els.winMax.setAttribute('aria-label', isMax ? 'Restore' : 'Maximize');
     els.winMax.title = isMax ? 'Restore' : 'Maximize';
     els.winMax.textContent = isMax ? '❐' : '□';
   }
   window.goldfinch.windowIsMaximized().then(setMaximized);
   window.goldfinch.onWindowMaximizedChange(setMaximized);
   ```

7. **`styles.css` — control styling.**
   ```css
   .win-ctrl {
     -webkit-app-region: no-drag; /* clickable inside the #tabstrip drag region */
     width: 46px;
     border-radius: 0;
   }
   .win-ctrl.win-close:hover {
     background: #e81123; /* Windows-style destructive close hover */
     color: #fff;
   }
   ```
   (`.win-ctrl` reuses `.icon-btn` base for color/cursor/focus-ring; only the overrides above are
   new. The three @46px buttons fill leg 4's 138px reserved zone.)

## Edge Cases
- **Close path (DD6)**: `window-close` calls `mainWindow.close()` → fires `closed` →
  `window-all-closed` → `app.quit()` on non-darwin. Using `app.quit()` directly would bypass the
  `closed` cleanup and diverge from the mac/kebab-Exit paths — do not.
- **Initial maximize state**: `windowIsMaximized()` on init sets the button correctly even if the
  window launched maximized or was maximized before the renderer finished loading.
- **WSLg maximize reliability (open question)**: if `mainWindow.maximize()` doesn't reliably
  maximize / fire `maximize` on the WSLg compositor, the button label/`data-state` may not flip;
  `responsive-tab-strip` Step 7 becomes `needs-human-recheck` at verify with a manual fallback.
  Code-side this leg is correct; it's a platform runtime risk, deferred to the live session.
- **macOS**: buttons are `display:none` (leg 4) but still wired — harmless. Native traffic lights
  provide min/max/close there; our IPC is simply unused on mac.
- **Drag region**: every control button is `no-drag`. The reserved zone is exactly full (three
  `46px` buttons = the `138px` `#window-controls` width, no inter-button gap), so there is no
  draggable slack *inside* the cluster; the window move target comes from the `#tabstrip`
  background and the empty `#tabs` area (leg 4), not from within `#window-controls`.
- **Focus ring on the controls**: unlike the gold pill, these buttons sit on the dark `#tabstrip`,
  so the global gold `.icon-btn:focus-visible` ring is visible — no DD2-style override needed.
- **`@ts-check`**: `els.winMax.textContent` / `setAttribute` are on `HTMLButtonElement` (cast in
  els) — clean. The bridge methods resolve via the d.ts mirror.

## Files Affected
- `src/renderer/index.html` — three control buttons inside `#window-controls`.
- `src/preload/chrome-preload.js` — five window-control bridge methods.
- `src/renderer/renderer-globals.d.ts` — five methods mirrored into `GoldfinchBridge`.
- `src/main/main.js` — four `ipcMain` handlers + two window-state forwarders in `createWindow`.
- `src/renderer/renderer.js` — three `els` entries; button wiring + `setMaximized` state sync.
- `src/renderer/styles.css` — `.win-ctrl` no-drag/sizing + `.win-close` hover.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]` (commit deferred to the
flight-level review/commit per `/agentic-workflow`):**

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test` + `npm run typecheck` + `npm run lint` + `npx prettier --check`)
- [x] Update flight-log.md with leg progress entry (note deferred live maximize/Close/minimize)
- [x] Set this leg's status to `landed` (in this file's header)
- [x] **This is the last autonomous (build) leg** — after it, the Flight Director runs the single
  flight-level review + commit; `verify-integration` (live) + optional HAT follow. No flight-status
  change here; that happens at flight completion.

## Citation Audit
Citations verified against the current (post-leg-4) working tree — all `OK`: `main.js:22`
(`new BrowserWindow`), `:52` (`mainWindow.on('closed')`), `:419` (`ipcMain.on('shields-farble')`
pattern), `:520-522` (`window-all-closed` → `app.quit`); `chrome-preload.js`
(`exposeInMainWorld('goldfinch', …)` incl. `platform`); `renderer-globals.d.ts` (`GoldfinchBridge`,
now with `platform`); `index.html:29` (empty `#window-controls`); `styles.css:46` (`#tabstrip`
drag), `:50` (`#newtab-pill`/`.tab` no-drag), `:52` (`#window-controls` zone), `:61`/`:64`
(`platform-darwin` inset/hide). Behavior-test alignment: `responsive-tab-strip` Step 7 (maximize
read path) + manual Close/minimize, deferred to `verify-integration`.
