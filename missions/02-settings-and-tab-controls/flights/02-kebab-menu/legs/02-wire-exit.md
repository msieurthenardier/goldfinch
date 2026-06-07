# Leg: wire-exit

**Status**: completed
**Flight**: [Kebab Menu](../flight.md)

## Objective

Make the kebab menu's **Exit** item terminate the application on all platforms by adding a dedicated `app-quit` IPC (main) + `appQuit` bridge method (preload + d.ts mirror) and wiring the Exit item to it.

## Context

- **Flight DD3** — Exit must *terminate the application* (mission SC4). The existing `window-close` IPC routes `mainWindow.close()` → `closed` → `window-all-closed` → `app.quit()`, **but that guard only quits off-darwin** (`src/main/main.js:536-537 — "if (process.platform !== 'darwin') app.quit();"`), so reusing it would leave macOS running after Exit. A dedicated `app-quit` calling `app.quit()` directly is platform-correct and semantically distinct from the window **close** button (which keeps Flight 1's DD6 window lifecycle deliberately).
- **Flight DD4** — plain quit, no confirm dialog.
- **Convention (Flight-1 recurring lesson)** — the `window.goldfinch` bridge is mirrored by hand in `renderer-globals.d.ts`; typecheck gates the mirror, and it silently drifts if not updated. Add `appQuit` to BOTH `chrome-preload.js` and the d.ts.
- Leg 1 left the `#kebab-exit` click handler as a placeholder no-op with a `// TODO(leg 2 wire-exit): window.goldfinch.appQuit()` comment — this leg replaces that TODO with the real call.

## Inputs

What exists before this leg runs (after leg 1, uncommitted):
- `src/main/main.js` — `app` is imported (`main.js:3 — "const { app, BrowserWindow, ipcMain, ... } = require('electron')"`); window-control IPC handlers (`main.js:432-441`), ending with `ipcMain.handle('window-is-maximized', ...)` (`main.js:441`); the `window-all-closed` darwin guard (`main.js:536-537`).
- `src/preload/chrome-preload.js` — `contextBridge.exposeInMainWorld('goldfinch', { ... })` (`chrome-preload.js:8`); the window-controls block `windowMinimize`/`windowToggleMaximize`/`windowClose`/`windowIsMaximized`/`onWindowMaximizedChange` (`chrome-preload.js:12-17`).
- `src/renderer/renderer-globals.d.ts` — the `GoldfinchBridge` interface with a `// --- window controls ---` section (`renderer-globals.d.ts:10-15`).
- `src/renderer/renderer.js` — the `#kebab-exit` click handler with the placeholder no-op + `// TODO(leg 2 wire-exit)` comment (added in leg 1).

## Outputs

What exists after this leg completes:
- `ipcMain.on('app-quit', () => app.quit())` in `main.js`.
- `appQuit: () => ipcRenderer.send('app-quit')` on the `window.goldfinch` bridge.
- `appQuit(): void;` in the `GoldfinchBridge` interface.
- The kebab Exit item calls `window.goldfinch.appQuit()`.
- `npm run typecheck` / `npm run lint` / `npm test` all green.

## Acceptance Criteria
- [ ] `src/main/main.js` registers `ipcMain.on('app-quit', () => app.quit())`, placed with the other window/app-lifecycle IPC handlers (near `main.js:432-441`), with a brief comment noting it is the kebab-Exit path (distinct from `window-close`, which keeps the DD6 window lifecycle and does not quit on macOS).
- [ ] `src/preload/chrome-preload.js` exposes `appQuit: () => ipcRenderer.send('app-quit')` in the window-controls section of the `goldfinch` bridge.
- [ ] `src/renderer/renderer-globals.d.ts` adds `appQuit(): void;` to the `GoldfinchBridge` interface (window-controls section), keeping the hand-mirrored surface in sync.
- [ ] The kebab **Exit** item's handler calls `window.goldfinch.appQuit()` (replacing leg 1's placeholder no-op + TODO comment); it still closes the menu first (or the quit makes that moot — either is fine).
- [ ] `app.quit()` (not `app.exit()`, not `mainWindow.close()`) is used — a graceful quit firing `before-quit`/`will-quit`, terminating on all platforms including macOS.
- [ ] No change to the existing `window-close` / `window-all-closed` behavior (the close button keeps its DD6 lifecycle).
- [ ] `npm run typecheck` → 0 errors (confirms the d.ts mirror matches the bridge); `npm run lint` → 0 problems; `npm test` → all pass.

## Verification Steps
- `npm run typecheck` — 0 errors. **This is the key gate**: if `appQuit` is added to `chrome-preload.js` but not `renderer-globals.d.ts` (or vice versa), the renderer's `window.goldfinch.appQuit()` call fails typecheck — proving the mirror is in sync.
- `npm run lint` — 0 problems.
- `npm test` — all unit tests pass.
- `grep -n "app-quit" src/main/main.js src/preload/chrome-preload.js` — confirms the IPC channel name matches on both ends.
- Manual (the live-quit check belongs to the `verify-integration` leg, since it tears down the app): with the app running, open the kebab → Exit → the application terminates (win/linux; macOS deferred to a mac HAT per the flight).

## Implementation Guidance

1. **Add the IPC handler** (`src/main/main.js`), alongside the window-control handlers (after `ipcMain.handle('window-is-maximized', ...)` at `main.js:441`):
   ```js
   // Kebab-menu Exit (mission SC4): quit on ALL platforms. Distinct from `window-close`
   // (the window button), whose `window-all-closed` path does not quit on macOS (main.js:536-537).
   ipcMain.on('app-quit', () => app.quit());
   ```
   - `app` is already imported (`main.js:3`). Use `app.quit()` (graceful), not `app.exit()`.

2. **Expose the bridge method** (`src/preload/chrome-preload.js`), in the `// --- window controls ---` block (e.g. after `windowClose` at `chrome-preload.js:15`):
   ```js
   appQuit: () => ipcRenderer.send('app-quit'),
   ```

3. **Mirror in the type surface** (`src/renderer/renderer-globals.d.ts`), in the `// --- window controls ---` section (after `windowClose(): void;` at `renderer-globals.d.ts:13`):
   ```ts
   appQuit(): void;
   ```

4. **Wire the Exit item** (`src/renderer/renderer.js`) — find the `#kebab-exit` click handler added in leg 1 (the one with the `// TODO(leg 2 wire-exit)` comment) and replace the placeholder body so it calls the bridge:
   ```js
   els.kebabMenu.querySelector('#kebab-exit')?.addEventListener('click', () => {
     closeKebabMenu();
     window.goldfinch.appQuit();
   });
   ```
   - Remove the `// TODO(leg 2 wire-exit)` comment now that it's wired.

5. **Do not touch** `window-close`, `window-all-closed`, or the close button — they keep their DD6 lifecycle.

## Edge Cases
- **macOS**: `app.quit()` terminates on macOS (unlike the `window-all-closed` guard). This is intended for an explicit Exit. The dev/verify platform is Linux/WSL, so the macOS quit is verified later on a mac (flight deferral) — but the code path is correct now.
- **Unsaved/in-flight downloads**: `app.quit()` fires `before-quit`; if the project has download cleanup wired to that, it still runs. This leg adds no new teardown and assumes plain quit (DD4).
- **Channel-name typo**: the IPC string `'app-quit'` must match exactly on both ends — the `grep` verification step guards this.

## Files Affected
- `src/main/main.js` — `ipcMain.on('app-quit', () => app.quit())`.
- `src/preload/chrome-preload.js` — `appQuit` bridge method.
- `src/renderer/renderer-globals.d.ts` — `appQuit(): void;` mirror.
- `src/renderer/renderer.js` — wire `#kebab-exit` to `window.goldfinch.appQuit()` (replace leg-1 placeholder).

---

## Post-Completion Checklist

**Do NOT commit (deferred-commit flight). Complete these, then signal `[HANDOFF:review-needed]`:**

- [ ] All acceptance criteria verified
- [ ] `npm run typecheck` / `npm run lint` / `npm test` pass
- [ ] Update flight-log.md with a leg progress entry
- [ ] Set this leg's status to `landed` (in this file's header)
- [ ] Do NOT check off the leg in flight.md yet, do NOT commit — single review + commit after the last autonomous leg

---

## Citation Audit

All source citations verified against current code at leg-design time (clean): `main.js:3` (`app` import),
`main.js:432-441` (window-control IPC), `main.js:536-537` (`window-all-closed` darwin guard),
`chrome-preload.js:8` (`exposeInMainWorld`), `chrome-preload.js:12-17` (window-controls block),
`renderer-globals.d.ts:10-15` (window-controls interface section). The `#kebab-exit` handler citation
refers to leg-1 output (uncommitted) rather than pre-existing code.
