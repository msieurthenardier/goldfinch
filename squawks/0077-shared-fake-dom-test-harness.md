# Squawk 0077: Extract a shared fake-DOM test harness for chrome controller tests

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-15
**Completed**: 2026-09-15

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

Completed as part of Mission 20 Flight 2 Leg 1 (`focus-trace-and-surface-substrate`).
Created `test/unit/helpers/fake-dom.js` (the `helpers/jars-page-dom.js` naming
precedent — NOT `test/unit/support/fake-dom.js` / `makeFakeDocument()`, this
report's original draft names) exporting `{ FakeClassList, FakeElement,
createFakeDocument }`, the UNION of the two divergent harnesses rather than a
subset: `tab-controller.test.js`'s `FakeElement` had an `innerHTML` setter that
auto-populates `_parts` with `.tab-title`/`.tab-close`/`.tab-fav`/`.tab-status`
(load-bearing — `tab-controller.js` builds the strip button via `innerHTML`),
plus `style`/`disabled`/`value`/`tabIndex`/`parent`/`insertBefore`/`remove()`/
`getBoundingClientRect()`; `load-failure-controller.test.js`'s had no
`innerHTML` setter (a local `makeBtn()` helper pre-assigns `_parts` instead)
but carried `textContent` get/set, `focus()`/`focused`, `click()`. Both
feature sets are kept on the one shared `FakeElement`; the `innerHTML`
auto-populate selector set is now a constructor option (`innerHTMLParts`,
defaulting to the tab-strip set) rather than hardcoded, so a future consumer
outside the tab strip isn't stuck with tab-strip selectors. `createFakeDocument()`
unions the two `document` fakes too (`createElement` with `__created`
tracking + `addEventListener` + `activeElement`/`body`). Both target files
now import the helper and define no local `FakeClassList`/`FakeElement`; no
test semantics changed (both suites pass with their pre-existing test counts:
28/28 for `tab-controller.test.js`, 15/15 for `load-failure-controller.test.js`).

**Four further hand-rolled copies exist, OUT of this squawk's scope** (leg-1
design review, folded into the leg spec's Implementation Guidance): `test/unit/bookmarks-bar.test.js`,
`test/unit/tab-boundary.test.js`, `test/unit/vault-card-icon.test.js`,
`test/unit/vault-fill-icon.test.js` — each has its own local `FakeElement`
shaped for its own narrow needs (none builds via `innerHTML`, none shares the
tab-strip/load-failure duplication this squawk was filed against). Listed
here as future consolidation candidates for a later maintenance pass, not
absorbed now (widening this squawk's diff to four more files not yet asking
for it was judged out of proportion to the reported defect).

## Verification

`node --test --test-timeout=60000 test/unit/tab-controller.test.js test/unit/load-failure-controller.test.js`
green with identical test counts (28/28, 15/15) to before the extraction.
`grep -n "class FakeClassList\|class FakeElement" test/unit/tab-controller.test.js
test/unit/load-failure-controller.test.js` → empty (the four out-of-scope
files listed above are excluded from this specific check — a repo-wide
`test/unit/*.test.js` grep still finds them, by design). `grep -n
"helpers/fake-dom" test/unit/tab-controller.test.js test/unit/load-failure-controller.test.js`
→ both files.

## Sign-Off

**Reviewer**: flight-end Reviewer agent (Sonnet), Mission 20 Flight 2, 2026-09-16
**Verdict**: confirmed — shared harness used by both named tests; the four other hand-rolled copies recorded as out of scope
**Commit**: `flight/02: TLS trust …` on `flight/02-tls-trust` (absorbed by leg 1 per operator ruling)
