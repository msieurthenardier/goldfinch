# Squawk 0130: Settings: Shields sub-toggles aren't dimmed when the master switch is off

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: —

## Report
In `goldfinch://settings` → Privacy & Shields, turning off the master Shields checkbox leaves Block trackers, Strip tracking params and Farble fingerprint looking active. The privacy panel dims them (`.shield-row.dim`), so the two surfaces are inconsistent.

## Evidence
`src/renderer/pages/settings.css:195`/`203` (`.shield-parent` / child rows, no master-off styling); `src/renderer/pages/settings.js` shields controller `applyConfig`.

## Corrective Action
*(written at completion)*

## Verification
*(written at completion)*

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
