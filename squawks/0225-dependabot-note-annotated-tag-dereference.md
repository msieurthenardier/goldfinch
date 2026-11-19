# Squawk 0225: The Dependabot re-pin note doesn't explain how to dereference an annotated tag

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-19
**Completed**: 2026-11-19

## Report
The note above the `github-actions` entry in `.github/dependabot.yml` (added in Mission 24 Flight 1) says to resolve a tag's commit SHA with `gh api repos/<owner>/<repo>/git/ref/tags/<tag>`, "then the commit it points at". That command does not return a commit for every tag:

- For a lightweight tag, the ref points at the commit directly.
- For an annotated tag, the ref points at a TAG object (`object.type == "tag"`), and reaching the commit needs a second call: `gh api repos/<owner>/<repo>/git/tags/<sha>` → `.object.sha`.

A reviewer following the note literally could pin a tag-object SHA. The SHA-pin invariant would then flag it as a non-commit, or worse, it would resolve unexpectedly. Spell the dereference out.

## Evidence
- `.github/dependabot.yml`: the comment block above `- package-ecosystem: github-actions`.
- `test/unit/release-workflow-invariants.test.js`: the Dependabot note pin, which matches the note's wording.
- `missions/24-maintenance/flights/01-release-integrity/flight-debrief.md`, *Technical*.

## Corrective Action
The `.github/dependabot.yml` note now gives one command, `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`, which returns the commit SHA for lightweight and annotated tags alike, and says why `git/ref/tags/<tag>` is not used (it returns the tag object's SHA for an annotated tag). The Dependabot-note pin in `test/unit/release-workflow-invariants.test.js` now requires that command and rejects a `gh api .../git/ref/tags` command in the note. `docs/RELEASING.md` and CLAUDE.md did not repeat the old command. No workflow file changed.

## Verification
Read-only `gh api` checks on public repos:
- Lightweight: `actions/checkout` v7.0.1 (also upload-artifact v7.0.2, attest v4.2.2, setup-node v7.1.0): `git/ref/tags` type `commit`; `commits/<tag>` returned the same SHA, and it equals the SHA pinned in the workflows (e.g. checkout `3d3c42e5aac5ba805825da76410c181273ba90b1`).
- Annotated: `github/codeql-action` v3.27.0: `git/ref/tags` type `tag`, tag-object SHA `9887d98ae49f1f598651b556d8c8f02f3ea065cb`; `git/tags/<that>` `.object.sha` = `662472033e021d55d94146f66f6058822b0b39fd`; `commits/v3.27.0 --jq .sha` returned `662472033e021d55d94146f66f6058822b0b39fd` (the commit, not the tag object).
- Neuter: replacing the command with `git/ref/tags/<tag>`, and re-adding a `gh api .../git/ref/tags/<tag>` command, each turn the pin red (applied-checked); the real file passes. `git diff .github/workflows/` is empty.
- `npm test` (7,380 pass, 0 fail), lint, typecheck and format:check green.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. The note gives `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`; the pin requires it and rejects a `git/ref/tags` command. Gates at review: `npm test` 7,384 tests (7,379 pass, 0 fail, 1 skipped — the `jq` test — and 4 todo); lint, typecheck and format:check clean; `git diff main -- src .github/workflows` empty.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19`
