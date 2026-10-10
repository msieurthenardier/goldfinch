# Sortie: Hard Reload

**Status**: completed

## Charter

### Outcome
When the operator Shift-refreshes a page, Goldfinch re-fetches it from the network instead of serving it from the cache, the same as Chrome.

### Why Now
The operator reported that Shift-refresh appeared to do nothing. Investigation (2026-10-10) found there is no hard-reload path anywhere in `src/` (no `reloadIgnoringCache` call). Ctrl+Shift+R classifies to `null` because `keydownToAction` matches lowercase `'r'` only, while a Ctrl+Shift+`'r'` event classifies to a plain `reload`. F5 and Shift+F5 are unmapped, Shift+click on the reload button ignores the modifier, and the `tab-navigate` `reload` verb only ever calls `wc.reload()`. The work was first checked as a squawk and failed criterion 3 (it changes the shared `tab-navigate` verb set, the `keydownToAction`/`sheet-accelerator` pair, and the security-sensitive guest-forward allowlist) and the new-behavior rule.

### Success Criteria
- [ ] Ctrl+Shift+R, Shift+F5, Ctrl+F5 and Shift+click on the reload button reload the active web tab without using the cache, whether OS focus is in the page or in the chrome (toolbar/address bar), and the shortcuts also work while a menu-overlay sheet is open
- [ ] Ctrl+R, F5 and a plain click still do a normal reload that uses the cache
- [ ] Every hard-reload trigger does nothing on internal `goldfinch://` tabs and on welcome tabs, the same as normal reload today
- [ ] Unit tests cover the classifier (including the paired `sheet-accelerator.js` copy and the parity corpus), the guest-forward allowlist entry, the chrome dispatch, the button handler and the main-side verb

### Constraints
- No loosening of the security boundaries: guest keystrokes reach the chrome only through `guest-forward-allowlist.js`, and the new verb takes no page-supplied arguments.
- `keydown-action.js` and `sheet-accelerator.js` change together (the documented lockstep rule).
- `src/renderer/renderer.js` is at 1545 of its 1546-line budget: this sortie does not touch it.
- No change to Electron's default application menu or any other global hook.

---

## Pre-Flight

### Objective
Add a cache-bypassing reload to Goldfinch. A new chrome-shortcut action, `hard-reload`, and a new `tab-navigate` verb, `reloadIgnoringCache`, carry it from every trigger — the chrome DOM keydown handler, the guest `before-input-event` forwarder, the menu-overlay sheet forwarder and Shift+click on `#reload` — to `wc.reloadIgnoringCache()` in main. Plain F5 joins Ctrl+R as a normal reload. The MCP `reload` tool gains an optional `ignoreCache` argument, and `pressKey` learns `F5`, so the behavior spec can drive and observe both paths.

### Open Questions
- [x] Which triggers? → DD2 (Chrome set, operator choice)
- [x] Plain F5? → DD2 (yes, normal reload; charter agreed)
- [x] MCP option? → DD5 (yes, optional `ignoreCache`, operator choice)
- [x] HAT leg? → no (operator choice); a behavior spec plus the leg's live smoke test cover the real environment
- [x] Does Electron's default application menu interfere? → DD7 (premise, verified live in the leg)

### Design Decisions

**DD1 — One new action and one new verb; no flag on the existing ones.** The classifier returns a distinct action `'hard-reload'`; the chrome dispatches it as `tabNavigate({ wcId, verb: 'reloadIgnoringCache', args: [] })`; main's `tab-navigate` handler gets a sibling `else if (verb === 'reloadIgnoringCache')` branch.
- Rationale: every consumer of these closed sets (the allowlist, the parity corpus, the dispatch `switch`, the verb `if`-chain) is an allowlist keyed on the string, so a distinct name is visible to each one and is denied by default where it isn't added. An `args: [true]` flag on `reload` would ride through the allowlist unseen and make the verb take a chrome-supplied argument.
- Trade-off: two near-duplicate branches in main and in the dispatch, instead of one parameterized branch.

**DD2 — Trigger set (Chrome parity).**

| Input | Action |
|---|---|
| Ctrl/Cmd+R (`'r'`, unshifted) | `reload` (unchanged) |
| Ctrl/Cmd+Shift+R (`'R'` or `'r'` with `shift`) | `hard-reload` |
| F5 (no modifier) | `reload` |
| Shift+F5, Ctrl/Cmd+F5, Ctrl/Cmd+Shift+F5 | `hard-reload` |
| Alt+F5 (any Alt) | `null` (falls through, like Alt+F6) |
| Click on `#reload` | `reload` / `stop` (unchanged) |
| Shift+click on `#reload` while it shows ⟳ | `hard-reload` |
| Shift+click on `#reload` while it shows ✕ | `stop` (unchanged: stop wins) |

- The shifted `R` branch sits in the shifted chain **before** the unshifted `'r'` branch, the established Ctrl+Shift+T/B/P placement. This changes Ctrl+Shift+`'r'` from today's plain reload to a hard reload, which is the intended correction.
- F5 is decided **before** the `mod = ctrl || meta` gate, beside F12 and F6. It is not lightbox-gated (reload is not lightbox-gated today).
- Rationale: matches Chrome on Windows/Linux, which is what the operator expects.
- Trade-off: Ctrl+Shift+R is the Electron default menu's Force Reload accelerator; see DD7.

**DD3 — Forwarding scope: web guests only; not repeat-safe.** `'hard-reload'` joins `WEB_CHROME_ACTIONS` beside `'reload'` and does **not** join `INTERNAL_CHROME_ACTIONS` (internal pages are static, and `reload` isn't there either). `isRepeatSafeAction` needs no change (no `tab-` prefix), so a held chord fires once. In the sheet, both F5 entries and `Ctrl+Shift+R` return `{ scope: 'chrome', action }` with no `autoRepeatGuard`, matching the sheet's existing `reload` entry (parity, not a new posture). The chrome dispatch `case 'hard-reload'` mirrors `case 'reload'`: it no-ops unless the active tab passes `isWebTab(t) && t.wcId != null`, and returns `true` (preventDefault) either way.
- **Held keys**: guest and sheet paths fire once per hold (the guest forwarder's `!isAutoRepeat` guard; the sheet's single keyDown). The chrome DOM keydown handler does not check `e.repeat`, so a held Ctrl+Shift+R under chrome focus repeats, exactly as a held Ctrl+R does today. This is parity, deliberately not changed here.
- **Load-failure/crash panels**: the shortcut behaves like `reload` there too (no `guestTakenOver` gate; `reload` has none).
- **F5 in the sheet**: active while the sheet holds focus. F5 is not an APG key, so the sheet's "APG keys excluded by construction" property holds; the comment saying "every mapping requires control||meta EXCEPT F12" is updated to name F5.
- Rationale: identical gating to `reload` is what charter criterion 3 asks for, and the closed allowlists keep the action out of internal guests by default.
- Trade-off: none beyond the parity choices above.

**DD4 — Main-side verb reuses the empty-history fallback.** `reloadIgnoringCache` sits behind the handler's existing sender/`wc` guards and repeats the `reload` branch's structure: if `wc.navigationHistory.length() === 0` it calls `wc.loadURL(effectiveUrl(entry))` (a crashed-before-first-commit guest has nothing to reload), otherwise `wc.reloadIgnoringCache()`. It reads nothing from `args`. If extracting a shared helper for the two branches is cleaner, that's an acceptable variation.
- Rationale: one predictable behavior across both verbs, and the new verb adds no new input surface.
- Trade-off: the fallback `loadURL` is a normal load, not a cache-bypassing one. It's acceptable because that guest has no cache entry to bypass.

**DD5 — MCP `reload` gains optional `ignoreCache`; `pressKey` gains `F5`.** `mcp-tools.js` `reload` schema adds `ignoreCache: { type: 'boolean' }` (optional, not required). The tool calls `engine.reload(wcId, { ignoreCache: true })` only when `ignoreCache === true` and `engine.reload(wcId)` otherwise (so the existing `automation-mcp-tools.test.js` `[42]` call-shape pin for the other nav tools stays meaningful; `reload` moves out of that shared loop into its own test), and `nav.reload` calls `wc.reloadIgnoringCache()` only when `ignoreCache === true` (strict; any other value → `wc.reload()`). The internal-session guard runs first, unchanged. Scope tiering is unchanged (`scope.js` already lists `reload`). `input.js` `KEY_MAP` adds `F5: 'F5'` (the F6 precedent, M17 F1 L1), which updates `PRESS_KEY_NAMES` and the tool description. `docs/mcp-automation.md` documents both.
- Rationale: an exact automation act path for the behavior spec, and a hard reload is useful to agents. It's backward compatible: omitting the argument is byte-identical behavior.
- Trade-off: a small addition to the automation surface.

**DD6 — Behavior-spec apparatus (act and observe).**
- **Act**: MCP `pressKey(G, 'R', ['control','shift'])`, `pressKey(G, 'F5', ['shift'])` etc. on the guest; this goes through `sendInputEvent`, which fires the guest's `before-input-event`, the same path the `chrome-guest-keyboard-nav` spec relies on. `pressKey(C, …)` on the chrome target (admin) drives the chrome DOM keydown path. Shift+click is driven by admin `evaluate(C, "document.getElementById('reload').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}))")`, since the click handler reads `event.shiftKey`. `reload({ wcId: G, ignoreCache: true })` drives the MCP path.
- **Observe**: a tiny fixture server (`tests/behavior/fixtures/hard-reload/server.mjs`, `node:http` only, `127.0.0.1`) serves `index.html` (`Cache-Control: no-store`, stamps `window.__loadId` with a per-response counter) and `asset.js?n=<nonce>` (`Cache-Control: max-age=3600`). The nonce is minted at server start and on every `GET /reset` and embedded by `index.html`, so a later run never hits an `asset.js` the profile cached on an earlier run (the HTTP cache persists across runs; `/reset` can't clear it). Request headers are read lowercased (`req.headers['cache-control']`). It counts `/asset.js` requests and records each one's `cache-control`/`pragma` request headers, exposed at `GET /hits` as JSON and read with `curl` (shell observable, independent of the browser). A hard reload re-requests `asset.js` with `cache-control: no-cache`; a normal reload serves it from the cache, so the count doesn't move. Corroborator: `evaluate(G, "performance.getEntriesByType('resource').find(e=>e.name.endsWith('/asset.js'))?.transferSize")` is `0` on a cache hit and nonzero after a hard reload. That a reload happened at all is read from `evaluate(G, 'window.__loadId')`.
- Rationale: the cache state is invisible to the unit suite, and the server-side count is the most direct observable for it.
- Trade-off: the fixture is a new script (no third-party dependency); the sheet-open path and the internal/welcome no-ops can't be driven (the sheet isn't scriptable; internal tabs refuse `evaluate`), so those are covered by unit tests only.

**DD7 — Electron default-menu premise (verified live, not changed).** Goldfinch never calls `Menu.setApplicationMenu`, so Electron installs its default menu. A headless probe on 2026-10-10 showed View → *Reload* `CmdOrCtrl+R` and *Force Reload* `Shift+CmdOrCtrl+R`. The new handlers `preventDefault()` the chord on both the guest (`before-input-event`) and the chrome (DOM keydown) paths, which should keep the menu accelerator from firing. The leg verifies this live: after Ctrl+Shift+R under both guest focus and chrome focus, the chrome view must not have reloaded (`enumerateWindows()` `chromePid` unchanged AND a marker set with `evaluate(C, 'window.__hrMarker = 1')` still present). If the menu accelerator does fire, the leg stops and reports; removing or replacing the default menu is a global-hook change outside this charter (it carries Ctrl+Q/Ctrl+W/Ctrl+M/edit roles).
- Design review note: the default menu's *Reload*/*Force Reload* roles target the focused `BrowserWindow`; Goldfinch windows are `BaseWindow`s, so the roles are likely no-ops already (which would explain why Ctrl+R never double-reloads today). A DOM-level `preventDefault()` is not confirmed to suppress a native accelerator — only `before-input-event`'s is — so the chrome-focused live check is the one that matters.
- Rationale: the project rule that a design resting on an empirical premise verifies it, and the prohibition on silently changing global hooks.
- Trade-off: none; the check is cheap and already inside the behavior spec.

### Prerequisites
- [x] No active mission or open sortie overlaps (missions 01–22 and sorties 01–02 are `completed`)
- [x] `renderer.js` will not be touched (budget 1545/1546)
- [ ] Dev instance launchable via `npm run dev:automation` with admin tier (`GOLDFINCH_AUTOMATION_ADMIN=1`) for the live smoke test and the behavior spec. The repo's `goldfinch-dev` MCP entry timed out on 2026-10-10 because no dev instance was running; the leg launches its own instance.

### Pre-Flight Checklist
- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified (dev instance is launched by the leg itself)
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach
One leg carries the whole slice.

1. **Classifier pair** (`src/shared/keydown-action.js`, `src/shared/sheet-accelerator.js`): F5 branch before the modifier gate (`!alt`; `shift || ctrl || meta` → `hard-reload`, else `reload`); `shift && (key === 'R' || key === 'r')` → `hard-reload` in the shifted chain before the unshifted letters. The JSDoc `@returns` unions in both gain `'hard-reload'` (typecheck), and the doc comments are updated: the header gating notes, the sheet's chrome-class list, and both "every mapping requires control||meta EXCEPT F12" notes (header and `isGuestActionAllowed`'s neighbourhood) to name F5.
2. **Forwarding** (`src/shared/guest-forward-allowlist.js`): `'hard-reload'` in `WEB_CHROME_ACTIONS` only; the header comment's "exactly {new-tab, … reload}" enumeration is updated so it doesn't go stale.
3. **Chrome dispatch** (`src/renderer/chrome/shortcut-controller.js`): `case 'hard-reload'` mirroring `case 'reload'`.
4. **Button** (`src/renderer/chrome/navigation-controller.js`): the `#reload` click handler takes the event; when not in the ✕ (stop) state and `e.shiftKey`, send `reloadIgnoringCache`.
5. **Main verb** (`src/main/register-tab-ipc.js`): DD4.
6. **Automation** (`src/main/automation/nav.js`, `engine.js`, `mcp-tools.js`, `input.js`): DD5.
7. **Tests**: extend
   - `keydown-action.test.js`: the DD2 table, including Alt+F5 → `null` and Ctrl+Shift+`r` → `hard-reload` (any existing pin of Ctrl+Shift+`r` → `reload` or F5 → `null` is retargeted, not deleted).
   - `sheet-accelerator.test.js`: **retarget the existing negative loop** at `for (const key of ['W','L','M','R'])` asserting Ctrl+Shift+key → `null` — drop `'R'` (the M09 F4 `'T'` precedent) and add positive tests for Ctrl+Shift+`R` and `r`; the plain-F5 / modifier-less test block gains F5 as the second exempt key beside F12.
   - `shortcut-classifier-parity.test.js`: CHROME_SCOPE_CASES gains Ctrl+Shift+R, Ctrl+Shift+`r`, F5, Shift+F5, Ctrl+F5; a negative for Alt+F5 (the Alt+F6 precedent).
   - `guest-forward-allowlist.test.js`: web yes / internal no / not repeat-safe.
   - `guest-wiring.test.js`: a guest Ctrl+Shift+R and a guest F5 forward once and preventDefault; an internal guest forwards neither.
   - `shortcut-controller.test.js`: dispatch sends the verb for a web tab; no-op for internal, welcome and null-wcId tabs; returns `true` in every case.
   - `navigation-controller.test.js`: Shift+click on ⟳ → `reloadIgnoringCache`; plain click → `reload`; ✕ state + shift → `stop`.
   - `register-tab-ipc.test.js`: extend the fake `wc` with `reloadIgnoringCache()`; the verb calls it; the empty-history fallback; `args` are ignored.
   - `automation-nav.test.js`: `ignoreCache` true / absent / non-boolean (`'true'`, `1`) → only `true` hard-reloads; the internal guard fires first.
   - `automation-mcp-tools.test.js`: **move `reload` out of the shared `[42]` call-shape loop** into its own test (with and without `ignoreCache`); schema lists `ignoreCache` as optional.
   - the `input.js` key test: F5 resolves; `PRESS_KEY_NAMES` includes it.
8. **Docs**: `README.md` keyboard-shortcuts table (add Ctrl+Shift+R / Shift+F5 / Ctrl+F5 hard reload and F5 reload beside Ctrl+R); `docs/mcp-automation.md` (`reload` row, `PRESS_KEY_NAMES`, `pressKey` list); a CLAUDE.md line only if a new invariant is worth carrying (not expected).
9. **Fixture and spec**: create `tests/behavior/fixtures/hard-reload/` (`server.mjs`, `index.html`, `asset.js`) per DD6, then run the live smoke test (below).

### Checkpoints
- [x] Classifier pair, allowlist and parity corpus green
- [x] Chrome dispatch, button and main verb green
- [x] Automation `ignoreCache` and `F5` green
- [x] `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` green
- [x] Live smoke test passes, including the DD7 premise check

### Adaptation Criteria

**Divert if**:
- The Electron default menu's Force Reload fires on top of the new handler (DD7): stop and report; the fix is a global-hook decision outside this charter.
- `sendInputEvent` from `pressKey` does not fire the guest's `before-input-event` for F5 or the Ctrl+Shift+R chord, leaving the guest path unobservable (DD6 act premise).
- Making Ctrl+Shift+R work under guest focus needs anything beyond adding the action to `WEB_CHROME_ACTIONS` (e.g., a new forwarding mechanism).

**Acceptable variations**:
- A shared helper for the `reload`/`reloadIgnoringCache` main-side branches.
- Test names and file placement within `test/unit/`.
- The fixture's port and exact response bodies, as long as the spec is updated to match.

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are planned and created one at a time as the flight progresses. This list will evolve based on discoveries during implementation.

- [x] `hard-reload` - Classifier pair, allowlist, chrome dispatch, Shift+click, main verb, MCP `ignoreCache` + `F5`, unit tests, docs, fixture; live smoke test covering every apparatus primitive used against the new state (census, windows, `pressKey` on guest and chrome, `evaluate`, `reload`, `captureWindow`) and the DD7 premise

---

## Post-Flight

### Completion Checklist
- [x] All legs completed
- [ ] Code merged (PR #251 open; operator merges after this debrief)
- [x] Tests passing
- [x] Documentation updated

### Verification
- Unit: `npm test` (the files listed in Technical Approach step 7), plus `npm run typecheck`, `npm run lint`, `npm run format:check`.
- Real environment: behavior spec [`hard-reload`](../../tests/behavior/hard-reload.md), run with `/mission-control:behavior-test hard-reload` against `npm run dev:automation` (admin tier).
- Not observable live, covered by unit tests only: the sheet-open shortcut path (the sheet isn't scriptable) and the internal/welcome no-ops.
