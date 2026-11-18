# Squawk 0215: MCP `getHistory` is audited with no detail

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: —

## Report
The automation audit records every op, but `deriveAuditDetail` has no `getHistory` case, so a history read is logged with `op` only — no jar, query length or limit. Carried since Mission 08 (maintenance 2026-08-27; this cycle's finding #29).

## Evidence
- `src/main/automation/mcp-server.js:deriveAuditDetail` — cases for navigate, openTab, click, scroll, pressKey, typeText, dragPointer and the vault ops; none for `getHistory`.
- `src/main/automation/scope.js` — `getHistory` is jar-confined.

## Corrective Action
*(written at completion)*

## Verification
A unit test asserts `deriveAuditDetail('getHistory', …)` returns `jar=<id> q=<length> limit=<n>` and never the query text.
