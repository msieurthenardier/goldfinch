# Squawk 0228: `maskedSourceCached` in the source-scan helper has no caller

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-19
**Completed**: 2026-11-19

## Report
The 0219 turnaround added three memoized helpers to `test/helpers/source-scan.js`. Two are used. `maskedSourceCached` (memoized `maskComments` over a file) has no caller in `test/`, so it is dead surface in a shared helper. Remove it and its memo map, or move one scan test that masks comments per file onto it, if that is a straight swap. Found by the 0219 batch review.

## Evidence
- `test/helpers/source-scan.js`: `function maskedSourceCached(file)` and its `module.exports` entry.
- `grep -rn maskedSourceCached test/` matches only the helper itself.

## Corrective Action
Removed `maskedSourceCached`, the `maskMemo` Map and its `module.exports` entry from `test/helpers/source-scan.js`. `collectSourcesCached` and `readSourceCached` untouched.

## Verification
`grep -rn maskedSourceCached test/` shows either no match, or a definition plus at least one caller. `npm test`, lint, typecheck and format:check are green.

Ran: `grep -rn maskedSourceCached test/` (no match); `npm test` 7379 pass / 0 fail; `npm run lint`, `npm run typecheck` clean; `npm run format` then `format:check` clean.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the second 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. The helper, its `maskMemo` Map and its export are gone; `collectSourcesCached` and `readSourceCached` are untouched; `grep -rn maskedSourceCached test/` is empty. Gates at review: `npm test` 7,388 tests (7,383 pass, 0 fail, 1 skipped — the `jq` test, no `jq` on the dev host — and 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-b`
