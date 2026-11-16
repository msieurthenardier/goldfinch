# Squawk 0192: A leftover journal at unlock delays the vault upgrade by one unlock

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-15
**Completed**: —

## Report
Found by the Developer of Mission 23 Flight 2's `vault-upgrade` leg. When an unlock finds a transaction journal already present, the upgrade recovers it and then skips itself for that unlock; version-1 files stay unconverted until the next unlock. Nothing is lost, but a profile in that state runs one session longer on files that are not bound to their vault.

## Evidence
- `src/main/vault/vault-store.js` — `_upgradeVaultFilesCore`, the journal-present branch.
- `test/unit/vault-upgrade.test.js` — the 'journal already present' row of the failure matrix.

## Corrective Action
*(written at completion)*

## Verification
After a successful recovery in that branch the upgrade proceeds in the same unlock; the existing test is extended to assert every file is version 2 after one unlock, and the crash-safety tests still pass.

## Sign-Off
*(written at completion)*
