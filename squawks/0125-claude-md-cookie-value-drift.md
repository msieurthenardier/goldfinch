# Squawk 0125: CLAUDE.md: 'Cookies panel never exposes a cookie value' is stale after the reveal rider

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: 2026-10-06

## Report
CLAUDE.md says "The Cookies panel never exposes a cookie `value`, at any layer", but e07e21a added an operator-initiated per-row reveal (`jarsCookiesValue`, fetched on click). Reword it to the actual invariant: no value in the DOM or AX tree without an explicit reveal click, and it is fetched on demand.

## Evidence
`CLAUDE.md:142` — "The Cookies panel never exposes a cookie `value`, at any layer."; `src/renderer/pages/jars-cookies-panel.js` reveal button (e07e21a).

## Corrective Action
Reworded the one CLAUDE.md sentence (`goldfinch://jars` section) to: list payload never carries a value; no value in DOM/AX tree until an explicit per-row reveal click, which fetches that single value on demand via `jarsCookiesValue` (internal-origin-gated), `textContent`-only, removed on re-hide or list re-render. `docs/` and README had no copy of the stale claim.

## Verification
- List has no value: `src/main/jar-data-ipc.js:242` (handleCookiesList), `jars-cookies-panel.js:69`.
- On-demand fetch: `jars-cookies-panel.js:244-277` (click -> `jarsCookiesValue`); handler `jar-data-ipc.js:328`.
- Internal gate: `registerInternal(..., 'internal-jars-cookies-value', ...)` at `jar-data-ipc.js:436`; `internal-preload.js:466`. `chrome-preload.js` does not expose it.
- textContent only + re-hide removes node + per-row generation token + re-render resets: `jars-cookies-panel.js:235-269`.
- No leak found. `grep` of `docs/` and README for the stale claim: no hits.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the 2026-10-06 turnaround)
**Verdict**: confirmed, no blocking issues (`npm test` x3 green, lint/typecheck/format:check/audit clean). Electron 44.5.0 and SDK 1.31.0 also live-verified by the third-party-cookie-isolation run 2026-10-06-18-13-21 (pass).
**Commit**: the `squawk: turnaround 2026-10-06` commit on `squawk/turnaround-2026-10-06`
