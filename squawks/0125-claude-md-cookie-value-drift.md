# Squawk 0125: CLAUDE.md: 'Cookies panel never exposes a cookie value' is stale after the reveal rider

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: —

## Report
CLAUDE.md says "The Cookies panel never exposes a cookie `value`, at any layer", but e07e21a added an operator-initiated per-row reveal (`jarsCookiesValue`, fetched on click). Reword it to the actual invariant: no value in the DOM or AX tree without an explicit reveal click, and it is fetched on demand.

## Evidence
`CLAUDE.md:142` — "The Cookies panel never exposes a cookie `value`, at any layer."; `src/renderer/pages/jars-cookies-panel.js` reveal button (e07e21a).

## Corrective Action
*(written at completion)*

## Verification
*(written at completion)*

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
