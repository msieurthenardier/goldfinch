# Squawk 0189: The key-derivation validator accepts a memory limit that scrypt then rejects

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-14
**Completed**: 2026-11-19

## Report
Found at the design review of Mission 23 Flight 2's vault legs and confirmed in leg `kdf-rewrap`. `validateImportedKdf` accepts a manager or bundle whose `maxmem` is at least `128 * N * r`. Node's scrypt needs about `128 * r * (N + p + 2)` and fails with `ERR_CRYPTO_INVALID_SCRYPT_PARAMS` at exactly `128 * N * r`. So a manager or bundle can pass validation and then fail to derive its key — an opaque failure at unlock or import rather than a clear "invalid parameters" at read. The app's own default is well clear of the bound; only a hand-made or foreign document could hit it.

## Evidence
- `src/main/vault/vault-store.js` — `validateImportedKdf` (`maxmem >= 128 * N * r`).
- `test/unit/vault-kdf-rewrap.test.js` — the `maxmem`-too-small fixtures; `chooseRewrapKdf` already uses the real requirement.

## Corrective Action
- `src/main/vault/vault-store.js`: new `scryptMinMaxmem(N, r, p)` (`128 * r * (N + p + 2)`), the single formula; `validateImportedKdf` and `chooseRewrapKdf` both call it. No fixture needed adjusting.
- `test/unit/vault-export-import.test.js`: the `validateImportedKdf` test now asserts exactly `128*N*r` is rejected with the validator's own `VaultFormatError` (and that real `crypto.scryptSync` throws there), `128*r*(N+p+2)` is accepted and really derives (N=2^12), one byte less is rejected.

## Verification
The validator uses the real requirement; a unit test shows a document at `128 * N * r` is rejected at read with the validator's own error, and one at `128 * r * (N + p + 2)` is accepted and derives.

Ran: targeted tests 18/18 pass; neuter (old bound restored) -> new test fails (11 pass, 1 fail), fix restored; `npm test` 7399/7404 pass, 0 fail (rest skipped/todo); lint, typecheck, format:check clean.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the fifth 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. `scryptMinMaxmem` is the single formula, used by both `validateImportedKdf` and `chooseRewrapKdf`; the test calls real `crypto.scryptSync` at the old bound (fails), the real bound (derives) and one byte under (rejected). Gates at re-review: `npm test` 7,417 tests (7,412 pass, 0 fail, 1 skipped — the `jq` test, no `jq` on the dev host — and 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-e`
