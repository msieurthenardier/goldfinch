# Squawk 0126: Jar retention select reads '1 days'

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: —

## Report
The jar retention select renders "1 days" for a one-day window.

## Evidence
`src/renderer/pages/jars-section-controller.js:85` — "`opt.textContent = `${days} days``"; `:268` — "`${preset} days``".

## Corrective Action
*(written at completion)*

## Verification
*(written at completion)*

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
