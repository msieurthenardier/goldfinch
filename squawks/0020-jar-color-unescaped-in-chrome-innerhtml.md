# Squawk 0020: Jar color interpolated raw into a `style` attribute via `innerHTML` in the chrome view

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

Two chrome sinks build `style="…${jar.color}…"` inside an `innerHTML` assignment without passing the color through `isSafeColor`, while every peer sink does. Not attacker-reachable today (registry colors pass `cleanColor`; the burner color is a frozen constant) — this is defense-in-depth that goes live the moment a color arrives from import, sync, or automation. `validateMoveTabPayload` also shape-checks `color` only as `string`. Fix: apply `isSafeColor` in `validateMoveTabPayload` and at both sinks; add a unit case with a `"`-bearing color.

Source: maintenance report 2026-08-27, finding F3.

## Evidence

- `src/renderer/chrome/tab-controller.js:115` (into `innerHTML` at `:123`); `src/renderer/chrome/privacy-controller.js:414` (sibling `c.name` escaped, color not)
- `src/main/move-tab-payload.js:46` — `typeof color === 'string'` only
- Peer sinks gate with `isSafeColor`: `pages/settings.js:844`, `pages/jars-section-controller.js:454`, `pages/vault.js:1067`, `menu-overlay.js:395`

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
