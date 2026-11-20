# Squawk 0188: `automation-mcp-server.test.js` is sensitive to test order

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-14
**Completed**: 2026-11-19

## Report
Found by the Developer of Mission 23 Flight 2's `port-and-permissions` leg. Adding one test that binds a port in the middle of `test/unit/automation-mcp-server.test.js` made a later, unrelated test ("admin session reports kind:admin") fail with `fetch failed` in 5 of 10 runs; with the new test moved to the end of the file it failed 0 of 10. The suite passes as committed, but a port-reuse or stale-socket race in the harness is waiting for the next test added mid-file.

## Evidence
- `test/unit/automation-mcp-server.test.js` — tests share fixed ports and a server-start helper.
- Flight log, leg `port-and-permissions`, deviations.

## Corrective Action
Root cause: the suite bound one fixed port (`TEST_PORT = 7790`, plus 7791/7792 in the rebind test) for every test. Node's global undici `fetch` pools keep-alive sockets per `127.0.0.1:port`. A test that talks to a server with plain `fetch`/SDK headers (no `connection: close`) and then `stop()`s it leaves a dead socket in the pool. The next test to hit the same port, such as "audit - admin session reports kind:admin", can be handed that dead socket and fails with `fetch failed`. The `connection: close` header in `connectClient`/`rawPost` covers only requests made through those helpers, which is why the failure followed whichever test sat after the offending one. `mcp-server.js` `stop()` is not at fault (it awaits `closeHttpServer` before returning); no `src/` change.

Fix, harness only, in `test/unit/automation-mcp-server.test.js`: `TEST_PORT`/`ENDPOINT` are now `let`, reassigned by a top-level `beforeEach` from a new `freePort()` helper (bind port 0, read, close and await it). Every test therefore uses its own OS-assigned port and a stale pooled socket is never addressed again. The rebind test uses `TEST_PORT` as port A and a distinct `freePort()` as port B (replacing 7791/7792). No assertion changed. This also stops the file colliding with a parallel test file or a dev instance on 7790. The stale comment in `test/unit/automation-port.test.js` that named the old fixed ports was updated after review.

## Verification
Each test binds an ephemeral port (or awaits the previous server's close before the next bind); the suite passes 20 of 20 with the tests shuffled.

Results (Node 22.22.0, which has no `--test-shuffle`/randomize flag):
- Before the fix, with a temporary mid-file test (start server on the test port, SDK client without `connection: close`, `listTools`, `stop()`) placed just before the admin test: 10 of 10 runs failed, "audit - admin session reports kind:admin" with `fetch failed`. Variants using a raw keep-alive `fetch`, or a plain bind-and-stop, did not reproduce (10 of 10 passed each); the original squawk's test is not recorded.
- After the fix, same temporary test mid-file: 20 of 20 passed.
- Order independence: a scratch copy with the top-level tests randomly shuffled (seeded, including the temporary test), 40 runs: 40 of 40 passed. An earlier 20-run pass of this found 3 failures in the rebind test, because `freePort()` could return the port the test already held; fixed by looping until port B differs from A.
- Final file with all temporary tests and the scratch copy removed: 20 of 20 passed.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the tenth 2026-11-19 turnaround)
**Verdict**: confirmed. Root-cause reasoning (pooled keep-alive sockets on one fixed port) is sound; no assertion changed; the rebind test's second port is drawn until it differs from the first; no `779x` literal remains. The file passed 10 of 10 looped runs at review. One low finding, judged acceptable as-is — a comment in `test/unit/automation-port.test.js` still naming the old fixed ports — was corrected after review (comment-only; diff checked by the Flight Director). Gates at review: `npm test` 7,455 tests (7,450 pass, 0 fail, 1 skipped, 4 todo); lint, typecheck, format:check and `path-hygiene.test.js` clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-j`
