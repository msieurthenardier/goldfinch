# Squawk 0057: Kebab menu unclickable on the new-install homepage/search-engine setup page until set and a new page loads

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-01

## Report

Operator-observed on a fresh profile (new install, dev profile restored
2026-09-01 during Mission 18 Flight 2 leg-5 setup): on the initial
set-homepage / set-search-engine page shown to new installs, the chrome
kebab menu does not respond to clicks. It becomes clickable only after
the choices are set and a new page has loaded. Expected: the kebab (and
chrome controls generally) are operable regardless of the welcome
surface's state.

Likely neighborhood: the welcome/first-run surface and its interaction
with chrome menu dispatch (see `welcome-controller.js` and the chrome
menu wiring); fix approach expected to be a focus/enable-state or
overlay/pointer-events issue — discoverable in one read pass.

## Evidence

- Operator reproduction, 2026-09-01, dev profile fresh install (WSLg).
  Kebab unresponsive on the welcome/setup surface; responsive after
  setting values and navigating.
- Not investigated further mid-flight (logged from Flight 2 leg-5 setup;
  deferred per the mid-flight squawk protocol).

## Corrective Action

*(recorded at completion)*

## Verification

*(recorded at completion)*

## Sign-Off

*(recorded at completion)*
