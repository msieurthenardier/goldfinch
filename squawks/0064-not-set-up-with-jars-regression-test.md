# Squawk 0064: add a not-set-up-with-jars regression test to vault-page-model.test.js

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-06
**Completed**: —

## Report

Flight 3 (Mission 18) HAT fix 8 fixed a real defect: the restore
mapping modal's "existing jar" destinations excluded vault-less
containers, so on a fresh adopt (where no jar has a vault yet) the
operator was forced to "new jar" and hit a same-name collision. The
root cause lives in a PURE, already-unit-tested module —
`selectVaultView` returns `vaults: []` in not-set-up mode
(`src/shared/vault-page-model.js`, ~:101-103) — yet no
`vault-page-model.test.js` case exercises `restoreDestinationOptions` /
`selectVaultView` in not-set-up mode WITH pre-existing (vault-less)
jars present. A test for that exact state would have caught fix 8's bug
before the HAT, at zero marginal cost. The fix landed without that
dedicated regression pin; add it so the surface can't silently regress.

## Evidence

- `src/shared/vault-page-model.js` — `selectVaultView` (~:101-103,
  `vaults: []` in not-set-up), `restoreDestinationOptions` (the HAT-8
  destination builder that now merges `jarRows`).
- `test/unit/vault-page-model.test.js` — covers `selectVaultView` and
  `restoreDestinationOptions`, but no not-set-up-mode-with-jars case
  (the fix-8 state space).
- Flight 3 debrief, Developer interview: "no unit test asserts what
  restoreDestinationOptions/selectVaultView do when a not-set-up
  profile does have existing vault-less jars."

## Corrective Action

*(written at completion)*

## Verification

*(written at completion — expected: a new `vault-page-model.test.js`
case asserting that in not-set-up mode with pre-existing vault-less
jars, `restoreDestinationOptions` offers those jars as existing
destinations labeled "no secrets yet", and the name-match prefill
picks the matching container; full suite green. Test-only, no
production change.)*

## Sign-Off

*(written at completion)*
