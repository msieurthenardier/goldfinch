# Squawk 0133: Restart now: no in-flight latch, and the lock isn't re-acquired if relaunch fails

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: 2026-10-06

## Report
`restartToApply()` has no in-flight guard. Two activations before quit completes (panel plus settings page, or two windows) both pass the business gate, because the config hasn't changed, and both call `app.relaunch`. Electron starts one instance per call, and the second races the first for the now-released lock. Separately, if `app.relaunch`/`app.quit` throws after `app.releaseSingleInstanceLock()`, the running app keeps going without the lock.

Fix:
- a module-level `restarting` flag that returns `{ ok:false, reason:'in-progress' }` on re-entry;
- `requestSingleInstanceLock()` again in a `catch` around relaunch/quit.

Unit-test both. *Note: this touches a lifecycle path. If the fix needs more than the latch and re-acquire, escalate to a sortie (squawk criterion 3).*

## Evidence
`src/main/register-settings-ipc.js:57` `function restartToApply()` → `:63` `app.releaseSingleInstanceLock();` → `:64` `app.relaunch(...)` → `:65` `app.quit();`. Sortie 02 debrief, Architect input (Recommendation 5).

## Corrective Action
`restartToApply()` in `src/main/register-settings-ipc.js` now has a closure-level `restarting` latch set after the business gate passes; re-entry from either channel returns `{ ok:false, reason:'in-progress' }` without touching env/lock/relaunch/quit. Release -> relaunch -> quit is wrapped in try/catch: on a throw it calls `app.requestSingleInstanceLock()` (itself guarded), clears the latch and returns `{ ok:false, reason:'relaunch-failed' }`. DEV_MINT is not restored. The existing non-ok revert+toast paths (privacy-controller `onRestartFailed`, settings.js `restartFailed`) handle the new reasons unchanged; no renderer/IPC/lifecycle changes. Harness gained `requestSingleInstanceLock` and `fail.{relaunch,quit}` switches.

## Verification
New tests in `test/unit/register-settings-ipc.test.js`: second call in flight -> in-progress (both channels), no second relaunch; relaunch-throws and quit-throws -> lock re-requested, latch cleared, DEV_MINT stays deleted, retry proceeds. Neuter-verified: replacing the latch guard with `if (false)` turned the in-flight test red (21 pass / 1 fail); restored -> 22 pass.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the 2026-10-06 turnaround)
**Verdict**: confirmed, no blocking issues (`npm test` x3 green, lint/typecheck/format:check/audit clean). Electron 44.5.0 and SDK 1.31.0 also live-verified by the third-party-cookie-isolation run 2026-10-06-18-13-21 (pass).
**Commit**: the `squawk: turnaround 2026-10-06` commit on `squawk/turnaround-2026-10-06`
