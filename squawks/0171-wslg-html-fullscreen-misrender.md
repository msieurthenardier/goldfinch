# Squawk 0171: HTML element fullscreen mis-renders on Linux/WSLg and leaves the layout shifted on exit

**Status**: deferred
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-05
**Completed**: —

## Report
On the Linux dev build under WSLg, entering HTML element fullscreen (`document.documentElement.requestFullscreen()` from a trusted click) draws the guest page in the top-left corner with black bands on the right and bottom. On exit (Esc) the window returns to its normal size, but the page AND the chrome stay shifted right, partly out of the window, as if still laid out at fullscreen size. Resizing the window does not recover it; only a relaunch does. Reproduced on a control page that never showed a save prompt (Sortie 06 HAT H11, 2026-11-05), so it predates Sortie 06. The operator's installed Windows build renders fullscreen correctly (cross-platform control).

## Evidence
- `src/main/html-fullscreen.js` — window-record fullscreen mode: enter/exit drive `win.setFullScreen` and the guest re-expand via `sendActiveBounds` → `tab-set-bounds`; the resize-while-fullscreen path re-expands the guest.
- CLAUDE.md native-surface rule ("DOM correct ≠ render correct"): the chrome shifting too suggests the chrome view's bounds (not only the guest's) are stale after exit — a WSLg/Wayland configure ordering question, not yet diagnosed.

## Corrective Action
*(written at completion)*

## Verification
By eye on WSLg: element fullscreen fills the window with no bands; Esc restores both the chrome and the guest to the window bounds; Windows unchanged.

## Disposition
**Deferred**: found mid-flight during the Sortie 06 HAT (out of scope); root cause undiagnosed — revisit at the next touch of `html-fullscreen.js` or a Linux/WSLg native-surface spike. If diagnosis shows the fix needs a design call (e.g. reworking the enter/exit bounds sequencing), escalate to a sortie rather than growing this squawk.
