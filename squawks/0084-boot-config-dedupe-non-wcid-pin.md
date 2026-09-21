# Squawk 0084: Unit-pin the boot-config gap-queue dedupe's non-`wcId` branch

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-17
**Completed**: 2026-09-21

## Report

`window-boot-config`'s recovery flush dedupes queued sends last-wins per
`(wcId, channel)` and keys any message WITHOUT a `wcId` under a unique
`__no-wcid-<n>` key so it is never collapsed — but every `recoverTabs` dedupe
test builds `wcId`-bearing payloads, so that branch is unexercised. Add one
test: two queued messages without a `wcId` both survive the flush in order,
interleaved correctly with deduped `wcId` messages.

## Evidence

- `src/main/app-lifecycle.js` — the `window-boot-config` handler's dedupe
  (`__no-wcid-` key); `test/unit/app-lifecycle.test.js` recoverTabs tests
  (~:622–722) — all payloads carry `wcId`.
- Flight 3 debrief, Testing Assessment (Developer interview).

## Corrective Action

Added one test to `test/unit/app-lifecycle.test.js` (immediately after the
existing "gap queue is deduped last-wins per (wcId, channel)" test, ~:726),
built with the same `makeHarness`/`recoverTabs: true` fixture shape as its
neighbours. The queue interleaves four thunks:

1. `['tab-loading', { wcId: 1, loading: true }]`
2. `['toast-show', { message: 'first toast' }]` — no `wcId`
3. `['tab-loading', { wcId: 1, loading: false }]` — survivor for `(1, tab-loading)`, last occurrence
4. `['toast-show', { message: 'second toast' }]` — no `wcId`

Asserts the flushed sends (after the `chromeRecovery` adopt) are, in order:
`toast-show(first)`, `tab-loading(false)`, `toast-show(second)` — i.e. both
no-`wcId` messages survive independently (never collapsed onto each other),
each keeps its own relative position, and the `wcId`-bearing pair still
dedupes last-wins to its last occurrence's slot. No production code changed.

## Verification

- **RED proof**: temporarily changed
  `src/main/app-lifecycle.js`'s dedupe key line from
  `` `__no-wcid-${anonSeq++}` `` to `` `__no-wcid-${(anonSeq++, 0)}` `` (both
  no-`wcId` messages collapse onto one key, second overwrites first). Re-ran
  `node --test test/unit/app-lifecycle.test.js` — the new test failed:
  ```
  not ok 22 - recoverTabs: two no-wcId gap messages both survive the dedupe, in order, interleaved with a deduped wcId pair at its last-occurrence position
    error: |-
      Expected values to be strictly deep-equal:
      ...
      -     'toast-show',
      -     {
      -       message: 'first toast'
      -     }
      -   ],
      -   [
            'tab-loading',
            {
              loading: false,
              wcId: 1
            }
  ```
  (the first `toast-show` was collapsed away, as expected of the broken key).
  Reverted the edit; `git diff src/main/app-lifecycle.js` is empty (byte-identical restore).
  Re-ran `node --test test/unit/app-lifecycle.test.js` — 26/26 pass, including the new test.
- `npm test` — 5457 pass, 3 todo, 0 fail.
- `npm run lint` — clean.
- `npm run typecheck` — clean.
- `npm run format` — no changes (file already Prettier-formatted).
- `npm run format:check` — "All matched files use Prettier code style!"

## Sign-Off

**Reviewer**: independent Reviewer agent (leg-execution crew), batch review of the
2026-09-21 turnaround
**Verdict**: confirmed — corrective action correct, complete, and confined to the reported surface; gates green (`npm test` 5455 pass / 0 fail / 3 todo, lint, typecheck, format:check, build:preload), leak scan clean
**Commit**: see `squawk: turnaround 2026-09-21`
