# Squawk 0013: CLAUDE.md's welcome-surface note describes behavior the M16 F3 HAT retired

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-26
**Completed**: —

## Report

The welcome-surface paragraph in CLAUDE.md (written at M16 F2, extended at M16 F3 leg 1 with the DOM-contract rule) still describes `render`/`settle` as they were before the Flight 3 HAT: block visibility "only while `reasons.has(x) && current<x>() == null`", "the home page attaches if it is now set", and a dead-end "the panel hides and the address bar gets focus". After HAT items 3 and 6 (commit `46b3f5a`): both blocks are visible by `tab.welcome.reasons.has(x)` alone; Set saves and stays (no attach); `settle` auto-navigates only to run a pending search once an engine resolves; `unsetReasons` and the fallback are gone; `settle`/`render` accept a `{ search }`/`{ home }` override for the just-written value. A reader designing from CLAUDE.md would design against retired behavior. Found by the M16 F3 debrief Developer interview.

## Evidence

- `CLAUDE.md:70` — the stale sentences.
- `src/renderer/chrome/welcome-controller.js` `render`, `settle`, `submitHome`, `submitEngine` — the current shape (doc comments there are accurate).
- `missions/16-search-and-startup-choice/flights/03-welcome-branding/flight-log.md` — the item-3 and item-6 design-review rulings.

Fix: rewrite the paragraph to the current mechanism (reason-driven blocks; save-and-stay; the single pending-search auto-navigation; the override pattern; the DOM-contract rule stays). Verify by re-reading against the controller; the existing structural tests are unaffected.

## Corrective Action

*(written at completion)*

## Verification

*(written at completion — the paragraph matches `welcome-controller.js` claim by claim)*

## Sign-Off

*(written at completion)*
