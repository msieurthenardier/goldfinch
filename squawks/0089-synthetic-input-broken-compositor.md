# Squawk 0089: Synthetic input and capture non-functional under a broken compositor

**Status**: deferred
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-19
**Completed**: —

## Report

On `npm run dev:automation` in a WSL sandbox, `click`, `typeText`, `pressKey` and
`captureScreenshot` were all non-functional: a synthetic Tab never moved
`document.activeElement` off `<body>`, a synthetic click never fired a plain
`onclick` handler, and `captureScreenshot` failed with `UnknownVizError`.

Meanwhile `evaluate`, `enumerateTabs`, `openTab`, `navigate` and `activateTab` all
worked — consistent with a broken Viz/compositor rather than a broken automation
surface. The same ops work fine against the operator's installed build.

This blocked Mission 21 Flight 1 Leg 5's live verification entirely; the flight
landed with that acceptance outstanding until the operator closed it by hand.

## Evidence

- Launch log: `drmGetDevices2() has not found any devices`,
  `Failed to send GpuControl.CreateCommandBuffer`.
- Recorded in
  `missions/21-saving-not-just-filling/flights/01-the-save-moment/flight-log.md`
  (Leg 5 progress entry, "Honest gap: live verification NOT completed").

## Disposition

**Deferred**, not fixed. Most likely rig-specific — no DRM render node in the
sandbox — rather than an app defect, and there is no obvious app-side fix to make.

**Revisit trigger**: the next time MCP-driven live verification is needed and
synthetic input fails, OR if the same symptoms are ever seen on native hardware
(which would make it an app defect rather than an environment one).

Recorded rather than dropped because it silently removes a large part of the live
verification surface, and the next person to hit it would otherwise re-diagnose it
from scratch — which is precisely what happened twice inside Flight 1.

A possible real fix, if anyone wants it: surface a clear error when the compositor
is unavailable instead of letting input ops no-op silently. That is a behaviour
change and would be a flight, not this squawk.

## Corrective Action

*(n/a — deferred)*

## Verification

*(n/a — deferred)*

## Sign-Off

*(n/a — deferred)*
