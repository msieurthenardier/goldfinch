# Leg: chrome-to-guest-handoff

**Status**: completed
**Flight**: [Keyboard Reachability and Omnibox Semantics](../flight.md)

## Objective

Harden the focus handoff Leg 1 shipped into the full Chrome-like cycle: F6 / Shift+F6 work **from the guest** as well as from the chrome, Enter in the address bar hands focus to the page once the navigation commits, the trailing-iframe wrap gets an explicit ruling, and the tabbable-filter duplication is retired by making `tab-boundary.js` an ES module shared by the chrome and both bundled preloads.

## Context

- Leg 1 landed (run `2026-08-28-01-01-15`, 12/12): F6 from the chrome → guest document (DD1, Chrome-like); forward/backward boundary handoffs via `guest-tab-boundary` (DD2–DD4); both preloads bundled (DD5). What a keyboard user still cannot do: leave the page with F6 (only Ctrl+L or Tab-walking to a boundary), get into the page after typing a URL without an extra F6, or escape a page whose last tabbable is an iframe by forward Tab (Mission 17 Known Issue).
- Code facts (verified 2026-08-28): `src/shared/cross-view-nav.js:46-50` — `crossViewNavAction` returns `'focus-address'` for Ctrl/Cmd+L only; `src/main/guest-wiring.js:100-116` `handleCrossView` — `preventDefault()`, non-repeat → `chrome.focus()` + `chrome.send('chrome-shortcut-action', { action: 'focus-address' })` — **the literal string, not the computed `action`** (`:112-114`; design review 2026-08-28) — attached to both guest branches and to popups (`chrome?.` is null-safe for popups, `:189-191`). `src/renderer/chrome/navigation-controller.js:361-371` — Enter → `navigate(...)` then `els.address.blur()`. Main pushes `tab-did-navigate {wcId, url}` to the chrome on commit (`guest-wiring.js:449-451`). Guest `webPreferences` (`register-tab-ipc.js:79-110`): internal = `contextIsolation:true, sandbox:true, nodeIntegration:false`; web = `contextIsolation:false` (the farbling preload runs in the page main world). `shortcut-controller.js:223` `case 'focus-content'`; the `onTabBoundary` handler owns forward → `#address` + `select()`, backward → `lastVisibleChromeTabbable()` (a local duplicate of `tab-boundary.js`'s filter). `src/shared/tab-boundary.js` is CJS (`module.exports = { tabBoundary, tabSequence, isFocusable, FOCUSABLE_SELECTOR }`).
- Apparatus facts from the two runs apply (run log Orchestrator Notes): collector via `window.goldfinch.onTabBoundary`; blur `document.activeElement` for baselines; `readAxTree` omits iframe inner documents; the losing view's `activeElement` is stale.

Design decisions this leg settles (recorded in `flight.md` after the design review):

- **DD6 — F6 / Shift+F6 from the guest.** In `crossViewNavAction`, unmodified **F6** → `'focus-address'` (Chrome's F6 from the page goes to the omnibox) and **Shift+F6** → new `'focus-chrome-end'`. `handleCrossView` must **forward the computed `action`** (`chrome?.send('chrome-shortcut-action', { action })`) — today it hardcodes `'focus-address'`, so without this one-word fix Shift+F6 would silently focus the address bar; pinned by a guest-wiring test asserting the send payload for Shift+F6 is `'focus-chrome-end'`. `shortcut-controller.js`'s generic `onChromeShortcutAction` → `dispatchChromeAction` (`:267`) gains `case 'focus-chrome-end'` → the chrome's last visible tabbable (the backward-boundary placement, via `tabSequence(document)` after DD9). **Parity ruling**: the chrome-side classifier's F6 (`keydown-action.js:77`, decided before the modifier gate) is gated on ctrl/meta/alt too, so Ctrl+F6 is a no-op on both sides. F6 from a guest today falls through untouched (`'focus-content'` is not in `guest-forward-allowlist.js`'s chrome-action allowlists), so the earlier `handleCrossView` check intercepts cleanly. Popups: null-safe no-op (accepted). Tests: `cross-view-nav.test.js` (F6, Shift+F6, modified F6 → null), `guest-wiring.test.js` (send payload per action; repeat suppression), `keydown-action.test.js` (Ctrl+F6 → null), `shortcut-controller.test.js` (`'focus-chrome-end'` with a `visibility:hidden` control present).
- **DD7 — Enter in the address bar focuses the page on commit.** Chrome moves focus to the content when the navigation the user just requested commits. Implement in `navigation-controller.js`: on Enter-navigate (both branches at `:361-371`) arm a one-shot **keyed by the logical tab id, not the wcId** — `pendingFocusGuest = { tabId: activeTab.id }` after `blur()` — because on a welcome tab `navigate()` goes through `attachView(tab, url)` (`:108-143`) and the guest's wcId does not exist until `tabCreate()` resolves (`tab-controller.js:477-496`); matching by tab id covers that most common flow (new tab → type URL → Enter) without hooking `attachView`. On the `tab-did-navigate {wcId}` push — **the navigation controller subscribes to `goldfinch.onTabDidNavigate` itself** (the bridge's `onXxx` listeners are additive; `renderer.js:1507`'s existing subscriber stays for its own purpose; `shortcut-controller.js:267` is the precedent for a controller owning its subscription), so no subscriber line lands in `renderer.js` — resolve the wcId to its tab record via a **new `findTabByWcId` dep** threaded into `createNavigationController` (the `createPrivacyController` call at `renderer.js:580` is the precedent; the controller has no such dep today, `:5-33`); if `record.id === pending.tabId`, the tab is still active, and `document.activeElement !== els.address`, call `goldfinch.focusActiveGuest()` once and clear. Clear on tab switch through the existing `resetSuggestionsForActivation` plumbing (`tab-controller.js:877` inside `activateTab` `:865` → `renderer.js:230-231`). **Budget**: `renderer.js` is already **1827** by the pin's metric (`split(/\r?\n/).length`; `wc -l` under-counts the trailing newline), so the one dep line Prettier will not let fold takes it to **1828** → `RENDERER_LINE_BUDGET` is re-based to 1828 in the same change with the rationale in the pin's comment ("+1 for the DD7 `findTabByWcId` dep, 2026-08-28"); no compaction (CLAUDE.md's rule after Flight 5). Same-document/hash navigations (`tab-did-navigate-in-page`, a different channel) and search-query Enters (`handoffSearch`, no `tabNavigate`) never commit through `did-navigate` → the record expires on the next Enter or tab switch; both named in Edge Cases and unit-tested. Tests: Enter arms by tab id; a matching `tab-did-navigate` (wcId → same tab) triggers exactly one `focusActiveGuest`; a different tab's wcId, a re-focused address bar, a tab switch, an in-page navigation, or a search Enter does not; the welcome-tab path (wcId assigned after arming) still matches.
- **DD8 — trailing iframe: ruling deferred to the design review, with a default.** The keydown inside an iframe is invisible to the top-frame listener, so the wrap `#top → #inner → #top` cannot be caught there. Options: **(A)** run the boundary listener in subframes too — Electron's `nodeIntegrationInSubFrames: true` makes the preload load in every frame; for the *web* branch that puts the page-world farbling preload into cross-origin iframes (security- and behaviour-relevant: farbling in subframes may be desirable for fingerprint consistency but is a Flight 2 / #147 question, and the preload's captured natives are per-realm); for the *internal* branch there are no iframes. **(B)** a top-frame heuristic (focusin on `tabSequence(doc)[0]` right after the `<iframe>` held focus) — rejected: indistinguishable from a mouse click on the first control while focus was in the frame (false handoff). **(C)** accept the one-directional wrap now that **DD6 gives every page a standard exit** (F6 / Shift+F6 → chrome; WCAG 2.1.2 is satisfied when a documented standard key moves focus away) and document it as the iframe residual for the #147/Flight 2 subframe-preload discussion. **Ruled (C)** at the design review (2026-08-28): Electron's `nodeIntegrationInSubFrames` loads the *same* preload in every iframe (`electron.d.ts:19341-19347`) — a WebContents has exactly one preload path, so (A) necessarily means the full page-world farbling preload runs in every cross-origin subframe, a cross-cutting security/farbling call for Flight 2 / #147 to own with full context. No existing use or discussion of `nodeIntegrationInSubFrames` in the repo. The fixture row stays a documentation row; the Mission 17 Known Issue is reworded to name F6 / Shift+F6 as the standard exit and (A) as the deferred fix.
- **DD9 — `tab-boundary.js` becomes an ES module** (`export { tabBoundary, tabSequence, isFocusable, FOCUSABLE_SELECTOR }`), imported by `shortcut-controller.js` (chrome is ESM) and `require`d by both preload sources — esbuild bundles the ESM into each CJS bundle (verify the interop shape; `require('./x.js').tabBoundary` on an ESM default/named export works under esbuild's CJS output — confirm with the bundle test). `lastVisibleChromeTabbable()` in `shortcut-controller.js` is deleted in favour of `tabSequence(document)` (visibility via `getComputedStyle` now lives in the shared helper). Interop confirmed empirically at design review: esbuild bundling a CJS `require()` of an ESM source yields named exports as plain properties (`require('./x').tabBoundary` works; no `.default`; no `build-preload.mjs` change), and Node 22's `require(esm)` already serves `cross-view-nav.js` (real ESM, no `"type":"module"`, no `.mjs`) to `main.js:135` and its test — copy that exact pattern. `preload-graph-esm-free.test.js` walks the chrome-preload graph only and is unaffected (its Electron-42 caveat concerns unbundled preload `require(esm)`, moot under DD5). The CJS-by-design file lists live in `eslint.config.mjs` (`:29-39`, `:87-108`), not CLAUDE.md — move `tab-boundary.js` out of them.
- **DD10 — spec rows.** `chrome-guest-keyboard-nav.md` gains: F6 from the guest → `#address` (selection, yellow ring — the Ctrl+L path's fingerprint); Shift+F6 from the guest → chrome's last visible tabbable; Enter in the address bar with a fixture URL → after commit the guest's `RootWebArea` is focused and one Tab lands on its first tabbable; the iframe row's Expected Results updated to the DD8 outcome. Baselines blur `document.activeElement`.

## Inputs

- Tree on `flight/01-keyboard-reachability` with Leg 1 landed (uncommitted; 3905 tests; gates green).
- Spec at run `2026-08-28-01-01-15` state (`active`), fixtures on disk, `gf.mjs` wrapper and the crew apparatus facts.

## Outputs

- `src/shared/cross-view-nav.js` (+F6 / Shift+F6), `src/main/guest-wiring.js` (`'focus-chrome-end'` in `handleCrossView`), `src/renderer/chrome/shortcut-controller.js` (`'focus-chrome-end'`; delete `lastVisibleChromeTabbable`; import `tab-boundary.js`), `src/renderer/chrome/navigation-controller.js` (DD7 one-shot), `src/shared/tab-boundary.js` (ESM), both preload sources' `require` lines unchanged or adjusted for the ESM interop, `scripts/build-preload.mjs` only if the interop needs a flag; CLAUDE.md CJS-by-design list; tests for each; spec rows per DD10; fixtures unchanged (unless DD8 (A) lands).
- DD8 ruling recorded in `flight.md` (and the Mission 17 Known Issue updated: resolved or explicitly residual with the F6 exit).
- Flight log leg entry; behavior-test run log for the re-run; this leg `landed`.

## Acceptance Criteria

- [x] AC1: `crossViewNavAction` returns `'focus-address'` for unmodified F6 and `'focus-chrome-end'` for Shift+F6; F6 with ctrl/meta/alt → `null`; Ctrl/Cmd+L unchanged — unit-pinned; `handleCrossView` **forwards the computed action** (send payload `'focus-chrome-end'` for Shift+F6, `'focus-address'` for F6 and Ctrl+L) with `preventDefault` and repeat suppression — unit-pinned; the chrome-side `keydownToAction` returns `null` for F6 with ctrl/meta/alt (parity) — unit-pinned.
- [x] AC2: `'focus-chrome-end'` focuses the chrome's last visible tabbable (the same element the backward boundary chooses) — unit-pinned with a `visibility:hidden` control present.
- [x] AC3: Enter in the address bar arms a one-shot keyed by tab id; a `tab-did-navigate` whose wcId resolves to that tab (through the new `findTabByWcId` dep), while it is active and the address bar is unfocused, triggers exactly one `focusActiveGuest()` — including on a welcome tab whose wcId is assigned after arming; a different tab, a re-focused address bar, a tab switch, an in-page navigation, or a search-query Enter does not — unit-pinned. The controller owns its `onTabDidNavigate` subscription; `renderer.js` gains exactly one line (the dep) and `RENDERER_LINE_BUDGET` is re-based 1827 → 1828 with the rationale recorded in the pin.
- [x] AC4: `tab-boundary.js` is ESM; `shortcut-controller.js` imports it and `lastVisibleChromeTabbable` is gone; both preload bundles still contain a working `tabBoundary` (bundle tests + `tab-boundary.test.js` green); `preload-graph-esm-free.test.js` green.
- [x] AC5: DD8 (C) recorded in `flight.md`; the Mission 17 Known Issue names F6 / Shift+F6 as the standard exit and `nodeIntegrationInSubFrames` (full-preload-in-subframes) as the deferred fix owned by Flight 2 / #147; the iframe fixture row keeps documenting.
- [x] AC6: `/behavior-test chrome-guest-keyboard-nav` with the DD10 rows passes on the shipped build.
- [x] AC7: gates — `npm test`, `npm run lint`, `npm run typecheck`, `npx prettier --check .`, `npm run build:preload`; `renderer.js` = 1828 by the pin's metric, no higher; the budget pin's comment records the re-base.

## Verification Steps

- AC1–AC4: the named test files; neuter checks on the new pins (delete/invert the guarded line → red).
- AC5: read `flight.md` DD8 and the mission's Known Issues entry.
- AC6: the run log.
- AC7: the gates.

## Implementation Guidance

1. **DD9 first** (it touches the most files and everything else builds on it): convert `tab-boundary.js` to ESM; fix the chrome import and the preload requires; rebuild bundles; run the bundle tests and `tab-boundary.test.js` (`node --test` `require(esm)` works on Node 22); delete `lastVisibleChromeTabbable` and use `tabSequence(document)` in the backward path; keep the shortcut-controller test that pins the `visibility:hidden` exclusion (it now exercises the shared helper).
2. **DD6**: `cross-view-nav.js` + tests; `guest-wiring.js:112-114` — replace the hardcoded `'focus-address'` with the computed `action` (one word) and pin the send payload per action; `keydown-action.js:77` — gate F6 on `!ctrl && !meta && !alt` (parity) + test; `shortcut-controller.js` `dispatchChromeAction` gains `case 'focus-chrome-end'`; tests.
3. **DD7**: `navigation-controller.js` one-shot by tab id (`activeTab.id`); the controller subscribes to `goldfinch.onTabDidNavigate` itself (guard for a missing bridge in the harness) and resolves the wcId via a new `findTabByWcId` dep (thread it in `renderer.js`'s `createNavigationController({...})` call — the `createPrivacyController` precedent at `:580`); measure `renderer.js` with the pin's metric before and after (1827 → 1828) and re-base `RENDERER_LINE_BUDGET` to 1828 in `seam-contract.test.js` with the comment; tab-switch clear inside `resetSuggestionsForActivation`; tests in the navigation-controller harness incl. the welcome-tab (late wcId) case, in-page navigation, and search Enter.
4. **DD8 (C)**: `flight.md` DD8 paragraph + Mission 17 Known Issue reworded (F6/Shift+F6 as the standard exit; subframe preload deferred to Flight 2 / #147). No code.
5. **DD10**: add the spec rows; the FD runs `/behavior-test`.
6. Gates; flight-log entry; leg → `landed` (AC6 pending the run).

## Edge Cases

- **F6 in a guest that has a page-level F6 handler** (rare): main's `before-input-event` fires first and `preventDefault`s — the page never sees it; acceptable (same as Ctrl+L).
- **Shift+F6 from the chrome**: remains a no-op in this leg (the chrome is the "previous pane" of itself); F6 from the chrome → content stands.
- **Enter on the same URL / hash-only change**: in-page navigations fire `tab-did-navigate-in-page`, a different channel — the one-shot expires on the next Enter/tab switch; unit-tested.
- **Search-query Enter** (`handoffSearch` path): no `tabNavigate`, no `did-navigate` → the one-shot expires; unit-tested.
- **Welcome tab first navigation**: `navigate()` → `attachView()`; the wcId arrives later — matching by tab id (DD7) handles it; unit-tested.
- **Ctrl+F6 / Meta+F6 / Alt+F6**: `null` on both sides after the parity ruling.
- **Enter while a download or blocked navigation follows**: no commit → no focus change; the address bar was blurred, focus is on the chrome body — same as today.
- **Popups**: no chrome → the sends are no-ops; the boundary `preventDefault` in a popup still eats Tab at the ends (Leg 1 residual) — with DD6 a popup's F6 also does nothing; record as a popup residual in the flight log (Flight 2 / M14 follow-up), do not fix here.

## Files Affected

- `src/shared/tab-boundary.js`, `src/shared/cross-view-nav.js`, `src/main/guest-wiring.js`, `src/renderer/chrome/shortcut-controller.js`, `src/renderer/chrome/navigation-controller.js`, `src/preload/webview-preload.js`, `src/preload/internal-preload.js` (require lines only, if needed), `scripts/build-preload.mjs` (only if needed), CLAUDE.md (CJS-by-design list)
- Tests: `cross-view-nav.test.js`, `guest-wiring.test.js`, `shortcut-controller.test.js`, `navigation-controller.test.js`, `tab-boundary.test.js`, the two bundle tests
- `tests/behavior/chrome-guest-keyboard-nav.md`; flight log; `flight.md` (DD6–DD10); `missions/17-maintenance/mission.md` (Known Issue wording)

## Citation Audit

2026-08-28 (FD): `cross-view-nav.js:46-50`, `guest-wiring.js:100-116/:449-451`, `navigation-controller.js:361-371`, `register-tab-ipc.js:79-110`, `shortcut-controller.js:223`, `tab-boundary.js:121` read directly. Design review (2026-08-28, one cycle, approve-with-changes — incorporated): `guest-wiring.js:112-114` hardcodes `'focus-address'`; `navigation-controller.js:108-143` welcome path via `attachView` (`tab-controller.js:477-496`, async wcId); `renderer.js:1507` `onTabDidNavigate` subscriber; `tab-controller.js:877` → `renderer.js:230-231` activation plumbing; `shortcut-controller.js:267` `onChromeShortcutAction`; `keydown-action.js:77` F6 before the modifier gate; `guest-forward-allowlist.js` excludes `'focus-content'`; `electron.d.ts:19341-19347` subframe preload semantics; `main.js:135` `require(esm)` pattern; esbuild interop verified empirically.

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

## Run Record

- Implemented 2026-08-28 (Developer spawn): DD9 first (`tab-boundary.js` → ESM named exports; `shortcut-controller.js` imports `tabSequence`, its local helper deleted; `eslint.config.mjs` CJS-by-design lists trimmed), then DD6 (`cross-view-nav.js` F6 → `'focus-address'`, Shift+F6 → `'focus-chrome-end'`, modified F6 → `null`; `guest-wiring.js` forwards the computed action; `keydown-action.js` F6 gated on `!ctrl && !meta && !alt`; `dispatchChromeAction` `'focus-chrome-end'`), then DD7 (`navigation-controller.js` one-shot keyed by `activeTab.id`, the controller's own `onTabDidNavigate` subscription, `findTabByWcId` dep threaded in `renderer.js`, cleared in `resetSuggestionsForActivation`). `renderer.js` 1827 → 1828 by the pin's metric; `RENDERER_LINE_BUDGET` re-based to 1828 with the rationale in the pin.
- Tests 3905 → 3920; every new structural pin neuter-verified (red on delete/invert, green on restore). Gates: `npm test`, `npm run lint`, `npm run typecheck`, `npx prettier --check .`, `npm run build:preload` all green.
- AC6: `/behavior-test chrome-guest-keyboard-nav` run `2026-08-28-01-56-28` — **15/15 pass** (rows 1–12 regression net over the DD6/DD9-touched paths, rows 13–15 new). Run log: `tests/behavior/chrome-guest-keyboard-nav/runs/2026-08-28-01-56-28.md`. Spec → `active`, with the row 13 collector read and row 15 `readAxTree(C)` folded into the Actions.
- AC5: DD8 (C) in `flight.md`; Mission 17 Known Issue names F6 / Shift+F6 as the standard exit and the subframe preload as the Flight 2 / #147 fix. Row 12 reproduced the residual verbatim (no subframe listener on this build).
