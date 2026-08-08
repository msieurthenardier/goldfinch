# Squawk 0002: Windows taskbar pin lost on update — app never claims its AppUserModelID

**Status**: escalated
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-08
**Completed**: — *(corrective action shipped in v0.13.4 but did not resolve the defect —
see Disposition)*

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

**Commit**: `ca0570f` (PR #159), released in v0.13.4

## Disposition

**Escalated** — the corrective action was implemented, reviewed, and shipped, and the
defect it targeted is still present. The squawk's own recorded residual ("the taskbar
behavior itself is unverified; confirmation is an operator step") came back negative.

### Verification result: FAILED

Operator ran two full cycles on real Windows hardware against the v0.13.4 installer:

1. 0.13.3 installed and pinned to the taskbar → ran the 0.13.4 installer → **the pin
   disappeared midway through the installation** and was still gone once it finished.
2. Re-pinned on 0.13.4 → ran the installer again → **same result**: pin vanished
   mid-install, did not return.

### What this tells us — the original diagnosis was incomplete

The report attributed the loss to the running process never claiming the shortcut's
AppUserModelID. That call now ships (`src/main/main.js:208`) and the pin still dies, so
that hypothesis is falsified as the operative cause.

**The timing is the evidence.** The pin goes during the *install*, not on first launch of
the updated app — that is the NSIS uninstall phase deleting the old shortcut and
executable, and the shell dropping a pin whose target no longer exists. AUMID governs how
Windows *identifies* a running app against a pinned shortcut; it cannot stop the pin's
target being removed, and no runtime call can, because the app is not running at that
moment. The real surface is the installer, not the app.

### The shipped change is retained, not reverted

Normally an escalation confirms no partial changes remain. Deliberately not done here: the
`setAppUserModelId` call is correct independent of this bug — Windows uses the AUMID for
window grouping, jump lists, and toast notification identity — and it is inert with
respect to the failure above. Reverting would give up a real improvement for no gain. It
stays; it is simply not this defect's fix. `test/unit/app-user-model-id.test.js` stays with
it.

### Which criteria the remaining work fails

- **No design decisions** — competing approaches with no obvious winner: a custom NSIS
  include that preserves or restores the pin across the uninstall phase; per-machine vs
  per-user install layout; suppressing shortcut deletion on the update path specifically.
- **Bounded blast radius** — the surface is the installer itself, on every Windows user's
  upgrade path.
- **Verifiable** — no automated coverage is possible; each iteration costs a manual
  install → update → observe cycle on real Windows.

Three of four failed → **flight or mission, not a squawk.**

### Recommended vehicle

A flight, planned together with [#101](https://github.com/msieurthenardier/goldfinch/issues/101)
(signed installers + auto-update via `electron-updater`) rather than independently: moving
to `electron-updater` replaces uninstall-then-reinstall with an in-place update, which
would likely dissolve this failure mode instead of patching around it. Fixing the NSIS path
in isolation risks building something #101 then discards.

GitHub issue [#65](https://github.com/msieurthenardier/goldfinch/issues/65) has been
reopened with this evidence. Link the flight here once it exists.
