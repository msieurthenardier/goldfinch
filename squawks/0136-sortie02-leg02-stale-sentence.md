# Squawk 0136: Sortie 02 leg 02 artifact keeps one stale pre-amendment sentence

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: 2026-10-06

## Report
Leg 02's Outputs still contains the pre-Round-2 sentence describing the restart order without `releaseSingleInstanceLock()`, which contradicts Round 2 amendment R2-1 and the shipped code. Strike it or rewrite it to the shipped order (env strip → release lock → relaunch → quit), so the artifact can't mislead a future reader.

## Evidence
`sorties/02-partitioned-cookie-isolation/legs/02-isolation-panel-ux.md:69` — "On pass they delete `GOLDFINCH_AUTOMATION_DEV_MINT` from `process.env`, c…"; shipped order at `src/main/register-settings-ipc.js:57-65`.

## Corrective Action
Rewrote the stale Outputs sentence (leg 02 line 69) to the shipped order: delete `GOLDFINCH_AUTOMATION_DEV_MINT` from the live env, `app.releaseSingleInstanceLock()`, `app.relaunch(relaunchOptions(...))`, `app.quit()`. Scanned the rest of the artifact for pre-amendment wording (`relaunchOptions` returning `env`, `restNode`, signature/rebuild path, main-side `effectiveAfterRestart(shields.get()…`); every other hit is already the corrected/amended form, so nothing else changed.

## Verification
Checked against `src/main/register-settings-ipc.js` `restartToApply` (lines 57-65): delete env, release lock, relaunch, quit. `npm run format:check` run (see handoff).

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the 2026-10-06 turnaround)
**Verdict**: confirmed, no blocking issues (`npm test` x3 green, lint/typecheck/format:check/audit clean). Electron 44.5.0 and SDK 1.31.0 also live-verified by the third-party-cookie-isolation run 2026-10-06-18-13-21 (pass).
**Commit**: the `squawk: turnaround 2026-10-06` commit on `squawk/turnaround-2026-10-06`
