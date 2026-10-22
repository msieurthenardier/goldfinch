# Squawk 0149: Apply the actions/setup-node 7.0.0 → 7.1.0 bump (Dependabot #257)

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-22
**Completed**: 2026-10-22

## Report
Dependabot PR #257 ("bump actions/setup-node from 7.0.0 to 7.1.0") updates the `Set up Node` step in both GitHub workflows. Apply it through the squawk flow so the SHA-pin hardening rule (CLAUDE.md → Release / CI) is checked, not taken on trust. 7.1.0 is a minor release: `mise.toml` support, absolute `node-version-file` paths, and Node version validation with manifest fetch retry. Neither workflow uses `node-version-file`, so none of that changes behavior here.

## Evidence
- PR #257 (`dependabot/github_actions/actions/setup-node-7.1.0`) changes one line in each of `.github/workflows/build.yml` and `.github/workflows/ci.yml`: `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0` → `@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0`.
- `git ls-remote https://github.com/actions/setup-node refs/tags/v7.1.0` → `949feb2413d6458794dcd2491c4babbbce0c15c1` (a lightweight tag, so no `^{}` peel). Dependabot pinned the full commit SHA with the trailing `# v7.1.0` comment, so the hardening is intact.
- `ci.yml` is `workflow_dispatch`-only, so `build.yml` runs this step for real only on the next `v*` tag push. PR #257 reports no checks.

## Corrective Action
Applied #257's exact delta (`gh pr diff 257 | git apply`, `--check` clean): `actions/setup-node` `820762786026740c76f36085b0efc47a31fe5020 # v7.0.0` -> `949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0`, one line each in `.github/workflows/build.yml` and `.github/workflows/ci.yml`. No source changes.

## Verification
Static checks done (Developer, 2026-10-22):
- `git ls-remote https://github.com/actions/setup-node refs/tags/v7.1.0 'refs/tags/v7.1.0^{}'` -> `949feb2413d6458794dcd2491c4babbbce0c15c1` (lightweight tag); matches the pinned SHA.
- Every `uses:` line in `.github/workflows/` matches `@<40-hex SHA> # vX.Y.Z` (grep for non-matching lines returned none).
- `git diff --stat`: only the two workflow files (1 line each) plus this squawk file.
- `npx prettier --check .github/workflows squawks/0149-*.md`: clean.
- Not run: `build.yml` exercises the step only on the next `v*` tag push; `ci.yml` is `workflow_dispatch`-only.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped)
**Verdict**: confirmed, no blocking or non-blocking issues. The Reviewer re-resolved the v7.1.0 tag independently (`949feb2…`, a lightweight tag) and confirmed it matches both pins. It also confirmed every `uses:` in `.github/workflows/` is SHA-pinned with a version comment, and that the diff is exactly one line per workflow.
**Commit**: the `squawk: turnaround 2026-10-22` commit on `squawk/turnaround-2026-10-22` (supersedes Dependabot #257)
