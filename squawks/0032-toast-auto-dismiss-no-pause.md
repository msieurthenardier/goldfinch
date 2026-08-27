# Squawk 0032: Media toasts auto-dismiss on a fixed 5–8 s timer with no pause on hover or focus

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

Toasts in `media-controller.js` remove themselves after 8000 ms / 5000 ms unconditionally. WCAG 2.2.1 (Timing Adjustable) asks that timed content pause or extend on user attention. Pause the removal timer while the toast is hovered or holds focus, and resume on leave/blur. The downloads indicator's 5-minute expiry is unaffected (it hides a badge only; nothing is lost).

Source: maintenance report 2026-08-27, finding F50.

## Evidence

- `src/renderer/chrome/media-controller.js:475` — `setTimeout(() => el.remove(), 8000)`; `:592` — 5000 ms variant

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
