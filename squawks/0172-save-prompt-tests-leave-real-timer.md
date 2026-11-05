# Squawk 0172: Save-prompt unit tests leave a real 10 s timer pending (+6.5 s per `npm test`)

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-05
**Completed**: —

## Report
Since Sortie 06, `npm test` takes about 13.3 s instead of about 7.4 s (sortie 05). Three new test files each hold their process about 10 s at exit, waiting on a real offer timer: `test/unit/save-prompt-manager.test.js`, `test/unit/save-prompt-ipc.test.js`, `test/unit/save-prompt-consent.test.js`. All tests pass; only wall-clock is affected. Repro: `time node --test test/unit/save-prompt-manager.test.js` (12.69 s), `…save-prompt-ipc.test.js` (11.56 s) and `…save-prompt-consent.test.js` (10.06 s), measured 2026-11-05.

## Evidence
- `src/main/save-prompt-manager.js` `createSavePromptManager` — the injectable clock defaults to the real one: `setTimeout: _setTimeout = (fn, ms) => globalThis.setTimeout(fn, ms)`, armed for the 10 s offer timer (`timerHandle = _setTimeout(onExpire, remainingMs)`) and the result/fallback/deferred-hide timers.
- The tests apply the MockTimers recipe sparsely (CLAUDE.md → *MockTimers recipe*), and the shared fakes (`test/helpers/save-prompt-fakes.js`) don't inject a fake clock, so tests that never close their offer leave a live handle.
- Found by the Sortie 06 debrief Developer metrics run and confirmed by the Flight Director.

## Corrective Action
*(written at completion)*

## Verification
The three files each finish in under about 1.5 s run alone, and the full `npm test` returns to the pre-sortie band (~7–8 s) with the same pass/todo counts. Add a guard (for example, the fakes inject a recording clock and an `after` hook asserts no pending timers), so a future test can't silently reintroduce it.

## Disposition
Operator: fix immediately after the next release (cut after PR #280 merges).
