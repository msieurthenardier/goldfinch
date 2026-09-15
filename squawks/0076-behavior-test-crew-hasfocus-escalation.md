# Squawk 0076: Behavior-test crew protocol — a false `document.hasFocus()` under automation is an escalation trigger, not a rig footnote

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-15
**Completed**: —

## Report

During the `navigation-failure-surface` Witnessed run (2026-09-15) the Executor
measured `document.hasFocus() === false` on the chrome document at every
keyboard-row reading and the Validator recorded it as an apparatus limitation
("no OS-focused surface under automation on WSLg"). The row passed on a11y-tree
evidence. At the HAT the same reading turned out to be the symptom of a real
defect (issue #216: the chrome loses OS focus after a typed navigation starts
and keyboard focus is stranded). The crew file's apparatus notes now state the
rig fact but do not tell the crew what to DO with it.

## Evidence

- `.flightops/agent-crews/behavior-tests-execution.md` — "Project Apparatus
  Notes (goldfinch)": the `document.hasFocus()` bullet added at that run
  describes the condition only.
- `tests/behavior/navigation-failure-surface/runs/2026-09-15-15-01-54.md` —
  Checkpoint 8 verdict + Validator closing (3); flight debrief "What Could Be
  Improved / Process" (M20 F1).

## Corrective Action

_(written at completion)_ Add one protocol paragraph to the crew file (both
the Executor and Validator initial prompts, or the apparatus-notes preamble):
a `hasFocus() === false` reading on a row whose Expected Result concerns
keyboard focus is reported as `[BLOCKED:apparatus-focus]` / an explicit
Orchestrator escalation ("verify by eye before the row is judged"), never
folded into a pass. Reference #216 as the precedent.

## Verification

Re-read the crew file: the escalation rule is present in the prompts the run
skill actually issues; the next Witnessed run with a focus row cites it.

## Sign-Off

_(written at completion)_
