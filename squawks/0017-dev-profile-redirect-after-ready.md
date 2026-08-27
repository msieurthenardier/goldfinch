# Squawk 0017: Dev-profile `userData` redirect runs after `app.whenReady` — child processes carry the real profile

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: 2026-08-27

## Report

GitHub issue #121. `app.setPath('userData', …-dev)` runs inside `app.whenReady().then(...)`, later than Electron's documented guidance, so the browser process resolves its startup `--user-data-dir` from the default profile and Chromium child processes still carry the real profile's path. Move the `!app.isPackaged` `setPath` to `main.js` module scope beside `registerSchemesAsPrivileged`/`setAppUserModelId` (squawk 0002 set the placement precedent); keep store ordering in `init-profile.js`. Pin with a source-order test in the house style (`test/unit/app-user-model-id.test.js`) and adjust the existing `init-profile` ordering-invariant test.

Source: maintenance report 2026-08-27, finding F42.

## Evidence

- `src/main/app-lifecycle.js:160-161` — `app.whenReady().then(() => { initProfileAndStores(app, profileStores); … })`
- `src/main/init-profile.js:49-50` — the `app.setPath('userData', …)` call
- `src/main/main.js` — no module-scope `setPath`

## Corrective Action

Moved the `!app.isPackaged` dev-profile `app.setPath('userData', …)` redirect out of
`initProfileAndStores` (called inside `app.whenReady().then(...)`) and into
`src/main/main.js` MODULE SCOPE, immediately after the existing `setAppUserModelId`
block (`src/main/main.js:192-231`, guard `if (!app.isPackaged) { app.setPath('userData',
devUserDataPath(app.getPath('userData'))); }`) — the same pre-ready placement discipline
`registerSchemesAsPrivileged` and squawk 0002's `setAppUserModelId` already use. This
runs before `app.whenReady()` resolves, so Electron resolves the browser process's (and
every Chromium child process's) `--user-data-dir` from the `-dev` path from the start,
fixing the issue-#121 symptom (child processes still carrying the real profile's
`--user-data-dir`).

Reused the existing path-derivation helper — added
`const { devUserDataPath } = require('../shared/dev-profile');` (`src/main/main.js:30`)
rather than duplicating the `-dev` suffix logic.

`src/main/init-profile.js` (`initProfileAndStores`) no longer performs the redirect; it
now starts directly with `appDb.open(app.getPath('userData'))`
(`src/main/init-profile.js:41-47`), trusting that `app.getPath('userData')` already
reflects the redirect set upstream in `main.js`. Store ordering (`appDb.open` before the
five `shields`/`settings`/`jars`/`downloads`/`bookmarks` loads) is unchanged — that
invariant lives entirely in this module still. The JSDoc `app` param type was narrowed
from `{ isPackaged, setPath, getPath }` to `{ getPath }` since `isPackaged`/`setPath` are
no longer read here.

Added `test/unit/dev-profile-redirect-order.test.js`, a source-scan pin in the house
style of `test/unit/app-user-model-id.test.js` (squawk 0002's precedent — `main.js` can't
be `require()`'d directly under plain `node --test`). Four assertions: (1) `main.js`
contains the exact `app.setPath('userData', devUserDataPath(app.getPath('userData')))`
call; (2) it is guarded by `if (!app.isPackaged) {` with nothing else between guard and
call; (3) its source position precedes `registerAppLifecycle(...)` — the call that wires
`app.whenReady()` and, inside it, `initProfileAndStores`/the first `createWindow()` — with
a sanity check that `app-lifecycle.js` really does call `initProfileAndStores` after
`app.whenReady()` (guards against a vacuous pass on the wrong pair of markers); (4)
`main.js` requires `../shared/dev-profile` (pins the reuse, not a duplicate).

Adjusted `test/unit/init-profile-order.test.js` (the existing `init-profile` ordering
invariant test) so it no longer asserts a `setPath` step inside `initProfileAndStores` —
that assertion would now fail (correctly) since the redirect moved out of this module.
The fake `app` in `makeWorld()` now exposes only `getPath` (returning a fixed,
already-`-dev`-suffixed path, standing in for what `main.js` would have set upstream)
and the test asserts `appDb.open` precedes every store-load consumer, which is the
invariant this module still owns. The file's header comment was updated to point at the
new `dev-profile-redirect-order.test.js` for the moved placement's own pin, and the
"packaged / unpackaged" split was removed since `isPackaged`-branching is no longer this
module's concern.

## Verification

- `timeout 180 npm test` → `# tests 3795 / # pass 3795 / # fail 0 / # cancelled 0`,
  duration ~3.2s. Includes the new `dev-profile-redirect-order.test.js` (4 assertions)
  and the adjusted `init-profile-order.test.js` (2 tests).
- `npm run lint` → clean, no output.
- `npm run typecheck` → clean, no output.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the Developers' reasoning) — one review round, clean on the first pass; batch turnaround 2026-08-27 (batch 1)
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-27 (batch 1)` on `squawk/turnaround-2026-08-27-1` (PR number recorded on the PR itself)

Batch gates at review: 3825/3825 tests, lint clean, typecheck clean.
