# Leg: vault-binding

**Status**: completed
**Flight**: [Vault and Automation Boundary](../flight.md)

## Objective

Prepare the vault code for a second file version without changing a byte it writes: every read and write names the document's own version and the vault it is for.

## Context

- Flight DD6. Mission finding 12. **This leg writes no new format.** It follows `kdf-rewrap` and is followed by `vault-format-v2` (the new version switched on for new files and bundles) and `vault-upgrade` (existing files converted at unlock). The seam is deliberate: everything here is checkable by the existing vault suites staying green, and nothing here is hard to reverse.
- Read `vault-format-recon.md` in the flight directory first (`vc` = `src/main/vault/vault-crypto.js`, `vs` = `src/main/vault/vault-store.js`). The design review verified its claims and added a census.
- **Today the vault side has no version discipline.** `vc.serializeVault` always stamps the constant `VERSION` (1); `vc.parseVault` accepts only it and does not type-check `vaultId`; `encryptItems` / `decryptItems` default their `version` to the constant and **no store call site passes one**; `itemsAad(version)` is `gfvault/items/${version}`. It works only because every document is version 1. The manager side already follows "every wrap passes the document's own stated version".
- The per-vault key envelope uses a **store-local** AAD, `mrkEnvelopeAad(version)` = `gfvault/mrk-env/v${version}`: written with the constant at `_writeVaultForKey`, with `doc.version` at compromise rotation, and read with `doc.version` at six sites.
- **Access-key envelopes cannot be re-wrapped by anyone but the key's holder**, and their AAD embeds a version (`gfvault/env/${version}/hkdf-access/${keyId}`, the constant default at `wrapAccess` and `unwrapAccess`). If that followed the document's version, every existing access key would stop working at upgrade. It is pinned at 1.
- `_readVault(vaultId)` never looks at the file's own `vaultId` field.
- Writers are of three kinds: re-encrypt items while copying `doc.envelopes` verbatim (the item writers, the restore merge); copy items **and** envelopes verbatim (`_mintAccessKey`, `_revokeAccessKey`); build a new file from a key and plaintext (`_writeVaultForKey`). Compromise rotation rebuilds every file in a transaction.
- **Three paths parse a document embedded in a bundle** rather than read from a slot: `_importVault`, `_restoreProfile`, `_previewRestoreBundle`. A single-vault bundle's document carries its real id; a profile bundle's carries an entry handle (the real id is scrubbed on purpose). `restoreProfile` normalises a single-vault bundle into a one-entry profile whose entry handle is a **synthetic hash**, not the id the document carries.
- Budgets: none of the budgeted files is touched.

## Inputs

- Legs 01–09 landed (uncommitted). Leg `vault-lifecycle` added `idleMs`, the suspended getter and `revealItem`'s option to `vs`; leg `clipboard-and-file-modes` changed `atomic-write.js` and the vaults-directory creation; leg `kdf-rewrap` changed the three master re-wrap sites. Keep all of it.
- `vc`, `vs`, `src/main/vault/vault-sheet-errors.js`; the vault suites under `test/unit/` (101 `vault*.test.js` files; fixtures generated in-test, none committed).

## Outputs

- `vc` and `vs` with explicit version and vault-id plumbing, still writing version 1 everywhere.
- What the next leg consumes: `mrkEnvelopeAad` exported from `vc`; a store-local `embeddedVaultId(doc)` helper; a log seam on the store.
- New unit tests for the plumbing and for the version-2 primitives exercised directly.

## Acceptance Criteria

- [ ] **AC1 — The crypto layer knows about versions and ids.** In `vc`: `READABLE_VAULT_VERSIONS` (`{1}` in this leg) and `WRITE_VAULT_VERSION` (1 in this leg) replace the single `VERSION` constant's two meanings, and `VERSION` is **removed** (invariant test: the write version is a member of the readable set). `serializeVault(obj, { version, readable })` — `version` required, refused outside the readable set; `parseVault(input, { readable })` — accepts any readable version, rejects others with today's error; `readable` defaults to the module set in both (the module's options-bag style; this is how tests reach version 2 with no test-only export). `itemsAad(version, vaultId)`: version 1 → exactly today's string; version 2 → `gfvault/items/2/<vaultId>`; any other version throws. **For every version, including 1, a missing, empty or non-string `vaultId` throws** — version 1 ignores the value but must be given it; otherwise a call site that forgets the id works silently now and breaks only when version 2 is switched on. `encryptItems` / `decryptItems` take `version` and `vaultId` with **no defaults**. The access-envelope AAD is pinned: `wrapAccess` / `unwrapAccess` use a named constant `ACCESS_ENVELOPE_AAD_VERSION = 1` and no longer accept a version, with a comment saying why. The six manager-envelope functions that default `opts.version ?? VERSION` (`wrapMaster`, `unwrapMaster`, `wrapRecovery`, `unwrapRecovery`, `sealToAdmin`, `openAdminSeal`) make `version` **required** — the store already passes the manager's stated version everywhere.
- [ ] **AC2 — The key-envelope AAD knows about ids, and lives in `vc`.** `mrkEnvelopeAad` moves from the store into `vc`, exported beside `envelopeAad`: version 1 → exactly today's string; version 2 → `gfvault/mrk-env/v2/<vaultId>`; the same "id required for every version, unknown version throws" rule. The hand-rolled copies of the string in `vault-compromise-rotate.test.js` and `vault-manager-v2.test.js` use the export. Every wrap and unwrap of a vault's key envelope passes the document's own version and the id of the vault being opened.
- [ ] **AC3 — Every store call site passes the document's version and the right vault id.** Census at design review: `parseVault` ×4, `serializeVault` ×2, `encryptItems` ×8, `decryptItems` ×15, `mrkEnvelopeAad` ×8, `wrapAccess` / `unwrapAccess` ×1 each — re-count and paste the list into the flight log. `_writeVault` gains a **required** `parts.version`: a writer that rewrites an existing document passes **that document's version** (the item writers, the restore merge, and access-key mint and revoke, which copy envelopes verbatim); `_writeVaultForKey` and compromise rotation pass `WRITE_VAULT_VERSION`. **The id**: for a slot, the argument of `_readVault` / `_writeVault` — never the file's own `vaultId` field (`readVaultItems` and `openAllWithAdminKey` both go through `_readVault`, so the slot id is at hand). For a document embedded in a bundle, the single store-local helper `embeddedVaultId(doc)`, which in this leg returns the document's own type-checked `vaultId`; it is **not** the restore's normalised entry handle. The next leg changes that one helper and nothing else. A source-scan test asserts that no call to `encryptItems`, `decryptItems`, `serializeVault` or `mrkEnvelopeAad` in `src/` has fewer arguments than required (neuter-verified).
- [ ] **AC4 — Byte-for-byte unchanged output.** With the constants as set in this leg, every file the store writes is identical in shape and AADs to before. The existing vault suites pass with **no assertion edited** beyond this list, each instance of which is recorded in the flight log: call-signature updates in tests that call `vc` directly (about 60 calls in `vault-crypto.test.js`, 31 in `vault-identity-item-type.test.js`, a handful each in the restore, rotation, store, copy, manager and transaction suites — a small test helper is better than editing each); fixture constants that used `vc.VERSION` (`vault-txn.test.js`, `vault-manager-v2.test.js`, `vault-compromise-rotate.test.js`). `serializeVault`'s random-id default when no `vaultId` is supplied is **kept** (a test pins it; no production writer relies on it). Two `parseVault` tests hand-build documents with no `vaultId` and expect a format error for another reason — keep them meaningful by checking `vaultId` last or by adding the field. Anything beyond this list: stop and report. One new test decrypts a store-written file using AAD strings written out by hand and raw `node:crypto` — not through `vc` — so the proof does not share a bug with the code under test.
- [ ] **AC5 — Version-2 primitives are proven in isolation.** Unit tests in `vault-crypto.test.js` — the AAD functions and the item / key-envelope encryption are pure and take explicit arguments, so they need nothing widened; only the serialize / parse round trip passes `{ readable: new Set([1, 2]) }`: items encrypted at version 2 for id A fail to decrypt for id B and at version 1; a key envelope wrapped at version 2 for A fails to unwrap for B; a version-2 document relabelled version 1, and the reverse, fail; an access envelope wrapped today unwraps identically whatever the document's version.
- [ ] **AC6 — A diagnostic, never a lock-out.** `_readVault(vaultId)` compares the parsed document's `vaultId` field with the requested id. For a **version-1** document a mismatch is **logged once per id per process and otherwise ignored** — the file opens exactly as it does today. (History shows every production writer has stamped the slot id since the vault existed and nothing in the store copies or renames a vault file, so no mismatch is expected; but a file an operator moved by hand opens today, and the mission's constraint is that it keeps opening. The field is unauthenticated, so refusing on it would protect nothing.) For a document of any later version a mismatch throws `VaultWrongVaultError`, a subclass of `VaultFormatError`, so `vault-sheet-errors.js`'s `instanceof` tables map it as a format error unchanged — add a mapping test; the message names no id, the log names both. In this leg no later version is readable, so that branch is unit-tested through `parseVault`'s `readable` option. The store has no logger: add an injected `deps.log` (or an event callback), wired in `main.js`, used here and by the upgrade later; unit tests inject a recorder.
- [ ] **AC7 — Docs.** `docs/vault.md`: the explicit version / id discipline in the file-format section; the diagnostic id check and, plainly, that it is not a boundary; that jar ids are reusable, so a re-created jar finds its old file, unchanged. Nothing about version 2 beyond a pointer to the next leg. `CLAUDE.md`: one sentence in the vault section ("no vault-crypto call relies on a default version or id; the access-envelope AAD is pinned at 1").
- [ ] **AC8 — Gates.** `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` pass; the vault suites are also run under Electron's own Node (`ELECTRON_RUN_AS_NODE=1 npx electron --test test/unit/vault*.test.js`). A real boot of a **copy** of the operator's dev profile on the changed build (never the original; no unlock — nobody types a master password): the app starts and the vault reports set-up and locked. Unlock-dependent checks are the HAT's.

## Verification Steps

- AC1–AC5: `vault-crypto.test.js`, the store suites, the source-scan pin; `grep -nE "encryptItems\(|decryptItems\(|serializeVault\(|parseVault\(|mrkEnvelopeAad\(|wrapAccess\(|unwrapAccess\(" src/main` pasted into the flight log.
- AC6: `vault-store.test.js` — a version-1 file with a foreign `vaultId` opens and logs once; the typed error through the `readable` option; the sheet-errors mapping.
- AC7: read by the Flight Director. AC8: command output in the flight log.

## Implementation Guidance

1. `vc` first: constants, signatures, AAD functions, parse / serialize. Remove the defaults so the tests find every caller.
2. `vs`: thread `doc.version` and the right id through every reader and writer; `_writeVault`'s required version; the `embeddedVaultId` helper at the three bundle paths.
3. Run the vault suites; fix call signatures in tests per AC4's list; change nothing else. If an assertion outside the list must change, stop and report why.
4. The id check and the log seam.
5. Docs. Do not commit. Leg `landed`, flight log entry, `[LAND:leg]`.

## Edge Cases

- **Exports** (`_exportVault`, `_exportProfile`) decrypt nothing today; they read a slot and embed the document. Unchanged in this leg.
- **A thrown error from one file aborts a loop** in `openAllWithAdminKey` and in rotation — already true for a corrupt file; state it, do not change it.
- **Windows and case-insensitive filesystems**: ids are lowercase slugs and the comparison is exact.
- **Anything that would change a written byte**: not this leg. Stop and report `[BLOCKED:<reason>]`.

## Files Affected

- `src/main/vault/vault-crypto.js`, `src/main/vault/vault-store.js`, `src/main/main.js` (the log seam's wiring); `src/main/vault/vault-sheet-errors.js` only if the mapping test shows a gap; possibly `src/main/automation/vault-context.js`.
- `test/unit/vault-*.test.js` (signatures per AC4; new cases), a small test helper; `docs/vault.md`, `CLAUDE.md`.

## Citation Audit

From `vault-format-recon.md` and the Developer design review (Sonnet, 2026-11-14), which verified the recon's claims against the code and counted every call site: approve with changes, adopted — the id is required for version 1 too, or omissions hide until the switch; `mrkEnvelopeAad` moves into the crypto module; the bundle id rule is one helper, and it is not the normalised entry handle; the manager-envelope defaults become required; the allowed test edits are listed; the error class is named and subclassed so the sheet mapping holds. **The two reviewers of the vault legs disagreed on the id check** — one found a hard error safe from the code's history, the other that it could lock out a file an operator had moved by hand. The Flight Director ruled for the cautious reading: version-1 mismatches are logged, never refused. **Split**: the key-derivation rule became leg `kdf-rewrap`, flown first. Symbols, not line numbers, are cited: the store is 4,166 lines and earlier legs edited near it.

---

## Post-Completion Checklist

Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.
