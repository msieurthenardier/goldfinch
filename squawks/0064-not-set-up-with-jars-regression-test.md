# Squawk 0064: add a not-set-up-with-jars regression test to vault-page-model.test.js

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-06
**Completed**: 2026-09-11

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

Added one new test to `test/unit/vault-page-model.test.js` (after the
existing `restoreDestinationOptions: empty/malformed jar list …` case,
before the `restoreOutcomeLines` section): `squawk 0064: not-set-up
mode (selectVaultView vaults: []) with pre-existing vault-less jars —
restoreDestinationOptions still offers them as existing destinations,
and the name-match prefill picks the matching container`. It first
calls `selectVaultView({ setUp: false, unlocked: false, vaults: [] })`
and asserts `mode === 'not-set-up'` / `view.vaults` is `[]` (documenting
that the view itself carries no vault list in this mode), then calls
`restoreDestinationOptions(jars, {}, 'Work')` against the existing
`jars` fixture (`personal`/`work`, both vault-less) fed independently
of `view.vaults` and asserts both jars are offered labeled "— no
secrets yet" and that `matched` resolves to the `work` option (the
name-match prefill against `bundleName`). Test-only — no production
change to `src/shared/vault-page-model.js`.

## Verification

`node --test --test-timeout=60000 test/unit/vault-page-model.test.js`
— 47/47 pass (was 46 before this change), including the new case.
Also green as part of the full `npm test` run (4433/4433 pass). No
production files touched.

## Sign-Off

**Reviewer**: independent Reviewer (Sonnet)
**Verdict**: confirmed
**Commit**: squawk: turnaround 2026-09-11 (Squawks: 0064, 0065, 0066, 0067, 0068)
