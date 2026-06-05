# Flight Log: Dependency Currency — Electron Major Upgrade

**Flight**: [Dependency Currency — Electron Major Upgrade](flight.md)

## Summary
In flight (execution started 2026-06-05). Design complete + Architect-approved (cycle 1; key risks verified live by the Architect). Recon: all items live; `sendToHost` non-issue, `sendSync` is the real landmine.

---

## Flight Director Notes

- **Phase 1 setup** — Crew (`leg-execution.md`) + mission unchanged (active). Gates green on `main` (147 tests, lint, typecheck). Branched `flight/03-electron-upgrade`; baseline-committing the design.
- **Status** — Flight `planning → in-flight` (design complete + Architect-approved). Mission already `active`.
- **Leg order (dependency)** — 1 moduleResolution-bundler → 2 electron-upgrade (big; the sendSync landmine + audit checkpoint live here; may sub-split) → 3 verify-upgrade-behavior (fixture + `core-browsing-shields` + `tab-scheme-guard`, FD-run via `/behavior-test`) → 4 ci-gates-and-audit.
- **Risk note** — This is the mission's riskiest flight (9-major runtime upgrade) and verification is behavior-tests-only (no HAT). The CDP-driven behavior tests (proven in Flights 1-2) are the runtime acceptance gate; if the app won't launch on E42 in this env, fall back to fixture-delivery + deferred runs (flagged), per the flight's adaptation criteria.

---

## Reconnaissance Report

Sources: maintenance report [2026-06-05](../../../../maintenance/2026-06-05.md) (F2, F21) + Flight 2 debrief carry-forwards. Walked against current code at HEAD (post-Flight-2 merge to `main`).

| Item | Classification | Evidence (current code) | Recommendation |
|------|----------------|-------------------------|----------------|
| F2 — Electron major upgrade | **confirmed-live** | `package.json` `electron ^33.2.0` (installed 33.4.11) → latest **42.3.3** (9 majors); `electron-builder ^25.1.8` → **26.8.1**. | Upgrade (breaking; runtime-deep). |
| F21 — CI dependency audit | **confirmed-live** | `.github/workflows/ci.yml` runs `npm ci` + `npx electron-builder --linux --dir` — no audit step. | Add an audit step. |
| jsconfig `moduleResolution` debt (F2 debrief) | **confirmed-live** | `jsconfig.json` `moduleResolution:"node"` + `ignoreDeprecations:"6.0"` (TS6 hard-deprecates `"node"`). `checkJs:true` already in place (F2 debrief fix). | Switch to `"bundler"` + drop `ignoreDeprecations` — **first**, before the bump, so new type errors are attributable to the Electron API change, not the resolution change. |
| `sendToHost` deprecation (F2 debrief) | **needs-recheck** | `webview-preload.js:175` (`media-list`), `:219` (`privacy-fp`) use `ipcRenderer.sendToHost`. This is the **standard, non-deprecated** webview-guest→host channel — the debrief's "deprecated since E28 → sendToFrame" appears mistaken (`sendToFrame` is a `webContents` method, a different thing). | Do NOT pre-migrate. Verify at upgrade time: run the app on E42 and check the console for any `sendToHost` deprecation warning; migrate only if one actually appears. |
| `session-augments.d.ts` / `renderer-globals.d.ts` / `Electron.WebviewTag` casts (F2 debrief) | **needs-recheck** | These typedefs/casts target Electron 33's bundled types. | The post-bump `npm run typecheck` is the regression net — any changed `WebviewTag`/`Session`/IPC signature surfaces as a type error at the cast/typedef sites. No pre-work; verify via typecheck after the bump. |

**No items retired** — all real work. `checkJs:true` (from the F2 debrief) means any new file added this flight is auto-typechecked.

---

## Design Review (Phase 5b)

**Cycle 1 — Architect (Sonnet): approve with changes.** The Architect ran `npm audit` and tested config combos live. Incorporated:
- **Leg 1 `bundler`+`commonjs` confirmed safe** (tested: 0 errors with noEmit+checkJs) — non-issue.
- **`npm audit` gate will pass** post-bump: the 10 highs are `electron` (16 CVEs → cleared by 42) + `tar` via the `electron-builder@25 → @electron/rebuild → node-gyp → tar@6` chain (→ cleared by builder 26 / `@electron/rebuild@4` / `tar@7.5.16`). Added a Leg 2 audit checkpoint + Leg 4 fallback policy (`--audit-level=critical` + document if highs unexpectedly remain).
- **[HIGH] `ipcRenderer.sendSync` landmine** — the farble handshake (`webview-preload.js:231`) uses deprecated `sendSync`; likely warns on E42. Added a Leg 2 step to check + conditionally migrate to `ipcMain.handle`/`invoke` (with a note to preserve document-start farble timing). This is the most likely runtime-visible change.
- **`sendToHost` confirmed non-deprecated** through E42 (debrief claim was mistaken) — no migration.
- **[HIGH] behavior Step 4 (param strip)** — must observe the webview **URL**, not the privacy aggregate `stripped` count (0 for mainFrame: `recordRequest` returns early at `main.js:262`). Spec tightened.
- **[HIGH] behavior Step 5 (tracker blocked)** — privacy state is in the renderer `tabs` map (no JS global); DOM-readable only with the **panel open**. Spec now opens `#toggle-privacy` then reads `.tag.blk`. Fixture must use `google-analytics.com` (confirmed in `trackers.js`).
- **eb26 config**: no known breakers in the `build` block; Leg 2 runs `electron-builder --linux --dir` to confirm.
- Step 6 polls for the new CDP target (registration lag); explicit fixture serve command + non-:9222 port.

Changes are AC/observability tightening + the sendSync addition (core design confirmed sound) → no second review cycle.

---

## Leg Progress

### Leg 1: moduleResolution-bundler (2026-06-05)

**Status**: landed

**Change**: `jsconfig.json` `compilerOptions.moduleResolution` switched from `"node"` to `"bundler"`; `"ignoreDeprecations": "6.0"` line removed. JSON validity preserved (trailing comma on `"types"` line removed along with the deleted property).

**Gate results**:
- `npm run typecheck` → exit 0, 0 errors (no output)
- `npm test` → 147 pass, 0 fail, 0 skip
- `npm run lint` → exit 0 (no output)

**Deviations**: None. Pre-verified combo (`moduleResolution:"bundler"` + `module:"commonjs"` + `noEmit:true` + `checkJs:true`) produced 0 errors exactly as the Architect confirmed.

---

### Leg 2: electron-upgrade (2026-06-05)

**Status**: landed

**Dep versions installed**:
- `electron`: `^42.3.3` → resolved `42.3.3`
- `electron-builder`: `^26.8.1` → resolved `26.8.1`
- `npm install` completed in ~14s, 0 vulnerabilities, no required peer deps (eb26 peer deps non-issue with `identity:null` + `nsis`).

**Typecheck fixes**: None. `npm run typecheck` produced 0 errors immediately after the bump — the Electron 42 bundled types are fully compatible with the existing `Electron.WebviewTag` casts in `renderer.js`, `session-augments.d.ts`, and `renderer-globals.d.ts`. No annotation changes were required.

**sendSync Decision: KEEP IT (no migration).**
`ipcRenderer.sendSync('shields-farble', location.href)` at `webview-preload.js:231` ran without any deprecation warning on Electron 42. The full launch log was inspected — no `sendSync`, `farble`, or IPC deprecation messages appeared. The farble handshake returns config synchronously at document-start as designed. Since `sendSync` works silently (not even a warning, let alone removed), the document-start timing guarantee is intact and no migration is needed. Keeping `sendSync` is the correct choice.

**Runtime fixes**: None. The app launched cleanly on E42. CDP check confirmed:
- Renderer `page` target at `file:///…/src/renderer/index.html` (type: page)
- Initial webview at `https://www.google.com/` loaded (type: webview)
- `createTab('https://example.com/')` via `Runtime.evaluate` on the renderer page created a second webview that navigated to `https://example.com/` (title: "Example Domain") — core navigation confirmed working.

Launch log warnings (cosmetic, pre-existing, all carry "This warning will not show up once the app is packaged"):
- Sandbox/GPU sandbox warnings (OS-level, WSL environment, always present)
- `allowpopups` security advisory (pre-existing; popups are intentional)
- CSP `unsafe-eval` advisory (pre-existing; no CSP set on the renderer)
No `sendToHost` deprecation — confirmed non-issue as the Architect noted.

**Audit checkpoint**: `npm audit --audit-level=high` → **0 highs, 0 vulnerabilities** (as predicted: Electron CVEs cleared by E42; tar chain cleared by eb26/`@electron/rebuild@4`/`tar@7.x`).

**Builder check**: `npx electron-builder --linux --dir` → exit 0. electron-builder 26.8.1 packaged Electron 42.3.3 cleanly. Native dependencies installed, packaging completed to `dist/linux-unpacked`. Expected advisory logged: "asar usage is disabled" (intentional; `asar:false` is required for the webview preload to load from disk in packaged builds).

**Gate results**:
- `npm run typecheck` → exit 0, 0 errors
- `npm test` → 147 pass, 0 fail, 0 skip
- `npm run lint` → exit 0 (no output)
- `npm audit --audit-level=high` → 0 vulnerabilities
- `node -e "require('./node_modules/electron/package.json').version"` → `42.3.3`

**Deviations**: None. Upgrade was entirely clean — no type errors, no runtime breakage, no sendSync migration, no peer deps required.

---

## Decisions

**Leg 2 — sendSync KEEP decision (2026-06-05)**: `ipcRenderer.sendSync('shields-farble', ...)` runs silently on Electron 42 with no deprecation warning and returns the farble config correctly. The document-start timing guarantee is preserved. No migration to async `invoke` was performed — doing so would arrive too late relative to page script execution and degrade the fingerprint farble security property. Decision: keep `sendSync` as-is.

---

## Deviations

---

## Anomalies

---

### Leg 4: ci-gates-and-audit (2026-06-05)

**Status**: landed

**Change**: Inserted four named steps into `.github/workflows/ci.yml` between "Install dependencies" (`npm ci`) and "Package (no installers)" (`npx electron-builder --linux --dir`):
- Unit tests → `npm test`
- Type check → `npm run typecheck`
- Lint → `npm run lint`
- Dependency audit → `npm audit --audit-level=high`

YAML validated via `python3 yaml.safe_load` — parses clean. Existing structure (triggers, concurrency, setup-node node 20 + npm cache, package step) unchanged.

**Local gate results**:
- `npm test` → 147 pass, 0 fail, 0 skip
- `npm run typecheck` → exit 0, 0 errors
- `npm run lint` → exit 0 (no output)
- `npm audit --audit-level=high` → "found 0 vulnerabilities"

**Deviations**: None.

---

## Session Notes

### Leg 3: verify-upgrade-behavior — completed (2026-06-05) — Flight-Director-run

Built the `core-browsing-shields` HTTP fixture; launched the **E42** app (`dev:debug`, Electron 42.3.3 confirmed via CDP); served both fixtures; ran two behavior tests via consolidated Witnessed (Executor `abbb…` drove raw CDP, Validator `a725…` judged).

- **`core-browsing-shields`: PASS 5/5** (run log `tests/behavior/core-browsing-shields/runs/2026-06-05-17-43-36.md`) — clean launch on E42, navigation/render (example.com), **tracking-param strip** (`?utm_source=test&q=keep` → `?q=keep`), **tracker block** (privacy panel: "ANALYTICS (1) / BLOCKED / google-analytics.com"), multi-tab (4 webviews). → spec promoted **`draft → active`**.
- **`tab-scheme-guard`: key F1 vectors PASS 4/4** (run log `…/tab-scheme-guard/runs/2026-06-05-17-43-36.md`) — in-page `will-navigate` file: blocked, `window.open` file: blocked, https control opens. **F1 holds on E42.** Spec stays `draft` (this re-run exercised the key vectors, not the full spec; Step-6 refinement still pending — mission Known Issue).
- **Net runtime verdict**: the 9-major Electron upgrade did **not** regress core browsing, the Shields/`webRequest` privacy pipeline, or the F1 hostile-URL guard. Combined with Leg 2's zero-code-change result, the upgrade is clean end-to-end.
- Background app + fixture servers stopped (TaskStop).
