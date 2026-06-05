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

---

## Decisions

---

## Deviations

---

## Anomalies

---

## Session Notes
