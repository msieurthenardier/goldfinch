# Leg: automation-page

**Status**: completed
**Flight**: [Automation Page](../flight.md)

## Objective
Move the Automation section of `goldfinch://settings` onto a new trusted internal page `goldfinch://automation`, opened from a new kebab **Automation** item directly above **Vault**, with the two agreed plain-text hints, full internal-host onboarding plus drift guards, and docs/behavior specs retargeted — landing `renderer.js` below its current budget.

## Context
- Flight design decisions DD1–DD8 in [flight.md](../flight.md) are binding; this leg implements all of them. Read them in full before starting — they carry line-level detail from two Architect reviews.
- Charter constraints: no change to automation behavior, key handling, IPC channels/semantics, or the internal trust model. Hints are plain text (no new internal→chrome channel).
- `renderer.js` is at its zero-headroom budget: 1546 by the pinned measure `split(/\r?\n/).length` (1545 by `wc -l`). "A file at budget needs an extraction, not a compaction."
- Live verification uses Goldfinch **dev mode** (operator standing preference): `npm run dev:automation` with `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1`, capture the printed `AUTOMATION_DEV_MINT {"key":…,"adminKey":…}` line, attach with `connectAutomation()` env-key scripts (`scripts/lib/mcp-client.mjs`; recipes in `docs/dev-testing.md`). **Never** the registered `goldfinch-dev` MCP server.
- No prior legs. The working tree is clean apart from this sortie's artifacts.

## Inputs
- `src/renderer/pages/settings.{html,js,css}` — Automation section: `settings.html` `<section id="automation">` (~222–293) + nav `<li>` (~30); `settings.js` "automation controller" IIFE (~732–983), `automationKeysOnce` (~985–994), "automation key management controller" IIFE (~996–1327), "automation activity viewer" IIFE (~1329–1616), file-scope `copyText` (~47), imports of `audit-paging.js`/`safe-color.js` (~9/~11), scroll-spy IIFE (~61–124); automation-only CSS in `settings.css` (~560 `#automation-port` onward: `.connect-hint`, `.mcp-config-block`, robot glyph ~655, `#automation-key-reveal`, `#automation-admin`, `.activity-*`)
- `src/renderer/renderer.js` — `kebabAction*` bodies + `KEBAB_ACTIONS` (~366–405, the comment block above them included), `let pageActions` (~108), `pageActions = createChromePageActions(` (~544), `createOverlayDispatch({ KEBAB_ACTIONS,` (~956), seam tail `kebabActionSettings` (~1502)
- `src/renderer/chrome/overlay-menus.js` — `buildKebabModel` (~5), `createChromePageActions` (~119)
- `src/renderer/chrome/tab-controller.js` — `INTERNAL_JAR_NAMES` (~96)
- `src/shared/url-safety.js` — `INTERNAL_HOSTS` (~84); `src/main/internal-ipc.js` and `src/preload/internal-preload.js` — `INTERNAL_ORIGINS` (~26); `src/main/internal-page-map.js`
- `eslint.config.mjs` — explicit page-module list (~225–240)
- `src/main/automation/mcp-server.js` — `eaddrinuseMessage` (~1083–1088)

## Outputs
- New: `src/renderer/pages/automation.html`, `automation.js`, `automation.css`, `section-scroll-spy.js`; new unit tests (see ACs)
- Modified: files listed under Files Affected
- `renderer.js` lands at ~1517 lines; `test/helpers/renderer-line-budget.js` retargeted to the measured value in the same change

## Acceptance Criteria

**Kebab + renderer extraction (DD2)**
- [x] AC1: `buildKebabModel()` returns, in order: `new-window` | separator | `settings`, `downloads`, `jars`, `automation` (label `Automation`), `vault` | separator | `print`, `exit`. Its header comment describes the real bands.
- [x] AC2: `createChromePageActions` returns `openAutomationPage()` (calls `createTab('goldfinch://automation', null, { trusted: true })`) and a `kebabActions` map keyed by every non-separator model id; the six moved action bodies keep their behavior (Print keeps `t && !isInternalTab(t) && t.wcId != null`; new-window → `window.goldfinch.windowCreate()`; exit → `window.goldfinch.appQuit()`).
- [x] AC3: `renderer.js` no longer defines `KEBAB_ACTIONS` or the six other `kebabAction*` bodies; it keeps a hoisted `function kebabActionSettings() { return pageActions.kebabActions.settings(); }` and passes `KEBAB_ACTIONS: pageActions.kebabActions` to `createOverlayDispatch`. The `Object.assign(globalThis, …)` name list is byte-unchanged and `seam-contract.test.js` passes unmodified (SEAM_COUNT 41).
- [x] AC4: `renderer.js` line count (pinned measure) is < 1546 and `RENDERER_LINE_BUDGET` equals the landed count.
- [x] AC5: Unit tests in `test/unit/overlay-menus.test.js`: (a) model id order incl. Automation-before-Vault and separator layout (update the existing pin ~296–310 and its stale "after Passwords" comment); (b) model↔`kebabActions` drift guard (every non-separator id has an action and vice versa); (c) one test per action — `automation`/`settings`/`downloads`/`jars`/`vault` call `createTab` with the right trusted URL, `print` prints the active web tab and no-ops on an internal tab, `new-window`/`exit` call the `window.goldfinch` fakes.
- [x] AC5b (scenario hop — the dispatch link, since the kebab sheet is unobservable): a unit test in `overlay-dispatch.test.js` builds the REAL `createChromePageActions(...).kebabActions` (fake `createTab`), injects it as the `KEBAB_ACTIONS` dep, fires `dispatchActivation({ menuType: 'kebab', id: 'automation' })`, and asserts `createTab('goldfinch://automation', null, { trusted: true })`. The HAT kebab click remains the only end-to-end proof.
- [x] AC6: A source-scan test asserts in `renderer.js` that the `pageActions = createChromePageActions(` assignment (`/pageActions\s*=\s*createChromePageActions\(/`) precedes the `createOverlayDispatch(` call (`/createOverlayDispatch\(/` — the import has no paren). Failure mode guarded: `undefined.kebabActions` at load (`pageActions` is `let`-declared at ~108, so not a TDZ throw). Neuter: swap the two statements' order in the scanned text → red; recorded in the flight log.

**Host onboarding + drift guard (DD1)**
- [x] AC7: `automation` is in `INTERNAL_HOSTS`; `'goldfinch://automation'` is in `INTERNAL_ORIGINS` in both `internal-ipc.js` and `internal-preload.js`; `INTERNAL_JAR_NAMES` has `automation: 'Automation'`; the stale comment-only host lists (`internal-ipc.js` ~20, `internal-preload.js` ~20, `url-safety.js` ~79, `renderer-globals.d.ts` ~640) name all five.
- [x] AC8: `internal-page-map.js` has an `automation` entry serving exactly `/`, `/automation.css`, `/automation.js`, `/settings.css`, `/section-scroll-spy.js`, `/audit-paging.js`, `/safe-color.js` (plus anything the route-closure test proves the import graph needs); the `settings` entry drops `/audit-paging.js` and `/safe-color.js` and gains `/section-scroll-spy.js`. `internal-page-route-closure.test.js` passes.
- [x] AC9: A new drift-guard test (source-scan, throws on a failed parse — never vacuous; set comparison, order-insensitive) asserts `INTERNAL_HOSTS` === internal-page-map keys === hosts of main `INTERNAL_ORIGINS` === hosts of preload `INTERNAL_ORIGINS` === `INTERNAL_JAR_NAMES` keys. Neuter-verified (remove `automation` from one list → red; recorded in the flight log).
- [x] AC10: Per-host cases added: `isInternalPageUrl('goldfinch://automation') === true` (`url-safety.test.js`); `isTrustedInternalSender('goldfinch://automation', true) === true` (`internal-ipc.test.js`); `tab-controller.test.js` asserts the exact container name `'Automation'` for a `goldfinch://automation` tab, with its `isInternalPageUrl` fake (~123) extended to `automation`. (This unit pin is the ONLY proof of the name — internal tabs render no dot, `tab-controller.js` ~158–162; the name feeds `tab.container.name`, e.g. the automation-indicator fallback.)
- [x] AC10b (two-point boundary unchanged): `isSafeTabUrl('goldfinch://automation') === false` (`url-safety.test.js`, alongside the existing per-host refusals) — an untrusted `createTab`/`will-navigate` still refuses the new host.
- [x] AC11: `internal-page-map.test.js`: `Object.keys(map)` pin includes `automation`; settings key-list pin updated; an automation key-list pin added; the settings `/audit-paging.js` resolve case moves to the automation host.
- [x] AC12: `eslint.config.mjs`'s explicit module list includes `src/renderer/pages/automation.js` and `src/renderer/pages/section-scroll-spy.js`.

**Page (DD3, DD5, DD6)**
- [x] AC13: Section contents: `#connection` holds everything the old section had before its Keys `<h3>` (enable toggle fieldset, enabled-note, status line, address row, port row, message, MCP config hint/block/copy, loopback hint); `#keys` holds the old Keys + Admin key content; `#activity` the old Activity content. `automation.html` has `<title>Automation — Goldfinch</title>`, `<nav class="section-nav" aria-label="Automation sections">` with anchors Connection/Keys/Activity → `#connection`/`#keys`/`#activity`, `<main>` with `<h1>Automation</h1>` and three `<section>`s with those ids and `<h2>` headings; heading levels stay sequential (Admin key and Recent actions become `<h3>`). Every `automation-*` element id from the old section is present, unchanged.
- [x] AC14: Under the Keys `<h2>`, after the existing "Generate a per-jar key…" line, two `<p class="muted">` lines with exactly: "Each key is scoped to one cookie jar. To create a new jar, open Cookie jars from the … menu." and "An agent unlocks a jar's vault with a separate vault access key. Mint one in Vault (… menu) under that jar's Access keys." (The `…` is U+2026; apostrophes as in the rest of the page.)
- [x] AC15: `automation.js` contains the three automation controllers, `automationKeysOnce`, and `copyText` moved verbatim (only origin/"settings" wording in comments updated; TDZ checklist applied), imports `audit-paging.js`, `safe-color.js`, `section-scroll-spy.js` via flat `// @ts-ignore` specifiers, and calls `initSectionScrollSpy`. `automation.html` loads `settings.css` then `automation.css`, and its scripts as `type="module"` (no classic scripts).
- [x] AC16: `section-scroll-spy.js` exports `initSectionScrollSpy` taking injected deps (document, `IntersectionObserver` ctor), selects `nav.section-nav a[href^="#"]`, and preserves the old behavior (first visible section in document order gets `aria-current="true"`, others cleared, `rootMargin: '0px 0px -50% 0px'`). Unit-tested against a mock DOM/observer.
- [x] AC17: `settings.css` nav selectors use `nav.section-nav` (no `Settings sections` attribute selector remains); automation-only rules live in `automation.css`, and every rule moved has no remaining consumer in `settings.html`/`settings.js` (Developer greps each selector). A unit source-scan pins: both pages' `<nav>` carry `class="section-nav"` and `settings.css` has no `aria-label='Settings sections'` selector.
- [x] AC18: An `automation-page-shared-scripts.test.js` sibling of `settings-page-shared-scripts.test.js` asserts every `automation.html` script src resolves on disk and is routed on the `automation` host, all are `type="module"`.

**Settings removal (DD4)**
- [x] AC19: `settings.html` has no `<section id="automation">`, no Automation nav `<li>`, no `audit-paging.js`/`safe-color.js` script tags; its nav has `class="section-nav"` and unchanged `aria-label="Settings sections"`. `settings.js` has no automation code, no `copyText`, no `audit-paging`/`safe-color` imports, and calls `initSectionScrollSpy` in place of the old IIFE. `grep -n "automation" src/renderer/pages/settings.{html,js,css}` hits are each judged and recorded (expected: none, or only non-UI references justified in the flight log).

**Strings, docs, specs (DD7)**
- [x] AC20: `mcp-server.js` `eaddrinuseMessage` points at the Automation page (e.g. "change the automation port on the Automation page (⋯ menu → Automation)"), both branches.
- [x] AC21: Docs retargeted: `docs/mcp-automation.md`, `docs/dev-testing.md`, `README.md`, CLAUDE.md (internal origins list → five hosts; the `RENDERER_LINE_BUDGET` figure "1546" → the landed value; "Adding an internal page" list mentions `INTERNAL_JAR_NAMES` and the new drift guard; any human-directed Settings→Automation wording), `scripts/a11y-audit.mjs` example comments gain `goldfinch://automation`. `docs/behavior-specs-single-window-audit.md` and historic run logs untouched.
- [x] AC22: Behavior specs re-authored (slugs kept, run logs untouched): `settings-automation.md`, `settings-activity-viewer.md`, `automation-key-gating.md` (titles, intent, preconditions and every step row open/target `goldfinch://automation` via chrome-seam `createTab('goldfinch://automation', null, { trusted: true })`); Settings references in `vault-mcp-surface.md`; `settings-shell.md` (~row 85: 3 links, 3 sections — no Automation); kebab item lists in `kebab-menu.md`, `menu-overlay.md`, `multi-window-shell.md` (~row 4) → `New window | Settings, Downloads, Cookie jars, Automation, Vault | Print…, Exit` (eight menuitems, arrow-nav arithmetic adjusted); `chrome-guest-keyboard-nav.md` (~row 11 "not Settings (its Automation section renders a live audit log…)") reworded to name the Automation page with the same rationale. Also check `internal-tab-menus.md`, `menu-dismissal.md`, `settings-controls.md`, `tab-scheme-guard.md`, `compromise-mode-rotation.md` for hard-coded kebab counts / index / "last item" wording or Settings→Automation references; fix any found (kebab→Settings clicks stay valid).
- [x] AC23: Grep-AC — each hit of the following over `docs/ README.md CLAUDE.md tests/behavior/*.md src/ scripts/` (excluding `tests/behavior/*/runs/` and the dated audit doc) is judged exempt-or-fixed, with the judgment list in the flight log: `goldfinch://settings`, `Settings.{0,40}([Aa]utomation|port|toggle|[Kk]ey)`, `Settings → (Keys|Automation)`, `#automation\b`.

**Gates**
- [x] AC24: `npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check` pass (run `npm run format` first).
- [x] AC25 (scroll-spy sub-check carried to HAT by-eye): **Live smoke** in dev mode (admin key), exercising every existing apparatus primitive against the new state, results in the flight log:
  - `enumerateWindows`, `getChromeTarget`; chrome `evaluate` with `expression: "createTab('goldfinch://automation', null, { trusted: true })"`; `enumerateTabs` lists the new internal tab;
  - on the automation guest: `evaluate` `location.origin === 'goldfinch://automation'` and `typeof window.goldfinchInternal === 'object'`; `readDom` shows the three sections, both hint strings, the per-jar key list populated (`#automation-jars` non-empty) and the status line populated (not `—`); `readAxTree` shows the `Automation sections` navigation landmark and h1/h2s; `captureScreenshot` and `captureWindow` succeed (eyeball: styled like Settings);
  - `click` (coordinate-only `{wcId,x,y}`): first get `#automation-enabled`'s rect via guest `evaluate` (`getBoundingClientRect`, guest-viewport coordinates). Disabling the surface may drop the smoke's own MCP session (check `settings-automation.md` / the toggle path for how the old spec sequenced this) — so if a click-off/click-on round trip is unsafe, click a non-destructive control instead (e.g. `#automation-copy-address` → `#automation-message` reads "Copied"/"Copy failed") and verify the toggle by reading `settingsGet('automationEnabled')` via guest `evaluate` matches `#automation-enabled.checked`. Any state changed must be restored (via guest `evaluate` `settingsSet`) even on failure; the Activity log shows the smoke's own admin calls;
  - chrome `evaluate` `kebabActionSettings()` opens Settings (proves the seam wrapper); on that guest `readDom` shows no `#automation` section and the nav (with `section-nav` class) has 3 links; with both pages open, Settings controls still render without console errors (guest `evaluate` probe);
  - scroll-spy change, not initial state: on the Settings guest `scroll` to the bottom (About) and assert the `#about` link gains `aria-current="true"` while the first link loses it; on the Automation guest, if it can't scroll, assert the initial state (Connection current) only;
  - The kebab sheet itself is unobservable (not in `AUTOMATABLE_MENU_TYPES`) — the menu click is left to the HAT, not faked here; the container name "Automation" is unit-pinned (AC10) since internal tabs render no dot.
  - The smoke must run on a rebuilt preload bundle (`dev:automation` runs `build-preload`; a stale gitignored `internal-preload.bundle.js` without the new origin would leave `window.goldfinchInternal` undefined and mislead the result).

## Verification Steps
- AC1–AC6, AC9–AC11, AC16–AC18: `node --test test/unit/overlay-menus.test.js test/unit/seam-contract.test.js test/unit/internal-page-map.test.js test/unit/internal-page-route-closure.test.js test/unit/url-safety.test.js test/unit/internal-ipc.test.js test/unit/tab-controller.test.js test/unit/overlay-dispatch.test.js` plus the new test files; then full `npm test`.
- AC4: `node -e "console.log(require('fs').readFileSync('src/renderer/renderer.js','utf8').split(/\r?\n/).length)"`.
- AC6/AC9 neuter checks: temporarily mutate, observe red, restore; record in the flight log.
- AC7/AC8/AC12/AC13–AC15/AC19–AC22: read the diffs; AC14 by `grep -F` of both exact strings in `automation.html`.
- AC23: run the greps; paste the judged hit list into the flight log.
- AC24: run the four commands.
- AC25: dev-mode smoke script(s) using `connectAutomation()`; keep evidence outside the repo.

## Implementation Guidance

1. **renderer.js extraction first** (keeps the budget test green throughout): move the six bodies and table into `createChromePageActions` as `kebabActions`, add `openAutomationPage` + the `automation` action, add the model item, leave the `kebabActionSettings` wrapper, swap the dispatch dep, refresh/trim the stale comment block, retarget `RENDERER_LINE_BUDGET` in the same edit. Run `seam-contract`, `overlay-menus`, `overlay-dispatch` tests.
2. **Scroll-spy extraction**: create `section-scroll-spy.js` from the IIFE with injected deps; switch `settings.js` to it; add the `section-nav` class + CSS selector retarget; route `/section-scroll-spy.js` on `settings`; add ESLint entry; unit test.
3. **New page**: create `automation.html` from the old section markup inside the Settings shell structure (DD6 contract), `automation.js` by moving code verbatim, `automation.css` by moving automation-only rules. Add the hints.
4. **Onboard the host**: url-safety, both origin sets, map entry, tab-controller names, ESLint entry; drift guard + per-host tests; map test updates.
5. **Remove from Settings**: first grep `test/unit/settings-page-shared-scripts.test.js` for `audit-paging`/`safe-color`/`copyText` and run it unchanged to learn what it pins; confirm the robot-glyph/jar-row CSS (~643–676) and `isSafeColor` have no remaining Settings consumer. Then remove section, nav li, JS, imports, script tags, settings routes no longer needed. Run route-closure.
6. **Strings/docs/specs** per AC20–AC23.
7. `npm run format`; full gates; live smoke.

## Edge Cases
- **TDZ in the verbatim move**: `automation.js` is a module; anything one controller references from another (e.g. `automationKeysOnce`, `copyText`) must be a hoisted `function` or declared above its first evaluation-time use, as it was in `settings.js`.
- **`settings-changed` listeners** in the moved controllers keep their `pagehide` `off…` cleanup — with automation and Settings now possibly open simultaneously, each page registers its own listener; no shared state between pages.
- **`automationKeysOnce` memo** is per page load (module scope) — source of truth is main's key store; rebuilt on every page load; fresh state thereafter rides `settings-changed` (as today). No cross-page cache.
- **Both pages open at once**: toggling automation on the Automation page must still re-sync any open Settings page's unrelated controls without error (Settings no longer listens for automation keys — confirm no leftover listener reads removed elements).
- **Null-guards**: moved controllers already early-return when their elements are missing; keep them (they now run on a page where the elements exist).
- **Print action on a viewless welcome tab** (`wcId === null`): guard preserved.

## Files Affected
- `src/renderer/renderer.js` — kebab extraction, wrapper, dispatch dep, comment
- `src/renderer/chrome/overlay-menus.js` — model item, `kebabActions`, `openAutomationPage`, header comment
- `src/renderer/chrome/tab-controller.js` — `INTERNAL_JAR_NAMES`
- `src/renderer/renderer-globals.d.ts` — origin comment
- `src/shared/url-safety.js` — `INTERNAL_HOSTS` (+ comment)
- `src/main/internal-ipc.js`, `src/preload/internal-preload.js` — `INTERNAL_ORIGINS` (+ comments)
- `src/main/internal-page-map.js` — `automation` entry; `settings` entry routes
- `src/main/automation/mcp-server.js` — `eaddrinuseMessage`
- `src/renderer/pages/settings.{html,js,css}` — removal, `section-nav`, scroll-spy import
- `src/renderer/pages/automation.{html,js,css}`, `src/renderer/pages/section-scroll-spy.js` — new
- `eslint.config.mjs` — module list
- `test/helpers/renderer-line-budget.js` — budget
- `test/unit/overlay-menus.test.js`, `internal-page-map.test.js`, `url-safety.test.js`, `internal-ipc.test.js`, `tab-controller.test.js` — updates; new: internal-host drift guard, `section-scroll-spy` test, `automation-page-shared-scripts.test.js`, renderer TDZ-order pin, `section-nav` pin (may share files)
- `docs/mcp-automation.md`, `docs/dev-testing.md`, `README.md`, `CLAUDE.md`, `scripts/a11y-audit.mjs` (comments)
- `tests/behavior/settings-automation.md`, `settings-activity-viewer.md`, `automation-key-gating.md`, `vault-mcp-surface.md`, `settings-shell.md`, `kebab-menu.md`, `menu-overlay.md`, `multi-window-shell.md`

## Citation Audit
Line numbers verified against `64e15f5` during flight design (two Architect reviews) and at leg design: `renderer.js` 108/544/956/1502 and budget 1546 (split measure); `overlay-menus.js` 5/119; `tab-controller.js` 96; `url-safety.js` 84; `internal-ipc.js`/`internal-preload.js` 26; `eslint.config.mjs` module list 225–240 (settings.js at 235); `mcp-server.js` 1083–1088; `settings-shell.md` row at 85; `kebab-menu.md` "six items" header 1/16/29; `multi-window-shell.md` row 4 at 213. Approximate (`~`) markers elsewhere are drift-tolerant; match by symbol.

---

## Post-Completion Checklist
Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.
