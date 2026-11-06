# Squawk 0173: Apply vault-mcp-lock-coupling spec revisions and record the run's apparatus facts

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-06
**Completed**: —

## Report
The first run of `vault-mcp-lock-coupling` passed 10/10, but its Validator listed spec gaps, and
the Executor found apparatus facts that the crew file doesn't record. Neither has been applied.

Spec revisions, in `tests/behavior/vault-mcp-lock-coupling.md`:
- Judge Step 5 together with Steps 6–7 (or fold them) and label it lock-while-locked.
- Mandate the indicator polling timeline for the "within 2 s" rows, with the trigger defined as
  the prior call's return.
- In Step 9, require a graceful DELETE (`terminateSession()`) and capture its HTTP status.
- In Step 10, add a positive teardown observable, beyond the absence of errors in `app.log`.
- Sanction the read-only `app.db` default-jar check as Step 1's precondition probe.

Crew notes, in `.flightops/agent-crews/behavior-tests-execution.md` *Project Apparatus Notes*:
- Per-session vault state needs a persistent attach-only driver.
- `evaluate` awaits Promises.
- `readDom` with a selector returns the full chrome HTML.
- `readAxTree` works on the chrome wcId.
- `client.close()` sends no DELETE; `transport.terminateSession()` does.

## Evidence
- `tests/behavior/vault-mcp-lock-coupling/runs/2026-11-06-05-34-20.md`: Closing Summaries
  (Validator items 1–8; Executor apparatus lessons 1–8).
- `sorties/07-automation-honors-vault-lock/flight-debrief.md`: Documentation / Action Items.

## Corrective Action
*(written at completion)*

## Verification
Spec and crew-file diff review. The spec still validates against the ARTIFACTS.md behavior-spec
shape (Intent / Preconditions / Observables / Steps / Out of Scope). Optional: re-run
`/mission-control:behavior-test vault-mcp-lock-coupling`.

## Sign-Off
*(written at completion)*
