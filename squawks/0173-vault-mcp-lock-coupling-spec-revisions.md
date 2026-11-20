# Squawk 0173: Apply vault-mcp-lock-coupling spec revisions and record the run's apparatus facts

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-06
**Completed**: 2026-11-19

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
- `tests/behavior/vault-mcp-lock-coupling.md`: Step 5 labelled lock-while-locked and judged with Steps 6-7; mandatory indicator polling timeline (Observables Required) with the trigger defined as the prior call's return, referenced from Steps 3, 7, 9; Step 6 notes null/empty results are normal; Step 9 requires `transport.terminateSession()`, its HTTP status captured, and the no-lock-between-8-and-9 precondition; Step 10 adds a positive teardown observable; read-only `app.db` default-jar probe sanctioned in Preconditions; ungraceful-drop variant and optional screenshot-presence out-of-scope note added. `Last Run` already named 2026-11-06-05-34-20.
- `.flightops/agent-crews/behavior-tests-execution.md` Project Apparatus Notes: five notes added (persistent attach-only driver, `evaluate` awaits Promises, `readDom` takes no selector, `readAxTree` on chrome, `terminateSession()` vs `close()`). Code-checked: `observe.js` `readDom(wcId, deps)` takes no selector; `evaluate` awaits `executeJavaScript`. The rest are phrased as observed on 2026-11-06.

## Verification
Spec and crew-file diff review. The spec still validates against the ARTIFACTS.md behavior-spec
shape (Intent / Preconditions / Observables / Steps / Out of Scope). Optional: re-run
`/mission-control:behavior-test vault-mcp-lock-coupling`.

Ran: `timeout 300 npm test` 7455 tests, 7450 pass, 0 fail (5 skipped/other); `npm run lint` clean; `npm run typecheck` clean; `npm run format` then `format:check` clean. Spec still has Intent / Preconditions / Observables Required / Steps / Out of Scope. Live re-run not performed.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the ninth 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. Each spec revision is applied (Step 5 judged with 6-7 as lock-while-locked, the polling timeline mandated with the prior call's return as trigger, Step 9's graceful DELETE with its status, a positive Step 10 teardown observable, Step 1's read-only `app.db` probe sanctioned). The five crew notes are new and match `src/main/automation/observe.js` (`readDom` takes no selector, `evaluate` awaits); the three not checkable in code are dated as observed on 2026-11-06. The behavior test was not re-run. Gates at review: `npm test` 7,455 tests (7,450 pass, 0 fail, 1 skipped, 4 todo); lint, typecheck and format:check clean; `path-hygiene.test.js` 3 pass. Artifacts and docs only: no runtime change, so no live check.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-i`
