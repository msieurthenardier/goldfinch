# Squawk 0133: Restart now: no in-flight latch, and the lock isn't re-acquired if relaunch fails

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: —

## Report
`restartToApply()` has no in-flight guard. Two activations before quit completes (panel plus settings page, or two windows) both pass the business gate, because the config hasn't changed, and both call `app.relaunch`. Electron starts one instance per call, and the second races the first for the now-released lock. Separately, if `app.relaunch`/`app.quit` throws after `app.releaseSingleInstanceLock()`, the running app keeps going without the lock.

Fix:
- a module-level `restarting` flag that returns `{ ok:false, reason:'in-progress' }` on re-entry;
- `requestSingleInstanceLock()` again in a `catch` around relaunch/quit.

Unit-test both. *Note: this touches a lifecycle path. If the fix needs more than the latch and re-acquire, escalate to a sortie (squawk criterion 3).*

## Evidence
`src/main/register-settings-ipc.js:57` `function restartToApply()` → `:63` `app.releaseSingleInstanceLock();` → `:64` `app.relaunch(...)` → `:65` `app.quit();`. Sortie 02 debrief, Architect input (Recommendation 5).

## Corrective Action
*(written at completion)*

## Verification
*(written at completion)*

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
