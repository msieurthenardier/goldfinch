# Leg: bundle-identity-opacity

**Status**: completed
**Flight**: [Multi-Vault Portability](../flight.md)

## Objective

Close the criterion-4 leak found at the HAT: a v2 bundle stores each
vault entry's `sourceId` in PLAINTEXT, and jar ids are slugs of jar
names, so a bundle file exposes jar names (`personal`, `test`, …)
before the bundle secret is ever entered. Replace the plaintext
per-entry identity with an opaque handle and move real jar identity
inside the already-encrypted per-entry metadata, so nothing
human-readable about the profile is legible in the bundle pre-secret —
rethreading restore, labels, and the completion display off the
handle + decrypted name.

## Context

- **Criterion 4** (flight.md): "bundle v2 carrying every vault +
  encrypted jar identity" — and the mission constraint "nothing
  human-readable before the bundle secret is entered." The current
  implementation encrypts `{name,color}` in `jarMeta` but leaves the
  jar id in plaintext as `sourceId`, and the id IS the name-slug
  (`jars.add` → `slug(name)`), so the encryption is undone by the
  plaintext key. Found by FD byte-scan of the operator's real export
  at the HAT (flight log, Decisions → "HAT finding: bundle v2 leaks
  jar identity via plaintext sourceId").
- This is a **v2 bundle FORMAT change**. No v2 bundle exists in the
  wild (this flight introduces v2), so the change is free — no
  migration. v1 (legacy single-vault, shipped M12) is a separate
  posture question (ruling 5).
- Ripples into HAT fix 11's completion display (uses raw `sourceId`
  as a label) and leg 3's label projection (keyed by `sourceId`).

## Inputs

(Verified 2026-09-05 on the post-leg-4 tree, commit 43eabb1.)

- Bundle format doc: `vault-store.js:104-106`; v2 shape
  `{ format, version:2, managerVersion, kdf, mrk, adminPublicKeyB64?,
  vaults: [{ sourceId, jarMeta?, vault }] }`
- jarMeta crypto: `JARMETA_HKDF_INFO` (`:262`), `jarMetaAad(sourceId)`
  = `gfvault-bundle/jarMeta/${sourceId}` (`:271-273`),
  `encryptJarMeta(mrk, sourceId, meta)` (`:285-289`),
  `decryptJarMeta(mrk, sourceId, envelope)` (`:303-316`)
- Export: `_exportProfile` enumerates
  `sourceIds = [GLOBAL_ID, ...jars.map(j=>j.id)]` (`:1842`), builds
  each entry with plaintext `sourceId` + `jarMeta?` (jars only, not
  global)
- Normalize/validate: `normalizeRestoreBundle` (`:527+`) — v1 → one
  entry `{ sourceId: bundle.sourceVaultId, vault }` (`:556`); v2
  validates `entry.sourceId` non-empty string + uniqueness
  (`:565-571`), passes `{ sourceId, jarMeta, vault }` (`:582-583`)
- Restore: `_restoreProfile` mapping is keyed by `sourceId`
  (`mapping[sourceId]`, the directive per entry); results carry
  `{ sourceId, outcome, destination?, mergeReport? }`
- Labels (leg 3): `previewRestoreBundle` decrypts jarMeta per entry
  and returns per-entry labels keyed by sourceId (main.js labels
  projection)
- Completion (HAT fix 11): `restoreOutcomeLines(results)` in
  `vault-page-model.js` renders `"{sourceId} → {destination}: …"` —
  uses `sourceId` as the display label
- Page: the mapping modal keys rows off the label list (sourceId +
  jarMeta); commit sends `mapping` keyed by sourceId
- GLOBAL_ID sentinel = `'global'` (a fixed, non-user-specific marker)

## Leg-Level Design Rulings

1. **Opaque per-entry handle — named `entryHandle` (cycle-1: avoid
   the collision).** Each v2 vault entry is keyed by an `entryHandle`:
   a random token minted at export (`crypto.randomBytes`, hex — leg
   picks width, ≥16 bytes; precedent `vault-crypto.js:686`
   `randomBytes(16).toString('hex')` for vaultId), carrying NO
   identity. **It is NOT named `handle`** — `PendingImportRecord.handle`
   (`pending-imports.js:37-51`) is the per-IMPORT-SESSION token
   (minted at file-pick, `mapping[handle]` at commit,
   `vaultImportCommit(chromeId, handle, …)`), and the new per-entry
   token lives one level down in `label.entryHandle` / the mapping's
   per-entry key in the SAME functions — same-name fields a line
   apart is the hazard cycle-1 flagged. `entryHandle` replaces
   `sourceId` as the entry key downstream (mapping, results, labels).
   Unique within a bundle (mint-and-check); the AAD binding (ruling
   3). Design review confirmed no `_resolveTarget` / `listJars()`
   site ever consumes the bundle's `sourceId` — every destination
   resolve is on `directive.destination` (operator-chosen local id),
   so the entryHandle is purely a bundle-internal key with no
   destination meaning. Entry ORDER not relied upon (a reader sees
   only entry COUNT — inherent array length, accepted; no padding).
2. **Real identity moves inside the encrypted per-entry `identity`,
   for EVERY entry including global.** `jarMeta` → `identity` (NOT
   `meta` — `vault-store.js` already uses "meta" for item-level
   whitelisting, `listItemsMeta`; cycle-1 low), now PRESENT on every
   entry and encrypted, carrying `{ kind: 'global' }` for the global
   vault and `{ kind: 'jar', name, color }` for jar vaults. The
   source jar id is NOT carried (name-slug, destination-local; leg 2's
   "portable subset is name+color"). Nothing plaintext in the entry
   reveals kind or identity — a reader cannot even tell which entry is
   global without the secret. Design review confirmed the restore
   path never needs the global-vs-jar distinction PRE-decrypt (routing
   is entirely `directive.destination`-driven; the only pre-opacity
   global/jar branch, `_previewRestoreBundle:2449`, is already
   post-secret), so moving `kind` into ciphertext is safe.
3. **AAD rebinds to the handle.** `jarMetaAad` (rename to
   `entryMetaAad` or similar) binds the opaque handle instead of the
   sourceId: `gfvault-bundle/meta/${handle}`. Since the handle is the
   plaintext entry key, this still prevents splicing one entry's meta
   onto another, exactly as the sourceId binding did — but the AAD now
   leaks nothing (a random token, not a name).
4. **Restore/labels/completion rekey off the entryHandle + decrypted
   name.** `_restoreProfile`'s mapping is keyed by entryHandle;
   results carry `{ entryHandle, outcome, destination?, mergeReport? }`
   (drop `sourceId`). `previewRestoreBundle` returns per-entry labels
   keyed by entryHandle, each with the decrypted
   `{ kind, name?, color?, count }`. The completion display
   (`restoreOutcomeLines`, `vault-page-model.js:279-317`) takes the
   decrypted NAME — the page joins result-entryHandle → label-name at
   the `openCompletionModal(res)` call (vault.js:1179, inside
   `openMappingModal`'s onSubmit, so `record.labels` is in closure —
   pass it: `openCompletionModal(res, record.labels)`; cycle-1 4b
   confirmed clean). Global rows display "Global"; jar rows their
   decrypted name. **No raw entryHandle is ever shown to the
   operator.** Rewrite the now-stale `vault-page-model.js:255-267` doc
   comment (it currently defends showing raw sourceId as
   post-authorization — the field no longer carries identity at all)
   and the `vault.js:1207-1211` block. Sites to rekey (cycle-1 full
   list): `_validateRestoreMapping` (2113-2161), `parsedVaults`
   (`_restoreProfile` 2220-2227, `_previewRestoreBundle` 2417-2424),
   the restore loop (2246-2333), the label build (2441-2458), the
   export entry build (1837-1870), `normalizeRestoreBundle` v2 branch
   (559-587), `pending-imports.js` `PendingImportLabel` typedef
   (37-41 — the `PendingImportLabel.sourceId` field; leave
   `.handle` at :46 alone), `vault.js` `openMappingModal`
   (`label.sourceId` sites through **the submit-time mapping build at
   1168-1174** — cycle-2: the single most consequential site, the
   `mapping` object sent over IPC that MUST key on entryHandle to
   match the store; note `record.handle` the session token sits 3
   lines away at :1174) + `openCompletionModal` (1179, 1214-1230),
   `restoreOutcomeLines` (279-317). **main.js is a pure passthrough**
   of the store's `{entryHandle,identity}` labels + `{entryHandle,…}`
   results (cycle-1 low: it transforms nothing today and won't after —
   only JSDoc wording changes there, no rekey logic).
4c. **Export-completion `carried` must show NAMES, not entryHandles
   (cycle-1 HIGH).** `register-vault-ipc.js:365` returns
   `carried: bundle.vaults.map(v => v.sourceId)`, and `vault.js:634-654`
   (HAT fix 2) resolves those against the LOCAL jar list — which only
   works because sourceId==local id today; opaque entryHandles break
   it to raw-token display. Ruling: `exportProfile()` returns a
   parallel, MAIN-PROCESS-ONLY (never serialized into the bundle
   file) list of carried NAMES built from the same local
   `jars.list()` + GLOBAL enumeration the export loop already walks
   (`_exportProfile` knows real names pre-encryption); the IPC handler
   returns THAT as `carried`, and `vault.js:634-654` consumes names
   directly (no id→name lookup). Add `register-vault-ipc.js` and that
   vault.js branch to scope; pin the notice names post-opacity (no
   test covers `carried` today). **Lazy-omission pairing (cycle-2
   medium): push the carried NAME in the SAME loop iteration as the
   entry — AFTER the lazy `if (doc === null) continue`
   (`vault-store.js:1848`) — so the names list length/order exactly
   matches `bundle.vaults` and never names an uncarried jar. Do NOT
   build names independently from the full `jars.list()`.**
5. **v1 legacy posture — synthetic identity is PLAINTEXT (cycle-1
   HIGH correction).** v1 bundles are single-vault, legacy (M12),
   carrying one plaintext `sourceVaultId`. v1 stays byte-compatible on
   IMPORT (keep reading existing v1 bundles); export writes ONLY v2
   (opaque). `normalizeRestoreBundle` synthesizes the internal entry
   with a fresh `entryHandle` and — critically — a **plaintext,
   already-resolved `identity`** object, NOT an encrypted envelope:
   normalize runs BEFORE the mrk exists (`_restoreProfile:2206`,
   `_previewRestoreBundle:2409`, both ahead of unwrap), so it cannot
   produce ciphertext. The v1 synthetic `identity` is
   `{ kind: 'jar', name: sourceVaultId }` (or `{ kind:'global' }` if
   sourceVaultId===GLOBAL_ID; v1 carried no color). The uniform
   decrypt step must DISTINGUISH the plaintext v1 synthetic from a
   real v2 encrypted envelope — by an explicit internal tag normalize
   attaches (`identityPlaintext: true`), NOT shape-sniffing — so
   `decryptIdentity` is skipped for it and it's used as-is.
   **SECURITY (cycle-2 2b — tag-smuggling foreclosed): normalize
   writes the tag ONLY on the v1 path and NEVER reads it from the
   incoming (untrusted) bundle; the v2 entry build MUST keep the
   existing explicit named-field extraction (`{ entryHandle, identity,
   vault }` from `e`, the `:581-585` pattern), NEVER `{...e}`, so an
   attacker cannot set `identityPlaintext:true` on a v2 JSON entry to
   bypass decrypt/AAD and inject an unauthenticated plaintext
   identity. Also loud-validate `entry.identity !== undefined` on v2
   (mirror the sourceId non-empty check). The normalized bundle is
   consumed in-memory only (never re-serialized/written — verified),
   so the tag never reaches disk.** A v1 bundle's plaintext
   sourceVaultId is an unchangeable property of the old format; the
   leak-closure is a v2 guarantee, v1 documented as legacy.
   `docs/vault.md` also states the single-vault `exportVault` path
   (jars-page delete-first-export, BUNDLE_VERSION 1, still plaintext
   sourceVaultId — out of this leg's scope) is less private than
   whole-profile v2 export (cycle-1 low).
6. **Byte-scan pin strengthened.** Leg 2's plaintext-absence test
   passed despite this leak because its fixtures' display names
   differed from their slugs. The leg adds a byte-scan assertion using
   a fixture whose jar NAME equals its would-be slug (the real-world
   case), asserting the name string does NOT appear in the serialized
   v2 bundle — the exact assertion that would have caught this.

## Outputs

- `vault-store.js`: entryHandle minting + `identity`-for-every-entry
  (incl. global) encrypted export; AAD rebind to entryHandle;
  `encrypt/decryptIdentity` signatures take entryHandle; v2
  normalize/validate on entryHandle + v1 plaintext-synthetic identity
  (tagged); `exportProfile` returns a main-only carried-NAMES list
  (ruling 4c); `_restoreProfile` + `previewRestore` + results rekeyed
  to entryHandle + decrypted identity
- `main.js`: pure passthrough — JSDoc wording only (cycle-1 low; no
  rekey logic lives here)
- `register-vault-ipc.js`: `internal-vault-export-profile` returns
  `carried` as NAMES from the local enumeration (ruling 4c)
- `pending-imports.js`: `PendingImportLabel` typedef
  (`sourceId`→`entryHandle` + `identity`)
- `vault-page-model.js`: `restoreOutcomeLines` takes decrypted names
  (signature change — the page passes the label join); stale doc
  comment (255-267) rewritten
- `vault.js`: mapping modal + commit keyed off entryHandle;
  export-completion `carried` branch (634-654) consumes names
  directly (net ≤ +8 lines — budget 2820, currently 2812; cycle-1:
  margin THIN — pre-identify the `openCompletionModal` name-join map
  as the extraction candidate if the rename + join blow the budget)
- Behavior spec `tests/behavior/multi-vault-adopt.md`: any label/id
  references updated (final finalize is leg 6)
- `docs/vault.md`: bundle v2 format = opaque handles + fully
  encrypted identity
- Tests: format round-trip, opacity byte-scan (ruling 6), AAD-splice
  rejection on handle, v1 legacy read, completion display by name

## Acceptance Criteria

- [x] A v2 bundle exported from a real multi-jar profile contains NO
      jar name, color, or identifying slug in plaintext — byte-scan
      with a name==slug fixture (ruling 6) passes; every entry's
      identity is inside the encrypted `meta`, including which entry
      is the global vault.
- [x] Each entry is keyed by an opaque random handle; handles are
      unique per bundle; the entry carries no plaintext identity.
- [x] `meta` is present + encrypted on EVERY entry (global included),
      AAD-bound to the handle; decrypt yields `{kind:'global'}` or
      `{kind:'jar',name,color}`; a meta spliced to a different
      entry's handle fails AAD (loud).
- [x] Round-trip: export → restore reproduces the profile (global +
      jars land correctly under operator-directed destinations); the
      mapping/labels/completion all function keyed off handles with
      operator-visible NAMES (never handles) in the UI.
- [x] The completion display shows decrypted names ("Global",
      "personal", …), not handles or raw ids.
- [x] v1 bundles still import (legacy read preserved) — the v1
      synthetic entry carries a PLAINTEXT tagged identity that the
      decrypt step skips; export writes only v2. v1 posture (and the
      single-vault exportVault plaintext caveat) documented.
- [x] The export-completion notice ("Exported N vaults: …") shows
      real jar NAMES, not entryHandles, post-opacity — pinned (ruling
      4c; no coverage of `carried` exists today).
- [x] No secret/key material added to any IPC/broadcast/page path
      (labels remain name/color/count only, now sourced from the
      handle-keyed decrypt).
- [x] Full suite + lint + format + typecheck green; vault.js ≤ 2820.

## Verification Steps

- New opacity byte-scan test (name==slug fixture) — the criterion.
- Round-trip + AAD-splice + v1-legacy unit tests.
- `grep` the serialized test bundle for the fixture jar name → absent.
- Full `npm test` / lint / format:check / typecheck.
- Re-scan a fresh real export at leg 6's witnessed run to confirm on
  a real bundle.

## Edge Cases

- **Global-only profile**: one entry, `meta {kind:'global'}`, opaque
  handle — a reader can't tell it's global-only vs jar-bearing.
- **Two jars with the same name** (different colors/ids locally):
  distinct handles, distinct encrypted meta; restore maps each by
  handle — no collision in the bundle (the destination `-N`
  reconciliation is unchanged, leg 2).
- **A tampered/absent handle** on a v2 entry: loud `VaultFormatError`
  at normalize (mirrors the current sourceId validation).
- **v1 sourceVaultId = a jar name**: legacy plaintext, unavoidable in
  the v1 format; documented, not "fixed" in v1.

## Files Affected

- `src/main/vault/vault-store.js`, `src/main/main.js`,
  `src/shared/vault-page-model.js`, `src/renderer/pages/vault.js`
- `docs/vault.md`, `tests/behavior/multi-vault-adopt.md`
- `test/unit/`: `vault-bundle-v2.test.js` (+opacity scan),
  `vault-restore-*` suites (handle rekey), `vault-page-model.test.js`
  (restoreOutcomeLines by name), any label/handler suite keyed on
  sourceId

---

## Citation Audit

All `vault-store.js` citations (jarMeta crypto `:262-316`, export
`:1842`, normalize `:527-583`) read directly from the post-leg-4 tree
(43eabb1). Downstream (main.js labels/completion, vault.js mapping,
vault-page-model restoreOutcomeLines) carry from legs 3-4 as landed;
the design reviewer re-verifies the exact rekey surface.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`:**

- [x] All acceptance criteria verified
- [x] Tests passing (suite + lint + format + typecheck)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit — grouped review/commit as appropriate
