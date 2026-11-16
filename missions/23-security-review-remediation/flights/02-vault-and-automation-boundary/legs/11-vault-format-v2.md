# Leg: vault-format-v2

**Status**: completed
**Flight**: [Vault and Automation Boundary](../flight.md)

## Objective

Switch on vault file version 2 for everything the app **writes anew** — new vaults, bundles, restores, adopts, rotation — so those files are bound to their vault, while every version-1 file and bundle keeps opening and no existing file is rewritten yet.

## Context

- Flight DD6. Leg `vault-binding` made every vault-crypto call name the document's version and the vault's id while still writing version 1. This leg flips the write version. **It does not convert existing files** — that is the next leg, `vault-upgrade`, which is the only part that rewrites an operator's existing data and so lands last, on its own.
- Why this boundary (design review): the moment any file is version 2, a profile export that scrubs the embedded id while copying ciphertext verbatim would produce a bundle nobody can open — a silent data-loss path. So the write-version flip and **every bundle path** must land together. The upgrade has no dependents and can follow. The state this leg leaves — some files version 1, new ones version 2 — is safe, and is also exactly what a partially skipped upgrade produces later, so it is the right thing to test first.
- Mission constraint: **no vault data loss.** Read `vault-format-recon.md` first.
- **The version-2 rules.**
  - Items AAD `gfvault/items/2/<id>`; vault key envelope AAD `gfvault/mrk-env/v2/<id>`. Access envelopes keep their pinned version-1 AAD and are carried verbatim where a file is rewritten.
  - **For a slot**, `<id>` is the id the store was asked for — never the file's own field.
  - **For a document embedded in a bundle**, `<id>` is what the bundle states for that entry, and the rule depends on the bundle's own shape, not on a guess:
    - a **single-vault bundle** (bundle version 1, written by `exportVault`): the bundle's `sourceVaultId`, which must equal the embedded document's `vaultId` for a version-2 document — a mismatch is a format error raised **before** any secret is tried (a decrypt failure would read as a wrong password);
    - a **profile bundle** (bundle version 2): the entry's handle — random, unique per bundle, and already authenticated by the bundle's identity AAD (`gfvault-bundle/meta/<handle>`).
    - `restoreProfile` normalises a single-vault bundle into a one-entry profile with a **synthetic** handle; that handle is not the binding id. The normaliser therefore carries an explicit `bindId` per entry (`sourceVaultId` for a single-vault bundle, the handle for a profile bundle), and restore and preview use it — only for version-2 documents; version-1 documents ignore it.
  - A writer that rewrites an existing document keeps that document's version. New files (`_writeVaultForKey`) and compromise rotation write version 2.
- **Profile export** today embeds `{ ...doc, vaultId: entryHandle }` with the ciphertext copied verbatim. Under this leg it **rebuilds every entry as version 2 bound to its handle**, whatever version the source file is: decrypt at the file's own version and slot id, re-encrypt the items and re-wrap the key envelope under the handle. No refusal path for a mixed profile. **Access envelopes are dropped from profile bundles**: restore never reads them (it writes only the master-key envelope), and carrying them is exposure with no use.
- **Single-vault export** embeds the document verbatim with its real id, at whatever version the file is. Unchanged in shape.
- **No bundle version change.** An older build given a bundle holding a version-2 document fails loudly at parse ("unsupported version") and loses nothing. This build keeps reading version-1 documents in old bundles forever — `READABLE_VAULT_VERSIONS = {1, 2}` is permanent.
- **Readers and the swap.** After this leg a version-2 file in the wrong slot is refused: the human path and the admin-key path at the key envelope (its AAD names the slot); an access key at the items (its envelope AAD has no id, so jar A's access key opens A's key from A's file sitting in B's slot — and the items AAD for B then stops the read).
- Budgets: none of the budgeted files is touched.

## Inputs

- Leg `vault-binding` landed: `READABLE_VAULT_VERSIONS = {1}`, `WRITE_VAULT_VERSION = 1`, explicit arguments everywhere, `mrkEnvelopeAad` exported, `embeddedVaultId(doc)`, the store's log seam, the version-2 primitives unit-tested.
- The last released tree, commit `376e541` (v0.19.14) — the source of real previous-version bytes (AC1).
- Behavior specs that read vault files from disk (`compromise-mode-rotation`, `multi-vault-adopt`, `vault-mcp-surface`); the fixture builders under `tests/behavior/fixtures/vault-login/` and `vault-card/`.

## Acceptance Criteria

**Previous-version material first**

- [ ] **AC1 — Version-1 fixtures that do not share a bug with the reader.** Before changing any constant:
  - (a) an **independent oracle** in a test helper that builds version-1 vault documents with raw `node:crypto` only — the literal AAD strings `gfvault/items/1`, `gfvault/mrk-env/v1`, `gfvault/env/1/hkdf-access/<keyId>` and the document shape written out by hand, never calling `vc` to encrypt. Every "version 1 still opens" test in this leg and the next uses it.
  - (b) a **generator script** in the scratchpad that checks out `376e541` into a scratch directory (`git archive`), and with **that** code builds a small profile (global vault and two jar vaults; logins, a card, an identity, an item with a one-time-code secret, one with `confirmedOrigins`; an access key on one jar; an admin key; a single-vault bundle and a profile bundle; a manager at version 1 and one after a compromise rotation) using fast parameters and a throwaway password the script sets. It stays in the scratchpad; its output is used live in AC13 and by the Flight Director for the HAT.
  - (c) **whether one small document produced by (b) is embedded in a test's source as a hex constant** (with its keys) — a known-answer vector proving that bytes written by the released version open — was the operator's to rule on, because this project does not commit generated baselines. **Operator ruling 2026-11-14: allowed — one vector.** Embed exactly one small version-1 document from (b) (a vault holding a couple of items, its `mrk` envelope and one access envelope) with its throwaway master key, vault key and access secret as hex, in one test file, with a comment saying where it came from (commit, date, the generator), that it is hand-pinned and never regenerated, and that it is the only committed fixture in the vault suites. A test opens it with this tree's reader; leg `vault-upgrade` upgrades it.

**The switch**

- [ ] **AC2 — Version 2 is written for new files.** `READABLE_VAULT_VERSIONS = {1, 2}`, `WRITE_VAULT_VERSION = 2`. A new vault (setup; a jar's lazy first write; import; restore; adopt) is version 2 and bound to its slot id. Rewriters keep the document's version — unit: a save, a delete, an import of logins and a `confirmedOrigins` record into a version-1 file (built by the oracle) each leave it version 1 and readable; minting and revoking an access key on a version-1 and on a version-2 file leave each readable by master key and by its access keys.
- [ ] **AC3 — A swapped version-2 file is refused, at every reader, for the right reason.** Two version-2 vaults A and B; A's file copied to B's path. Through the store's public API: (i) the human list / reveal path for B fails; (ii) `openAllWithAdminKey` fails for B; (iii) **A's access key** opened against B's slot yields A's key but `readVaultItems('B', …)` fails at the items; (iv) with the file's plaintext `vaultId` edited to `B`, all three still fail (authentication failure — the AAD binds); with the field left as `A`, the failure is the typed `VaultWrongVaultError`. Never A's items, never an empty vault, never a quarantine. Putting B's own file back makes B open.
- [ ] **AC4 — A version cannot be relabelled.** A version-2 file with `version` edited to 1, and an oracle version-1 file edited to 2, both fail to open.
- [ ] **AC5 — A mixed profile works.** One profile holding an oracle version-1 jar vault beside version-2 vaults: every operation — list, reveal, save, delete, copy in both directions (`confirmedOrigins` stripped as today), access-key mint / revoke / open, admin-key open, automation's read — works on each file at its own version. This is the state a skipped upgrade leaves, so it is tested here, deliberately.

**Bundles**

- [ ] **AC6 — Single-vault export and import.** Exporting a version-2 vault embeds its document verbatim; `importVault` requires `bundle.sourceVaultId === vault.vaultId` for a version-2 document (format error before the secret is tried, tested), decrypts with that id, and writes a version-2 file bound to the **destination** id, which may differ (tested with a different destination). A version-1 single-vault bundle — oracle-built, and one made by AC1(b) — imports and produces version 2. An edited embedded id fails clearly, not as "wrong password".
- [ ] **AC7 — Profile export.** Every entry is rebuilt as version 2 bound to its handle; the embedded document states the handle; the bundle contains **no real jar id string** (pin, as today) and **no access envelope** (pin). Export of a mixed profile (AC5's) succeeds and every entry is version 2.
- [ ] **AC8 — Restore, preview and adopt, driven end to end.** `normalizeRestoreBundle` supplies `bindId`. Real round trips through the public API, each ending in a **fresh store instance on the destination directory**, unlocked, with every item deep-equal to the source: profile export → `restoreProfile` (replace; merge; and the preview's counts and labels) on the same profile and on a fresh one (adopt); a **single-vault bundle holding a version-2 document** through `restoreProfile` (the synthetic-handle case) and through `importVault`; version-1 bundles of both kinds (oracle-built and from AC1(b)). Every file written is version 2 bound to its destination id.
- [ ] **AC9 — Compromise rotation writes version 2.** On an all-version-1 profile, a mixed one and an all-version-2 one: after rotation every vault is version 2 under a new key bound to its slot id, items intact, access envelopes gone as rotation already removes them (confirm what it does today and keep it), the manager at its rotated version; the rotation's interruption matrix still passes.

**Specs, docs, live, gates**

- [ ] **AC10 — Behavior specs that read vault files.** Walk `compromise-mode-rotation` (its steps hash and byte-compare every vault file and assert a version), `multi-vault-adopt` and `vault-mcp-surface` (reads the global file's envelope set) against this leg's behaviour; re-author steps whose expectations change (rotation now changes the version; adopt writes version 2), and list them with step numbers in the flight log. Note in each spec that the fixture builders call the store and so now produce version-2 profiles — they do not exercise version 1; AC1(b)'s generator does.
- [ ] **AC11 — Docs.** `docs/vault.md`: the file format (version 2, both AADs, the pinned access-envelope AAD, "the id is the slot's, not the file's field"); what a swapped file does at each reader; the bundle id rules and that profile bundles no longer carry access envelopes; that old bundles and version-1 files keep opening and that an older build cannot open a version-2 file or a bundle containing one. State that existing files are converted by the next change, not this one. `CLAUDE.md`: the vault section's format facts.
- [ ] **AC12 — Gates.** `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` pass; the vault suites also under Electron's own Node. Report the vault suites' wall time before and after.
- [ ] **AC13 — Live, nobody typing a master password.** (i) A real boot of a **copy** of the operator's dev profile: starts, vault set-up and locked, and **no file in the copy's vaults directory changes** (hash every file, and `manager.json`, before launch and after quit). (ii) With AC1(b)'s generated previous-version profile and its throwaway password, a Node script using the store module from **this** tree (not the app, not the operator's vault): unlock, list every vault, and confirm every item deep-equals what the generator wrote and that **no version-1 file was rewritten** by unlock in this leg.

## Verification Steps

- AC1: the oracle helper with a test that the store's own reader opens its output; the generator's output listing in the flight log.
- AC2–AC5: `vault-store.test.js`, `vault-crypto.test.js`, `vault-copy-item.test.js`, `vault-context.test.js`, `vault-admin-key-provision.test.js`.
- AC6–AC8: `vault-export-import.test.js`, `vault-bundle-v2.test.js`, the `vault-restore-*` suites. AC9: `vault-compromise-rotate.test.js`.
- AC10, AC11: read by the Flight Director. AC13: hashes and the script's output in the flight log.

## Implementation Guidance

1. AC1 first, before any constant changes.
2. Flip the constants; run the suites; the failures are the map. Change an existing assertion only where it pins "version 1 is what a new file is" or the old bundle shape, and list every change.
3. Readers (the swap tests), then the mixed-profile tests.
4. Bundles: `embeddedVaultId` and the normaliser's `bindId`; single-vault import; profile export's rebuild; restore, preview, adopt.
5. Rotation. Spec walk. Docs. Live checks.
6. Do not commit. Leg `landed`, flight log entry, `[LAND:leg]`.

## Edge Cases

- **A jar with no vault file yet**: its first write is version 2.
- **The global vault**: same rules; its id is the global id.
- **A profile bundle entry whose source file is unreadable**: today's behaviour for an unreadable vault at export stands (find it, state it, keep it).
- **A source scan** pins that no code path uses a document's own `vaultId` field to choose a decrypt id for a **slot** read.
- **An automation session holding a vault key across a rewrite of that file**: keys do not change; `readVaultItems` re-reads the file each call at its own version. Test a read after a rotation-free rewrite.
- **If any version-1 fixture — oracle or generated — cannot be opened**: stop. `[BLOCKED:vault-v1-read-<reason>]` with the fixture and the error; this is the flight's Divert condition.
- **If restore or adopt cannot be made to work without a bundle format change**: stop, `[BLOCKED:bundle-format]`.

## Files Affected

- `src/main/vault/vault-crypto.js` (constants), `src/main/vault/vault-store.js`; possibly `src/main/automation/vault-context.js`.
- `test/helpers/` version-1 oracle; the vault suites named above.
- `tests/behavior/compromise-mode-rotation.md`, `multi-vault-adopt.md`, `vault-mcp-surface.md` where steps change.
- `docs/vault.md`, `CLAUDE.md`.

## Citation Audit

From `vault-format-recon.md` and the Developer design review of the original combined leg (Sonnet, 2026-11-14): approve with changes, adopted — the write-version flip and every bundle path must land together (an export of a version-2 file under the old code would be silently unopenable), while the upgrade has no dependents: hence this split; `normalizeRestoreBundle`'s synthetic handle for single-vault bundles would have made restore decrypt with the wrong id — fixed by an explicit `bindId`; `importVault` never read `sourceVaultId` — now required to match; profile export always rebuilds at version 2 and drops access envelopes; fixtures built through the crypto layer would share its bugs — an independent oracle and bytes from the released commit instead; the access-key swap case that actually exercises the binding; no bundle version change needed. Symbols verified by that review: `_exportVault`, `_exportProfile`, `_importVault`, `_restoreProfile`, `_previewRestoreBundle`, `normalizeRestoreBundle` / `v1EntryHandle`, `entryIdentityAad`, `_writeVaultForKey`, compromise rotation's rebuild.

---

## Post-Completion Checklist

Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.
