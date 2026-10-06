# Squawk 0126: Jar retention select reads '1 days'

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: 2026-10-06

## Report
The jar retention select renders "1 days" for a one-day window.

## Evidence
`src/renderer/pages/jars-section-controller.js:85` — "`opt.textContent = `${days} days``"; `:268` — "`${preset} days``".

## Corrective Action
Added a local `retentionLabelFor(days)` helper in `jars-section-controller.js` ("1 day" / "N days") and used it at both sites (preset options and `ensureRetentionOption`). No other user-visible "days" label exists in the jars page.

## Verification
New unit test in `test/unit/jars-section-controller.test.js` pins "1 day" / "2 days" / "7 days" and absence of "1 days". `node --test` on the file passes; format:check, lint, typecheck, full `npm test` run.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the 2026-10-06 turnaround)
**Verdict**: confirmed, no blocking issues (`npm test` x3 green, lint/typecheck/format:check/audit clean). Electron 44.5.0 and SDK 1.31.0 also live-verified by the third-party-cookie-isolation run 2026-10-06-18-13-21 (pass).
**Commit**: the `squawk: turnaround 2026-10-06` commit on `squawk/turnaround-2026-10-06`
