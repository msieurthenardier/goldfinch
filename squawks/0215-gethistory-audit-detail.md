# Squawk 0215: MCP `getHistory` is audited with no detail

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: 2026-11-19

## Report
The automation audit records every op, but `deriveAuditDetail` has no `getHistory` case, so a history read is logged with `op` only — no jar, query length or limit. Carried since Mission 08 (maintenance 2026-08-27; this cycle's finding #29).

## Evidence
- `src/main/automation/mcp-server.js:deriveAuditDetail` — cases for navigate, openTab, click, scroll, pressKey, typeText, dragPointer and the vault ops; none for `getHistory`.
- `src/main/automation/scope.js` — `getHistory` is jar-confined.

## Corrective Action
Added `case 'getHistory'` to `deriveAuditDetail` (`src/main/automation/mcp-server.js`): parts `jar=<id>`, `q=<query length>` (string queries only; text never recorded), `limit=<n>`, `before=<n>`, each only when present, joined by spaces; none present returns null. Documented in `docs/mcp-automation.md` (audit `detail` paragraph).

## Verification
A unit test asserts `deriveAuditDetail('getHistory', …)` returns `jar=<id> q=<length> limit=<n>` and never the query text.


Ran: `node --test test/unit/automation-mcp-server.test.js` 112 pass / 0 fail (two new tests: exact `jar=work q=<len> limit=5` with a marker absent from the detail; listRecent with `before`, non-string query -> `jar=work`, empty args -> null). `npm test` 7382 pass / 0 fail; `npm run lint`, `npm run typecheck`, `npm run format:check` clean.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the second 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. The `getHistory` case records `jar= q=<length> limit= [before=]` and never the query text; a non-string query adds no `q=` part and empty args return null; the docs line matches the code. Neuter check: removing the case turns both new tests red. Gates at review: `npm test` 7,388 tests (7,383 pass, 0 fail, 1 skipped — the `jq` test, no `jq` on the dev host — and 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-b`
