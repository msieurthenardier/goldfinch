# Leg: workflow-token-permissions

**Status**: completed
**Flight**: [CI/CD Supply-Chain Hardening](../flight.md)

## Objective
Add a least-privilege top-level `permissions: contents: read` block to both GitHub Actions workflows, retaining the narrow per-job `contents: write` only where a job genuinely writes (F17).

## Context
- Flight Design Decision **F17**: every job starts read-only; only the two publishing jobs in `build.yml` escalate.
- Recon (flight-log): neither `build.yml` nor `ci.yml` declares any top-level `permissions:`; the `build` job and all of `ci.yml` inherit the repo default token scope. `release` (`build.yml:70-71`) and `update-readme` (`build.yml:91-92`) already carry per-job `contents: write`.
- The repo-default-token-to-read-only toggle is a **manual GitHub Settings** action, out of scope for this leg (tracked as a flight Prerequisite). This leg delivers the in-file controls.

## Inputs
- `.github/workflows/build.yml` — exists, no top-level `permissions:`; per-job `contents: write` on `release` and `update-readme`.
- `.github/workflows/ci.yml` — exists, no `permissions:` at any level; pure `pull_request` build-check.

## Outputs
- `build.yml` with a top-level `permissions: contents: read` block; per-job `contents: write` unchanged on `release` and `update-readme`.
- `ci.yml` with a top-level `permissions: contents: read` block; no per-job permissions.

## Acceptance Criteria
- [x] `build.yml` declares a top-level `permissions:` block with `contents: read` (placed after the `on:` block, before `jobs:`).
- [x] `build.yml` `release` job retains `permissions: contents: write`; `update-readme` job retains `permissions: contents: write`; the `build` job has no per-job permissions (inherits read).
- [x] `ci.yml` declares a top-level `permissions: contents: read` block; the `build-check` job has no per-job permissions.
- [x] Both workflow files remain valid YAML and valid Actions workflow syntax.
- [x] No step that previously succeeded now lacks a required permission (the `build` job's `upload-artifact` and `npm ci`/electron-builder `--publish never` need only read; `ci.yml` only reads/packages).

## Verification Steps
- `grep -n "permissions:" .github/workflows/build.yml` → shows a top-level block (line before `jobs:`) plus the two per-job `contents: write` blocks (3 matches total).
- `grep -n "permissions:" .github/workflows/ci.yml` → shows exactly one top-level block, `contents: read`.
- Validate syntax (prefer the guaranteed-local check; the agent may be sandboxed offline): parse YAML for each file with the installed `js-yaml@4` (`node -e "require('js-yaml').load(require('fs').readFileSync('FILE','utf8'))"`) or `python3 -c "import yaml; yaml.safe_load(open('FILE'))"` → no parse error. Optionally also run `actionlint` if available (`npx --yes @rhysd/actionlint`).
- Manual read: confirm the `build` job still has `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` and `--publish never` (so it needs no contents:write), and that `release`/`update-readme` writes are intact.

## Implementation Guidance

1. **`build.yml` — add top-level permissions.**
   - Insert, after the `on:` block (lines 6-10) and before `jobs:` (line 12):
     ```yaml
     # Least privilege: every job starts read-only; only the publishing jobs
     # (release, update-readme) escalate to contents: write per-job below.
     permissions:
       contents: read
     ```
   - Leave the per-job `permissions: contents: write` on `release` (around L70) and `update-readme` (around L91) exactly as-is.
   - Do NOT add per-job permissions to the `build` job — it only reads, runs electron-builder `--publish never`, and uploads artifacts (no contents write needed).

2. **`ci.yml` — add top-level permissions.**
   - Insert, after the `concurrency:` block (lines 12-14) and before `jobs:` (line 16):
     ```yaml
     permissions:
       contents: read
     ```
   - The `build-check` job needs no per-job permissions (read-only PR check).

3. **Validate.** Run the verification steps above (actionlint / YAML parse + greps).

## Edge Cases
- **`upload-artifact@v4` under read-only contents**: it uses the artifact API, not the contents API — read-only `contents` is sufficient. Do not add `contents: write` to `build` to "be safe"; that would defeat F17.
- **`download-artifact@v4` in the `release` job**: same — artifact API; `release` already has `contents: write` for the actual release creation, which is correct.
- **Placement matters**: top-level `permissions:` must be a workflow-level key (same indentation as `on:`/`jobs:`), not nested under a job.

## Files Affected
- `.github/workflows/build.yml` — add top-level `permissions: contents: read`.
- `.github/workflows/ci.yml` — add top-level `permissions: contents: read`.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (N/A — no app tests touched; run workflow syntax validation instead)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (not final — skip)
- [ ] Commit handled at flight level (deferred review+commit per agentic-workflow)
