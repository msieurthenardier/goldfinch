# Squawk 0199: The downloads page's Retry note is misleading for a download the app started

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-17
**Completed**: 2026-11-19

## Report
A download started by Settings → About → "Download now" goes through the browser's own session, so its record has no partition and cannot be retried. The downloads page then shows "Cannot retry: this download does not record which identity it came from." — true, but it reads as a fault, when the operator only needs to press "Download now" again.

## Evidence
- `src/main/download-retry.js` — `RETRY_REASONS.NO_PARTITION` and its note text.
- Flight 3 `update-notice` run log, checkpoint 7 (the row as rendered).

## Corrective Action
An app-started download and a record saved before the partition field both have no partition, and nothing in the record tells them apart (adding a field is out of scope), so the note was reworded to be true for both. `src/main/download-retry.js` `REASON_TEXT[RETRY_REASONS.NO_PARTITION]` now reads "Cannot retry here. If Goldfinch started this download, use Download now in Settings to fetch it again." The reason code is unchanged. `test/unit/download-retry.test.js` pins the new wording. Old text appears only in historical run logs/flight logs (left unchanged).

## Verification
The note for a partition-less record says what to do instead (for example "Started by Goldfinch — use Download now in Settings to fetch it again"), or the reason is distinguished for an app-started download; `download-retry` unit tests updated.

Ran: targeted `download-retry` + `register-download-ipc` tests: 50 pass, 0 fail. `npm test`: 7393 pass, 0 fail. `npm run lint`, `npm run typecheck`, `npm run format:check` clean.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the fourth 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. The new note is true for both no-partition cases (app-started, and a record saved before the field existed); the reason code is unchanged; the old text survives only in historical run logs. Neuter: restoring the old text fails the test. The artifact's duplicated Verification section was merged at review. Gates at re-review: `npm test` 7,404 tests (7,399 pass, 0 fail, 1 skipped — the `jq` test, no `jq` on the dev host — and 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-d`
