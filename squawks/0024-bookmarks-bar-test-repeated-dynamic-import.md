# Squawk 0024: `bookmarks-bar.test.js` re-runs `await import(moduleUrl)` 35+ times — 2.1 s for 77 tests

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: 2026-08-27

## Report

The slowest file in the suite (2095 ms; next is 1341 ms) is slow because its `create(h)`/`dragHarness()` helpers each re-execute a dynamic `import()` of the module under test — `dragHarness` alone is called 26 times. Timers are already mocked, so that is not the cause. Hoist the import to one module-scope `await import(moduleUrl)` (or a `before()` hook) and make `create()` synchronous, the pattern `settings-store.test.js` already uses (10.5 ms/test vs 27 ms/test here).

Source: maintenance report 2026-08-27, finding F17.

## Evidence

- `test/unit/bookmarks-bar.test.js:277` — `const { createBookmarksBar } = await import(moduleUrl);` inside the per-test helper
- Tool-pass per-file timing: bookmarks-bar 2095 ms; settings-store 875 ms for 83 tests with a single import

## Corrective Action

Two changes to `test/unit/bookmarks-bar.test.js` only (no source changes):

1. **Hoisted the import, as requested.** Replaced the 12 per-call-site
   `const { X } = await import(moduleUrl);` (inside the 10 pure-function
   tests, `create()`, and formerly re-run 26 more times via `dragHarness()` →
   `create()`) with a single module-scope `require('../../src/renderer/chrome/bookmarks-bar.js')`
   — the `require(esm)` idiom `bookmarks-bar-css-pin.test.js` already uses for
   this exact module (Node ≥22 loads ESM synchronously). No cache-busting was
   happening on purpose: `moduleUrl` was a static string, so every one of the
   35+ `import()` calls was already being served from Node's ESM module cache
   rather than re-executing the module — confirmed by isolated timing
   (5 back-to-back `import()` calls of the same URL: 3ms, then 1ms/0ms/0ms/0ms)
   and by `bookmarks-bar.js` having no module-scope mutable state (only
   `const` literals) to reset between tests. `create(h)` keeps its `async`
   signature and every `await create(h)` / `await dragHarness()` call site is
   untouched, per the "don't churn call sites" guidance.

2. **Found and fixed the actual bottleneck (test-file-only, no design
   decision — an existing idiom applied consistently).** Hoisting the import
   produced ~0% measured improvement, contradicting the report's diagnosis, so
   this was profiled (`node --prof` showed only ~230ms of CPU across both
   isolates against a ~2.1s wall clock — the process was idle, not busy).
   Root cause: `createBookmarksBar`'s dragend handler unconditionally arms a
   REAL `setTimeout(…, DRAG_HOLD_MS)` (2000ms) grace timer on every drag end;
   only the tests already using `t.mock.timers.enable(…)` (from ~line 950
   onward) avoided it. The ~20 earlier dragstart+dragend tests (AC7/AC8/AC9,
   Leg 5a) each left a real, uncleared 2-second timer armed — the module
   exposes no dispose/teardown hook the test file can reach — and `node --test`
   does not finish until the event loop drains, so the run sat idle for the
   ~2s it took those timers to fire for real. Fix: `mock.timers.enable({ apis:
   ['setTimeout'] })` once at module scope (`node:test`'s top-level `mock`,
   not per-test `t.mock`), turning every one of those into a virtual timer
   that never fires unless a test explicitly ticks it. Verified
   behavior-neutral: no pre-existing test observed or asserted on that grace
   timer firing, enabling the tracker twice is a no-op (confirmed in
   isolation), and a per-test `t.mock.timers.enable(…)` teardown does not
   disable the file-level mock (confirmed in isolation) — all 16 existing
   per-test `t.mock.timers.enable(…)` / `.tick(…)` calls in the file are
   unaffected and still pass.

## Verification

- `test/unit/bookmarks-bar.test.js` alone, `time node --test test/unit/bookmarks-bar.test.js`:
  - Before: 77/77 pass, internal `duration_ms: 2067.06`, wall `real 0m2.087s`.
  - After hoisting the import only: 77/77 pass, internal `duration_ms: 2069.92`, wall `real 0m2.090s` (no measurable change — confirms the import was never the cost).
  - After also fixing the dangling real timers: 77/77 pass, internal `duration_ms: 87.10`, wall `real 0m0.107s` — a ~24x wall-clock improvement (~10.5ms/test after the fix in raw duration terms, right in line with `settings-store.test.js`'s cited ratio, though for a different underlying reason than either file's header states).
- `timeout 180 npm test`: 3792/3792 pass, 0 fail (test count unchanged from the 3792 base).
- `npm run lint`: clean.
- `npm run typecheck`: clean.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the Developers' reasoning) — one review round, clean; the Reviewer re-measured the file at 0.099 s (from ~2.09 s) and confirmed the root cause was armed real dragend grace timers, not the imports; batch turnaround 2026-08-27 (batch 2)
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-27 (batch 2)` on `squawk/turnaround-2026-08-27-2` (PR number recorded on the PR itself)

Batch gates at review: 3806/3806 tests, lint clean, typecheck clean.
