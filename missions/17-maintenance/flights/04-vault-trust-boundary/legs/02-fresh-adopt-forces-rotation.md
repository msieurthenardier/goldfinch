# Leg: fresh-adopt-forces-rotation

**Status**: landed
**Flight**: [Vault Trust-Boundary Hardening](../flight.md)
**Finding**: F8 (maintenance report 2026-08-27)
**Risk tier**: HIGH — crypto trust decision; changes `importVault`'s
fresh-path RETURN SHAPE (a shared interface, single consumer).

## Objective

On a **fresh-profile** bundle adopt, force rotation of the recovery key and
admin keypair inline under the already-live MRK (DD2), so neither donor
envelope survives in the adopted `manager.json`, and RETURN the two new
one-time secrets so the surfacing leg (Leg 3) can reveal them. The donor's
MASTER envelope is intentionally left in place (DD4 residual — documented
in Leg 4, not fixed here).

**Scope split (divert, 2026-08-29):** the design review confirmed a [HIGH]
lockout hazard in surfacing two one-time sheets back-to-back — so the UI
surfacing is a separate leg (Leg 3). THIS leg is store-only: rotation,
return shape, and store-level unit tests. It is independently landable and
fully unit-testable; because the flight uses a single deferred commit at
flight end, the rotate-but-not-yet-surfaced intermediate never ships.

## Context (current code, verified 2026-08-29)

- Fresh-adopt branch — `importVault`, `src/main/vault/vault-store.js`:
  `!this.isSetUp()` at `:1048`; the live `mrk` is unwrapped BEFORE the
  `try` (`vc.unwrapRecovery` at `:1028` for the recovery kind,
  `vc.unwrapMaster` at `:1031` for the master kind) — so BOTH adopt kinds
  hold a live, authenticated MRK at the rotation point. The branch writes
  the global vault (`_writeVaultForKey`, `:1050`, reads `mrk`
  non-destructively), then `_writeManager({ ... mrk: { master, recovery,
  admin }, adminPublicKeyB64, kdf })`, then `_installMrk(mrk); mrk = null`
  (`:1063-1064` — install-ownership handoff; the `finally` dual-zeroize is
  guarded by the null), then returns at `:1065`.
- Rotation primitives (first arg = the vault key = MRK; `{ version }` opts):
  `vc.generateRecoveryKey()` → `{ display, material }` (`vault-crypto.js:572`);
  `vc.wrapRecovery(mrk, material, { version })` (`:383`);
  `vc.generateAdminKeypair()` → `{ publicKey, privateKey, publicKeyB64,
  privateKeyB64 }` (`:615`); `vc.sealToAdmin(mrk, publicKey, { version })`
  (`:459`). `setup()` (`:604-641`) mints all three under a live MRK and
  zeroizes `recovery.material` post-wrap (`:633`) — mirror that exactly;
  it returns `{ recoveryKeyDisplay, adminPrivateKeyB64 }` (`:641`).
- Why NOT the public `rotateRecovery`/`rotateAdminKey` (DD2): both require a
  master-password step-up; a `secretKind: 'recovery'` adopt has none.
  Inline-under-live-MRK avoids the step-up and works for both kinds.
- Return consumer: `importVault`'s return is consumed at exactly ONE site,
  `vaultImportFromSheet` (`src/main/main.js:956`, `:962`), which today does
  not even capture it. The renderer/preload `importVault`
  (`menu-overlay.js:1734`) rides the IPC handler's `{ ok }`, not the store
  return. So the two new fresh-only fields break no destructuring.
- Store-level verification handles that exist: `openAllWithAdminKey(priv)`
  (`:1702`) and `unlockWithRecovery` (`:687`). Precedent for "old priv
  rejected / new priv opens": `test/unit/vault-admin-key-provision.test.js:120-124`.
- Test harness: `test/unit/vault-export-import.test.js` (`FAST_SCRYPT`,
  `managerPath(dir)`, export→import round-trip helpers, `makeSource()`).

## Acceptance Criteria

1. **Inline forced rotation on the fresh-adopt branch.** In `importVault`'s
   `!this.isSetUp()` branch, BEFORE `_writeManager`, mint a fresh recovery
   key and admin keypair under the live `mrk` and write THOSE:
   `manager.mrk.recovery = vc.wrapRecovery(mrk, rec.material, { version:
   MANAGER_VERSION })`; `manager.mrk.admin = vc.sealToAdmin(mrk,
   admin.publicKey, { version: MANAGER_VERSION })`; `manager.adminPublicKeyB64
   = admin.publicKeyB64` — instead of the donor's `bundle.mrk.recovery` /
   `bundle.mrk.admin` / `bundle.adminPublicKeyB64`. `manager.mrk.master`
   stays `bundle.mrk.master` (DD4). No master-password step-up. `rec.material`
   is zeroized after wrapping (mirror `setup()` `:633`). Rotation may sit
   anywhere before `_installMrk`; keep the `_installMrk(mrk); mrk = null`
   handoff and the `finally` dual-zeroize untouched.
2. **Fresh-path return shape (scoped interface change, single consumer).**
   The fresh branch returns `{ imported: true, fresh: true, vaultId,
   recoveryKeyDisplay: rec.display, adminPrivateKeyB64: admin.privateKeyB64 }`.
   The EXISTING-profile branch return (`{ imported: true, fresh: false,
   vaultId }`) is UNCHANGED.
3. **Store-level unit test** (in `test/unit/vault-export-import.test.js`),
   for BOTH `secretKind: 'master'` and `secretKind: 'recovery'` adopts onto
   a fresh profile — assert on the written `manager.json`:
   - `mrk.recovery !== bundle.mrk.recovery` AND `mrk.admin !==
     bundle.mrk.admin` AND `adminPublicKeyB64 !== bundle.adminPublicKeyB64`
     (neither donor envelope/seal survives);
   - `mrk.master === bundle.mrk.master` (DD4 residual present — proves the
     scope boundary is intentional and tested);
   - the returned `recoveryKeyDisplay` unlocks the adopted profile
     (`unlockWithRecovery` succeeds), proving no lockout on recovery-adopt;
   - the returned `adminPrivateKeyB64` opens via `openAllWithAdminKey`, and
     the OLD donor `adminPrivateKeyB64` is REJECTED (mirror
     `vault-admin-key-provision.test.js:120-124`).
4. **Zeroization intact.** The fresh `rec.material` Buffer is zeroized
   post-wrap; the admin private key survives only as the returned string
   (a KeyObject/string, nothing to zeroize — as `setup()` does); the live
   `mrk` is installed (not double-zeroized — `mrk = null` guards the
   `finally`); the existing dual-zeroize is unchanged.
5. **Rewrite the EXISTING assertions that encode the pre-rotation "verbatim
   adopt" contract — they break BY DESIGN, not as regressions.** In
   `test/unit/vault-export-import.test.js`:
   - the `assert.deepEqual(res, { imported, fresh, vaultId })` (~`:234`) —
     update to the new 5-field fresh shape;
   - the `mrk[slot]` verbatim-equality loop + `adminPublicKeyB64` equality
     (~`:240-243`) — invert for `recovery`/`admin` (now MUST differ) while
     keeping `master` verbatim; `kdf` stays `deepEqual` (unchanged);
   - the "unlock by the SOURCE RECOVERY key" test (~`:283-306`) — rotation
     invalidates the source recovery key, so rewrite it to assert the source
     recovery key is now REJECTED and the RETURNED new recovery key unlocks
     (fold AC3's recovery pair in here).
   - **Helper gap**: `makeSource()` currently discards the source
     `adminPrivateKeyB64` (~`:65`) — capture and return it so AC3's
     old-admin-key-rejected assertion has the donor key to test.
   Treat these reds as expected; do not "fix" them back to the old contract.
6. **No regression.** `npm test` (canonical) green with the new + rewritten
   tests; `npm run typecheck`, `npx eslint .`, `npx prettier --check .`
   clean. `npm run a11y` NOT required (no DOM markup changes in this leg —
   surfacing is Leg 3).

## Verification

- AC1/AC2: read the fresh branch; confirm the four field substitutions and
  the 5-field return; `grep -rn "importVault(" src/` to reconfirm the single
  consumer.
- AC3/AC5: run `node --test test/unit/vault-export-import.test.js` green;
  temporarily revert the AC1 recovery substitution and confirm the
  "donor recovery survives" assertion goes RED, then restore.
- AC6: `npm test` counts before/after (report both); typecheck/eslint/prettier clean.

## Out of Scope

- **UI surfacing of the two new secrets — Leg 3** (the [HIGH] divert).
- F2 read-path validation (Leg 1).
- The donor MASTER-envelope residual — documented in Leg 4, not severed (DD4).
- MRK re-key / compromise-mode rotation (F6 backlog).
- `docs/vault.md` and the squawk 0022 threat-model bullet (Leg 4).

## Citation Audit

Verified 2026-08-29 against `src/main/vault/vault-store.js` (1812 lines),
`vault-crypto.js`, `main.js`: fresh branch `!isSetUp()`:1048, `unwrapRecovery`:1028,
`unwrapMaster`:1031, `_writeVaultForKey`:1050, install handoff:1063-1064, fresh
return:1065; `setup` return:641, `recovery.material` zeroize:633;
`generateRecoveryKey`:572, `wrapRecovery`:383, `generateAdminKeypair`:615,
`sealToAdmin`:459; `openAllWithAdminKey`:1702, `unlockWithRecovery`:687;
`vaultImportFromSheet` main.js:956/962; renderer importVault menu-overlay.js:1734.
All current (design review confirmed; ≤4-line drift on setup-return/fresh-branch,
immaterial).
