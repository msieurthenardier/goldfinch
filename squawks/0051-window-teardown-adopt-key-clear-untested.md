# Squawk 0051: Window-teardown clear of the pending adopt admin-key + autolock suppression is untested

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-30

## Report
Flight 4 Leg 3 added a mid-surfacing window-close cleanup that drops the held
one-time admin-key string AND clears the store's `_suspendAutoLock` flag
(`clearAdoptAdminKeyForWindow`, wired through `window-factory.js`'s
`win.on('close')`). It is a lockout-adjacent safety path — a leaked suppression
flag would leave the store un-autolockable — but it has **zero test references**
(grep across `test/`), and the guided HAT did not exercise a mid-surfacing
window close. Add a unit test that injects a fake `clearPendingAdoptAdminKey`
delegate and asserts the close handler calls it with the resolved chrome id, the
pending map is emptied, and `_suspendAutoLock` is cleared. Surfaced by the
Flight 4 debrief.

## Evidence
- `src/main/window-factory.js` — `win.on('close')` cleanup (beside
  `authChallenges?.cancelForWindow`), keyed by `chromeForAttachment(win)?.id`.
- `src/main/main.js` — `clearAdoptAdminKeyForWindow` / the pending-adopt-admin-key
  `Map`; `takeAdoptAdminKey` clears suppression at `size===0`.
- `src/main/vault/vault-store.js` — `setAutoLockSuspended` / `_suspendAutoLock`.
- No `test/` file references `clearAdoptAdminKeyForWindow` (confirmed by grep).
