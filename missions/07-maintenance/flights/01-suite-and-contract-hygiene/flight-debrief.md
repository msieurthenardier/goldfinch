# Flight Debrief: Suite & Contract Hygiene

**Date**: 2026-07-11
**Flight**: [Suite & Contract Hygiene](flight.md)
**Status**: landed
**Duration**: 2026-07-11 (same-day)
**Legs Completed**: 2 of 2

## Outcome Assessment

### Objectives Achieved

Both maintenance findings closed exactly as chartered, in one flight commit
(`43ca511`, PR #70):

- **Finding 2 (timer mocks)**: the six real-timer tests in
  `automation-find.test.js` now run on `node:test` MockTimers. Suite
  internal duration 5036ms → 958ms at landing (~81% cut); the file itself
  went 5.98s → ~50ms standalone. Zero production change — leg design
  discovered the engine's retry logic uses global timers, which MockTimers
  intercepts in-process, so the flight spec's conditional clock seam was
  never needed.
- **Finding 4 (result contract)**: all 8 failure branches of
  `handleClearData` (5) and `handleWipe` (3) return
  `{ ok: false, error }` with branch-discriminable strings in the
  `jars: <op> — <code>` idiom, each pinned verbatim in the truth tables
  (previously 1/8 branches carried `error`). Type surfaces
  (`renderer-globals.d.ts`, internal-preload JSDoc) updated per the
  DD10(b) checklist — caught at leg design this time, not in review.

### Mission Criteria Advanced

Criteria 2 (suite < ~1.5s, no coverage loss) and 3 (`{ok:false, error}`
uniform on both jar data channels, unit-pinned) are both fully met.
Criterion 5 (gates stay green) held throughout.

## What Went Well

- **Conditional hedge resolved empirically at leg design.** The flight
  spec hedged "add a clock seam *if* the timer calls aren't injectable";
  leg design read `find.js` before committing to the hedge and found the
  cheaper path (global-timer interception). The design reviewer then
  *executed* the leg's tick/drain recipes against the unmodified engine
  before implementation started. The divert condition never tripped.
- **Citation audits eliminated drift entirely.** 36 citations across the
  two leg specs (11 + 25), all verified at design time, zero stale by
  implementation time — the implementing Developers reported no
  improvisation gaps, and both legs matched their specs near-verbatim.
- **The DD10(b) recurrence class was caught at design time.** The
  preload-bridge declare rule (the M06 F4-leg-3 / F5-leg-1 recurrence) was
  written into leg 2's guidance as a "do not skip" step and applied
  correctly — the first flight since the class was named where it cost
  zero review cycles.
- **First flight under the deferred-review workflow** (leg design reviewed
  per leg; single code review + single commit at end of flight): clean.
  Zero fix cycles at the end-of-flight review; the Reviewer independently
  re-ran all gates and diff-compared every converted assertion. Caveat
  below under Process.
- **Scope discipline held on both edges**: `handleRemove`, the renderer's
  static `failNote`, and the other channels' `null`/`false` failure values
  all confirmed untouched, exactly as the specs bounded.

## What Could Be Improved

### Process

- The deferred-review workflow's first outing was a favorable case: two
  file-disjoint legs with no ordering dependency. This flight validates
  the mechanics, not the conflict handling — watch the first 3+-leg or
  shared-file flight (Flight 2's ESM sweep will be exactly that stress
  test).

### Technical

- **The contract handed to history is only partially match-stable.** Two
  of the eight pinned error strings interpolate dynamic text after the
  em-dash (`unknown-class: <classId>`, `session-failure: <e.message>`).
  A future caller can exact-match 6 of 8 branches; the other two need
  prefix matching. Acceptable now (the field is still dead data), but the
  flight's own rationale was "before history adds callers" — history's
  first consumer must match on prefix for those two branches.
- **A new, narrower asymmetry is now visible**: `handleRemove` is the lone
  bare-`{ok:false}` sibling among the three jar mutation channels that
  return result objects. Correctly out of scope here; noted as the natural
  trigger if the carried-debt ledger around this contract is revisited.

### Documentation

- The MockTimers recipe (per-test `enable`, never file-global; drain with
  real `setImmediate` around single-step ticks; never one big tick) lives
  only in a landed leg spec, which is not where future test authors will
  look. Given the zero-runtime-dep policy makes this the house answer to
  "how do we test retry/timeout logic fast," it belongs in CLAUDE.md —
  routed to Flight 3 (doc promotions) as a fourth edit rather than a
  standalone change.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| *(none — both legs implemented to spec; the clock-seam hedge was resolved at design time, not deviated from mid-leg)* | — | — |

## Key Learnings

- **"Hedge conditionally, resolve empirically" is the right shape for
  maintenance flight specs** at test/production boundaries: state the
  fallback, require leg design to verify the cheaper option first, record
  the finding prominently. This flight is the template case.
- **MockTimers intercepts global timers in-process** — for this codebase
  (globals-based timing throughout), timer-dependent logic is testable on
  fake time with no injection seam. The `observe.js`/`print.js` sleeps are
  the same class if their tests ever get slow.
- **Test metrics**: 1283/1283, 0 skip, 0 flakes (5 consecutive runs + a
  56-file standalone sweep). Internal duration at debrief time: mean
  ~1043ms across five runs (range 976–1128ms; flight-time measurements
  951–995ms — run-to-run variance, not regression). Trajectory: ~5.06s
  flat across all of M06 → ~1.0s now. The F3-debrief recommendation open
  for five consecutive flights is closed, exceeding its 60–75% estimate
  at ~81%. New tallest standalone files: `automation-mcp-server.test.js`
  (777ms), `downloads-store.test.js` (410ms), `automation-port.test.js`
  (323ms) — none new, all previously masked; none anywhere near a
  problem threshold.

## Recommendations

1. **Add the MockTimers recipe to Flight 3's doc leg** as a fourth
   CLAUDE.md edit (testing-patterns note alongside the three planned
   promotions).
2. **Carry the prefix-match note into history planning**: the first
   consumer of `result.error` on the jar data channels matches
   `unknown-class` and `session-failure` branches by prefix, not equality.
   One line in the history mission's relevant flight spec is enough.
3. **Proceed to Flight 2 (ESM) with its soft prerequisite now real**: the
   sub-second suite this flight delivered is what makes the ESM flight's
   many gate runs cheap. Flight 2 will also be the deferred-review
   workflow's first genuine stress test (4–5 legs, shared files) —
   observe it deliberately.

## Action Items

- [ ] Flight 3 leg design: include the MockTimers recipe as a fourth
      CLAUDE.md edit (from Recommendation 1)
- [ ] History mission planning: note prefix-matching for the two dynamic
      error branches (from Recommendation 2)
- [ ] Carried-debt ledger: `handleRemove` bare `{ok:false}` — trigger is
      the next revisit of the jar-channel result contract
