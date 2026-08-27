# Squawk 0042: No test pins the CI format gate — `format:check` could be dropped from a CI definition silently

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

Flight 5 wired `npm run format:check` into `ci/tasks/lint.yml` and `.github/workflows/ci.yml` and added the script to `package.json`, verified once by hand. Nothing guards it: a future edit to either CI file or to `package.json` scripts could remove the gate without any test going red. Add a source-scan test in the house style (`test/unit/seam-contract.test.js` or a sibling `ci-format-gate.test.js`) asserting: `package.json` `scripts["format:check"]` equals `prettier --check .`; `ci/tasks/lint.yml` contains `npm run format:check` after `npm run lint`; `.github/workflows/ci.yml` contains a step running `npm run format:check`. Neuter-verify by removing one invocation → red.

Source: Flight 5 debrief (Mission 17), recommendation 2; Developer debrief interview.

## Evidence

- `package.json` scripts; `ci/tasks/lint.yml` `run:` block; `.github/workflows/ci.yml` "Format check" step (PR #184)
- `grep -rn format:check test/unit` → no hits

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
