# Leg: Manager Format v2 — Optional Admin Provision

**Status**: completed
**Flight**: [Compromise-Mode Rotation](../flight.md)

## Objective

Introduce manager format version 2, in which the admin provision
(`mrk.admin` + `adminPublicKeyB64`) may be deliberately absent, with the
version/AAD homogeneity rule enforced end-to-end (read, unwrap, wrap,
export, import, adopt) — so that later legs can write v2 managers with no
admin slot, and bundles from v2 sources remain importable. No new store
operation in this leg; it makes the format and every existing reader/
writer version-correct and absence-correct.

## Context (verified against current code, 2026-09-01)

- `_readManager` (`vault-store.js:364-414`) requires `version === 1`
  (`:382`), `adminPublicKeyB64` string (`:391-393`), and all three
  `mrk` slots (`:397-408`).
- Manager envelopes bind the document version in AAD (`envelopeAad`,
  `vault-crypto.js:159`); every unwrap site passes the constant
  `MANAGER_VERSION`: `unlock:707`, `unlockWithRecovery:723`,
  `unlockWithAdmin:742`, `changeMasterPassword:797`,
  `rotateRecovery:~843`, `rotateAdminKey:~876`,
  `recoverMasterPassword:911-930`, `mintAccessKey:1650-1653`,
  `openAllWithAdminKey:1765`, and import's bundle unwraps
  (`:1062`, `:1067`). Wrap sites pass it symmetrically (`:640-652`
  comment block states the deliberate binding).
- `exportVault` (`:955-973`) emits all three `mrk` slots +
  `adminPublicKeyB64`; import validation (`:1013-1040`) requires
  format/version, all three bundle slots (`:1022-1033`),
  `adminPublicKeyB64` (`:1034-1036`), and `validateImportedKdf`.
- Fresh adopt (`:1082-1112`) retains the donor master envelope verbatim,
  re-wraps recovery/admin at the constant version, writes
  `version: MANAGER_VERSION`.
- `rotateAdminKey` (`:867-889`) already provisions from scratch and
  writes seal + pubkey together.

## Scope

1. **Version acceptance**: `_readManager` accepts `version` 1 or 2.
   - v1: exactly today's rules (all three slots + pubkey required) —
     behavior unchanged, pinned unchanged.
   - v2: `master` and `recovery` slots required; the admin pair
     (`mrk.admin` + `adminPublicKeyB64`) **present together or absent
     together** — a lone field is malformed-present → `VaultFormatError`;
     when present, validated exactly as v1.
2. **Version threading**: every manager-envelope unwrap and wrap site
   passes the **document's stated version** instead of the constant.
   Single-slot rotations (`changeMasterPassword`, `rotateRecovery`,
   `rotateAdminKey`, `recoverMasterPassword`) preserve the document's
   version — a v1 manager stays v1, a v2 manager stays v2; no operation
   in this leg writes a version different from the one it read. `setup`
   keeps writing v1 (v2 writers arrive in later legs/flights).
3. **Absence readers**: `unlockWithAdmin` and `openAllWithAdminKey` on a
   no-admin manager fail with **`VaultStateError` carrying the exact
   message `'no admin key provisioned'`** (ruled at design review — a
   named, discriminable class/message so the flow-wiring leg's Settings
   state can rely on it; not `VaultFormatError`, not a GCM error);
   `adminPublicKey()` returns **null, coerced** (`?? null` — the raw doc
   field would yield `undefined`; update the `@returns` typedefs to
   `string | null` at `vault-store.js:1735`, `vault-context.js:64`,
   `mcp-server.js:383` so typecheck passes). `vault-context.revalidate`'s
   `grant.adminPub` strict-equality comparison fail-closes against null
   (verified). Note: `vault-context.unlock` swallows store errors into
   `{unlocked: []}` (`vault-context.js:318-321`) — the distinct error is
   observable at the store API only; verify there, not through MCP.
   `rotateAdminKey` on a no-admin v2 manager provisions (writes both
   fields, doc version preserved).
4. **Export**: `exportVault` on a no-admin manager omits `mrk.admin` and
   `adminPublicKeyB64` from the bundle; on a with-admin manager the
   bundle is unchanged. The bundle gains `managerVersion` (the source
   document's version) — a new field, always written going forward.
   **`BUNDLE_FORMAT`/`BUNDLE_VERSION` stay at v1** (the bundle-version
   bump is deliberately reserved for Flight 3's multi-vault format).
   Update the now-stale prose: `exportVault`'s JSDoc (`:944-953`) and
   the inline "requires … all three mrk slots" comment (`:958`).
5. **Import compat**: bundle validation accepts `managerVersion` absent
   (⇒ 1) or 1/2; requires `master` + `recovery` slots; accepts the admin
   pair present-together or absent-together (lone field → import error).
   Both bundle unwrap sites (`:1062`, `:1067`) pass the bundle's
   effective manager version. Fresh adopt writes its manager at the
   bundle's effective version and wraps its minted envelopes at that same
   version (homogeneity with the retained donor master envelope). Adopt
   of a no-admin bundle still mints fresh admin today (adopt behavior
   change is Flight 3) — the minted pair simply makes the adopted manager
   with-admin.
6. **Pinned-test inversions** (rename/invert, never silent edit):
   `test/unit/vault-export-import.test.js:161` ("all three mrk
   envelopes" export pin → becomes "master+recovery always;
   admin-pair-when-provisioned + managerVersion") and the import
   admin-required validation pins. **The adopt admin-rotation pins at
   `:259`/`:344` are verified UNCHANGED in this leg** (adopt still mints
   admin — design-review correction; their inversion belongs to Flight
   3's adopt-admin removal, per DD8).

Out of scope: the journal/transaction layer, the re-key op, any UI, the
`adminProvisioned` vault-state bit (flow-wiring leg), any adopt
admin-minting change (Flight 3).

## Acceptance Criteria

- [x] AC1: A v1 manager round-trips exactly as today — all existing
      vault-store tests pass unmodified except the named inversions.
- [x] AC2: A hand-constructed v2 manager (fixtures wrap envelopes at
      AAD version 2 via vault-crypto directly) unlocks by master and by
      recovery; with the admin pair present it unlocks by admin; with the
      pair absent, `unlockWithAdmin`/`openAllWithAdminKey` fail with the
      distinct no-admin error and `adminPublicKey()` is null.
- [x] AC3: Lone admin field (either one, v2) → `VaultFormatError` at
      read. Absent pair on v1 → `VaultFormatError` (v1 rules unchanged).
      Manager `version: 3` or non-numeric → `VaultFormatError`; bundle
      `managerVersion` outside {absent, 1, 2} → import error.
- [x] AC3b (mixed-version negative — pins DD1's homogeneity rule and the
      flight's divert criterion): a `version: 2` document whose master
      envelope was wrapped at AAD version 1 fails unlock **loudly**
      (`VaultAuthError`), never opens, never repairs (pattern precedent:
      `vault-store.test.js:743`).
- [x] AC4: Each single-slot rotation on a v2 manager preserves
      `version: 2` and its envelopes unwrap afterward (AAD homogeneity);
      same op on v1 preserves v1. `rotateAdminKey` provisions on a
      no-admin v2 manager.
- [x] AC5: Export from a no-admin v2 manager yields a bundle with no
      admin fields and `managerVersion: 2`; that bundle fresh-adopts onto
      an empty profile (donor master password unlocks after restart —
      AAD-correct retained envelope) and existing-profile-imports into a
      set-up profile. One v2 **with-admin** bundle adopt variant pins
      homogeneity with the admin pair riding at version 2. A pre-change
      v1 bundle (no `managerVersion` field) still imports both ways.
- [x] AC6: The named pinned tests are inverted/renamed with the new
      contract; `npm test`, `npm run typecheck`, `npm run lint` all
      clean.

## Verification

Electron-free harness (`test/unit/vault-key-rotation.test.js:21-51`
idioms — temp dirs, `FAST_SCRYPT`, on-disk `readManager` probes). New
suite `test/unit/vault-manager-v2.test.js` covering AC2–AC5's matrix; v2
fixtures constructed via vault-crypto (wrap at version 2), not via any
store writer. AC5's adopt case asserts on-disk `version` equals the
bundle's `managerVersion` and that all envelope AADs are homogeneous
(every slot unwraps with the doc version).

## Citation Audit (2026-09-01)

All citations above verified today by the flight's two Architect design
review passes against `main` (unchanged since 763eeb5 except artifact
commits); line references from the planning interrogation report,
re-confirmed in the second pass (`:1062`/`:1067` import unwraps,
`:797` step-up, `:640-652` binding comment, `vault-export-import.test.js`
pins at `:161`/`:259`/`:344`).
