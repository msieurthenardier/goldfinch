# Squawk 0101: CLAUDE.md describes `ci.yml` as a pull-request workflow; it has been manual-only since #48

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-21
**Completed**: 2026-09-21

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

Two lines in `CLAUDE.md` corrected; no file under `.github/` or `ci/` touched (this is a
documentation fix, not a pipeline change).

**1. Release / CI section** (was line 372):

Before:
> `ci.yml` (PRs): `npm ci → test → typecheck → lint → npm audit --audit-level=high → package`. A high in a dev-only dep is fixed by bumping the dep, never by lowering the gate.

After:
> **PR-equivalent checks run on the local Concourse instance, not GitHub Actions** (`ci/README.md`): `npm ci → test → typecheck → lint → npm audit --audit-level=high → package`, run automatically on every push to `main` (the `ci` job in `ci/pipeline.yml`) and pre-push against your working tree via `fly -t local-goldfinch execute -c ci/tasks/<task>.yml -i repo=.` (`test.yml` / `typecheck.yml` / `lint.yml` / `audit.yml` / `package-linux.yml`). `.github/workflows/ci.yml` runs the same suite but is `workflow_dispatch`-only — a deliberate manual fallback for when Concourse is unavailable, not a PR trigger. A high in a dev-only dep is fixed by bumping the dep, never by lowering the gate.

The commands (`fly -t local-goldfinch execute -c ci/tasks/<task>.yml -i repo=.`, the task
filenames, the "automatic on every push to main" fact, and the `ci.yml` header's own
"manual-only fallback … when Concourse is unavailable" framing) are taken verbatim/paraphrased
from `ci/README.md` and `.github/workflows/ci.yml`'s header comment — nothing invented. The
existing "bump the dep, never lower the gate" rule is preserved unchanged.

**2. Commands section, `npm run format:check` line** (was line 13):

Before:
> `npm run format:check` — `prettier --check .`; the CI gate (`ci/tasks/lint.yml`, `.github/workflows/ci.yml`'s "Format check" step) — fails the build on drift

After:
> `npm run format:check` — `prettier --check .`; the CI gate (`ci/tasks/lint.yml`'s "Format check" step, run on local Concourse — see Release / CI; `.github/workflows/ci.yml` carries the same step but is manual `workflow_dispatch`-only, not an automatic check) — fails the build on drift

The reference to `.github/workflows/ci.yml`'s "Format check" step is kept (the step genuinely
exists) but now reads as manual, not automatic.

**Grep sweep for other inaccuracies** (per the squawk's third instruction): searched `CLAUDE.md`
for `PR`, `pull request`, `Actions`, `CI gate`, `on PRs`, `automatically`, `ci.yml`,
`workflow_dispatch`, and `Concourse`, and `docs/*.md` for `ci\.yml|GitHub Actions|workflow_dispatch|pull_request`.
Hits reviewed:
- Line 13 (`npm run format:check`) — corrected above.
- Line 30 ("Shields apply... new jars inherit **automatically**") — unrelated (session/jar
  behavior, not CI).
- Line 319 (`internal-settings-set` broadcasts `settings-changed` **automatically**) — unrelated
  (IPC behavior, not CI).
- Line 356 (the "Formatting is Prettier's" bullet, `.github/workflows/ci.yml` mentioned
  alongside `ci/tasks/lint.yml` as "the CI gate") — pre-existing, in-flight edit by squawk 0096
  in the same working tree; left untouched per this squawk's own instructions.
- Line 370 (Dependabot PR bumping a pinned action SHA) — about accepting a Dependabot pull
  request, not about `ci.yml` running on PRs; not an inaccuracy.
- Line 372 (the stale `ci.yml (PRs)` line) — corrected above.
- `docs/*.md` — no matches for any of the searched terms; nothing to correct there.

No other place in `CLAUDE.md` or `docs/` implies `ci.yml`/GitHub Actions runs automatically on
PRs.

**Review fixes (post-draft).** A review pass found two further problems, both now corrected:

**3. Password vault → "Formatting is Prettier's (M17 F5)" bullet** (line 361 — the one this
squawk's own draft had explicitly left untouched at item 2 above, believing it a pre-existing
squawk-0096 edit unrelated to this fix): it still read `npm run format:check` is "the CI gate
(fails the build on drift, both `ci/tasks/lint.yml` and `.github/workflows/ci.yml`)" — the same
"both gate automatically" framing this squawk exists to correct, just in a second location.

Before:
> run `npm run format` before committing, `npm run format:check` is the CI gate (fails the build on drift, both `ci/tasks/lint.yml` and `.github/workflows/ci.yml`).

After:
> run `npm run format` before committing, `npm run format:check` is the CI gate — run on local Concourse (`ci/tasks/lint.yml`; see Release / CI); `.github/workflows/ci.yml` carries the same check but is a manual `workflow_dispatch`-only fallback.

**4. Commands section, `npm run format:check` line** (line 13): the wording this squawk's draft
landed still mis-attributed a NAMED "Format check" step to `ci/tasks/lint.yml` — that task is one
unnamed `run:` script (`npm run lint` then `npm run format:check`, verified against
`ci/tasks/lint.yml`); only `.github/workflows/ci.yml` has a `- name: Format check` step (verified
against `.github/workflows/ci.yml`). Reworded so the step name belongs to `ci.yml` alone.

Before:
> `npm run format:check` — `prettier --check .`; the CI gate (`ci/tasks/lint.yml`'s "Format check" step, run on local Concourse — see Release / CI; `.github/workflows/ci.yml` carries the same step but is manual `workflow_dispatch`-only, not an automatic check) — fails the build on drift

After:
> `npm run format:check` — `prettier --check .`; the CI gate (`ci/tasks/lint.yml`, run on local Concourse — see Release / CI; `.github/workflows/ci.yml`'s "Format check" step is the same check but manual `workflow_dispatch`-only, not an automatic check) — fails the build on drift

Both corrections re-verified against the live `ci/tasks/lint.yml` (one unnamed `run:` block, two
commands, no `name:` keys) and `.github/workflows/ci.yml` (the only `- name: Format check` step
in the repo) before writing.

## Verification

- Re-read `ci/tasks/lint.yml` and `.github/workflows/ci.yml` directly before writing items 3
  and 4 above, to confirm the named "Format check" step exists only in `ci.yml`.
- `npm run format` — ran clean; no reformatting needed beyond the four intentional `CLAUDE.md`
  edits (the original two hunks plus this pass's two further corrections), all already in
  Prettier style.
- `npm run format:check` — `All matched files use Prettier code style!`
- `npm test` — 5458 tests, 5455 pass, 0 fail, 3 todo (pre-existing todos, unrelated to this
  change). Source-scan tests that read `CLAUDE.md` (e.g. seam-contract/line-budget pins) are
  unaffected — this squawk only touched prose, not any pinned line count or code literal.
- `git status --short -- .github ci` — empty; confirms no pipeline file was touched.
- `git status --short` — confirms only `CLAUDE.md` and this squawk file changed as part of this
  pass (the rest of the working tree's pending changes are the batch's other eleven squawks,
  untouched).
- `git diff CLAUDE.md` — confirms exactly four hunks: the Commands section's `format:check`
  line, the Release / CI section's `ci.yml` bullet (both from the original draft), and the
  Password vault "Formatting is Prettier's" bullet plus a second pass over the Commands
  section's `format:check` line (both from this review-fixes pass).

## Sign-Off

**Reviewer**: independent Reviewer agent (leg-execution crew), batch review of the
2026-09-21 turnaround
**Verdict**: confirmed — corrective action correct, complete, and confined to the reported surface; gates green (`npm test` 5455 pass / 0 fail / 3 todo, lint, typecheck, format:check, build:preload), leak scan clean; two non-blocking wording issues raised at batch review (the Prettier bullet's ci.yml gate claim, and a "Format check" step name misattributed to `ci/tasks/lint.yml`) fixed in fix cycle 1 and re-review confirmed
**Commit**: see `squawk: turnaround 2026-09-21`
