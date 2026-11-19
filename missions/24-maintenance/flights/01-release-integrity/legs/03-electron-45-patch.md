# Leg: electron-45-patch

**Status**: completed
**Flight**: [Release Integrity](../flight.md)

## Objective

Move the runtime to the current Electron 45 release, **45.4.1** (latest on the 45 line, checked 2026-11-19; 45.3.4 is the previous patch). Then re-run the gates CLAUDE.md requires after every Electron bump: the full store suite, and the `third-party-cookie-isolation` behavior spec.

## Context

- **Maintenance finding #9; mission criterion:** "the runtime is on the current Electron 45 patch (45.3.4 or later)".
- **Why 45.4.1, not 45.3.4:** it is the current 45 release and carries the newer Chromium security backports. It stays on the 45 major, so the Dependabot "major bump" behavior gates (`core-browsing-shields`, `tab-scheme-guard`) are not formally required, but they are cheap to run.
- **Divert:** if 45.4.1 fails the isolation spec or the store suite, fall back to 45.3.4 and record why.
- **The pin:** `package.json` pins `"electron": "45.3.3"` exactly (with `package-lock.json`). No source or test file pins the version string; the only hit for "45.3.3" in `src/` is a historical measurement comment in `register-update-ipc.js`, which stays.
- **CLAUDE.md *App database* rule:** "every Electron major bump re-runs the full store suite, and re-runs the `third-party-cookie-isolation` behavior spec". The reason is that an unknown `enable-features` name is silently ignored, so a bump that dropped the feature would make third-party cookie isolation fail open. This is a minor bump; run both anyway.
- **CLAUDE.md** cites measurements "on Electron 45.3.2/45.3.3" in several places. They are historical and stay unedited. Only update a CLAUDE.md or docs statement that names the CURRENT runtime version, if any (grep).

## Acceptance Criteria

- [ ] `package.json` has `"electron": "45.4.1"` (exact). `package-lock.json` is updated by `npm install electron@45.4.1 --save-exact` (or the equivalent), and `npm ls electron` shows 45.4.1.
- [ ] `npm test` (which contains the store suites: app-db, settings-store, history-store, bookmarks-store, the vault-store suites) passes. `lint`, `typecheck` and `format:check` are green. `npm audit --audit-level=high` shows no NEW advisory beyond the known `picomatch` one (record the count).
- [ ] A dev launch reports Electron 45.4.1: `evaluate` on the chrome `process.versions.electron` (or the About page's version line, or main's log), recorded in the flight log.
- [ ] **The `third-party-cookie-isolation` behavior spec passes on 45.4.1.** The Flight Director runs it via `/mission-control:behavior-test third-party-cookie-isolation` after this leg lands, and the run log is committed. The leg does not complete while it fails.
- [ ] A live smoke runs every existing primitive on 45.4.1 (`enumerateWindows`, `enumerateTabs`, `openTab`, `captureWindow`, `captureScreenshot`, `evaluate`, `readDom`), then quits cleanly.

## Verification Steps

- `npm ls electron`
- `timeout 300 npm test && npm run lint && npm run typecheck && npm run format:check`
- `npm audit --audit-level=high` (expected: the 9 known `picomatch` highs only)
- The live smoke and the version read.
- The behavior spec run (Flight Director).

## Edge Cases

- **`npm install` touches unrelated packages:** keep the lockfile diff to Electron and its own dependencies. If more moves, record it.
- **The fuse layout changes in a new Electron:** `scripts/check-fuses.mjs` pins the fuse table and runs after packing. Run `npm run pack` and `node scripts/check-fuses.mjs <binary>` once, and record the result. This needs no signing.

## Files Affected

- `package.json`, `package-lock.json`; possibly CLAUDE.md or docs if any names the current runtime version.

## Citation Audit

Checked 2026-11-19 on `main` @ 22304bf: `package.json` has `"electron": "45.3.3"` (:117). `npm view electron@45 version` lists 45.3.4 and 45.4.1. The "45.3.3" string in `src/` occurs only in `register-update-ipc.js:118` (a comment).
