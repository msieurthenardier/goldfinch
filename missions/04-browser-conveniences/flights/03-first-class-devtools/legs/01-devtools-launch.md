# Leg: devtools-launch

**Status**: completed
**Flight**: [First-class DevTools](../flight.md)

## Objective

Give the human a non-MCP way to open/close Chromium DevTools (detached) for the active web tab —
via `F12` / `Ctrl+Shift+I` shortcuts (page-focused and chrome-focused) routed through a two-way
`toggle-devtools` IPC to a shared main-side open/close helper that the M03 MCP ops also call — with
web-content-only guarding on both paths and open/closed state read on demand from
`wc.isDevToolsOpened()`.

## Context

- **DD1** — User-facing open/close runs main-side via a **shared helper** factored from the M03 ops
  (`observe.js` `openDevTools`/`closeDevTools`: `wc.openDevTools({mode:'detach'})` / `wc.closeDevTools()`
  + the op-local `isInternalContents` guard). The renderer drives it with
  `window.goldfinch.toggleDevtools(wcId)` — an `ipcRenderer.invoke` (two-way) that returns the
  **post-toggle `wc.isDevToolsOpened()`** so the renderer can set button state from the authoritative
  value. A companion `isDevtoolsOpen(wcId)` invoke serves the on-activation reconcile (DD3, consumed by
  Leg 2). **The IPC carries the explicit `wcId` captured at call time; main acts on that `wcId`, never
  on `activeTab()` at receipt** (TOCTOU guard). The MCP ops keep their own entry but call the same helper.
- **DD2** — `F12` (no modifier) + `Ctrl+Shift+I`. Main `before-input-event` (`src/main/main.js`, the
  `contents.on('before-input-event', …)` registered inside `app.on('web-contents-created')`): `F12` needs
  its own branch **before** the `if (!(input.control || input.meta)) return;` modifier gate;
  `Ctrl+Shift+I` fits the gated section. Renderer chrome-focused fallback (`src/renderer/renderer.js`, the
  top-level `document.addEventListener('keydown', …)`): `F12` needs a branch **before** the `if (!mod)
  return;` gate; `Ctrl+Shift+I` in the gated section. Both guarded by `isInternalTab` + open-lightbox
  (the `Ctrl+F` pattern).
- **DD3** — Open/closed state is read on demand from `wc.isDevToolsOpened()`; the
  `devtools-opened`/`devtools-closed` events are a **live-update enhancement gated on the leg-1 spike**.
- **DD5** — Web-content-only on both human and agent paths (`isInternalContents` main-side;
  `isInternalTab` renderer-side). Shortcuts no-op on `goldfinch://`.
- **Carry-forward (Flight 2 D1)**: `found-in-page` fires **only** on the renderer-side `<webview>` tag,
  never on the main-process guest `webContents`. The spike below must establish the same fact for
  `devtools-opened`/`devtools-closed` before any event wiring is committed.
- This leg produces the launch mechanism only. The toolbar button, pin, Settings toggle, and native
  menu item are **Leg 2** (`devtools-toolbar-pin`), which consumes `toggleDevtools`/`isDevtoolsOpen`.

## Inputs

What exists before this leg runs:
- `src/main/automation/observe.js:openDevTools` / `:closeDevTools` — the M03 ops, each:
  `resolveContents(wcId, deps)` → `if (isInternalContents(wc)) throw` → `wc.openDevTools({mode:'detach'})`
  / `wc.closeDevTools()`. (`src/main/automation/observe.js:432-468`)
- `src/main/automation/resolve.js:isInternalContents` — `!!wc && !!wc.session &&
  wc.session.__goldfinchInternal === true`. ELECTRON-FREE module. (`resolve.js:28`)
- `src/main/main.js` — the `app.on('web-contents-created', …)` block wiring `before-input-event` for
  zoom/print/find on guest webviews, behind `if (!(contents.session?.__goldfinchInternal))`
  (`main.js:331-392`; handler at `main.js:357`, modifier gate at `main.js:359`).
- `src/main/main.js` — sibling chrome-IPC handlers to mirror: `ipcMain.on('zoom-apply', …)`
  (`main.js:892`), `ipcMain.handle('get-zoom', …)` (`main.js:907`), `ipcMain.on('print', …)`
  (`main.js:917`). Each does `webContents.fromId(id)` → dead/missing guard → `__goldfinchInternal`
  guard → act.
- `src/preload/chrome-preload.js` — the `goldfinch` bridge; zoom precedent: `zoomApply` (one-way
  `send`) + `getZoom` (`invoke`) at `chrome-preload.js:58-62`.
- `src/renderer/renderer.js` — `document.addEventListener('keydown', …)` chrome fallback
  (`renderer.js:2198`, gate `if (!mod) return;` at `:2200`, `Ctrl+F` branch at `:2214`); `activeTab()`
  (`:603`); `isInternalTab(tab)` (`:608`); `wireWebview(tab)` event wiring (`:683`, e.g.
  `wv.addEventListener('dom-ready', …)` at `:686`); `activateTab(id)` (`:572`).

## Outputs

What exists after this leg completes:
- A shared main-side DevTools open/close helper (new function, e.g. `toggleDevTools(wc)` /
  `setDevTools(wc, open)`) applying `{mode:'detach'}` + the `isInternalContents` guard, callable from
  both the new IPC handler and the M03 ops. Location: a small main-side module (e.g.
  `src/main/devtools.js`) or an exported helper the ops import — chosen to keep `observe.js` and
  `main.js` both able to call ONE implementation. (Implementer's call; see Implementation Guidance.)
- `src/preload/chrome-preload.js` — `toggleDevtools({ webContentsId })` and `isDevtoolsOpen({
  webContentsId })`, both `ipcRenderer.invoke` (two-way), mirroring `getZoom`.
- `src/main/main.js` — `ipcMain.handle('toggle-devtools', …)` and `ipcMain.handle('is-devtools-open',
  …)`, each resolving the **passed `webContentsId`** (not `activeTab()`), guarding dead/internal,
  toggling/reading via the shared helper, returning the authoritative `wc.isDevToolsOpened()`.
- `src/main/main.js` — `F12` (pre-gate branch) + `Ctrl+Shift+I` (gated branch) added to the guest
  `before-input-event` handler, opening DevTools via the shared helper main-side.
- `src/renderer/renderer.js` — `F12` (pre-`!mod`-return branch) + `Ctrl+Shift+I` (gated branch) in the
  chrome keydown handler, guarded by `isInternalTab` + open-lightbox, calling `toggleDevtools`.
- **Spike outcome wired or documented**: if `devtools-opened`/`devtools-closed` fire reliably, the
  listener is wired at whichever side the spike confirms (guest `contents.on` at `main.js:331` block,
  and/or `<webview>` `wv.addEventListener` in `wireWebview`); otherwise on-demand `isDevtoolsOpen` only,
  with the spike result recorded in the flight log.
- Unit tests covering the shared helper's guard + toggle behavior; the M03 op tests still pass
  unchanged (the ops now delegate to the helper).

## Acceptance Criteria

- [x] **Spike done & recorded**: the flight log records which side(s) `devtools-opened`/`devtools-closed`
  fire on for a `<webview>` guest (main-process guest `webContents` via `contents.on`, and/or the
  renderer `<webview>` tag via `wv.addEventListener`), with the wiring decision that follows (wire where
  it fires; else on-demand only). Method and raw observation noted. **POSITIVE — both sides fire; wired
  the guest `contents.on` side. See flight log.**
- [x] A single shared main-side helper performs the actual open/close (`{mode:'detach'}`) + the
  `isInternalContents` guard, and is called by BOTH the new `toggle-devtools` IPC handler AND the M03
  `openDevTools`/`closeDevTools` ops (one code path; no duplicated guard logic). **`src/main/devtools.js`
  `setDevTools`/`toggleDevTools`; the predicate `isInternalContents` is single-sourced, applied by each
  caller with its contract-appropriate response (ops throw, IPC returns false).**
- [x] `window.goldfinch.toggleDevtools({ webContentsId })` exists, is a two-way `invoke`, and resolves to
  the **post-toggle** `wc.isDevToolsOpened()` boolean. `window.goldfinch.isDevtoolsOpen({ webContentsId
  })` exists and resolves to the current `wc.isDevToolsOpened()` boolean.
- [x] The `toggle-devtools` / `is-devtools-open` main handlers act on the **passed `webContentsId`**,
  never re-resolving via `activeTab()`/the foreground tab (TOCTOU guard — verifiable by code inspection
  and a unit test passing a non-active wcId). **Handlers use `webContents.fromId(webContentsId)`;
  `activeTab` is renderer-only and not in main-process scope.**
- [x] Both IPC handlers guard a dead/missing target (return a safe value, e.g. `false`/`null`, no throw)
  and refuse an internal-session target via `isInternalContents` (no DevTools opened on `goldfinch://`).
- [x] `F12` opens/toggles DevTools (detached) for the active web tab when the **page is focused**
  (main `before-input-event`, branch placed before the modifier gate) and when the **chrome is focused**
  (renderer keydown, branch placed before `if (!mod) return;`). `Ctrl+Shift+I` does the same from the
  gated sections of both handlers.
- [x] On a `goldfinch://` internal tab, `F12` / `Ctrl+Shift+I` open nothing (both paths no-op via
  `isInternalContents` / `isInternalTab`); when a lightbox is open, the renderer shortcut defers (mirrors
  `Ctrl+F`).
- [x] `isDevtoolsOpen` is **exposed but intentionally not yet wired** into `activateTab` (its consumer is
  Leg 2's button reconcile) — present, not dead code; a reviewer should not flag the unused bridge.
- [x] Held `F12` / `Ctrl+Shift+I` (auto-repeat) does NOT rapid-toggle DevTools: the main-side branches
  guard `input.isAutoRepeat` (the renderer keydown fires once per press, so no guard needed there).
- [x] No new MCP tool is registered and the MCP tool count is unchanged (the human path reuses
  `webContents` methods via chrome IPC — verify against the M03 surface: still 26 tools). **The
  `listTools returns exactly the 26 tools` unit test stays green.**
- [x] `npm test`, `npm run typecheck`, and `npm run lint` pass. **840 tests pass; typecheck + lint clean.**

## Verification Steps

- **Spike**: temporarily attach `contents.on('devtools-opened'/'devtools-closed', …)` at the guest-attach
  site and `wv.addEventListener('devtools-opened'/'devtools-closed', …)` in `wireWebview`, with a
  `console.log` in each; run `npm run dev`, open DevTools on a web tab via the new `F12`, observe which
  log(s) fire on open and on close (incl. closing from the DevTools window's own control). Record raw
  result in the flight log; keep the wiring that fires, remove the rest.
- **Shared helper / one code path**: `grep -n "openDevTools\|closeDevTools\|isDevToolsOpened" src/main`
  — confirm the actual `wc.openDevTools({mode:'detach'})` / `wc.closeDevTools()` calls live in exactly
  one helper that both `observe.js` and the IPC handler call.
- **TOCTOU**: unit test calls the toggle handler logic with a `wcId` that is NOT the active tab and
  asserts it acts on that contents (e.g. a fake `fromId` returning a tagged contents); inspect the
  handler for any `activeTab()` reference.
- **Internal guard**: unit test the helper/handler with a fake internal contents
  (`session.__goldfinchInternal === true`) → no open/close call, safe return.
- **Shortcuts (manual / HAT-adjacent)**: `npm run dev`; on a web tab press `F12` (page focused) →
  detached DevTools opens; press again → closes. Focus the address bar, press `F12` → same. Press
  `Ctrl+Shift+I` → same. Navigate to a `goldfinch://` tab → `F12` opens nothing.
- **Tool count**: with `npm run dev:automation`, confirm the surface still advertises 26 tools (no new
  DevTools tool added).
- `npm test` / `npm run typecheck` / `npm run lint`.

## Implementation Guidance

1. **Run the spike FIRST** (before writing the helper). Decide event wiring per the result. This is the
   Flight-2 D1 lesson applied up front — do not assume `devtools-opened` fires on the guest
   `webContents`; prove it. If neither side fires reliably, the design degrades to on-demand
   `isDevtoolsOpen` (DD3 / Adaptation Criteria — a pre-authorized acceptable variation, not a divert).

2. **Factor the shared helper.** Pull the `{mode:'detach'}` open/close **mechanics** out of
   `observe.js:openDevTools`/`closeDevTools` into one main-side helper. **Preferred location: a new
   `src/main/devtools.js`** — it keeps `observe.js`'s deliberate electron-free-at-top property intact
   (the helper only calls methods on a passed `wc`, so it imports no electron either way). Keep it
   `webContents`-in (the caller resolves the wcId first):
   - The helper exposes the mechanics + the toggle/read: `setDevTools(wc, open)` (calls
     `wc.openDevTools({mode:'detach'})` or `wc.closeDevTools()`) and `toggleDevTools(wc)` (reads
     `wc.isDevToolsOpened()`, flips, returns the post-state boolean).
   - **Guard ownership (pinned, resolving the reviewer's Q2):** the helper assumes a **pre-guarded
     `wc`** and does NOT itself apply `isInternalContents`. The *predicate* `isInternalContents` is the
     single shared guard (already exported from `resolve.js`), but each caller applies it with its
     **contract-appropriate response**: the MCP ops keep their `throw 'automation: … internal-session
     excluded'` (preserves the op test contract); the IPC handler `return false`. So "one code path"
     means the open/close **mechanics** live in one helper; the **predicate** is one function; only the
     failure *response* differs by caller (it must — void-throw vs boolean-return are different
     contracts). No duplicated mechanics, no duplicated predicate.
   - `observe.js` ops: `resolveContents(wcId, deps)` → keep `if (isInternalContents(wc)) throw …` →
     call `setDevTools(wc, true)` / `setDevTools(wc, false)`. Their existing tests
     (`test/unit/automation-observe.test.js`) assert the `{mode:'detach'}` call + the refusal message —
     both preserved.
   - The new IPC handler: `webContents.fromId(id)` → dead/missing guard → `isInternalContents` →
     `return false` → else `toggleDevTools(wc)`.
   - Note: `observe.js`'s ops are explicit open/close (not toggles) — preserve that op contract; the
     toggle semantics are the human-path addition. Reuse the open/close mechanics only.

3. **Add the preload bridges** in `chrome-preload.js`, in the `--- page zoom ---`/print neighborhood,
   mirroring `getZoom`:
   ```js
   // --- devtools (human path; agent path is the MCP openDevTools/closeDevTools ops) ---
   toggleDevtools: ({ webContentsId }) => ipcRenderer.invoke('toggle-devtools', { webContentsId }),
   isDevtoolsOpen: ({ webContentsId }) => ipcRenderer.invoke('is-devtools-open', { webContentsId }),
   ```

4. **Add the main IPC handlers** near `get-zoom`/`print` (`main.js:907-924`), mirroring their
   resolve→dead-guard→internal-guard shape, but acting on the **passed** id:
   ```js
   ipcMain.handle('toggle-devtools', (_e, { webContentsId }) => {
     const wc = typeof webContentsId === 'number' ? webContents.fromId(webContentsId) : null;
     if (!wc || wc.isDestroyed()) return false;
     if (isInternalContents(wc)) return false;            // DD5; never on goldfinch://
     return toggleDevTools(wc);                           // shared helper → post-toggle isDevToolsOpened()
   });
   ipcMain.handle('is-devtools-open', (_e, { webContentsId }) => {
     const wc = typeof webContentsId === 'number' ? webContents.fromId(webContentsId) : null;
     if (!wc || wc.isDestroyed()) return false;
     if (isInternalContents(wc)) return false;
     return wc.isDevToolsOpened();
   });
   ```
   Import `isInternalContents` from `automation/resolve.js` (it is ELECTRON-FREE and already exported at
   `resolve.js:160`). **Documented divergence (reviewer [low]):** the sibling handlers
   (zoom-apply/get-zoom/print) inline `wc.session?.__goldfinchInternal`; this handler instead imports the
   shared predicate so the human path and the MCP ops use the *same* internal-detection function — a
   deliberate choice to keep the DevTools internal-guard single-sourced with the ops it shares a helper
   with. Add a one-line comment at the import noting this. (`webContents` is already destructured from
   electron at `main.js:3`; no new electron import needed.)

5. **Wire `F12` / `Ctrl+Shift+I` main-side** in the guest `before-input-event` handler
   (`main.js:357`). The outer `if (!(contents.session?.__goldfinchInternal))` at `:356` already excludes
   internal sessions (DD5). Inside, AFTER `if (input.type !== 'keyDown') return;` (`:358`) but BEFORE the
   modifier gate `if (!(input.control || input.meta)) return;` (`:359`). **It must sit BETWEEN `:358`
   and `:359`** — after the `keyDown` filter (so a `keyUp` F12 doesn't also fire) but before the modifier
   gate (F12 has no modifier). Guard `input.isAutoRepeat` so a held key doesn't rapid-toggle:
   ```js
   if (input.key === 'F12') {                 // modifier-less — between the keyDown filter and the modifier gate
     if (!input.isAutoRepeat) toggleDevTools(contents);  // contents is the guest wc; no rapid-toggle on hold
     event.preventDefault();
     return;
   }
   ```
   Then in the gated section (after `:359`), add a `Ctrl+Shift+I` branch (same auto-repeat guard):
   ```js
   if (input.control && input.shift && (input.key === 'I' || input.key === 'i')) {
     if (!input.isAutoRepeat) toggleDevTools(contents);
     event.preventDefault();
     return;
   }
   ```
   Place it alongside the existing print/find branches. (`contents` here is already the guest
   `webContents`, so the helper can act directly — no `fromId`.)

6. **Wire `F12` / `Ctrl+Shift+I` renderer-side** in the chrome keydown handler (`renderer.js:2198`).
   `F12` must be handled BEFORE `if (!mod) return;` (`:2200`); `Ctrl+Shift+I` after it. Mirror the
   `Ctrl+F` guards (`:2214-2221`):
   ```js
   if (e.key === 'F12') {                            // before the !mod gate
     if (!els.lightbox.classList.contains('hidden')) return;
     const t = activeTab();
     if (!t || isInternalTab(t) || t.wcId == null) return;
     e.preventDefault();
     window.goldfinch.toggleDevtools({ webContentsId: t.wcId });
     return;
   }
   ```
   …and add `Ctrl+Shift+I` as a **new `else if` in the existing chain** (`renderer.js:2214-2242`:
   `if (e.key==='f'…) {…} else if (e.key==='t') … else if (e.shiftKey && (e.key==='P'||'p')) {togglePrivacy} … else if (e.key==='r') …`).
   The new branch is `else if (e.shiftKey && (e.key === 'I' || e.key === 'i'))` — the key letter
   disambiguates it from the existing `Shift+P` (togglePrivacy) branch, so chain order is safe; it must be
   a chain member, NOT a separate `if` (a separate `if` would double-handle). Inside, the same
   `activeTab`/`isInternalTab`/lightbox guards, then `window.goldfinch.toggleDevtools({ webContentsId:
   t.wcId })`. (The renderer keydown fires only on `keydown`, so no auto-repeat guard is needed here — the
   auto-repeat concern is main-side only.)

7. **Event wiring per spike** (only if it fires): guest side — add `contents.on('devtools-opened', …)`
   / `('devtools-closed', …)` in the `app.on('web-contents-created')` block; renderer side — add
   `wv.addEventListener('devtools-opened'/'devtools-closed', …)` in `wireWebview`. **Seam shape pinned
   (reviewer suggestion):** this leg does NOT define a Leg-2 consumer. If the spike is **positive**, wire
   the listener and have it `mainWindow.webContents.send('devtools-state-changed', { wcId, open })` (a new
   chrome→renderer event mirroring `onZoomChanged`), and add the matching `onDevtoolsStateChanged` bridge
   to `chrome-preload.js` — Leg 2 subscribes to it for live button updates. If the spike is **negative**,
   wire NOTHING (no event, no bridge) and rely solely on on-demand `isDevtoolsOpen` (Leg 2 reconciles on
   tab activation per DD3). Either way, record the decision in the flight log so Leg 2 knows whether the
   live-update event exists.

8. **Tests**: add unit coverage for the shared helper (open/close/toggle return values; internal-guard
   refusal; dead-contents safety). Keep `observe.js` op tests green. No MCP registration changes.

## Edge Cases

- **`F12` is the first modifier-less shortcut intercepted** in both handlers — a documented exception to
  the "modifier-gated" convention. Main-side it MUST sit between the `keyDown` filter (`:358`) and the
  modifier gate (`:359`) — before the gate (else it never fires) but after the keyDown filter (else a
  `keyUp` F12 double-fires). Renderer-side it MUST sit before `if (!mod) return;` (`:2200`). One-line
  comment at each site noting why it precedes the gate.
- **Auto-repeat on hold**: Electron's main-side `before-input-event` emits repeated `keyDown`s while a key
  is held; without an `input.isAutoRepeat` guard a held `F12`/`Ctrl+Shift+I` would rapid-toggle DevTools
  open/closed. Guard it main-side. The renderer DOM `keydown` does not have this exposure for a toggle that
  calls an async IPC, but holding could still queue invokes — the main-side `isAutoRepeat` guard is the
  authoritative fix since both paths converge on `toggleDevTools`.
- **Toggle race / TOCTOU**: the active tab can change between the renderer reading `activeTab().wcId` and
  main handling the invoke. The handler acts on the passed `wcId`, so a late switch toggles the tab the
  user actually targeted — correct. Never read `activeTab()` in the handler.
- **DevTools closed from its own window control**: with events absent (negative spike), the button (Leg
  2) will lag until next tab activation — acceptable per DD3. This leg only needs `isDevtoolsOpen` to
  return truth on demand.
- **Internal tab**: `isInternalContents` (main) / `isInternalTab` (renderer) both refuse; assert no
  `openDevTools` call occurs. Admin allowInternal does NOT apply here — the human path never sets it.
- **`closeDevTools` idempotency**: `wc.closeDevTools()` on a non-open contents is a no-op in Electron
  (does not throw); the toggle reads `isDevToolsOpened()` first anyway.
- **Modifier-less `F12` vs. the gated `=`/`-`/`0`/`p`/`f` branches**: ensure the `F12` early-return does
  not swallow other keys — it only matches `input.key === 'F12'`.

## Files Affected

- `src/main/automation/observe.js` — refactor `openDevTools`/`closeDevTools` to call the shared helper
  (op contract unchanged).
- `src/main/devtools.js` *(new, or an exported helper added to an existing main module)* — the shared
  open/close/toggle helper + guard.
- `src/main/main.js` — `toggle-devtools` + `is-devtools-open` IPC handlers; `F12`/`Ctrl+Shift+I` in the
  guest `before-input-event`; (optional) guest `devtools-opened`/`devtools-closed` listener per spike;
  import `isInternalContents`.
- `src/preload/chrome-preload.js` — `toggleDevtools` + `isDevtoolsOpen` bridges.
- `src/renderer/renderer.js` — `F12`/`Ctrl+Shift+I` in the chrome keydown handler; (optional)
  `wv.addEventListener('devtools-opened'/'devtools-closed', …)` in `wireWebview` per spike.
- `test/unit/…` — shared-helper unit tests; keep observe-op tests green.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:** *(Note — under `/agentic-workflow`, commit is
deferred to flight end; this leg lands `in-flight`→`landed`, updates the flight log, and does NOT commit
or signal `[COMPLETE:leg]`.)*

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)
- [x] Update flight-log.md with the spike result + leg progress entry
- [x] Set this leg's status to `landed` (deferred-commit workflow)
- [x] Signal `[HANDOFF:review-needed]` is NOT used per-leg here; the Developer stops after updating the
  flight log (flight-level review happens after the last autonomous leg)

## Citation Audit

7 citations verified against current code at leg design time (all `OK`):
- `observe.js:432-468` openDevTools/closeDevTools — confirmed (op bodies match the described
  resolve→guard→`{mode:'detach'}` shape).
- `resolve.js:28` isInternalContents — confirmed verbatim.
- `main.js:357` before-input-event handler; `:359` modifier gate `if (!(input.control||input.meta))
  return;` — confirmed; outer internal skip at `:356`.
- `main.js:892/907/917` zoom-apply/get-zoom/print handlers — confirmed (the resolve→guard→act pattern
  the new IPC handlers mirror).
- `main.js:929` toolbar-context-menu (`item !== 'media' && item !== 'shields'`) — confirmed (Leg 2's
  surface; cited for context).
- `chrome-preload.js:58-62` zoomApply/getZoom bridges — confirmed.
- `renderer.js:2198` chrome keydown (`:2200` `if (!mod) return;`, `:2214` Ctrl+F branch), `:603`
  activeTab, `:608` isInternalTab, `:572` activateTab, `:683` wireWebview — confirmed. (Flight cited the
  renderer landmarks at ~`:2198`/`:1681`/`:608`; `applyToolbarPins` is at `:1681`, `isInternalTab` at
  `:608`, keydown at `:2198` — all current.)
