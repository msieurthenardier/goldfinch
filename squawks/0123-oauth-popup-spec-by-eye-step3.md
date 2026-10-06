# Squawk 0123: web-compat-oauth-popup spec: mark step 3's on-screen clause [by-eye]

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: —

## Report
Step 3's "a real popup window appears on screen (visually distinct floating window)" can't be observed by the apparatus on Wayland, because `captureWindow` composites only the browser window. Every automated run therefore lands INCONCLUSIVE; the first run needed an operator by-eye confirmation. Split that clause into an explicit `[by-eye]` operator check, add a `captureScreenshot {popup wcId}` expectation, and update Last Run. Optionally, make the ack-driven close observable.

## Evidence
`tests/behavior/web-compat-oauth-popup/runs/2026-10-06-13-24-48.md` step 3 (operator by-eye pass).

## Corrective Action
*(written at completion)*

## Verification
*(written at completion)*

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
