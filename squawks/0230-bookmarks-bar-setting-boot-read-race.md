# Squawk 0230: The bookmarks-bar setting can let a stale boot read overwrite a newer push

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-19
**Completed**: —

## Report
Squawk 0202 gave five Settings controllers `bootReadGuard`: a push seen before the boot read wins, and a rejected write reverts to the last known value. The "Show bookmarks bar" checkbox (`bookmarksBarEnabled`) has the same shape but was not named in 0202, so it was left unchanged. If a `settings-changed` push lands before its `settingsGet` resolves, the older read overwrites it. A rejected `settingsSet` also leaves the checkbox showing what was clicked. Found at the 0202 batch review.

## Evidence
- `src/renderer/pages/settings.js`, the `bookmarksBarEnabled` controller (~L657–675): `settingsGet('bookmarksBarEnabled')` plus an `onSettingsChanged` handler, with no guard and no revert.
- The fixed pattern in the same file: `bootReadGuard(apply, initial)` (squawk 0202).

## Corrective Action
*(written at completion)*

## Verification
The controller goes through `bootReadGuard` like its neighbours, and the page's source-scan test pins it. Confirm by reading, and once live.

## Sign-Off
*(written at completion)*
