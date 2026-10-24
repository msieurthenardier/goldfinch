# Squawk 0141: Bare `jars-cookies-value` IPC channel returns cookie values without the internal-origin gate

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: 2026-10-24

## Report
`src/main/jar-data-ipc.js` registers `ipcMain.handle('jars-cookies-value', handleCookiesValue)` as a bare channel, in addition to the internal-origin-gated `internal-jars-cookies-value`. The bare channel returns a raw cookie value for any jar. No preload exposes it today: `chrome-preload.js` has no `jarsCookiesValue`, and `webview-preload.js` has no generic invoke. So it can't be reached in practice, and outside the tests it is dead code. But a compromised chrome renderer (the tracked sandbox exception), or a future preload that adds a generic invoke, could read any jar's cookie values. CLAUDE.md's rule is that a bare `ipcMain.handle` is for non-secret data only. The fix is to remove the bare registration and move its unit tests to the gated channel (or use the handler directly).

## Evidence
- `src/main/jar-data-ipc.js:427` — `ipcMain.handle('jars-cookies-value', handleCookiesValue);`
- `grep -rn "jars-cookies-value" src` finds no consumer other than the internal-gated twin. The only callers of the bare channel are tests (`test/unit/jar-data-ipc.test.js:839ff`).
- Surfaced by the squawk-turnaround 2026-10-06 batch Reviewer (a 0125 follow-up).

## Corrective Action
Removed the bare `ipcMain.handle('jars-cookies-value', ...)` registration from `src/main/jar-data-ipc.js` (replaced with a comment). The only path to a cookie value is now `internal-jars-cookies-value` via `registerInternal` (origin + internal-session gated). The handler, the gated channel, the preload and the page are unchanged. In `test/unit/jar-data-ipc.test.js` the value-logic tests were retargeted to `invokeInternal('internal-jars-cookies-value', ...)` with no coverage lost. `cookies-value` was dropped from the chrome/internal twin-identity list (no chrome twin exists now), and a pin test asserts the bare channel is not registered while the gated one is. `'jars-cookies-value'` was removed from the expected-channel list in `test/unit/jar-ipc.test.js`.

## Verification
- Grep disposition for bare `jars-cookies-value` and `handleCookiesValue` across src, test, scripts, docs, tests and CLAUDE.md. Hits: `src/main/jar-data-ipc.js` (the registration, now removed; the handler and its gated registration stay), `test/unit/jar-data-ipc.test.js` (value tests retargeted, twin list trimmed, pin added), `test/unit/jar-ipc.test.js` (channel list trimmed). No hits in scripts, docs, tests or CLAUDE.md, and no preload or renderer consumer.
- The gated channel's rejection of a non-internal sender is already covered by 'data internal twins reject an untrusted sender...', which includes `internal-jars-cookies-value`.
- Neuter: re-adding the bare registration turns 2 tests red (the new pin and the `jar-ipc.test.js` channel list); restoring it goes green.
- Gates: format:check, lint and typecheck are clean. `npm test` gives 6030 pass, 0 fail.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped, turnaround batch)
**Verdict**: confirmed, with no blocking issues. The bare channel is gone. The only remaining references are the gated `internal-` registration, the preload, the channel list and a NOTE comment, and the only consumer is the internal bridge. A new pin covers the bare channel staying absent. The value tests moved to the gated channel, and the gated sender-rejection test is intact. The Developer neuter-verified the pin: re-adding the registration turned 2 tests red. The batch gates were `npm test` 6041 (6037 pass, 0 fail, 4 todo), with typecheck, lint and format:check clean.
**Commit**: the `squawk: turnaround 2026-10-23` commit on `squawk/turnaround-2026-10-23`
