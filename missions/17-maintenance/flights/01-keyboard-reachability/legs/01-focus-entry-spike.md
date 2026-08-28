# Leg: focus-entry-spike

**Status**: completed
**Flight**: [Keyboard Reachability and Omnibox Semantics](../flight.md)

## Objective

Prove, with real code on the real paths, that (1) a keyboard gesture in the chrome can hand OS focus to the active guest and land on its first tabbable, (2) the guest can detect "forward Tab on the last tabbable / Shift+Tab on the first" and hand focus back, and (3) with that signal available, mid-page Tab no longer ejects to the address bar — so the flight's DD1–DD3 can be written from evidence rather than guessed.

## Context

Ground truth (scout brief, 2026-08-27, all citations verified):
- Guest→chrome today: `src/shared/cross-view-nav.js:39` returns `'tab-handoff'` for **any** unmodified forward Tab; `src/main/guest-wiring.js:handleCrossView` (`:100-116`) `preventDefault()`s, `chrome.focus()`, and sends `chrome-shortcut-action {action:'focus-address'}`. `before-input-event` is wired for both guest branches (internal/trusted `:244-247`, web `:358-361`) and popups inherit it (`did-create-window` → `wireGuestContents(popupWc)` `:299`). Pinned by `test/unit/cross-view-nav.test.js:47` `'unmodified Tab → tab-handoff'` (invert/rename) and `:51` `'Shift+Tab → null'` (extend).
- Chrome→guest primitives: `register-tab-ipc.js:949` `entry.view.webContents.focus()` gated by `wasPageFocused` (`:915`) — preserves, never grants; `find-overlay-manager.js:291` `if (refocusGuest) wc.focus()` from `register-overlay-ipc.js:698`. **No renderer-invocable "focus the active guest" bridge exists** (`chrome-preload.js` confirmed).
- Chrome classifier: `src/shared/keydown-action.js:61-67` — F12 decided first (`:64`); `const mod = ctrl || meta; if (!mod) return null;` (`:66-67`). Action union `:51-59`. Enter in the address bar: `navigation-controller.js:361-371` `navigate()` then `els.address.blur()` — focus lands on `body`.
- Guest preload: the **web** branch (`src/preload/webview-preload.js`) runs with `contextIsolation:false` in the page main world (`register-tab-ipc.js:107`; header `:199-201`), already listens `focusin`/`focusout` on `document` (`:265-266`, vault icon); the **internal/trusted** branch uses a different preload with `contextIsolation:true, sandbox:true` (`register-tab-ipc.js:95-98`). Precedent for "guest reports a page event → main forwards to chrome": `ipcRenderer.send('guest-vault-gesture')` → `register-browser-ipc.js` `ipcMain.on('guest-vault-gesture', (event) => { const wcId = event.sender.id; chromeForTab(wcId)?.send('vault-gesture', {wcId}); })` — payload-free, wcId from `event.sender.id`.
- Chrome focus order: `index.html` has no static `tabindex`; `#media-panel.collapsed` / `#privacy-panel.collapsed` are `width:0; overflow:hidden` (`styles.css:1080-1083`, `:1516-1519`), not `display:none` — their buttons may stay tab-reachable while invisible (phantom focusables; re-derive live).
- Behavior spec `tests/behavior/chrome-guest-keyboard-nav.md`: step 2 (`:45`) establishes guest focus by **mouse**; steps 5–6 (`:48-49`) pin the ejection/wrap. No other spec references `tab-handoff`/`focus-address`.
- Fixtures under `tests/behavior/fixtures/`: `vault-card/index.html` (25 inputs, 9 buttons), `tab-scheme-guard/index.html` (1 link, 9 buttons), `menu-overlay/index.html` (2 links, 1 input); none with zero focusables or an iframe. Served via `python3 -m http.server 8000 --directory <dir>` (`scripts/a11y-audit.mjs:49-50` pattern).

Tentative design decisions this leg must confirm or overturn (recorded in `flight.md` as DD1–DD4 *pending Leg 1*):
- **DD1 (gesture)**: **F6** cycles chrome → content, **Shift+F6** content → chrome (browser convention; Chromium's own binding). Precedent for an unmodified key in the classifier: F12 (`keydown-action.js:64`). Enter-in-address-bar-focuses-page is *not* in this leg (Leg 2 may add it once DD1 holds).
- **DD2 (exhaustion signal)**: a pure helper `tabBoundary(doc)` in `src/shared/` (CJS-by-design; see the `preload-graph-esm-free.test.js` rule) — reachable from both preload branches **only via bundling** (DD5 below: the internal/trusted preload is sandboxed too, `register-tab-ipc.js:94-98`, and a sandboxed preload's restricted loader cannot resolve relative `require()`s — `scripts/build-preload.mjs` header) computes the page's tabbable sequence (`a[href], area[href], button, input, select, textarea, iframe, [contenteditable=true], [tabindex]` minus `[tabindex="-1"]`, `disabled`, `hidden`, and `display:none`/`visibility:hidden` via `getClientRects().length`) and reports whether `document.activeElement` is its first/last element (or the page has none). Each guest preload adds a **capturing** `keydown` listener on `window` for unmodified Tab / Shift+Tab; when `tabBoundary` says the press would leave the sequence, it `ipcRenderer.send('guest-tab-boundary', { direction: 'forward' | 'backward' })` — main (`register-browser-ipc.js`, new handler in the `guest-vault-gesture` shape, wcId from `event.sender.id`, direction validated against the two literals) forwards `tab-boundary {direction}` to `chromeForTab(wcId)`. The preload **`preventDefault`s at the boundary** (design-review ruling: today's only guest→chrome key handoff, `guest-wiring.js:100-116`, always `preventDefault`s before ceding control; without it Chromium's synchronous default Tab action runs in the guest before the async IPC round-trip and main's `chrome.focus()`, risking a flicker and stray keystrokes landing in the guest). *Leg 1's first measurement is whether the `preventDefault` + async handoff is clean; the non-preventDefault variant is the fallback to measure only if it isn't.*
- **DD3 (guest-side change)**: `crossViewNavAction` stops returning `'tab-handoff'` for unmodified Tab — plain Tab falls through to Chromium. `'focus-address'` (Ctrl/Cmd+L) unchanged.
- **DD4 (chrome-side placement)**: on `tab-boundary {direction:'forward'}` the chrome focuses `#address`; on `'backward'` it focuses the **last** chrome tabbable computed live with the same `tabBoundary`-family helper (phantom-focusable risk above — the helper's visibility filter must exclude `width:0; overflow:hidden` ancestors, or the panels get `visibility:hidden` when collapsed — Leg 1 decides). On F6 the chrome calls a new bridge method `focusActiveGuest()` → `ipcMain.handle('tab-focus-guest')` → `entry.view.webContents.focus()` for the **active** tab only (sender-validated like `tab-set-active`); Shift+F6 in the chrome is a no-op in Leg 1 (chrome is already the target). Chrome-side dispatch lives in `src/renderer/chrome/shortcut-controller.js` — `dispatchChromeAction`'s switch (`:41+`) already owns every `keydownToAction` case, and the `chrome-shortcut-action` push handler is subscribed there (`:215` `onChromeShortcutAction`); `renderer.js` calls `createShortcutController(deps)` once (`:629`) and needs at most new deps on that call (budget 1827, current 1826).
- **DD5 (preload bundling)**: extend `scripts/build-preload.mjs` to bundle **both** guest preloads — `webview-preload.js` (already) and the internal/trusted preload (`register-tab-ipc.js:94-98`, sandboxed, currently zero relative requires) — to `*.bundle.js` siblings; `register-tab-ipc.js` points the trusted branch at its bundle; `.gitignore`/`.prettierignore` gain the new bundle; `test/unit/webview-preload-bundle.test.js` is the template for a matching structural pin; `preload-graph-esm-free.test.js` covers the new graph. Rejected alternative: inlining `tabBoundary` into the internal preload (duplicated logic the sweep would flag).
- **Popups (settled by review, not measured)**: `chromeForTab(popupWcId)` does not resolve — popups are in `popupRegistry`, not `rec.tabViews` (`window-registry.js:181-187`; `guest-wiring.js:94-98` uses the registry as a fallback). A popup has no chrome to hand focus to, so the forwarder's no-op for popups is **accepted** in this leg and recorded; a `popupRegistry` fallback is not built.
- **Automation apparatus**: `pressKey`'s `KEY_MAP` (`src/main/automation/input.js:20-30`) has no `F6` and the fallback regex (`:107`) rejects it — **add `F6`** (one entry, `Tab: 'Tab'` shape) so the behavior test can press it. Observation: `document.hasFocus()` is unreliable under WSLg (`main.js:419`, `window-registry.js:25` — programmatic focus fires no focus event); the **losing** view's `activeElement` goes stale (Chromium doesn't blur sibling views — existing spec step 5 note); the load-bearing proof is the **gaining** view's `activeElement` **plus `typeText` landing there** (existing spec step 4's pattern). Note: `engine.js:311`'s "F6" is *Flight* 6, not the key.

## Inputs

- Clean tree on `flight/01-keyboard-reachability` at `main` `4579ea4`; 3843 tests; Prettier gate live.
- No renderer→main "focus guest" path; `tab-handoff` ejection live; behavior spec pins the old behaviour.

## Outputs

- `src/shared/tab-boundary.js` (CJS-by-design) — pure `tabBoundary(doc, direction)` → `{ atBoundary: boolean, count: number }`; unit-tested with a fake document (the `FakeElement`/`FakeDocument` shape from `test/unit/tab-controller.test.js`).
- `src/preload/webview-preload.js` and the internal/trusted preload — capturing `keydown` listener → `guest-tab-boundary`, `preventDefault` at the boundary (DD2).
- `scripts/build-preload.mjs` bundles both preloads; new internal bundle wired in `register-tab-ipc.js`, ignored by git/Prettier; bundle structural pin (DD5).
- `src/main/automation/input.js` `KEY_MAP` gains `F6`.
- `src/renderer/styles.css`: `#media-panel.collapsed` / `#privacy-panel.collapsed` gain `visibility: hidden` (phantom focusables settled by review).
- `src/main/register-browser-ipc.js` — `guest-tab-boundary` handler (sender-derived wcId, direction validated) forwarding `tab-boundary`.
- `src/shared/cross-view-nav.js` — unmodified Tab → `null`; `test/unit/cross-view-nav.test.js:47` **renamed and inverted** (`'unmodified Tab → null (handled by the guest-tab-boundary signal, M17 F1)'`), `:51` kept.
- `src/shared/keydown-action.js` — `F6` → `'focus-content'` (unmodified, decided beside F12), `Shift+F6` → `'focus-chrome'` (chrome no-op in this leg); action union extended; classifier parity test (`shortcut-classifier-parity.test.js`) updated if the mirror requires it.
- `src/preload/chrome-preload.js` `focusActiveGuest()` → `src/main/register-tab-ipc.js` `ipcMain.handle('tab-focus-guest')` (active tab of the sender's window only); `renderer-globals.d.ts` updated.
- Chrome dispatch in `src/renderer/chrome/shortcut-controller.js`: `case 'focus-content'` → `goldfinch.focusActiveGuest()`; `case 'focus-chrome'` → no-op; a new `onTabBoundary` push subscription (cloned from `chrome-preload.js`'s generic `onXxx` bridge pattern, e.g. `:323`) beside `onChromeShortcutAction` (`:215`) → focus `#address` / the chrome's last visible tabbable. No new file; `renderer.js` needs **zero** new deps (the push subscription is made inside the controller).
- Tests: `tab-boundary.test.js` (first/last/none/hidden/disabled/`tabindex=-1`/`contenteditable` cases, both directions); `cross-view-nav.test.js` inverted; `keydown-action.test.js` F6/Shift+F6; `register-browser-ipc` test for the forwarder (sender-derived wcId, bad direction ignored); `register-tab-ipc.test.js` for `tab-focus-guest` (active tab only, refuses non-active/unknown); a source-pin that both preload branches register the listener.
- **Behavior spec** `tests/behavior/chrome-guest-keyboard-nav.md` re-authored (draft, by the FD at leg design — see Verification) and **run** after implementation; run log referenced from the flight log.
- Flight log leg entry with the **evidence table**: per fixture (form-heavy `vault-card`, link/button `tab-scheme-guard`, a new zero-focusable fixture `tests/behavior/fixtures/keyboard-nav/empty.html`, and one page with an `iframe`): F6 lands on first tabbable? forward Tab at last → chrome `#address`? Shift+Tab at first → chrome last control? mid-page Tab stays in page? — plus the DD2 ordering finding (was `preventDefault` needed?). DD1–DD4 confirmed/overturned, written into `flight.md` by the FD.
- This leg's status `landed`.

## Acceptance Criteria

- [x] AC1: `tabBoundary()` unit tests cover first/last/only/none, `disabled`, `hidden`, `tabindex="-1"`, `display:none` ancestor, `contenteditable`, `iframe` as a tabbable, both directions — all green; the module is CJS-by-design (no `export`), which the bundle tests (AC8) and its own `require()` from both preloads cover — `preload-graph-esm-free.test.js` walks the chrome-preload graph only and is not the guard here.
- [x] AC2: `cross-view-nav.test.js` `'unmodified Tab → tab-handoff'` is renamed and inverted (not deleted-and-re-added); `'Shift+Tab → null'` unchanged; suite green.
- [x] AC3: `guest-tab-boundary` main handler derives wcId from `event.sender.id` only, ignores any renderer-supplied id, rejects directions other than the two literals, and forwards only to `chromeForTab(wcId)` — unit-pinned like `guest-vault-gesture`.
- [x] AC4: `tab-focus-guest` focuses only the sender window's **active** tab's guest; a non-active or unknown tab id is refused — unit-pinned.
- [x] AC5: F6 → `'focus-content'` and Shift+F6 → `'focus-chrome'` in `keydownToAction`, decided without a modifier beside F12; classifier parity test green.
- [x] AC6: `/behavior-test chrome-guest-keyboard-nav` (re-authored) **passes** on the shipped build — keyboard-only entry via F6, mid-page forward Tab stays in the page, Tab past the last tabbable lands on `#address`, Shift+Tab before the first tabbable lands on the chrome's last control, and Ctrl+L still works from inside the page. A failing row means the leg does not land (or lands with the operator's recorded disposition).
- [x] AC7: gates — `npm test` (3843 + new), `npm run lint`, `npm run typecheck`, `npx prettier --check .` — all clean; `RENDERER_LINE_BUDGET` (1827) not exceeded (current 1826).
- [x] AC8: both guest preloads are bundled by `npm run build:preload` (`pretest`/`prestart`/`beforePack` already run it); the trusted branch loads its bundle; `pressKey(C, 'F6')` is accepted by `KEY_MAP` (`test/unit/automation-input.test.js` extended) — unit-pinned.
- [x] AC9: the flight log carries the evidence table (from the behavior-test run log) and the DD2 handoff finding; `flight.md` DD1–DD5 are confirmed or amended by the FD from it.

## Verification Steps

- AC1–AC5, AC7: the named test files; `node --test test/unit/tab-boundary.test.js` etc.; the four gates.
- AC6: `/behavior-test chrome-guest-keyboard-nav` (re-authored 2026-08-27, `draft` until it passes) — apparatus settled at design review: admin `evaluate(C, …)` reads chrome-document state (admitted by `isChromeContents`, `resolve.js:79-81`, wired into `observe.evaluate` `observe.js:478-480`); focus is proven on the **gaining** view via `activeElement` + `typeText` landing (never `document.hasFocus()` — unreliable under WSLg; never the losing view's `activeElement` — stale).
- AC8: `npm run build:preload` output lists both bundles; `node --test test/unit/automation-input.test.js`.
- AC9: read the flight log and `flight.md`.

## Implementation Guidance

1. **`tabBoundary`** first, with its tests — pure, no DOM globals (takes `doc`), selector list + filters as above; export both the predicate and the sequence for testability.
1b. **Bundling (DD5)**: extend `scripts/build-preload.mjs` to a two-entry build (read its header — it explains why sandboxed preloads need it); point `register-tab-ipc.js:94-98`'s trusted branch at the new bundle; add the bundle path to `.gitignore` and `.prettierignore`; clone `webview-preload-bundle.test.js` for it. Verify `npm run build:preload` produces both and `npm start`-shaped boot would load them (the boot itself is exercised by the behavior test).
2. **Preload listeners** (both branches): capturing `keydown` on `window`; only `key === 'Tab'` with no ctrl/meta/alt and `!event.repeat`; direction = `shiftKey ? 'backward' : 'forward'`; call `tabBoundary(document, direction)`; if `atBoundary`, `event.preventDefault()` then `ipcRenderer.send('guest-tab-boundary', { direction })` (DD2 ruling). For the web branch, capture native references early — `addEventListener`, `ipcRenderer`, **and `Event.prototype.preventDefault`** (call it via the captured reference) — the way the file already does for `setTimeout`/`isTrustedGet` (`:237-253`, `:428-440`); the page realm is hostile to the preload's helpers, and a page overriding `preventDefault` would silently defeat DD2.
3. **Main forwarder** in `register-browser-ipc.js` beside `guest-vault-gesture`, same shape; direction allowlist.
4. **`cross-view-nav.js`**: remove the unmodified-Tab branch; keep Ctrl/Cmd+L. Invert + rename the test.
5. **Classifier**: F6/Shift+F6 beside F12; union; parity test.
6. **Chrome**: `focusActiveGuest` bridge → `tab-focus-guest` handler (active-tab check against the sender window's record, like `tab-set-active` uses `wasPageFocused`'s lookup). In `src/renderer/chrome/shortcut-controller.js`: new `case 'focus-content'` in `dispatchChromeAction` (`:41+`) → `goldfinch.focusActiveGuest()`; `case 'focus-chrome'` → no-op; subscribe the new `tab-boundary` push beside `onChromeShortcutAction` (`:215`): forward → `els.address.focus()` + select; backward → last visible tabbable of the chrome document (reuse `tabBoundary`'s sequence on the chrome `document`). Add `visibility: hidden` to `#media-panel.collapsed` / `#privacy-panel.collapsed` in `styles.css` so collapsed panels leave the sequence. `renderer.js`: only new deps on the existing `createShortcutController({...})` call (`:629`) if any.
6b. **Apparatus**: add `F6` to `KEY_MAP` in `src/main/automation/input.js` (`Tab: 'Tab'` shape) with a one-line test beside the existing key-map cases.
7. **Fixtures**: add `tests/behavior/fixtures/keyboard-nav/{form.html,links.html,empty.html,iframe.html}` (tiny, static, no scripts) — the spec serves the directory on `:8000`.
8. **Gates, artifacts**: run everything; write the leg entry with the evidence table *from the behavior-test run log* (the FD runs the spec after the Developer hands off; the Developer's own evidence is the unit layer). Leg → `landed` only after AC6.

## Edge Cases

- **Page with zero tabbables**: `tabBoundary` returns `atBoundary:true` for both directions when `count === 0` → Tab from `body` hands off immediately (that is the correct behaviour — nothing to traverse).
- **Focus on `body` with tabbables present**: not at a boundary → Chromium's default Tab enters the first tabbable. Shift+Tab from `body` → Chromium goes to the last; also not a boundary.
- **Editors that `preventDefault` Tab**: the listener is in capture phase on `window` and runs first; at a non-boundary it does nothing, so the editor keeps Tab. At a boundary we hand off even if the editor wanted the key — document as accepted.
- **`iframe` focus**: `before-input-event` fires at the WebContents level; `document.activeElement` in the top frame is the `<iframe>` element — treat an `iframe` as one tabbable (the sequence inside it is opaque to us). The iframe fixture documents the behaviour, whichever way it goes.
- **Popups** (M14): inherit the preload listener; `chromeForTab(popupWcId)` does **not** resolve (settled by review — `window-registry.js:181-187`), so the forward is a silent no-op for popups; accepted for this leg and recorded in the flight log. The `preventDefault` at the boundary still fires in a popup — so Tab at a popup's last element does nothing. Acceptable for a spike; Leg 2 decides whether popups should wrap within themselves instead.
- **Auto-repeat**: ignore `event.repeat` presses in the preload (the main handler already ignores repeats for the old handoff — mirror it).
- **`tab-handoff` retirement**: the string may survive in the main handler's switch for one release as a no-op or be removed; remove it and let `cross-view-nav.test.js` document the change.

## Files Affected

- `src/shared/tab-boundary.js` (new), `src/shared/cross-view-nav.js`, `src/shared/keydown-action.js`
- `src/preload/webview-preload.js`, `src/preload/internal-preload.js` (the trusted branch's preload — confirmed by review, `register-tab-ipc.js:94-98`), `src/preload/chrome-preload.js`, `src/renderer/renderer-globals.d.ts`
- `scripts/build-preload.mjs`, `.gitignore`, `.prettierignore`, `src/main/automation/input.js`, `src/renderer/chrome/shortcut-controller.js`, `src/renderer/styles.css`
- `src/main/register-browser-ipc.js`, `src/main/register-tab-ipc.js`, `src/main/guest-wiring.js` (drop the `tab-handoff` case)
- `src/renderer/renderer.js` (new deps on the `createShortcutController` call only, if any)
- Tests as listed; `tests/behavior/chrome-guest-keyboard-nav.md`; `tests/behavior/fixtures/keyboard-nav/*`
- Flight log; `flight.md` DD1–DD4; this artifact

## Run Record

- Run 1 `2026-08-27-23-14-02` on the first build: 8/12 — rows 3/7 (spec premise: F6 lands on the document, not the first tabbable), row 8 (product defect: chrome backward handler walked onto a `visibility:hidden` panel button), row 11 (apparatus confound: Settings' live audit log). Fixes: `getComputedStyle().visibility` in the chrome walk and in `tabBoundary()`; DD1 re-ruled Chrome-like (operator, 2026-08-28); spec re-authored; row 11 moved to the jars page.
- Run 2 `2026-08-28-01-01-15` on the fixed build: **12/12** (row 12 documents the trailing-iframe wrap — Leg 2's Known Issue). AC6 met.

## Citation Audit

2026-08-27 (scout brief, verified against `main` `4579ea4`): every `file:line` above was read by the scout; `cross-view-nav.js:37/:39`, `guest-wiring.js:100-116/:244-247/:299/:358-361`, `register-tab-ipc.js:95-98/:107/:915/:949`, `find-overlay-manager.js:291`, `register-overlay-ipc.js:698`, `keydown-action.js:51-59/:61-67`, `navigation-controller.js:361-371`, `webview-preload.js:199-201/:233-243/:265-266/:411-427`, `styles.css:1080-1083/:1516-1519`, `chrome-guest-keyboard-nav.md:45/:48-49`. Design review (2026-08-27, two cycles, approve-with-changes both — all findings incorporated): confirmed `internal-preload.js` is the trusted branch's preload and is sandboxed with no bundling (→ DD5); `KEY_MAP` lacks `F6` (→ 6b); `shortcut-controller.js:41/:215/:629` own dispatch; `chromeForTab` does not resolve popups (`window-registry.js:181-187`); collapsed panels are phantom-focusable (`styles.css:1080-1083/:1516-1519`); `engine.js:311` "F6" is Flight 6.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight:
  - [ ] Update flight.md status to `landed`
  - [ ] Check off flight in mission.md
- [ ] Commit all changes together (code + artifacts)
