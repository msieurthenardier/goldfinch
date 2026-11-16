# Squawk 0189: The key-derivation validator accepts a memory limit that scrypt then rejects

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-14
**Completed**: —

## Report
Found at the design review of Mission 23 Flight 2's vault legs and confirmed in leg `kdf-rewrap`. `validateImportedKdf` accepts a manager or bundle whose `maxmem` is at least `128 * N * r`. Node's scrypt needs about `128 * r * (N + p + 2)` and fails with `ERR_CRYPTO_INVALID_SCRYPT_PARAMS` at exactly `128 * N * r`. So a manager or bundle can pass validation and then fail to derive its key — an opaque failure at unlock or import rather than a clear "invalid parameters" at read. The app's own default is well clear of the bound; only a hand-made or foreign document could hit it.

## Evidence
- `src/main/vault/vault-store.js` — `validateImportedKdf` (`maxmem >= 128 * N * r`).
- `test/unit/vault-kdf-rewrap.test.js` — the `maxmem`-too-small fixtures; `chooseRewrapKdf` already uses the real requirement.

## Corrective Action
*(written at completion)*

## Verification
The validator uses the real requirement; a unit test shows a document at `128 * N * r` is rejected at read with the validator's own error, and one at `128 * r * (N + p + 2)` is accepted and derives.

## Sign-Off
*(written at completion)*
