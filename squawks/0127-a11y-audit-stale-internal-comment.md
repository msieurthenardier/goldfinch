# Squawk 0127: a11y-audit.mjs: stale comments claim internal pages are excluded from evaluate

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: —

## Report
The script's comments say the eval tool always excludes the internal session, even for admin. Sortie 02 proved otherwise: `npm run a11y -- --target=goldfinch://settings` works under admin (admin `evaluate` reaches internal guests via `allowInternal`). Correct the comments and the related `getGuestWcId` messaging so operators know the settings page can be audited.

## Evidence
`scripts/a11y-audit.mjs:264` — "CAVEAT (internal-session exclusion): the eval tool ALWAYS excludes the internal"; `:278`; sortie 02 flight log, AC9 entry.

## Corrective Action
*(written at completion)*

## Verification
*(written at completion)*

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
