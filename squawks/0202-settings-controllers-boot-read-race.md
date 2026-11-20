# Squawk 0202: Older Settings controllers let a stale boot read overwrite a newer push

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-17
**Completed**: 2026-11-19

## Report
Several Settings controllers read their value with `settingsGet(…)` at load and also follow `onSettingsChanged`. If a change is pushed before the boot read resolves, the older read overwrites it, and a rejected `settingsSet` leaves the control showing what was clicked. Mission 23 Flight 3 fixed this for the new "Check for new versions" checkbox (a push-seen guard and a revert); the older controllers have the same shape.

## Evidence
- `src/renderer/pages/settings.js` — `settingsGet('homePage')`, `settingsGet('restoreSession')` (two controllers), `settingsGet('toolbarPins')`, `settingsGet('spellcheck')`, each with an `onSettingsChanged` handler.
- The fixed pattern: the update-check controller in the same file (`checkPushSeen`, `checkKnown`).

## Corrective Action
Added `bootReadGuard(apply, initial)` in `src/renderer/pages/settings.js` (above the home-page controller): the update-check controller's `checkPushSeen`/`checkKnown` pair factored into `boot(v)` (dropped once a push was seen, else records last-known and applies), `push(v)` (marks seen, records, applies) and `revert()` (re-applies last-known). Applied per controller:
- `homePage` (home-page controller, `homeGuard`): boot read and `onSettingsChanged` go through the guard. Judgement call: a rejected Save/Clear does NOT revert the field; the typed text stays and the existing `Not saved:` / `Not cleared:` line shows, so the operator's unsaved edit is not discarded. The existing code never guarded focus/dirty state on a push; that is unchanged.
- `restoreSession` in the Shields/isolation controller (`restoreSeen` flag): read-only mirror feeding `renderIsolation`, so only the push-seen guard applies (no write, nothing to revert).
- `restoreSession` checkbox (`restoreGuard`, `#restore-session-enabled`): full pattern, including `revert()` on a rejected `settingsSet`.
- `toolbarPins` (appearance pins controller, `pinsGuard`): boot read/push guarded; `revert()` re-applies the full last-known map. The buttons only change after a resolved write, so a rejection already left the last-known map showing; revert is explicit anyway.
- `spellcheck` (`spellGuard`, `#spellcheck-enabled`): full pattern with revert.
`bookmarksBarEnabled` has the same shape but was not named in the squawk; left unchanged.
`test/unit/settings-page-shared-scripts.test.js` (home-page source-scan): its broadcast-handler assertion now expects `homeGuard.push(all.homePage)` with `bootReadGuard(reflect, ...)`.
No unit test of the guard: `settings.js` is an import-heavy classic page script with top-level DOM IIFEs, and extracting the guard to a requireable module needs a new internal-page-map route and eslint entry (files other squawks have uncommitted edits in), so skipped per the brief.

## Verification
Each controller drops a boot read that resolves after a push and reverts on a rejected write; verified by reading (the page controllers have no unit seam) and once live.

Ran: `node --test` on settings-page-shared-scripts.test.js 14 pass / 0 fail; `npm test` 7429 tests, after the one stale source-scan fix above the only failure was that test (now passing); `npm run lint` clean; `npm run typecheck` clean; `npm run format` then `format:check` clean. Live check: not run (Flight Director).

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the sixth 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. Push-before-boot-read keeps the push; revert restores the last value seen from a boot read or push (the full map for toolbar pins); a successful write's push updates it; homePage keeps the typed text on a rejected Save/Clear (judged sensible). No unit test (classic page script, no seam; the squawk's criterion is by reading); the page's source-scan test was updated. **Live** sanity: spellcheck persisted across reloads both ways; restore-session and toolbar pins rendered values. `bookmarksBarEnabled` has the same race and is logged as squawk 0230. Gates at re-review: `npm test` 7,430 tests (7,425 pass, 0 fail, 1 skipped — the `jq` test — and 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-f`
