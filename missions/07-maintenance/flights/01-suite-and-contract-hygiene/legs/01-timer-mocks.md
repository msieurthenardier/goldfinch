# Leg: timer-mocks

**Status**: completed
**Flight**: [Suite & Contract Hygiene](../flight.md)

## Objective

Convert the real-timer tests in `test/unit/automation-find.test.js` to
`node:test` MockTimers so the full suite's internal duration drops below
~1.5s, with every retry-semantics assertion preserved on mocked time.

## Context

- Maintenance report 2026-07-11 finding 2 (measured): the suite runs 5.21s
  with this file, 1.09s without — one file is ~80% of wall-clock. Three tests
  are 91% of the file's cost; ~4 more each burn ~80–100ms of real clock.
- The engine's retry logic (`src/main/automation/find.js:findInPage`) uses
  **global** `setTimeout`/`setInterval`/`clearInterval`/`clearTimeout`
  (`find.js:119 — "const RETRY = 500, MAX = 5"`, registration at
  `find.js:149-154`). `node:test` MockTimers replaces the globals in-process,
  so the engine's timers are controllable from the test with **zero
  production-code change**. The flight's conditional clock seam is NOT needed
  — this is a test-only leg.
- The test file's own header (`automation-find.test.js:19-21`) already
  anticipates this: "or use t.mock.timers for deterministic control."
- Coverage must not thin (flight CP1): retry-exhaustion semantics — attempt
  counts, opts reuse on retry, resolve-on-nonzero, timeout fallback to
  `last` — stay asserted; only the clock becomes fake.

## Inputs

- Clean tree on branch `flight/01-suite-and-contract-hygiene` (branched from
  `main` at `2bba097`), suite 1283/1283 green at ~5.0s internal duration.
- `test/unit/automation-find.test.js` (539 lines), `src/main/automation/find.js`
  (read-only reference — must not change).

## Outputs

- `test/unit/automation-find.test.js` modified: timer-dependent tests run on
  MockTimers; no real-clock wait ≥ ~50ms remains anywhere in the file.
- No other file modified.

## Acceptance Criteria

- [x] The three expensive tests are converted to MockTimers:
      cold-start re-issue (`automation-find.test.js:177`, currently
      `await new Promise(r => setTimeout(r, 520))` at line 198), MAX-retry
      exhaustion (`automation-find.test.js:343`, ~2502ms), retry-opts reuse
      (`automation-find.test.js:376`, ~1560ms with its own real 520ms
      `setInterval` scaffolding)
- [x] The real-timeout fallback tests are converted too: zero-matches
      (`:121`, findTimeoutMs 100), timeout fallback ×2 (`:213`, `:226`),
      listener cleanup after timeout (`:263`, findTimeoutMs 80)
- [x] Every existing assertion survives verbatim in meaning: re-issue count
      (`wc._finds.length >= 2` / `>= 5`), opts deep-equality on ALL issues
      (no `findNext:true` corruption), resolve-on-nonzero vs timeout-resolves-
      `last`, listener hygiene (count 1 during find, 0 after)
- [x] `npm test` green with the same test count (1283; no tests deleted or
      skipped) and **internal duration < 1.5s** — measured 958ms
- [x] `git diff --stat` touches only `test/unit/automation-find.test.js`
      (excluding this leg's own artifact updates)
- [x] Typecheck and lint green

## Verification Steps

- `time npm test` — record internal duration (the runner's own duration
  line) before and after; after must be < 1500ms and test count 1283
- `grep -n "setTimeout(r, 5" test/unit/automation-find.test.js` — no
  ≥500ms real sleeps remain; scan the diff for any surviving real waits
- `git diff --stat` — single file
- `npm run typecheck && npm run lint`

## Implementation Guidance

1. **Per-test enable, never file-global.** In each converted test, take the
   `t` context and call
   `t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })` as the
   first statement. `node:test` auto-restores mocks at test end. Do NOT mock
   `setImmediate` — many tests (converted and unconverted) use real
   `setImmediate` for event-emission ordering, and that must stay real.
   Leave the fast event-driven tests (findTimeoutMs 3000, resolved via
   emitted events) untouched — they never wait on the clock.

2. **Drain microtasks around ticks.** `t.mock.timers.tick(ms)` runs timer
   callbacks synchronously, but promise continuations (the engine's
   `finish` → `resolve` → awaiting test code) need a microtask drain. Use
   `await new Promise(r => setImmediate(r))` (real setImmediate) after
   starting the find, after each emit, and after each tick, before
   asserting. The engine registers its timers synchronously (no `await`
   precedes the `new Promise` executor in `findInPage` when `deps.activate`
   is absent), so ticking right after the call is safe — but drain first
   anyway for the setImmediate-emitted events.

3. **Cold-start test (`:177`)**: start `const p = findInPage(...)`; drain;
   emit the spurious `requestId:1` event; drain; `tick(500)` (replaces the
   real 520ms sleep) to fire one retry interval; drain; assert
   `wc._finds.length >= 2`; emit the real `requestId:2` event; `await p`;
   assert the resolved count.

4. **MAX-retry exhaustion (`:343`)**: replace the test's real 100ms
   `pollInterval` scaffolding with explicit sequencing — loop 5 times:
   emit spurious `finalUpdate:true, matches:0` events for every id in
   `1..wc._reqId`, drain, `tick(500)`, drain. After the 5th interval fire
   the engine's `attempts >= MAX` branch resolves `last`. Keep
   `findTimeoutMs: 10000` so resolution provably came from MAX exhaustion.
   Assertions unchanged: result `{0,0}`, `wc._finds.length >= 5`.

5. **Retry-opts test (`:376`)**: drop the test's own real 520ms
   `setInterval`; sequence directly — emit spurious for req 1, drain,
   `tick(500)`, drain (re-issue → req 2), emit spurious for req 2, drain,
   `tick(500)`, drain (re-issue → req 3), emit real for req 3, `await p`.
   Assertions unchanged: every `wc._finds[i].opts` deep-equals the caller's
   opts; result correct.

6. **Timeout-fallback tests (`:121`, `:213`, `:226`, `:263`)**: start the
   find (do not await), drain (lets the `:226` setImmediate emission land
   and update `last`), `tick(findTimeoutMs)`, `await` the result.
   Assertions unchanged.

7. **Do not touch `src/main/automation/find.js`** or any other production
   file. If MockTimers turns out unable to drive some path without
   distorting an assertion, STOP and report — that's the flight's divert
   condition (a real design pass on a clock seam), not something to
   improvise.

## Edge Cases

- **Interleaving hazard**: with mocked `setInterval`, a `tick(1000)` fires
  the interval twice back-to-back without letting emitted events land in
  between — always tick in single 500ms steps with drains between, never
  one big tick.
- **The engine's `to = setTimeout(..., timeoutMs)`** is also mocked in
  converted tests; in retry tests keep `findTimeoutMs` large so ticks of
  500 never reach it (500×5 < 3000 holds for the default, but be explicit).
- **`MaxListenersExceededWarning`**: the fakes already set
  `setMaxListeners(50)`; re-issue counts don't grow under mock, no change
  needed.
- **Node version**: MockTimers requires Node 20.4+; project floor is
  Node 22 — fine. Do not add any library (zero-runtime-dep policy).
- **ExperimentalWarning noise (expected, benign)**: Node prints
  `ExperimentalWarning: The MockTimers API is an experimental feature...`
  to stderr on runs once this lands. No CI gate treats warnings as
  failures; do not mistake it for a defect or try to suppress it.

## Files Affected

- `test/unit/automation-find.test.js` — timer-dependent tests converted to
  MockTimers (only file touched)

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header) — flight
      review and commit are deferred to end of flight
- [x] Check off this leg in flight.md

## Citation Audit

Verified at leg design time against the working tree at `2bba097`:
`find.js:119 — "const RETRY = 500, MAX = 5"` OK; `find.js:149-154` (interval
+ timeout registration) OK; `automation-find.test.js:177` (cold-start test)
OK; `:198 — "setTimeout(r, 520)"` OK; `:343` (MAX-retry) OK; `:376`
(retry-opts) OK; `:121`, `:213`, `:226`, `:263` (timeout-fallback tests) OK;
`:19-21` (header note re t.mock.timers) OK. 11 citations, all OK.
