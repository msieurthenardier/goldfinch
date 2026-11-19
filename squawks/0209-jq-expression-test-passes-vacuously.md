# Squawk 0209: The release-state `jq` test passes silently when `jq` is not installed

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: 2026-11-19

## Report
The test of `create-release`'s release-state `--jq` expression returns early, and so reports a pass, when no `jq` binary is found. On a host without `jq` (the main dev host) it checks nothing while appearing green. It should be reported as skipped with a reason.

## Evidence
- `test/unit/release-workflow-invariants.test.js` — `test('release state jq expression gives none / draft / published (when jq is installed)', …)`: `try { execFileSync('jq', ['--version']); } catch { jq = false; }` then `if (!jq) return;`.
- Sortie 10 flight log, leg 01 entry ("jq is NOT installed on this host, so that check did not run"); debrief Recommendation 5.

## Corrective Action
`test/unit/release-workflow-invariants.test.js`: `jq` is now detected once at module level (`HAS_JQ`, via `spawnSync('jq', ['--version'])`) and the test is declared with `{ skip: HAS_JQ ? false : 'jq not installed' }`. The early-return/`let jq` block is gone; the body and assertions are otherwise unchanged. The test name is kept (no other file references it).

## Verification
Host has no `jq` (`command -v jq` empty). Before: `npm test` summary `skipped 0`. After: `skipped 1`; TAP shows `ok 26 - release state jq expression ... # SKIP jq not installed`. No jq binary is obtainable here without installing (none in node_modules/.bin), so the run path is not exercised locally. It runs only on a host that has `jq`: the manual `ci.yml` GitHub runner should; whether the Concourse `node:22` test image carries `jq` is not confirmed (`ci/` installs none). Lint, typecheck, format:check, npm test green.

Original criterion: With `jq` absent the test shows as skipped (`{ skip: … 'jq not installed' }` or `t.skip(...)`), with `jq` present it runs and passes; `npm test`'s summary counts it as skipped on a host without `jq`.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. `HAS_JQ` is detected once and the test is declared `{ skip: 'jq not installed' }`; it reports as skipped on this host. The run path with `jq` present was not exercised. Gates at review: `npm test` 7,384 tests (7,379 pass, 0 fail, 1 skipped — the `jq` test — and 4 todo); lint, typecheck and format:check clean; `git diff main -- src .github/workflows` empty.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19`
