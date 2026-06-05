# Leg: verify-release-pipeline

**Status**: completed
**Flight**: [CI/CD Supply-Chain Hardening](../flight.md)

> **Interactive / outward-facing leg (operator-confirmed).** This leg pushes real tags to the **public** repo and publishes a transient public prerelease. It is NOT executed autonomously by an agent — the Flight Director guides the operator step-by-step, and the operator performs (or explicitly authorizes) each outward-facing action. Cleanup is mandatory.

## Objective
Prove the hardened release pipeline live: a valid prerelease tag (`v0.0.0-ci-test`) builds and publishes as a **prerelease** without pushing a README commit to `main`, while an invalid tag (`vtest`) is rejected and never publishes — then clean up all test tags, releases, and artifacts.

## Context
- Verifies F17/F18/F19 end-to-end on real GitHub Actions infrastructure, against the hardened workflows committed in legs 1–3 (commit `b467bb3`, on branch `flight/04-cicd-supply-chain-hardening`).
- A tag triggers `build.yml` using the workflow file **as of the tagged commit**, so tagging the feature-branch HEAD exercises the hardened pipeline before merge.
- `v0.0.0-ci-test` is valid prerelease semver → passes the release validate step, classified `is_stable=false` → publishes as a GitHub **prerelease** (does not move `latest`), and `update-readme` is **skipped** (so `main` is never touched).
- Operator pre-authorized the live-tag approach during flight planning. Fork / `workflow_dispatch` dry-run remains the documented fallback if the public prerelease is not acceptable at execution time.

## Preconditions
- [ ] Operator go/no-go obtained for pushing test tags + publishing a transient public prerelease (or chooses the fork/dispatch fallback).
- [ ] `gh` authenticated with repo write (confirmed: account `msieurthenardier`, ssh).
- [ ] Branch `flight/04-cicd-supply-chain-hardening` pushed (done — PR #16).
- [ ] PR CI check (hardened `ci.yml`) is green — confirms SHA-pinned actions resolve and least-privilege `permissions` don't break the PR build-check (free pre-check, no outward-facing action).

## Acceptance Criteria
- [ ] **PR CI green**: the `ci.yml` run on PR #16 passes (SHA-pinned actions resolve under `contents: read`).
- [ ] **Valid prerelease publishes correctly**: pushing `v0.0.0-ci-test` (on the feature-branch HEAD) →
  - the `build` matrix runs and the `release` job's validate step classifies it `is_stable=false`;
  - a GitHub **prerelease** is created (marked prerelease; `latest` pointer unchanged);
  - the `update-readme` job is **skipped** (no commit/push to `main`; `git log origin/main` unchanged).
- [ ] **Invalid tag rejected**: pushing `vtest` → the pipeline does **not** publish any release (the `build` job's `npm version test` fails fast — red run — and `release` never runs). Confirm no release/tag artifact is published for `vtest`.
- [ ] **Cleanup complete (mandatory)**: the `v0.0.0-ci-test` prerelease (incl. uploaded installer artifacts) and both the `v0.0.0-ci-test` and `vtest` tags are deleted from the remote; `gh release list` and `git ls-remote --tags origin` show neither.

## Verification Steps (operator-guided, one at a time)
1. **PR CI** — `gh run list --branch flight/04-cicd-supply-chain-hardening` → the `CI` (pull_request) run is `success`. View failing logs if not.
2. **Push valid prerelease tag** *(operator-authorized outward action)* — `git tag v0.0.0-ci-test b467bb3 && git push origin v0.0.0-ci-test`. Then watch: `gh run watch` / `gh run list --workflow build.yml`.
3. **Assert prerelease published, README untouched** —
   - `gh release view v0.0.0-ci-test` → exists, `Pre-release: true`, has installer assets.
   - `gh release list` → `latest` is NOT `v0.0.0-ci-test` (the prior stable release, if any, still latest).
   - `gh run view --log <build-run-id>` → the `update-readme` job shows as **skipped**; `git fetch origin main && git log origin/main -1` → unchanged (no `docs: update download links for v0.0.0-ci-test` commit).
4. **Push invalid tag** *(operator-authorized outward action)* — `git tag vtest b467bb3 && git push origin vtest`. Watch the run.
5. **Assert rejection** — the `build` job fails at `Set version from tag` (`npm version test` → invalid); `release` never runs; `gh release view vtest` → not found.
6. **Cleanup (mandatory)** *(operator-authorized)* —
   - `gh release delete v0.0.0-ci-test --yes --cleanup-tag` (deletes the prerelease + its tag), or `gh release delete v0.0.0-ci-test --yes` then `git push origin :refs/tags/v0.0.0-ci-test`.
   - `git push origin :refs/tags/vtest` (delete the invalid tag); delete the local tags too.
   - Confirm: `gh release list` shows no `v0.0.0-ci-test`; `git ls-remote --tags origin` shows neither test tag.

## Edge Cases
- **`electron-builder` + prerelease version**: the build job's `npm version 0.0.0-ci-test` sets `package.json` to a prerelease string; confirm installer artifact naming isn't disrupted (Reviewer carry-forward). If artifacts fail to name/build, that's a finding to note — not a gating failure of F19 itself.
- **`vtest` still consumes 3 matrix runners briefly** before `npm version` fails — expected; it fails fast in an early step.
- **If the public prerelease is unacceptable at run time**: abort the live path and use the `workflow_dispatch`/fork dry-run fallback instead; record the substitution in the flight log.
- **Cleanup is non-negotiable** — do not leave `v0.0.0-ci-test`/`vtest` tags or the prerelease on the public repo.

## Files Affected
- None (no repo files change). This leg produces verification evidence recorded in the flight log; the only mutations are transient remote tags/releases that are then deleted.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified (incl. cleanup confirmed)
- [ ] Update flight-log.md with the live-run evidence (run IDs, prerelease URL before deletion, rejection confirmation, cleanup confirmation)
- [ ] Set this leg's status to `completed`
- [ ] Check off this leg in flight.md
- [ ] Final leg → update flight.md status to `landed`, check off the flight in mission.md, mark PR ready for review
