# Squawk 0002: Windows taskbar pin lost on update — app never claims its AppUserModelID

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-08
**Completed**: 2026-08-08

## Report

On Windows, pinning the installed app to the taskbar survives a normal quit/relaunch but
**not** an installer-driven update. After running a new installer, the pin is gone.

Cause: the app never calls `app.setAppUserModelId()`. electron-builder stamps the build
`appId` onto the shortcut it creates, but the running process doesn't claim the same
identity, so Windows can't reconcile the pin when NSIS does its uninstall-then-reinstall
swap. Matches the canonical electron-builder reports (#1293, #926, #2514).

This is the OS taskbar pin, **not** goldfinch's in-app `toolbarPins` — that state is
robust and was ruled out during triage.

Tracked as GitHub issue #65.

## Evidence

The app makes no identity claim:

```
$ grep -rn "setAppUserModelId" src/
(no matches)
```

The build declares one that nothing matches at runtime:

```
package.json:28 —     "appId": "com.goldfinch.browser",
```

## Corrective Action

Added an `if (process.platform === 'win32') { app.setAppUserModelId('com.goldfinch.browser'); }`
call to `src/main/main.js`, at module load — immediately after the existing
`protocol.registerSchemesAsPrivileged([...])` call. That call is the project's
established precedent for "must run before app.ready / before any window," so the fix
follows the same placement discipline rather than inventing a new convention. Module-load
placement also means it runs before `registerAppLifecycle(...)` is even called (the
function that wires `app.whenReady().then(...)`, inside which `app-lifecycle.js` makes the
first `createWindow()` call for both the session-restore and fresh-boot branches) — so it
is unconditionally ahead of every path that creates a window, not just the common one.
This does not touch `init-profile.js`'s `app.setPath('userData', …)`-before-`appDb.open`
ordering invariant: `setAppUserModelId` has no dependency on and no interaction with the
userData path, appDb, or any store.

Considered and rejected: deriving the id from `package.json` at runtime
(`require('../../package.json').build.appId`) instead of hardcoding the literal. Rejected
because main.js has no existing "read build config at runtime" pattern, and the project
ships with `asar:false` + an explicit `files` allowlist (`src/**/*`, `package.json`) — a
relative `require()` reaching outside `src/` from the composition root works today but adds
a packaging-layout dependency for a one-line string that has no other reason to change
independently of a full appId migration (itself a decision, not a squawk-sized edit). Went
with the hardcode-plus-drift-test option the squawk explicitly allowed instead: the literal
is pinned against `package.json`'s `build.appId` by a dedicated test
(`test/unit/app-user-model-id.test.js`) that builds its expected string from the *parsed*
JSON value rather than a second hand-typed copy, so a future appId change that isn't
mirrored into `main.js` fails loudly in `npm test` instead of drifting silently.

## Verification

- `test/unit/app-user-model-id.test.js` added (source-scan pin, the house pattern for
  `main.js` — it can't be `require()`'d directly under plain `node --test`: it pulls in real
  Electron classes like `BaseWindow` that the test `electron` stub doesn't provide, and its
  top-level code has app-wide side effects). Three assertions:
  1. `main.js` contains `app.setAppUserModelId('<build.appId>')` with the exact literal read
     from `package.json` at test time (not retyped) — proves the two can't drift.
  2. The call is immediately guarded by `if (process.platform === 'win32') {`.
  3. The call's source position precedes `registerAppLifecycle(...)` in `main.js` (the call
     that wires `app.whenReady()`, inside which `app-lifecycle.js` calls `createWindow()`),
     with a sanity check that `app-lifecycle.js` really does call `createWindow()` after
     `app.whenReady()` — guarding against the ordering assertion passing vacuously on the
     wrong pair of markers.
- Sanity-checked the test has teeth: temporarily mutated the literal in `main.js` to
  `com.wrong.id`, re-ran the suite — assertion 1 failed (`not ok`) as expected, assertions 2
  and 3 stayed green; reverted immediately after (`git diff --stat` confirmed a clean
  restore, only the intended 19-line addition remained).
- `timeout 120 npm test` → `# tests 3661 / # pass 3661 / # fail 0 / # cancelled 0` — full
  suite green, no regressions, run well under the timeout (~3.4s reported duration).
- `npx eslint src/main/main.js test/unit/app-user-model-id.test.js` → no output, clean.
- `npm run typecheck` (`tsc --noEmit -p jsconfig.json`) → no output, clean.
- **Not verified here — requires a real Windows machine**: the actual taskbar-pin behavior
  (pin an installed build, run a newer installer over it, confirm the pin survives). This
  fix addresses the documented root cause (electron-builder #1293, #926, #2514 — the running
  process must claim the shortcut's AppUserModelID for Windows to reconcile the pin across
  NSIS's uninstall-then-reinstall swap) but the end-to-end confirmation needs a manual
  install → update → observe-taskbar cycle on Windows, which this environment cannot run.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the implementer's reasoning)
**Verdict**: confirmed

Confirmed on first review and re-confirmed unchanged in each subsequent round while the
sibling squawk iterated. The reviewer independently traced every `createWindow(` call site
— all three in `src/main/app-lifecycle.js`, all inside `app.whenReady().then(...)`, only
reachable via `registerAppLifecycle(...)` — and verified the new call at module load
precedes all of them, with no interaction with `init-profile.js`'s
`setPath`-before-`appDb.open` invariant. The drift test was mutation-checked three ways
(wrong literal, defeated win32 guard, call moved after `registerAppLifecycle`); each
assertion failed as intended.

**Residual**: the taskbar-pin behavior itself is unverified — it needs a manual Windows
install → update → observe cycle, which no test here can run. The fix addresses the
documented root cause; confirmation is an operator step.

**Commit**: `squawk/turnaround-2026-08-08`
