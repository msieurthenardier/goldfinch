# Squawk 0209: The release-state `jq` test passes silently when `jq` is not installed

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: —

## Report
The test of `create-release`'s release-state `--jq` expression returns early, and so reports a pass, when no `jq` binary is found. On a host without `jq` (the main dev host) it checks nothing while appearing green. It should be reported as skipped with a reason.

## Evidence
- `test/unit/release-workflow-invariants.test.js` — `test('release state jq expression gives none / draft / published (when jq is installed)', …)`: `try { execFileSync('jq', ['--version']); } catch { jq = false; }` then `if (!jq) return;`.
- Sortie 10 flight log, leg 01 entry ("jq is NOT installed on this host, so that check did not run"); debrief Recommendation 5.

## Corrective Action
*(written at completion)*

## Verification
With `jq` absent the test shows as skipped (`{ skip: … 'jq not installed' }` or `t.skip(...)`), with `jq` present it runs and passes; `npm test`'s summary counts it as skipped on a host without `jq`.
