# Squawk 0226: Two release-workflow invariant pins can be satisfied by the wrong text

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-19
**Completed**: —

## Report
Two pins added in Mission 24 Flight 1 can pass when they should fail:

1. **The fuse-check pin finds its step with a substring.** It uses `jobs.build.indexOf('Check Electron fuses')`, so a comment mentioning that name earlier in the job body would satisfy it. It should find the step by its step header (`- name: Check Electron fuses`), for example with the file's existing `stepOf` helper.
2. **The `upload` pin can be defeated by `always()`.** It requires `needs.build.result == 'success'` and forbids `!=`. But an added `always()` in `upload`'s `if:`, combined with the success test through `||`, could let `upload` run when a build entry failed. The pin should forbid `always()` (and a `||` that bypasses the success test) in that condition.

Test-only hardening; there is no workflow change.

## Evidence
- `test/unit/release-workflow-invariants.test.js`: the fuse-check and `upload`-condition tests (Mission 24 Flight 1, leg `release-runs-audit`).
- `missions/24-maintenance/flights/01-release-integrity/flight-debrief.md`, *Technical*; flight review non-blocking note 3.

## Corrective Action
*(written at completion)*

## Verification
Each pin goes red under its new mutation: a comment carrying the fuse step's name with the step removed, and `always() || needs.build.result == 'success'` in `upload`'s `if:`. Each is neuter-verified, and `npm test` is green.
