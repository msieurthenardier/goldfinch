# Squawk 0181: The chrome is pushed an unbounded address after a very long in-page navigation

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-14
**Completed**: —

## Report
Found during Mission 23 Flight 1's `prompts-and-bounds` leg. A page calling `history.pushState` with a 400,000-character address makes main push the whole string to the chrome, which puts it in the tab's state and the address field. History recording is bounded (8,192 characters) but this push is not. No stall was measured in the behavior test (the three calls returned within 18 ms), so this is a bound for robustness, not a demonstrated problem.

## Evidence
- `src/main/guest-wiring.js` — the `tab-did-navigate-in-page` (and `tab-did-navigate`) sends pass `displayUrl(url)` with no length limit.
- Behavior-test run `tests/behavior/address-and-history-bounds/runs/2026-11-14-06-00-24.md`: address field length 400,021 after the long push.

## Corrective Action
*(written at completion)*

## Verification
Cap the display address main pushes (for example at the history cap) in the one helper in `src/shared/display-url.js`, so every push site gets it; the real URL in main is untouched. Unit: a long address is cut for display and `renderer.js` is not edited. If the cap would change what the chrome navigates to on Enter, stop — that is a behaviour question for the operator.

## Sign-Off
*(written at completion)*
