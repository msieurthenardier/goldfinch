# Squawk 0131: Privacy panel Cookies card 'N third-party' reads as leakage while isolation is on

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: 2026-10-06

## Report
The Cookies card shows e.g. "16 first-party · 35 third-party" right below an active "Isolate 3rd-party cookies" switch. It counts **stored** cookies whose domain differs from the page, including CHIPS partition copies (DD8). Blocked cookies are never stored, so this isn't leakage, but the operator read it as alarming during the sortie 02 HAT. Reword the summary to make clear it is stored cookies (e.g. "stored: 16 first-party · 35 third-party").

## Evidence
`src/renderer/chrome/privacy-controller.js:548` — "`${ck.first} first-party · ${ck.third} third-party`"; sortie 02 HAT step 2.

## Corrective Action
Cookies card summary in `privacy-controller.js` now reads `Stored: N first-party · M third-party`. Counting, list and buttons unchanged. No test or behavior spec pinned the old string.

## Verification
format:check, lint, typecheck, privacy-controller unit test and full `npm test` run (see developer report).

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the 2026-10-06 turnaround)
**Verdict**: confirmed, no blocking issues (`npm test` x3 green, lint/typecheck/format:check/audit clean). Electron 44.5.0 and SDK 1.31.0 also live-verified by the third-party-cookie-isolation run 2026-10-06-18-13-21 (pass).
**Commit**: the `squawk: turnaround 2026-10-06` commit on `squawk/turnaround-2026-10-06`
