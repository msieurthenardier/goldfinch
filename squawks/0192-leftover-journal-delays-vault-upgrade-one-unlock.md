# Squawk 0192: A leftover journal at unlock delays the vault upgrade by one unlock

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-15
**Completed**: 2026-11-19

## Report
Found by the Developer of Mission 23 Flight 2's `vault-upgrade` leg. When an unlock finds a transaction journal already present, the upgrade recovers it and then skips itself for that unlock; version-1 files stay unconverted until the next unlock. Nothing is lost, but a profile in that state runs one session longer on files that are not bound to their vault.

## Evidence
- `src/main/vault/vault-store.js` — `_upgradeVaultFilesCore`, the journal-present branch.
- `test/unit/vault-upgrade.test.js` — the 'journal already present' row of the failure matrix.

## Corrective Action
Recovery runs in two places: the store constructor (`vtxn.recover`, vault-store.js ~line 1125) and, for residue appearing later, `_upgradeRecover` called from the journal-present branch of `_upgradeVaultFilesCore`. That branch now re-reads the vault directory after `_upgradeRecover('*')` and proceeds with the upgrade in the same unlock when no journal remains; if recovery failed (swallowed, `recover-failed` logged) or a journal still exists, or the re-read fails, it keeps the skip. No change to recovery, the journal format or the transaction; still synchronous, one try.

## Verification
After a successful recovery in that branch the upgrade proceeds in the same unlock; the existing test is extended to assert every file is version 2 after one unlock, and the crash-safety tests still pass.

Ran: test/unit/vault-upgrade.test.js, 28 pass / 0 fail. The 'journal already present' row now asserts versions `{global:2, work:2, play:2}` and no journal after ONE unlock; a new row stubs `vtxn.recover` to throw and asserts the skip (files unchanged, `recover-failed` logged) then upgrade on the next unlock. Neuter-verified: replacing the post-recovery journal re-check with an unconditional `return` fails both rows (26 pass / 2 fail); restored.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the fifth 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. The re-check of the directory runs after the existing `_upgradeRecover('*')`; a failed re-read or a remaining journal still skips; no `await`, and the source-scan pins pass. Gates at re-review: `npm test` 7,417 tests (7,412 pass, 0 fail, 1 skipped — the `jq` test, no `jq` on the dev host — and 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-e`
