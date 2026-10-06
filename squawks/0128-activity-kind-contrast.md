# Squawk 0128: Settings automation-activity '.activity-kind' badge fails color contrast

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: 2026-10-06

## Report
axe (wcag2aa) reports `color-contrast` (serious) on `.activity-kind` in `goldfinch://settings`'s automation activity section. This is the first time the settings page was audited, during sortie 02 AC9. The issue is pre-existing and not in the sortie diff.

## Evidence
`src/renderer/pages/settings.css:696` `.activity-kind` (`color: var(--accent)` on `var(--bg-2)`, 11px; admin variant `#a371f7`). Reproduce: `npm run a11y -- --target=goldfinch://settings --tags=wcag2a,wcag2aa,wcag21a,wcag21aa`.

## Corrective Action
Settings page is single-theme (dark tokens only: `--bg-2` #282a32, `--accent` #f5c518). Computed WCAG ratios on `--bg-2`: default `.activity-kind` (`--accent`) is 8.78:1 (passes, unchanged); admin variant `#a371f7` was 4.27:1 (FAIL, <4.5). Changed only the admin text color in `.activity-session.admin .activity-kind` to `#b69cf7` (same violet hue, lightened) = 6.19:1. Border stays `#a371f7` (non-text). No tokens changed; no other surface affected.

## Verification
Ratios computed via the WCAG relative-luminance formula (script in scratchpad). Live `npm run a11y -- --target=goldfinch://settings` re-run deferred to the Flight Director.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the 2026-10-06 turnaround)
**Verdict**: confirmed, no blocking issues (`npm test` x3 green, lint/typecheck/format:check/audit clean). Electron 44.5.0 and SDK 1.31.0 also live-verified by the third-party-cookie-isolation run 2026-10-06-18-13-21 (pass).
**Commit**: the `squawk: turnaround 2026-10-06` commit on `squawk/turnaround-2026-10-06`
