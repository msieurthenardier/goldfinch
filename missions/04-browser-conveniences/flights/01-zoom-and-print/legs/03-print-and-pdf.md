# Leg: print-and-pdf

**Status**: completed
**Flight**: [Core Conveniences — Zoom & Print](../flight.md)

## Objective

Wire **native print** (`Ctrl+P` via the leg-1 `before-input-event` capture + a kebab **Print…** item → `webContents.print()`, with Save-as-PDF as a destination in that dialog — SC2) and add a gated automation **`printToPDF`** op (`src/main/automation/print.js`) that renders the active web tab to a PDF and returns base64 (SC8 part), foreground-first and op-local-internal-guarded.

## Context

- **DD6** — The page-scoped shortcut capture lives main-side in the leg-1 `before-input-event` listener on each non-internal guest (`main.js:351-368`). This leg extends that handler with a `Ctrl+P` branch. Because the listener is already inside the `!__goldfinchInternal` block, `Ctrl+P` is **web-content-only by construction** (no extra guard needed on the keyboard path).
- **SC2** — "Save as PDF" is a *destination within* the OS-native print dialog, so a single `webContents.print()` path satisfies both "print" and "save as PDF". The native dialog is OS-native and **manually verified** at `verify-integration`/HAT — outside the automation apparatus.
- **DD4** — Native `print()` is **not** an MCP tool. Agents get **`printToPDF`**, which resolves a Node **Buffer** and must `buf.toString('base64')` and return it as a **plain JSON text string** through the default `okResult`/`serialize` path — **NOT** an MCP image content block (`imageResult` is PNG-only; there is no `application/pdf` image type, and the tool sets no `shape`). Returning the raw Buffer would emit `{"type":"Buffer",…}`.
- **DD3** — The `printToPDF` op must carry its **own op-local `isInternalContents(wc)` guard** (admin runs `allowInternal:true`, so `resolveContents` alone won't refuse internal — `resolve.js:95-97`). Mirrors `evaluate`/`injectScript`/`openDevTools` (`observe.js:341/392/436`) and leg 2's `getZoom`/`setZoom`.
- **Foreground-first discipline** — `printToPDF` mirrors `captureScreenshot` (`observe.js:119-131`): resolve → (guest only) `activate` + re-resolve + wait-for-paint → act → base64, so a not-yet-painted guest doesn't hang. **Guard placement**: the op-local internal guard sits **before `activate`** (refuse internal *before* foregrounding it) — this is **deliberately stricter than** `evaluate`, which guards only on the final wc after the activate branch (`observe.js:341`). One guard after the first resolve is sufficient because the internal-session identity is invariant across re-resolve; no second guard is needed.
- **Native-print failures must not be swallowed (WSLg)** — `webContents.print()` on Linux returns immediately and reports failure via its optional `(success, failureReason)` callback; on a WSLg host with no CUPS printer configured it does **not** open a dialog and fails silently. Both `print()` call sites attach the callback and log a warning on failure, so the manual SC2 check isn't chasing an invisible no-op. (`printToPDF` is unaffected — it renders without a printer, so the **automation** PDF path fully verifies PDF generation regardless of printer config.)
- The flight prescribes a **new file** `src/main/automation/print.js` (Technical Approach + DD4), keeping print concerns separate from `observe.js`.

## Inputs

What exists before this leg runs (current working-tree state, after legs 1–2):
- `src/main/main.js:356-369` — the leg-1 `!__goldfinchInternal` block in the `web-contents-created` webview branch; the `contents.on('before-input-event', (event, input) => { … })` listener body is `357-368`. Matches `input.type === 'keyDown'` + `input.control||input.meta`, maps `'='`/`'+'`→`in`, `'-'`→`out`, `'0'`→`reset` via `let action`, then `if (!action) return; applyZoom(contents, action); event.preventDefault();`.
- `src/main/main.js:871-876` — the leg-1 `ipcMain.on('zoom-apply', (_e, { webContentsId, action }) => { … })` handler (869-870 is its comment): resolves `webContents.fromId(webContentsId)`, guards `!wc || wc.isDestroyed()`, guards `wc.session?.__goldfinchInternal`, then `applyZoom(wc, action)`. The `print` IPC handler mirrors this exactly.
- `src/renderer/index.html` — `#kebab-menu` (`role="menu"`) containing `#kebab-settings` and `#kebab-exit` (`class="cm-item" role="menuitem"`).
- `src/renderer/renderer.js:328-358` — `kebabEntry` registered with the shared `menuController` (`renderer.js:112-195`); item click handlers at `~351-358` (e.g. `#kebab-settings` → `closeKebabMenu()` + action). `menuController` provides roving-tabindex keyboard operation for any `[role="menuitem"]` in the menu (so a new item is keyboard-operable automatically). Active tab via `activeTab()` (`renderer.js:574`); `isInternalTab(tab)` (`renderer.js:577`).
- `src/preload/chrome-preload.js:58` — `zoomApply: ({ webContentsId, action }) => ipcRenderer.send('zoom-apply', { webContentsId, action })` (the renderer→main send pattern to mirror). `renderer-globals.d.ts` carries the `GoldfinchBridge` typedef (leg 1 added `zoomApply`/`onZoomChanged`).
- `src/main/automation/observe.js:119-131` — `captureScreenshot` foreground-first template: `let wc = resolveContents(wcId, deps);` → `if (classifyContents(wc, chromeContents) === 'guest' && typeof activate === 'function') { await activate(wcId); wc = resolveContents(wcId, deps); await waitForPaint(wc, { delayMs }); }` → `const image = await wc.capturePage(); return image.toPNG().toString('base64');`. Op-local internal guard precedent: `evaluate` (`observe.js:341-343`). Imports: `const { resolveContents, classifyContents, isInternalContents } = require('./resolve');` (`observe.js:3`).
- `src/main/automation/engine.js:61-92` — dispatch map (now includes leg-2 `getZoom`/`setZoom`); add `printToPDF` near the observe ops.
- `src/main/automation/mcp-tools.js` — `DRIVE_TOOLS` array (now 14 after leg 2: …`getZoom`, `setZoom`, `click`…); default `okResult(value)` serialize path (`mcp-tools.js:57-68`); count comments at `mcp-tools.js:92` ("14 drive") and `~:463-466` ("…= 23"). `navigate` flat-schema example (`mcp-tools.js:163-174`).
- `test/unit/automation-observe.test.js:279-291` — base64 op test style: fake guest wc with an async `capturePage()` returning a Buffer; `assert.equal(result, Buffer.from('…').toString('base64'))`; `activate: async () => {}` in deps; ordering asserted by wrapping the method and recording a call log.
- `test/unit/automation-mcp-tools.test.js:22-77` — `DRIVE_NAMES` array (14 entries) + hard `assert.equal(tools.length, 23)` + name-set `deepEqual`. `test/unit/automation-mcp-server.test.js:26` — `const EXPECTED_TOOL_COUNT = 23;`.

## Outputs
- `Ctrl+P` branch in the leg-1 `before-input-event` handler.
- A kebab **Print…** item + renderer click handler + `print` IPC + preload `print()`.
- `src/main/automation/print.js` exporting `printToPDF`; engine + MCP tool wiring.
- `test/unit/automation-print.test.js`; bumped tool-count tests (→24).

## Acceptance Criteria
- [ ] A `Ctrl+P` branch is added to the leg-1 `before-input-event` handler (`main.js:357-368`, inside the `!__goldfinchInternal` block): on `(control||meta)` + `input.key === 'p'||'P'`, call `contents.print({}, (ok, reason) => { if (!ok) console.warn('print failed:', reason); })` and `event.preventDefault()`. (Web-content-only by construction — the listener is not attached to the internal session.)
- [ ] A kebab **Print…** item (`#kebab-print`, `class="cm-item" role="menuitem"`) is added to `#kebab-menu` in `index.html`, positioned sensibly (e.g. before `#kebab-settings`/`#kebab-exit` or grouped with page actions). It is keyboard-operable via the existing `menuController` roving tabindex (no menuController change needed).
- [ ] The renderer `#kebab-print` click handler closes the kebab (`closeKebabMenu()`) and, for the active tab, calls `window.goldfinch.print({ webContentsId: tab.wcId })` — **guarded by `isInternalTab(tab)`** (no-op on internal tabs; also no-op when `tab.wcId == null`).
- [ ] `chrome-preload.js` exposes `print: ({ webContentsId }) => ipcRenderer.send('print', { webContentsId })`; the `GoldfinchBridge` typedef in `renderer-globals.d.ts` is updated.
- [ ] `ipcMain.on('print', (_e, { webContentsId }) => { … })` in `main.js` mirrors the `zoom-apply` handler: resolve `webContents.fromId`, guard `!wc || wc.isDestroyed()`, guard `wc.session?.__goldfinchInternal`, then `wc.print({}, (ok, reason) => { if (!ok) console.warn('print failed:', reason); })` (defense in depth on the internal guard, matching the renderer; callback surfaces WSLg no-printer failures instead of swallowing them).
- [ ] `src/main/automation/print.js` exports `printToPDF(wcId, deps, opts = {})` mirroring `captureScreenshot`'s foreground-first discipline, with the op-local guard placed **before `activate`** (stricter than `evaluate`): `const wc = resolveContents(wcId, deps);` → **op-local `if (isInternalContents(wc)) throw new Error('automation: printToPDF — internal-session excluded')`** → if `classifyContents === 'guest'` and `activate` present: `await activate(wcId)`, re-resolve (`wc = resolveContents(wcId, deps)`), `await waitForPaint(wc)` → `const buf = await wc.printToPDF({}); return buf.toString('base64');`. (Single guard — the internal session is invariant across re-resolve; no second guard needed. `printToPDF({})` — Electron ^42 requires the options arg.)
- [ ] `printToPDF` is registered in `engine.js` (`printToPDF: (wcId, opts) => print.printToPDF(wcId, deps(), opts)`) with a `require('./print')`.
- [ ] A `printToPDF` MCP tool is added to `DRIVE_TOOLS` in `mcp-tools.js`: **flat schema** `required: ['wcId']` (no top-level `anyOf`/`oneOf`/`allOf`; v1 exposes no print options), thin-adapter `call: (engine, { wcId }) => engine.printToPDF(wcId)`, and **no `shape`** so the base64 rides the default `okResult` JSON-text path (NOT `imageResult`). Count comments bumped: `mcp-tools.js:92` ("14 drive"→"15 drive") and `~:463-466` ("23"→"24", note printToPDF).
- [ ] **Op-local internal guard holds under admin**: a unit test proves `printToPDF` on an internal wc throws the op-local refusal **even when `deps.allowInternal === true`**.
- [ ] `test/unit/automation-print.test.js` covers: base64 return (decodes to the fake buffer); `activate` called **before** `printToPDF` (foreground-first ordering) and the post-activate re-resolve handle is used; op-local internal refusal with `allowInternal:true`; `bad-handle`/`no-such-contents` via `resolveContents`.
- [ ] `test/unit/automation-mcp-tools.test.js` updated: `DRIVE_NAMES` +`printToPDF` (`~:22-26`), `assert.equal(tools.length, 24)` (`~:75`), **and the test-title string** at `~:71` ("23 tools (14 drive + 4 observe …)" → "24 … (15 drive …)"). `test/unit/automation-mcp-server.test.js`: `EXPECTED_TOOL_COUNT` 23→24 (`~:26`) **and the literal "23"/"returns 23 tools" title strings** (`~:251`).
- [ ] `npm test`, `npm run lint`, `npm run typecheck` pass; `npm run a11y` clean (no new violations from the kebab item).

## Verification Steps
- `npm test` — all pass, including `test/unit/automation-print.test.js` and the bumped tool-count tests.
- Unit assertion: `printToPDF` returns `Buffer.from('PDFBYTES').toString('base64')` for a fake wc whose `printToPDF()` resolves that buffer; `typeof result === 'string'`.
- Unit assertion: with a call log, `activate` index < `printToPDF` index (foreground-first); internal wc + `allowInternal:true` → rejects with `…internal-session excluded`.
- `npm run lint` / `npm run typecheck` — clean.
- `npm run a11y` — no new violations; the kebab Print… item is reachable by keyboard (Arrow keys within the open kebab) with the menu's existing focus treatment.
- Manual (dev run `npm run dev`, deferred to `verify-integration`/HAT): focus a web page, `Ctrl+P` → **either** the native dialog opens (choose **Save as PDF** → a PDF file is produced) **or**, on a WSLg host with no CUPS printer, a `print failed: …` warning is logged and the app does not crash. Kebab ⋮ → **Print…** → same. On `goldfinch://settings`, `Ctrl+P` and kebab Print… do nothing (no dialog, no error). **WSLg note**: the native dialog needs a configured printer/CUPS (e.g. `cups-pdf`); if none is available, the dialog check defers to a host with a printer — but the **automation `printToPDF` path proves PDF generation independently** (no printer needed), so SC2's PDF capability is verified regardless.

## Implementation Guidance

1. **Keyboard `Ctrl+P` (`src/main/main.js`)** — in the leg-1 `before-input-event` handler (`main.js:357-368`), add a branch (before `if (!action) return;` or as an independent check): `if (input.key === 'p' || input.key === 'P') { contents.print({}, (ok, reason) => { if (!ok) console.warn('print failed:', reason); }); event.preventDefault(); return; }`. Keep it inside the existing `!__goldfinchInternal` block.

2. **`print` IPC handler (`src/main/main.js`)** — add `ipcMain.on('print', …)` right after the `zoom-apply` handler (`main.js:871-876`), copying its resolve + destroyed + internal-session guards (mirror the `zoom-apply` comment style noting the renderer already filters internal and this is defense-in-depth), ending in `wc.print({}, (ok, reason) => { if (!ok) console.warn('print failed:', reason); })`.

3. **Preload (`src/preload/chrome-preload.js` + `renderer-globals.d.ts`)** — add `print: ({ webContentsId }) => ipcRenderer.send('print', { webContentsId })` next to `zoomApply`; add the method to the `GoldfinchBridge` typedef.

4. **Kebab item (`src/renderer/index.html` + `src/renderer/renderer.js`)** — add `<button id="kebab-print" class="cm-item" role="menuitem" tabindex="-1">Print…</button>` to `#kebab-menu` (use `tabindex="-1"` like `#kebab-exit`; only the first item is `0`); add a click handler near the other kebab item handlers (`~renderer.js:351-358`): `els.kebabMenu.querySelector('#kebab-print')?.addEventListener('click', () => { closeKebabMenu(); const t = activeTab(); if (t && !isInternalTab(t) && t.wcId != null) window.goldfinch.print({ webContentsId: t.wcId }); });`. The new item is picked up automatically by the `kebabItems()` `[role="menuitem"]` getter — no `menuController` change. Update the now-stale comment at `renderer.js:304` ("two static role=menuitem items (Settings, Exit)") to reflect three items.

5. **`src/main/automation/print.js`** (new) — mirror `captureScreenshot`:
   ```js
   const { resolveContents, classifyContents, isInternalContents } = require('./resolve');

   // Minimal paint-settle: a not-yet-painted guest can otherwise stall printToPDF.
   // (Mirror observe.js's waitForPaint; if that helper is exported, prefer importing it
   //  over duplicating — keep the default ~80ms.)
   function waitForPaint(_wc, { delayMs = 80 } = {}) {
     return new Promise((r) => setTimeout(r, delayMs));
   }

   async function printToPDF(wcId, deps, _opts = {}) {
     const { chromeContents, activate } = deps;
     let wc = resolveContents(wcId, deps);
     if (isInternalContents(wc)) throw new Error('automation: printToPDF — internal-session excluded');
     if (classifyContents(wc, chromeContents) === 'guest' && typeof activate === 'function') {
       await activate(wcId);
       wc = resolveContents(wcId, deps);            // post-activate stale-handle re-resolve
       await waitForPaint(wc);                       // fixed default paint-settle
     }
     const buf = await wc.printToPDF({});            // Electron ^42: options arg required
     return buf.toString('base64');
   }
   ```
   - **Single op-local guard, before `activate`** — refuses internal *before* foregrounding it (stricter than `evaluate`, which guards only on the final wc). No second guard after re-resolve: the internal-session identity is invariant across re-resolve, so one is sufficient.
   - v1 passes Electron's default print options (`printToPDF({})`) — do NOT expose page-range/header-footer/paper-size (out of scope). The `_opts` param is reserved for forward-compat (print options only); paint delay is **fixed at the default**, NOT read from `_opts` — keep the two concerns separate so adding print options later can't accidentally retune the paint wait. The MCP `call` passes no opts, so `_opts` is always `{}` today.
   - `observe.js` does **not** export `defaultWaitForPaint` (verified — its `module.exports` lists only ops), so the small local `waitForPaint` above is necessary and correct; there is no shared util to reuse.

6. **Engine + MCP tool** — `require('./print')` alongside the other op requires (`engine.js:8-12`); add `printToPDF: (/** @type {number} */ wcId) => print.printToPDF(wcId, deps())` to the dispatch map after `closeDevTools` (`engine.js:85`), grouping it with the read-style ops. (No `opts` threaded — v1 exposes none; the op defaults `_opts={}`.) Add the flat-schema `printToPDF` ToolDef to `DRIVE_TOOLS` (after `setZoom`), default `okResult` (no `shape`). Bump the count comments: `mcp-tools.js:92` (`drive ops (14)` → `(15)`) and the `~:463-465` block (`= 23` → `= 24`, mention printToPDF).

7. **Tests** — new `test/unit/automation-print.test.js` (copy the observe base64-op style: fake guest wc with `async printToPDF(opts) { this._opts = opts; return Buffer.from('PDFBYTES'); }`, `makeInternalWc` with the same plus `session.__goldfinchInternal:true`, deps `{ fromId, chromeContents:null, activate }`). Bump `automation-mcp-tools.test.js` (DRIVE_NAMES, 23→24, comment) and `automation-mcp-server.test.js` (`EXPECTED_TOOL_COUNT` 24).

## Edge Cases
- **Internal tab via every path**: keyboard `Ctrl+P` (listener not attached to internal session), kebab (renderer `isInternalTab` guard), `print` IPC (main internal-session guard), and `printToPDF` op (op-local guard, even under admin) all refuse internal — four independent guards.
- **`printToPDF` Buffer vs base64**: the op MUST return `buf.toString('base64')` (a string), not the Buffer, and the tool MUST NOT set `shape` — otherwise the client sees `{"type":"Buffer",…}` or a broken image block.
- **Not-yet-painted / background guest**: foreground-first activate + paint wait prevents a hang; re-resolve guards against a stale handle.
- **Kebab Print… on internal tab**: no-ops cleanly (guarded); the item may remain visible (v1 keeps it simple — no disabled-state styling required, matching how zoom no-ops silently on internal).
- **`wcId == null`** (pre-dom-ready tab): kebab handler no-ops.
- **Print dialog is modal/OS-native**: the `print()` call returns immediately; goldfinch does not (and cannot in-apparatus) assert the dialog — that's the manual SC2 check.

## Files Affected
- `src/main/main.js` — `Ctrl+P` branch in the `before-input-event` handler; `ipcMain.on('print', …)`.
- `src/preload/chrome-preload.js` — `print()` send. `renderer-globals.d.ts` — typedef.
- `src/renderer/index.html` — `#kebab-print` item.
- `src/renderer/renderer.js` — `#kebab-print` click handler (internal-guarded).
- `src/main/automation/print.js` — NEW: `printToPDF` op (foreground-first, op-local internal guard, base64).
- `src/main/automation/engine.js` — register `printToPDF` + `require('./print')`.
- `src/main/automation/mcp-tools.js` — `printToPDF` flat-schema tool; bump count comments (14→15 drive, 23→24).
- `test/unit/automation-print.test.js` — NEW.
- `test/unit/automation-mcp-tools.test.js` — DRIVE_NAMES +`printToPDF`, count 23→24, **test-title string** ("23 tools (14 drive…)"→"24…(15 drive…)").
- `test/unit/automation-mcp-server.test.js` — `EXPECTED_TOOL_COUNT` 23→24 **and the literal "23" title strings**.
- *(Docs — README shortcuts (add `Ctrl+P`) + `docs/mcp-automation.md` (add `printToPDF`) — are owned by the `verify-integration` leg, NOT here.)*

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`npm test`, lint, typecheck, a11y)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed` (Flight Director defers `completed` + commit to flight-end review)
- [ ] Check off this leg in flight.md (deferred to flight-end commit)
- [ ] (Not the final leg — do NOT commit)
