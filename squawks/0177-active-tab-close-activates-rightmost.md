# Squawk 0177: Closing the active tab activates the rightmost tab, not a neighbour

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-08
**Completed**: —

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
*(written at completion)*

## Verification

## Sign-Off
*(written at completion)*
