# Squawk 0024: `bookmarks-bar.test.js` re-runs `await import(moduleUrl)` 35+ times — 2.1 s for 77 tests

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

The slowest file in the suite (2095 ms; next is 1341 ms) is slow because its `create(h)`/`dragHarness()` helpers each re-execute a dynamic `import()` of the module under test — `dragHarness` alone is called 26 times. Timers are already mocked, so that is not the cause. Hoist the import to one module-scope `await import(moduleUrl)` (or a `before()` hook) and make `create()` synchronous, the pattern `settings-store.test.js` already uses (10.5 ms/test vs 27 ms/test here).

Source: maintenance report 2026-08-27, finding F17.

## Evidence

- `test/unit/bookmarks-bar.test.js:277` — `const { createBookmarksBar } = await import(moduleUrl);` inside the per-test helper
- Tool-pass per-file timing: bookmarks-bar 2095 ms; settings-store 875 ms for 83 tests with a single import

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
