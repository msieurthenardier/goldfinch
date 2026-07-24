# Leg: export-import

**Status**: completed
**Flight**: [Portability + Rotation + Hardening + Docs](../flight.md)

## Objective

Give the vault file-based portability: export a self-contained bundle (Option A — the manager's MRK
envelopes + the target `.gfvault`, built while unlocked with no password), and import it — on a fresh
profile (adopt the bundle's manager) or an existing one (re-key under the destination MRK) — so the
source master password OR recovery key unlocks the imported vault. No network egress.

## Context

- **Flight DD1 (Option A)** — the bundle = `{ format:'gfvault-bundle', version, sourceVaultId, kdf,
  mrk:{ master, recovery, admin }, adminPublicKeyB64, vault:<the .gfvault doc> }`. **All THREE mrk
  envelopes** (review [HIGH]: `_readManager` requires all three, or the adopted profile wedges at
  boot; `mrk.admin` is ciphertext, no plaintext, and preserves admin portability). All inputs are on
  disk while unlocked, so **export takes no password** (satisfies "encrypted export not re-prompted",
  `mission.md:150`). The operator's **existing** master password OR recovery key opens it.
- **Flight DD2** — export needs no secret entry; **import's** master-pw-or-recovery entry routes
  through the chrome-owned sheet (Buffer channel), never the page DOM. The bundle file is all
  ciphertext + kdf + public key — safe to hand to the page for file I/O.
- **Import destination-target model (DD1)** — `_writeVaultForKey` writes `<vaultId>.gfvault`, but a
  usable vault must be `GLOBAL_ID` or a persistent jar in `listJars()`. Import takes a **destination
  target** and re-keys under it; refuse-on-collision by default.
- **F1 primitives** — `serializeVault`/`parseVault`, `wrapMaster`/`unwrapMaster`,
  `wrapRecovery`/`unwrapRecovery`, `_vaultKeyFromDoc`, `_writeVaultForKey`, `setup`,
  `unlock`/`unlockWithRecovery`, `_readManager`/`_writeManager`.

## Inputs

- `src/main/vault/vault-store.js` — `setup` (`:385`, writes manager.json), `_readManager`/`_writeManager`
  (`:200/244`), `_writeVaultForKey` (`:449`), `_vaultKeyFromDoc` (`:604`), `_readVault`/`_writeVault`,
  `unlock`/`unlockWithRecovery` (`:471/481`), `isSetUp`/`isUnlocked`, `_resolveTarget` (`:572`).
- `src/main/vault/vault-crypto.js` — `serializeVault`/`parseVault`, the envelope ops, `unwrapMaster`/
  `unwrapRecovery`.
- `src/main/register-vault-ipc.js` + `register-overlay-ipc.js` — the internal-IPC + the F3 sheet
  Buffer-channel + cross-renderer request idiom (for the import unlock sheet).
- `src/renderer/pages/vault.{js,css}` — add export/import UI.
- Electron `dialog.showSaveDialog`/`showOpenDialog` (main) for the file picker.

## Outputs

- **Store ops (net-new, `vault-store.js`)**:
  - `exportVault(target)` → the bundle object (requires unlocked — policy; reads
    `manager.mrk.{master,recovery,admin}` + `manager.kdf` + `manager.adminPublicKeyB64` + the target
    `.gfvault` via `_readVault`). NO password. Returns a serializable bundle (all ciphertext).
  - `importVault(bundle, { destinationTarget, secret, secretKind })` → `parseVault(bundle.vault)` +
    validate the bundle; **do ALL crypto before ANY write**: unwrap the MRK — master:
    `unwrapMaster(bundle.mrk.master, secret, { version: MANAGER_VERSION, params: bundle.kdf })`
    (Buffer); recovery: `unwrapRecovery(bundle.mrk.recovery, parseRecoveryKey(secret.toString('utf8')),
    { version: MANAGER_VERSION })` (**review [HIGH]: recovery is a base32 STRING via `.toString('utf8')`,
    NOT a Buffer — `parseRecoveryKey`→`base32Decode` throws on non-string**); then unwrap the vault key
    from `bundle.vault`'s `mrk`-env with `mrkEnvelopeAad(bundle.vault.version)`; `decryptItems`.
    - **fresh profile (`!isSetUp()`):** **adopt the bundle's manager** — write the vault file FIRST,
      then `manager.json` from `bundle.mrk` (all three slots) + `kdf` + `adminPublicKeyB64` (review [MED]:
      vault-before-manager so a failure never flips `isSetUp()` true without a vault). **Install the
      MRK** (`_installMrk`) so the profile is left **unlocked** (fires `onUnlock`) — analogous to
      `setup`. The source master password / recovery key unlock this profile on restart.
    - **existing profile (set up + unlocked):** re-key the (source) vault key under the **destination**
      MRK: `_writeVaultForKey(destinationTarget, vaultKey, this.mrk, decryptedItems)`; **refuse if
      `_vaultPath(destinationTarget)` exists** unless `overwrite:true`; then **evict the destination's
      cached key** (`this.vaultKeys.get(dest)?.fill(0); this.vaultKeys.delete(dest)` — else a stale
      cached key GCM-fails against the new ciphertext).
    - Zeroize the transient bundle-MRK + vault-key buffers (the fresh-path installed MRK is retained).
    - A wrong secret → `VaultAuthError` (GCM fail) during the crypto phase → **nothing written**.
- **IPC**:
  - `internal-vault-export(target)` (`registerInternalHandler` + `catchLocked`) → returns the bundle
    (ciphertext) to the page; the page writes it via a save dialog (main-side `showSaveDialog`, or the
    handler writes the chosen path).
  - Import flow: the page reads a bundle file (open dialog) + picks a destination → a **cross-renderer
    request** opens a chrome sheet (`vault-import-unlock`, mirroring `vault-unlock`) that collects the
    **master password OR recovery key** as a `Uint8Array` → `menu-overlay:vault-import` invoke →
    `importVault(bundle, { destinationTarget, secret:Buffer, secretKind })` → dual-zeroize.
- **Page UI** — a per-vault **Export** button (→ bundle → save dialog) and an **Import** control
  (open dialog → destination picker → sheet unlock). `textContent`-only.
- **Tests** — unit: `exportVault` shape (ciphertext only, no plaintext, no password needed);
  `importVault` round-trip on a **fresh** userDataPath (adopt-manager; unlock by master AND by
  recovery) and on an **existing** profile (re-key under destination; refuse-on-collision; wrong
  secret fails auth). Integration: the export/import IPC + the sheet Buffer channel (dual-zeroize,
  sender/token). A **fresh-profile import** integration test (a second `userDataPath`) — the mission
  criterion.

## Acceptance Criteria

- [x] `exportVault(target)` produces a self-contained bundle with **no plaintext secret and no
      password prompt** (grep AC); it contains the manager's master + recovery MRK envelopes + kdf +
      the target `.gfvault`. *(All three mrk slots; unit-tested incl. no-plaintext assertion.)*
- [x] Importing the bundle on a **fresh profile** (second `userDataPath`) establishes a manager and
      the vault, unlockable by the **source master password** AND, independently, by the **recovery
      key** (integration test — the mission portability criterion). *(vault-export-import.test.js:
      fresh-profile round-trip via a second `mkdtempSync` + `vs.load`, unlock by both secrets.)*
- [x] Importing on an **existing** profile re-keys the vault under the destination MRK (readable by
      the destination master password); **refuses on collision** with an existing vault of that id
      unless explicitly overwritten. *(Also: unknown-target refused via `resolveTarget`.)*
- [x] The import's master-pw/recovery entry is on the **chrome sheet** (Buffer channel, dual-zeroized),
      never the page DOM or an `internal-*` payload (grep AC). *(`menu-overlay:vault-import`; the page
      carries only the destination target — never the secret.)*
- [x] A wrong master password/recovery key fails authenticated decryption (no partial install).
- [x] Existing tests pass unmodified; `npm test` (2548 pass / 0 fail), `npm run typecheck`, lint clean.

## Verification Steps

- Unit: `exportVault` (no-password, ciphertext-only); `importVault` fresh-profile (adopt, unlock by
  both secrets) + existing-profile (re-key, refuse-on-collision) + wrong-secret-fails.
- Integration: the IPC + sheet channel (dual-zeroize, sender/token); the **fresh-profile import**
  round-trip (second userDataPath).
- `npm test` full — no regressions. typecheck + lint clean.
- Grep: the bundle carries no plaintext; the import secret only on the sheet Buffer channel.

## Implementation Guidance

1. **`exportVault(target)`** — `_requireMrk`; `const m = this._readManager()`; `const vaultDoc =
   this._readVault(this._resolveTarget(target))`; return `{ format:'gfvault-bundle', version:1,
   sourceVaultId: <resolved id>, kdf: m.kdf, mrk: { master: m.mrk.master, recovery: m.mrk.recovery,
   admin: m.mrk.admin }, adminPublicKeyB64: m.adminPublicKeyB64, vault: vaultDoc }`. No password, no write.
2. **`importVault(bundle, { destinationTarget, secret, secretKind })`** — `vc.parseVault(bundle.vault)`
   + validate bundle format/version/mrk. **Crypto phase (before any write):** `const mrk =
   secretKind==='recovery' ? vc.unwrapRecovery(bundle.mrk.recovery,
   vc.parseRecoveryKey(secret.toString('utf8')), { version: MANAGER_VERSION }) : await
   vc.unwrapMaster(bundle.mrk.master, secret, { version: MANAGER_VERSION, params: bundle.kdf })`;
   `const vaultKey = vc.unwrapVaultKey(<mrk env of bundle.vault>, mrk, mrkEnvelopeAad(bundle.vault.version))`;
   `const items = vc.decryptItems(bundle.vault.items, vaultKey)`. A wrong secret throws `VaultAuthError`
   here → nothing written. **Then the fresh-vs-existing branch (Outputs):** fresh → write vault file,
   then manager.json (`format:MANAGER_FORMAT`, `version:MANAGER_VERSION`, `kdf`, `adminPublicKeyB64`, all
   three mrk slots — `_readManager` requires format+version too), then `_installMrk(mrk)` (leave
   unlocked); existing → **`const dest = this.resolveTarget(destinationTarget)`** (allowlist — refuse an
   unknown/traversal target, not just a collision) → refuse if `_vaultPath(dest)` exists →
   `_writeVaultForKey(dest, vaultKey, this.mrk, items)`, evict the dest cached key, zeroize the bundle
   MRK + vaultKey. **Also zeroize the transient recovery material** from `parseRecoveryKey` in a `finally`
   (mirror `unlockWithRecovery`'s `material.fill(0)`).
3. **Sheet + IPC** — mirror F3's `vault-set`/`menu-overlay:vault-setup` for the import unlock sheet
   (`vault-import-unlock`; a `secretKind` master|recovery toggle; payload `{ token, secret:Uint8Array,
   secretKind }`; dual-zeroize). **Export stays fully main-side** (review): `internal-vault-export(target)`
   builds the bundle, `dialog.showSaveDialog` + writes the chosen path — the ciphertext never transits
   to the page (the internal page is `sandbox:true` and can't write files anyway). Import: page open-dialog
   → destination pick → the sheet unlock → `menu-overlay:vault-import` → `importVault`.
4. **Page** — Export (per vault) + Import (file + destination + sheet). `textContent`-only.

## Edge Cases

- **Fresh profile** — adopt the bundle's manager (source envelopes become the new manager.json).
- **Existing profile, id collision** — refuse unless `overwrite:true` (an explicit page confirm).
- **Source jar vault → different profile** — the source jarId won't exist on the destination; the
  destination target (global or a chosen jar) is where it lands, re-keyed.
- **Wrong secret** — `VaultAuthError`, no partial write.
- **Bundle tamper / bad format** — `parseVault`/validation throws `VaultFormatError`, loud.
- **Buffer zeroization** — the import secret + the transient MRK/vault key, on success and throw.
- **Locked at export** — `catchLocked` → `{locked:true}` → page routes to unlock.

## Files Affected

- `src/main/vault/vault-store.js` — `exportVault`/`importVault`.
- `src/main/register-vault-ipc.js` — `internal-vault-export` + the import request-trigger.
- `src/main/register-overlay-ipc.js` — `menu-overlay:vault-import` handler (Buffer, dual-zeroize).
- `src/renderer/menu-overlay.js` (+ `src/shared/vault-import-template.js`) — the `vault-import-unlock` sheet.
- `src/main/main.js` — the `vaultImport` delegate + `showSaveDialog`/`showOpenDialog` wiring.
- `src/preload/internal-preload.js` + `renderer-globals.d.ts` — export/import bridge + types.
- `src/renderer/pages/vault.{js,css}` — export/import UI.
- `scripts/a11y-audit.mjs` — `vault-import-unlock` in `SHEET_STATES`/`NODE_IDS`.
- `test/unit/…` — export/import store ops (fresh + existing userDataPath), the IPC + sheet channel.

---

## Post-Completion Checklist

**Complete ALL before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with the leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
- [x] Do NOT commit (deferred-commit model — Flight Director commits at flight end)
