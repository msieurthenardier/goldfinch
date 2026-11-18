# Squawk 0202: Older Settings controllers let a stale boot read overwrite a newer push

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-17
**Completed**: —

## Report
Several Settings controllers read their value with `settingsGet(…)` at load and also follow `onSettingsChanged`. If a change is pushed before the boot read resolves, the older read overwrites it, and a rejected `settingsSet` leaves the control showing what was clicked. Mission 23 Flight 3 fixed this for the new "Check for new versions" checkbox (a push-seen guard and a revert); the older controllers have the same shape.

## Evidence
- `src/renderer/pages/settings.js` — `settingsGet('homePage')`, `settingsGet('restoreSession')` (two controllers), `settingsGet('toolbarPins')`, `settingsGet('spellcheck')`, each with an `onSettingsChanged` handler.
- The fixed pattern: the update-check controller in the same file (`checkPushSeen`, `checkKnown`).

## Corrective Action
*(written at completion)*

## Verification
Each controller drops a boot read that resolves after a push and reverts on a rejected write; verified by reading (the page controllers have no unit seam) and once live.
