# Squawk 0017: Dev-profile `userData` redirect runs after `app.whenReady` — child processes carry the real profile

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

GitHub issue #121. `app.setPath('userData', …-dev)` runs inside `app.whenReady().then(...)`, later than Electron's documented guidance, so the browser process resolves its startup `--user-data-dir` from the default profile and Chromium child processes still carry the real profile's path. Move the `!app.isPackaged` `setPath` to `main.js` module scope beside `registerSchemesAsPrivileged`/`setAppUserModelId` (squawk 0002 set the placement precedent); keep store ordering in `init-profile.js`. Pin with a source-order test in the house style (`test/unit/app-user-model-id.test.js`) and adjust the existing `init-profile` ordering-invariant test.

Source: maintenance report 2026-08-27, finding F42.

## Evidence

- `src/main/app-lifecycle.js:160-161` — `app.whenReady().then(() => { initProfileAndStores(app, profileStores); … })`
- `src/main/init-profile.js:49-50` — the `app.setPath('userData', …)` call
- `src/main/main.js` — no module-scope `setPath`

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
