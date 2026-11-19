# Leg: dependabot-repin-note

**Status**: completed
**Flight**: [Release Integrity](../flight.md)

## Objective

Record, in `.github/dependabot.yml` itself, that every GitHub Actions bump Dependabot proposes must be re-pinned to the new version's full commit SHA with a `# vX.Y.Z` comment before it merges. Then pin that the note exists.

## Context

- Maintenance finding #14.
- Dependabot's `github-actions` entry proposes mutable tags.
- The SHA-pin invariant (`release-workflow-invariants.test.js`, "every uses: … @<40 hex> # vX.Y.Z") runs only on Concourse after a merge to `main`, so a careless merge would land unpinned actions before anything objects.
- CLAUDE.md *Release / CI* already states the rule; the file Dependabot's PRs come from does not.
- `.github/dependabot.yml` has a header comment block (about majors and behavior tests), an `npm` entry, and a bare `github-actions` entry.

## Acceptance Criteria

- [ ] A comment directly above (or within) the `github-actions` entry states, in substance: "Dependabot proposes a mutable tag (`@vX.Y.Z`). Before merging, resolve that version's commit SHA (`gh api repos/<owner>/<repo>/git/ref/tags/<tag>` → the commit) and re-pin to `owner/repo@<40-hex> # vX.Y.Z`. CI's SHA-pin invariant (`test/unit/release-workflow-invariants.test.js`) only catches it after merge. See CLAUDE.md *Release / CI*."
- [ ] A new test (in `release-workflow-invariants.test.js` or its own file) asserts the note is present: it reads `.github/dependabot.yml` and matches a wrap-insensitive regex on the re-pin instruction near the `github-actions` entry. It is neuter-verified.
- [ ] Nothing else in `dependabot.yml` changes. `npm test`, `lint`, `typecheck` and `format:check` are green (Prettier formats YAML in this repo; check that `format:check` covers the file).

## Verification Steps

- `node --test test/unit/release-workflow-invariants.test.js` (or the new file)
- Neuter: remove the comment, confirm the test fails, restore it.
- `npm run format:check`

## Files Affected

- `.github/dependabot.yml`; `test/unit/release-workflow-invariants.test.js` or a new test file.

## Citation Audit

Checked 2026-11-19: `.github/dependabot.yml` content as described; the SHA-pin test is "every uses: in both workflows is owner/repo@<40 hex> # vX.Y.Z" (`release-workflow-invariants.test.js:53`).
