# Squawk 0198: The downloads indicator counts an interrupted download as in progress

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-17
**Completed**: —

## Report
A download that ends `interrupted` (for example, it cannot connect) keeps the toolbar downloads indicator in its active state — "Downloading — 1 in progress", class `downloads-active`, a count badge — for the rest of the session, while `goldfinch://downloads` correctly shows the row as "Failed". Electron emits `updated` with `interrupted` and no `done` for a resumable failure, so the record gets no end time until quit (`flushInterrupted`). Seen in Mission 23 Flight 3's `update-notice` spec run (step 7): two interrupted records gave a badge of 2.

## Evidence
- `src/renderer/chrome/downloads-indicator-model.js` — the active / in-progress decision; `src/renderer/chrome/downloads-controller.js` — `btn.classList.toggle('downloads-active', model.active)`.
- Run log `tests/behavior/update-notice/runs/2026-11-17-23-53-08.md`, checkpoint 7 and the Validator's product findings.

## Corrective Action
*(written at completion)*

## Verification
A model unit test: a record in state `interrupted` (no end time) does not count as in progress; a `progressing` one still does. The downloads page and indicator agree.
