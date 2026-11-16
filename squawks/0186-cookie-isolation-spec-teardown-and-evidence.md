# Squawk 0186: The cookie-isolation spec's teardown trips a tool safety check, and three of its checks leave no saved evidence

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-14
**Completed**: —

## Report
Found by the Executor and Validator of the `third-party-cookie-isolation` run on Electron 45.3.2 (Mission 23 Flight 2, leg `electron-45`). (1) Following the spec's teardown, the Executor issued one compound command that quit the app, stopped the fixture and deleted the scratch profile through a command substitution; a tool safety check refused it, nothing in it ran, and the app and fixture were left up until the Flight Director stopped them by PID. (2) The same-PID and old-PID-exited checks in steps 10, 14 and 15 are backed only by Executor prose. (3) The fixture's certificates last 7 days, so nearly every run starts with a refusal and a regeneration the spec mentions only as allowed. (4) Step 1's three health screenshots are identical and show nothing.

## Evidence
- `tests/behavior/third-party-cookie-isolation/runs/2026-11-14-20-30-13.md` — Orchestrator Notes and the Validator's closing.
- `tests/behavior/third-party-cookie-isolation.md` — preconditions (scratch profile), steps 10, 14, 15.
- `tests/behavior/fixtures/third-party-cookies/gen-certs.mjs`.

## Corrective Action
*(written at completion)*

## Verification
The spec's teardown is written as separate commands with a literal scratch path; steps 10, 14 and 15 require a saved `ps` / `ss` capture; the preconditions say to run `gen-certs.mjs` first; step 1 captures something that differs per origin or drops the screenshots.

## Sign-Off
*(written at completion)*
