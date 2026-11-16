# Vault file format — planning reconnaissance

**Flight**: [Vault and Automation Boundary](flight.md)
**Date**: 2026-11-14 — read-only reading of `src/main/vault/vault-crypto.js` (`vc`), `src/main/vault/vault-store.js` (`vs`, 4,166 lines), `src/main/vault/vault-txn.js` (`txn`) and their tests, by a crew member, for the design of legs `vault-binding` and `vault-binding-carriers`. Nothing was run. Symbols, not line numbers, are the stable reference: three earlier legs of this flight edited near these files.

## Findings that shaped the design

- **A. No id check anywhere.** `_readVault(vaultId)` parses the file and nothing else; `parseVault` does not type-check `vaultId`. With one master key wrapping every vault's key and no id in any AAD, jar A's file at jar B's path opens as B, through the human path and through automation's admin path. A jar access key fails (B's secret is not in A's file).
- **B. Access envelopes cannot be re-wrapped by an upgrade.** Their key derives from a secret the app does not keep; their AAD is `gfvault/env/${version}/hkdf-access/${keyId}`, with the constant default at both ends. Their AAD version must stay 1 whatever the document version.
- **C. The per-vault key envelope uses a store-local AAD** (`mrkEnvelopeAad(version)` = `gfvault/mrk-env/v${version}`): written with the constant, read with `doc.version` at eight sites. An upgrade holds the master key and can re-wrap it; a writer that copies envelopes verbatim must not stamp a new version.
- **D. `serializeVault` always stamps the constant.** `_mintAccessKey` and `_revokeAccessKey` copy items and envelopes verbatim; the item writers copy envelopes verbatim and re-encrypt items with the default version. Stamping a new version on any of them without re-wrapping would produce an unreadable file.
- **E. Profile bundles scrub the embedded document's `vaultId` to an entry handle** while copying its ciphertext verbatim. With id-bound encryption such a document could not be decrypted — the real id is gone. Profile export must re-encrypt under the entry handle. Single-vault export embeds the whole document with its real id.
- **F. Tests build documents by hand** with `vc.VERSION` and literal `version: 1` in several suites; fixtures are generated in-test, none committed.

## Document and key hierarchy

- A `.gfvault` document: `format`, `version`, `vaultId`, `kdf` (informational — no derivation reads it; a new file records the production parameters even under test parameters), `envelopes[]`, `items` (`{ iv, ct, tag }`).
- Password → scrypt (`manager.kdf`) → wraps the master key, stored in `manager.json` (`mrk.master`); the master key is also wrapped by the recovery material and sealed to the admin public key. Each vault has its own random key, wrapped under the master key and stored **in that vault's file** as its `mrk` envelope. `manager.json` holds no per-vault entry. An access key adds an envelope inside one vault's file, wrapping that vault's key.
- AADs today: items `gfvault/items/${version}`; vault key envelope `gfvault/mrk-env/v${version}`; access envelope `gfvault/env/${version}/hkdf-access/${keyId}`; manager envelopes `gfvault/env/${managerVersion}/${type}/${keyId}` (the manager document's stated version at every unwrap); bundle identity `gfvault-bundle/meta/${entryHandle}`.

## Readers and writers

- Every reader goes through `_readVault`; every `decryptItems` call omits the version.
- Writers: (1) re-encrypt from plaintext, envelopes copied verbatim — `_saveItem`, `_copyItem`, `_importLogins`, `_recordConfirmedOrigin`, item delete, the restore merge; (2) items and envelopes copied verbatim — `_mintAccessKey`, `_revokeAccessKey`; (3) a new file from a key and plaintext, `_writeVaultForKey` — `setup`, the lazy first write of a jar's vault, `_importVault`, `_restoreProfile`; (4) compromise rotation, which rebuilds every file from plaintext inside one transaction.
- Restore and adopt always decrypt and re-encrypt; they never carry ciphertext into a destination file. The two exports carry ciphertext into a bundle.
- No automation path writes a vault file; minting and revoking an access key need the master key.

## The transaction journal

- `beginTransaction(dir, members[{ finalName, content }])`, `commit`, `recover`. Format-agnostic (bytes only); members need not include the manager. Journal first, staged files via `writeFileAtomic`, a durable rename marks the commit, then each staged file is renamed into place. `recover` runs at every store construction: committed → roll forward, uncommitted → roll back; it also sweeps temp orphans. `beginTransaction` refuses while any journal exists.
- Transaction writes bypass `_writeVault` and its re-key guard, so anything using the journal must check the re-key gate itself.
- Every master-key unlock funnels through `_installMrk` (which then calls `onUnlock`); `setup` installs the key directly. `unlockWithRecovery` and `unlockWithAdmin` have no caller outside the store and its tests — human recovery goes through `recoverMasterPassword` or compromise rotation.

## Key-derivation parameter sites

- Production default: N=2^17, r=8, p=2, maxmem 192 MiB (`maxmem` is a stored field, not derived). Tests inject N=2^12, r=8, p=1, 64 MiB — N=2^12 is the validator's minimum.
- A fresh password is in hand at `changeMasterPassword`, `recoverMasterPassword` and `compromiseRotate`; all pass `params: manager.kdf`, and the first two do not write `manager.kdf`. `_adoptManagerCore` writes the bundle's parameters and has no fresh password (the donor's master envelope is kept verbatim).
- The existing ruling, in a comment at compromise rotation: "PRESERVE manager.kdf — the document's existing params, exactly as every existing rotation does; never the bare SCRYPT_PARAMS constant and never a silent swap of an adopted profile's params." Pinned by `vault-compromise-rotate.test.js`, `vault-export-import.test.js`, `vault-bundle-v2.test.js`.

## Version precedents

- Manager versions 1 and 2 are both readable; the manager is **not** upgraded in place — only compromise rotation and adopt/restore of a version-2 bundle write version 2; single-slot rotations keep the version they read.
- Bundle versions 1 and 2; `importVault` accepts version 1 only, `restoreProfile` both.

## Hazards for an in-place upgrade

1. It needs no key derivation, so it can be one synchronous block — nothing can interleave. Placed in `_installMrk`, it runs before the idle timer is armed and before `onUnlock`.
2. Compromise rotation awaits between reading vaults and committing; an upgrade in that window would bypass the re-key guard. It must check the gate, and tolerate an existing journal.
3. A missing file reads as `null`; a corrupt one throws a format error, an unwrappable one an auth error. "Skip and retry" needs a per-file `try`.
4. A read-only directory or full disk fails before the commit and rolls back; a failure after the commit rolls forward at the next start.
5. Cached vault keys are unaffected — the upgrade changes no key.
6. A bundle exported from an upgraded profile cannot be opened by an older build.
7. Behavior specs that hash or enumerate on-disk vault files: `compromise-mode-rotation`, `multi-vault-adopt`, `vault-mcp-surface`. Fixture builders (`tests/behavior/fixtures/vault-login/build-fixtures.mjs`, `vault-card/seed-cards.mjs`) call the store and follow the code.
