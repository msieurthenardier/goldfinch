# Leg: keydown-test-seam

**Status**: completed
**Flight**: [Custom Page Context Menu + Spellcheck](../flight.md)

## Objective

Pay down two Flight-3 debrief carry-forwards on the keyboard/test surface this flight already
touches, without changing any runtime behavior:

1. **#2 — renderer keydown test seam.** Extract a **pure** `keydownToAction({key, ctrl, meta,
   shift, lightboxOpen}) → 'devtools' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'find' | 'new-tab'
   | 'close-tab' | 'focus-address' | 'toggle-panel' | 'toggle-privacy' | 'reload' | null` mapper
   (no DOM, no IPC, no side effects) from the **GLOBAL chrome shortcut keydown handler at
   `src/renderer/renderer.js:2256` ONLY**, give it real **offline unit tests**, and rewire that one
   handler to delegate to the mapper then dispatch the (impure) action — behavior-preserving.
2. **#5 — `freePortInRange` one-liner.** Fix the self-contradicting assertion in
   `test/unit/automation-port.test.js` so it tolerates the rare port-collision the comment already
   claims it tolerates.

This leg is **independent** (DD5): the mapper is not consumed by the context menu (the menu's
keyboard nav is `menuController`'s APG contract, and the Shift+F10 / ContextMenu-key "open menu"
invocation is menu-specific — Leg 4). It is parallelizable with `context-menu-ipc` /
`spellcheck-enable` and lands before `context-menu-component` only for tidy sequencing.

## Context

DD5 (flight spec, verbatim cites):
> **DD5 — Keydown dispatch test seam (#2): a renderer-only pure `(key,mods)→action` mapper,
> unit-tested; main-side stays inline + behavior-test net.** Extract `keydownToAction({key, ctrl,
> meta, shift, lightboxOpen}) → 'devtools'|'zoom-in'|'zoom-out'|'zoom-reset'|'find'|'new-tab'|…|null`
> (a pure function, no DOM). **Extraction target is the GLOBAL chrome shortcut handler at
> `src/renderer/renderer.js:2256` ONLY** — the lightbox-scoped keydown handler at `:1287` (which maps
> `+`/`-`/`0` to *image scale*, different semantics) is **deliberately excluded** (architect [low]).
> It gets real offline unit tests (closes the renderer half of the 3-flight blind spot + the growing
> collision surface). The main-side `before-input-event` (`src/main/main.js:357`) stays inline
> (consistent with shipped siblings; the `isAutoRepeat`/F12-before-the-gate/Ctrl+Shift+I-vs-P
> asymmetries are Electron-specific and load-bearing) — verified by the behavior-test net, not a
> forced shared fn. The context menu's **internal** keyboard nav (arrows/Esc/Enter/Home/End) is
> `menuController`'s APG contract, NOT `keydownToAction`; the **Shift+F10 / ContextMenu-key "open
> menu"** invocation is menu-specific (handled where the menu is wired), so the menu component does
> **not** depend on this mapper — the test-seam leg is independent. Also fold the **`freePortInRange`
> one-liner** (#5): `assert.ok(result === null || result === port + 1)` at
> `test/unit/automation-port.test.js`.

**The two carry-forwards** (flight "Contributing to Criteria"):
- **#2** (Flight 3 debrief Rec 2): the chrome-side keydown shortcut dispatch gets a pure,
  unit-tested `(key,mods)→action` mapper. Closes the renderer half of a 3-flight blind spot —
  renderer keyboard logic has been operator-found and under-tested across three flights, and the
  collision surface (number of shortcuts mapped in one handler) keeps growing.
- **#5** (Flight 3 debrief Rec 5 / Action Item): one-line assertion fix at
  `test/unit/automation-port.test.js` — the `freePortInRange` "skip-occupied" test's assertion
  contradicts its own comment.

**EXPLICIT EXCLUSIONS** (do NOT touch in this leg):
- **The lightbox-scoped keydown handler at `renderer.js:1287`.** It maps `+`/`=` → `setScale(×1.25)`,
  `-` → `setScale(÷1.25)`, `0` → `resetZoom()`, plus `Escape` → close and `Tab` → focus-trap. These
  are **image-scale** semantics (different domain from the global handler's page-zoom), and the
  handler is DOM-/state-coupled (reads `zoom.scale`, `els.lightbox`, traps focus across modal
  buttons). It is deliberately excluded — NOT folded into the mapper.
- **The main-side `before-input-event`** (`src/main/main.js:369`, the guest-webview handler). It stays
  INLINE. Its asymmetries are Electron-specific and load-bearing: the `input.isAutoRepeat` guard (a
  held key emits repeated `keyDown`s main-side; the renderer DOM `keydown` does not), the F12 branch
  placed **before** the modifier gate, and the Ctrl+Shift+I-vs-Shift+P disambiguation. These get the
  behavior-test net, not a forced shared function. Do **not** propose unifying main + renderer into
  one mapper — their event shapes (`input` object with `isAutoRepeat` vs. DOM `KeyboardEvent`) and
  gating differ.
- **The context menu's internal keyboard nav** (arrows/Esc/Enter/Home/End/Tab roving) — that is
  `menuController`'s APG contract (DD3), not `keydownToAction`. The **Shift+F10 / ContextMenu-key**
  "open menu" invocation is menu-specific (Leg 4). The mapper is independent of the menu.

This is a **refactor-with-tests**: extracting the mapping logic must NOT change runtime behavior. The
existing global keydown handler must call the new pure mapper and then perform the (impure) action
dispatch based on its return value.

## Inputs

What exists before this leg runs:
- `src/renderer/renderer.js:2256` — the **GLOBAL chrome shortcut keydown handler**
  (`document.addEventListener('keydown', …)`). The complete set of shortcuts it currently maps (all
  verified against live code — see Citation Audit for line numbers):
  - **F12** (no modifier) → toggle DevTools. Sits **before** the `if (!mod) return;` gate. Guards:
    defer if lightbox open; resolve `activeTab()`; no-op on internal tab / null `wcId`; then
    `window.goldfinch.toggleDevtools({ webContentsId })`. (`:2263-2270`)
  - `if (!mod) return;` — the modifier gate, where `mod = e.ctrlKey || e.metaKey`. (`:2257`, `:2271`)
  - **`=` / `+` / `-` / `0`** (with mod) → page zoom. `-` → out, `0` → reset, else (`=`/`+`) → in.
    Guards: defer if lightbox open; resolve active web tab; then `window.goldfinch.zoomApply({…,
    action })`. (`:2275-2284`)
  - **`f` / `F`** (Ctrl+F) → open find. Guards: lightbox/internal/wcId; then `openFind(t)`.
    (`:2285-2292`)
  - **`t`** (Ctrl+T) → `createTab()`. (`:2293`)
  - **`w`** (Ctrl+W) → `closeTab(activeTabId)` if any. (`:2296`)
  - **`l`** (Ctrl+L) → focus + select the address bar. (`:2299`)
  - **`m`** (Ctrl+M) → `togglePanel()`. (`:2303`)
  - **Shift + `P`/`p`** (Ctrl+Shift+P) → `togglePrivacy()`. (`:2306`)
  - **Shift + `I`/`i`** (Ctrl+Shift+I) → toggle DevTools (the alternate to F12; a CHAIN member, the
    key letter disambiguates it from Shift+P). Guards: lightbox/internal/wcId; then
    `window.goldfinch.toggleDevtools({ webContentsId })`. (`:2309-2317`)
  - **`r`** (Ctrl+R) → `t.webview.reload()`. (`:2318`)
- `src/renderer/renderer.js:1287` — the **lightbox-scoped keydown handler** (EXCLUDED — image-scale
  semantics; see Exclusions).
- `src/shared/` — the **electron-free** module home. It hosts **two** established consumption patterns,
  both with offline unit tests:
  - **Dual-export + global `<script>`** (the closer precedent for a pure renderer-logic module):
    `url-safety.js` and `audit-paging.js` export via CommonJS (`module.exports`) for tests/main **and**
    assign to `globalThis` (e.g. `globalThis.isSafeTabUrl = …`) for the renderer. `url-safety.js` is
    loaded into the renderer as a plain global script — `<script src="../shared/url-safety.js">` at
    `src/renderer/index.html:207`, the line immediately above `renderer.js` — and the renderer consumes
    `isSafeTabUrl`/`isInternalPageUrl` as **bare globals** (`renderer.js:491`, `:1087`), not through
    `window.goldfinch`.
  - **CommonJS-only + preload bridge**: `internal-page.js` (`INTERNAL_PARTITION`) and `automation-dev.js`
    (`isMcpAutomationEnabled`) are `require()`d in `chrome-preload.js:7-8` and surfaced on the `goldfinch`
    bridge — but these are **config values main computes**, not renderer-side pure logic.
  All `src/shared/` modules use `// @ts-check` + `'use strict'` + JSDoc and are imported in `test/unit/*`
  via `require('../../src/shared/<name>')` with `node:test` + `node:assert/strict` (no Electron, no DOM).
  `keydownToAction` is **pure renderer-side logic** (exactly like `url-safety.js`/`audit-paging.js`), so
  it takes the **dual-export + global-script** route — no preload bridge, no `goldfinch`-surface change.
- `src/renderer/renderer.js` — loaded via `<script src="renderer.js">` (`index.html:208`). It has
  **no `require`/`import`** — it is a non-module browser script. It therefore consumes shared logic
  either as a bare global (the url-safety route, chosen here) or through the `window.goldfinch` bridge.
- `test/unit/automation-port.test.js:226-241` — the `freePortInRange` "skip an occupied port" test;
  the buggy assertion is at `:237`.

## Outputs

What exists after this leg completes:
- A new pure module `src/shared/keydown-action.js` exporting `keydownToAction({key, ctrl, meta,
  shift, lightboxOpen})` — no DOM, no IPC, no Electron; `// @ts-check` + `'use strict'` + JSDoc.
  **Dual-export** (matching `url-safety.js`/`audit-paging.js`): `module.exports = { keydownToAction }`
  for tests/main **and** `globalThis.keydownToAction = keydownToAction` for the renderer.
- `src/renderer/index.html` — a `<script src="../shared/keydown-action.js">` tag added immediately
  before (or beside) the existing `<script src="../shared/url-safety.js">` at `:207`, so the renderer
  has `keydownToAction` as a bare global by the time `renderer.js` runs. **No `chrome-preload.js`
  change, no `goldfinch`-bridge member, no `renderer-globals.d.ts` edit** (the dual-export route keeps
  the mapper off the audited preload surface — it is pure logic, not a capability).
- `src/renderer/renderer.js:2256` — the global keydown handler rewired to: compute the descriptor
  from the event, call the (global) `keydownToAction(...)` for the action, then `switch`/dispatch the
  impure side-effect. The lightbox-defer / `activeTab` / `isInternalTab` / `wcId` guards stay in the
  handler (they read DOM and tab state — they are the impure dispatch layer, not the pure mapper). Net
  runtime behavior identical.
- `test/unit/keydown-action.test.js` — offline unit tests (node:test) covering every mapped shortcut,
  the null/no-match case, the `lightboxOpen` gating, the F12-before-the-modifier-gate case, and the
  Ctrl+Shift+I vs Shift+P disambiguation.
- `test/unit/automation-port.test.js:237` — the assertion fixed to tolerate the documented rare
  collision.

## Acceptance Criteria

- [x] A **pure** `keydownToAction({key, ctrl, meta, shift, lightboxOpen})` is extracted from the
  GLOBAL chrome shortcut handler (`renderer.js:2256`) **ONLY** — the lightbox handler (`:1287`) is
  left untouched (verify by diff: no edit below the global-handler region except the new dispatch
  wiring).
- [x] The mapper has no DOM, no IPC, no Electron, no side effects — it takes a plain descriptor and
  returns an action string or `null`. It lives in `src/shared/` (electron-free, importable by the
  test runner offline) and is **dual-exported** (`module.exports` + `globalThis`), consumed by the
  renderer as a bare global via a `<script src="../shared/keydown-action.js">` tag in `index.html` —
  matching the `url-safety.js` precedent. **No preload-bridge / `goldfinch`-surface / d.ts change.**
- [x] The mapper's return enum is **complete and behavior-preserving** — it covers every shortcut the
  global handler currently maps: `devtools` (F12 and Ctrl+Shift+I), `zoom-in`, `zoom-out`,
  `zoom-reset`, `find`, `new-tab`, `close-tab`, `focus-address`, `toggle-panel`, `toggle-privacy`,
  `reload`, and `null` for no match.
- [x] Offline unit tests (`test/unit/keydown-action.test.js`) cover: **every** mapped shortcut → its
  action; the **null / no-match** case (e.g. an unmapped key, or a modifier-required key with no
  modifier); the **`lightboxOpen` gating** (the keys the live handler defers while a lightbox is open
  return null/inert when `lightboxOpen: true`); the **F12-before-the-gate** case (F12 maps to
  `devtools` with NO ctrl/meta — it is not swallowed by the modifier requirement); and the
  **Ctrl+Shift+I** case mapping to `devtools` distinctly from **Ctrl+Shift+P** mapping to
  `toggle-privacy` (key-letter disambiguation).
- [x] **Runtime behavior is unchanged**: the global handler now delegates to the mapper for the
  action decision and then dispatches the impure side-effect (zoom IPC, find, tab ops, devtools IPC,
  etc.). A manual / regression check confirms every shortcut still fires the same effect as before,
  and the same keys still no-op on internal tabs / null wcId / lightbox-open.
- [x] The **main-side `before-input-event`** (`src/main/main.js`) is **NOT touched** — it stays inline
  (verify: no edits to `main.js`).
- [x] The `freePortInRange` assertion at `test/unit/automation-port.test.js` is fixed to
  `assert.ok(result === null || result === port + 1)` (tolerates the documented rare collision).
- [x] **Tool count stays 26** — no MCP change (verify the `listTools returns exactly the 26 tools`
  test and the `tools/list returns 26 tools` server test stay green; `src/main/automation/mcp-tools.js`
  untouched).
- [x] `npm test`, `npm run typecheck`, and `npm run lint` all pass.

## Verification Steps

- **Pure extraction, lightbox untouched**: `git diff src/renderer/renderer.js` — confirm the only
  edits are at the global handler region (`~:2256-2323`) plus, if needed, a small consumed-from-bridge
  call; the lightbox handler region (`~:1287-1318`) is unchanged.
- **Mapper purity**: `grep -n "document\|window\|ipcRenderer\|require('electron')\|els\.\|activeTab"
  src/shared/keydown-action.js` — expect no matches (the mapper closes over none of these).
- **Enum completeness**: cross-check the mapper's branches against the enumerated shortcut list above;
  every live branch has a corresponding action; the unit test file has a case per action.
- **Offline tests run without Electron/DOM**: `node --test test/unit/keydown-action.test.js` passes
  standalone (no Electron import, no jsdom).
- **freePortInRange fix**: inspect `test/unit/automation-port.test.js:237` reads
  `assert.ok(result === null || result === port + 1)`; `node --test test/unit/automation-port.test.js`
  passes.
- **Tool count**: `node --test test/unit/automation-mcp-tools.test.js` (the `26 tools` assertion) +
  `automation-mcp-server.test.js` stay green; `git diff src/main/automation/mcp-tools.js` empty.
- **Behavior-preserving manual sweep** (`npm run dev`): press each of F12, Ctrl+Shift+I, Ctrl+`=`/`-`/`0`,
  Ctrl+F, Ctrl+T, Ctrl+W, Ctrl+L, Ctrl+M, Ctrl+Shift+P, Ctrl+R with the chrome focused → each fires the
  same action it did before. Open a lightbox → confirm the deferred keys still defer. Switch to a
  `goldfinch://` internal tab → confirm the wcId-routed shortcuts still no-op.
- `npm test` / `npm run typecheck` / `npm run lint`.

## Implementation Guidance

1. **Read the live global handler first** (`renderer.js:2256-2323`) and enumerate every branch (the
   list in Inputs is the current truth). The handler's structure is: F12 branch (pre-gate) → `if
   (!mod) return;` → zoom branch → an `if/else if` chain (Ctrl+F, Ctrl+T, Ctrl+W, Ctrl+L, Ctrl+M,
   Ctrl+Shift+P, Ctrl+Shift+I, Ctrl+R). The **pure decision** is "given (key, ctrl, meta, shift,
   lightboxOpen), which action?"; the **impure dispatch** is "resolve the active tab, check
   internal/wcId, call the right IPC / DOM op." Split exactly along that line.

2. **Write the pure mapper** `src/shared/keydown-action.js`. Signature:
   `keydownToAction({ key, ctrl, meta, shift, lightboxOpen })`. Reproduce the live gating in pure
   form:
   - **F12 first, before the modifier gate**: `if (key === 'F12') return lightboxOpen ? null :
     'devtools';` — F12 has no modifier and must be decided before the `mod` requirement, exactly as
     the live handler places it before `if (!mod) return;`. (The live handler defers F12 when a
     lightbox is open — so the mapper returns `null` for F12 when `lightboxOpen` is true.)
   - **Modifier gate**: `const mod = ctrl || meta; if (!mod) return null;` — mirrors `:2271`.
   - **Zoom** (`=`/`+`/`-`/`0`): the live handler defers these when a lightbox is open
     (`if (!els.lightbox… return;` at `:2277`), so `if (lightboxOpen) return null;` then `'-' →
     'zoom-out'`, `'0' → 'zoom-reset'`, `'='`/`'+' → 'zoom-in'`.
   - **Find** (`f`/`F`): also lightbox-deferred (`:2288`) → `if (lightboxOpen) return null;` else
     `'find'`.
   - **The rest of the chain** (`t`/`w`/`l`/`m`, Shift+`P`/`p`, Shift+`I`/`i`, `r`) is NOT
     lightbox-gated in the live handler — preserve that. Map: `t → 'new-tab'`, `w → 'close-tab'`,
     `l → 'focus-address'`, `m → 'toggle-panel'`, `shift && (P|p) → 'toggle-privacy'`,
     `shift && (I|i) → 'devtools'`, `r → 'reload'`. Anything else → `null`.
   - **Preserve the Ctrl+Shift+I vs Shift+P disambiguation by key letter** (the live chain relies on
     `(I|i)` vs `(P|p)`). Keep the same letter checks so chain order can't double-handle.
   - Pure: closes over no `document`/`window`/`els`/`activeTab`/IPC. JSDoc the param object and the
     `@returns` union; match the `src/shared/` header convention (`// @ts-check`, `'use strict'`).

3. **Surface the mapper to the renderer via dual-export + a global `<script>` tag** — the route
   `url-safety.js`/`audit-paging.js` already use for pure renderer-side logic (preferred over the
   preload bridge here: the bridge precedents surface *config values main computes*, whereas this is
   renderer logic; the dual-export route also needs no bridge plumbing and no d.ts edit). In
   `keydown-action.js`, end the module with both exports, exactly like `url-safety.js`:
   ```js
   // CommonJS for tests/main; global for the renderer (loaded as a plain <script>, no bundler).
   if (typeof module !== 'undefined' && module.exports) module.exports = { keydownToAction };
   if (typeof globalThis !== 'undefined') globalThis.keydownToAction = keydownToAction;
   ```
   (Match `url-safety.js`'s exact dual-export idiom — copy its tail verbatim and swap the names.) Then
   add `<script src="../shared/keydown-action.js"></script>` to `src/renderer/index.html` immediately
   before/beside the existing `<script src="../shared/url-safety.js">` (`:207`) so the global is defined
   before `renderer.js` (`:208`) runs. **No `chrome-preload.js` change, no `goldfinch`-bridge member, no
   `renderer-globals.d.ts` edit.** The unit test `require()`s the module directly (CommonJS export).

4. **Rewire the global handler** (`renderer.js:2256`) to delegate. Build the descriptor from the
   event, ask the mapper, then dispatch:
   ```js
   document.addEventListener('keydown', (e) => {
     const action = keydownToAction({          // bare global from ../shared/keydown-action.js
       key: e.key,
       ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey,
       lightboxOpen: !els.lightbox.classList.contains('hidden'),
     });
     if (!action) return;
     // impure dispatch — same effects as before, same guards:
     switch (action) {
       case 'devtools': { const t = activeTab(); if (!t || isInternalTab(t) || t.wcId == null) return;
         e.preventDefault(); window.goldfinch.toggleDevtools({ webContentsId: t.wcId }); return; }
       case 'zoom-in': case 'zoom-out': case 'zoom-reset': { const t = activeTab();
         if (!t || isInternalTab(t) || t.wcId == null) return;
         const map = { 'zoom-in': 'in', 'zoom-out': 'out', 'zoom-reset': 'reset' };
         e.preventDefault(); window.goldfinch.zoomApply({ webContentsId: t.wcId, action: map[action] }); return; }
       case 'find': { const t = activeTab(); if (!t || isInternalTab(t) || t.wcId == null) return;
         e.preventDefault(); openFind(t); return; }
       case 'new-tab': e.preventDefault(); createTab(); return;
       case 'close-tab': e.preventDefault(); if (activeTabId) closeTab(activeTabId); return;
       case 'focus-address': e.preventDefault(); els.address.focus(); els.address.select(); return;
       case 'toggle-panel': e.preventDefault(); togglePanel(); return;
       case 'toggle-privacy': e.preventDefault(); togglePrivacy(); return;
       case 'reload': { e.preventDefault(); const t = activeTab(); if (t) t.webview.reload(); return; }
     }
   });
   ```
   **This is illustrative — preserve the EXACT existing per-branch guards and `preventDefault`
   placement** as they are in the live handler (e.g. the live reload branch calls `preventDefault`
   unconditionally then reloads if a tab exists; close-tab calls `preventDefault` then only closes if
   `activeTabId`). Because `lightboxOpen` is now folded into the mapper, the deferred keys
   (F12/zoom/find) return `null` and fall out before dispatch — matching the live early-returns. Keep
   `els`/`activeTab`/`isInternalTab` reads in the handler (they are the DOM/tab-state dispatch layer).
   Do **not** route the non-wcId actions (new-tab/close-tab/focus-address/toggle-panel/toggle-privacy/
   reload) through any new guard they didn't have before.

5. **Add the offline unit tests** `test/unit/keydown-action.test.js` using `node:test` +
   `node:assert/strict`, importing `require('../../src/shared/keydown-action')` (no Electron, no DOM —
   the established `src/shared/` test pattern). Cover:
   - One case per action: F12 → `devtools`; Ctrl+`=`/`+` → `zoom-in`; Ctrl+`-` → `zoom-out`; Ctrl+`0`
     → `zoom-reset`; Ctrl+`f`/`F` → `find`; Ctrl+`t` → `new-tab`; Ctrl+`w` → `close-tab`; Ctrl+`l` →
     `focus-address`; Ctrl+`m` → `toggle-panel`; Ctrl+Shift+`P`/`p` → `toggle-privacy`;
     Ctrl+Shift+`I`/`i` → `devtools`; Ctrl+`r` → `reload`.
   - **Meta equivalence**: a representative case with `meta:true` (Cmd) instead of `ctrl:true` still
     maps (the live `mod = ctrl || meta`).
   - **null / no-match**: an unmapped letter with modifier (e.g. Ctrl+`z`) → `null`; a modifier-
     required key with NO modifier (e.g. `f` alone) → `null`.
   - **lightboxOpen gating**: F12, zoom keys, and find with `lightboxOpen:true` → `null`; the
     non-gated keys (Ctrl+T etc.) with `lightboxOpen:true` still map (they were never lightbox-gated).
   - **F12-before-the-gate**: F12 with `ctrl:false, meta:false` → `devtools` (proves it isn't lost to
     the modifier requirement).
   - **Ctrl+Shift+I vs Ctrl+Shift+P disambiguation**: the two distinct chords map to `devtools` and
     `toggle-privacy` respectively.

6. **Fix the `freePortInRange` one-liner** (#5). At `test/unit/automation-port.test.js:237` the live
   assertion is `assert.equal(result, port + 1, 'should skip the occupied port and return the next');`
   — which contradicts the test's own comment ("the assertion tolerates the rare collision by
   accepting any free port > port within the 2-wide range"): if `port+1` is also momentarily occupied,
   `freePortInRange` returns `null`, and `assert.equal(result, port + 1)` would flake. Change it to
   `assert.ok(result === null || result === port + 1, 'should skip the occupied port and return the
   next (or null if port+1 also raced)');`. This is the only change in that file; do not touch the
   other freePortInRange tests.

7. **Do not touch** `src/main/main.js` (the `before-input-event` stays inline) or
   `src/main/automation/mcp-tools.js` (tool count stays 26). Run `npm test`, `npm run typecheck`,
   `npm run lint`.

## Edge Cases

- **Lightbox handler (`:1287`) deliberately excluded** — its `+`/`-`/`0` are *image scale*
  (`setScale`/`resetZoom`), a different domain from the global handler's page-zoom, and it is
  DOM-/state-coupled (focus trap, `zoom.scale`). Folding it into the mapper would conflate two
  semantics. Leave it byte-for-byte unchanged.
- **F12 before the modifier gate must be preserved in the mapper's gating.** F12 carries no modifier;
  if the mapper applied the `if (!mod) return null;` gate first, F12 would always return `null`. The
  mapper must decide F12 **before** the modifier check, exactly as the live handler places its F12
  branch before `if (!mod) return;`. (The mapper does NOT replicate the main-side auto-repeat
  asymmetry — that is the `before-input-event`'s concern, not the renderer's; the renderer DOM
  `keydown` fires once per press.)
- **Ctrl+Shift+I vs Ctrl+Shift+P disambiguation by key letter.** Both are Ctrl+Shift chords; only the
  key letter (`I/i` vs `P/p`) distinguishes DevTools from privacy. The live handler relies on this in
  an `if/else if` chain where the `I` branch sits after the `P` branch and the letter check prevents
  double-handling. The pure mapper must keep the same letter checks; order cannot cause a mis-map
  because the letters are disjoint.
- **`lightboxOpen` gating is per-key.** Only F12, the zoom keys, and Ctrl+F defer while a lightbox is
  open (the live handler early-returns for those). The remaining chord actions
  (new-tab/close-tab/focus-address/toggle-panel/toggle-privacy/devtools-via-Ctrl+Shift+I/reload) are
  NOT lightbox-gated in the live handler — the mapper must NOT gate them on `lightboxOpen`, or it
  would change behavior. (Note Ctrl+Shift+I IS lightbox-guarded in the live handler at `:2313`, so
  treat devtools-via-Ctrl+Shift+I as lightbox-gated too — both DevTools entry points defer on an open
  lightbox. Verify against the live branch and preserve whatever it does.)
- **Main-side `before-input-event` not unified.** Its event shape (`input` with `isAutoRepeat`) and
  its gating differ from the renderer's DOM `KeyboardEvent`; it stays inline with the behavior-test
  net. Do not propose a single shared function across both.
- **`meta` (Cmd) parity.** The live handler treats `e.ctrlKey || e.metaKey` as the modifier; the
  mapper takes both `ctrl` and `meta` and ORs them, so macOS Cmd shortcuts behave identically.

## Files Affected

- `src/shared/keydown-action.js` *(new)* — the pure `keydownToAction` mapper; dual-export
  (`module.exports` + `globalThis`), matching `url-safety.js`.
- `src/renderer/index.html` — add `<script src="../shared/keydown-action.js">` beside the existing
  `../shared/url-safety.js` tag (`:207`) so the global is defined before `renderer.js` runs.
- `src/renderer/renderer.js` — rewire the global keydown handler (`:2256`) to delegate to the (global)
  mapper + dispatch; lightbox handler (`:1287`) untouched.
- `test/unit/keydown-action.test.js` *(new)* — offline unit tests for the mapper.
- `test/unit/automation-port.test.js` — fix the `freePortInRange` assertion at `:237` (#5).
- NOT touched: `src/main/main.js` (before-input-event inline), `src/main/automation/mcp-tools.js`
  (tool count 26).

---

## Post-Completion Checklist

**Complete ALL steps before signaling completion:** *(Note — under `/agentic-workflow`, commit is
deferred to flight end; this leg lands `in-flight`→`landed`, updates the flight log, and does NOT
commit or signal `[COMPLETE:leg]`.)*

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)
- [x] Update flight-log.md with the leg progress entry (extraction done; mapper home + bridge wiring;
  freePortInRange fix; tool count 26 confirmed)
- [x] Set this leg's status to `landed` (deferred-commit workflow)
- [x] Do NOT signal `[HANDOFF:review-needed]` per-leg — the Developer stops after updating the flight
  log (flight-level review happens after the last autonomous leg)

## Citation Audit

All citations verified against current code at leg design time (`OK`):
- `src/renderer/renderer.js:2256` — GLOBAL chrome shortcut keydown handler
  (`document.addEventListener('keydown', …)`). **CONFIRMED.** The flight cites `:2256`; correct. (The
  Flight-3 Leg-1 leg cited the same handler at `:2198` with the `!mod` gate at `:2200` and Ctrl+F at
  `:2214` — it has since shifted down by 58 lines after Flight-3 landed.) Current line map: `mod`
  computed `:2257`; F12 branch (pre-gate) `:2263-2270`; `if (!mod) return;` `:2271`; zoom
  `=`/`+`/`-`/`0` `:2275-2284`; Ctrl+F `:2285-2292`; Ctrl+T `:2293`; Ctrl+W `:2296`; Ctrl+L `:2299`;
  Ctrl+M `:2303`; Ctrl+Shift+P `:2306`; Ctrl+Shift+I `:2309-2317`; Ctrl+R `:2318`; handler ends
  `:2323`.
- `src/renderer/renderer.js:1287` — lightbox-scoped keydown handler. **CONFIRMED** (EXCLUDED): maps
  `Escape`→close, `+`/`=`→`setScale(×1.25)`, `-`→`setScale(÷1.25)`, `0`→`resetZoom`, `Tab`→focus
  trap; gated on `els.lightbox.classList.contains('hidden')`. Image-scale semantics, distinct from
  the global handler's page-zoom. Ends `:1318`.
- `src/shared/` — **CONFIRMED** electron-free module home: `automation-dev.js`, `audit-paging.js`,
  `url-safety.js`, `dev-profile.js`, `internal-page.js`. Each has an offline unit test in `test/unit/`
  that imports it via `require('../../src/shared/<name>')` using `node:test` (e.g.
  `test/unit/automation-dev.test.js:15`, `test/unit/url-safety.test.js:5`,
  `test/unit/audit-paging.test.js:11`). **Two renderer-consumption patterns confirmed:** (1) **dual-export
  + global `<script>`** — `url-safety.js`/`audit-paging.js` assign to `globalThis` and are loaded via
  `<script src="../shared/url-safety.js">` at `src/renderer/index.html:207`, consumed as **bare globals**
  in `renderer.js` (`isSafeTabUrl` `:491`, `isInternalPageUrl` `:1087`) — NOT through `window.goldfinch`;
  (2) **CommonJS-only + preload bridge** — `internal-page.js`/`automation-dev.js` `require()`d in
  `chrome-preload.js:7-8` and surfaced on the `goldfinch` bridge (these are config values main computes).
  The mapper is pure renderer logic, so it takes route (1) — the `url-safety.js` precedent.
- `src/renderer/index.html:207` — `<script src="../shared/url-safety.js">` (global-script precedent),
  `:208` `<script src="renderer.js">`. **CONFIRMED.** `renderer.js` has no `require`/`import`; it consumes
  `keydownToAction` as a bare global once the new `<script>` tag is added beside `:207`. No bundler exists
  (`package.json` scripts are `electron .` / `tsc` / `eslint`; `build` is electron-builder config only).
- `test/unit/automation-port.test.js:237` — current assertion is
  `assert.equal(result, port + 1, 'should skip the occupied port and return the next');` inside the
  "skips an occupied port" test (`:226-241`), whose comment (`:233-235`) explicitly claims it
  "tolerates the rare collision by accepting any free port > port." **CONFIRMED** the assertion
  contradicts its own comment. Fix to `assert.ok(result === null || result === port + 1, …)`.
- `src/main/main.js:369` — guest `before-input-event` handler (F12 branch `:376`, Ctrl+Shift+I `:412`,
  `isAutoRepeat` guards). **CONFIRMED** present and inline; this leg does NOT touch it.
- Tool count **26** — `test/unit/automation-mcp-tools.test.js:72` (`listTools returns exactly the 26
  tools`) + `test/unit/automation-mcp-server.test.js:251` (`tools/list returns 26 tools`).
  **CONFIRMED**; no MCP change in this leg.
