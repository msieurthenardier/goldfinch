# Squawk 0096: renderer.js's line count is pinned independently in two test files

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-20
**Completed**: —

## Report

`src/renderer/renderer.js`'s line count is asserted in **two** unrelated test
files, each carrying its own hardcoded copy of the number:

1. `test/unit/seam-contract.test.js` — `RENDERER_LINE_BUDGET`, the house
   line-budget pin documented in CLAUDE.md, with a `<=` comparison.
2. `test/unit/vault-restore-workflow-invariants.test.js:126` — a bare
   `assert.equal(lines, 1577, …)`, an EXACT-equality pin left over from
   M18 F3 Leg 3's "renderer.js is untouched by this leg" invariant.

Only the first is documented anywhere. The second is discoverable only by
grepping for the literal number, and its own comment history shows it has been
retargeted in lockstep on at least eight prior legs that legitimately changed
renderer.js — every one of those legs had to rediscover it.

Found during Mission 21 Flight 3 Leg 1, whose design-time citation audit searched
for `RENDERER_LINE_BUDGET` and therefore missed the second copy entirely. The leg
landed red until it was retargeted by hand.

This is the defect class Flight 2's debrief named: *"Two type sources is a
documented fact; four is a defect class. Enumeration claims decay silently.
Search for unclaimed sites; don't confirm claimed ones."* Same shape, different
constant.

## Evidence

```
$ grep -rn "renderer.js" test/unit/vault-restore-workflow-invariants.test.js
25:const RENDERER_JS_PATH = path.join(REPO_ROOT, 'src/renderer/renderer.js');
126:  assert.equal(lines, 1577, 'renderer.js line count matches the current landed source');

$ grep -n "RENDERER_LINE_BUDGET" test/unit/seam-contract.test.js
300:const RENDERER_LINE_BUDGET = 1577;
```

Both were `1577` before M21 F3 Leg 1; that leg moves both to its landed value.

## Corrective Action

*(written at completion)*

Candidate shape, not yet decided — this squawk logs the defect, and the fix needs
one read pass to choose between:
- single-source the constant (export it from one module, import in the other), or
- delete the exact-equality pin if `RENDERER_LINE_BUDGET`'s `<=` pin already
  covers its intent (the M18 F3 invariant was "this leg changes nothing", which
  a `<=` budget does not express — so this may not be a straight deletion), or
- keep both but add a cross-pin test asserting the two constants agree.

If choosing between these turns out to need design work rather than one read
pass, this fails the squawk qualification gate and escalates.

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —

## Disposition

Deferred to a turnaround — it is not in Mission 21 Flight 3's path (that flight
retargets both copies by hand, which is what every prior leg did).
