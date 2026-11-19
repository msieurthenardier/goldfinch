# Squawk 0227: The release-state `jq` test runs on no routine host

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-19
**Completed**: 2026-11-19

## Report
Squawk 0209 made the release-state `jq` test report as skipped instead of passing when `jq` is absent. But no host that runs `npm test` routinely has `jq`. The dev host lacks it, and so does the Concourse test image (`node:22`, the pinned digest). Only the manual `workflow_dispatch` `ci.yml` run on `ubuntu-latest` would execute it. So the check on `create-release`'s `--jq` expression (none / draft / published) effectively never runs. Give it a routine home, for example by installing `jq` in the Concourse test task before `npm test`.

## Evidence
- `ci/tasks/test.yml`: image `node` tag `22`, digest `sha256:e13726ca…`; the run script is `npm ci; npm test`, with no `jq` install. `docker run --rm node:22@<that digest> sh -c 'command -v jq'` prints nothing (checked 2026-11-19).
- `.github/workflows/ci.yml`: `runs-on: ubuntu-latest`, `workflow_dispatch` only.
- `test/unit/release-workflow-invariants.test.js`: `HAS_JQ` and `{ skip: HAS_JQ ? false : 'jq not installed' }` (squawk 0209).

## Corrective Action
`ci/tasks/test.yml` run script now runs `apt-get update -qq`, `apt-get install -y -qq --no-install-recommends jq` and `jq --version` before `npm ci` / `npm test` (still `bash -ceu`, so an install failure fails the task). Image and digest unchanged. `ci/README.md` gains a "`jq` in the test task" section (before "Accepted advisories") saying why (the release-state test, squawk 0227). `test/unit/ci-image-pins.test.js` only scans the `image_resource` block, so no pin needed updating. The test's skip on a host without `jq` remains for dev hosts; deliberately NOT made red under CI (a design change).

## Verification
A Concourse `test` run (or a `fly execute` of `ci/tasks/test.yml`) shows the `jq` test as passing, not `# SKIP`. Any added package install is pinned or comes from the image's own distribution, and is noted in `ci/README.md`.

Ran (2026-11-19): `docker run --rm -v "$PWD":/repo:ro -w /repo node:22@sha256:e13726ca…cfb bash -ceu 'apt-get update -qq && apt-get install -y -qq --no-install-recommends jq >/dev/null && jq --version && node --test --test-timeout=60000 test/unit/release-workflow-invariants.test.js'` printed `jq-1.6`, then `ok 26 - release state jq expression gives none / draft / published (when jq is installed)`; file totals: 33 tests, pass 33, fail 0, skipped 0. Host gate: `npm test` 7388 tests, pass 7383, fail 0, skipped 1, todo 4; lint, typecheck, format:check clean. A real Concourse `test` run remains to be observed by the operator.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the second 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. The task still runs under `bash -ceu`, so an apt failure fails it; image tag and digest unchanged and `ci-image-pins` passes; the `ci/README.md` note is accurate. Verified under Docker on the pinned image only (`jq-1.6`, the `jq` test `ok`, 33/33); the first real Concourse `test` run is the operator's to observe. Gates at review: `npm test` 7,388 tests (7,383 pass, 0 fail, 1 skipped — the `jq` test, no `jq` on the dev host — and 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-b`
