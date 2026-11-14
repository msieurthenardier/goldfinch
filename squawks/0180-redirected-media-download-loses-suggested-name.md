# Squawk 0180: A media-panel download that follows a redirect loses its suggested name and chosen folder

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-14
**Completed**: —

## Report
Found by the design review of Mission 23 Flight 1's `jar-isolation` leg and again by the Developer's smoke. When a media-panel or save-image download is redirected, the download event reports the **final** URL, the pending record (keyed by tab and the requested URL) is not found, and the file is saved under Chromium's own name in the default folder instead of the suggested name and the folder the operator chose.

## Evidence
- `src/main/register-download-ipc.js` — `pendingKey = (wcId, url)`; the lookup in `wireDownloadHandler` uses `item.getURL()`.
- Probe (2026-11-14, Electron 44): for a redirected download `item.getURLChain()` was `[requested, final]` and `item.getURL()` was the final one.

## Corrective Action
*(written at completion)*

## Verification
Look the pending record up by the first entry of `item.getURLChain()` (falling back to `getURL()`), still keyed by the downloading tab and still consumed at download start. Unit: a redirected download keeps its suggested name; a page-started download of the final URL in another tab still does not inherit it.

## Sign-Off
*(written at completion)*
