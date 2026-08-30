# Squawk 0053: Document the sequential dismiss-locked one-time-sheet pattern

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-30

## Report
Flight 4 Leg 3 introduced a novel sheet-system idiom: to reveal two one-time
secrets without the chrome sheet manager's `'superseded'` firing and clobbering
the first dismiss-locked sheet, stash the second secret, show the first, and
chain the second only on the first's acknowledgment (`menu-overlay:activated`).
No prior flow shows two one-time sheets back-to-back, and the `'superseded'`
clobber it avoids is a lockout-class trap. Capture the pattern in the
sheet-system design notes so the next multi-one-time-sheet flow doesn't
rediscover it the hard way. Surfaced by the Flight 4 debrief.

## Evidence
- `src/main/menu-overlay-manager.js:325-355` — the `'superseded'` menuType-change
  path.
- `src/main/register-overlay-ipc.js` — the `menu-overlay:vault-import` handler
  (show recovery + stash admin) and the `menu-overlay:activated` chain
  (adminkey-show on recovery-ack).
