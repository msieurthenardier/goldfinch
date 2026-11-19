# Squawk 0222: `admin-reach-refusal` spec needs run-order, session-hygiene and by-eye cadence fixes

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-19
**Completed**: —

## Report
The spec's first full pass (run 2026-11-19-00-25-54) needed Orchestrator workarounds that the spec should state. Its Validator found six fixes:

1. **Step order.** Step 9 quits the app, yet steps 10–13 follow it. Make the quit the last-numbered step.
2. **Step 8 session hygiene.** `reason=touched` needs no other admin session active, but step 1b's raw `initialize` leaves one. Write the cleanup into step 8: list the sessions through the automation activity, `DELETE` the extras, and arm only from the sole remaining client.
3. **By-eye handshake.** Steps 6b, 12 and 13 need a "watch-ready" handshake with the operator before each. State that a rerun's extra trace lines (`gone`, or `confirmed` from an answered dialog) are accounted for in step 9.
4. **Exact strings.** Give the operator the exact expected dialog strings to confirm against.
5. **Step 1b.** Record the real-key attach both before and after.
6. **Step 13 evidence.** Capture the deletion, port closure and process checks as files: process state by PID, polled during the pending call.

## Evidence
- `tests/behavior/admin-reach-refusal/runs/2026-11-19-00-25-54.md`: Orchestrator Notes and Validator closing.

## Corrective Action
*(written at completion)*

## Verification
The spec has been edited for each point, and the next run needs no Orchestrator-side reordering or session cleanup that the spec does not itself state.
