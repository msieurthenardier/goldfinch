# Squawk 0172: Save-prompt unit tests leave a real 10 s timer pending (+6.5 s per `npm test`)

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-05
**Completed**: 2026-11-05

## Report
Since Sortie 06, `npm test` takes about 13.3 s instead of about 7.4 s (sortie 05). Three new test files each hold their process about 10 s at exit, waiting on a real offer timer: `test/unit/save-prompt-manager.test.js`, `test/unit/save-prompt-ipc.test.js`, `test/unit/save-prompt-consent.test.js`. All tests pass; only wall-clock is affected. Repro: `time node --test test/unit/save-prompt-manager.test.js` (12.69 s), `…save-prompt-ipc.test.js` (11.56 s) and `…save-prompt-consent.test.js` (10.06 s), measured 2026-11-05.

## Evidence
- `src/main/save-prompt-manager.js` `createSavePromptManager` — the injectable clock defaults to the real one: `setTimeout: _setTimeout = (fn, ms) => globalThis.setTimeout(fn, ms)`, armed for the 10 s offer timer (`timerHandle = _setTimeout(onExpire, remainingMs)`) and the result/fallback/deferred-hide timers.
- The tests apply the MockTimers recipe sparsely (CLAUDE.md → *MockTimers recipe*), and the shared fakes (`test/helpers/save-prompt-fakes.js`) don't inject a fake clock, so tests that never close their offer leave a live handle.
- Found by the Sortie 06 debrief Developer metrics run and confirmed by the Flight Director.

## Corrective Action
Test-surface only. `test/helpers/save-prompt-fakes.js` `makeHarness` now injects `setTimeout`/`clearTimeout` that resolve the globals at call time: under a test's MockTimers they forward to the mocked globals (existing tick-based tests unchanged); otherwise they return an inert handle and never arm a real timer. Chosen over per-test MockTimers or teardown because it covers all three files at once, needs no per-test edits, and leaves production defaults untouched. Guard: the fakes export `assertNoLiveTimers()` (checks `process.getActiveResourcesInfo()` for `Timeout`), called from an `after()` hook in `save-prompt-manager`, `-ipc` and `-consent` tests.

## Verification
Measured 2026-11-05. Before: manager 12.69 s, ipc 11.56 s, consent 10.06 s; full `npm test` ~13.3 s. After: manager 0.23 s, ipc 0.14 s, consent 0.16 s; full `npm test` 7.5 s, 6314 tests / 6310 pass / 0 fail / 4 todo (unchanged). Guard non-vacuity: temporarily forcing the harness clock to arm real timers turned each of the three files red ("left N real timer(s) armed": 16/13/5); restored. typecheck, lint and format:check clean.

Original criterion: The three files each finish in under about 1.5 s run alone, and the full `npm test` returns to the pre-sortie band (~7–8 s) with the same pass/todo counts. Add a guard (for example, the fakes inject a recording clock and an `after` hook asserts no pending timers), so a future test can't silently reintroduce it.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped)
**Verdict**: confirmed — no blocking or non-blocking issues. The harness's "MockTimers enabled" check runs at call time (it compares `globalThis.setTimeout` with the real one captured at load), so it matches the per-test enable recipe. Every expiry, result-hold and fallback test enables MockTimers before arming, so none passes vacuously on an inert handle. The guard was independently re-neutered and failed red (`save-prompt-ipc.test.js`: "left 13 real timer(s) armed"). `git diff main -- src` is empty. Gates: `npm test` 7.6 s wall, 6314 tests (6310 pass, 0 fail, 4 todo); typecheck, lint and format:check clean.
**Commit**: the `squawk/0172: save-prompt tests no longer arm real timers` commit on `squawk/0172-save-prompt-tests-leave-real-timer`
