# Squawk 0227: The release-state `jq` test runs on no routine host

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-19
**Completed**: —

## Report
Squawk 0209 made the release-state `jq` test report as skipped instead of passing when `jq` is absent. But no host that runs `npm test` routinely has `jq`. The dev host lacks it, and so does the Concourse test image (`node:22`, the pinned digest). Only the manual `workflow_dispatch` `ci.yml` run on `ubuntu-latest` would execute it. So the check on `create-release`'s `--jq` expression (none / draft / published) effectively never runs. Give it a routine home, for example by installing `jq` in the Concourse test task before `npm test`.

## Evidence
- `ci/tasks/test.yml`: image `node` tag `22`, digest `sha256:e13726ca…`; the run script is `npm ci; npm test`, with no `jq` install. `docker run --rm node:22@<that digest> sh -c 'command -v jq'` prints nothing (checked 2026-11-19).
- `.github/workflows/ci.yml`: `runs-on: ubuntu-latest`, `workflow_dispatch` only.
- `test/unit/release-workflow-invariants.test.js`: `HAS_JQ` and `{ skip: HAS_JQ ? false : 'jq not installed' }` (squawk 0209).

## Corrective Action
*(written at completion)*

## Verification
A Concourse `test` run (or a `fly execute` of `ci/tasks/test.yml`) shows the `jq` test as passing, not `# SKIP`. Any added package install is pinned or comes from the image's own distribution, and is noted in `ci/README.md`.
