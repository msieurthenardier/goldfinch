# Squawk 0127: a11y-audit.mjs: stale comments claim internal pages are excluded from evaluate

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: 2026-10-06

## Report
The script's comments say the eval tool always excludes the internal session, even for admin. Sortie 02 proved otherwise: `npm run a11y -- --target=goldfinch://settings` works under admin (admin `evaluate` reaches internal guests via `allowInternal`). Correct the comments and the related `getGuestWcId` messaging so operators know the settings page can be audited.

## Evidence
`scripts/a11y-audit.mjs:264` — "CAVEAT (internal-session exclusion): the eval tool ALWAYS excludes the internal"; `:278`; sortie 02 flight log, AC9 entry.

## Corrective Action
Comment/help-text only. In `scripts/a11y-audit.mjs` rewrote the header NOTE, the `getGuestWcId` CAVEAT and the not-found error text: admin key can audit internal pages via `--target=goldfinch://settings` (allowInternal); a jar key cannot (never sees the internal session). Corrected the matching Exclusions bullet in `docs/dev-testing.md`. No behavior change.

## Verification
Ground truth checked in `src/main/automation/resolve.js` (allowInternal guard) and sortie 02 flight log AC9. `npx prettier --write`, `npm run format:check`, `npm run lint` run clean (see report).

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the 2026-10-06 turnaround)
**Verdict**: confirmed, no blocking issues (`npm test` x3 green, lint/typecheck/format:check/audit clean). Electron 44.5.0 and SDK 1.31.0 also live-verified by the third-party-cookie-isolation run 2026-10-06-18-13-21 (pass).
**Commit**: the `squawk: turnaround 2026-10-06` commit on `squawk/turnaround-2026-10-06`
