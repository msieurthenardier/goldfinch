# Squawk 0123: web-compat-oauth-popup spec: mark step 3's on-screen clause [by-eye]

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: 2026-10-06

## Report
Step 3's "a real popup window appears on screen (visually distinct floating window)" can't be observed by the apparatus on Wayland, because `captureWindow` composites only the browser window. Every automated run therefore lands INCONCLUSIVE; the first run needed an operator by-eye confirmation. Split that clause into an explicit `[by-eye]` operator check, add a `captureScreenshot {popup wcId}` expectation, and update Last Run. Optionally, make the ack-driven close observable.

## Evidence
`tests/behavior/web-compat-oauth-popup/runs/2026-10-06-13-24-48.md` step 3 (operator by-eye pass).

## Corrective Action
Amended `tests/behavior/web-compat-oauth-popup.md`: step 3's on-screen clause is now an explicit `[by-eye]` operator clause (unobservable on Wayland); automated clauses kept (popup:true row, not in tab strip, live opener handle) and a `captureScreenshot {popup wcId}` painted-surface expectation at the feature size added. New "Row Conventions" section documents how a `[by-eye]` clause is reported, and notes the ack-driven close is not distinguishable from a plain close. Last Run header and fixture untouched.

## Verification
`npx prettier --write` on changed files and `npm run format:check` (see handoff report). Doc-only change; no unit tests affected.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the 2026-10-06 turnaround)
**Verdict**: confirmed, no blocking issues (`npm test` x3 green, lint/typecheck/format:check/audit clean). Electron 44.5.0 and SDK 1.31.0 also live-verified by the third-party-cookie-isolation run 2026-10-06-18-13-21 (pass).
**Commit**: the `squawk: turnaround 2026-10-06` commit on `squawk/turnaround-2026-10-06`
