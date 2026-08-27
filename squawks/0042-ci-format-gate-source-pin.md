# Squawk 0042: No test pins the CI format gate — `format:check` could be dropped from a CI definition silently

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: 2026-08-27

## Report

Flight 5 wired `npm run format:check` into `ci/tasks/lint.yml` and `.github/workflows/ci.yml` and added the script to `package.json`, verified once by hand. Nothing guards it: a future edit to either CI file or to `package.json` scripts could remove the gate without any test going red. Add a source-scan test in the house style (`test/unit/seam-contract.test.js` or a sibling `ci-format-gate.test.js`) asserting: `package.json` `scripts["format:check"]` equals `prettier --check .`; `ci/tasks/lint.yml` contains `npm run format:check` after `npm run lint`; `.github/workflows/ci.yml` contains a step running `npm run format:check`. Neuter-verify by removing one invocation → red.

Source: Flight 5 debrief (Mission 17), recommendation 2; Developer debrief interview.

## Evidence

- `package.json` scripts; `ci/tasks/lint.yml` `run:` block; `.github/workflows/ci.yml` "Format check" step (PR #184)
- `grep -rn format:check test/unit` → no hits

## Corrective Action

Added `test/unit/ci-format-gate.test.js`, a static source-scan pin in the house style of
`test/unit/seam-contract.test.js` / `test/unit/a11y-audit-exit-codes.test.js` (read files with
`fs.readFileSync`, locate by anchor/token not line number, fail loudly with the actual extracted
value when an anchor is missing). Four tests:

1. `package.json` — `scripts["format:check"] === 'prettier --check .'` and
   `scripts.format === 'prettier --write .'`.
2. `ci/tasks/lint.yml` — contains `npm run lint` before `npm run format:check` (index-order check).
3. `.github/workflows/ci.yml` — a `- name: Format check` step whose `run:` is
   `npm run format:check`, positioned (by source index) after a `- name: Lint` step whose `run:`
   is `npm run lint`.
4. `.prettierignore` — still lists `src/preload/webview-preload.bundle.js` and `package-lock.json`,
   so the generated bundle/lockfile can't silently break the gate.

All four are presence/ordering checks against real files (no vacuous "assert absence of nothing"
case applies — the corrective action is purely additive), so every anchor asserts against an
extracted value and fails loudly, printing what was actually found, if the anchor is missing.

## Verification

Gates (from `~/projects/goldfinch`, branch `squawk/turnaround-2026-08-27-4`):
- `timeout 300 npm test` → 3843 tests, 0 fail (3839 pre-existing + 4 new in
  `ci-format-gate.test.js`).
- `npm run lint` → clean.
- `npm run typecheck` → clean.
- `npx prettier --check .` → "All matched files use Prettier code style!"

Neuter-verify (both restored after observing red):
- Removed the `npm run format:check` line from `ci/tasks/lint.yml` → re-ran the new test file:
  3 pass / 1 fail (the `ci/tasks/lint.yml` ordering test), confirming it's load-bearing. Restored
  the file; diff against the pre-edit copy showed no residual change; suite back to 4/4 green.
- Removed the `- name: Format check` / `run: npm run format:check` step from
  `.github/workflows/ci.yml` → re-ran the new test file: 3 pass / 1 fail (the ci.yml step test,
  with an assertion error naming the missing `- name: Format check` step). Restored the file;
  diff against the pre-edit copy showed no residual change; suite back to 4/4 green.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the Developers' reasoning) — one review round, clean; the Reviewer re-ran the lint.yml neuter check (3/4 red → 4/4 restored); batch turnaround 2026-08-27 (batch 4)
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-27 (batch 4)` on `squawk/turnaround-2026-08-27-4` (PR number recorded on the PR itself)

Batch gates at review: 3843/3843 tests, lint clean, typecheck clean, prettier --check clean.
