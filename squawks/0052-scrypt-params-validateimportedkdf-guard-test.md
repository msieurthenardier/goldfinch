# Squawk 0052: Guard-test that SCRYPT_PARAMS passes validateImportedKdf (DD1 coupling)

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-30
**Completed**: 2026-08-30

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

## Corrective Action
Added a guard test to `test/unit/vault-store-kdf-read-validation.test.js` — the
file that already covers `_readManager`'s DD1 fail-closed read-path behavior —
asserting `vs.validateImportedKdf(vc.SCRYPT_PARAMS)` does not throw:

```js
test('vc.SCRYPT_PARAMS (the production KDF) passes validateImportedKdf — DD1 coupling guard', () => {
  assert.doesNotThrow(
    () => vs.validateImportedKdf(vc.SCRYPT_PARAMS),
    'production SCRYPT_PARAMS drifted outside validateImportedKdf bounds — _readManager would now ' +
      'fail closed on every legitimate manager at unlock, not just tampered ones'
  );
});
```

Added the `vc` (`vault-crypto`) require alongside the file's existing `vs`
require to reach `SCRYPT_PARAMS`. Test-only change — no production code touched.

Note found during investigation: an equivalent assertion,
`assert.doesNotThrow(() => vs.validateImportedKdf(vc.SCRYPT_PARAMS));`, already
existed in `test/unit/vault-export-import.test.js` (added under PR#112 finding 4,
predating the Flight 4 F2 read-path guard) and continues to pass — the underlying
coupling was never actually unguarded. The new copy is deliberately added anyway:
it is co-located with the DD1 read-path truth table and failure message it backs,
so a future drift surfaces directly against the test suite that documents the
"no legitimate manager is ever out-of-bounds" guarantee, rather than only against
an unrelated import-hardening file a reader would have to know to check.

## Verification
- `node --test test/unit/vault-store-kdf-read-validation.test.js` — **17 pass / 0
  fail**, including the new `... — DD1 coupling guard` test.
- `node --test test/unit/vault-store-kdf-read-validation.test.js
  test/unit/vault-export-import.test.js test/unit/vault-store.test.js
  test/unit/vault-crypto.test.js` — **100 pass / 0 fail**.
- `npm test` (full unit suite, includes the pre-existing uncommitted squawk 0051
  changes untouched by this squawk) — **4008 pass / 0 fail**.

Only `test/unit/vault-store-kdf-read-validation.test.js` (and this artifact)
changed.

## Sign-Off
**Reviewer**: independent Reviewer agent (squawk-review, scoped to the batch diff)
**Verdict**: confirmed — guard-test correct; the pre-existing equivalent
assertion in `test/unit/vault-export-import.test.js` (PR#112) is real, and the
deliberate co-location with the DD1 read-path truth table was judged reasonable
(non-blocking, transparently flagged); `npm test` 4008/4008, eslint/prettier
clean
**Commit**: `squawk/turnaround-2026-08-30` (squash-merged via its PR)
