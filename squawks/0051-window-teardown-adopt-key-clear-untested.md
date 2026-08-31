# Squawk 0051: Window-teardown clear of the pending adopt admin-key + autolock suppression is untested

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-30
**Completed**: 2026-08-30

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

## Corrective Action

Test-only; no production code changed. `src/main/main.js` cannot be `require()`d under
`node:test` (per the "NO TEST IN THIS REPO LOADS main.js" convention documented in
`test/unit/sheet-automation-gate-invariant.test.js`), so the new coverage targets the
reachable half of the safety path — the `window-factory.js` `win.on('close')` wiring that
invokes the delegate — using a fake `clearPendingAdoptAdminKey` that models
`clearAdoptAdminKeyForWindow`'s real contract (main.js:856-864) byte-for-byte: delete the
resolved chrome id's entry from a `Map`, and clear a `_suspendAutoLock`-shaped flag once the
map is empty.

- `test/unit/helpers/window-factory-harness.js` — threaded two previously-hardcoded deps as
  injectable options: `chromeForAttachment` (was a fixed `() => null`) and
  `clearPendingAdoptAdminKey` (was entirely absent from the harness).
- `test/unit/window-factory.test.js` — added four tests under a new "M17 F4 L3 (AC4,
  squawk 0051)" section, following the existing `authWiredHarness`/`popupRegistry`
  recording-fake style:
  - `window close clears the pending adopt admin key for the resolved chrome id and clears autolock suspension`
  - `window close leaves autolock suspended while another window still has a pending adopt admin key`
  - `window close calls clearPendingAdoptAdminKey with undefined when the window resolves no chrome (no-op, per the real contract)`
  - `absent clearPendingAdoptAdminKey dep is tolerated at window close (optional-chained)`

## Verification

- `node --test test/unit/window-factory.test.js` — 18/18 pass (4 new).
- `npm test` (full unit suite, `node --test` over `test/unit/**`) — 4007/4007 pass, 0 fail —
  confirms the harness change (previously-hardcoded `chromeForAttachment` now
  option-overridable) did not disturb the other two consumers
  (`test/unit/tearoff-overlay-teardown.test.js`, `test/unit/session-restore-wiring.test.js`).
- `npx eslint test/unit/window-factory.test.js test/unit/helpers/window-factory-harness.js` —
  clean.
- `npx prettier --check test/unit/window-factory.test.js test/unit/helpers/window-factory-harness.js` —
  clean.

## Sign-Off
**Reviewer**: independent Reviewer agent (squawk-review, scoped to the batch diff)
**Verdict**: confirmed — fake `clearPendingAdoptAdminKey` delegate verified
byte-for-byte against the real `clearAdoptAdminKeyForWindow` contract in
`main.js` (delete-by-id, clear suppression at size 0); no-chrome
optional-chaining case correctly modeled; harness change backward-compatible
(no other consumer passes `chromeForAttachment`); `npm test` 4008/4008,
eslint/prettier clean
**Commit**: `squawk/turnaround-2026-08-30` (squash-merged via its PR)
