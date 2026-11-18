# Squawk 0216: `sheet-accelerator.js` hand-mirrors `keydownToAction` with no executable drift guard

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: —

## Report
CLAUDE.md: "`sheet-accelerator.js` hand-mirrors `keydownToAction` — change both together." The only guard is a comment, so a chord added to one table can silently miss the other. Add a derived-equality test that runs both over a key matrix. Carried since Mission 09 (finding #30).

## Evidence
- `src/shared/sheet-accelerator.js` (Tab/PageDown/PageUp/digit-jump block, "must stay in lockstep") vs `src/shared/keydown-action.js`.
- `test/unit/sheet-accelerator.test.js` — comment-level lockstep note only.

## Corrective Action
*(written at completion)*

## Verification
The new test enumerates a key × modifier matrix through both functions and asserts the mirrored subset agrees; neuter-verified by deleting one mirrored chord.
