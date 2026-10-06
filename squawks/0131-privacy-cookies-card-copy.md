# Squawk 0131: Privacy panel Cookies card 'N third-party' reads as leakage while isolation is on

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: —

## Report
The Cookies card shows e.g. "16 first-party · 35 third-party" right below an active "Isolate 3rd-party cookies" switch. It counts **stored** cookies whose domain differs from the page, including CHIPS partition copies (DD8). Blocked cookies are never stored, so this isn't leakage, but the operator read it as alarming during the sortie 02 HAT. Reword the summary to make clear it is stored cookies (e.g. "stored: 16 first-party · 35 third-party").

## Evidence
`src/renderer/chrome/privacy-controller.js:548` — "`${ck.first} first-party · ${ck.third} third-party`"; sortie 02 HAT step 2.

## Corrective Action
*(written at completion)*

## Verification
*(written at completion)*

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
