# Squawk 0128: Settings automation-activity '.activity-kind' badge fails color contrast

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: —

## Report
axe (wcag2aa) reports `color-contrast` (serious) on `.activity-kind` in `goldfinch://settings`'s automation activity section. This is the first time the settings page was audited, during sortie 02 AC9. The issue is pre-existing and not in the sortie diff.

## Evidence
`src/renderer/pages/settings.css:696` `.activity-kind` (`color: var(--accent)` on `var(--bg-2)`, 11px; admin variant `#a371f7`). Reproduce: `npm run a11y -- --target=goldfinch://settings --tags=wcag2a,wcag2aa,wcag21a,wcag21aa`.

## Corrective Action
*(written at completion)*

## Verification
*(written at completion)*

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
