# Leg: Compromise-Rotate Store Op

**Status**: completed
**Flight**: [Compromise-Mode Rotation](../flight.md)

## Objective

Implement `compromiseRotate` in the vault store: the single operation
that, on the legs-1/2 machinery, mints a fresh MRK and fresh vault keys,
re-encrypts every vault's items, drops every access envelope, removes the
admin provision, re-wraps under a required new master password, commits
it all as one transaction, installs the new MRK post-commit, and returns
the new one-time recovery key plus the revocation report. Store-only —
IPC/sheets/UI are leg 4.

## Context (ground truth after legs 1–2)

- Leg 1: manager v2 live (optional-but-paired admin; per-document version
  AAD threading; `READABLE_MANAGER_VERSIONS`, `isEnvelopeShaped`
  module-local). **This op is the first legitimate v2 writer.**
- Leg 2 handoff API (verbatim from its report): `vault-txn.js` exports
  `beginTransaction(dir, members)` (`members: [{finalName, content:
  Buffer|string}]`) → handle; `commit(handle)`; `recover(dir)`;
  `VaultTxnError`; name helpers. Member names must be plain basenames
  outside the txn/stage/tmp family (`manager.json`, `<id>.gfvault` fine).
  Call `_ensureVaultsDir()` before beginning. From vault-store:
  `store._acquireRekeyGate()` — async, throws `VaultBusyError` if already
  raised, drains, returns idempotent release fn; **acquire INSIDE the
  rotation's `_withManagerLock` turn, release in `finally`** (designer
  ruling, leg 2); the sinks' second wall refuses `_writeManager`/
  `_writeVault` while the gate is up, so **all rotation writes go through
  the transaction primitive**.
- Suite at 4053/4053. Crypto helpers (vault-crypto.js): `newVaultKey`,
  `wrapVaultKey`/`unwrapVaultKey`, `encryptItems`/`decryptItems`,
  `wrapMaster` (async scrypt)/`unwrapMaster`, `wrapRecovery`/
  `unwrapRecovery`, `generateRecoveryKey`/`parseRecoveryKey`. Enumeration
  recipe: `GLOBAL_ID + listJars()` with null-skip (lazily-absent vaults)
  — `openAllWithAdminKey`'s idiom, substituting the credential-derived
  MRK. Each `.gfvault`'s single `keyId:'mrk'` envelope + flat access
  envelopes (`keyId !== 'mrk'` sentinel).

## Scope

1. **`compromiseRotate(args)`** — two credential branches, both work from
   locked or unlocked (the op derives the old MRK from the supplied
   credential, never from `this.mrk`; requires `isSetUp()`):
   - Master branch: `{oldMasterPassword, newMasterPassword}` (Buffers).
     Step-up = unwrap the old master envelope (doc's version). **R7**:
     byte-equality of old/new password buffers → distinct reuse error
     (no scrypt needed for this branch's check).
   - Recovery branch: `{recoveryKey, newMasterPassword}` (display
     string + Buffer). Unwrap MRK via the recovery envelope. **R7**:
     test-unwrap the old **master** envelope with `newMasterPassword`
     (`unwrapMaster`, doc kdf + doc version) — an unwrap **success** is
     reuse (zeroize that MRK buffer, throw the reuse error); the good
     case throws `VaultAuthError` and is swallowed as "not a reuse"
     (only that specific class from that specific call — anything else
     propagates).
   - The reuse error is a new exported **`VaultPasswordReuseError`**
     (distinct class — leg 4's sheet handler maps it to the ruled inline
     copy "Your new master password must be different from your old
     one"; it must be discriminable from wrong-credential
     `VaultAuthError`).
2. **The rotation body**, inside `_withManagerLock`, gate acquired after
   the credential validates (fail cheap before drain), released in
   `finally`:
   - Mint: fresh MRK, fresh recovery key material, fresh vault key per
     existing vault. **Enumeration (designer ruling, design review Q3):
     the union of the registry recipe (GLOBAL + `listJars()`, null-skip)
     and a `readdir` of `*.gfvault`** — a vault file outside the
     registry whose `mrk` envelope unwraps under the old MRK is rotated
     like any other (registry drift must not leave a vault severed
     under the old key); one that fails to unwrap fails the rotation
     **loudly, pre-commit** (a foreign/corrupt vault file during a
     security operation is an integrity anomaly to surface, never to
     skip silently). For each vault: unwrap its old vault key via the
     old MRK, decrypt items, re-encrypt under its fresh vault key, build
     the new `.gfvault` doc with **exactly one envelope** (the new `mrk`
     envelope, vault-doc AAD version unchanged — access envelopes are
     dropped by construction). The rotation never calls gated public ops
     internally (they'd self-block at entry) — direct `_readVault`-level
     reads only.
   - Build the new manager doc at **`version: 2`** with **no admin
     fields**: master envelope = `wrapMaster(newMrk, newMasterPassword)`
     at v2 AAD, recovery envelope new at v2 AAD. **KDF ruling (design
     review Q2): preserve `manager.kdf`** — the document's existing
     params, exactly as every existing rotation does (`params:
     manager.kdf` idiom); never the bare `SCRYPT_PARAMS` constant and
     never silently swapping an adopted profile's params. Read-time
     bounds are already guaranteed by `validateImportedKdf` (F2) and the
     squawk-0052 guard test.
   - `_ensureVaultsDir()` → `beginTransaction` (manager.json + every
     rebuilt `.gfvault`) → `commit`. **Failure discrimination
     (design-review HIGH):** the catch around the transaction MUST
     branch on the handle's `committed` flag (`vault-txn.js:284` — set
     immediately after the discriminator rename):
     - **Uncommitted** → run `recover(this.vaultsDir)` (rolls back),
       rethrow — disk untouched, live state untouched.
     - **Committed** (a final rename or journal unlink threw in-process
       AFTER the discriminator) → the rotation **succeeded**: run
       `recover()` to finish the roll-forward, then proceed to
       `_installMrk` and return normally. Never rethrow on this branch —
       a rethrow would tell the operator "nothing changed" over a
       durably rotated disk and lose the one-time recovery key.
     Pinned by a monkeypatch test (throw once inside `commit` after the
     discriminator → op returns success, new credentials live).
   - **Post-commit**: `_installMrk(newMrk)` (resets/zeroizes all cached
     keys, bumps `_mrkGen`, fires `onUnlock` — profile ends unlocked
     regardless of entry lock state, per DD3/DD6); then compute the
     return value.
   - Return: `{recoveryKey: <one-time display>, revoked: {admin:
     <bool — doc had the admin pair>, vaultIds: [<ids whose vault
     carried ≥1 access envelope>]}}`. **Field ruling (design review Q1):
     `vaultIds`, not `jarIds`** — `mintAccessKey` accepts the global
     target, so `GLOBAL_ID` may legitimately appear; leg 4's completion
     card renders it with its display label like any other row. The
     one-time display is surfaced by leg 4; it never persists.
   - Zeroization discipline: old MRK, every old and new **vault-key**
     working buffer, and decrypted item plaintext are zeroized in
     `finally`. **Ownership clarified (design review):** `newMrk` is
     owned by `_installMrk` on success (NOT zeroized by the op) and by
     the op's `finally` on the uncommitted-failure path only;
     caller-supplied password buffers are **not** zeroized by the op —
     the sheet handler owns them, per the store's existing
     `changeMasterPassword` idiom (leg 4 inherits that discipline).
   - Master-branch R7 check order: byte-equality (`Buffer.equals`)
     BEFORE the step-up scrypt (cheapest first); a justifying comment
     notes timing-safety is not required — the comparison's outcome is
     deliberately disclosed to the operator who supplied both inputs,
     so there is no oracle. Malformed recovery display throws
     `VaultFormatError` from `parseRecoveryKey` (not `VaultAuthError`)
     — recorded for leg 4's error mapping, with one negative test.
3. **Adversarial + interruption suites** (new
   `test/unit/vault-compromise-rotate.test.js`):
   - **Full sever (criterion 1)**: fixture = provisioned-admin v1 profile
     with 2 jar vaults + items + a minted access key; capture before
     rotation: recovery display, admin private key, access-key secret,
     raw MRK bytes, a vault key's bytes, byte snapshots of manager +
     vaults. After rotation: old recovery fails, old admin key fails
     (`unlockWithAdmin` → no-admin `VaultStateError`), old access secret
     fails (`openVaultWithAccessKey`), old MRK bytes fail direct GCM
     against new envelopes, snapshotted old files still open with old
     credentials (proving the capture was valid) but the live dir does
     not; new master + new recovery both unlock; items round-trip
     identical; every `.gfvault`'s item ciphertext is byte-different;
     manager on disk is `version: 2`, no admin fields, kdf unchanged.
   - **Report correctness**: `revoked.admin` true only for
     provisioned-admin fixtures; `vaultIds` exactly the vaults that
     carried access envelopes (incl. the none case, and a
     global-vault-access-key fixture pinning `GLOBAL_ID` in the list).
   - **Out-of-sever-scope pins (stated so the suite never misreads
     them as failures)**: a bundle exported BEFORE the rotation still
     adopts onto a *fresh* profile with the old credentials (it carries
     its own envelopes/kdf/managerVersion — by design, same class as the
     snapshotted-old-files assertion) and still imports into the rotated
     profile; both pinned as expected behavior. This feeds CP5's
     threat-model doc bullet: compromise mode severs the *live profile*,
     not previously exported artifacts the operator holds.
   - **Corrupt/foreign vault handling**: a content-corrupt `.gfvault`
     (parseVault throws) or an un-unwrappable one encountered during
     enumeration fails the rotation cleanly pre-commit — disk
     byte-identical, gate/lock released, store still usable (subsequent
     ops succeed). One row each.
   - **Old vault key negative**: the captured pre-rotation vault-key
     bytes fail GCM against the rotated vault's items blob (completes
     the "every captured material fails" set).
   - **Double-rotate**: a second `compromiseRotate` queued on the
     manager lock runs post-release against the new profile — the old
     credential now fails `VaultAuthError`, disk unchanged by the failed
     attempt; a fresh-credential second rotate succeeds.
   - **Minimal profile**: rotation with zero jar vaults (global only)
     succeeds.
   - **R7 both branches**: master-branch byte-equality rejected;
     recovery-branch reuse (new password == old) rejected via test-unwrap
     with `VaultPasswordReuseError`; recovery-branch good case passes;
     wrong old credential → `VaultAuthError`, nothing changes on disk.
   - **v1 → v2 transition**: rotating a v1 profile yields v2 (the first
     v2-writer path); rotating an already-v2 (previously rotated,
     no-admin) profile works (idempotent shape, admin stays absent,
     `revoked.admin` false).
   - **Busy/exclusivity**: a gated op during the rotation's window →
     `VaultBusyError`; the rotation on a store with a raised gate →
     `VaultBusyError` from `_acquireRekeyGate`.
   - **Interruption (criterion 2, op-level)**: monkeypatch kills at
     Nth `renameSync`/`writeSync`/`fsyncSync`/`unlinkSync` points across
     the rotation (named kill points, leg-2 style — including journal
     removal after all renames → committed-journal no-op roll-forward at
     next load) → fresh `load()` + `recover` yields entirely-old
     (pre-commit kills: old credentials open, old bytes intact) or
     entirely-new (post-commit kills: new credentials open); in-process
     pre-commit throw → old state intact, no journal/staged residue,
     store still usable (lock/gate released, subsequent ops succeed);
     in-process POST-discriminator throw → op returns success and the
     new credentials are live (the design-review HIGH pin).
   - **Lock-state matrix (store half)**: op succeeds from a locked store
     (never unlocked this session) and from an unlocked one; both end
     unlocked (`onUnlock` fired, `isUnlocked()` true).

Out of scope: IPC handlers, sheets, page, broadcasts, completion-card
state, docs (leg 4); any adopt change (Flight 3).

## Acceptance Criteria

- [x] AC1: Full-sever suite passes as specified (every captured old
      credential/material fails; new credentials succeed; items intact;
      ciphertext rotated; manager v2 no-admin on disk).
- [x] AC2: R7 matrix passes — reuse rejected on both branches with
      `VaultPasswordReuseError`; good cases pass; wrong credentials
      leave disk byte-identical.
- [x] AC3: Interruption matrix passes — entirely-old or entirely-new at
      every kill point; in-process pre-commit failure leaves a usable
      store and untouched disk.
- [x] AC4: Report correctness + busy/exclusivity + lock-state-matrix
      pins pass.
- [x] AC5: `npm test` (4053 + new), `typecheck`, `lint`, `format:check`
      all clean; no existing test modified (this leg is purely
      additive — legs 1–2 already re-modeled everything this touches).

## Verification

Electron-free harness (temp dirs, FAST_SCRYPT, on-disk byte probes,
`vault-key-rotation.test.js` idioms). Old-material replay uses
vault-crypto directly against on-disk docs where no store API exists for
the negative (e.g. raw-MRK GCM probes), mirroring the F4 adversarial
style.

## Citation Audit (2026-09-01)

Leg-2 handoff API quoted verbatim from its completion report (same
session, tree unchanged since). Crypto helper names spot-checked at leg 1
implementation. Designer ruling on lock/gate acquisition order recorded
in the flight log (leg 2 entry) and restated in Context.
