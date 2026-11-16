# Squawk 0191: Compromise rotation aborts on the first corrupt vault file

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-15
**Completed**: —

## Report
Carried from Mission 23 Flight 2 (noted by the Developers of `vault-binding` and `vault-upgrade`). The rotation loop reads every vault file and throws on the first one that fails to parse or unwrap, so a single damaged or foreign file in the vaults directory blocks rotation of every other vault — in the one situation where the operator most needs it to run. The upgrade at unlock skips such a file and carries on; rotation does not.

## Evidence
- `src/main/vault/vault-store.js` — `compromiseRotate` (enumeration and per-file read before the transaction).
- `test/unit/vault-upgrade.test.js` — the failure matrix notes rotation succeeds only after the foreign file is removed.

## Corrective Action
*(written at completion)*

## Verification
Decide and state the behaviour (refuse loudly naming the file, or rotate the rest and report it); a unit test with one corrupt file beside two good ones pins it. If the decision is not obvious, escalate rather than fix.

## Sign-Off
*(written at completion)*
