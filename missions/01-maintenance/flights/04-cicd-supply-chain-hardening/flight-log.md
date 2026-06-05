# Flight Log: CI/CD Supply-Chain Hardening

**Flight**: [CI/CD Supply-Chain Hardening](flight.md)

## Summary
In flight (started 2026-06-05). Branch `flight/04-cicd-supply-chain-hardening`. 4 legs: `workflow-token-permissions`, `sha-pin-actions`, `release-gating`, `verify-release-pipeline`.

---

## Flight Director Notes

- **Phase file**: loaded `.flightops/agent-crews/leg-execution.md` — well-formed (Crew / Interaction Protocol / Prompts present). Developer = Sonnet, Reviewer = Sonnet.
- **Flight marked `in-flight`**; branch `flight/04-cicd-supply-chain-hardening` created from `main`.
- **Leg 4 (`verify-release-pipeline`) is interactive/outward-facing**, not a standard autonomous code leg: it pushes real `v*` tags to the public repo and publishes a transient public prerelease. Decision: legs 1–3 run the autonomous Developer/Reviewer cycle with deferred review+commit (per skill); leg 4 is run as an **operator-confirmed guided step** (HAT-like) after the hardened workflows are committed/pushed, since an agent must not autonomously push tags / publish releases to a public repo. Cleanup (delete tags + release + artifacts) is mandatory and operator-confirmed.
- **Legs 1–3 design-reviewed (Developer, per leg) + flight-level reviewed (Reviewer) — all `[HANDOFF:confirmed]`.** Working tree green at review: `npm test` 147 pass / 0 fail, lint clean, typecheck clean. SHA pins, permissions, and the semver gate verified live by the reviewers. Committing legs 1–3 (deferred single commit) and opening a draft PR; leg 4 follows as the operator-guided verification.
- **Carry-forward into Leg 4 (Reviewer open question):** before/at the live `v0.0.0-ci-test` run, glance whether a prerelease version string in `package.json` (set by the build job's `npm version`) disrupts `electron-builder` artifact naming — out of scope for legs 1–3's files, but worth confirming on the live run.

---

## Reconnaissance Report

Source artifact: [Maintenance Report 2026-06-05](../../../../maintenance/2026-06-05.md) (findings F16–F19), cross-checked against carry-forwards in the [Flight 3 debrief](../03-electron-upgrade/flight-debrief.md). Verified against current `main` (working tree clean) on 2026-06-05.

| Item | Classification | Evidence | Recommendation |
|------|----------------|----------|----------------|
| F17 — least-privilege top-level `permissions:` | `confirmed-live` | `build.yml` has no top-level `permissions:` (per-job `contents: write` on `release` L70-71 + `update-readme` L91-92 only); `ci.yml` has no `permissions:` at any level | Real work. Add `permissions: contents: read` top-level to both files; keep per-job writes. (Repo-default-token-to-read-only is a GitHub Settings action, not a file change — track as a manual checklist item, not a leg deliverable.) |
| F16 — README auto-update no longer pushes to `main` unreviewed | `confirmed-live` | `build.yml:112` `git push origin HEAD:main` in `update-readme` job, as `github-actions[bot]` with `contents: write` | Real work. Design decision needed: with branch protection unavailable on the current tier (mission constraint), "no longer unreviewed" means a bot-opened PR left for human merge, or a protected `environment:` with a required reviewer. |
| F18 — third-party actions SHA-pinned | `partially-satisfied` | **SHA-pinning: `confirmed-live`** — all `uses:` still reference mutable major tags: `checkout@v4`, `setup-node@v4`, `upload/download-artifact@v4`, and the non-GitHub `softprops/action-gh-release@v2` (runs with `contents: write`, `build.yml:79`). **Dependabot for `github-actions`: `already-satisfied`** — `.github/dependabot.yml` (committed in Flight 3, `805ce38`) already declares `package-ecosystem: github-actions`, weekly | Scope down: SHA-pin all `uses:` (prioritize the non-GitHub action); the Dependabot half is done — Dependabot will keep the pins current. Do NOT re-add a Dependabot github-actions block. |
| F19 — release job restricted to semver `v*` tags with gating | `confirmed-live` (threat narrower than stated) | `release` job condition is `startsWith(github.ref, 'refs/tags/')` — not `…/v` — with `generate_release_notes: true` and no semver/draft gating (`build.yml:67`). **Nuance:** the workflow `on.push.tags` is already `'v*'` (L9-10), so non-`v` tags never trigger the workflow at all; the genuine residual threat is a `v`-prefixed **non-semver** tag (`vtest`, `vfoobar`, `v1`) that matches the `v*` glob | Real work, narrowed. Tighten the `release` condition and add a strict-semver validation step before publish; consider `draft: true` + manual promote; document a rollback runbook. |

**Carry-forwards from the Flight 3 debrief (not maintenance-report items):**
- **Dependabot for `electron` (Flight 3 Action Item #1)** — `already-satisfied`: the npm ecosystem entry in `.github/dependabot.yml` covers `electron`. The debrief checkbox was left unchecked but the file was committed in `805ce38`. No work needed; will note as satisfied.
- **Audit-gate false-positive triage policy** — CI-surface item (concerns `ci.yml`'s `npm audit --audit-level=high` step). Candidate to fold in as a documentation deliverable since it shares the workflow surface.
- **`farbling-correctness` behavior spec** — NOT a CI surface (a privacy-feature behavior test). Recommend keeping separate from this flight per the no-unrelated-bundling rule; flag for the user as its own micro-task / Flight 5-adjacent.

**Net:** 4 source findings → 3 fully-live (F17, F16, F19), 1 scoped-down (F18: SHA-pinning live, Dependabot half retired). No item fully retired.

---

## Leg Progress

### Leg 01 — workflow-token-permissions (status: landed, 2026-06-05)

Implemented F17 least-privilege top-level token scope.

**Changes:**
- `.github/workflows/build.yml` — added top-level `permissions: contents: read` (with explanatory comment) after the `on:` block, before `jobs:` (now at L13-16). Per-job `contents: write` on `release` and `update-readme` left untouched (shifted to L75 / L96 by the insertion). No per-job permissions added to `build` (inherits read; uses artifact API + `electron-builder --publish never`, no contents write needed).
- `.github/workflows/ci.yml` — added top-level `permissions: contents: read` after the `concurrency:` block, before `jobs:` (L16-17). `build-check` job has no per-job permissions (read-only PR check).

**Validation:**
- YAML parse (js-yaml@4 via node): both files parse OK.
- `grep -n "permissions:" build.yml` → 3 matches (top-level L14 + per-job L75, L96). ✓
- `grep -n "permissions:" ci.yml` → 1 match (top-level L16). ✓
- Manual read: `build` job still has `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` and `--publish never`; `release`/`update-readme` writes intact.

Workflows-only change; no application source touched. Commit deferred to flight-level review.

### Leg 02 — sha-pin-actions (status: landed, 2026-06-05)

Implemented F18 SHA-pinning of all `uses:` directives + bundled audit-gate triage policy (Flight 3 carry-forward). SHAs applied verbatim from the leg's pre-resolved table (no network lookup).

**Changes:**
- `.github/workflows/build.yml` — pinned all 6 `uses:` to 40-char SHA + `# vX.Y.Z` comment: `actions/checkout` ×2 (build job L33, update-readme job L100 — the second is easy to miss), `actions/setup-node` (L36), `actions/upload-artifact` (L59), `actions/download-artifact` (L79), `softprops/action-gh-release` (L84, the priority non-GitHub pin in the `release` job). All `with:` blocks preserved unchanged (setup-node node-version/cache, upload/download name/path, update-readme checkout `ref: main`, action-gh-release files/generate_release_notes).
- `.github/workflows/ci.yml` — pinned 2 `uses:`: `actions/checkout` (L25), `actions/setup-node` (L28, `with:` preserved). Added the 6-line audit-gate triage-policy comment block immediately above the `- name: Dependency audit` step (L46-51): a high in the dev-only tree (electron-builder's tar/cacache/node-gyp chain) vs. a high in runtime `electron`; remediation is always to bump the dep, never to lower `--audit-level` or delete the step.

**Validation:**
- `grep -cE "uses:.*@[0-9a-f]{40}" build.yml` → 6 ✓; ci.yml → 2 ✓.
- `grep -nE "uses:.*@v[0-9]" *.yml` → no output (no mutable tags remain) ✓.
- YAML parse (python3 yaml.safe_load): both files OK ✓.
- `git diff .github/dependabot.yml` → empty (untouched; Dependabot github-actions block from Flight 3 intact) ✓.
- Audit-triage comment confirmed present above the audit step ✓.

No action majors upgraded, no `with:` inputs changed — behavior unchanged. Workflows-only; no application source touched. Commit deferred to flight-level review.

### Leg 03 — release-gating (status: landed, 2026-06-05)

Implemented F19 release gating: strict-semver validation + stable/prerelease classification, and gated `update-readme` to stable releases only. YAML and regex copied verbatim from the leg's Implementation Guidance.

**Changes:**
- `.github/workflows/build.yml`:
  - `release` job `if:` tightened from `refs/tags/` → `refs/tags/v` (L72).
  - Added `outputs: is_stable: ${{ steps.ver.outputs.is_stable }}` to the `release` job (L77-78).
  - Inserted `Validate semver tag and classify stability` (id `ver`, `shell: bash`) as the FIRST step of `release`, before "Download all installers": strips leading `v`, fails with `::error::` + `exit 1` on non-strict-semver, else writes `is_stable=true|false` to `$GITHUB_OUTPUT` (false when the version core carries a `-prerelease`; build metadata stripped via `${ver%%+*}` first). Existing download-artifact / create-release SHA pins untouched.
  - Added `prerelease: ${{ steps.ver.outputs.is_stable != 'true' }}` to the `Create GitHub Release` step's `with:` (L110); action SHA pins unchanged.
  - `update-readme` job `if:` replaced from `refs/tags/v` → `${{ needs.release.outputs.is_stable == 'true' }}` (L116); `needs: release` already present; steps unchanged (no `always()` added — deliberate, gate carries implicit `success()`).
- `scripts/update-readme.mjs` (the flight's single permitted source touch) — line 7 regex anchored: `/^\d+\.\d+\.\d+/` → `/^\d+\.\d+\.\d+$/`. Only line 7 changed.

**Validation:**
- YAML parse (python3 yaml.safe_load) of `build.yml` → OK ✓.
- `node --check scripts/update-readme.mjs` → no error ✓.
- Offline JS regex (`/^\d+\.\d+\.\d+$/`): `0.0.0-ci-test false`, `1.2.3 true`, `test false` ✓.
- Offline bash semver regex: `v1.2.3 match`, `v0.0.0-ci-test match`, `vtest no`, `v1 no` ✓.
- `grep "refs/tags/v"` → release `if` (L72) + build "Set version from tag" `if` (L47) ✓; `grep "needs.release.outputs.is_stable"` → present on `update-readme` (L116) ✓.
- `grep "is_stable"` → 5 occurrences: job `outputs:` (L78), validate-step false/true writes (L93, L96), `prerelease:` input (L110), `update-readme` `if:` (L116) ✓.
- Anchored regex present in `update-readme.mjs:7` ✓.

Workflows + the one permitted script-line touch only; no other application source changed. Commit deferred to flight-level review.

### Leg 04 — verify-release-pipeline (status: completed, 2026-06-05)

Live operator-confirmed verification of the hardened release pipeline against the committed feature-branch HEAD (`b467bb3`). Operator gave explicit go for the outward-facing live-tag test.

**Baseline before test:** `origin/main` HEAD `a4e6dae` (v0.4.0 README commit); latest release `v0.4.0`.

**Evidence:**
- **PR CI (free pre-check):** `ci.yml` on PR #16 → `success` (30s). Confirms the SHA-pinned actions resolve under top-level `contents: read` and the least-privilege scope doesn't break the PR build-check. (F17+F18 live-validated.)
- **Valid prerelease `v0.0.0-ci-test`** (pushed on `b467bb3`, build run `27037766766` → success):
  - `Validate semver tag and classify stability` passed; classified prerelease.
  - GitHub release created: `isPrerelease=true`, `isDraft=false`, **5 installer assets** (electron-builder built cleanly with the prerelease version string — resolves the Reviewer's `package.json`-naming carry-forward concern: no disruption).
  - **`latest` pointer unchanged** — `v0.4.0` remained "Latest"; the prerelease did not steal it.
  - **`update-readme` job → skipped** (stable-only gate held); `origin/main` HEAD still `a4e6dae` — no bogus README commit pushed. (F19 stable-gate live-validated.)
- **Invalid tag `vtest`** (pushed on `b467bb3`, build run `27037944773` → failure):
  - All 3 `Build` jobs failed at `Set version from tag` (`npm version test` → invalid version); `Publish release` → **skipped**; `Update README` → **skipped**; `gh release view vtest` → **not found**. Nothing published. (F19 rejection path live-validated — caught by the build job's `npm version`, exactly as leg-03 designed.)
- **Cleanup (mandatory) — complete:** `gh release delete v0.0.0-ci-test --yes --cleanup-tag` (release + 5 assets + tag); `git push origin :refs/tags/vtest`; local tags deleted. Confirmed: `gh release view v0.0.0-ci-test` → not found; `git ls-remote --tags origin` → no test tags; `v0.4.0` is Latest again; `origin/main` still `a4e6dae`.

All four acceptance criteria met. No repo files changed by this leg (only transient remote tags/releases, now deleted).

---

## Decisions

---

## Deviations

---

## Anomalies

### Pinned actions run on Node.js 20 (deprecation horizon)
**Observed:** The `v0.0.0-ci-test` build run emitted GitHub annotations that the pinned action versions (`actions/checkout@…#v4.3.1`, `actions/setup-node@…#v4.4.0`, `actions/upload-artifact@…#v4.6.2`, `actions/download-artifact@…#v4.3.0`, `softprops/action-gh-release@…#v2.6.2`) run on **Node.js 20**, which GitHub force-migrates to Node 24 on **2026-06-16** (11 days out) and removes 2026-09-16.
**Severity:** cosmetic (the run succeeded; no failure).
**Resolution:** Not addressed in this flight (pinning the *current* majors' latest stable was the F18 deliverable). The already-configured Dependabot `github-actions` ecosystem will surface the Node-24 major bumps (checkout v5 / setup-node v5 / upload-artifact v5) as PRs. **Carry-forward for the next maintenance pass / flight debrief:** accept those Dependabot major-bump PRs to clear the Node-20 deprecation before the forced cutover.

### Minor infra notice
`windows-latest` runners redirect to `windows-2025-vs2026` by 2026-06-15 (GitHub-side image change). Informational; no action.

---

## Session Notes

---

## Deviations

---

## Anomalies

---

## Session Notes
