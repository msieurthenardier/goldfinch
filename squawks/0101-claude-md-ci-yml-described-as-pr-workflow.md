# Squawk 0101: CLAUDE.md describes `ci.yml` as a pull-request workflow; it has been manual-only since #48

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-21
**Completed**: —

## Report

CLAUDE.md's Release / CI section says `ci.yml` runs on PRs:

> `ci.yml` (PRs): `npm ci → test → typecheck → lint → npm audit --audit-level=high → package`.

It does not. Since `f59dc92` (PR #48, 2026-06-16, "ci: migrate PR checks + fallback
installer builds to local Concourse") its only trigger is `workflow_dispatch`: PR
checks moved to the local Concourse instance (`ci/pipeline.yml`, automatic on every
push to `main`; `fly -t local-goldfinch execute …` pre-push) to conserve GitHub
Actions minutes, and `ci.yml` was deliberately kept as a manual fallback "for when
Concourse is unavailable" — its own header comment says so.

Found during Mission 21 Flight 3's close-out, when the Flight Director reported "CI
has not run on PR #228" loosely and then found NO check runs at all on the PR —
because none are wired to run. A reader of CLAUDE.md would expect a PR to carry a
hosted CI result automatically.

## Evidence

- `CLAUDE.md` Release / CI section — "`ci.yml` (PRs): …" (the stale line).
- `.github/workflows/ci.yml` `on:` → `workflow_dispatch:` only; header comment
  documents the Concourse migration.
- `git log -S workflow_dispatch -- .github/workflows/ci.yml` → `f59dc92`.
- `gh api repos/:owner/:repo/commits/<PR head>/check-runs` → empty for PR #227 and #228.

The Commands section's `npm run format:check` line ("the CI gate (`ci/tasks/lint.yml`,
`.github/workflows/ci.yml`'s "Format check" step)") remains TRUE — the step exists — but
should say `ci.yml` is manual-dispatch so it is not read as automatic.

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
