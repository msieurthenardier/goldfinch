# Leg: window-controls-parity

**Status**: completed
**Flight**: [Window Shell](../flight.md)

## Objective

Confirm the window-control IPC handlers + maximize-state forwarding operate at parity on the `BaseWindow`, fix `app.on('activate')` to count `BaseWindow`s (DD7), drop the now-unused `BrowserWindow` import, and add a main-process stdout/stderr EPIPE guard (flight-log Decision D-EPIPE) so a closed stdout reader can no longer crash the app.

## Context

- **DD4** — Window controls & maximize-state re-point to `BaseWindow` (parity). `window-minimize`/`window-toggle-maximize`/`window-close`/`window-is-maximized` call the *same-named* `BaseWindow` methods; the `maximize`/`unmaximize` events forward via the chrome-contents accessor. `BaseWindow` exposes the identical window API surface — a clean re-point, no behavior change.
- **DD7** — Fix `app.on('activate')`'s window count: it uses `BrowserWindow.getAllWindows()`, which does **not** count `BaseWindow`s — post-migration it always reads 0 and re-creates a window on macOS dock-click, spawning duplicates. Change to `BaseWindow.getAllWindows()`. This flight introduces the bug by switching window classes, so it's fixed in the same flight even though it's on the (unverifiable) mac path — cheap, correct, no latent defect left behind.
- **D-EPIPE** (flight-log Decision, operator-approved scope addition) — The main process has no `process.stdout`/`stderr` error handler and no `uncaughtException` handler. Under `--enable-logging`/`--automation-dev`, Electron forwards guest/renderer `console.*` messages (and the app writes the `AUTOMATION_DEV_MINT` line, `main.js:1493`) to **stdout**, a pipe; when the reader closes, the write throws `EPIPE` → modal "JavaScript error in the main process" crash dialog. Root cause is a broken-stdout-pipe robustness gap, **independent of the migration**. Fix: swallow `EPIPE` on `process.stdout`/`stderr`.
- **Leg 1 already did the `.send`-payload half** of the maximize/unmaximize forwarders (re-pointed through `getChromeContents()`); this leg owns the remaining DD4 confirmation + the `activate`/import/EPIPE changes.

## Inputs

What exists before this leg runs (post-Leg-1 working tree):
- `mainWindow` is a `BaseWindow`; `getChromeContents()` accessor exists; all chrome sends re-pointed (Leg 1).
- Window-control IPC handlers at `src/main/main.js:1165–1173` (`window-minimize`, `window-toggle-maximize`, `window-close`, `window-is-maximized`) — these call `mainWindow.minimize()/.isMaximized()/.unmaximize()/.maximize()/.close()`; **none dereference `.webContents`**.
- `app.on('activate')` at `main.js:1500–1502` uses `BrowserWindow.getAllWindows()`.
- `BrowserWindow` is imported (`main.js:3`) but, after the `activate` fix, used nowhere except a comment (`main.js:277`).
- No `process.stdout`/`stderr` error handler anywhere in the main process.

## Outputs

What exists after this leg completes:
- `app.on('activate')` uses `BaseWindow.getAllWindows()`.
- `BrowserWindow` removed from the `require('electron')` destructure (no longer referenced in code).
- An EPIPE guard installed on `process.stdout` + `process.stderr` early in `main.js`.
- Window-control handlers + maximize-state forwarding confirmed operating on the `BaseWindow` (parity), no functional change required there.

## Acceptance Criteria

- [ ] **AC1** — `app.on('activate')` (`main.js:1500–1502`) uses `BaseWindow.getAllWindows()` (not `BrowserWindow.getAllWindows()`).
- [ ] **AC2** — `BrowserWindow` is removed from the `const { … } = require('electron')` destructure at `main.js:3` (confirmed unused: `grep -n "BrowserWindow" src/main/main.js` returns only comment/none, no live references).
- [ ] **AC3** — The four window-control IPC handlers (`window-minimize`, `window-toggle-maximize`, `window-close`, `window-is-maximized`) are confirmed to operate on `mainWindow` as a `BaseWindow` — they call identical `BaseWindow` methods and dereference no `.webContents`. No functional change is required; if none is needed, that is the correct outcome (do not invent changes). The `maximize`/`unmaximize` event registration remains on `mainWindow` (a `BaseWindow` emits both).
- [ ] **AC4** — A main-process error guard swallows `EPIPE` on `process.stdout` and `process.stderr` so a closed stdout reader cannot raise an uncaught exception. Installed early in `main.js` (after the requires, before app wiring) so it covers the `AUTOMATION_DEV_MINT` write and Electron's console forwarding. Non-`EPIPE` errors are surfaced via `process.emitWarning(err)` — **NOT** re-thrown (a `throw` inside a `stream.on('error')` listener just re-creates the uncaught exception the guard exists to prevent) and **NOT** written via `console.*` (which routes back to the possibly-broken stream and can re-enter EPIPE). The handler body must not write to stdout/stderr.
- [ ] **AC5** — `npm run typecheck` and `npm run lint` both pass (lint catches a stray unused `BrowserWindow` if AC2 is missed).
- [ ] **AC6** — `grep -n "mainWindow\.webContents" src/main/main.js` remains **0** (no regression of Leg 1's re-point).

## Verification Steps

- AC1/AC2: read `main.js:1500–1502` and `main.js:3`; `grep -n "BrowserWindow" src/main/main.js` → no live code references.
- AC3: read `main.js:1165–1173` — confirm `BaseWindow`-compatible methods, no `.webContents`; confirm maximize/unmaximize registration intact.
- AC4: read the new guard; confirm it filters on `err.code === 'EPIPE'` and does not blanket-swallow.
- AC5: `npm run typecheck`, `npm run lint`.
- AC6: `grep -n "mainWindow\.webContents" src/main/main.js` → 0.
- **Live (deferred to Leg 3 HAT)**: minimize / maximize-restore / close + drag + maximize-state label sync on the frameless `BaseWindow`; and a launch under `--enable-logging` with a closed stdout reader shows **no** EPIPE crash dialog.

## Implementation Guidance

1. **EPIPE guard (D-EPIPE).** Immediately after the `require(...)` block at the top of `main.js` (semantic placement: after all requires, before any `app.*`/window wiring and before the `AUTOMATION_DEV_MINT` write — do not anchor on a literal line number, it shifts if the import block changes), add:
   ```js
   // A closed stdout/stderr reader (e.g. the launcher of `npm run dev:automation` detaching, or a
   // truncating pipe under --enable-logging) makes Electron's console forwarding + the AUTOMATION_DEV_MINT
   // write throw EPIPE. With no handler that surfaces as a modal "main process" crash dialog. Swallow
   // EPIPE; surface anything else via emitWarning — NOT throw (a throw inside an 'error' listener re-raises
   // as uncaught, the very crash we're preventing) and NOT console.* (routes back to the broken stream).
   for (const stream of [process.stdout, process.stderr]) {
     stream.on('error', (err) => {
       if (err && err.code === 'EPIPE') return;
       process.emitWarning(err);
     });
   }
   ```
   (Placement note: it must be installed before the `--automation-dev` mint write and before windows/contents start forwarding console output — top-of-module, right after requires, is safest.)

2. **`activate` fix (DD7).** `main.js:1501`: `BrowserWindow.getAllWindows()` → `BaseWindow.getAllWindows()`.

3. **Drop the unused import (DD7 fallout).** Remove `BrowserWindow` from the `require('electron')` destructure (`main.js:3`). Verify with `grep -n "BrowserWindow" src/main/main.js` that only the descriptive comment at ~277 remains — **leave that comment as-is** (it's prose about what the chrome view's `webPreferences` used to carry; rewriting it is needless churn and it won't trip lint) — no live code uses `BrowserWindow`.

4. **Window controls (DD4) — confirm, don't churn.** Read `main.js:1165–1173`. Because `mainWindow` is now a `BaseWindow` with the identical `minimize/maximize/unmaximize/isMaximized/close` surface and these handlers never touched `.webContents`, they already operate at parity. Do **not** rewrite them for the sake of "re-pointing." Leave the `maximize`/`unmaximize` event registration on `mainWindow`.

5. **Gate**: `npm run typecheck && npm run lint`; confirm both greps (`mainWindow\.webContents` → 0; `BrowserWindow` → no live refs).

## Edge Cases

- **`process.stdout.on('error')` recursion**: the handler must not itself write to stdout (don't `console.log` inside it) — that could re-enter EPIPE. Re-throw non-EPIPE; do not log to the same broken stream.
- **`BrowserWindow` referenced elsewhere**: if a later grep finds a live `BrowserWindow` use beyond `activate` (e.g. a type-only JSDoc), keep the import or convert the reference — let lint be the backstop. (Current audit: only `activate` + a comment.)
- **macOS `activate` path is unverifiable** (DD5) — the fix is correct by construction; mac behavior carries the mission's recorded caveat.
- **Maximize-state sync** depends on Leg 1's `getChromeContents()?.send('window-maximized-change', …)` — confirm those sends still fire (they're Leg 1's, just verify no regression here).

## Files Affected

- `src/main/main.js` — EPIPE guard (top), `activate` → `BaseWindow.getAllWindows()`, drop `BrowserWindow` import; window-control handlers confirmed (likely no change).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`:** *(Autonomous + batched — the Developer does NOT commit; the Flight Director commits Legs 1+2 together after the end-of-flight review.)*

- [ ] All acceptance criteria verified (AC1–AC6)
- [ ] `npm run typecheck` + `npm run lint` passing
- [ ] Both greps clean (`mainWindow.webContents` → 0; `BrowserWindow` → no live refs)
- [ ] Update flight-log.md with Leg 2 progress entry
- [ ] Set this leg's status to `landed` (Flight Director marks `completed` at flight commit)
- [ ] Do NOT commit, do NOT check off in flight.md yet (batched at flight review)
