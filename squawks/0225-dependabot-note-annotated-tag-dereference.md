# Squawk 0225: The Dependabot re-pin note doesn't explain how to dereference an annotated tag

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-19
**Completed**: —

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
*(written at completion)*

## Verification
The note gives both cases, or a single command that works for both, such as `gh api repos/<o>/<r>/commits/<tag> --jq .sha`, which dereferences to the commit for either tag type; check this first. The pin is updated to match and neuter-verified.
