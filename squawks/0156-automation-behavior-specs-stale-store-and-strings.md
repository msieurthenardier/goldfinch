# Squawk 0156: Automation behavior specs read a retired settings.json and stale status strings

**Status**: deferred
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-23
**Completed**: —

## Report
Three behavior specs for the Automation controls can't be run as written: `settings-automation`, `settings-activity-viewer` and `automation-key-gating`. Two of them read the persisted store from `<dev-userData>/settings.json`, which no longer exists, because settings now live in `app.db`'s `documents` table. `settings-automation` step 4 also expects pre-Flight-8 status/note strings. A straight run would report failures caused by the stale specs, not the app. Found at Sortie 05's HAT, where the operator skipped the runs on this basis. Re-author all three to the current store and strings, then re-run them against `goldfinch://automation`.

## Evidence
- `tests/behavior/settings-automation.md` (4 hits) and `tests/behavior/automation-key-gating.md` (5 hits, e.g. lines 40/52/70) read `settings.json`. That file is absent from the dev profile. The store is `src/main/app-db.js` `documents(store PK, payload, updated_at)`, row `'settings'`.
- `settings-automation.md` step 4 expects `Not running — start Goldfinch with --automation-dev…` and `Takes effect when Goldfinch is launched with --automation-dev.`. `src/renderer/pages/automation.js` renders `Not running — turn on the Automation toggle to bind the surface` and `Binds the local automation surface.` instead.
- Last runs: `settings-automation/runs/2026-07-08-19-13-05.md`, `automation-key-gating/runs/2026-07-08-23-34-09.md`, `settings-activity-viewer/runs/2026-07-08-23-22-11.md`.
- `settings-activity-viewer.md` has no `settings.json` read. Include it in the re-run anyway, because none of the three ran after Sortie 05 moved the page.

## Corrective Action
*(written at completion)*

## Verification
Re-author the store reads to a read-only `node:sqlite` query of `app.db` `documents` (`store = 'settings'`) and correct the status/note strings. Then run `/mission-control:behavior-test` for each of the three slugs against a dev-mode launch.

## Sign-Off
*(written at completion)*

## Disposition
**Deferred**: logged mid-flight during Sortie 05's HAT, where the operator ruled to skip the runs. Revisit at the next squawk turnaround, or before any flight that changes the Automation page or the automation key/settings handlers.
