# Squawk 0141: Bare `jars-cookies-value` IPC channel returns cookie values without the internal-origin gate

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: —

## Report
`src/main/jar-data-ipc.js` registers `ipcMain.handle('jars-cookies-value', handleCookiesValue)` as a bare channel, in addition to the internal-origin-gated `internal-jars-cookies-value`. The bare channel returns a raw cookie value for any jar. No preload exposes it today: `chrome-preload.js` has no `jarsCookiesValue`, and `webview-preload.js` has no generic invoke. So it can't be reached in practice, and outside the tests it is dead code. But a compromised chrome renderer (the tracked sandbox exception), or a future preload that adds a generic invoke, could read any jar's cookie values. CLAUDE.md's rule is that a bare `ipcMain.handle` is for non-secret data only. The fix is to remove the bare registration and move its unit tests to the gated channel (or use the handler directly).

## Evidence
- `src/main/jar-data-ipc.js:427` — `ipcMain.handle('jars-cookies-value', handleCookiesValue);`
- `grep -rn "jars-cookies-value" src` finds no consumer other than the internal-gated twin. The only callers of the bare channel are tests (`test/unit/jar-data-ipc.test.js:839ff`).
- Surfaced by the squawk-turnaround 2026-10-06 batch Reviewer (a 0125 follow-up).

## Corrective Action
—

## Verification
—

## Sign-Off
—
