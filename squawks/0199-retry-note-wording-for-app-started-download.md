# Squawk 0199: The downloads page's Retry note is misleading for a download the app started

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-17
**Completed**: —

## Report
A download started by Settings → About → "Download now" goes through the browser's own session, so its record has no partition and cannot be retried. The downloads page then shows "Cannot retry: this download does not record which identity it came from." — true, but it reads as a fault, when the operator only needs to press "Download now" again.

## Evidence
- `src/main/download-retry.js` — `RETRY_REASONS.NO_PARTITION` and its note text.
- Flight 3 `update-notice` run log, checkpoint 7 (the row as rendered).

## Corrective Action
*(written at completion)*

## Verification
The note for a partition-less record says what to do instead (for example "Started by Goldfinch — use Download now in Settings to fetch it again"), or the reason is distinguished for an app-started download; `download-retry` unit tests updated.
