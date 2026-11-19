# Squawk 0212: Three source-mutation pins lack an "the replace changed something" guard

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: 2026-11-19

## Report
Three mutation-style pins `.replace()` source text and then assert, with no check that the replace hit. A Prettier re-wrap or a source change makes them pass vacuously — the failure CLAUDE.md's *Regex-target mutation pins* rule exists to prevent. Found by routine maintenance 2026-11-18 (finding #8).

## Evidence
- `test/unit/keyboard-rearm.test.js` — direction 1: a three-link literal `.replace` chain on `GOOD`, no guard; direction 2: a two-link chain, no guard.
- `test/unit/sheet-arming.test.js` — `SHEET_SRC.replace(…, '')` followed by `doesNotMatch`.
- Correct pattern: `assertMutated` in `test/unit/move-authority.test.js`.

## Corrective Action
Test-only. `keyboard-rearm.test.js`: each `.replace()` link of directions 1 and 2 now goes through a local `mutateStep` helper (the `assertMutated` pattern, `notEqual` before/after) so every link is guarded individually, and the literal multi-line targets became wrap-insensitive regexes (`\s*`, escaped metacharacters, `^[ \t]*` anchors). `sheet-arming.test.js`: the class-toggle strip asserts `stripped !== SHEET_SRC` before the `doesNotMatch`. No `src/**` change.

## Verification
Each mutation goes through `assertMutated` (or an equivalent `notEqual`), literal targets become wrap-insensitive regexes, and each guard is neuter-verified: altering each regex target in turn (all 4 chain links plus the isFocused-read link and the sheet-arming strip) made the matching guard fail with "mutation did not apply"; restored afterwards. `npm test`, lint, typecheck and format:check green.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. `mutateStep` asserts each link of both `keyboard-rearm` chains changed the text, the multi-line targets are wrap-insensitive regexes, and `sheet-arming` asserts the strip hit before `doesNotMatch`. Gates at review: `npm test` 7,384 tests (7,379 pass, 0 fail, 1 skipped — the `jq` test — and 4 todo); lint, typecheck and format:check clean; `git diff main -- src .github/workflows` empty.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19`

**Follow-up sweep (2026-11-19, after review)**: the Developer's rough list of other `.replace(` sites without a guard was triaged. Every mutation pin found (`register-download-ipc`, `reveal-gate-senders`, `release-workflow-invariants`) already asserts its replace hit, or is held by a preceding match on the same text. The other hits are comment stripping, string formatting or import rewriting, not pins. A scan for `const mut… = ….replace(` with no applied-check within six lines found none. No new squawk was logged.
