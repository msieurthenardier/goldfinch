# Squawk 0186: The cookie-isolation spec's teardown trips a tool safety check, and three of its checks leave no saved evidence

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-14
**Completed**: 2026-11-19

## Report
Found by the Executor and Validator of the `third-party-cookie-isolation` run on Electron 45.3.2 (Mission 23 Flight 2, leg `electron-45`). (1) Following the spec's teardown, the Executor issued one compound command that quit the app, stopped the fixture and deleted the scratch profile through a command substitution; a tool safety check refused it, nothing in it ran, and the app and fixture were left up until the Flight Director stopped them by PID. (2) The same-PID and old-PID-exited checks in steps 10, 14 and 15 are backed only by Executor prose. (3) The fixture's certificates last 7 days, so nearly every run starts with a refusal and a regeneration the spec mentions only as allowed. (4) Step 1's three health screenshots are identical and show nothing.

## Evidence
- `tests/behavior/third-party-cookie-isolation/runs/2026-11-14-20-30-13.md` — Orchestrator Notes and the Validator's closing.
- `tests/behavior/third-party-cookie-isolation.md` — preconditions (scratch profile), steps 10, 14, 15.
- `tests/behavior/fixtures/third-party-cookies/gen-certs.mjs`.

## Corrective Action
Edited `tests/behavior/third-party-cookie-isolation.md` only: (1) new Preconditions bullets "Recorded PIDs and scratch path" and "Teardown form" (separate simple commands, literal scratch path, no substitution or chains; PIDs recorded at launch), and step 15's teardown now points to them; (2) new "Evidence files for process checks" bullet, with `step-10-ps.txt`, `step-14-attestation.txt`, `step-15-attestation.txt`, `step-15-teardown.txt` named in steps 10, 14, 15; (3) the Fixture bullet now says to run `gen-certs.mjs` first every run (invocation and 7-day validity read from the script); (4) step 1 now saves an `evaluate` of host and body per origin instead of screenshots.

## Verification
The spec's teardown is written as separate commands with a literal scratch path; steps 10, 14 and 15 require a saved `ps` / `ss` capture; the preconditions say to run `gen-certs.mjs` first; step 1 captures something that differs per origin or drops the screenshots.

Ran: `timeout 300 npm test` (7455 tests, 7450 pass, 0 fail, 1 skipped, 4 todo), `npm run lint` (clean), `npm run typecheck` (clean), `npm run format` then `npm run format:check` (all files pass).

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the ninth 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. Teardown is separate simple commands on recorded PIDs and a literal scratch path, with no command substitution, chain or pipe; steps 10, 14 and 15 name saved `ps`/`ss` capture files; the preconditions run `gen-certs.mjs` first (no arguments, writes `certs/server.pem` and `certs/server-key.pem`, 7-day certificates); step 1 saves each origin's `{host, body}` in place of the identical screenshots. Gates at review: `npm test` 7,455 tests (7,450 pass, 0 fail, 1 skipped, 4 todo); lint, typecheck and format:check clean; `path-hygiene.test.js` 3 pass. Artifacts and docs only: no runtime change, so no live check.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-i`
