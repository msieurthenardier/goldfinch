# Squawk 0228: `maskedSourceCached` in the source-scan helper has no caller

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-19
**Completed**: —

## Report
The 0219 turnaround added three memoized helpers to `test/helpers/source-scan.js`. Two are used. `maskedSourceCached` (memoized `maskComments` over a file) has no caller in `test/`, so it is dead surface in a shared helper. Remove it and its memo map, or move one scan test that masks comments per file onto it, if that is a straight swap. Found by the 0219 batch review.

## Evidence
- `test/helpers/source-scan.js`: `function maskedSourceCached(file)` and its `module.exports` entry.
- `grep -rn maskedSourceCached test/` matches only the helper itself.

## Corrective Action
*(written at completion)*

## Verification
`grep -rn maskedSourceCached test/` shows either no match, or a definition plus at least one caller. `npm test`, lint, typecheck and format:check are green.
