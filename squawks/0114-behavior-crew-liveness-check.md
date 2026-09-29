# Squawk 0114: Behavior-test crew — check process liveness with `ps -p`, not a grep

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-29
**Completed**: 2026-09-29

## Report
In the `default-browser-handoff` run, the Executor's process-absence poll grepped for `dev-launch` and matched its own polling shell's command line, producing a false "second process" reading (step 8). With the single-instance lock, a relaunch against a still-dying instance now hands off and exits, so reliable liveness checks matter more.

## Evidence
`tests/behavior/default-browser-handoff/runs/2026-09-29-21-01-11.md` — checkpoint 8 Validator notes. `.flightops/agent-crews/behavior-tests-execution.md` "Project Apparatus Notes (goldfinch)" has no liveness guidance. Sortie 01 flight debrief, Methodology Observation 5.

## Corrective Action
Added one bullet, "Process liveness / absence checks", to `.flightops/agent-crews/behavior-tests-execution.md` "Project Apparatus Notes (goldfinch)", right after the out-of-band relaunch bullet: check liveness with `ps -p <pid>` on the recorded electron main PID (or filter `ps` on the electron main binary path), never `grep` the launcher name; a relaunch must first confirm the old PID is gone because of the single-instance lock. Cites the checkpoint 8 precedent. No other crew-file content changed.

## Verification
Doc-only. `npm run format` then `npm run format:check` green; `git diff` on the crew file shows only the one added bullet.

## Sign-Off
**Reviewer**: independent Reviewer agent (batch review scoped to the diff; `npm test` 5749 pass / 0 fail, lint, typecheck, format:check clean)
**Verdict**: confirmed
**Commit**: the `squawk: turnaround 2026-09-29` commit on `squawk/turnaround-2026-09-29-2`

## Disposition
*(Deferred at logging during Sortie 01; completed in the same-day turnaround.)*