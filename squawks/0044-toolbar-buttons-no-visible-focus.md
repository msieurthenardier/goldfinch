# Squawk 0044: Toolbar buttons that receive keyboard focus draw no visible focus indicator

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-28
**Completed**: —

## Report

When the backward tab-boundary handoff (Mission 17 Flight 1 Leg 1) places focus on the chrome's last visible tabbable, that element renders **no focus indicator**: `#bookmarks-overflow` ("More bookmarks", web tabs) and `#kebab` ("More", internal tabs, where the bookmarks bar is hidden) both have computed `outline: none` when focused, and an 8× crop of the chevron shows a plain glyph. The address bar draws a yellow ring on the Ctrl+L path and guest controls draw an orange ring, so a sighted keyboard user Shift+Tabbing out of a page lands on invisible focus. WCAG 2.4.7 Focus Visible (Level AA). Fix: a `:focus-visible` style for the toolbar/bookmarks-bar buttons (audit `#kebab`, `#bookmarks-overflow`, the media/shields/devtools/vault toggles, the tab-strip buttons) consistent with the address bar's ring; verify with `npm run a11y` where it covers the chrome, and a source pin that the rule exists.

Source: behavior-test run `tests/behavior/chrome-guest-keyboard-nav/runs/2026-08-28-01-01-15.md`, checkpoints 8 and 11 (Validator notes).

## Evidence

- Run 2026-08-28-01-01-15: `step-8-eval-C-active-detail.txt` (focused `#bookmarks-overflow`, computed outline none — Validator fresh read), `step-8-validator-crop-chevron.png`; checkpoint 11 `#kebab` likewise
- `src/renderer/styles.css` — `:focus-visible` rules exist for `#address` and inputs (sweep F51), not for the toolbar buttons

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
