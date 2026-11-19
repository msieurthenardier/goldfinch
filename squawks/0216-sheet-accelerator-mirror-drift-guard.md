# Squawk 0216: `sheet-accelerator.js` hand-mirrors `keydownToAction` with no executable drift guard

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: 2026-11-19

## Report
CLAUDE.md: "`sheet-accelerator.js` hand-mirrors `keydownToAction` — change both together." The only guard is a comment, so a chord added to one table can silently miss the other. Add a derived-equality test that runs both over a key matrix. Carried since Mission 09 (finding #30).

## Evidence
- `src/shared/sheet-accelerator.js` (Tab/PageDown/PageUp/digit-jump block, "must stay in lockstep") vs `src/shared/keydown-action.js`.
- `test/unit/sheet-accelerator.test.js` — comment-level lockstep note only.

## Corrective Action
Added a drift-guard test to `test/unit/sheet-accelerator.test.js` that runs `sheetAcceleratorAction` and `keydownToAction` over 74 keys x 16 ctrl/meta/shift/alt combinations and asserts the same action on every chord (action names are identical on both sides; `scope`/`autoRepeatGuard` are sheet-only routing). Explicit, commented exclusions: sheet-only `print` (must be null in `keydownToAction`) and chrome-only F6 `focus-content`/`focus-chrome` (must be null on the sheet); `lightboxOpen` fixed false. The mirrored subset is pinned at 342 non-null chords so a one-sided addition is flagged even if it is accidentally symmetric. Failure messages name the chord. No `src/**` change; the two tables agree today. CLAUDE.md's lockstep sentence now names the guard.

## Verification
The new test enumerates a key x modifier matrix through both functions and asserts the mirrored subset agrees. Neuter-verified: deleting Ctrl+D from the sheet failed with `Ctrl+"d": sheet-accelerator says null, keydownToAction says bookmark-page`; adding Ctrl+K to only keydown-action, and separately only to the sheet, each failed naming `Ctrl+"k"`. `src/` restored (`git diff src/` empty). npm test, lint, typecheck, format:check green.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. 74 keys × 16 modifier sets through both functions; the three one-sided exclusions are commented and justified by the source; the mirrored count is pinned at 342; a one-sided chord fails by name. Gates at review: `npm test` 7,384 tests (7,379 pass, 0 fail, 1 skipped — the `jq` test — and 4 todo); lint, typecheck and format:check clean; `git diff main -- src .github/workflows` empty.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19`
