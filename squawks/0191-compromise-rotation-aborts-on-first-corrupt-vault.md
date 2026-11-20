# Squawk 0191: Compromise rotation aborts on the first corrupt vault file

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-15
**Completed**: 2026-11-19

## Report
Carried from Mission 23 Flight 2 (noted by the Developers of `vault-binding` and `vault-upgrade`). The rotation loop reads every vault file and throws on the first one that fails to parse or unwrap, so a single damaged or foreign file in the vaults directory blocks rotation of every other vault — in the one situation where the operator most needs it to run. The upgrade at unlock skips such a file and carries on; rotation does not.

## Evidence
- `src/main/vault/vault-store.js` — `compromiseRotate` (enumeration and per-file read before the transaction).
- `test/unit/vault-upgrade.test.js` — the failure matrix notes rotation succeeds only after the foreign file is removed.

## Corrective Action
Operator ruling (2026-11-19, recorded by the Flight Director): rotate every readable vault, leave the unreadable file UNTOUCHED on disk (never deleted, rewritten or rebound), and report it by name (vault id + reason code, never content) in the result and with one log line per skipped file.

- `src/main/vault/vault-store.js` `compromiseRotate`: the per-file read, mrk-envelope unwrap and item decrypt in the enumeration loop (before `vtxn.beginTransaction`) are now inside a `try`; a failure is recorded in `skipped: [{ id, reason }]` (reason via the existing `exportSkipReason` from squawk 0190: `no-unwrap` / `unreadable-format` / `read-failed`), logged once as `[vault] compromise-rotate: skipped "<id>": <reason>`, and the loop continues. The transaction and its crash-safety path are unchanged; nothing is caught inside it. The return gains `skipped` additively (JSDoc updated). If nothing at all was readable (`rebuilt` empty, `skipped` non-empty) it throws `VaultFormatError('compromise rotation: no vault could be read')` before any write.
- Consequence, stated plainly: after rotation the old master key is gone, so a skipped vault that is wrapped under the OLD key can no longer be opened with the new key. Its file stays on disk byte-for-byte, so the operator can restore it from a bundle. Registry entry is left in place: this is the same state the unlock-time upgrade already tolerates (it skips such a file with `wrong-key`, unlock and later rotations proceed, and it reports again each time), so no schema or lifecycle change was needed. Strays outside the registry are likewise left alone.
- Surface not widened: the result is reported from the store; `main.js` `vaultCompromiseRotate` still forwards only `recoveryKey` and `revoked` to the sheet handler (that file is not named by this squawk), so the skipped list reaches the log and the store result, not the sheet UI.

## Verification
Decide and state the behaviour (refuse loudly naming the file, or rotate the rest and report it); a unit test with one corrupt file beside two good ones pins it. If the decision is not obvious, escalate rather than fix.

Ran:
- `node --test test/unit/vault-compromise-rotate.test.js test/unit/vault-upgrade.test.js`: 55 pass, 0 fail (rotate file: corrupt and foreign tests rewritten to the skip behaviour; new tests: corrupt file beside good vaults - good ones open with the new key only, old master refused, corrupt bytes identical, result names it; every vault unreadable - refuses with `VaultFormatError`, disk byte-identical). `vault-upgrade.test.js` failure-matrix note updated: rotation succeeds with the foreign file left in place and untouched.
- Neuter check: making the catch rethrow turned 3 tests red (6, 7, 8); restored.
- `npm test`: 7404 pass, 0 fail. `npm run lint`, `npm run typecheck` clean; `npm run format` then `format:check` clean.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the fifth 2026-11-19 turnaround)
**Verdict**: confirmed, security reviewed, following the operator ruling of 2026-11-19 (rotate the readable vaults, leave the unreadable file byte-identical, report it). The skip sits before `beginTransaction`; manager I/O and the master/recovery auth check stay outside the catch; the old key is still zeroized on a skip; the skipped vault's unlock-time upgrade logs `wrong-key` once and does not loop. The skipped list is not shown to the operator yet, and the skipped vault keeps its access envelopes; both are logged as squawk 0229. Gates at re-review: `npm test` 7,417 tests (7,412 pass, 0 fail, 1 skipped — the `jq` test, no `jq` on the dev host — and 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-e`
