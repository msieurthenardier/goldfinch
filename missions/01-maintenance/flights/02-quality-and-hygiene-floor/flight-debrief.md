# Flight Debrief: Quality & Hygiene Floor

**Date**: 2026-06-05
**Flight**: [Quality & Hygiene Floor](flight.md)
**Status**: landed
**Duration**: 2026-06-05 (single session)
**Legs Completed**: 7 of 7

## Outcome Assessment

### Objectives Achieved
The flight established a complete quality floor for the mission and closed every Flight 1 debrief carry-forward. Concretely (PR #9):
- **F8**: privacy-core unit tests (`trackers.js`, `shields.js`) + a shared Electron-stub test fixture. Suite 96 → **147 tests**.
- **Container-`color` injection** (mission Known Issue from Flight 1): `isSafeColor` format-validates `color` in `validateContainers` *and* `add`, closing the `style="background:${color}"` sink.
- **F11**: whole-codebase `@ts-check` (Node side + renderer) — **0 errors, 0 suppressions** — via `jsconfig` + per-file annotation, `Electron.WebviewTag` casts, `Tab`/`Window.goldfinch` typedefs, and a `Session` augmentation.
- **F10/F9**: ESLint (flat) + Prettier whole-repo sweep (behavior-preserving, diff-reviewed) + `engines.node >=20`.
- **F12**: README feature/shortcut/architecture refresh + CLAUDE.md pattern/boundary/command docs (every claim source-verified).
- **Behavior test**: `tab-scheme-guard` run against the **live app** — F1 enforcement proven for the `window.open` and in-page `will-navigate` vectors.
- **F13 retired** by recon (branches already deleted) — no leg spent.

### Mission Criteria Advanced
**F8, F9, F10, F11, F12, F13** checked off (plus F13 retirement). Mission `01-maintenance` is now 12 / 21 criteria complete; Flights 1–2 done, 3 remain.

All Pre-Flight, Checkpoint, and Post-Flight items met except "Code merged" (PR open). No adaptation/divert criteria triggered.

## What Went Well

- **Recon retired F13 before any design effort** — `git ls-remote` showed the six stale branches already gone. The strongest single argument for recon-before-legs as a mandatory gate: it saved a full leg's design + implementation.
- **Per-leg + flight-level design review pre-baked the hard catches into the leg specs**, so implementers had explicit guidance instead of discovering mid-sweep: the `<webview>`/`Electron.WebviewTag` typing wall, the dom+node `setTimeout` union, four flat-config gaps (`src/shared` block, `webview-preload` node+browser globals, the 6 unused `catch(e)` + 3 empty `catch{}`). All resolved with **zero rule downgrades and zero type suppressions**.
- **The aggressive operator choices paid off.** Whole-repo lint+format and whole-codebase `@ts-check` produced one coherent hygiene baseline rather than a patchwork. The `@type`-cast approach beat the budgeted ≤5 `@ts-expect-error` (achieved 0).
- **The mandatory diff-review gate on the auto-fix sweep** caught and classified every non-formatting change (`pGroup`/`isAV` dead-code removal; two Prettier-safe ternary/regex reparses) — the 147-test gate alone was insufficient (it doesn't observe `renderer.js`/`main.js`/`webview-preload.js`).
- **The behavior test ran against the real app** (raw CDP into the running Electron instance) and proved F1's critical in-page `will-navigate` vector live — not just unit-tested.

## What Could Be Improved

### Process
- **Two lint-leg config gaps were discovered during implementation, not at design review** (the `eslint.config.js` → `.mjs` ESM-in-CJS implication, and the `scripts/**` block). Both are derivable from the CJS package context. **Recommendation**: flat-config leg specs for a CJS project should pre-note the `.mjs` requirement and enumerate every directory needing a `files` block (incl. `scripts/`).
- **Flight sizing was at the edge.** 7 legs / ~30 files / six concerns in one flight held together (strict dependency ordering, no diverts), but Legs 1–2 (tests + the security fix) could have been a fast micro-flight to merge the `isSafeColor` fix sooner. Justified here only because that fix is second-order (local-file-tamper tier). **For future**: when a flight bundles a security fix with a large tooling sweep, consider splitting the fix out.

### Technical
- **Test metrics (vs Flight 1 baseline).** `npm test`: **147 pass / 0 fail / 0 skip / 0 flakes, ~68 ms** — up +51 tests from Flight 1's 96, and ~24 ms *faster* wall-clock (more files → more `node --test` parallelism). Per-suite: `url-safety` 49, `jars` 37 (+19), `download-path` 29, `shields` 16 (new), `trackers` 15 (new). New gates this flight: `npm run lint` ~0.5 s (exit 0), `npm run typecheck` ~1.1 s (0 errors). No regressions, no flakes.
- **`@ts-check` silent-coverage drift (both reviewers).** With `checkJs:false`, any *new* `src/**/*.js` file is unchecked until someone adds `// @ts-check` — no config-level enforcement. All 9 current files are annotated, so the cheap durable fix is to **set `checkJs:true` and drop the per-file directives** (identical zero-error result, but auto-covers new files). High-value, low-cost; recommend before Flight 3 adds files. (Logged as an action item.)
- **`jsconfig` `moduleResolution:"node"` + `ignoreDeprecations:"6.0"`** — TS6 deprecation suppression. Durable fix is `"bundler"`; Flight 3 should do this *first* (before the Electron bump) so a new type error is attributable to the API change, not the resolution change. Already a mission Known Issue.
- **`isSafeColor` keyword branch accepts any letters-only string** (`'notacolor'` → true). Injection-safe (intentional, documented), but an invalid keyword silently renders as no background rather than the fallback color. Low risk; note for if the color sink ever takes truly-arbitrary input.
- **`stripUrl`/`trackers` edge gaps**: `stripUrl` lacks all-tracking / hash+params / single-param cases; `trackers.test.js` assumes specific `TRACKERS` map entries exist (silent-pass if the map changes). Low-risk completeness gaps.
- **Behavior-test Step 6 is a spec defect, not a coverage gap** (both reviewers): it tests a structurally-unreachable scenario (`file:` media is never cataloged — `webview-preload.js:68`). Refine to the reachable `http(s)` media-open path (same `createTab` guard) and re-run to promote. Already a Known Issue.

### Documentation
- CLAUDE.md gained the `src/shared/` dual-export pattern + the two-point security boundary + the lint/typecheck commands. `GoldfinchBridge` in `renderer-globals.d.ts` types IPC payloads as `any` (correct for now) — a note tying each method back to `chrome-preload.js` would help keep the two in sync as the bridge grows.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| `eslint.config.js` → `eslint.config.mjs` | Package has no `type:module`; ESM config needs `.mjs` so CJS `require()` stays intact | Yes — pre-note in flat-config leg specs for CJS projects |
| Added `scripts/**` ESM lint block | `scripts/update-readme.mjs` had 6 `no-undef` without it | Yes — enumerate all dirs needing a `files` block |
| typecheck leg used `checkJs:false` + per-file `@ts-check` (flight DD said `checkJs:true`) | Enabled the Node→renderer sub-split (else renderer errors block the node leg) | Situational — right for staging; revisit to `checkJs:true` post-flight to close drift |
| Behavior run = consolidated single-pass Witnessed (not per-step live continuation) | Multi-turn `SendMessage` continuation not reliably available | Yes — document the consolidated fallback in behavior-test AUTHORING.md (preserve act/judge separation, not step granularity) |
| Behavior apparatus = raw CDP over Node WS (not chrome-devtools MCP) | The MCP launches its own browser; the test needs the *running* Electron app at :9222 | Yes — note for any Electron-app behavior test |
| `ignoreDeprecations:"6.0"` in jsconfig | TS6 hard-errors on `moduleResolution:"node"` | No — debt; fix via `"bundler"` |

## Key Learnings

1. **Recon-before-legs is load-bearing for findings-sourced flights** — it retired F13 and surfaced the trackers-pure / shields-needs-stub distinction that prevented a Leg 1 runtime error.
2. **For sweep-style legs, flight-level design review beats per-leg review** — catching `<webview>` typing and the flat-config gaps *before* a whole-repo pass avoids unwinding a large diff. Pre-baking catches into the spec text made the implementer's job mechanical.
3. **A passing unit suite is not a sufficient gate for an auto-fix sweep** — ~80% of the app has no unit coverage, so the mandatory human diff-review is the real safety net. Standardize it for any auto-fixer run over under-covered code.
4. **Integrity over green**: the behavior run was *partial*; leaving the spec `draft` (vs. promoting) kept the unreachable-Step-6 spec defect visible instead of papering over it.

## Recommendations

1. **Set `checkJs:true` (drop per-file `@ts-check`) before Flight 3** — closes the silent-coverage drift at zero cost (all files already pass). Highest-value, lowest-effort follow-up.
2. **Flight 3 (Electron upgrade) sequencing**: (a) switch `jsconfig` `moduleResolution` → `"bundler"` and remove `ignoreDeprecations` *first*; (b) after `npm install electron@latest`, run `npm run typecheck` — it will surface any `WebviewTag`/`Session`/`ipcRenderer.sendToHost` (deprecated since E28) API changes at the cast/typedef sites; (c) every new file carries `// @ts-check` (or moot if checkJs:true is adopted).
3. **Flight 4 (CI hardening) should add the gates to `ci.yml`** — `npm test` → `npm run typecheck` → `npm run lint` before the `electron-builder` package step (all fast, deterministic, no GUI). This operationalizes the quality floor and pairs naturally with F21 (CI dependency audit). Remove `ignoreDeprecations` here if Flight 3 didn't.
4. **Refine `tab-scheme-guard` Step 6** to a reachable `http(s)` media-open assertion and re-run to promote the spec `draft → active`.
5. **Flight 5 (accessibility) leg ACs must include `npm run lint` + `npm run typecheck`** alongside `npm test`, and budget for `els`-member casts on any new DOM access (renderer is `@ts-check`'d + `sourceType:'script'`).

## Action Items
- [ ] Adopt `checkJs:true` in `jsconfig.json` (drop per-file directives) — close the `@ts-check` drift gap. (Flight 3 first leg / quick fix)
- [ ] Flight 3: `moduleResolution:"bundler"` + drop `ignoreDeprecations` before the Electron bump; typecheck as the upgrade regression net.
- [ ] Flight 4: enforce test/typecheck/lint in `ci.yml`.
- [ ] Refine behavior-test Step 6 (reachable media-open path) + re-run → promote spec `active`.
- [ ] Flight 5: add lint+typecheck to leg ACs; expect `els`-cast budget.
- [ ] (Low) Add a double-require idempotency guard to `test/helpers/electron-stub.js`; consider moving `isSafeColor` to `src/shared/` if the color sink ever takes dynamic input.

## Skill Effectiveness Notes

- **Mission**: criteria mapped one-per-finding and were measurable. The F8 criterion named the exact functions to cover — good. F13's criterion ("branches are deleted") was satisfiable by recon, which the flight correctly did rather than scaffolding work.
- **Flight**: the recon phase + flight-level Architect review were the high-value steps. **Methodology suggestion**: treat recon-before-legs as a *named mandatory gate* for any flight sourcing items from a prior artifact, and prefer flight-level (whole-design) review over per-leg review when legs are sweep-style. Document the **consolidated-Witnessed fallback** and the **mandatory diff-review gate on auto-fix sweeps** as named patterns (the former in behavior-test AUTHORING.md).
- **Leg**: specs were the most detailed yet and ACs were verifiable (exact exit codes/grep/counts). The one miss: implementation-environment implications (ESM config in a CJS project, `scripts/` globals) belong in the leg spec's design decisions, not left to implementation discovery.
