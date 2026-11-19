# Squawk 0180: A media-panel download that follows a redirect loses its suggested name and chosen folder

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-14
**Completed**: 2026-11-19

## Report
Found by the design review of Mission 23 Flight 1's `jar-isolation` leg and again by the Developer's smoke. When a media-panel or save-image download is redirected, the download event reports the **final** URL, the pending record (keyed by tab and the requested URL) is not found, and the file is saved under Chromium's own name in the default folder instead of the suggested name and the folder the operator chose.

## Evidence
- `src/main/register-download-ipc.js` — `pendingKey = (wcId, url)`; the lookup in `wireDownloadHandler` uses `item.getURL()`.
- Probe (2026-11-14, Electron 44): for a redirected download `item.getURLChain()` was `[requested, final]` and `item.getURL()` was the final one.

## Corrective Action
`src/main/register-download-ipc.js` `wireDownloadHandler` (`will-download`): the pending-record lookup now uses `pendingUrl`, the first entry of `item.getURLChain()` when it is a non-empty array with a string first entry, else `item.getURL()` (try/caught, tolerates a missing `getURLChain`). `url` (`item.getURL()`) is unchanged and still feeds the stored record, so Retry and the update-download matcher see what they did before. The key stays (tab id, URL); the record is still deleted at start and the 60 s drop is untouched.

## Verification
Look the pending record up by the first entry of `item.getURLChain()` (falling back to `getURL()`), still keyed by the downloading tab and still consumed at download start. Unit: a redirected download keeps its suggested name; a page-started download of the final URL in another tab still does not inherit it.

Ran: new test in `test/unit/register-download-ipc.test.js` (redirect keeps name and folder; other tab with the final URL, a chain starting elsewhere, a throwing chain and an empty chain inherit nothing; consumed once; chainless item matches by `getURL`): file 45/45 pass. `npm test` 7394 tests, 7389 pass, 0 fail (rest skipped). `npm run lint`, `typecheck` and `format:check` clean.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the fourth 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. The lookup key is still (downloading tab, first URL in the chain), so another tab downloading the final URL inherits nothing; the stored record, Retry and the update matcher still use `getURL()`; the chain read cannot throw out of `will-download`. Neuter: reverting the lookup to `getURL()` fails the new test. Gates at re-review: `npm test` 7,404 tests (7,399 pass, 0 fail, 1 skipped — the `jq` test, no `jq` on the dev host — and 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-d`
