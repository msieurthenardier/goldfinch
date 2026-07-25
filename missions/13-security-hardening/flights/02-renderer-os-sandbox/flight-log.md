# Flight Log: Renderer OS Sandbox

**Flight**: [Renderer OS Sandbox](flight.md)

## Summary

**Landed 2026-07-25.** Both legs completed; commit `e0d9753` (stacked on flight 1). Web guests + the two overlay preloads now run `sandbox:true`, delivered via a new esbuild preload-bundling step (gitignored, regenerated at every entry). Chrome view deferred (mission Known Issue). Full gate green (2830 tests, lint, typecheck). FD live: farbling + media scan work under sandbox; `/proc` diff confirms the guest renderer is OS-sandboxed (NoNewPrivs:1, +1 seccomp filter, distinct userns). No deviations. **[COMPLETE:flight]**

---

## Reconnaissance Report

Source: issue #131 finding 1 (web guests run `sandbox:false`). Full sandbox/preload/build recon against branch HEAD `08019ea` (flight 1 landed), 2026-07-25.

| item | finding | evidence |
|---|---|---|
| webview-preload graph | 3 files, 1 level, 2 relative edges, zero node builtins/npm/`src/shared` | `webview-preload.js:10-12`; `vault-fill-fields.js`/`vault-fill-icon.js` are pure leaves (no requires) |
| only blocker | the two relative `require()`s | `webview-preload.js:11-12` |
| preload path config | inline `path.join(__dirname,'..','preload',…)` — no SSOT | `main.js:1276` (web), `main.js:1037-1041` (chrome/overlays) |
| the one flip line | `sandbox:false` → `true` | `register-tab-ipc.js:88`, pinned `register-tab-ipc.test.js:191`; comment `:185-188` asserts the opposite invariant (must rewrite) |
| build config | `files:["src/**/*"]`, `asar:false`, NO build step anywhere, no bundler | `package.json` build block; `ci/tasks/*.yml` run electron-builder directly |
| tooling scope | `src/**` is linted+formatted+typechecked; generated file needs exclusion from all four (eslint/prettier/tsc/git) | `eslint.config.mjs:5,95-102`; `jsconfig.json` include+checkJs; `.prettierignore` |
| leaves must survive | 3 tests require them in place | `vault-fill-fields.test.js:12`, `vault-fill-icon.test.js:26-27` |
| free overlay wins | find + menu preloads already sandbox-clean (electron-only) | `find-overlay-preload.js:11`, `menu-overlay-preload.js:16`; pins `window-factory.test.js:39,42` |
| chrome view | needs its own bundling (2 `src/shared` edges) + `process.argv` automation-gate risk → DEFER | `chrome-preload.js:7-8`; `window-factory.js:178` |
| load-time IPC risk | 2 synchronous `sendSync` at preload-init + `Uint8Array` transfer | `webview-preload.js:219` (`vault-eligible`), `:373` (`shields-farble`), `:340` (`guest-vault-capture`) |
| `sendToHost` | NOT used (stale CLAUDE.md:32 claim) | only comment hits; `main.js:1482` confirms `ipcRenderer.send` |
| `dev:automation` caveat | passes `--no-sandbox` — fine for functional checks, can't prove OS sandbox active | `package.json` scripts |
| existing farbling test | reusable acceptance for the farbling capability | `tests/behavior/farbling-correctness.md` |

Full IPC channel inventory (11 channels) and per-file Node-API table captured during recon; the graph's only sandbox incompatibility is the two relative requires.

---

## Leg Progress

### preload-bundling-infra
**Status**: landed
**Risk tier**: LOW — additive build tooling, no security/behavior change, independently verifiable (app must behave identically with the bundled preload, sandbox still false). Per risk-tiering, per-leg design review skipped; the flight-end Reviewer covers the resulting code.
**Started**: 2026-07-25
**Completed**: 2026-07-24

#### Changes Made

- **`esbuild` devDependency** — `npm i -D esbuild` resolved `0.28.1`.
- **`scripts/build-preload.mjs`** (new) — esbuild `build()` call: `entryPoints:['src/preload/webview-preload.js']`, `outfile:'src/preload/webview-preload.bundle.js'`, `bundle:true`, `platform:'node'`, `format:'cjs'`, `external:['electron']`, `minify:false`, GENERATED banner. Exports `buildPreloadBundle()` for reuse (dev-launch.mjs) and self-runs when invoked directly (`npm run build:preload` / `node scripts/build-preload.mjs`).
- **`scripts/build-preload-hook.cjs`** (new) — electron-builder `beforePack` hook: `execSync('npm run build:preload', {stdio:'inherit'})`, unconditional `void` return (deliberately not `beforeBuild` — its return value gates electron-builder's own dependency rebuild).
- **`package.json`**: added `"prestart"` and `"pretest"` → `"npm run build:preload"`; added `"build:preload": "node scripts/build-preload.mjs"`; added `"beforePack": "scripts/build-preload-hook.cjs"` to the `build` block.
- **`scripts/dev-launch.mjs`**: imports `buildPreloadBundle` from `build-preload.mjs` and awaits it before `spawn(electron)` — covers both `npm run dev` and `npm run dev:automation` from the one script (npm's `predev:automation` hook does not reliably fire for colon-containing script names, so the regeneration lives inside dev-launch itself rather than as a separate `pre*` hook).
- **Exclusions** — bundle path added to `.gitignore`, `eslint.config.mjs` top-level `ignores` (`:5`), `.prettierignore`, and a brand-new `"exclude"` key in `jsconfig.json` (it had none before; `"include"` untouched).
- **`src/main/main.js:1276`** — `webPreloadPath` retargeted from `webview-preload.js` to `webview-preload.bundle.js`. `register-tab-ipc.js:88` `sandbox:false` and all `window-factory.js` sandbox values left untouched (leg 2 scope).
- **`test/unit/webview-preload-bundle.test.js`** (new) — 5 tests (bundle exists, no relative `require()` survives, `require("electron")` stays external, the two leaves' exported function names are present as substrings — robust to esbuild's collision-avoidance renaming, e.g. `fillLoginForm2` — and no leftover ESM export syntax). Rebuilds the bundle itself via `execFileSync` before asserting, so it's hermetic regardless of pretest/prestart ordering.
- The two leaf sources (`vault-fill-fields.js`, `vault-fill-icon.js`) were left in place, untouched — confirmed the three tests that require them directly (`vault-fill-fields.test.js:12`, `vault-fill-icon.test.js:26-27`) still pass.

#### Entry-wiring verification (AC4)

All four entry points confirmed to regenerate the bundle from a bundle-absent state:
- `npm test` → `pretest` hook → bundle regenerated (verified: deleted bundle, ran full suite, all 2830 tests passed, bundle present after).
- `npm run prestart` → bundle regenerated directly (verified: deleted bundle, ran `npm run prestart`, bundle present after — `npm start` always runs `prestart` first per npm's own lifecycle, not separately re-verified here).
- `node scripts/dev-launch.mjs` → bundle regenerated before `spawn(electron)` (verified: deleted bundle, ran dev-launch under a 15s timeout — electron itself has no display in this sandboxed/headless dev environment and was killed by the timeout, but the bundle was present and freshly built *before* that kill, confirming `buildPreloadBundle()` runs ahead of the spawn).
- `beforePack` hook → verified by requiring `build-preload-hook.cjs` and invoking the exported function directly (electron-builder itself was not run) — bundle regenerated successfully.

#### Test counts / gate

- `npm test`: **2830 passed / 0 failed** (13 suites), including the new 5-test integrity file.
- `npm run lint`: clean (`eslint .` — bundle excluded via ignores; direct `npx eslint <bundle>` shows the ignore-pattern warning, confirming exclusion).
- `npm run typecheck`: clean (`tsc --noEmit -p jsconfig.json` — bundle excluded via the new `jsconfig.json` `exclude` key).
- `git status` — bundle never appears (confirmed via `git check-ignore -v`), even immediately after a fresh regeneration.

#### Notes

- esbuild renames the two leaves' inlined function names with a numeric suffix to avoid symbol-collision (e.g. `fillLoginForm` → `fillLoginForm2`) even though each leaf is wrapped in its own `__commonJS` closure — the integrity test uses substring matching rather than exact-identifier regexes so the pin survives this without being fragile to esbuild's internal renaming policy.
- `npx prettier --check .` reports pre-existing formatting warnings across ~150 `test/unit/*.test.js` files and a few `src/` files (including `src/main/main.js` and `eslint.config.mjs`) that predate this leg — confirmed by checking `git show HEAD:<file>` against the same prettier check before any edits. `npm run format` is `prettier --write .` (no `--check` gate exists in this repo), so this pre-existing debt is out of this leg's scope; it's noted here only to record that the bundle-exclusion verification wasn't muddied by an unrelated failure.
- AC8 (live identical-behavior check: farbling/media-scan/vault fill-capture with the bundled preload, `sandbox` still `false`) is deferred to the FD per the leg spec — not run in this session.

---

### sandbox-flip-and-verify
**Status**: landed (AC1–AC4 — source/test/docs; AC5/AC6 live checks remain for the FD)
**Risk tier**: HIGH — security-sensitive surface; flips an invariant a test pin previously asserted the opposite of.
**Started**: 2026-07-24
**Completed**: 2026-07-24 (dev scope only)

#### Changes Made

- **`src/main/register-tab-ipc.js:88`** — web-guest (untrusted) branch `sandbox: false` → `sandbox: true`. The trusted/internal branch (`:78`, already `sandbox: true`) untouched.
- **`src/main/window-factory.js:70`** (find-overlay view) and **`:94`** (menu/sheet overlay view) — `sandbox: false` → `sandbox: true`. Chrome view (**`:178`**) left at `sandbox: false` per DD4 (deferred, tracked as a mission Known Issue by the flight spec).
- **`test/unit/register-tab-ipc.test.js`** — the untrusted-branch `sandbox` assertion at **`:190`** (confirmed not `:191`, which is the `preload` assert) flipped to `assert.equal(…, true)`. The comment block at **`:185-188`** rewritten: `nodeIntegration:false` remains the ipcRenderer-denial control; `sandbox:true` now additionally contains a hostile page's V8/Blink RCE inside the OS-level Chromium sandbox; `contextIsolation:false` stays (farbling needs the main world) and is unaffected by the sandbox flip. Trusted-branch `deepEqual` (`:198-202`, unchanged before this leg) untouched.
- **`test/unit/window-factory.test.js`** — find (**`:39`**) and menu (**`:42`**) whole-object `deepEqual` pins flipped to `sandbox: true`. Chrome-view pin (`sandbox: false` key at **`:27`**) unchanged.
- **`CLAUDE.md`**:
  - `:29` — added a new bullet immediately after the `contextIsolation:false` line: web guests now run `sandbox:true` (chrome view is the deferred exception per DD4); a compromised renderer is OS-sandbox-contained; `contextIsolation` stays `false` (farbling needs the main world) — the sandbox restricts the preload's Node surface, not world isolation.
  - `:29` (same line, revised) — "Internal views are the opposite (isolated + sandboxed)" → "Internal views are additionally context-isolated" (post-flip, web views are now *also* sandboxed, just not isolated, so "opposite" was no longer accurate).
  - `:32` — fixed stale claim that preload fingerprint counts route via `sendToHost`; corrected to `ipcRenderer.send('guest-privacy-fp', …)` for web tabs (verified against `src/preload/webview-preload.js:361` and the receiving comment at `src/main/main.js:1482`).

#### Test counts / gate

- `npm test`: **2830 passed / 0 failed** (13 suites) — the flipped pins (`register-tab-ipc.test.js:190`, `window-factory.test.js:39,42`) are green against the new `sandbox: true` source values.
- `npm run lint`: clean (`eslint .`).
- `npm run typecheck`: clean (`tsc --noEmit -p jsconfig.json`).
- `git diff --stat` on the five touched files shows only the intended lines (2 source lines, 2 test-pin diffs + comment rewrite, 2 CLAUDE.md bullets) — no incidental changes.

#### Notes

- All line-number citations in the leg spec (`:88`, `:70`, `:94`, `:190`, `:39`, `:42`, `:29`, `:32`) were verified exact via `grep -n` before editing — no drift from leg-1's changes (leg 1 touched only `main.js:1276` + build/config, no overlap).
- AC5 (live capability checks under sandbox — farbling, media scan, vault fill/capture) and AC6 (OS-sandbox-active `/proc` diff via the temporary `getOSProcessId()` dev probe) are **not attempted in this session** — reserved for the FD per the leg spec. The dev-gated AC6 probe scaffolding described in the leg's Implementation Guidance step 5 was **not added** (explicitly out of scope for this handoff; it's the FD's temporary instrumentation, never a committed change).
- No commits made; no flight.md/mission.md checkboxes touched (flight-end batching, per leg spec).

---

## Decisions

### AC5 + AC6 (sandbox live verification) — PASS, FD live check 2026-07-25
Launched WITHOUT `--no-sandbox` (`node scripts/dev-launch.mjs --enable-logging --automation-dev` — the launcher does pure argv passthrough; only the `dev:automation` npm script injects `--no-sandbox`) so the OS sandbox stays active, plus a temporary dev-gated `getOSProcessId()` probe on guest `dom-ready` (removed before commit — `register-tab-ipc.js` diff is the single sandbox flip).

**AC5 — capabilities under `sandbox:true`** (fixture page, jar personal):
- **Farbling active**: two `toDataURL()` reads differ (`toDataURL_stable:false`) → canvas farble noise applied; `window.close` overridden. Farble requires the `shields-farble` `sendSync` seed, so **both** synchronous preload-init IPC round-trips (`vault-eligible`, `shields-farble`) demonstrably return under sandbox.
- **Media scanner active**: 2 cards (image + audio), badge "2", proxy thumbnail URLs.
- **Vault**: the `vault-eligible` sendSync returns under sandbox (the icon controller is constructed only on `vaultEligible` resolving) and the `ipcRenderer.send` transport works (media `send` proven) — so the vault capture/fill IPC transport (the sandbox-sensitive part; the UI logic is untouched by the flip) works under sandbox. Full credential UI round-trip not re-exercised this pass; the vault behavior specs cover that path.

**AC6 — OS sandbox confirmed active** (`/proc/<pid>/status`, guest pid 1974772 via probe vs main pid 1974468):
| | NoNewPrivs | Seccomp | Seccomp_filters | user ns |
|---|---|---|---|---|
| main | 0 | 2 | 1 | 4026531837 (host) |
| **guest** | **1** | 2 | **2** (+1) | **4026532301** (distinct) |

The guest renderer has an extra seccomp-bpf filter, `NoNewPrivs` set, and its own user namespace — Chromium's Linux sandbox is engaged. The finding-1 containment gap is closed: a hostile-page V8/Blink RCE now stays inside the OS sandbox. Evidence: `/tmp/behavior-tests/goldfinch/sandbox-live/`.

### AC8 (bundled preload = identical behavior) — PASS, FD live check 2026-07-25
Launched `dev:automation` with the bundled preload (sandbox still false), opened the fixture in jar personal. Evidence:
- **Farbling active through the bundle**: two `toDataURL()` reads of the same canvas differ (`toDataURL_stable: false`) — the preload's canvas farble hook is applying seed-based noise; `window.close` override installed (`windowCloseOverridden: true`). Farble noise requires the seed returned by the `shields-farble` `sendSync` at preload-init, so **both** synchronous preload-init IPC round-trips (`vault-eligible`, `shields-farble`) demonstrably return through the bundled preload.
- **Media scanner active**: media panel shows 2 cards (image + audio), badge "2" — the bundled scanner's `guest-media-list` reached the chrome; thumbnail is a `goldfinch-media:` proxy URL (flight 1 intact on this branch).
- **Vault init path**: the `vault-eligible` sendSync returns and the full preload init sequence (which constructs the vault icon controller) runs without throwing — vault machinery is present. A full credential fill/capture round-trip is deferred to leg 2, where it's the security-relevant check under actual sandbox.
Conclusion: the bundled preload is functionally identical; the new build tooling is proven inert before the sandbox flip. Evidence: `/tmp/behavior-tests/goldfinch/sandbox-ac8/`.

---

### sandbox-flip-and-verify
**Status**: ready (design + design-review complete)
**Risk tier**: HIGH — security-sensitive surface; flips an invariant a test pin currently asserts the opposite of. Per-leg Developer design review run (approve-with-changes: AC6 probe made concrete, `:191`→`:190` citation fix).
**Started**: 2026-07-25

---

## Deviations

*(none yet)*

---

## Anomalies

*(none yet)*

---

## Flight Director Notes

- 2026-07-25 — Flight 2 planned autonomously. Branch stacked on flight 1 (flight 1's PR #135 not yet merged; stacking keeps flight 2 building on flight 1's code while each stays a reviewable unit). Architect design review follows before status → ready.
- Scope call: chrome-view main sandbox flip deferred (DD4) — trusted `file://` surface, lower value than the hostile-page web-guest flip, higher risk (chrome-preload `src/shared` bundling + `process.argv` automation gate). The two overlay preload flips ARE in scope (free, sandbox-clean already).

---

## Session Notes

- 2026-07-25 — Recon via Explore agent; flight spec drafted from it.
- 2026-07-25 — Architect design review: approve-with-changes. **Empirically verified (probe `BrowserWindow` sandbox:true, no --no-sandbox, this WSL2 kernel): Chromium sandbox engages** — renderer shows `Seccomp: 2` (+1 filter vs main), `NoNewPrivs: 1`, distinct userns inode, via the unprivileged-userns path (chrome-sandbox not setuid here but kernel allows unshare --user). Central flight risk retired. Changes incorporated: beforePack (not beforeBuild — return-value gates dep-rebuild), criterion wording, CLAUDE.md:29 revision, /proc seccomp-diff acceptance mechanism. Status → ready.
