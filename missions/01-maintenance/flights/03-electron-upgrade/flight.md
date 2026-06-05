# Flight: Dependency Currency — Electron Major Upgrade

**Status**: completed
**Mission**: [Codebase Health — 2026-06-05 Maintenance](../../mission.md)

## Contributing to Criteria
- [x] F2 — Electron upgraded to a current major; webview/session behavior re-verified
- [x] F21 — CI runs a dependency-audit step
- [x] Carry-forward — `jsconfig` `moduleResolution` → `"bundler"` (drop `ignoreDeprecations`)
- [x] Carry-forward (pulled from Flight 4) — `ci.yml` enforces the test/typecheck/lint quality gates

## Pre-Flight

### Objective
Bring the shipped Electron runtime current — **33.4.11 → 42.3.3** (9 majors) — to pick up Chromium/Electron security fixes reachable by hostile web content, using `npm run typecheck` as the type-level regression net and **behavior tests** as the runtime regression net (the upgrade's real risk is the live `session.webRequest`/webview/Chromium layer that unit tests can't observe). Also resolve the `jsconfig` `moduleResolution` debt first, and operationalize the quality floor in CI (F21 audit + the test/typecheck/lint gates pulled forward from Flight 4).

### Open Questions
- [x] Upgrade path? → Design Decisions (direct to latest 42).
- [x] Runtime verification approach? → Design Decisions (behavior tests only — `core-browsing-shields` + re-run `tab-scheme-guard`; no HAT).
- [x] electron-builder + CI scope? → Design Decisions (bump builder 25→26; F21 audit + pull the test/typecheck/lint gates forward).

### Design Decisions

**Upgrade path — direct to latest (42)**: bump `electron ^33.2.0 → ^42.3.3` and `electron-builder ^25.1.8 → ^26.8.1` in one step.
- Rationale: small app (9 source files), and the type-checker + behavior tests are a strong net. Stepwise (9 majors) is disproportionate; a direct jump + hard verification is the right cost/benefit.
- Trade-off: if something breaks, the failing major isn't auto-pinpointed — mitigated by typecheck (type-level) + behavior tests (runtime) catching it, then bisecting only if needed.

**moduleResolution → bundler, FIRST (debrief carry-forward)**: switch `jsconfig.json` `moduleResolution:"node"` → `"bundler"` and drop `ignoreDeprecations:"6.0"` **before** the Electron bump, as its own leg.
- Rationale: TS6 hard-deprecates `"node"`; `"bundler"` is the durable mode for this ES2022/CJS-via-require checker setup. Doing it first means any type error after the bump is attributable to the Electron API change, not the resolution change. Verify `npm run typecheck` stays 0 errors at this step (no Electron change yet).

**Runtime verification — behavior tests only (operator choice)**: the acceptance gate is two CDP-driven behavior tests run against the upgraded app, no HAT.
- `core-browsing-shields` (authored as `draft` this flight, `tests/behavior/core-browsing-shields.md`): app launches, navigation/render works, Shields still **block a known tracker** and **strip tracking params**, multi-tab works — the live `session.webRequest` behaviors the upgrade most threatens.
- Re-run `tab-scheme-guard` (existing): confirms the F1 hostile-URL guard still holds post-upgrade.
- **Apparatus (premise-audited, both axes)**: raw CDP over the Node WebSocket against the running Electron `:9222` (the approach proven in Flight 2 — chrome-devtools MCP launches its own browser, so it cannot attach to the app). **Act**: navigate tabs, open the served fixture, trigger the schemes — via Runtime.evaluate on the renderer page (`createTab(...)`) and on the guest target. **Observe (read path)**: CDP `/json` target urls + the renderer's per-tab privacy aggregate (the `privacy-net` IPC payload stored in the renderer; readable via the privacy panel DOM or `Runtime.evaluate` of the tab's privacy state) for the tracker-blocked count, and the webview `src`/address-bar for navigation/param-strip. Both surfaces exist today.
- **Residual risk (accepted)**: farbling, downloads-to-disk, and container cookie-isolation are deeper runtime behaviors not covered by these smoke gates — flagged in the `core-browsing-shields` Out of Scope. A fuller privacy behavior suite is a future spec.

**electron-builder bump + CI scope (operator choice)**: bump `electron-builder` to 26 (needed for E42 packaging compatibility), add an `npm audit` step (F21), AND pull the **test/typecheck/lint gates** into `ci.yml` now (the Flight 2 debrief had assigned these to Flight 4 — consolidating here since we're already editing `ci.yml`). Flight 4's scope narrows to the supply-chain hardening (permissions, SHA-pins, release gating).

**`sendToHost` (debrief carry-forward) — confirmed non-issue**: design review confirmed `ipcRenderer.sendToHost` (`webview-preload.js:175,219`) is non-deprecated through E42 (the debrief's "deprecated since E28 → sendToFrame" conflated it with the unrelated `webContents.sendToFrame`). No migration. **The real deprecation is `ipcRenderer.sendSync`** (the farble handshake, `:231`) — handled in Leg 2.

**Leg 1 `bundler` + `commonjs` — confirmed compatible**: design review tested `moduleResolution:"bundler"` + `module:"commonjs"` + `noEmit:true` + `checkJs:true` live → 0 errors. (The "bundler requires module:esnext" rule only applies to *emitting*; this is a noEmit checker.) Leg 1's acceptance holds.

### Prerequisites
- [x] Flights 1 & 2 merged to `main`; quality gates (`npm test` 147, `npm run lint`, `npm run typecheck`) green on `main` (recon).
- [x] The behavior-test runtime needs the GUI app to launch via `dev:debug` (:9222) + a served HTTP fixture for `core-browsing-shields`. WSLg present (proven in Flight 2). Verified at leg time.
- [x] Network access for `npm install electron@42` (large download) and for the behavior test's `example.com` / tracker-domain requests.

### Pre-Flight Checklist
- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified (behavior-test runtime confirmed feasible in Flight 2)
- [x] Validation approach defined (typecheck net + `core-browsing-shields` + `tab-scheme-guard` behavior tests + CI gates)
- [x] Legs defined

## In-Flight

### Technical Approach

Four legs, dependency-ordered: fix the resolution debt → bump → verify runtime → operationalize CI.

- **Leg 1 — `moduleResolution-bundler` (debt fix, pre-bump).** In `jsconfig.json` set `moduleResolution:"bundler"` and remove `"ignoreDeprecations":"6.0"`. No Electron change yet. Acceptance: `npm run typecheck` → 0 errors (proves the resolution switch alone is clean and the Electron-33 types still resolve under `bundler`). `npm test`/`lint` unaffected.
- **Leg 2 — `electron-upgrade` (F2; the big leg, may sub-split).** Bump `electron ^33.2.0 → ^42.3.3` and `electron-builder ^25.1.8 → ^26.8.1` in `package.json`; `npm install`. Then run `npm run typecheck` — it surfaces any changed `Electron.WebviewTag`/`Session`/IPC signatures at the `renderer-globals.d.ts`/`session-augments.d.ts`/`renderer.js` cast sites; fix with updated annotations (the typedefs/casts are the regression net). Launch the app (`dev:debug`) and watch the console; fix any runtime breakage in `main.js` (webview attach, `session-created`/`webRequest` wiring, downloads, permission handler) and the preloads.
  - **`ipcRenderer.sendSync` landmine (design-review catch — the most likely runtime-visible change)**: the farble handshake at `webview-preload.js:231` uses `ipcRenderer.sendSync('shields-farble', …)` at document-start. `sendSync` is deprecated since Electron 28 and on E42 likely logs a deprecation warning on every webview load. **Check the console**; if present, migrate to async: add `ipcMain.handle('shields-farble', …)` in `main.js` and change the preload to `await ipcRenderer.invoke('shields-farble', …)` inside an `async` IIFE (note: this changes farble from sync-at-document-start to async — verify the fingerprint hooks still install before page scripts run, or keep a sync path if timing breaks). `ipcRenderer.sendToHost` (`:175,:219`) is **confirmed non-deprecated** through E42 — no migration.
  - **Audit checkpoint**: after the bumps, run `npm audit --audit-level=high` locally — it should return **0 highs** (the bumps clear the electron CVEs + the tar-via-electron-builder chain). Confirm this *before* Leg 4 wires the gate into CI.
  - **Builder check**: run `npx electron-builder --linux --dir` once after the bump — the current `build` block (oneClick:false, asar:false, identity:null, nsis) has no known eb26 breakers, but confirm packaging succeeds.
  - Acceptance: `npm run typecheck`/`test`/`lint` green; `npm audit --audit-level=high` 0 highs; app launches and the renderer + a webview target are reachable via CDP. Sub-split if needed: (a) deps bump + typecheck-fix, (b) runtime-fix (incl. sendSync if needed).
- **Leg 3 — `verify-upgrade-behavior` (F2 runtime gate).** Build the `core-browsing-shields` HTTP fixture (`tests/behavior/fixtures/core-browsing-shields/` — a page referencing a known tracker domain + carrying `utm_*` params). Run `/behavior-test core-browsing-shields` and `/behavior-test tab-scheme-guard` against the upgraded app. Acceptance: both pass (core browsing + Shields blocking/stripping confirmed live; F1 still holds). On green, promote `core-browsing-shields` `draft → active`. (Also refine + re-run `tab-scheme-guard` Step 6 if convenient — the standing mission Known Issue — but that's optional here.)
- **Leg 4 — `ci-gates-and-audit` (F21 + pulled-forward gates).** Edit `.github/workflows/ci.yml`: after `npm ci`, add `npm test` → `npm run typecheck` → `npm run lint` → `npm audit --audit-level=high` (F21), then the existing `electron-builder --linux --dir`. **Audit policy**: the Leg 2 checkpoint verifies `npm audit --audit-level=high` is 0 highs post-bump — only wire the `high` gate in if so; if any highs remain (unexpected transitive deps), gate on `--audit-level=critical` instead, document the residual highs, and file a follow-up. Acceptance: a CI run on the PR passes all new steps (the gates are fast, deterministic, no GUI).

### Checkpoints
- [x] `moduleResolution:"bundler"`; typecheck still 0 errors (Leg 1)
- [x] Electron 42 + builder 26 installed; typecheck/test/lint green; app launches (Leg 2)
- [x] `core-browsing-shields` + `tab-scheme-guard` behavior tests pass on the upgraded app (Leg 3)
- [x] `ci.yml` runs test/typecheck/lint/audit; PR CI green (Leg 4)

### Adaptation Criteria

**Divert if**:
- The Electron 42 bump breaks a webview/session API in a way that needs a non-trivial redesign (not just an annotation/wiring fix) — carve the redesign into its own leg and record in the log.
- The app cannot launch on E42 in this environment (GUI/sandbox) — fall back to fixture-delivery + deferred behavior runs (as in Flight 2), flagged.
- `electron-builder` 26 requires config changes beyond the version bump (the `build` block in `package.json`) — handle as a sub-step with the change documented.

**Acceptable variations**:
- Sub-splitting Leg 2 (deps+typecheck vs runtime-fix).
- Landing on a slightly-older 42.x patch if the very latest is unstable.

### Legs

> Tentative — planned one at a time during execution. Dependency-ordered.

- [x] `moduleResolution-bundler` - jsconfig debt fix (pre-bump); typecheck stays 0 errors
- [x] `electron-upgrade` - F2: bump electron 33→42 + electron-builder 25→26; typecheck-fix + runtime-fix (may sub-split)
- [x] `verify-upgrade-behavior` - build fixture + run `core-browsing-shields` & `tab-scheme-guard`; promote the new spec `active`
- [x] `ci-gates-and-audit` - F21 audit + test/typecheck/lint gates in `ci.yml`

## Post-Flight

### Completion Checklist
- [x] All legs completed
- [ ] Code merged
- [x] `npm run typecheck`/`test`/`lint` green; `npm audit` reviewed
- [x] Behavior tests `core-browsing-shields` + `tab-scheme-guard` passing on E42; `core-browsing-shields` promoted `active`
- [x] CLAUDE.md/README updated if the Electron version or dev commands changed materially

### Verification
- **Type-level**: `npm run typecheck` clean on Electron 42 types (the WebviewTag/Session/IPC regression net).
- **Runtime (behavior)**: `/behavior-test core-browsing-shields` (launch + navigation + Shields block/strip + multi-tab) and `/behavior-test tab-scheme-guard` (F1 hostile-URL guard) both pass against the upgraded app.
- **Currency**: `npm outdated` shows Electron on a current major; `npm audit` high-severity count reviewed.
- **CI**: a PR run exercises the new `ci.yml` gates (test/typecheck/lint/audit) green.
