# Leg: hard-reload

**Status**: completed
**Flight**: [Hard Reload](../flight.md)

## Objective
Give Goldfinch a cache-bypassing reload: a new `'hard-reload'` chrome-shortcut action and a new `reloadIgnoringCache` `tab-navigate` verb. The triggers are Ctrl/Cmd+Shift+R, Shift+F5, Ctrl/Cmd+F5 and Shift+click on `#reload`, and plain F5 becomes a normal reload. The MCP `reload` tool gains an optional `ignoreCache`, and `pressKey` gains `F5`.

## Context
- The flight's design decisions are all in scope: DD1–DD7 (`../flight.md`). This is the sortie's only leg; there is no HAT.
- Branch `sortie/03-hard-reload`, cut from `main` @ `2d9a1e6`.
- **`src/renderer/renderer.js` must not change** (1545/1546 line budget, `test/unit/seam-contract.test.js` `RENDERER_LINE_BUDGET`). Nothing here needs it: the work lives in `chrome/shortcut-controller.js` and `chrome/navigation-controller.js`, and no seam entry is added.
- `keydown-action.js` and `sheet-accelerator.js` are a hand-mirrored LOCKSTEP pair (both files say so); `shortcut-classifier-parity.test.js` pins their chrome-scope agreement.
- The guest forwarder (`src/main/guest-wiring.js` `handleChromeShortcut`) runs **before** the guest's F12 branch and its `if (!(input.control || input.meta)) return` early-return, and `handleCrossView` (which runs first) matches only Ctrl/Cmd+L and unmodified F6. So unmodified F5 and Ctrl+Shift+R both reach the classifier with no `guest-wiring.js` change (Architect trace (a)/(b)).
- Electron's default application menu is installed (Goldfinch never calls `Menu.setApplicationMenu`) with *Force Reload* on `Shift+CmdOrCtrl+R` (DD7). Do NOT change the menu. The live smoke test checks that the chrome view never reloads.

## Inputs
- `src/shared/keydown-action.js` `keydownToAction`: F12 then F6 decided before `const mod = ctrl || meta; if (!mod) return null;`; shifted chain (`shift && (key === 'T' || key === 't')`, `… 'B'/'b'`, `… 'P'/'p'`, `… 'I'/'i'`); `if (key === 'r') return 'reload';`.
- `src/shared/sheet-accelerator.js` `sheetAcceleratorAction`: `if (key === 'F12') return { scope: 'guest', … }` then `if (!(control || meta)) return null; // APG keys excluded by construction`; the shifted chords block; `if (key === 'r') return { scope: 'chrome', action: 'reload' };`.
- `src/shared/guest-forward-allowlist.js`: `WEB_CHROME_ACTIONS` (contains `'reload'`), `INTERNAL_CHROME_ACTIONS` (does not), `isRepeatSafeAction` (`tab-` prefix).
- `src/renderer/chrome/shortcut-controller.js` `dispatchChromeAction`: `case 'reload': { const t = activeTab(); if (t && isWebTab(t) && t.wcId != null) window.goldfinch.tabNavigate({ wcId: t.wcId, verb: 'reload', args: [] }); return true; }`.
- `src/renderer/chrome/navigation-controller.js`: `els.reload.addEventListener('click', () => { … if (els.reload.textContent === '✕') … verb: 'stop' … else … verb: 'reload' … })`.
- `src/main/register-tab-ipc.js`: `ipcMain.on('tab-navigate', (event, { wcId, verb, args }) => {` → `} else if (verb === 'reload') {` with the `wc.navigationHistory.length() === 0` → `wc.loadURL(effectiveUrl(entry))` fallback.
- `src/main/automation/nav.js` `reload(wcId, deps)`; `engine.js` `reload: (wcId) => nav.reload(wcId, deps())`; `mcp-tools.js` the `name: 'reload'` tool; `input.js` `KEY_MAP` (ends `F6: 'F6'`) and `PRESS_KEY_NAMES`; `scope.js` already lists `'reload'` and forwards `(wcId, ...rest)`.
- Tests: `keydown-action.test.js`, `sheet-accelerator.test.js` (the negative loop `for (const key of ['W', 'L', 'M', 'R'])` asserting Ctrl+Shift+key → `null`, plus the modifier-less/F12-exempt tests), `shortcut-classifier-parity.test.js` (`CHROME_SCOPE_CASES`), `guest-forward-allowlist.test.js` (`WEB_FORWARDABLE`, `INTERNAL_NOT_FORWARDABLE`, `NOT_REPEAT_SAFE`), `guest-wiring.test.js`, `shortcut-controller.test.js` (`tabNavigate` fake records `['reload', x]`; internal-tab inertness test; the `actions` list), `navigation-controller.test.js`, `register-tab-ipc.test.js` (the fake `wc` with `reload()` logging `['reload', id]`; the `tab-navigate … verb: 'reload'` test), `automation-nav.test.js`, `automation-mcp-tools.test.js` (the shared nav-tool call-shape loop asserting `calls[name][0]` deepEquals `[42]`), `automation-input.test.js` (the F6 `keyEvents` test).
- Docs: `README.md` keyboard-shortcuts table (`| \`Ctrl+R\` | Reload |`); `docs/mcp-automation.md` (`reload` row `{ wcId: integer }`, the `pressKey` names).
- `tests/behavior/hard-reload.md` (draft spec; this leg creates its fixture).

## Outputs
- Every file named in Inputs, updated as below.
- **New** `tests/behavior/fixtures/hard-reload/server.mjs` (+ any static files it serves), zero dependencies (`node:http` only), bound to `127.0.0.1:8766`.
- `tests/behavior/hard-reload.md` stays `draft` until the Flight Director's run; update it only if the fixture's real shape differs from what the spec says.

## Acceptance Criteria
- [ ] **AC1 — classifier (`keydownToAction`)** returns, with `lightboxOpen` false AND true:
  - `hard-reload` for Ctrl+Shift+`R`, Ctrl+Shift+`r`, Meta+Shift+`R`, Shift+F5, Ctrl+F5, Meta+F5 and Ctrl+Shift+F5;
  - `reload` for Ctrl+`r` and unmodified F5;
  - `null` for Alt+F5, Ctrl+Alt+F5 and Shift+Alt+F5;
  - unchanged results for every other existing chord. Existing tests stay green, and any pin that contradicts the table above is retargeted (renamed, not deleted).
- [ ] **AC2 — sheet mirror (`sheetAcceleratorAction`)** returns `{ scope: 'chrome', action }` with the same action as AC1 for every AC1 chord, with no `autoRepeatGuard`, and `null` for the Alt+F5 variants. `sheet-accelerator.test.js`'s Ctrl+Shift+key → `null` loop drops `'R'` (the M09 F4 `'T'` precedent) and gains positive `R`/`r` tests. The modifier-less test names F5 as exempt beside F12. The comments that say every mapping requires control||meta except F12 (header and the inline `// APG keys excluded by construction` neighbourhood) now name F5. `CHROME_SCOPE_CASES` in `shortcut-classifier-parity.test.js` gains Ctrl+Shift+`R`, Ctrl+Shift+`r`, F5, Shift+F5 and Ctrl+F5, and a negative parity case pins Alt+F5 → `null` on both sides.
- [ ] **AC3 — forwarding**: `isChromeActionForwardable('hard-reload', 'web') === true`, `isChromeActionForwardable('hard-reload', 'internal') === false`, and `isRepeatSafeAction('hard-reload') === false`. `WEB_FORWARDABLE`, `INTERNAL_NOT_FORWARDABLE` and `NOT_REPEAT_SAFE` gain it, and the allowlist header's enumeration is updated. The end-to-end pipeline is pinned: Ctrl+Shift+`R` and F5 classify then forward on web and not on internal guests. In `guest-wiring.test.js`, a web guest's Ctrl+Shift+R keyDown is `preventDefault`ed and sends `chrome-shortcut-action { action: 'hard-reload' }` exactly once; with `isAutoRepeat: true` it is preventDefaulted but not sent. An internal guest's Ctrl+Shift+R is neither preventDefaulted nor sent.
- [ ] **AC4 — chrome dispatch**: `dispatchChromeAction('hard-reload')` sends `tabNavigate({ wcId, verb: 'reloadIgnoringCache', args: [] })` for an active web tab with a wcId. It sends nothing for an internal tab, a welcome (null-wcId) tab or no active tab, and returns `true` in every case. `'reload'` behavior is unchanged. Two real entry points are pinned in `shortcut-controller.test.js` through the harness's captured listeners:
  - **chrome DOM keydown**: fire the registered `document` `keydown` listener with a Ctrl+Shift+`R` event, and with an F5 event; assert the verb sent (`reloadIgnoringCache` / `reload`) and that `preventDefault` was called;
  - **forwarded action**: the guest/sheet paths arrive through `onChromeShortcutAction`. Invoke the captured callback with `{ action: 'hard-reload' }` and assert `reloadIgnoringCache` is sent.
  - **Optional, if the window-factory harness allows a real `sheetAcceleratorAction`**: one test that a sheet keyDown Ctrl+Shift+R sends `chrome-shortcut-action { action: 'hard-reload' }` once (`window-factory-harness.js` stubs it to `() => null` today). Otherwise the sheet path is classifier-only plus the forwarded-action test. Record which in the flight log.
- [ ] **AC5 — reload button**:
  - Shift+click while `#reload` shows ⟳ sends `reloadIgnoringCache`.
  - A plain click sends `reload`.
  - A click with or without Shift while it shows ✕ sends `stop`.
  - A click on an internal tab sends nothing, as today.
- [ ] **AC6 — main verb**: `tab-navigate { verb: 'reloadIgnoringCache' }` calls `wc.reloadIgnoringCache()` exactly once and never calls `wc.reload()`. With an empty `navigationHistory` it calls `wc.loadURL(effectiveUrl(entry))` instead. It ignores `args` (e.g. `args: ['https://evil.example']` still reloads in place, no `loadURL`), and it sits behind the handler's existing sender/`wc` guards (a destroyed or unknown `wc` is a no-op, same as `reload`).
- [ ] **AC7 — automation**:
  - `nav.reload(wcId, deps, { ignoreCache: true })` calls `wc.reloadIgnoringCache()`. An absent options object, `{}`, `{ ignoreCache: false }`, `{ ignoreCache: 'true' }` and `{ ignoreCache: 1 }` all call `wc.reload()`.
  - The internal-session guard throws before either call.
  - The `reload` MCP tool schema lists `ignoreCache` (`type: 'boolean'`) and leaves it out of `required`. It calls `engine.reload(wcId, { ignoreCache: true })` only when `ignoreCache === true`, otherwise `engine.reload(wcId)`. `reload` moves out of `automation-mcp-tools.test.js`'s shared `[42]` loop into its own test covering both shapes.
  - `keyEvents('F5')[0].keyCode === 'F5'`. `PRESS_KEY_NAMES` (in `src/main/automation/mcp-tools.js`, not `input.js`) includes `F5`, and also `F6`, a drift fix: F6 has been in `KEY_MAP` since M17 but was never listed.
  - The new `reload` tool test asserts that `{ wcId: 42 }`, `{ wcId: 42, ignoreCache: false }` and `{ wcId: 42, ignoreCache: 'true' }` all call `engine.reload` with exactly `[42]`, and `{ wcId: 42, ignoreCache: true }` with `[42, { ignoreCache: true }]`. The optional schema property is pinned with the existing `declaresOptional` helper. The `required: ['wcId']` assertion, the void-op `{"ok":true}` loop and the `callTool('reload', …)` tests stay as they are.
- [ ] **AC8 — docs**:
  - `README.md`'s shortcut table lists Ctrl+Shift+R / Shift+F5 / Ctrl+F5 as "Hard reload (bypass cache)" and F5 as "Reload".
  - `docs/mcp-automation.md` documents `ignoreCache` on `reload` and adds `F5` and `F6` to `pressKey`'s names list.
  - The stale comments are updated: `keydown-action.js`'s gating bullets, `shortcut-controller.js`'s keydown-listener comment ("the t/w/l/m/Shift+P/r chain"), `sheet-accelerator.test.js`'s "control||meta required except F12" section heading, and the allowlist header's "12 outputs … exactly {…reload}" enumeration.
- [ ] **AC9 — gates**: `npm test`, `npm run typecheck`, `npm run lint` and `npm run format:check` all pass. `git diff --stat main -- src/renderer/renderer.js` is empty.
- [ ] **AC10 — fixture and live smoke test**:
  - `tests/behavior/fixtures/hard-reload/server.mjs` exists and implements the spec's Preconditions: `index.html` is `no-store` with `window.__loadId` and `asset.js?n=<nonce>`; `asset.js` is `max-age=3600`; `GET /hits` returns `{ asset, last: { cacheControl, pragma } }` from lowercased request headers; `GET /reset` zeroes the counts and mints a new nonce.
  - The live smoke test below passes against a dev instance and is recorded in the flight log.
  - The formal acceptance run is the Flight Director's `/mission-control:behavior-test hard-reload` after this leg lands. The leg is not complete while it fails.

## Verification Steps
- AC1–AC7: `npm test` (the named files). Spot-check the classifier with `node -e` over the AC1 table.
- AC8: read the diffs.
- AC9: run the four commands, plus `git diff --stat main -- src/renderer/renderer.js`.
- AC10 — the **live smoke test** (project rule: exercise every existing apparatus primitive against the new state):
  1. Launch `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation` in the background, capture the `AUTOMATION_DEV_MINT` admin key, and attach with `scripts/lib/mcp-client.mjs` (recipes in `docs/dev-testing.md`).
  2. Start `node tests/behavior/fixtures/hard-reload/server.mjs`.
  3. Drive a condensed version of the spec:
     - census: `enumerateTabs`, `enumerateWindows` (record `chromePid`), `getChromeTarget`;
     - `openTab` the fixture, `activateTab`, `evaluate(C, "window.__hrMarker=1")`;
     - `pressKey(G,'r',['control'])` → `asset` flat;
     - `pressKey(G,'R',['control','shift'])` → `asset` +1 with `last.cacheControl === 'no-cache'`;
     - `pressKey(G,'F5',['shift'])` → +1;
     - `pressKey(G,'F5',['control'])` → +1;
     - `pressKey(G,'F5')` → flat;
     - `evaluate(C, "document.getElementById('address').focus()")`, then `pressKey(C,'R',['control','shift'])` → +1;
     - Shift+click via `evaluate(C, …dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true})))` → +1;
     - `reload({wcId:G, ignoreCache:true})` → +1, and `reload({wcId:G})` → flat;
     - `captureWindow` and `captureScreenshot(G)`: the page and chrome render normally;
     - `readDom(G)`;
     - finally `evaluate(C, "window.__hrMarker") === 1` and `chromePid` unchanged (DD7).
  4. Record each observed `asset` count and `__loadId` in the flight log. Wait for each load to finish (`readyState === 'complete'`) before the next action.
  5. Stop the dev instance and the fixture server when done.
  - **If** `pressKey` with Shift reports the key as lowercase `'r'`, both forms are classified anyway; note which one arrived.
  - **Apparatus limit (DD7)**: `pressKey` uses `wc.sendInputEvent`. That reaches `before-input-event` and the DOM keydown handler, but may bypass the native menu-accelerator path a real keypress takes. So an unchanged marker/`chromePid` after synthetic input does NOT prove DD7. The real-keypress check is a single `[by-eye]` operator step the Flight Director runs after the behavior test: a physical Ctrl+Shift+R with the address bar focused, then with the page focused, then confirm the marker and `chromePid`. Report the synthetic result as "synthetic path: chrome did not reload", never as "DD7 verified".
  - **If** the chrome reloads at any point (marker gone or `chromePid` changed), STOP and signal `[BLOCKED:default-menu-force-reload]`. This is a Divert criterion, not something to fix in this leg.

## Implementation Guidance

1. **Classifier pair (lockstep, one edit each)**
   - `keydown-action.js`: after the F6 branch, add `if (key === 'F5' && !alt) return shift || ctrl || meta ? 'hard-reload' : 'reload';`. In the shifted chain beside T/B, add `if (shift && (key === 'R' || key === 'r')) return 'hard-reload';`. Add `'hard-reload'` to the `@returns` union and update the header's gating bullets: F5 joins F12/F6 before the modifier gate, and the `r` entry in "the rest of the chain" list gains Shift+R.
   - `sheet-accelerator.js`: the same two branches. F5 goes right after F12 (returning `{ scope: 'chrome', action: … }`), and Shift+R joins the shift-disambiguated block. Update the `@returns` union, the header's chrome-class list, the "Case discipline" paragraph (`r` is now matched shifted too) and the APG note ("EXCEPT F12 and F5, neither of which is an APG key").
2. **Allowlist**: add `'hard-reload'` to `WEB_CHROME_ACTIONS` right after `'reload'`, and update the header comment's enumerations. Do NOT touch `INTERNAL_CHROME_ACTIONS` or `isRepeatSafeAction`.
3. **Chrome dispatch**: add `case 'hard-reload':` beside `case 'reload'`, with the same guard and `return true`, sending `verb: 'reloadIgnoringCache'`. Add it to the test harness `actions` list where relevant.
4. **Button**: change the listener to `(e) => { … }`. In the non-✕ branch, `verb: e.shiftKey ? 'reloadIgnoringCache' : 'reload'`. The ✕ branch stays `stop`.
5. **Main verb**: add `} else if (verb === 'reloadIgnoringCache') {` after the `reload` branch, mirroring it, with `wc.reloadIgnoringCache()` in place of `wc.reload()`. Reference no `args`. A small shared helper is acceptable.
6. **Automation**:
   - `nav.reload(wcId, deps, opts)` with `opts && opts.ignoreCache === true ? wc.reloadIgnoringCache() : wc.reload()`.
   - `engine.js` threads `(wcId, opts) => nav.reload(wcId, deps(), opts)`.
   - In `mcp-tools.js`, add the schema property and make `call` pass `{ ignoreCache: true }` only when strictly true. Update the description, e.g. "Reload the tab identified by wcId. Pass ignoreCache: true to bypass the HTTP cache (a hard reload)."
   - Check `scope.js` forwards the extra argument for jar keys (the Architect read `(wcId, ...rest)`), and add or extend a test if one pins arity.
   - Add `F5: 'F5'` to `input.js` `KEY_MAP` with a one-line comment (the F6 precedent), and add `F5` and `F6` to `mcp-tools.js` `PRESS_KEY_NAMES`.
7. **Tests**: per AC1–AC7. Keep the existing test naming style (DD references like `Sortie 03 DD2`).
8. **Docs**: per AC8.
9. **Fixture**: create `server.mjs` per AC10, serving `index.html` and `asset.js` from inline strings (no static files needed). `asset.js` sets `window.__assetRan = (window.__assetRan||0)+1`. The server prints `hard-reload fixture listening on http://127.0.0.1:8766` on start. Prettier formats `.mjs`, so run `npm run format`.
10. **Format**: run `npm run format` before the gates.

## Edge Cases
- **Ctrl+Shift+R with an AZERTY or other layout**: the shifted branch matches both cases, so it works wherever `key` is `R`/`r`.
- **Ctrl+Alt+F5 / AltGr**: `!alt` makes these fall through. They aren't character-producing, but this matches the F6 gate for consistency.
- **F5 while a lightbox is open**: still reloads (reload is not lightbox-gated).
- **F5 in a text field of the page**: forwarded and preventDefaulted, as Chrome does. F5 has no text-editing meaning.
- **Held Ctrl+Shift+R under chrome focus** repeats, like a held Ctrl+R today (DD3); the guest and sheet paths fire once.
- **Shift+click while loading (✕)**: stop wins.
- **Crashed-before-first-commit guest**: falls back to `loadURL(effectiveUrl(entry))` (DD4).
- **Ctrl+Alt+Shift+R**: classifies `hard-reload`. The shifted letter chain (T/B/P/I/R) carries no `alt` gate, unlike F5/F6; this is consistent with the existing chain and deliberately not changed.
- **IPC-level internal tab**: like `reload`, the main-side `reloadIgnoringCache` branch has no internal-tab refusal. The chrome-side `isWebTab` gate is the filter (parity, a deliberate choice), so charter criterion 3 holds at the trigger level. Reloading an in-memory `goldfinch://` page is harmless.
- **Load-failure/crash panel showing**: the shortcut sends the verb exactly like `reload` does (no `guestTakenOver` gate on either).

## Files Affected
- `src/shared/keydown-action.js`: F5 + Shift+R branches, `@returns` union, docs
- `src/shared/sheet-accelerator.js`: lockstep mirror, docs
- `src/shared/guest-forward-allowlist.js`: `'hard-reload'` in `WEB_CHROME_ACTIONS`, header
- `src/renderer/chrome/shortcut-controller.js`: `case 'hard-reload'`
- `src/renderer/chrome/navigation-controller.js`: Shift+click
- `src/main/register-tab-ipc.js`: `reloadIgnoringCache` verb
- `src/main/automation/nav.js`, `engine.js`, `mcp-tools.js` (incl. `PRESS_KEY_NAMES`), `input.js`: `ignoreCache` and `F5`
- `test/unit/keydown-action.test.js`, `sheet-accelerator.test.js`, `shortcut-classifier-parity.test.js`, `guest-forward-allowlist.test.js`, `guest-wiring.test.js`, `shortcut-controller.test.js`, `navigation-controller.test.js`, `register-tab-ipc.test.js`, `automation-nav.test.js`, `automation-mcp-tools.test.js`, `automation-input.test.js`
- `README.md`, `docs/mcp-automation.md`
- `tests/behavior/fixtures/hard-reload/server.mjs` (new)

## Citation Audit
2026-10-10: Flight Director checked every Inputs citation against `2d9a1e6`:
- the `keydown-action.js` `if (key === 'r') return 'reload';` and its F12/F6/`mod` gate;
- the `sheet-accelerator.js` F12 line and `if (key === 'r')` line;
- `guest-forward-allowlist.js` `WEB_CHROME_ACTIONS`;
- the `shortcut-controller.js` `case 'reload'`;
- the `navigation-controller.js` `#reload` listener;
- `register-tab-ipc.js` `verb === 'reload'`;
- `nav.js` `reload`, `engine.js` `reload:` and the `mcp-tools.js` `name: 'reload'` tool;
- the `input.js` `KEY_MAP` `F6` entry;
- the test anchors (`sheet-accelerator.test.js` negative loop, `guest-forward-allowlist.test.js` lists, the `automation-mcp-tools.test.js` `[42]` loop per the Architect review, the `automation-input.test.js` F6 test);
- the `README.md` shortcut row.

Citations are by symbol or snippet, not line number.

Design review (cycle 1, Developer): **approve with changes**.
- Incorporated:
  - the DD7 apparatus limit plus the `[by-eye]` real-keypress step;
  - end-to-end pins for chrome keydown and `onChromeShortcutAction` (AC4);
  - an optional real-sheet window-factory test;
  - `PRESS_KEY_NAMES` relocated to `mcp-tools.js`, with the F6 drift fix;
  - precise `automation-mcp-tools.test.js` touchpoints;
  - the IPC-level internal-tab parity note;
  - the Ctrl+Alt+Shift+R note;
  - the stale-comment list;
  - the Ctrl+F5 and address-focus smoke steps.
- No second cycle: the changes are test coverage and documentation precision, not design.
