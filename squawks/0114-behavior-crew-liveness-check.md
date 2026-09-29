# Squawk 0114: Behavior-test crew — check process liveness with `ps -p`, not a grep

**Status**: deferred
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-29
**Completed**: —

## Report
In the `default-browser-handoff` run, the Executor's process-absence poll grepped for `dev-launch` and matched its own polling shell's command line, producing a false "second process" reading (step 8). With the single-instance lock, a relaunch against a still-dying instance now hands off and exits, so reliable liveness checks matter more.

## Evidence
`tests/behavior/default-browser-handoff/runs/2026-09-29-21-01-11.md` — checkpoint 8 Validator notes. `.flightops/agent-crews/behavior-tests-execution.md` "Project Apparatus Notes (goldfinch)" has no liveness guidance. Sortie 01 flight debrief, Methodology Observation 5.

## Corrective Action
*(written at completion)*

## Verification

## Sign-Off
*(written at completion)*

## Disposition
**Deferred**: doc-only — revisit at the next squawk turnaround or before the next relaunch-based behavior test (add one bullet: confirm liveness with `ps -p <pid>` on the recorded electron PID or filter on the electron main binary; never `grep` the launcher name).
