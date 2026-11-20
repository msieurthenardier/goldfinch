# Squawk 0230: The bookmarks-bar setting can let a stale boot read overwrite a newer push

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-19
**Completed**: 2026-11-19

## Report
Squawk 0202 gave five Settings controllers `bootReadGuard`: a push seen before the boot read wins, and a rejected write reverts to the last known value. The "Show bookmarks bar" checkbox (`bookmarksBarEnabled`) has the same shape but was not named in 0202, so it was left unchanged. If a `settings-changed` push lands before its `settingsGet` resolves, the older read overwrites it. A rejected `settingsSet` also leaves the checkbox showing what was clicked. Found at the 0202 batch review.

## Evidence
- `src/renderer/pages/settings.js`, the `bookmarksBarEnabled` controller (~L657–675): `settingsGet('bookmarksBarEnabled')` plus an `onSettingsChanged` handler, with no guard and no revert.
- The fixed pattern in the same file: `bootReadGuard(apply, initial)` (squawk 0202).

## Corrective Action
`src/renderer/pages/settings.js`, bookmarks-bar controller: added `barGuard = bootReadGuard(v => { el.checked = v }, false)`; the `settingsGet` result goes through `barGuard.boot(v === true)`, the `settingsSet` `.catch` calls `barGuard.revert()`, and the `onSettingsChanged` handler calls `barGuard.push(all.bookmarksBarEnabled)`. Direct `.checked` assignment kept (no click/dispatch). Pinned by a new test in `test/unit/settings-page-shared-scripts.test.js` that throws if the controller block is not found.

## Verification
The controller goes through `bootReadGuard` like its neighbours, and the page's source-scan test pins it. Confirm by reading, and once live.

Ran: `node --test` on settings-page-shared-scripts.test.js: 15 pass, 0 fail. Neuter check: reverting the push handler to `el.checked = all.bookmarksBarEnabled` made the new pin fail (14 pass, 1 fail, "settings-changed goes through barGuard.push"); restored. `npm test`: 7426 pass, 0 fail. `npm run lint`, `typecheck`, `format:check`: clean. Live check not run (Flight Director).

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the seventh 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. Boot, push and revert all go through `barGuard`; the source-scan pin asserts both of its markers exist before slicing, so it throws rather than passing vacuously (neuter: restoring the direct `el.checked = all.bookmarksBarEnabled` fails it). Not checked live in this batch: the race is not reproducible by automation, and the change is the same guard 0202 checked live. Gates at re-review: `npm test` 7,448 tests (7,443 pass, 0 fail, 5 skipped or todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-g`
