# Squawk 0208: Nothing keeps the release-notes splitter's reason words and the tests' list in step

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: 2026-11-19

## Report
`split_release_notes` in `build.yml`'s `create-release` job reports why a notes file was rejected with one reason word (nine today). The tests assert the words for the cases they cover, but nothing checks that the set in the workflow equals the set the tests know, so a new rejection path can be added with no fixture. Sortie 10's leg 01 added four words its spec did not list.

## Evidence
- `.github/workflows/build.yml`, `split_release_notes`: `echo <word> >&2` for `control-byte`, `empty-body`, `no-title-line`, `no-title-text`, `title-too-long`, `too-large`, `trailing-space`, `unreadable`, `wrong-version`.
- `test/unit/release-workflow-invariants.test.js` — the splitter fixture tests; Sortie 10 debrief, Recommendation 5.

## Corrective Action
Test-only, in `test/unit/release-workflow-invariants.test.js`:
- The splitter's rejection fixtures moved out of the `rejects malformed files` test into `rejectFixtures()`, so the assertion test and the coverage test run the same list (no second hand-kept list). Added a `missing file` fixture, which produces `unreadable`.
- `split()` now returns the last stderr line as `reason` (a missing input file also makes bash print its own error line first).
- Added `SPLIT_REASON_WORDS` (nine words) and `reasonWordsOf(fn)` (regex over `echo <word> >&2`; throws on zero words).
- New test `reason words in the workflow equal the tests' list`: extracted set equals the constant; also checks an in-memory copy with `echo new-word >&2` differs, and that zero words throws.
- New test `every reason word has a fixture that produces it`: runs `rejectFixtures()` through the real splitter, collects observed reason words, asserts none of the constant is missing.

## Verification
A test extracts every `echo <word> >&2` reason from the extracted `split_release_notes` text and asserts the set equals a constant in the test, and that every word in the constant has at least one fixture producing it; adding a reason word to the workflow without a fixture turns the test red (neuter-verified).

Ran: `node --test` on the file: 34 pass, 0 fail. Neuter 1 (added `'bogus'` to the constant, the mirror of a new workflow word): the equality test went red (2 fail: it and the coverage test). Neuter 2 (deleted the two `wrong-version` fixtures): the coverage test went red (1 fail). Both restored. Full `npm test`: 7452 tests, 7447 pass, 0 fail (rest skipped). `npm run lint`, `npm run typecheck`, `npm run format:check` clean.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the eighth 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. The workflow's nine reason words equal `SPLIT_REASON_WORDS`; every word has a fixture that produces it through the real splitter; `reasonWordsOf` throws on zero words. Re-neutered by the Reviewer: a renamed word in the extracted text fails 4 tests, a deleted `unreadable` fixture fails the coverage test. Taking the last stderr line as the reason cannot hide a mismatch (each assertion still compares the exact word); no existing fixture was dropped; `build.yml` is unchanged. Gates at review: `npm test` 7,455 tests (7,450 pass, 0 fail, 5 skipped or todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-h`
