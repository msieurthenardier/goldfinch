# Squawk 0201: Reloading the chrome view through admin automation leaves only a Welcome tab

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-17
**Completed**: —

## Report
In a dev launch, `location.reload()` evaluated on the chrome target with an admin key left the window showing only a Welcome tab, and `enumerateTabs` returned an empty list, although the guest tabs still existed. Seen once by a Developer in Mission 23 Flight 3 (leg 06); not reproduced, and not compared with a build before that flight, so it may predate it. The main-initiated chrome-recovery path is a different route.

## Evidence
- Flight 3 flight log, leg 06 handoff note.
- `src/main/chrome-recovery.js` — the recovery reload sets `bootConfigServed = false` and `recoverTabs = true`; a page-initiated reload does not.

## Corrective Action
*(written at completion)*

## Verification
Reproduce on the current build and on the pre-Flight-3 base; then either a fix (the chrome re-adopts its tabs after any reload) with a test, or a documented "admin `evaluate` must not reload the chrome" note in `docs/mcp-automation.md`.
