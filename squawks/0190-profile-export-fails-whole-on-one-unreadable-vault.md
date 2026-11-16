# Squawk 0190: A profile export fails entirely when one vault is unreadable

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-15
**Completed**: —

## Report
Carried from Mission 23 Flight 2 (legs `vault-format-v2` and its review). `exportProfile` reads and rebuilds every vault for the bundle; if one vault file is corrupt, missing its key envelope, or does not unwrap, the whole export throws and nothing is exported — the operator cannot back up the vaults that are fine. This was already true before the flight; the per-entry rebuild added one more way to reach it.

## Evidence
- `src/main/vault/vault-store.js` — `_exportProfile` (per-entry read, unwrap and rebuild with no per-entry `try`).
- Flight debrief, `missions/23-security-review-remediation/flights/02-vault-and-automation-boundary/flight-debrief.md`, Technical.

## Corrective Action
*(written at completion)*

## Verification
An export of a profile with one deliberately corrupted vault file writes a bundle holding the readable vaults and reports the one it skipped; a unit test builds that profile and restores the bundle.

## Sign-Off
*(written at completion)*
