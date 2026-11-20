# Squawk 0177: Closing the active tab activates the rightmost tab, not a neighbour

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-08
**Completed**: 2026-11-19

## Report
When the active tab is closed outside a pointer close burst (Ctrl+W, tab context menu Close, ✕ on
the active tab), the chrome activates the **rightmost** tab in the strip instead of a neighbour of
the closed tab. With many tabs open, closing the active tab in the middle jumps to the far right.
Repro: open tabs A B C D E, activate B, press Ctrl+W → E becomes active (expected C). Expected
browser convention: the right neighbour, or the left neighbour when the closed tab was rightmost.
Split out of sortie 08 (close-burst tab visibility) as out of that charter's scope.

## Evidence
- `src/renderer/chrome/tab-controller.js` `closeTab()` — `const next = orderedTabIds().pop(); if (next) activateTab(next);`
- Same fallback in the `tab-moved-away` handler in the same file ("same fallback as closeTab").
- Documented intent was a neighbour: `missions/09-tab-management/flights/02-tab-reorder/flight.md`
  DD5 — "reorder-then-close picks the correct DOM-order neighbor (the DD1 consumer regression)".
  The DD1 refactor fixed the ORDER source (DOM, not Map insertion) but kept `.pop()`.
- Note for completion: the stripIndex must be captured before `tab.btn.remove()` (already done in
  `closeTab` for `tabClose`). Tab-context batch closes activate the anchor first, so they never
  reach this fallback. Sortie 08 also edits `closeTab` — complete this squawk before sortie 08
  executes or after it lands, never concurrently.
- Behavior spec `tests/behavior/tab-reorder.md` Step 6 pins the CURRENT rightmost pick ("the
  newly-activated next tab is the one that was DOM-order-last") — re-author it with the fix.

## Corrective Action
- `src/shared/tab-order.js` `neighbourAfterRemoval(orderAfter, removedIndex)`: new pure pick (right neighbour = tab now at the removed index, else the left/last).
- `src/renderer/chrome/tab-controller.js` `closeTab()` (`wasActive` branch) now uses it with the existing pre-removal `stripIndex`; the `onTabMovedAway` handler captures `movedStripIndex` before `tab.btn.remove()` and uses it; no else-createTab arm added, pointer-close path and empty-strip `openNewTab()` arm untouched.
- Tests: `test/unit/tab-order.test.js` (helper), `test/unit/tab-controller.test.js` (middle/leftmost/rightmost/reordered close, moved-away middle/rightmost; two existing pins that expected the last tab renamed/updated), `test/unit/sole-tab-move-close-source.test.js` (AC4 mutation anchor retargeted).
- Specs: `tests/behavior/tab-reorder.md` Step 6 re-authored (+ one-line header note); `tests/behavior/pointer-close-shows-tab.md` rows 7-8 updated. CLAUDE.md does not describe the fallback as DOM-order-last (no change needed).

## Verification
(original criterion: closing the active tab outside a pointer burst activates its neighbour, not the rightmost tab.)
Ran: targeted `tab-controller`/`tab-order`/`sole-tab-move-close-source` 93 pass 0 fail; `npm test` 7434 pass 0 fail; lint, typecheck, format:check clean.
Neuter-verified: reverting the `closeTab` site to `.pop()` fails 4 tests (existing ordered-close, no-opts close, new middle, new leftmost, reorder); reverting the moved-away site fails the new moved-away middle test and the existing no-resolvable-target pin (rightmost-case tests pass under `.pop()` by construction, since last == left neighbour there).

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the seventh 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. The strip index is captured before removal at both sites (`closeTab` and `onTabMovedAway`); the pointer path, the empty-strip `openNewTab()` arm and the moved-away "no createTab" rule are untouched. Reviewer neuter: putting `.pop()` back at both sites fails eight tests. Live (dev mode, five loopback pages A to E, keyboard Ctrl+W to the chrome): closing B gave `A C* D E`, closing the rightmost E gave `A C D*`, closing the leftmost A gave `C* D`. Gates at re-review: `npm test` 7,448 tests (7,443 pass, 0 fail, 5 skipped or todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-g`
