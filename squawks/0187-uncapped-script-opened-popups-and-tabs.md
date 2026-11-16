# Squawk 0187: A page can open an unbounded burst of popups, or of tabs, with or without a click

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-14
**Completed**: —

## Report
Measured in Mission 23 Flight 2's `port-and-permissions` leg (guard-audit NF6) on Electron 45.3.2. A script calling `window.open` ten times with a features string got ten popup windows, both from inside a click and with no user activation at all; with no features string it got ten new tabs (the app converts those). Nothing caps either. A cap on popups alone would only move the burst to tabs, and the number and whether to require activation are a design call — so this fails the squawk gate's "no design decisions" test and is recorded here for escalation to a sortie.

## Evidence
- Flight log, `missions/23-security-review-remediation/flights/02-vault-and-automation-boundary/flight-log.md`, leg `port-and-permissions`, measurement AC1(b).
- `src/main/guest-wiring.js` — popup qualification (disposition, features, safe URL) has no count.

## Corrective Action
*(written at completion)*

## Verification
A per-opener limit on windows and tabs opened without a fresh user activation, decided in a sortie; measured with the same ten-call burst.

## Sign-Off
*(written at completion)*
