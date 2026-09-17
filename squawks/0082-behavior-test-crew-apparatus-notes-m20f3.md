# Squawk 0082: Behavior-test crew file — nine apparatus facts from the M20 F3 acceptance run

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-17
**Completed**: —

## Report

The `crash-and-hang-surfaces` Witnessed run (2026-09-17) rediscovered nine
rig facts live that belong in `.flightops/agent-crews/behavior-tests-execution.md`'s
"Project Apparatus Notes (goldfinch)": (1) with `crashReporter` active,
`kill -SEGV`/`-ABRT` do not crash a SANDBOXED guest renderer — only
`-KILL` does (go straight to KILL); (2) `captureWindow`/`captureScreenshot`
time out (`capture-timeout`) against a `SIGSTOP`ped renderer — a stopped
guest's visibility is a `[by-eye]` observable; (3) a SEGV on the unsandboxed
chrome takes ~15 s to register (Crashpad's in-process handler) — corroborate
a chrome crash by the `chromePid` change, not by catching `booted: false`;
(4) `openTab` returns a bare number (the wcId); (5) `navigate` right after
`openTab` can race the still-loading page — poll until url/loadState/pid
stabilise; (6) same-origin, same-jar tabs are not guaranteed to share a
renderer, and when they do, one kill crashes both; (7) a wedged
`enumerateTabs` against a window with no live chrome was a PRODUCT defect
(fixed) — `enumerateWindows` stays fast and is the liveness proof; set an
explicit short client timeout in doubtful states; (8) any value read only
after a polling loop ends must be saved as its own evidence file; (9) the
window topology renumbers totally after a relaunch — re-resolve THE window by
`lastFocused`.

## Evidence

- `tests/behavior/crash-and-hang-surfaces/runs/2026-09-17-00-22-28.md` — Orchestrator Notes; Closing Summaries (Executor closing 1–9;
  Validator closing).

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
