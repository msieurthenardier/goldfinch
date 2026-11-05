# Squawk 0170: Esc does not exit HTML element fullscreen on the Windows build

**Status**: deferred
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-05
**Completed**: —

## Report
On the operator's installed Windows build, Esc does not leave HTML element fullscreen (a page's `requestFullscreen()`); only F11 exits. On the Linux/WSLg dev build Esc does exit (Sortie 06 HAT H11 control, 2026-11-05). Repro: on Windows, open a page that enters element fullscreen from a click (e.g. a video's fullscreen button), press Esc → stays fullscreen.

## Evidence
- `src/main/guest-wiring.js` web-guest `before-input-event` — "M14 F1 L1 (DD1): defensive Esc" branch: on `Escape` while `htmlFullscreen.isFullscreen(contents.id)`, runs `document.exitFullscreen()` page-side (no `preventDefault`). Blink's native Esc exit is expected to fire `leave-html-full-screen` first.
- `src/main/html-fullscreen.js` `exit()` — the `leave-html-full-screen` handler body (idempotent).
- Not reproducible on the Linux dev rig; needs a Windows run to see which half fails (native Esc not firing, the defensive branch not reached, or the page-side `exitFullscreen()` resolving without a leave event).

## Corrective Action
*(written at completion)*

## Verification
By eye on a Windows build: element fullscreen → Esc → window and guest restore; F11 path unchanged.

## Sign-Off
*(written at completion)*

## Disposition
**Deferred**: found mid-flight during the Sortie 06 HAT (out of that sortie's scope); needs a Windows rig to diagnose — revisit when Sortie 06 has landed and a Windows build is at hand.
