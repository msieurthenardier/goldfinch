# Squawk 0205: The update checker maps a raw outcome to the page's answer in two places

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: 2026-11-19

## Report
Sortie 09 added `checkNow` to the update checker. The mapping from a raw check outcome (`newer`, `current`, every failure code, `aborted`, `timeout`) to the three public answers (`newer`, `current`, `failed`) is written out twice — once where `lastCheck` is recorded and once in `checkNow`'s answer. A new outcome code would have to be added to both.

## Evidence
- `src/main/update-check.js` — `lastCheck = { at: now(), outcome: outcome === 'newer' || outcome === 'current' ? outcome : 'failed' };` and, in `checkNow`, `return { outcome: raw === 'newer' || raw === 'current' ? raw : 'failed' };`
- Sortie 09 debrief, Technical and Action Items.

## Corrective Action
Added module-private `publicOutcome(raw)` in `src/main/update-check.js` (JSDoc return `'newer' | 'current' | 'failed'`, not exported) and used it at both sites: the `lastCheck` record in `runCheck` and the `checkNow` answer. Behaviour unchanged.

## Verification
One small helper used by both sites; `test/unit/update-check.test.js` passes unchanged.

Ran: `node --test test/unit/update-check.test.js` (36 pass, 0 fail, file unchanged); `npm test` (7379 pass, 0 fail); `npm run lint`, `npm run typecheck`, `npm run format:check` clean. `grep "outcome ===" src/main/update-check.js` shows the ternary once (inside `publicOutcome`).

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the second 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. `publicOutcome` is module-private and used at both sites; the duplicated ternary is gone; `test/unit/update-check.test.js` is unchanged and passes. Gates at review: `npm test` 7,388 tests (7,383 pass, 0 fail, 1 skipped — the `jq` test, no `jq` on the dev host — and 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-b`
