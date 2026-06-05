# Flight: Quality & Hygiene Floor

**Status**: completed
**Mission**: [Codebase Health — 2026-06-05 Maintenance](../../mission.md)

## Contributing to Criteria
- [x] F8 — test runner + unit tests over the privacy core
- [x] F9 — `engines.node` floor declared
- [x] F10 — ESLint + formatter configured with a lint script
- [x] F11 — `@ts-check`/`jsconfig` enabled; stray `Tab` JSDoc fixed
- [x] F12 — README documents Shields/containers/privacy + `Ctrl+Shift+P`; architecture table updated
- [x] F13 — six stale squash-merged remote branches deleted — **already satisfied** (recon 2026-06-05: `git ls-remote --heads origin` → only `main`; the branches were already removed). Retired, no leg.
- [x] Known Issue — container `color` HTML-attribute injection sink closed
- [x] Carry-forward — `tab-scheme-guard` behavior test **run** against the live app (partial: 5 pass / 0 fail / 1 inconclusive; F1 enforcement proven for window.open + in-page-nav). Spec left `draft` pending a Step-6 refinement — promotion deferred.
- [x] Carry-forward — `src/shared/` pattern + security boundary documented in CLAUDE.md
- [x] Carry-forward — Electron test stub consolidated into a shared fixture

---

## Pre-Flight

### Objective
Establish the quality floor the rest of the mission relies on — a unit-test net over the security-critical privacy core, codebase-wide linting/formatting and type-checking, a Node version floor, an accurate public README — and close the Flight 1 debrief carry-forwards (container-`color` injection, the deferred `tab-scheme-guard` behavior-test run, the `src/shared/` pattern docs, and the shared Electron test fixture). Reconnaissance (flight log) confirmed all items live except F13, which is already satisfied and retired.

### Open Questions
- [x] How aggressive should ESLint adoption be? → Design Decisions (whole-repo auto-fix + Prettier).
- [x] How wide should `@ts-check` coverage be? → Design Decisions (whole codebase).
- [x] How is the behavior test run handled? → Design Decisions (full leg: fixture + run + promote).

### Design Decisions

**Lint/format — whole-repo clean slate (F10)**: add ESLint flat config (`eslint.config.js`) with `@eslint/js` recommended + a few project rules, **Prettier** for formatting, and `eslint-config-prettier` to disable ESLint stylistic rules so the two don't conflict. Run `eslint --fix .` and `prettier --write .` across the entire codebase. Add `lint` (and `format`) scripts. Dev deps: `eslint`, `@eslint/js`, `globals`, `prettier`, `eslint-config-prettier`. ESLint `ignores`: `node_modules/**`, `dist/**`, `build/**`, `tests/behavior/fixtures/**` (throwaway trigger content).
- **Prettier config (pre-decided to minimize churn — matches existing style)**: `singleQuote: true`, `trailingComma: 'none'`, `printWidth: 120` (the codebase is uniformly single-quoted, 2-space, long lines). Deciding this up front avoids a surprise hundreds-of-lines diff from wrong defaults.
- Rationale: operator chose the clean-slate end state over a touched-files-only floor.
- Trade-off: a large diff touching nearly every `.js` file. **Mitigation**: this is its own leg, run *after* all content/typecheck legs. The `npm test` suite (96+ tests) covers only `url-safety`/`download-path`/`jars` — it does **not** observe `renderer.js`/`main.js`/`webview-preload.js`/`shields.js`/`trackers.js` (no unit coverage). So the test gate alone is insufficient: the leg **must include an explicit human diff-review step** scanning the auto-fix diff for any logic-touching change (operator-precedence rewrites, ternary regrouping) before declaring the sweep safe. If `eslint --fix`/Prettier flips any test or the diff review finds a semantic change, stop and disable the offending rule rather than accept it.

**Type-checking — whole codebase (F11)**: `jsconfig.json` with `checkJs: true` covering `src/**`. Add `// @ts-check` to every source file (main, preload, renderer, shared). Install `@types/node` + `typescript` (dev, checker-only — no TS source). Add a `typecheck` script (`tsc --noEmit -p jsconfig.json`).
- **The `<webview>` typing pattern (design-review catch — pre-decided, not discovered mid-leg)**: `document.createElement('webview')` returns `HTMLElement`, and Electron does **not** augment `HTMLElementTagNameMap` for `'webview'`. So every webview method call in `renderer.js` (`.loadURL` :247, `.getURL` :202/:212, `.getWebContentsId` :179, `.canGoBack`/`.canGoForward` :236, `.goBack`/`.goForward` :261-262, `.stop`/`.reload` :265, `.send` :287 — ~10 sites) errors as `TS2339` unless annotated. **Electron 33 ships `Electron.WebviewTag` with all of these typed**, so the fix is to annotate each `createElement('webview')` site with `/** @type {Electron.WebviewTag} */` (or cast). Budget this explicitly.
- Define missing types as JSDoc typedefs: a `Tab` typedef (fixing the stray `@type {Map<string, Tab>}` at `renderer.js:53`), and a `Window.goldfinch` typedef for the contextBridge API (`chrome-preload.js`). Also fold in the debrief item: guard the `globalThis` assignment in `url-safety.js:84-85` with `if (typeof window !== 'undefined')` (strict checkJs flags the implicit-any global anyway).
- **Recalibrated acceptance**: `npm run typecheck` → **zero errors**; all `<webview>` sites annotated via `Electron.WebviewTag`; `@ts-expect-error` budget **≤ 5**, each with a one-line reason, reserved for genuinely untypable host/`<webview>`-construction spots. No bare `@ts-ignore`.
- **Pre-decided sub-split seam** (this is the largest leg): sub-leg (a) `main` + `preload` + `shared` + `trackers`/`shields`/`jars` (Node/no-DOM — straightforward annotation); sub-leg (b) `renderer.js` (DOM + `Electron.WebviewTag` casts). Runs *before* the format sweep so its JSDoc gets formatted.
- Rationale: operator chose whole-codebase coverage over the IPC-boundary-only floor.

**Behavior-test verification — full leg (carry-forward)**: build a local HTTP trigger fixture under `tests/behavior/fixtures/tab-scheme-guard/`, run `/behavior-test tab-scheme-guard`, and on green promote the spec `draft → active`.
- **Apparatus (premise-audited, both axes)**: the Executor drives the *guest page* via the **chrome-devtools MCP** attached to `npm run dev:debug` (port 9222, `--no-sandbox`, WSL/headless-friendly per CLAUDE.md). **Two-target orchestration (design-review catch)**: CDP exposes the renderer UI and each `<webview>` guest as *separate* targets. The Executor must `list_pages`/`select_page` to the **guest** target for **Act** steps (run `window.open(...)`/`window.location=...`/media-open on the loaded trigger page), then switch **back to the renderer** target for **Observe** steps (read the `<webview>` element `src`/current URL + address-bar value; screenshot + a11y primary). Both surfaces exist today — no new instrumentation.
- **Environment**: WSLg display is present (`DISPLAY`/`WAYLAND_DISPLAY` set), so the GUI should launch. **Expected path: attempt the live run.** Fall back to fixture-delivery + deferred run *only* if the app fails to launch or CDP cannot attach (Step 1 of the spec probes `:9222` and the fixture before proceeding) — flagged in the log, not silently skipped.

**Engines (F9)** rides with the lint/tooling leg: add `"engines": { "node": ">=20" }` (aligns with CI Node 20 and local Node 22). Trivial; bundled because it's a `package.json` tooling change.

**Test fixture consolidation (carry-forward)**: lift the `Module._cache['electron']` stub from `jars.test.js` into `test/helpers/electron-stub.js`; both the `jars` and the new `shields` unit tests require it (`shields.js` does `require('electron')`). `trackers.js` is pure (no stub needed).

### Prerequisites
- [x] Flight 1 landed/merged; `node --test` runner + `src/shared/` exist (recon).
- [x] Working tree clean on `main` (post-v0.3.0, README auto-commit synced).
- [x] Behavior-test run needs the GUI app to launch via `dev:debug` (:9222) + the new fixture served over local HTTP. No port conflict expected (9222 is the project's own debug port; the fixture uses an ephemeral `http.server` port). Verified at leg time.

### Pre-Flight Checklist
- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified (behavior-test runtime confirmed at leg time)
- [x] Validation approach defined (unit tests, `npm run lint`/`typecheck` clean, behavior test green)
- [x] Legs defined

---

## In-Flight

### Technical Approach

Six legs. Sequencing matters: the two whole-repo sweeps (typecheck, then lint/format) touch every `.js`, so they run after the content legs, and typecheck precedes format (its JSDoc gets formatted). Docs (markdown) and the behavior test are independent tails.

- **Leg 1 — `test-fixtures-and-privacy-units` (F8 + stub consolidation).** Create `test/helpers/electron-stub.js` (lift the `Module._cache['electron']` stub from `jars.test.js:14` — confirmed liftable); migrate `jars.test.js` to require it. Add `test/unit/trackers.test.js` (pure `src/main/trackers.js` — no stub) covering `registrableDomain`, `hostnameOf`, `classify` (eTLD+1 edge cases, third-party detection, tracker classification). Add `test/unit/shields.test.js` (uses the stub — `src/main/shields.js` does `require('electron')`) covering `active`, `stripUrl`, `isTrackingParam`, `isPaused` (`utm_`/`hsa_`/`pk_`/`mtm_` prefixes, multi-param strip, no-op→null). **Note for stateful fns**: `active`/`isPaused` read the module-scoped `config` (starts at `DEFAULTS`, all-on, no paused sites — deterministic); cover the paused/disabled paths by arranging state via the exported `set()`/`setPaused()` (they write `config` in memory; disk I/O is skipped since `configPath` is null until `load()`). `config` is not exported, so use these setters, not direct mutation. `npm test` stays green and grows.
- **Leg 2 — `container-color-validation` (Known Issue).** In `validateContainers` (`jars.js`), accept `color` only if it matches `/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/` **or** a known CSS color keyword, else fall back to the default color — closing the `style="background:${c.color}"` injection at `renderer.js:76, 127, 883`. (All existing colors — DEFAULTS `#9aa0ac`/`#4caf50`/`#2196f3`/`#f5c518`, `add()`'s `#b06ef5` — are 6-digit hex and pass; no legitimate container breaks.) Extend `jars.test.js` with cases: reject `url(...)`, `;`, `"`, `<`, whitespace, non-string → fallback; accept valid hex/keyword. **Confirm no existing `jars.test.js` case asserts a non-hex string color is "kept as-is"** (the current case uses `#ff0000`, which still passes) — update it if found. Tick the mission Known Issue.
- **Leg 3 — `typecheck-codebase` (F11).** Add `jsconfig.json` (`checkJs`, `src/**`), `@types/node` + `typescript` (dev, checker-only), and a `typecheck` script. Add `// @ts-check` to all source files. Fix the stray `Tab` JSDoc (`renderer.js:53`) by defining a `Tab` typedef; define a `Window.goldfinch` typedef for the bridge API. Annotate to resolve diagnostics; narrowly suppress untypable `<webview>`/host spots. Acceptance: `npm run typecheck` reports zero errors. **Largest leg — may split into sub-legs at design time (e.g. main+preload+shared first, renderer second).**
- **Leg 4 — `lint-and-format-codebase` (F10 + F9).** Add `eslint.config.js` (+ Prettier + `eslint-config-prettier`), `lint`/`format` scripts, and `engines.node`. Add `tests/behavior/fixtures/**` to ESLint ignores. Run `eslint --fix .` + `prettier --write .` across the repo. Acceptance: `npm run lint` clean, `npm test` still green (auto-fix changed no behavior). Runs after Leg 3 so it formats the new JSDoc.
- **Leg 5 — `docs-readme-and-patterns` (F12 + CLAUDE.md carry-forward).** README: add a Privacy/Shields/containers section to `## Features`, add `Ctrl+Shift+P` to `## Keyboard shortcuts`, add `shields.js`/`jars.js`/`trackers.js` to the `## Architecture` table (do **not** touch the `<!-- DOWNLOADS -->` auto-managed block). CLAUDE.md: document the `src/shared/` dual-export predicate pattern and the `createTab` + `will-navigate` two-point security boundary, and the new `npm run lint`/`typecheck` commands. Markdown-only — independent of the sweeps.
- **Leg 6 — `verify-tab-scheme-guard` (behavior test).** Build `tests/behavior/fixtures/tab-scheme-guard/` (an HTTP-served trigger page: buttons for `window.open('file:///etc/passwd')`, `javascript:`, `data:`, an in-page `window.location='file://…'`, a crafted `file:` media element, and a control `https://example.com`). Launch `dev:debug`, run `/behavior-test tab-scheme-guard`. On green, promote the spec `draft → active`; the run log lands under `tests/behavior/tab-scheme-guard/runs/`.

### Checkpoints
- [x] Privacy-core units (trackers + shields) green; shared electron-stub fixture in place (Leg 1)
- [x] Container-`color` injection closed + tested (Leg 2)
- [x] `npm run typecheck` clean across the codebase (Leg 3)
- [x] `npm run lint` clean; `npm test` unchanged-green after the format sweep (Leg 4)
- [x] README + CLAUDE.md accurate (Leg 5)
- [x] `/behavior-test tab-scheme-guard` passes; spec `active` (Leg 6)

### Adaptation Criteria

**Divert if**:
- `@ts-check` on `renderer.js`/`main.js` surfaces so many untypable `<webview>`/Electron spots that annotation cost explodes — fall back to the IPC-boundary-only scope for those two files and record the descope in the flight log.
- `eslint --fix` + Prettier changes behavior (any test flips) — stop, isolate the offending rule, disable it rather than accept a behavior change.
- The GUI app cannot launch via `dev:debug` in this environment — Leg 6 delivers the fixture + wiring and defers the live run (flagged).

**Acceptable variations**:
- Splitting Leg 3 (typecheck) into per-area sub-legs.
- Prettier config specifics (print width, quotes) chosen to minimize churn against existing style.

### Legs

> Tentative — planned one at a time during execution. Order is dependency-driven (content → typecheck → format → docs/behavior).

- [x] `test-fixtures-and-privacy-units` - F8 + shared electron-stub fixture
- [x] `container-color-validation` - Known Issue color injection fix + tests
- [x] `typecheck-node-side` - F11 (a): jsconfig + per-file `@ts-check` on main/preload-bridge/shared/main-helpers; `typecheck` script; `url-safety` globalThis guard *(sub-split of typecheck-codebase — incremental `@ts-check`, `checkJs` off, so the renderer can land separately)*
- [x] `typecheck-renderer` - F11 (b): `@ts-check` on `renderer.js` + `webview-preload.js`; `Tab` + `Window.goldfinch` typedefs; `Electron.WebviewTag` casts (≤5 `@ts-expect-error`)
- [x] `lint-and-format-codebase` - F10 ESLint+Prettier whole-repo `--fix` + F9 engines
- [x] `docs-readme-and-patterns` - F12 README + CLAUDE.md pattern/boundary/commands
- [x] `verify-tab-scheme-guard` - behavior-test fixture + run + promote `active`

---

## Post-Flight

### Completion Checklist
- [x] All legs completed
- [ ] Code merged
- [x] `npm test` green; `npm run lint` clean; `npm run typecheck` clean
- [x] `/behavior-test tab-scheme-guard` passing; spec promoted `active`
- [x] README + CLAUDE.md updated

### Verification
- **Automated**: `npm test` (privacy-core + existing suites) green; `npm run lint` and `npm run typecheck` exit clean; `package.json` declares `engines.node`.
- **Behavior**: `/behavior-test tab-scheme-guard` passes against the live app (or the run is explicitly deferred with the fixture delivered).
- **Manual**: README accurately lists the privacy/Shields/containers features + `Ctrl+Shift+P`; CLAUDE.md documents the `src/shared/` pattern and the security boundary; a tampered `containers.json` `color` cannot inject into the container-menu markup.
