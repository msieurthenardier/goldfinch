# Squawk 0183: A window may be left open with no tabs after its only tab is moved out and back (unconfirmed)

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-14
**Completed**: —

## Report
Seen once, by a Developer's scripted smoke during Mission 23 Flight 1 (`jar-isolation`): after a tab was moved to a second window and back, the second window stayed open with no tabs until the app quit. Not reproduced, not seen by the operator (the HAT's window group was not walked), and it may be an artefact of driving the move through automation. Logged so it is not lost; the first step is a deliberate reproduction by hand.

## Evidence
- Flight log, Leg 06 entry, out-of-scope findings: "After the move test, a second window stayed open with no tabs until the app was quit (dev-mode apparatus)."
- Move paths: `tab-move-to-new-window` / `tab-move-to-window` in `src/main/register-tab-ipc.js`; the never-zero-tabs fallback lives in the chrome's close path.
- Not known whether this predates the flight; check on `main` during the repro.

## Corrective Action
*(written at completion)*

## Verification
Reproduce by hand on `main` and on the flight branch: move a window's only tab to another window by menu and by drag. If an empty window results, the fix decides whether the source window closes or opens a fresh tab — if that needs a lifecycle decision rather than restoring an existing rule, it fails the squawk gate and escalates to a sortie. If it cannot be reproduced by hand, close as not reproducible with the attempt recorded.

## Sign-Off
*(written at completion)*
