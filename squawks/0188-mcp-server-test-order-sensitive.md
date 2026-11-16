# Squawk 0188: `automation-mcp-server.test.js` is sensitive to test order

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-14
**Completed**: —

## Report
Found by the Developer of Mission 23 Flight 2's `port-and-permissions` leg. Adding one test that binds a port in the middle of `test/unit/automation-mcp-server.test.js` made a later, unrelated test ("admin session reports kind:admin") fail with `fetch failed` in 5 of 10 runs; with the new test moved to the end of the file it failed 0 of 10. The suite passes as committed, but a port-reuse or stale-socket race in the harness is waiting for the next test added mid-file.

## Evidence
- `test/unit/automation-mcp-server.test.js` — tests share fixed ports and a server-start helper.
- Flight log, leg `port-and-permissions`, deviations.

## Corrective Action
*(written at completion)*

## Verification
Each test binds an ephemeral port (or awaits the previous server's close before the next bind); the suite passes 20 of 20 with the tests shuffled.

## Sign-Off
*(written at completion)*
