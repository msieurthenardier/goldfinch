# Leg: preload-bundling-infra

**Status**: completed
**Flight**: [Renderer OS Sandbox](../flight.md)

## Objective

Introduce an esbuild-based preload bundling step that emits `src/preload/webview-preload.bundle.js` (a sandbox-loadable single file), wire it into every launch/test/build entry, exclude it from all quality tooling and git, point `main.js` at it — and prove the app behaves **identically** with the bundled preload while `sandbox` stays `false` (no security change this leg).

## Context

- Flight DD1 (esbuild devDep, gitignored regenerated bundle), DD2 (regenerate at every entry; `beforePack` not `beforeBuild`; invisible to eslint/prettier/tsc/git), DD3 (`main.js` retarget). Read the flight spec in full.
- This leg is **infra-only** — it does NOT flip the sandbox. Its whole purpose is to de-risk the new build tooling in isolation: the app must farble/scan/vault-fill exactly as before, with the only change being that the web preload is now the bundled file. Leg 2 flips the sandbox on top of a proven bundle.
- The bundling graph is trivial: `webview-preload.js` requires `electron` (external), `./vault-fill-fields`, `./vault-fill-icon` — both pure leaves (no requires). esbuild inlines the two relative requires and leaves `electron` external.
- The two leaf sources MUST stay in place (three tests require them: `test/unit/vault-fill-fields.test.js:12`, `test/unit/vault-fill-icon.test.js:26-27`). The bundle is an *additional* artifact.

## Inputs

- Branch `flight/02-renderer-os-sandbox` (stacked on flight 1); `npm test` green.
- Network access to `npm i -D esbuild` (esbuild 0.28.x resolves — design-review confirmed).
- `main.js:1276` sets `webPreloadPath: path.join(__dirname, '..', 'preload', 'webview-preload.js')`.

## Outputs

- `esbuild` in `package.json` devDependencies.
- `npm run build:preload` script + the bundling invocation (inline or a tiny `scripts/build-preload.mjs`).
- `scripts/build-preload-hook.cjs` (or similar) — electron-builder `beforePack` hook (string-path referenced from the `build` block).
- Entry wiring: `prestart` + `pretest` npm hooks; `scripts/dev-launch.mjs` regenerates before spawn; `beforePack` in the `package.json` build block.
- Exclusions: `.gitignore`, `eslint.config.mjs` ignores, `.prettierignore`, `jsconfig.json` new `exclude` key — all list the bundle path.
- `src/main/main.js:1276` → `webview-preload.bundle.js`.
- A bundle-integrity unit test.
- The generated `src/preload/webview-preload.bundle.js` exists locally (gitignored — not committed).

## Acceptance Criteria

- [ ] **AC1 (bundler)**: `npm run build:preload` emits `src/preload/webview-preload.bundle.js` — a CJS bundle (`platform=node`, `bundle:true`, `external:['electron']`, no minify) that inlines `vault-fill-fields.js` + `vault-fill-icon.js` and keeps `require('electron')` external. Re-runnable (idempotent), fast.
- [ ] **AC2 (no relative require survives)**: the emitted bundle contains **no** `require('./…')` / `require('../…')` — only `require("electron")` remains. (This is the sandbox-loadability property, pinned by AC7's test.)
- [ ] **AC3 (functional exports)**: the bundle, when its module graph is exercised, exposes the same behavior `webview-preload.js` imports (`fillLoginForm`, `findAllLoginFields`, `findLoginFields`, `createVaultIconController`) — i.e. the two leaves' code is present and callable in the bundle. (Test may require the bundle in a DOM-faked context or assert the leaf function sources are inlined.)
- [ ] **AC4 (entry wiring)**: `build:preload` runs before every path that launches/tests/builds the app — verified: `prestart` fires it (npm runs `prestart` before `start`), `pretest` fires it, `scripts/dev-launch.mjs` regenerates before `spawn(electron)`, and the electron-builder **`beforePack`** hook regenerates for `pack`/`dist` (and thus the CI package/build tasks). Document each wiring point.
- [ ] **AC5 (tooling exclusions)**: the bundle path is excluded from git (`.gitignore`), eslint (`eslint.config.mjs` ignores), prettier (`.prettierignore`), and tsc (`jsconfig.json` `exclude` — a NEW key). `npm run lint`, `npm run typecheck`, `npm run format --check` (if available) do not touch the bundle; `git status` does not show it.
- [ ] **AC6 (retarget)**: `src/main/main.js:1276` `webPreloadPath` points at `webview-preload.bundle.js`. `sandbox` stays `false` this leg (no change to `register-tab-ipc.js`).
- [ ] **AC7 (integrity test)**: a unit test (model: `test/unit/preload-graph-esm-free.test.js`) builds/reads the bundle and asserts (a) it exists / builds, (b) no relative `require` survives, (c) `require("electron")` is external. If building in-test is heavy, the test may invoke `build:preload` once or assert against a freshly built artifact — keep it hermetic and CI-safe (esbuild is a devDep, present in CI).
- [ ] **AC8 (identical behavior — the leg's point)**: with `sandbox` still `false`, the app boots and a real page still farbles (fingerprint hooks active), the media panel scans, and vault fill/capture round-trips — verified live by the FD (dev:automation). No regression vs the pre-bundle behavior.
- [ ] **AC9 (regression)**: `npm test`, `npm run lint`, `npm run typecheck` all pass.

## Verification Steps

- AC1/AC2/AC3/AC7: `npm run build:preload` then inspect + `npm test`.
- AC4: read each entry point; `git clean`-simulate by deleting the bundle and confirming each entry regenerates it (e.g. `rm bundle && npm test` still passes; `rm bundle && node scripts/dev-launch.mjs` regenerates).
- AC5: `git status` clean of the bundle; `npx eslint src/preload/webview-preload.bundle.js` is excluded; `tsc` doesn't report it.
- AC6: grep `main.js:1276`.
- AC8: FD live check (dev:automation) — deferred to FD after `[HANDOFF:review-needed]`.
- AC9: full gate.

## Implementation Guidance

1. `npm i -D esbuild`.
2. Bundling: a small `scripts/build-preload.mjs` calling esbuild's `build`/`buildSync` — `entryPoints:['src/preload/webview-preload.js']`, `outfile:'src/preload/webview-preload.bundle.js'`, `bundle:true`, `platform:'node'`, `format:'cjs'`, `external:['electron']`, `minify:false`, `banner:{js:'/* GENERATED — do not edit; source: webview-preload.js. Regenerate: npm run build:preload */'}`. Add `"build:preload": "node scripts/build-preload.mjs"`.
3. Entry wiring:
   - `package.json`: `"prestart": "npm run build:preload"`, `"pretest": "npm run build:preload"`.
   - `scripts/dev-launch.mjs`: import and run the build (or `spawnSync('npm',['run','build:preload'])`) before the `spawn(electron)` — covers `dev` and `dev:automation` (npm's `predev`/`predev:automation` won't fire for the `:` variant reliably, so do it inside dev-launch itself).
   - `beforePack` hook: `scripts/build-preload-hook.cjs` exporting `module.exports = async () => { require('child_process').execSync('npm run build:preload', {stdio:'inherit'}); }` (unconditional, `void` — no `return` semantics to worry about). Reference it from the `package.json` `build` block: `"beforePack": "scripts/build-preload-hook.cjs"`.
4. Exclusions:
   - `.gitignore`: add `src/preload/webview-preload.bundle.js`.
   - `eslint.config.mjs`: add the path to the top-level `ignores` array (`:5`).
   - `.prettierignore`: add the path.
   - `jsconfig.json`: add `"exclude": ["src/preload/webview-preload.bundle.js"]` (new key — jsconfig has none today; ensure it doesn't disturb `include`).
5. `main.js:1276`: change the filename to `webview-preload.bundle.js`.
6. Integrity test `test/unit/webview-preload-bundle.test.js`: build (or read a freshly built) bundle; assert no `/require\((['"])\.\.?\//` match; assert `require("electron")` present; assert the leaf function names appear. Keep hermetic.
7. Run the gate (AC9). Hand to FD for AC8 (live identical-behavior check).

## Edge Cases

- **Bundle absent on a fresh checkout** (gitignored): every launch/test/build entry regenerates it (AC4) — verify by deleting and re-running each. `npm start` bare-electron is covered by `prestart` (npm always runs `prestart` before `start`).
- **esbuild output churn**: pin no-minify + a stable banner so regeneration is deterministic (matters only for the in-test build; the file is gitignored so on-disk churn is invisible).
- **Leaf edited without rebuild**: impossible to ship stale — the bundle is regenerated at every entry, never committed.
- **`process`/DOM globals in the bundle**: esbuild `platform:node` + `external:electron` leaves DOM globals as free references (resolved at runtime in the page main world) — do not shim them.

## Files Affected

- `package.json` — esbuild devDep, `build:preload`/`prestart`/`pretest` scripts, `beforePack` in build block
- `scripts/build-preload.mjs`, `scripts/build-preload-hook.cjs` — new
- `scripts/dev-launch.mjs` — regenerate before spawn
- `.gitignore`, `.prettierignore`, `eslint.config.mjs`, `jsconfig.json` — exclusions
- `src/main/main.js` — `:1276` retarget
- `test/unit/webview-preload-bundle.test.js` — new
- `src/preload/webview-preload.bundle.js` — generated, gitignored
- flight-log.md — leg entry

---

## Post-Completion Checklist

- [ ] All acceptance criteria verified (AC8 by FD)
- [ ] Tests passing
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed` (Phase B / leg 2 follows; commit batched at flight end)
- [ ] Do NOT commit (flight batches review + commit at end)

---

## Citation Audit

Verified at leg design time (2026-07-25, from flight-2 recon): `main.js:1276` webPreloadPath, `register-tab-ipc.js:88` sandbox line (untouched this leg), leaf-source test requires (`vault-fill-fields.test.js:12`, `vault-fill-icon.test.js:26-27`), `eslint.config.mjs:5` ignores, `package.json` build `files`/`asar`, no existing build step. `jsconfig.json` has no `exclude` key (design-review confirmed). All citations OK.
