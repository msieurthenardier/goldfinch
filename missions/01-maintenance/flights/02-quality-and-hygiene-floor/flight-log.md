# Flight Log: Quality & Hygiene Floor

**Flight**: [Quality & Hygiene Floor](flight.md)

## Summary
In flight (execution started 2026-06-05). Design complete + Architect-approved; recon retired F13, confirmed all other items live.

---

## Flight Director Notes

- **Phase 1 setup** — Crew (`leg-execution.md`) + mission unchanged from Flight 1 (valid/active). Node v22 (`node --test`). Baseline `npm test` green before legs. Branched `flight/02-quality-and-hygiene-floor` off `main`; baseline-committing the flight design + transitions.
- **Status transition** — Flight `planning → in-flight` (skipped an explicit `ready` dwell: design just completed via `/flight` and passed Architect review, all Pre-Flight items checked, so it's execution-ready). Mission already `active`.
- **Leg order (dependency-driven)** — 1 test-fixtures+units → 2 container-color → 3 typecheck-codebase (largest; may sub-split main→renderer) → 4 lint+format whole-repo (after typecheck so it formats the new JSDoc) → 5 docs → 6 behavior-test. The two whole-repo sweeps (3, 4) touch every `.js`, so legs are mostly sequential (limited parallelism vs Flight 1).
- **Watch items from design review** — Leg 3 `Electron.WebviewTag` annotation budget (≤5 `@ts-expect-error`); Leg 4 mandatory human diff-review after auto-fix (96-test gate doesn't cover ~80% of the app); Leg 6 two-target CDP + attempt-live-run.

---

## Reconnaissance Report

Sources: maintenance report [2026-06-05](../../../../maintenance/2026-06-05.md) (F8–F13) + Flight 1 debrief carry-forwards. Walked against current `src/`/config at HEAD (post-Flight-1 merge, v0.3.0).

| Item | Classification | Evidence (current code) | Recommendation |
|------|----------------|-------------------------|----------------|
| F8 — privacy-core unit tests | **confirmed-live** | `node --test` runner exists (Flight 1). Untested pure fns: `registrableDomain`/`hostnameOf`/`classify` (`src/main/trackers.js` — **pure, no requires**); `active`/`stripUrl`/`isTrackingParam`/`isPaused` (`src/main/shields.js` — pure given module `config`, but file `require('electron')` at `shields.js:7`, so its tests need the stub). Both modules live in `src/main/`, not `src/shared/`. | Fix — trackers tests clean; shields tests need the electron stub fixture. |
| F9 — `engines.node` | **confirmed-live** | No `engines` in `package.json`. | Fix. |
| F10 — ESLint/lint script | **confirmed-live** | No `.eslintrc*`/`eslint.config.*`/Prettier config; no `lint` script. | Fix. |
| F11 — `@ts-check`/jsconfig | **confirmed-live** | No `jsconfig.json`/`@ts-check`. Stray `@type {Map<string, Tab>}` at `renderer.js:53` (undefined `Tab`). | Fix. |
| F12 — README accuracy | **confirmed-live** | `README.md` `## Features` omits Shields/privacy/containers; `## Keyboard shortcuts` omits `Ctrl+Shift+P`; `## Architecture` omits `shields.js`/`jars.js`/`trackers.js`. (Auto-update only touches the DOWNLOADS block.) | Fix. |
| F13 — delete stale branches | **already-satisfied** | `git ls-remote --heads origin` → **only `main`**. The 6 cited branches (`branding`, `docs-claude-md`, `download-selected`, `privacy-panel`, `release-prep-v0.2.0`, `shields`) are already deleted. | **Retire** — no work. |
| Container `color` injection (mission Known Issue) | **confirmed-live** | `validateContainers` (`jars.js`) leaves `color` format-unvalidated; rendered unescaped into `style="background:${c.color}"` at `renderer.js:76, 127, 883`. | Fix — small security fast-follow. |
| Run `tab-scheme-guard` behavior test (carry-fwd) | **pending** | `tests/behavior/tab-scheme-guard.md` is `draft`, never run; needs `dev:debug` (:9222) + a local HTTP trigger fixture (does not yet exist). | Run + promote `draft → active`. |
| Document `src/shared/` pattern + security boundary in CLAUDE.md (carry-fwd) | **confirmed-live** | `CLAUDE.md` updated the test note (Flight 1) but does not describe the dual-export predicate module or the `createTab` + `will-navigate` boundary. | Fix — fold into the docs leg. |
| Consolidate Electron test stub (carry-fwd) | **confirmed-live** | `test/unit/jars.test.js:14` hand-stubs `Module._cache[electron]`; the shields tests will need the same. | Consolidate into a shared `test/helpers/` fixture. |

**Retirement to confirm with operator**: F13 (already-satisfied) — confirmed by operator; retired.

---

## Design Review (Phase 5b)

**Cycle 1 — Architect (Sonnet): approve with changes.** F13 retirement confirmed (`origin` has only `main`); `engines >=20` correct; trackers pure / shields needs stub — confirmed. Incorporated:
- **[high] Leg 3 `<webview>` typing** — `createElement('webview')`→`HTMLElement`, so ~10 webview method calls in `renderer.js` error unless annotated `Electron.WebviewTag` (Electron 33 ships those types). Pre-decided the annotation pattern, recalibrated AC to "zero errors + `@ts-expect-error` ≤5 + webview sites annotated", and fixed the sub-split seam (main/preload/shared/trackers/shields/jars, then renderer). Folded in the `url-safety.js` `globalThis` guard.
- **[high] Leg 6 apparatus** — CDP exposes renderer + each `<webview>` guest as separate targets; Executor must `select_page` to the guest for Act steps and back to the renderer for Observe steps. WSLg present → attempt the live run, fallback only on launch/attach failure.
- **[med] eslint --fix risk** — 96-test gate doesn't observe ~80% of the app; added a mandatory human diff-review step after the auto-fix sweep + pre-decided Prettier config (singleQuote, trailingComma none, printWidth 120).
- **[med] shields testability** — `active`/`isPaused` need `config`; arrange via exported `set()`/`setPaused()` (no `load()` needed). Noted in Leg 1.
- **[med] recon path** — clarified `shields.js`/`trackers.js` are `src/main/`, not `src/shared/`.
- **[low] color regex** — tightened to `{3,4,6,8}` hex (or CSS keyword); confirmed existing colors pass.

Changes are AC tightening + apparatus detail (the architect confirmed both HIGH items are achievable, not redesigns) → no second review cycle.

---

## Leg Progress

### test-fixtures-and-privacy-units — landed (2026-06-05)

**Status**: landed

**Changes**:
- `test/helpers/electron-stub.js` (new) — shared side-effecting Electron stub; `app.getPath` returns `path.join(os.tmpdir(), 'goldfinch-test-userdata')`. `Module._cache` injection is the require side-effect.
- `package.json` — `test` script changed from `node --test` to `node --test 'test/unit/*.test.js'` (scopes discovery to unit suites; helpers excluded).
- `test/unit/jars.test.js` — removed inline `Module._cache` stub block; replaced with `require('../helpers/electron-stub')` before requiring jars. All existing assertions pass.
- `test/unit/trackers.test.js` (new) — 15 tests covering `registrableDomain` (7 cases), `hostnameOf` (2 cases), and `classify` (6 cases including first-party same-domain, host-level fallback, undefined firstParty).
- `test/unit/shields.test.js` (new) — 16 tests covering `isTrackingParam` (7 cases), `stripUrl` (3 cases), `active` (3 cases with state restoration), `isPaused` (3 cases with state restoration).

**Test result**: 127 tests, 127 pass, 0 fail. Previous baseline was 96 tests (url-safety + download-path + jars); 31 new tests added across trackers and shields suites.

**Notes**:
- `node --test test/unit/` (directory form) fails in Node v22.22.0 — it attempts to load the path as a module rather than discovering test files. Used `node --test 'test/unit/*.test.js'` glob instead; achieves identical scoping intent (unit suite only; helpers excluded).
- Verification passes: `Module._cache` injection lives only in `test/helpers/electron-stub.js`; both `jars.test.js` and `shields.test.js` require the helper before their module under test.

### container-color-validation — landed (2026-06-05)

**Status**: landed

**Changes**:
- `src/main/jars.js` — added pure `isSafeColor(c)` with `HEX` (`/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/`) and `KEYWORD` (`/^[a-zA-Z]{1,20}$/`) guards; replaced `typeof color === 'string' ? color : '#b06ef5'` in `validateContainers` with `isSafeColor(color) ? color : '#b06ef5'`; replaced `color || '#b06ef5'` in `add` with `isSafeColor(color) ? color : '#b06ef5'`; exported `isSafeColor`.
- `test/unit/jars.test.js` — added `isSafeColor` to the import; renamed `'string color is kept as-is'` → `'valid hex color string is kept'`; added 20 new tests: 6 `isSafeColor` accept cases (#9aa0ac, #abc, #abcd, #11223344, red, RebeccaPurple), 13 reject cases (url(x), red;, injection payload, red", rgb(), #12, #1234567, #xyz, '', '  red', non-string number, null, 'a b'), and 1 `validateContainers` case verifying injection payload color falls back to `#b06ef5` while preserving other fields.
- `missions/01-maintenance/mission.md` — ticked the container-`color` Known Issue checkbox `[ ]` → `[x]`.

**Test result**: 147 tests, 147 pass, 0 fail. Previous baseline was 127 tests; 20 new tests added to the jars suite.

**Notes**:
- All four `DEFAULTS` colors (#9aa0ac, #4caf50, #2196f3, #f5c518) pass `isSafeColor` — no legitimate container is altered.
- Verification: `grep -n "isSafeColor" src/main/jars.js` → defined (line 17), used in `validateContainers` (line 51), used in `add` (line 93), exported (line 99).

### typecheck-node-side — landed (2026-06-05)

**Status**: landed

**Changes**:
- `package.json` — devDeps `typescript` (`^6.0.3`) and `@types/node` (`^25.9.1`) installed; `"typecheck": "tsc --noEmit -p jsconfig.json"` added to scripts.
- `jsconfig.json` (new) — `allowJs:true`, `checkJs:false`, `noEmit:true`, `target:"es2022"`, `lib:["es2022"]`, `module:"commonjs"`, `moduleResolution:"node"`, `strict:false`, `skipLibCheck:true`, `types:["node"]`, `ignoreDeprecations:"6.0"` (required because TypeScript 6.0 treats `moduleResolution:node` as `node10` and emits a deprecation error; `"bundler"` would have been the upgrade but the leg spec prescribes `"node"` so `ignoreDeprecations` is the correct fix), `include:["src/**/*.js"]`.
- `src/main/session-augments.d.ts` (new) — module augmentation adding `__goldfinchShields?: boolean` and `__goldfinchDownloads?: boolean` to `electron.Session`.
- `src/shared/url-safety.js` — restructured dual-export to if/else form; `@ts-check` added. The `else` branch uses `/** @type {any} */ (globalThis)` casts to assign globals without type errors.
- `src/main/main.js` — `@ts-check` added. Zero annotation changes required beyond the directive; `strict:false` means `mainWindow` null-access patterns don't error, and the Session augmentation covers the `__goldfinch*` flags.
- `src/main/shields.js` — `@ts-check` added. No further annotations needed.
- `src/main/trackers.js` — `@ts-check` added. No further annotations needed.
- `src/main/jars.js` — `@ts-check` added. No further annotations needed.
- `src/main/download-path.js` — `@ts-check` added. `isWithinDir` already had full JSDoc from Leg 1; no further annotations needed.
- `src/preload/chrome-preload.js` — `@ts-check` added. No further annotations needed.

**Typecheck result**: 0 errors before → 0 errors after (with `// @ts-check` on all 7 files). The only friction encountered was the TypeScript 6.0 deprecation of `moduleResolution:"node"` (treated as `node10`), resolved by adding `"ignoreDeprecations":"6.0"` to jsconfig.json — not a code annotation, just a config opt-in to preserve the spec-prescribed setting through the TS 6 transition.

**Suppressions**: 0 — no `@ts-ignore` or `@ts-expect-error` used anywhere.

**Annotation summary**: The session augmentation in `session-augments.d.ts` is the only non-trivial type-level addition. The `@type {any}` casts on the `globalThis` assignments in `url-safety.js` are inline and idiomatic. All other files passed `@ts-check` with `strict:false` and the existing code shapes — no JSDoc `@param`/`@returns` annotations were required for zero errors.

### typecheck-renderer — landed (2026-06-05)

**Status**: landed

**Changes**:
- `jsconfig.json` — added `"dom"` and `"dom.iterable"` to `lib`; changed `include` from `["src/**/*.js"]` to `["src/**/*.js", "src/**/*.d.ts"]` so `.d.ts` declaration files are picked up.
- `src/renderer/renderer-globals.d.ts` (new) — declares `interface GoldfinchBridge` mirroring all 20 keys of `chrome-preload.js`'s contextBridge object (methods loosely typed `any`; `webviewPreloadPath: string` as a string property). Declares `interface Window { goldfinch: GoldfinchBridge }`. Also declares `isSafeTabUrl` and `isSafePosterUrl` as globals (injected by `url-safety.js` via `globalThis` in the renderer, which has no `require()`).
- `src/renderer/renderer.js` — added `// @ts-check`. Added `Tab` `@typedef` (fields: `id`, `webview: Electron.WebviewTag`, `title`, `url`, `favicon`, `media`, `selected`, `wcId`, `privacy`, `container`, `btn?`). Cast all 51 `els` object members to specific subtypes (`HTMLInputElement` for `address`, `HTMLButtonElement` for buttons, `HTMLAudioElement` for `playerAudio`, `NodeListOf<HTMLElement>` for `filters`, `HTMLElement` for others). Cast the single `document.createElement('webview')` at `:111` to `Electron.WebviewTag`. Cast `e.target` in the tab button click handler to `HTMLElement`. Cast `querySelectorAll('.media-card')` results to `HTMLElement` in `highlightPlaying`.
- `src/preload/webview-preload.js` — added `// @ts-check`. Annotated `timer` and `fpTimer` as `ReturnType<typeof setTimeout> | null`. Cast `querySelectorAll('a[href]')` to `NodeListOf<HTMLAnchorElement>`, `querySelectorAll(metaSel)` to `NodeListOf<HTMLMetaElement>`, and `querySelectorAll('iframe[src]')` to `NodeListOf<HTMLIFrameElement>`.
- `src/main/main.js` — no changes needed; the dom+node `setTimeout` union did not cause errors (main.js timer handles are stored in a `Map` and never passed to `clearTimeout` — design review prediction confirmed).

**Error walk**: renderer.js opened with 5 errors after `// @ts-check` and the `els` casts (missing globals `isSafeTabUrl`/`isSafePosterUrl`, `Tab.btn` missing from object literal, `e.target.classList`, `querySelectorAll .dataset`). All resolved by casts and the `renderer-globals.d.ts` globals. webview-preload.js opened with 4 errors (`.href` on `Element`, `.content` on `Element`, `.src` on `Element` for iframe) — all resolved by typed `querySelectorAll` casts.

**Casts**: ~58 `@type` casts total (els members: 51, webview createElement: 1, e.target: 1, highlightPlaying forEach: 1, webview-preload querySelectorAll: 3, renderer-globals globals: 2). Zero `@ts-expect-error`. Zero `@ts-ignore`.

**Suppressions**: 0 — no `@ts-expect-error` or `@ts-ignore` used.

**Typecheck result**: 0 errors (whole codebase — Node + DOM). `lib` change did not affect Node-side files.

**Test result**: 147 tests, 147 pass, 0 fail (no behavior change — annotations only).

### lint-and-format-codebase — landed (2026-06-05)

**Status**: landed

**Changes**:
- `eslint.config.mjs` (new) — flat ESLint config; ignores block (standalone), `js.configs.recommended`, commonjs block for `src/main/**`/`src/shared/**`/`src/preload/chrome-preload.js`/`test/**`/`*.config.{js,mjs}`, ESM/node block for `scripts/**`, node+browser block for `src/preload/webview-preload.js`, browser+injected-globals block for `src/renderer/**/*.js` (sourceType:'script', isSafeTabUrl/isSafePosterUrl), `eslintConfigPrettier` last.
- `.prettierrc` (new) — `{ singleQuote: true, trailingComma: "none", printWidth: 120 }`.
- `.prettierignore` (new) — excludes `node_modules`, `dist`, `build`, `package-lock.json`, `missions/`, `maintenance/`, `tests/`, `*.md`.
- `package.json` — added `"lint": "eslint ."` and `"format": "prettier --write ."` scripts; added `"engines": { "node": ">=20" }`; installed 5 devDeps: `eslint`, `@eslint/js`, `globals`, `prettier`, `eslint-config-prettier`.
- `src/renderer/renderer.js` — removed dead `pGroup` function (~:1010, defined-not-called; replaced by `pGroupStatus` in active use). Removed dead `isAV` variable (~:443, assigned-not-used). Added `/* webview not ready */` comments to 3 empty catch blocks (back/forward clicks, rescan-media). Reformatted by Prettier.
- `src/preload/webview-preload.js` — converted 6 `catch(e) {}` to bindingless `catch { /* reason */ }` (satisfies `no-unused-vars` + `no-empty`). Reformatted by Prettier.
- `src/main/download-path.js` — fixed `no-useless-escape`: `\/` → `/` in character class. Reformatted by Prettier.
- `src/main/**`, `src/shared/**`, `test/**` — Prettier formatting only (quote style, trailing comma removal, brace expansion).

**Deviations from leg spec**:
- `eslint.config.js` renamed to `eslint.config.mjs` — the leg spec calls for `eslint.config.js` with ESM `import` syntax, but the package has no `"type": "module"` field and adding it would break all CommonJS `require()` calls in the Electron main process at runtime. Using `.mjs` extension is the standard Node.js solution: ESLint loads it as ESM without requiring a package-wide `"type"` change. Semantically identical to the spec's intent; no behavior difference.
- Added `scripts/**` ESM/node block to config — `scripts/update-readme.mjs` uses `import` and `process`/`console`; would have had 6 `no-undef` errors. Block added with `sourceType: 'module'` and `globals.node`. Strictly additive.
- Added `eslint.config.mjs` to the ignores block — ESLint attempted to lint its own config file using the `*.config.{js,mjs}` glob with `sourceType: 'commonjs'`, which fails on ESM syntax. Config files are conventionally not self-linted.

**Lint errors walked** (initial run after pre-fix cleanup, before resolution):
1. `eslint.config.js` — parse error: ESM syntax without package type → renamed to `.mjs`, added to ignores.
2. `scripts/update-readme.mjs` — 6× `no-undef` (process, console) → added `scripts/**` ESM/node block.
3. `src/main/download-path.js:52` — `no-useless-escape` (`\/` in char class) → manually fixed (`/`).
4. `src/renderer/renderer.js:443` — `no-unused-vars` (`isAV`) → removed dead variable.
Total: 9 lint errors → 0. No rules downgraded.

**Rule downgrades**: None. Exit 0 achieved without any rule-to-warn downgrade.

**Gate results**:
- `npm run lint` — exit 0, 0 errors.
- `npm test` — 147 pass, 0 fail (no test flips).
- `npm run typecheck` — 0 errors (Prettier preserved all `@ts-check` annotations).

**Diff-review verdict**: Reviewed 9 non-test source files (`renderer.js`, `main.js`, `webview-preload.js`, `chrome-preload.js`, `download-path.js`, `jars.js`, `shields.js`, `trackers.js`, `url-safety.js`). All changes were formatting-only EXCEPT:

- **`src/renderer/renderer.js` — `pGroup` function removed** (lines ~1010–1016): intentional dead-code removal per leg spec. Function was defined but never called (replaced by `pGroupStatus`). Not a semantic regression — the function had zero callers.
- **`src/renderer/renderer.js` — `isAV` variable removed** (line ~443): dead variable (assigned, never read). Removed to satisfy `no-unused-vars`. No callers or consumers.
- **`src/preload/webview-preload.js:28` — ternary rewrite**: `A ? B : (C ? D : E)` → `A ? B : C ? D : E`. JavaScript ternary is right-associative; these are semantically identical.
- **`src/preload/webview-preload.js:~259` — precedence parentheses removed**: `((hv & 8) ? 1 : -1)` → `(hv & 8 ? 1 : -1)`. `&` binds before `?` in JS operator precedence table; the outer parens were redundant. Semantically identical.
- **`src/main/download-path.js:52` — regex escape removed**: `\/` → `/` inside `[...]` character class. Forward slash requires no escaping inside a regex character class; the regex matches identically.
- All other changes: Prettier quote normalization (single → already single, trailing comma removal), brace expansion (single-line → multi-line), Set member expansion, method-chain line breaks. Zero operator-precedence rewrites, zero `==`↔`===` changes, zero control-flow alterations.

Note: Changes to `jars.js`, `url-safety.js`, and `jars.test.js` (isSafeColor, dual-export restructure, test refactoring) are from Legs 2–4, not this leg's sweep.

### docs-readme-and-patterns — landed (2026-06-05)

**Status**: landed

**Changes**:
- `README.md` — `## Features`: added "Privacy & Shields" subsection (block/strip/isolate/farble/per-site pause + shields-per-session note) and "Containers / cookie jars" subsection (Default/Personal/Work/Banking containers, ephemeral burner tabs, user-created jars, New Identity). Added "Privacy panel" bullet. `## Keyboard shortcuts`: added `Ctrl+Shift+P` → toggle privacy panel row. `## Architecture` table: added rows for `shields.js`, `jars.js`, and `trackers.js` with accurate one-line roles. `<!-- DOWNLOADS:START/END -->` block untouched.
- `CLAUDE.md` — `## Commands`: added `npm run lint` and `npm run typecheck` lines below `npm test`. Added new `## Patterns` section with: (a) `src/shared/` dual-export predicate pattern (CommonJS for main/tests + `globalThis` for renderer), (b) two-point hostile-URL security boundary (`createTab` gate + `will-navigate` guard sharing `isSafeTabUrl`).

**Verification**:
- Every README feature claim traced to a specific source location:
  - `block` → `shields.js:13` + `main.js:314` (cancel tracker requests)
  - `strip` + Referer trimming → `shields.js:13` + `main.js:320-342` (`stripUrl`, `onBeforeSendHeaders`)
  - `isolate` → `shields.js:13` + `main.js:345-367` (Cookie/Set-Cookie removal)
  - `farble` → `shields.js:13` (farble seed + webview preload)
  - per-site pause → `shields.js:17-18` `pausedSites`; `isPaused`/`setPaused`
  - Default/Personal/Work/Banking containers → `jars.js:22-27` DEFAULTS
  - Burner tabs → `renderer.js:84-87` `makeBurner()`
  - User-created jars → `jars.js:105-119` `add()` + `renderer.js:122-129` `addContainer()`
  - New Identity → `main.js:428` `identity-new` handler (clearStorageData + clearCache + rerollSeed)
  - Privacy panel → `renderer.js:36-40` (els.privacyPanel) + `togglePrivacy()` + `pShields()`/`pJar()`
  - `Ctrl+Shift+P` → `renderer.js:1300` (shiftKey + key === 'P')
  - shields.js/jars.js/trackers.js roles → opening comments in each file
  - dual-export pattern → `url-safety.js:82-87`
  - two-point boundary → `renderer.js:134` (`createTab` gate) + `main.js:65-67` (`will-navigate`)
- `grep -n "DOWNLOADS:START" README.md` → line 14 (intact, untouched)
- `grep -n "shields.js\|jars.js\|trackers.js" README.md` → present (lines 38, 108-110)
- `grep -n "src/shared\|will-navigate\|npm run lint\|npm run typecheck" CLAUDE.md` → all present
- `npm test` → 147 pass, 0 fail
- `npm run lint` → exit 0, 0 errors
- `npm run typecheck` → exit 0, 0 errors

---

### verify-tab-scheme-guard — completed (2026-06-05) — Flight-Director-run

**Behavior test run** (not a Developer agent — the FD invoked `/behavior-test tab-scheme-guard`). Built the HTTP trigger fixture (`tests/behavior/fixtures/tab-scheme-guard/index.html` + serve README), launched the app via `dev:debug` (:9222), served the fixture (:8000), and ran the Witnessed test against the **live app** via raw CDP.

- **Result: partial — 5 pass / 0 fail / 1 inconclusive.** Run log: `tests/behavior/tab-scheme-guard/runs/2026-06-05-16-29-17.md`.
  - PASS: window.open `file:` (B), window.open `javascript:`+`data:` (C, dropped to empty about:blank), **in-page `window.location='file://'` will-navigate vector (D — the critical one)**, https control opens (F).
  - INCONCLUSIVE: media-open `file:` (E) — structurally unreachable (`file:` media isn't cataloged; the crafted `<video src=file://>` errors and never enters the media panel). Not a guard failure.
- **Mode**: consolidated single-pass Witnessed (independent Executor `a084…` drove all vectors; independent Validator `a499…` judged all) — used because multi-turn `SendMessage` live continuation wasn't reliably available; act/judge separation preserved.
- **Apparatus note**: raw CDP over Node WebSocket against the existing Electron `:9222` (chrome-devtools MCP would launch its own browser, not attach). Guest-`<webview>` screenshots weren't retrievable via CDP; `/json` target dumps + renderer screenshot were the evidence.
- **Promotion**: spec left `draft` (partial ≠ all-green). **Follow-up**: refine spec Step 6 (media-open vector is unreachable as written) + re-run to promote → logged as a mission Known Issue.
- **Net**: Flight 1's F1 hostile-page URL guard is now **verified in the running app** for the genuinely hostile-page-reachable vectors (window.open + in-page nav), with no over-blocking. Fixture committed; evidence ephemeral (not committed).

---

### Flight Director — all 7 legs landed

All legs complete (`node --test` 147 green; `npm run lint` exit 0; `npm run typecheck` 0 errors; behavior test partial-pass with the F1 enforcement proven live). Proceeding to Phase 2d: single flight-level code review over all uncommitted changes, then commit + PR.

**FD decision log**: skipped the separate design-review agent for Leg 6 (docs-only — accuracy is an implementation concern, verified against source) and Leg 7 (the behavior spec was Architect-reviewed in Flight 1 + this flight's design review covered the apparatus). Legs 1–5 each got a full design-review cycle. Noted the TS6 `moduleResolution:"node"` + `ignoreDeprecations:"6.0"` deviation (Leg 3) for the flight review — `"bundler"` is the durable fix.

---

## Decisions

---

## Deviations

---

## Anomalies

---

## Session Notes
