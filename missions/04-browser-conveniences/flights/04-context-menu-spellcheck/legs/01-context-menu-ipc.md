# Leg: context-menu-ipc

**Status**: completed
**Flight**: [Custom Page Context Menu + Spellcheck](../flight.md)

## Objective

Establish the IPC / event plumbing for a custom page context menu: capture the Electron
`context-menu` event on the guest web content (inside the existing `!__goldfinchInternal` guard in
`app.on('web-contents-created')`), `event.preventDefault()` the native OS menu, and forward the full
rich `params` keyed by `wcId` to the chrome renderer via
`mainWindow.webContents.send('page-context-menu', { wcId, params })` (mirroring the
`zoom-changed`/`devtools-state-changed` broadcast). Add a **correction round-trip channel**
(chrome→main→guest `contents.replaceMisspelling(word)`) that resolves the target by the originating
`wcId` and refuses the internal session, plus the matching `chrome-preload.js` bridges. **First step:
a ~5-min spike** (DD8) confirming the delivery side + payload before any wiring is committed. This leg
produces the IPC/event plumbing ONLY — the `#page-context-menu` DOM rendering is Leg 4
(`context-menu-component`).

## Context

- **DD2** — The custom page context menu is delivered guest `context-menu` event (main) → IPC → chrome
  renderer. The Electron `context-menu` event is expected to fire on the **main-process guest
  `webContents`** with rich `params` (`linkURL`, `imageURL`, `selectionText`, `isEditable`,
  `misspelledWord`, `dictionarySuggestions`, `x`, `y`, `editFlags`). Wire it in the
  `app.on('web-contents-created')` block, inside the existing `!__goldfinchInternal` guard, alongside
  `before-input-event`/`devtools-state-changed`; `event.preventDefault()` the native menu; forward the
  params to the chrome renderer via `mainWindow.webContents.send('page-context-menu', { wcId, params })`
  (mirroring the `zoom-changed`/`devtools-state-changed` broadcast). **The Leg-1 spike (DD8) confirms
  the delivery side first.**
- **DD6** — Web-content-only; the menu is inert/absent on internal pages. The whole `context-menu`
  wiring sits inside the `!__goldfinchInternal` guard, so internal guests never get the custom menu
  (default behavior / nothing). The correction round-trip (`replaceMisspelling`) likewise resolves the
  target by the originating guest `wcId` and **refuses the internal session** (`isInternalContents`) —
  it must NOT become a write-into-arbitrary-`webContents` primitive (the Flight-3 TOCTOU discipline:
  act on the passed `wcId`, never re-resolve via `activeTab()`).
- **DD8** — Behavior-test apparatus / spike. The `context-menu` event must be spiked before depending
  on a delivery side: confirm it fires on the guest `webContents` with the full rich payload, and
  **whether it also surfaces on the `<webview>` tag** (if so, prefer the renderer-direct path over the
  main→IPC round-trip). Pre-authorized fallback: guest-only → main→IPC as designed.
- **Carry-forward (Flight-2 D1 / Flight-3 spike lesson)**: `<webview>` event delivery is
  per-event-class — `found-in-page` fired **renderer-tag-only**; `devtools-opened`/`devtools-closed`
  fired **both sides** (Flight-3 Leg-1 spike was POSITIVE on the guest `contents.on` side; see
  `src/main/main.js:414-424`). Do not assume `context-menu` matches either — prove it.
- **Adaptation Criteria (flight)**: *Divert if* the `context-menu` event does not deliver the rich
  params on any reachable side (spike fails both guest `webContents` and `<webview>` tag) — re-plan the
  param path before building the menu. *Acceptable variation*: the event surfaces on the `<webview>`
  tag too → prefer the renderer-direct path.
- This leg produces the IPC/event plumbing ONLY. The `#page-context-menu` DOM node,
  `menuController.register`, context-appropriate sections, Inspect, spelling-suggestion rendering, and
  the Shift+F10 invocation are **Leg 4** (`context-menu-component`), which consumes the
  `onPageContextMenu` subscription and the correction send added here.

## Inputs

What exists before this leg runs:
- `src/main/main.js` — the `app.on('web-contents-created', …)` block (`main.js:337`), with the guest
  `before-input-event` handler registered behind `if (!(/** @type {any} */
  (contents.session)?.__goldfinchInternal))` (internal guard at `main.js:362`,
  `contents.on('before-input-event', …)` at `main.js:363`). The DevTools live-state broadcast
  (`devtools-state-changed`) is wired inside the **same** guard at `main.js:414-424` —
  `mainWindow.webContents.send('devtools-state-changed', { wcId: contents.id, open })` — the exact
  guest-event→chrome-broadcast pattern this leg mirrors.
- `src/main/main.js` — the `zoom-changed` broadcast inside `applyZoom`:
  `if (mainWindow) mainWindow.webContents.send('zoom-changed', { wcId: wc.id, factor: next })`
  (`main.js:329`).
- `src/main/main.js` — sibling DevTools IPC handlers to mirror for the correction channel:
  `ipcMain.handle('toggle-devtools', (_e, { webContentsId }) => …)` (`main.js:968`) and
  `ipcMain.handle('is-devtools-open', …)` (`main.js:975`). Each does
  `webContents.fromId(webContentsId)` → dead/destroyed guard (`return false`) →
  `if (isInternalContents(wc)) return false` → act on the passed id (never `activeTab()`).
- `src/main/main.js` — `webContents` is already destructured from electron at `main.js:3`
  (`const { app, BrowserWindow, Menu, ipcMain, session, webContents, … } = require('electron')`); no
  new electron import needed.
- `src/main/main.js` — `isInternalContents` is already imported at `main.js:26`
  (`const { isInternalContents } = require('./automation/resolve')`).
- `src/main/automation/resolve.js` — `isInternalContents(wc)` → `!!wc && !!wc.session &&
  wc.session.__goldfinchInternal === true` (strict `=== true`). ELECTRON-FREE module; exported at
  `resolve.js:160` (defined `resolve.js:28`).
- `src/preload/chrome-preload.js` — the `goldfinch` bridge. Subscription precedent:
  `onZoomChanged: (cb) => ipcRenderer.on('zoom-changed', (_e, d) => cb(d))` (`chrome-preload.js:59`) and
  `onDevtoolsStateChanged: (cb) => ipcRenderer.on('devtools-state-changed', (_e, d) => cb(d))`
  (`chrome-preload.js:77`). Send precedent: `zoomApply` (one-way `send`, `chrome-preload.js:58`),
  `toggleDevtools` (two-way `invoke`, `chrome-preload.js:72`). `ipcRenderer`/`contextBridge` are
  required at `chrome-preload.js:6`.
- `src/main/main.js` — the native `toolbar-context-menu` handler (`ipcMain.on('toolbar-context-menu',
  …)`, `main.js:985`) builds and pops the **native** Electron menu via
  `Menu.buildFromTemplate`/`menu.popup`. Untouched by this leg (retired in Leg 5).

## Outputs

What exists after this leg completes:
- **Spike outcome recorded** in `flight-log.md`: which side(s) `context-menu` fires on for a
  `<webview>` guest (main-process guest `webContents` via `contents.on('context-menu', …)`, and/or the
  renderer `<webview>` tag via `wv.addEventListener('context-menu', …)`), the observed `params` shape
  (which of `dictionarySuggestions`/`misspelledWord`/`isEditable`/`linkURL`/`imageURL`/`selectionText`/
  `x`/`y`/`editFlags` are populated), and the wiring decision that follows.
- `src/main/main.js` — inside the existing `!__goldfinchInternal` guard in
  `app.on('web-contents-created')` (the same block as `before-input-event` /
  `devtools-state-changed`): `contents.on('context-menu', (event, params) => …)` that
  `event.preventDefault()`s the native menu and forwards `mainWindow.webContents.send(
  'page-context-menu', { wcId: contents.id, params })`. (Or, if the spike proves the `<webview>`-tag
  path is sufficient/preferable, the equivalent renderer-direct wiring per DD8 — recorded in the log.)
- `src/main/main.js` — a new correction-channel IPC handler (chrome→main→guest), near the DevTools
  handlers (`main.js:968-980`), mirroring their `fromId` → dead-guard → internal-guard → act-on-passed-id
  shape: resolve the **passed `webContentsId`**, `return` safely on dead/destroyed, refuse via
  `isInternalContents`, then call `wc.replaceMisspelling(word)` (and any edit-action correction).
- `src/preload/chrome-preload.js` — an `onPageContextMenu` subscription bridge (mirroring
  `onZoomChanged`/`onDevtoolsStateChanged`) and the correction **send** bridge (mirroring `zoomApply` /
  `toggleDevtools` per whether the correction needs a return).
- **No new MCP tool**; the MCP tool count is unchanged (still 26).

## Acceptance Criteria

- [x] **Spike done & recorded**: `flight-log.md` records which side(s) the Electron `context-menu`
  event fires on for a `<webview>` guest (main-process guest `webContents` via `contents.on`, and/or
  the renderer `<webview>` tag via `wv.addEventListener`), the **observed `params` payload** (which of
  `dictionarySuggestions`, `misspelledWord`, `isEditable`, `linkURL`, `imageURL`, `selectionText`, `x`,
  `y`, `editFlags` are present/populated), and the wiring decision that follows (wire where it fires
  with the full payload; prefer `<webview>`-tag direct if it carries the rich params). Method and raw
  observation noted. → **POSITIVE on BOTH sides** (GUI ran under WSLg); guest side wired per DD2
  primary design (auto-guarded for internal guests, DD6) — see flight-log spike table.
- [x] The guest `context-menu` event is captured on the side the spike confirms, **inside the existing
  `!__goldfinchInternal` guard** in `app.on('web-contents-created')` (same block as
  `before-input-event` / `devtools-state-changed`) — internal guests never reach the wiring (DD6).
- [x] The native OS context menu is suppressed: the handler calls `event.preventDefault()`.
- [x] `page-context-menu` IPC forwards the **full rich `params`** keyed by the originating `wcId` —
  `mainWindow.webContents.send('page-context-menu', { wcId, params })` — mirroring the
  `zoom-changed`/`devtools-state-changed` broadcast (no field-stripping; the menu component decides what
  to render).
- [x] The correction channel resolves the target by the passed `wcId` (never re-resolving via
  `activeTab()` — TOCTOU), **refuses the internal session** via `isInternalContents` (no write into a
  `goldfinch://` guest), and is NOT a general write-into-arbitrary-`webContents` primitive — it performs
  **`wc.replaceMisspelling(word)` only** (a single narrowly-typed action, `typeof word === 'string' &&
  word`) on a live, non-internal guest; dead/destroyed targets return safely without throwing. (Any
  edit-action correction — cut/copy/paste/undo/redo — is Leg 4's to add with its own action-allowlist,
  not this leg.)
- [x] Preload bridges exist in `chrome-preload.js`: `onPageContextMenu` (subscription, mirroring
  `onZoomChanged`/`onDevtoolsStateChanged`) and the correction send bridge.
- [x] No new MCP tool is registered and the MCP tool count is unchanged — still **26** (DD7;
  verifiable: `test/unit/automation-mcp-tools.test.js` "returns exactly the 26 tools" stays green).
- [x] `npm test`, `npm run typecheck`, and `npm run lint` pass. → 841 pass / 0 fail; typecheck clean;
  lint clean.

## Verification Steps

- **Spike**: temporarily attach `contents.on('context-menu', (e, params) => console.log('GUEST
  context-menu', JSON.stringify(params)))` at the guest site inside the `!__goldfinchInternal` block,
  and `wv.addEventListener('context-menu', e => console.log('TAG context-menu', e.params))` in
  `wireWebview` (renderer). Run `npm run dev`; right-click on a link, an image, plain selected text, and
  an editable field (`<input>`/`contenteditable`); observe which log(s) fire and dump the `params`.
  Record raw output in `flight-log.md`; keep the wiring that fires with the full payload, remove the
  rest.
- **Internal no-op**: navigate to a `goldfinch://` internal tab, right-click — confirm the custom
  wiring does not fire (the `!__goldfinchInternal` guard excludes it) and the existing behavior is
  unchanged. `isInternalContents` refuses any correction call targeting the internal session.
- **Correction refusal (unit/inspection)**: call the correction handler logic with a fake internal
  contents (`session.__goldfinchInternal === true`) → no `replaceMisspelling` call, safe return; with a
  dead/destroyed contents → safe return; with a `wcId` that is NOT the active tab → acts on that passed
  contents (inspect the handler for any `activeTab()` reference; there must be none).
- **IPC payload (manual / behavior-adjacent)**: with the menu component not yet built, log the
  forwarded `{ wcId, params }` in a temporary chrome-side subscription (or inspect via DevTools) to
  confirm the rich params arrive intact keyed by `wcId`.
- **Tool count**: `npm run dev:automation` → confirm the surface still advertises 26 tools (no new
  context-menu/spellcheck tool added).
- `npm test` / `npm run typecheck` / `npm run lint`.

## Implementation Guidance

1. **Run the spike FIRST** (before any production wiring). This is the Flight-2 D1 / Flight-3 Leg-1
   lesson applied up front — `found-in-page` fired renderer-tag-only; `devtools-*` fired both sides; do
   NOT assume `context-menu` matches either. Attach throwaway `console.log` listeners on **both** sides
   (guest `contents.on('context-menu', …)` inside the `!__goldfinchInternal` block at `main.js:362`;
   `<webview>` `wv.addEventListener('context-menu', …)` in `wireWebview`), exercise link / image /
   selection / editable targets, and dump `params`. Decide the delivery side per the result. If the
   `<webview>` tag carries the full rich payload, prefer the renderer-direct path (DD8 acceptable
   variation — it avoids the main→IPC round-trip; Leg 4 then subscribes to the tag event in the
   renderer instead of `onPageContextMenu`). If only the guest `webContents` carries it, wire the
   main→IPC path as designed below. If **neither** side delivers the rich params, STOP and follow the
   flight's Adaptation Criteria (divert / re-plan the param path) — do not improvise.

2. **Capture the guest `context-menu` event** inside the existing `!__goldfinchInternal` guard in
   `app.on('web-contents-created')` (`main.js:362`), in the same neighborhood as the
   `devtools-state-changed` listener (`main.js:414-424`) and the `before-input-event` handler
   (`main.js:363`). `contents` here is already the guest `webContents`, pre-guarded by the outer
   `!__goldfinchInternal` skip (DD6 — internal guests never reach this). Mirror the `devtools-opened`
   forwarding shape:
   ```js
   // Custom page context menu (DD2/DD6/DD8). Spike POSITIVE on <SIDE — record in flight log>.
   // Suppress the native OS menu and forward the rich params to the chrome renderer keyed by wcId
   // (mirrors the zoom-changed / devtools-state-changed broadcast). Inside the !__goldfinchInternal
   // guard, so internal goldfinch:// guests never get the custom menu (DD6). Leg 4 renders it.
   contents.on('context-menu', (event, params) => {
     event.preventDefault();                                  // retire the native OS menu (SC6)
     if (mainWindow) {
       mainWindow.webContents.send('page-context-menu', { wcId: contents.id, params });
     }
   });
   ```
   Forward the **whole `params`** object — do not pre-strip fields. The menu component (Leg 4) decides
   what to show from `linkURL`/`imageURL`/`selectionText`/`isEditable`/`misspelledWord`/
   `dictionarySuggestions`/`x`/`y`/`editFlags`. (If the spike chose the `<webview>`-tag path instead,
   wire the renderer-direct equivalent in `wireWebview` and skip the `page-context-menu` send — record
   the choice in the log so Leg 4 subscribes to the right source.)

3. **Add the correction round-trip IPC handler** (chrome→main→guest), placed near the DevTools handlers
   (`main.js:968-980`), mirroring their `fromId` → dead-guard → internal-guard → act-on-passed-id shape.
   This is the TOCTOU-disciplined write path (DD6): it acts on the **passed `webContentsId`**, never
   `activeTab()`, and refuses the internal session so it can never become a write-into-arbitrary-guest
   primitive:
   ```js
   // Spelling correction round-trip (DD2/DD6). chrome -> main -> guest. Acts on the PASSED webContentsId
   // (never activeTab() — TOCTOU). Refuses the internal session via the shared isInternalContents
   // predicate (DD6 — never write into a goldfinch:// guest). NOT a general write primitive: it only
   // performs the misspelling correction on a live, non-internal guest.
   ipcMain.on('page-context-correct', (_e, { webContentsId, word }) => {
     const wc = typeof webContentsId === 'number' ? webContents.fromId(webContentsId) : null;
     if (!wc || wc.isDestroyed()) return;
     if (isInternalContents(wc)) return;                      // DD6; never on goldfinch://
     if (typeof word === 'string' && word) wc.replaceMisspelling(word);
   });
   ```
   `webContents` is destructured at `main.js:3` and `isInternalContents` is imported at `main.js:26` —
   no new imports. Use a one-way `ipcMain.on('page-context-correct', …)` (mirrors `zoom-apply`/`print`).
   **Scope (design-review tightening):** this leg's correction channel performs `replaceMisspelling`
   **only** — a single, narrowly-typed action (`typeof word === 'string' && word`). Edit-action
   correction (cut/copy/paste/undo/redo via `wc.cut()`/`wc.paste()`/etc.) is **NOT** folded into this
   channel here: those actions are not subject to the misspelling-specific `word` guard and would need
   their own action-allowlist to stay non-general-write, so they are **Leg 4's to add** (it owns what the
   menu surfaces). Keeping Leg 1 to `replaceMisspelling` only makes this leg's trust surface exactly as
   narrow as its acceptance criteria claim.

4. **Add the preload bridges** in `chrome-preload.js`, in the zoom/devtools neighborhood
   (`chrome-preload.js:57-77`), mirroring `onZoomChanged`/`onDevtoolsStateChanged` for the subscription
   and `zoomApply` for the one-way send:
   ```js
   // --- page context menu (human/page path; rendered by the chrome menuController, Leg 4) ---
   // Subscription: fired by main's guest context-menu listener. Mirrors onZoomChanged /
   // onDevtoolsStateChanged. Payload { wcId, params }. Leg 4 renders #page-context-menu from it.
   onPageContextMenu: (cb) => ipcRenderer.on('page-context-menu', (_e, d) => cb(d)),
   // Correction round-trip: chrome -> main -> guest replaceMisspelling. One-way (no return). Main
   // acts on the passed webContentsId and refuses the internal session (DD6).
   correctMisspelling: ({ webContentsId, word }) =>
     ipcRenderer.send('page-context-correct', { webContentsId, word }),
   ```
   (If the spike chose the `<webview>`-tag path, the `onPageContextMenu` subscription may be unnecessary
   — Leg 4 reads the tag event directly; keep the correction bridge either way. Record the decision.)

5. **Do NOT** touch the native `toolbar-context-menu` handler (`main.js:985`) — that retirement is Leg 5
   (`migrate-toolbar-unpin`). Do NOT build any `#page-context-menu` DOM or `menuController.register` —
   that is Leg 4. Do NOT add an MCP tool (DD7).

6. **Spike-result wiring decision** must be recorded in `flight-log.md` so Leg 4 knows the param source
   (main→IPC `onPageContextMenu` vs. renderer-direct `<webview>`-tag event) — exactly as Flight-3 Leg-1
   recorded its `devtools-*` spike for Leg 2. Two facts to capture explicitly in that record for Leg 4:
   - **The correction round-trip is main-side either way.** `replaceMisspelling` is a method on the
     main-process guest `webContents`, so even if the spike picks the renderer-direct `<webview>`-tag
     *capture/forward* path, the chrome→main→guest correction channel built in step 3 is unchanged. The
     spike decision only changes where the *params* come from, not the correction path.
   - **DD6 internal-page enforcement on the tag path.** The guest-`webContents` capture path is
     auto-guarded by the outer `!__goldfinchInternal` skip. The `<webview>`-tag `context-menu` event,
     however, fires in the chrome renderer for **all** guests including internal `goldfinch://` tabs (the
     renderer has no session-level guard). So if the spike chooses the tag path, **Leg 4 must gate the
     custom menu on the tab's internal-ness in the renderer** (reuse `isInternalTab`) to honor DD6 — note
     this in the spike-decision record so Leg 4 does not inherit an unguarded internal-page menu.

## Edge Cases

- **Delivery-side asymmetry (the whole point of the spike)**: `<webview>` event delivery is
  per-event-class. `found-in-page` fired renderer-tag-only; `devtools-*` fired both sides. `context-menu`
  could fire guest-only, tag-only, or both — and the `params` richness can differ by side. Wire only the
  side(s) the spike proves carry the full payload.
- **Internal `goldfinch://` guests (DD6)**: the capture wiring lives inside `!__goldfinchInternal`, so
  internal guests never get the custom menu — they keep default behavior (no `preventDefault`, no
  forward). Independently, the correction handler refuses the internal session via `isInternalContents`,
  so even a forged `wcId` pointing at the internal guest cannot be written.
- **TOCTOU on correction (DD6 / Flight-3 discipline)**: the active tab can change between the renderer
  capturing `params`/`wcId` and main handling the correction. The handler acts on the **passed `wcId`**
  — never re-resolve via `activeTab()`. A late tab switch corrects the tab the user actually
  right-clicked.
- **Dead/destroyed target**: `webContents.fromId` may return null or a destroyed contents (tab closed
  mid-round-trip). Guard `!wc || wc.isDestroyed()` and return safely — no throw.
- **`replaceMisspelling` on a non-editable / non-misspelled context**: Electron's `replaceMisspelling`
  is a no-op when there is no active misspelling/editing context; the renderer (Leg 4) should only
  surface the correction when `params.misspelledWord` is set, but the main handler must not throw if
  called otherwise — keep the `typeof word === 'string' && word` guard.
- **Empty `dictionarySuggestions`**: on Linux/Windows the suggestions populate only after the one-time
  Hunspell `.bdic` CDN fetch (post-opt-in, Leg 2). Pre-opt-in or pre-fetch, `dictionarySuggestions` may
  be empty/absent — the forwarded `params` simply carries what Electron provides; rendering logic is
  Leg 4. This leg only forwards.
- **`x`/`y` coordinate space**: `params.x`/`params.y` are guest-page coordinates; mapping them to the
  chrome-overlay cursor position for menu placement is Leg 4's concern. This leg forwards them verbatim.

## Files Affected

- `src/main/main.js` — guest `context-menu` listener (`preventDefault` + `page-context-menu` forward)
  inside the `!__goldfinchInternal` block in `app.on('web-contents-created')`; the
  `page-context-correct` correction IPC handler near the DevTools handlers. (Or the renderer-direct
  equivalent per the spike result.)
- `src/preload/chrome-preload.js` — `onPageContextMenu` subscription bridge + the correction send
  bridge.
- `flight-log.md` — spike result + leg progress entry.
- `test/unit/…` — *(optional)* coverage for the correction handler's internal/dead guards if the
  implementer extracts the guard logic to a testable seam; otherwise the refusal is inspection +
  behavior-test-verified (consistent with the inline `before-input-event` precedent, DD5). No MCP
  registration changes.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:** *(Note — under `/agentic-workflow`, commit is
deferred to flight end; this leg lands `in-flight`→`landed`, updates the flight log, and does NOT commit
or signal `[COMPLETE:leg]`.)*

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)
- [x] Update `flight-log.md` with the spike result (delivery side + observed params) + leg progress entry
- [x] Set this leg's status to `landed` (deferred-commit workflow)
- [x] `[HANDOFF:review-needed]` is NOT used per-leg here; the Developer stops after updating the flight
  log (flight-level review happens after the last autonomous leg)

## Citation Audit

8 citations verified against current code at leg design time. The flight spec's main.js line numbers
were slightly stale (it cited the `web-contents-created` block as `:337-427`, the internal guard as
`:362`, and `before-input-event` as `:357`); the block / guard are confirmed but `before-input-event`
is now at `:363`, and the broadcast/handler landmarks have shifted since the flight was authored — all
corrected below.

- `src/main/main.js:337` — `app.on('web-contents-created', (_event, contents) => …)` block — **OK**
  (flight cited `:337-427`; the block spans `:337-427`, confirmed).
- `src/main/main.js:362` — `if (!(/** @type {any} */ (contents.session)?.__goldfinchInternal))` internal
  guard — **OK** (flight cited `:362`, confirmed verbatim).
- `src/main/main.js:363` — `contents.on('before-input-event', (event, input) => …)` — **CORRECTED**:
  flight/Flight-3-leg cited this at `:357`; it is now at `:363` (the F12/Ctrl+Shift+I DevTools branches
  added by Flight-3 Leg 1 shifted it down). The new `context-menu` listener belongs in this same
  `!__goldfinchInternal` block.
- `src/main/main.js:414-424` — guest `devtools-opened`/`devtools-closed` listener forwarding
  `mainWindow.webContents.send('devtools-state-changed', { wcId: contents.id, open })` — **OK** (the
  exact guest-event→chrome-broadcast pattern this leg mirrors; this listener did not exist when the
  flight was drafted — added by Flight-3 Leg 1, spike POSITIVE).
- `src/main/main.js:329` — `mainWindow.webContents.send('zoom-changed', { wcId: wc.id, factor: next })` —
  **OK** (the `zoom-changed` broadcast precedent).
- `src/main/main.js:968` / `:975` — `ipcMain.handle('toggle-devtools', …)` / `ipcMain.handle(
  'is-devtools-open', …)`, each `webContents.fromId` → dead-guard `return false` →
  `isInternalContents(wc)` guard → act on passed id — **OK** (the fromId→dead→internal→act-on-passed-id
  shape the correction handler mirrors; Flight-3 Leg-1 handlers, post-date the flight draft).
- `src/main/main.js:985` — `ipcMain.on('toolbar-context-menu', (_e, item) => …)` native
  `Menu.buildFromTemplate`/`menu.popup` — **OK** (Leg 5's retirement target; cited for context, untouched
  here; flight cited `:985-996`, confirmed).
- `src/main/main.js:3` `webContents` destructured from electron; `:26` `isInternalContents` imported from
  `./automation/resolve` — **OK** (no new imports needed for this leg).
- `src/main/automation/resolve.js:28` `isInternalContents` (`!!wc && !!wc.session &&
  wc.session.__goldfinchInternal === true`), exported `:160` — **OK** (electron-free predicate, confirmed
  verbatim; flight's `:160` export line confirmed).
- `src/preload/chrome-preload.js:59` `onZoomChanged` / `:77` `onDevtoolsStateChanged` subscription
  precedent; `:58` `zoomApply` / `:72` `toggleDevtools` send precedent; `:6` `ipcRenderer`/`contextBridge`
  require — **OK** (the exact bridge styles the new `onPageContextMenu` + correction bridges mirror).
- `test/unit/automation-mcp-tools.test.js:72` — "listTools returns exactly the 26 tools" — **OK** (the
  guard that the DD7 no-new-tool constraint stays true).
- **Negative confirmation**: `grep -rn "replaceMisspelling\|page-context-menu\|onPageContextMenu" src/`
  returns nothing — no pre-existing context-menu/correction wiring; this leg is net-new.
