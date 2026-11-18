# Squawk 0208: Nothing keeps the release-notes splitter's reason words and the tests' list in step

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: —

## Report
`split_release_notes` in `build.yml`'s `create-release` job reports why a notes file was rejected with one reason word (nine today). The tests assert the words for the cases they cover, but nothing checks that the set in the workflow equals the set the tests know, so a new rejection path can be added with no fixture. Sortie 10's leg 01 added four words its spec did not list.

## Evidence
- `.github/workflows/build.yml`, `split_release_notes`: `echo <word> >&2` for `control-byte`, `empty-body`, `no-title-line`, `no-title-text`, `title-too-long`, `too-large`, `trailing-space`, `unreadable`, `wrong-version`.
- `test/unit/release-workflow-invariants.test.js` — the splitter fixture tests; Sortie 10 debrief, Recommendation 5.

## Corrective Action
*(written at completion)*

## Verification
A test extracts every `echo <word> >&2` reason from the extracted `split_release_notes` text and asserts the set equals a constant in the test, and that every word in the constant has at least one fixture producing it; adding a reason word to the workflow without a fixture turns the test red (neuter-verified).
