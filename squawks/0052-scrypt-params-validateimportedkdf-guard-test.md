# Squawk 0052: Guard-test that SCRYPT_PARAMS passes validateImportedKdf (DD1 coupling)

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-30

## Report
Flight 4 (F2) made `_readManager` fail closed on out-of-bounds KDF params. Its
"no legitimate manager is ever out-of-bounds" guarantee (DD1) holds ONLY while
`setup()` is the sole `kdf` writer and `vc.SCRYPT_PARAMS` stays inside
`validateImportedKdf`'s bounds. A future production-param bump past the import
bounds (or a second kdf writer) would fail closed on LEGITIMATE managers — a
silent break surfacing at a user's unlock, not at test time. Add a guard-test
asserting `validateImportedKdf(vc.SCRYPT_PARAMS)` does not throw, so the coupling
fails loudly in CI the moment it is violated. Surfaced by the Flight 4 debrief.

## Evidence
- `src/main/vault/vault-crypto.js:52` — `SCRYPT_PARAMS` (N=2^17, r=8, p=2,
  maxmem=192 MiB).
- `src/main/vault/vault-store.js:215` — `validateImportedKdf` bounds; `:387` —
  the read-path call added by Flight 4.
