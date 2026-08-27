# Squawk 0025: `bookmarks-bar.js` has no line-budget test — M15 asked for one, never landed

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

Mission 15's debrief asked to "give the budget test a second file" for `bookmarks-bar.js` (1046 lines) alongside the existing `renderer.js` pin. Nothing landed. Add a budget assertion beside the existing one in `seam-contract.test.js`, set at the current size plus a small allowance, so the drag-session/render extraction seam is protected from growth until it is actually split.

Source: maintenance report 2026-08-27, finding F25 (known, M15).

## Evidence

- `test/unit/seam-contract.test.js:146` — `RENDERER_LINE_BUDGET` pin for `renderer.js` (1649/1650)
- `grep -rn budget test/unit` — no pin for `bookmarks-bar.js`

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
