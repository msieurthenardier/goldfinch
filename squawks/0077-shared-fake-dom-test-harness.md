# Squawk 0077: Extract a shared fake-DOM test harness for chrome controller tests

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-15
**Completed**: —

## Report

`test/unit/load-failure-controller.test.js` (M20 F1 leg 2) lifts its own
minimal `FakeElement`/`FakeClassList`/`FakeDocument` because
`test/unit/tab-controller.test.js`'s harness is module-private. That is the
second hand-rolled fake DOM for a chrome controller (the 2026-08-27
maintenance report's F18 already counted five hand-rolled fake sets across
the suite). Flight 2's interstitial controller and Flight 3's crash controller
will each need the same fakes — a third and fourth copy unless extracted now.

## Evidence

- `test/unit/tab-controller.test.js` — `FakeElement` (innerHTML setter with a
  fixed selector list incl. `.tab-status`), `querySelector` map; not exported.
- `test/unit/load-failure-controller.test.js` — independent lifted copy sized
  to what that controller touches (flight log, leg 2 entry: "lifted, not
  imported").
- `maintenance/2026-08-27.md` F18: "Five test files hand-roll
  FakeElement/FakeDocument/fakeIpc — extract `helpers/fake-dom.js`".

## Corrective Action

_(written at completion)_ Create `test/unit/support/fake-dom.js` exporting
`FakeElement`, `FakeClassList`, `FakeDocument`, `makeFakeDocument()` with the
union of the two current harnesses' behavior (selector list, dataset,
classList, focus/activeElement tracking); switch both test files to import
it; no test semantics change (assert the two suites' counts are unchanged).

## Verification

`node --test test/unit/tab-controller.test.js test/unit/load-failure-controller.test.js`
green with identical test counts; `grep -c "class FakeElement" test/unit/*.test.js`
returns 0 for those two files.

## Sign-Off

_(written at completion)_
