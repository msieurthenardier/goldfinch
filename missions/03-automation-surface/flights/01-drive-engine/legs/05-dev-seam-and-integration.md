# Leg: dev-seam-and-integration

**Status**: completed
**Flight**: [Drive Engine (input / nav / tabs)](../flight.md)

## Objective

Wire the four engine modules (`resolve` / `tabs` / `nav` / `input`) into a single main-process engine
with their real Electron deps, and expose a **dev-only**, **chrome-renderer-only** invocation seam
that `scripts/cdp-driver.mjs` can drive via `Runtime.evaluate` — present only when the dev debugging
port is open, debugger-free (DD8), and removed/folded into the gated transport at Flight 3 (DD7).

## Context

- **DD7 — interim dev-only seam, superseded by Flight 3.** The engine has no transport yet; this seam
  lets the Leg 6 live smoke (and manual driving) reach it. It must be **dev-guarded** (never in a
  normal/release run) and live in the **chrome renderer world only** (not reachable from guest web
  content).
- **DD1** — tab ops are renderer-mediated via `mainWindow.webContents.executeJavaScript(...)` against
  the `window.__goldfinchAutomation` hook (Leg 2); input/nav act natively on a resolved `webContents`.
  The engine glue is where the injected deps (`fromId`, `chromeContents`, `executeInRenderer`,
  `activate`) get bound to real Electron handles.
- **DD8 — debugger-free.** The glue and seam use no `webContents.debugger`; `cdp-driver.mjs` is the
  single CDP client during the smoke.
- **Single automation entry point** (flight technical approach) — the engine is the one place
  automation actions are dispatched; no scattered `sendInputEvent`/`loadURL` calls elsewhere.
- **How `cdp-driver.mjs` reaches the engine.** It attaches to the chrome **renderer** target
  (`index.html`, `cdp-driver.mjs:31-37`) and runs `Runtime.evaluate` (`cdp-driver.mjs:82`) in the
  renderer **main world**. The engine runs in **main**. With `contextIsolation: true` /
  `nodeIntegration: false` (`main.js:112-113`), the renderer main world reaches main only through the
  `contextBridge` surface the preload exposes (`chrome-preload.js:9 — "contextBridge.exposeInMainWorld('goldfinch', …)"`).
  So the seam is: `Runtime.evaluate("window.goldfinch.automationDevInvoke('navigate',[wcId,url])")`
  → preload `ipcRenderer.invoke('automation:dev-invoke', …)` → `ipcMain.handle` → engine. The chrome
  window is `sandbox: false` (`main.js:116`), so the preload has `process` access for the dev gate.

## Inputs

What exists before this leg runs:
- `src/main/automation/{resolve,tabs,nav,input}.js` (Legs 1–4) — the engine functions, all taking
  injected deps.
- `src/main/main.js` — `mainWindow` (`main.js:93`), `webContents` imported (`main.js:3`), `ipcMain`
  available, the chrome `BrowserWindow` webPreferences (`main.js:110-117`), `app.whenReady` startup.
- `src/preload/chrome-preload.js` — the `contextBridge.exposeInMainWorld('goldfinch', {…})` surface
  to extend; already imports from `../shared/…`.
- `scripts/cdp-driver.mjs` — the smoke driver (`eval` via `Runtime.evaluate`, awaits promises).
- `src/renderer/renderer.js` — already exposes `window.__goldfinchAutomation` (Leg 2); **no further
  renderer.js change is needed** (the seam invoke is a preload-bridge method, callable directly from
  `Runtime.evaluate`).

## Outputs

What exists after this leg completes:
- `src/shared/automation-dev.js` — **new**: pure `isAutomationDevEnabled(argv)` (the dev gate, shared
  by main + preload).
- `src/main/automation/engine.js` — **new**: `createEngine(getMainWindow)` → an object dispatching
  named ops to the wired engine functions (the single automation entry; the Electron-bound glue).
- `src/main/main.js` — **modified**: dev-gated `additionalArguments` on the chrome window; dev-gated
  `ipcMain.handle('automation:dev-invoke', …)` registration that calls the engine.
- `src/preload/chrome-preload.js` — **modified**: dev-gated `automationDevInvoke` on the `goldfinch`
  bridge.
- `test/unit/automation-dev.test.js` — **new**: unit tests for `isAutomationDevEnabled`.

## Acceptance Criteria

- [x] **AC1** — `src/shared/automation-dev.js` exports a pure `isAutomationDevEnabled(argv)` returning
  `true` iff `argv` is an array containing a string that starts with `--remote-debugging-port` **or**
  equals `--automation-dev`; `false` otherwise (incl. non-array input). Never throws.
- [x] **AC2** — `src/main/automation/engine.js` exports `createEngine(getMainWindow)` returning an
  object with methods `enumerateTabs`, `openTab`, `closeTab`, `activateTab`, `navigate`, `goBack`,
  `goForward`, `reload`, `click`, `typeText`, `scroll`, `pressKey`. Each builds the deps
  (`fromId = webContents.fromId`, `chromeContents = getMainWindow().webContents`,
  `executeInRenderer = (code) => getMainWindow().webContents.executeJavaScript(code)`,
  `activate = (wcId) => tabs.activateTab(wcId, base)`) **freshly per call** (so a recreated window is
  picked up) and delegates to the matching Leg 1–4 function. No `webContents.debugger` (DD8).
- [x] **AC3** — In `main.js`, the chrome `BrowserWindow` `webPreferences` gets `additionalArguments:
  ['--automation-dev']` **only** in dev, via a conditional spread (so the key is simply absent
  otherwise — no explicit `undefined`). This injects the dev marker into the renderer process's
  `process.argv` (the browser-process `--remote-debugging-port` switch is not in the renderer's own
  `process.argv`, so the marker must be injected). No other webPreferences change.
- [x] **AC4** — In `main.js`, **only when `isAutomationDevEnabled(process.argv)`**, an
  `ipcMain.handle('automation:dev-invoke', handler)` is registered once at startup. The handler:
  (a) **rejects** unless `event.sender === mainWindow.webContents` (chrome-renderer-only — a guest
  cannot drive the seam); (b) rejects an unknown `op`; (c) otherwise calls `engine[op](...args)` and
  returns its result. When not dev, the handler is **never registered** (a call to the channel rejects
  with no-handler).
- [x] **AC5** — In `chrome-preload.js`, `automationDevInvoke: (op, args) => ipcRenderer.invoke('automation:dev-invoke', { op, args })`
  is added to the `goldfinch` bridge **only when `isAutomationDevEnabled(process.argv)`** (the preload
  reads the injected `--automation-dev` marker). When not dev, the method is absent from the bridge.
- [x] **AC6** — `test/unit/automation-dev.test.js` covers `isAutomationDevEnabled`: true for
  `['--remote-debugging-port=9222']`, true for `['--automation-dev']`, true when mixed with other
  args, false for `[]` / unrelated args / non-array / `null`. Full suite `node --test test/unit/*.test.js` green.
- [x] **AC7** — `npm run typecheck` and `npm run lint` clean. `engine.js` is the **single** automation
  entry (no `sendInputEvent`/`loadURL` automation calls scattered elsewhere). A header comment marks
  the seam interim (DD7, folded at Flight 3) and debugger-free (DD8). No behavior change to the app
  when run normally (`npm start` / `npm run dev` — no debug port → seam absent).

## Verification Steps

- `node --test test/unit/automation-dev.test.js` — new tests pass.
- `npm test` — full unit suite green.
- `npm run typecheck` / `npm run lint` — clean.
- Manual read: confirm the seam (handler + preload method) is gated behind `isAutomationDevEnabled`,
  the handler checks `event.sender === mainWindow.webContents`, and neither `engine.js` nor `main.js`
  seam code uses `webContents.debugger`.
- Structural: confirm `npm run dev` / `npm start` (no `--remote-debugging-port`) yields
  `isAutomationDevEnabled(process.argv) === false`, so the seam is absent (reason: the dev gate).
- (Deferred to Leg 6 live smoke) under `npm run dev:debug`, drive the engine end-to-end through
  `cdp-driver.mjs eval "window.goldfinch.automationDevInvoke(...)"`.

## Implementation Guidance

1. **`src/shared/automation-dev.js`** — pure, dual-free (main + preload both `require` it; both are
   CommonJS-capable — preload already `require`s `../shared/internal-page`):
   ```js
   // @ts-check
   'use strict';
   // Dev gate for the interim automation seam (DD7). True when the process was launched with the
   // dev debugging port (browser process) OR carries the injected --automation-dev marker (renderer
   // process, set via the chrome window's additionalArguments). Pure; never throws.
   function isAutomationDevEnabled(argv) {
     return Array.isArray(argv) && argv.some(
       (a) => typeof a === 'string' && (a.startsWith('--remote-debugging-port') || a === '--automation-dev')
     );
   }
   module.exports = { isAutomationDevEnabled };
   ```

2. **`src/main/automation/engine.js`** — the Electron-bound glue (this module MAY `require('electron')`
   at top; it is the integration layer, not pure logic, so it is not unit-tested the offline way —
   Leg 6 integration-verifies it):
   ```js
   // @ts-check
   'use strict';
   // Single automation entry point (flight technical approach). Wires the pure engine modules to
   // real Electron handles. Interim dev seam reaches this via main.js (DD7); debugger-free (DD8).
   const { webContents } = require('electron');
   const tabs = require('./tabs');
   const nav = require('./nav');
   const input = require('./input');

   function createEngine(getMainWindow) {
     const fromId = (id) => webContents.fromId(id);
     const deps = () => {
       const mw = getMainWindow();
       const chromeContents = mw ? mw.webContents : null;
       // Guard the captured mw (not getMainWindow() again) so a closed/absent window yields a
       // clean automation error instead of a confusing null-deref TypeError mid-smoke.
       const executeInRenderer = (code) => {
         if (!mw) throw new Error('automation: chrome window unavailable');
         return mw.webContents.executeJavaScript(code);
       };
       const base = { fromId, chromeContents, executeInRenderer };
       // activate is built on `base` (NOT the returned deps) so activateTab never receives an
       // `activate` of its own — avoids any accidental recursion.
       return { ...base, activate: (wcId) => tabs.activateTab(wcId, base) };
     };
     return {
       enumerateTabs: () => tabs.enumerateTabs(deps()),
       openTab: (url) => tabs.openTab(url, deps()),
       closeTab: (wcId) => tabs.closeTab(wcId, deps()),
       activateTab: (wcId) => tabs.activateTab(wcId, deps()),
       navigate: (wcId, url) => nav.navigate(wcId, url, deps()),
       goBack: (wcId) => nav.goBack(wcId, deps()),
       goForward: (wcId) => nav.goForward(wcId, deps()),
       reload: (wcId) => nav.reload(wcId, deps()),
       click: (wcId, x, y, opts) => input.click(wcId, x, y, deps(), opts),
       typeText: (wcId, text) => input.typeText(wcId, text, deps()),
       scroll: (wcId, x, y, dx, dy) => input.scroll(wcId, x, y, dx, dy, deps()),
       pressKey: (wcId, name) => input.pressKey(wcId, name, deps()),
     };
   }
   module.exports = { createEngine };
   ```
   (Confirm `input.click`'s signature ordering matches Leg 4 — `click(wcId, x, y, deps, opts)`.)

3. **`src/main/main.js`** — three small additions:
   - `const { isAutomationDevEnabled } = require('../shared/automation-dev');` and
     `const { createEngine } = require('./automation/engine');` near the other requires.
   - In `createWindow`, add to the chrome `BrowserWindow` `webPreferences` (alongside `preload`/
     `contextIsolation`/etc., `main.js:110-117`) using a **conditional spread** (consistent with the
     `frameOpts` pattern at `main.js:98-101`, and avoids a `@ts-check` warning about an explicit
     `undefined` property):
     `...(isAutomationDevEnabled(process.argv) ? { additionalArguments: ['--automation-dev'] } : {}),`
   - At startup (after `mainWindow` can exist — e.g. in `app.whenReady().then(...)` after
     `createWindow()`, guarded so it registers once), dev-gated:
     ```js
     if (isAutomationDevEnabled(process.argv)) {
       const engine = createEngine(() => mainWindow);
       ipcMain.handle('automation:dev-invoke', async (event, { op, args } = {}) => {
         // event.sender identity is sufficient here (unlike internal-ipc's senderFrame.origin
         // check): this handler is NEVER registered in production (dev-gated), and a guest webview
         // has a different webContents than mainWindow's, so the identity check fully isolates it.
         if (!mainWindow || event.sender !== mainWindow.webContents) {
           throw new Error('automation: dev-seam is chrome-renderer-only');
         }
         if (typeof engine[op] !== 'function') throw new Error('automation: unknown op ' + op);
         return engine[op](...(Array.isArray(args) ? args : []));
       });
     }
     ```
     (Find the existing `whenReady`/startup site; register there once. Do not register at module top
     before `mainWindow`/`ipcMain` are ready.)

4. **`src/preload/chrome-preload.js`** — extend the bridge object, dev-gated:
   ```js
   const { isAutomationDevEnabled } = require('../shared/automation-dev');
   // …inside exposeInMainWorld('goldfinch', { … existing … ,
   ...(isAutomationDevEnabled(process.argv)
     ? { automationDevInvoke: (op, args) => ipcRenderer.invoke('automation:dev-invoke', { op, args }) }
     : {}),
   // })
   ```
   Spread the dev method into the object literal so it is simply absent in non-dev.

5. **Tests (`test/unit/automation-dev.test.js`)** — pure-function matrix for `isAutomationDevEnabled`
   per AC6. (engine.js / the seam are integration-verified in Leg 6, not unit-tested — note this in
   the test file header or the flight-log entry.)

## Edge Cases

- **`getMainWindow()` returns null** (window closed/recreated) — `chromeContents` is `null`;
  `classifyContents` then returns `'guest'` for any real wc and `executeInRenderer` would throw on a
  null window. In practice the seam is only driven while the window is up; acceptable for the interim
  dev seam. Building deps **per call** (not once) means a recreated window is picked up.
- **Unknown op / malformed payload** — the handler rejects unknown ops and coerces a non-array `args`
  to `[]`; a thrown engine error (bad-url / internal-session / no-such-contents) propagates back as a
  rejected `invoke` promise (visible to `cdp-driver.mjs eval`).
- **Guest tries the seam** — a guest webview has its own preload (`webview-preload.js`), which does
  **not** expose `automationDevInvoke`, and the main handler also rejects any sender that isn't the
  chrome renderer. Two layers.
- **Release/normal run** — no `--remote-debugging-port`, so `isAutomationDevEnabled(process.argv)` is
  false in both main and (via the absent marker) the renderer: no `additionalArguments` marker, no IPC
  handler, no preload method. The seam does not exist. (This is the DD7 "never in a release" envelope,
  reinforced by the no-release-until-F4 commitment.)

## Files Affected
- `src/shared/automation-dev.js` — **new**: pure dev gate.
- `src/main/automation/engine.js` — **new**: single automation entry (Electron-bound glue).
- `src/main/main.js` — **modified**: dev-gated `additionalArguments` + dev-gated IPC seam handler.
- `src/preload/chrome-preload.js` — **modified**: dev-gated `automationDevInvoke` bridge method.
- `test/unit/automation-dev.test.js` — **new**: unit tests for the dev gate.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (batch commit at flight end — do NOT commit, do NOT `[COMPLETE:leg]`)
- [x] Do NOT check off the leg in flight.md yet (batch at flight end)
