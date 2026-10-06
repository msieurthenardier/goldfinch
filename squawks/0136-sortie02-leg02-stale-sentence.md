# Squawk 0136: Sortie 02 leg 02 artifact keeps one stale pre-amendment sentence

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: —

## Report
Leg 02's Outputs still contains the pre-Round-2 sentence describing the restart order without `releaseSingleInstanceLock()`, which contradicts Round 2 amendment R2-1 and the shipped code. Strike it or rewrite it to the shipped order (env strip → release lock → relaunch → quit), so the artifact can't mislead a future reader.

## Evidence
`sorties/02-partitioned-cookie-isolation/legs/02-isolation-panel-ux.md:69` — "On pass they delete `GOLDFINCH_AUTOMATION_DEV_MINT` from `process.env`, c…"; shipped order at `src/main/register-settings-ipc.js:57-65`.

## Corrective Action
*(written at completion)*

## Verification
*(written at completion)*

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
