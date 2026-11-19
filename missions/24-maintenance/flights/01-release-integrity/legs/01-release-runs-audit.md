# Leg: release-runs-audit

**Status**: landed
**Flight**: [Release Integrity](../flight.md)

> *Original hold (operator ruling 2026-11-18, superseded 2026-11-19 below):* this leg was not to be implemented or merged until a patched `picomatch` was published (GHSA-fc5q-39xc-vjpf, range `<= 4.0.7`). Rechecked 2026-11-19: no patched version yet, and 4.0.7 is still the latest. When a fix ships, this leg takes the normal dependency bump in the same change, so the release gate goes green rather than blocking every release.

> **UN-HELD 2026-11-19 (operator ruling).** GitHub **withdrew** advisory GHSA-fc5q-39xc-vjpf (`withdrawn_at` 2026-11-18T15:38:56Z); it was never patched. `npm audit --audit-level=high` now exits 0 with `picomatch` still 4.0.7 and no lockfile change. The audit step therefore no longer blocks releases, and the operator chose to fly this leg now, in the same PR as legs 2 and 3. The "Dependency" acceptance criterion below is dropped: there is nothing to bump.

## Objective

The release build runs `npm audit --audit-level=high` itself, once, before any installer is staged. A release can then never again be cut from a commit that fails the audit gate. Today v0.19.16–.18 were cut from such commits, because `build.yml` relied on Concourse having passed. The fuse check already runs per platform, and the leg pins that it stays.

## Context

- Maintenance report 2026-11-18, findings #1 and #16; the flight's Design Decisions (operator ruling, decision 2 option B).
- `.github/workflows/build.yml`, `build` job: matrix of mac / linux / win; steps Checkout (`persist-credentials: false`), Set up Node, `npm ci`, Set version from tag, Build installers (`--publish never`), then the fuse check (`node scripts/check-fuses.mjs "$APP_BIN"`) and staging. The job has `contents: read` and no token or secret.
- `test/unit/release-workflow-invariants.test.js` pins the workflow by text scan, with no YAML parser.

## Acceptance Criteria

- [ ] **The audit step.** One step in the `build` job runs `npm audit --audit-level=high`, immediately after `npm ci`, guarded so it runs on exactly one matrix entry (`if: matrix.platform == 'linux'`). It has no `continue-on-error` and no `|| true`, and it adds no secret, token or permission.
- [ ] **Invariants test** (`release-workflow-invariants.test.js`) gains pins for:
  - the audit step exists in `build`, runs before the "Build … installers" step, and is not softened by any `continue-on-error` / `|| true` / `--audit-level` other than `high`;
  - the fuse-check step still runs on every platform.
  Each pin is neuter-verified.
- [x] ~~**Dependency.**~~ Dropped: the advisory was withdrawn, and `npm audit --audit-level=high` exits 0 with no bump (checked 2026-11-19).
- [ ] **Docs.** `docs/RELEASING.md` says what the release build now checks. CLAUDE.md's *Release / CI* paragraph says `build` runs the audit gate.
- [ ] **Verification run.** A manual `workflow_dispatch` run of `build.yml` passes the audit step. This needs the branch pushed; the Flight Director dispatches it after the commit, with the operator's go-ahead, since a dispatch runs the full installer build.

## Citation Audit

Checked 2026-11-19 on `main` @ 22304bf: the `build` job's steps are as listed above, and the invariants test's job-scope tests are at :84 and :90.


## Design Review Resolutions (cycle 1: approve with changes, folded in; these take precedence over anything above)

- **Placement: BEFORE `npm ci`.** The audit step goes after Checkout and Set up Node, before "Install dependencies". `npm audit` reads `package-lock.json` and needs no install, so no project install script runs before the gate. Linux only (`if: matrix.platform == 'linux'`), because the lockfile is platform-independent. It runs on BOTH a tag push and a `workflow_dispatch`: the guard is on platform only, never on the event.
- **Exact command:** `npm audit --audit-level=high`. The pin is a regex on the step body requiring exactly that, and forbidding `continue-on-error`, `|| true`, `--omit`, `--production` and any other `--audit-level`.
- **Pin the gate's effect.** A new invariant asserts that the `upload` job's condition still requires `needs.build.result == 'success'`, so a failed linux audit stops upload, attest and publish even though `fail-fast: false` lets mac and win finish. Loosening it (e.g. `!= 'failure'`) must turn the test red.
- **Pin the fuse check.** It exists in `build`, has no `if:`, and comes after the build step (use the test file's existing `stepOf` helper).
- **Docs (`docs/RELEASING.md`, the jobs table and a short subsection; CLAUDE.md *Release / CI*):**
  - the release build now runs the audit before installing anything;
  - a failed audit leaves the draft release, which the next run reuses (harmless);
  - an advisory published after the commit merged can fail a later tag. That is intended: fix it with a bump, never by lowering the gate;
  - a transient registry or advisory-API failure fails the release closed, and the remedy is a re-run. Never add retry-then-pass logic;
  - `ci.yml` and `ci/tasks/audit.yml` remain the PR-time gates.
- **Verification is stated honestly.**
  - The invariant pins are neuter-verified.
  - The live check is one `workflow_dispatch` run, which shows the step runs and passes on the dispatch path.
  - The TAG path's first live confirmation is the next real release (candidate or stable). The flight log must say exactly that, not claim tag-path coverage from a dispatch.
  - No throwaway-branch "known advisory" run: injecting a vulnerable dependency to prove a failure is out of proportion; the pins carry the blocking proof.
- **Before commit:** re-run `npm audit --audit-level=high` (advisories change daily).
