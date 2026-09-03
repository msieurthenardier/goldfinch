# Flight Log: Multi-Vault Portability

**Flight**: [Multi-Vault Portability](flight.md)

## Summary

*(execution not yet started — planning phase)*

---

## Reconnaissance Report

*(Phase 1b, 2026-09-02 — every item the source artifacts treat as
outstanding Flight-3 work, walked against `main` at 5eaec48. Sources:
Flight 2 debrief recommendations/technical items, Flight 1 debrief
recommendation 2, mission Open Questions. Classifications:
`confirmed-live` / `already-satisfied` / `partially-satisfied` /
`needs-human-recheck` / `drifted`.)*

| # | Source item | Classification | Evidence | Recommendation |
|---|-------------|----------------|----------|----------------|
| 1 | v2-bundle AAD unimportability / bundle `managerVersion` field (F2 flight-review finding, carried in summary notes) | **already-satisfied** | Shipped in F2 leg 1 (DD7): export writes `managerVersion` (`vault-store.js:1486`), import validates it (`:1568-1573`) and threads it into both unwraps (`:1625`, `:1630`); comment at `:1562-1566` names the exact fixed failure | Retire — confirm-and-cite only. Note: no v2 `.gfvault` exists (`vault-crypto.js:44` — `VERSION = 1`); AAD version threading is manager-space only |
| 2 | Busy-error collapse on sibling delegates (F2 debrief technical item, annotated on squawk 0058) | **already-satisfied** | Squawk 0058 (PR #200) shipped reason-forwarding on five sheet channels + renderer copy mappers; delegates now map `'busy'` (`main.js:1865-1866`, `:1883-1884`, `:1900-1901`, `:1926-1928`); pinned by `test/unit/vault-sheet-error-copy.test.js` | Retire |
| 3 | Extract main.js vault glue before Flight 3 builds there (F2 debrief rec 1) | **partially-satisfied** | Stores ARE extracted (`pending-imports.js`, `autolock-suppression.js`, `pending-compromise-reveals.js`). Still inline: the error-class→reason ladder at nine main.js delegate sites (`main.js:1119`, `:1757`, `:1798`, `:1834`, `:1865`, `:1883`, `:1900`, `:1926`) with transcribed copies in ≥3 suites, and the `resurfaceCompromiseReveal` composition (`main.js:934`, wired `:2333`) | Remainder is live work; Flight 3 adds a tenth delegate site — schedule the extraction ahead of the restore delegates |
| 4 | Consume `vault-txn` for the restore write (F2 debrief rec 2) | **confirmed-live** | `vault-txn.js:374-383` exports confirmed; sole caller today is compromise rotation (`vault-store.js:1373-1400`, committed-flag idiom) | Design decision needed on granularity: mission rules restore per-vault atomicity with rerun recovery, NOT full transactionality — vault-txn use is per-vault or per-phase, not one profile-wide txn |
| 5 | Per-vault result shape designed at flight level (F2 rec 2 + mission OQ) | **confirmed-live** | `importVault` returns a single `{ imported, fresh, vaultId, ... }` (`vault-store.js:1681-1687`) — no multi-vault shape exists | Flight-level DD |
| 6 | Held-bundle lifetime matrix (F2 rec 2 + mission OQ decrypt-before-mapping) | **confirmed-live** | `_pendingVaultImports` (`main.js:823`, `pending-imports.js`) has NO window-close, lock, timeout, or quit teardown — `releaseVaultHoldsForWindow` (`main.js:1488`) drops adopt keys + suppression holds but not held bundles; held bundle never touches autolock suppression | Flight-level DD; fix the existing window-close leak in the same reshape |
| 7 | Re-derive the one-window reveal argument for the new adopt shape (F2 rec 2) | **confirmed-live** | Adopt still runs F4's two-sheet stash-then-chain: `register-overlay-ipc.js:408-411` (stash + recovery sheet), `:180-185` (admin sheet chained off the ack), `_pendingAdoptAdminKeys` (`main.js:850-868`) | Owned by the DD8 removal leg |
| 8 | DD8: adopt stops minting admin; stash-then-chain removed; 0051 adopt callers deleted (F2 DD8, mission criterion 6) | **confirmed-live** | Code names this flight: `vault-store.js:1664-1666` — "The adopt admin-minting removal is Flight 3 (DD8), not here". Six assertion sites in `vault-export-import.test.js` need rename/invert: `:247-248`, `:268-269`, `:284-289`, `:346-347`, `:353-354`, `:369-373` | Core leg work; inversions per the rename-not-silent-edit rule |
| 9 | Bundle v2 multi-vault | **confirmed-live** | Exactly one gate rejects it: `vault-store.js:1559-1561` (`bundle.version !== BUNDLE_VERSION`); bundle shape single-vault by construction (`:89-95`) | Core leg work |
| 10 | O2 IPC reshape: commit-time destination binding + decrypted-labels leg (F1 rec 2) | **confirmed-live** | Destination bound at PICK time today (`main.js:1049-1052` holds `destinationTarget`); fresh mode is already destination-less — unification deletes modal complexity, as F1 predicted | Core leg work |
| 11 | Unified import/restore = one button/workflow (mission criterion 5, operator-emphatic O2) | **partially-satisfied** (structurally) | Import and restore already share ONE modal, split by `opts.fresh` (`vault.js:644-661`); one entry button per page state (`vault.js:1185`, `:824-829`) | The remaining work is the mapping step + fresh/existing convergence, not a button merge — smaller than the criterion reads |
| 12 | Restore/import joins gated-op list + race pins (F2 rec 2) | **confirmed-live** | Eight gated ops enumerated (`vault-store.js` §; `_enterGatedOp` sites confirmed); `vault-rekey-gate.test.js:6/:81/:84` hard-codes "eight" and enumerates by name | A ninth op updates the suite's wording + enumeration |
| 13 | Blur-dismissal design ruling, then pin (F2 rec 4) | **needs-human-recheck** (a ruling) | Asymmetry confirmed unruled/unpinned: credential sheets die on blur, dismiss-locked reveals survive | Rule at this flight's interview; pin either way |
| 14 | Report generation-identity field (F2 technical item) | **confirmed-live** | Revocation report held main-side with no nonce/timestamp; consecutive reports content-identical | Fold into this flight's vault-state surface work (additive field) |
| 15 | On-script recovery-branch behavior variant (F2 rec 2, spec Variants) | **confirmed-live** | `tests/behavior/compromise-mode-rotation.md:106-110` — witnessed off-script only | Schedule in this flight's behavior/HAT leg |
| 16 | Adopt-chain calibration walk: export→wipe→re-adopt (F1 deferred, "Flight 3 owes this one") | **needs-human-recheck** (operator session) | No run has walked the adopt chain end-to-end since R5/DD8 reshaped it | Owned by the adopt behavior test + HAT |
| 17 | Fresh-adopt jar-creation ordering (mission OQ) | **confirmed-live** | `isSetUp()` = manager file exists (`vault-store.js:807-809`); vault-before-manager invariant doc'd (`:1512-1515`); `jars.add(name, color)` callable directly from main (`jars.js:400-419`) — no IPC round-trip needed | Flight-level DD (N vaults + jar-registry write ordering) |
| 18 | Item-level merge semantics (mission OQ, O3) | **confirmed-live** | No merge machinery exists; existing-profile import is whole-vault replace-with-confirm (`vault-store.js:1696-1711`, `VaultCollisionError`) | Genuine design cluster — likely its own leg, per F1 debrief |
| 19 | Master-sever offer: transient vs persistent (mission OQ, criterion 8) | **confirmed-live** | No offer exists on any adopt path (no `vault-change-master` send there); `changeMasterPassword` hard-requires the old password (`vault-store.js:1000-1002`) — unsatisfiable on a recovery-kind adopt, confirming the mission's pre-named inline adopt-window re-wrap under the live MRK as the viable shape | Flight-level DD |
| 20 | Re-verify vault-store citations by symbol (F2 rec 2) | **already-satisfied** | This recon re-located every citation against `main` at 5eaec48 | Done by this report |

**New findings surfaced by recon** (not in any source artifact):

- **Jar id IS the vault-file basename** (`vault-store.js:463-465`) and
  `jars.add` uniquifies colliding slugs with a `-N` suffix
  (`jars.js:400-419`) — a multi-vault restore that creates jars has a
  real id-reconciliation problem (the bundle's vault id ≠ the created
  jar's id when the slug collides). Needs a DD.
- **Jar identity = name + color only** — there is no icon field
  (`jars.js:8` store shape). The bundle's "jar identity metadata"
  (mission criterion 4) is exactly `{ name, color }`.
- **`_pendingVaultImports` leaks on window destroy** — record retained
  for process lifetime if the owning window closes without modal
  dismissal (`main.js:1488` teardown omits it). Low severity today
  (ciphertext); fix belongs in this flight's held-bundle reshape.

---

## Leg Progress

### Leg 1 — substrate-prep

**Status**: landed
**Started**: 2026-09-02
**Completed**: 2026-09-02

#### Changes Made

**DD9 — glue extraction**

- New `src/main/vault/vault-sheet-errors.js`: the class→reason mapper
  (`mapVaultSheetError(e, config)` + one named config per delegate —
  `VAULT_IMPORT_CONFIG`, `VAULT_UNLOCK_CONFIG`,
  `VAULT_MINT_ACCESS_KEY_CONFIG`, `VAULT_COMPROMISE_ROTATE_CONFIG`,
  `VAULT_ROTATE_RECOVERY_CONFIG`, `VAULT_ROTATE_ADMIN_KEY_CONFIG`,
  `VAULT_CHANGE_MASTER_CONFIG`, `VAULT_RECOVER_CONFIG`). All eight
  `main.js` delegates (`vaultImportFromSheet`, `vaultUnlock`,
  `vaultMintAccessKey`, `vaultCompromiseRotate`,
  `vaultRotateRecovery`, `vaultRotateAdminKey`, `vaultChangeMaster`,
  `vaultRecover`) now route their catch through it; per-delegate
  reason width preserved exactly (verified by
  `test/unit/vault-sheet-errors.test.js`, 11 cases incl. the
  VaultCollisionError-extends-VaultStateError ordering note).
  `vaultUnlock`'s bare-boolean shape is unchanged (`'bare-false'`
  config rule).
- New `src/main/vault/resurface-compromise-reveal.js`: the H2
  orphan-scan/rekey/send composition, injected-deps and
  Electron-free; `main.js`'s `resurfaceCompromiseReveal(rec)` is now
  a thin Electron-plumbing wrapper delegating to it. 6 new tests
  (`test/unit/resurface-compromise-reveal.test.js`): orphan re-key,
  live-owner no-op, no-pending no-op, null-chromeId no-op,
  at-most-one break, and a defensive null-rekey guard.
- The three named transcription suites
  (`vault-unlock-handler.test.js`, `vault-stepup-mint-handler.test.js`,
  `vault-compromise-report-surface.test.js`) now import and compose
  from the real mapper module instead of hand-transcribing the
  ladder; their own assertions are unchanged (behavior-preserving).

**DD8 — blur contract**

- New shared allowlist `src/shared/vault-blur-survival.js`
  (`VAULT_BLUR_SURVIVAL_MENU_TYPES`, `survivesBlur()`,
  `closesOnVaultLock()` = the same set minus `vault-unlock`).
- New `survivesBlur` axis threaded end to end: applied
  unconditionally (true AND false — not just true, so no
  caller-supplied option can override the allowlist verdict in
  either direction) at the single chrome-side funnel
  (`overlay-menus.js`'s `open()`); plumbed through
  `MenuOpenPayload`/`currentSurvivesBlur` in
  `menu-overlay-manager.js` (mirrors `currentKeepFocus`'s
  assign-on-open / reset-on-close shape); `closeMenuOverlay` ignores
  reason `'blur'` — and only `'blur'` — for a flagged menu, checked
  independently of the DD5 `dismissible` guard.
  `menu-controller.js`'s window-blur listener gained the matching
  `cur.survivesBlur === true` guard (the pointerdown outside-click
  guard is untouched, as scoped). `modal-card-controller.js`'s
  `createSheetEntry` forwards a supplied `survivesBlur` opt exactly
  like `dismissible`. All 8 vault-credential sheet registrations in
  `menu-overlay.js` (`vault-unlock`, `vault-set`, `vault-stepup`,
  `vault-import` (menuType `vault-import-unlock`),
  `vault-change-master`, `vault-recover`, `vault-compromise`,
  `vault-compromise-recover`) now pass `survivesBlur: true`.
- Close-on-lock: `main.js` gained
  `closeVaultCredentialSheetsOnLock()` (fan out
  `registry.records()` → `rec.sheet?.closeMenuOverlay('vault-lock')`,
  unconditional per window), wired into the store's `onLock`
  callback (`main.js:769`, the one anchor covering both manual lock
  AND the autolock idle timer — the idle timer calls
  `vault-store.js`'s `this.lockNow()` directly, never through the
  manual `vaultLockNow()` wrapper). `'vault-lock'` is a HARD close
  reason in `menu-overlay-manager.js` (bypasses the `dismissible`
  guard) but SCOPED via `closesOnVaultLock` to the allowlist minus
  `vault-unlock` — verified this scoping is what makes the
  "unconditional call per window" safe (an open kebab/downloads/etc.
  menu, or a dismiss-locked show sheet, is left untouched). New
  integration suite `test/unit/vault-close-on-lock.test.js` (4
  tests) proves the wiring specifically via the injected IDLE-TIMER
  fire path (not just `store.lockNow()` called manually), fanning
  out to multiple windows, tolerating a torn-down window's null
  `rec.sheet`, and no-op on a window with nothing open.
- Reason enum + exhaustive-reason test arrays updated: JSDoc at
  `menu-overlay-manager.js`'s `closeMenuOverlay` gained
  `'vault-lock'`; both hardcoded arrays in
  `menu-overlay-manager.test.js` ("focusChrome runs for
  escape/activated/input-empty only" and "the DD5 hook receives
  EVERY close reason") gained it, switched to opening a
  lock-closeable menuType (`vault-set`) so the new reason actually
  exercises the branch instead of being scoped out.
- `vault-controller-capture.test.js`'s unlock-prompt close-reasons
  loop (`:163`) gained `'vault-lock'` and an explanatory comment
  marking both `'blur'` and `'vault-lock'` as safety-net pins for
  `vault-unlock` specifically (production-unreachable given the
  allowlist/exemption), per the rename-not-silent-edit rule — neither
  assertion was deleted.
- New main-site pins in `menu-overlay-manager.test.js`: 6 tests for
  the survives-blur axis (ignores blur / still closes on every other
  reason / non-flagged menu unaffected / no leak on model-replace /
  resets on close / independent of `dismissible`) and 8 for
  close-on-lock (closes an allowlisted menu / closes every
  allowlisted type except vault-unlock / no-op for vault-unlock /
  no-op for a non-credential menu / no-op for a dismiss-locked show
  sheet / bypasses `dismissible` / idempotent with nothing open /
  composes correctly with survives-blur).
- New renderer-site pins: `menu-controller.test.js` gained a
  handler-capturing `window.addEventListener` stub (the previous
  stub silently discarded the listener, so the blur-close guard was
  untested even before this leg) plus 4 tests; `modal-card-controller.test.js`
  gained the `survivesBlur` passthrough pin;
  `overlay-menus.test.js` gained 3 tests pinning the funnel itself
  (allowlisted → true, non-vault → false, and that a caller-supplied
  option can never override the allowlist in either direction).
- Docs updated: `docs/vault.md` (new "Credential sheets survive
  window blur" + "Close on vault lock" bullets, with the accepted
  trade-off stated) and `CLAUDE.md`'s Menu-overlay sheet section
  (new bullet, `'vault-lock'` added to the Close family reason list —
  disambiguated from an unrelated, pre-existing "DD8" reference in
  the same file, from a different flight).

#### Sweep Findings (blur-dismissal grep, DD8 AC)

Full-tree grep for `'blur'` / `closeMenuOverlay('blur')` across
`test/` + `src/`. Dispositions:

- `auth-challenges.test.js:507` — `vault-unlock`/`'blur'` used as an
  arbitrary FOREIGN-menuType stand-in, calling the auth-challenges
  store directly (`h.store.notifySheetClosed(...)`), never the real
  `menu-overlay-manager.js`. Confirmed benign per design review;
  unchanged, still passes.
- `auth-challenges.test.js:554-557` and `:1032` — both exercise a
  local FAKE sheet mock (`makeRecord()`'s own trivial
  `closeMenuOverlay`, unconditional on any reason, no DD8 gating)
  against `vault-recovery-show` (`:554-557`, explicitly OUT of the
  allowlist) and a non-vault popup-challenge menuType (`:1032`, `K.kind`
  is `auth-basic`/`cert-picker`, never vault). Confirmed benign;
  unchanged.
- `auth-challenges.test.js:461` and `:1131` (`for (const reason of
  ['blur', 'superseded', 'tab-hide', 'tab-switch'])` loops) — same
  fake-sheet harness, parametrized over `K` (auth-basic /
  cert-picker), never a vault menuType. Benign; unchanged.
- `window-factory.test.js:221-222` — `menuType: 'auth-basic'`. Out of
  scope; unchanged.
- `navigation-controller.test.js:730` — the address-bar suggestions
  popup's `'blur'` close sink, unrelated to the sheet substrate.
  Out of scope; unchanged.
- `overlay-menus.test.js:73` ("blur close suppresses only the same
  trigger for 300ms") — exercises `menuType: 'kebab'`, outside the
  allowlist, so the new unconditional `survivesBlur: false` funnel
  assignment doesn't change this test's outcome. Verified passing;
  unchanged.
- `tab-drag-invariants.test.js:102` — a source-text literal pin of
  an unrelated `window.addEventListener('blur', …)` (drag-cancel-on-blur
  in tab drag-and-drop). Out of scope; unchanged.
- Every remaining hit (`menu-overlay-manager.js`/`.test.js`,
  `menu-controller.js`/`.test.js`, `modal-card-controller.js`,
  `register-overlay-ipc.js`, `window-factory.js`,
  `navigation-controller.js`, `overlay-menus.js`,
  `renderer-globals.d.ts`, `chrome-preload.js`, `vault.js`,
  `jars-section-controller.js`) is either the mechanism this leg
  implements/tests, or an unrelated `'blur'` DOM-event/close-reason
  literal on a non-vault surface (address bar, jars-page inline
  rename, drag-and-drop) — no other load-bearing assertion of
  blur-dismissal for an allowlisted vault sheet remains anywhere in
  `test/` or `src/`.

#### Deviations from the Leg Spec

- **Funnel assignment widened from conditional-true to
  unconditional-true/false.** The leg's Implementation Guidance
  suggested `if (allowlist.has(menuType)) payload.survivesBlur =
  true;` (add the key only when true). Implemented instead as
  `payload.survivesBlur = allowlist.has(menuType);` (always assigned,
  explicit `false` for every non-vault menuType) — closes a residual
  gap in the AC's own "no caller-supplied option can override the
  shared source of truth" requirement: the conditional form only
  protects an allowlisted menuType from a caller-supplied `false`; it
  does not protect a NON-allowlisted menuType from a hypothetical
  caller-supplied `true`. No real call site ever passes `survivesBlur`
  today, so this is defense-in-depth, not a behavior change for any
  existing caller — confirmed no other test asserts an exact
  `menuOverlayOpen` payload shape for a non-vault menuType (only
  `overlay-menus.test.js` exercises the real funnel directly; every
  other controller test injects a fake `openOverlayMenu`). No line
  budget or scope impact.

#### Notes

- No pinned line budget exceeded; `renderer.js` untouched (1835/1836,
  confirmed via `seam-contract.test.js`). No new menuType introduced
  — no lockstep registration (TEMPLATES/NODE_OF_ENTRY, a11y skip
  list, SEAM_COUNT) was needed, per DD11.
- Full unit suite: 4178 pass / 0 fail (baseline 4135 + 43 new tests
  across `vault-sheet-errors.test.js` (11),
  `resurface-compromise-reveal.test.js` (6),
  `vault-close-on-lock.test.js` (4), and additions to
  `menu-overlay-manager.test.js` (14), `menu-controller.test.js` (4),
  `modal-card-controller.test.js` (1), `overlay-menus.test.js` (3)).
  `npm run lint` and `npm run format:check` both clean.

---

### Leg 2 — bundle-v2-store

**Status**: landed
**Started**: 2026-09-02
**Completed**: 2026-09-02

#### Changes Made

**New store surface (`src/main/vault/vault-store.js`)**

- `BUNDLE_VERSION_V2 = 2` beside the existing `BUNDLE_FORMAT`/`BUNDLE_VERSION`.
- `exportProfile()` / `_exportProfile()` — gated exactly like `exportVault`
  (unlock-window policy, no write); builds `{ format, version: 2,
  managerVersion, kdf, mrk, adminPublicKeyB64?, vaults: [{ sourceId,
  jarMeta?, vault }] }` — global + every ON-DISK jar vault (lazy vaults
  absent by design), each jar entry's `{name,color}` riding as an
  ENCRYPTED `jarMeta` envelope.
- `jarMetaAad` / `encryptJarMeta` / `decryptJarMeta` (module-level
  helpers) — the jarMeta wrap/unwrap using the EXPORTED generic
  primitives (`deriveHkdfKey` + `wrapVaultKey`/`unwrapVaultKey`,
  `vault-crypto.js`), AAD-bound to the bundle context + `sourceId`.
  `decryptJarMeta` exported for leg 3's pre-mapping label step;
  `restoreProfile` itself never reads jarMeta (ruling 2's split).
- `_adoptManagerCore({ mrk, managerVersion, kdf, masterEnvelope })` — the
  SHARED fresh-adopt core (ruling 1): mints ONE fresh recovery key under
  the live `mrk`, writes `manager.json` at the bundle's effective
  managerVersion with the donor master envelope retained verbatim + the
  new recovery envelope + **NO admin fields**, installs the MRK. Returns
  `{ installed: true, recoveryKeyDisplay }` — the mrk-ownership hand-off
  signal every caller nulls its own `mrk` binding on.
- `_importVault`'s fresh branch now calls `_adoptManagerCore` instead of
  inline admin-minting logic; its `generateAdminKeypair`/`sealToAdmin`
  calls and the whole admin-envelope block are GONE (verified: `grep -n
  "generateAdminKeypair\|sealToAdmin" src/main/vault/vault-store.js` now
  hits only `setup()` and `rotateAdminKey()` — the two legitimate
  provision sites). `importVault`'s return shape no longer carries
  `adminPrivateKeyB64` at all.
- `validateBundleEnvelope(bundle)` (module-level) — the shared
  managerVersion-resolution + mrk-pairing + bounded-KDF validation,
  extracted so `_importVault` (v1-only gate) and `restoreProfile` ({1,2}
  gate) can't drift; `_importVault`'s own inline block was replaced with
  a call to it (behavior/error-message-compatible — the existing
  `vault-manager-v2.test.js` regex-matched assertions on
  "managerVersion"/"together" pass unmodified).
- `normalizeRestoreBundle(bundle)` (module-level, ruling 9) — the v1/v2
  format+version gate: a v1 bundle becomes a one-row
  `{ sourceId: bundle.sourceVaultId, vault: bundle.vault }` entry; a v2
  bundle's `vaults` array is shape-checked (sourceId present, unique,
  vault document present) up front.
- `mergeVaultItems(existing, incoming)` + `deepValueEqual` (module-level,
  ruling 6) — id-identity merge: same id + `deepValueEqual` content
  skips; same id + differing content lands a copy under a
  `crypto.randomBytes(8)` fresh id with `title` suffixed `' (imported)'`
  (the universal non-secret display field per
  `vault-item-schema.js`); disjoint ids always coexist. Returns
  `{ items, mergeReport: { imported, skippedIdentical, conflictCopies } }`.
- `_validateRestoreMapping(vaults, mapping)` — structural mapping
  validation before any crypto/write: every bundle vault needs an
  explicit directive (`'existing'|'new'|'skip'`), an unknown mapping key
  refuses the whole restore, `'new'` needs a valid `newJar`, `'existing'`
  needs a resolvable destination (`_resolveTarget`), `mode` (when
  present) is `'replace'|'merge'`.
- `restoreProfile(bundle, { secret, secretKind, mapping })` /
  `_restoreProfile` — the multi-vault restore: single-flight guarded
  (`this._restoreInFlight`, an INSTANCE field per ruling 7) IN ADDITION
  to the re-key gate (ruling 8); normalizes + validates the bundle and
  mapping, unwraps the bundle secret, then per bundle vault IN ORDER:
  skip → outcome `'skipped'`; `'new'` → `_createJar` then
  `_verifyJarPersisted` (a failed verify → outcome `'failed'`, no vault
  write, loop STOPS — no rollback attempt, later entries untouched);
  `'existing'` → `_resolveTarget`, then collision-refused (occupied +
  no `mode`) / merge (`mode:'merge'`, decrypts the destination under its
  OWN cached key) / plain landed write. Per-iteration `finally` zeroizes
  the bundle vault key (ruling 11 — at most one live at a time, stricter
  than `changeMasterPassword`'s collect-array, cited for its
  zeroize-in-finally + zeroized-unless-installed DISCIPLINE only, not
  its collect mechanism). After the loop, on a fresh profile with no
  failures, calls `_adoptManagerCore` (vault-before-manager — a fresh
  profile with any `'failed'` outcome never adopts, so `isSetUp()` stays
  false and a rerun recovers over the residue). Returns
  `{ fresh, results: [{ sourceId, outcome, destination?, mergeReport? }],
  generation: { completedAt, nonce }, recoveryKeyDisplay? }` — never
  `adminPrivateKeyB64`.
- Two new injected deps (`VaultStoreDeps`): `createJar(name, color)` and
  `verifyJarPersisted(id)` — keep the store jars.js-free; production
  wiring to the real `jars.add`/`jars.verifyPersisted` is leg 3's job
  (main.js).

**`_readManager` v1 relaxation (ruling 10)** — the `doc.version === 1`
special case requiring the admin pair is GONE; both versions now share
ONE optional-but-paired rule (present together or absent together). Top-
of-file format doc block (`:65-80` region) and `rotateAdminKey`'s
provision comment (`:1101` region, "no-admin v2" → "no-admin v1 or v2")
both updated in the same pass, per the design review's staleness note.

**`src/main/jars.js`**

- `verifyPersisted(id)` — additive read-back: re-reads the CURRENT row
  via `docStore.read()` + the injected codec (mirrors `load()`'s
  row-present parse) and checks the id is present; never trusts the
  in-memory `containers` array. Returns `false` (never throws) when
  `docStore` is unset (add-before-load), on a missing/unparseable row,
  or an unwritable/closed store. `save()`'s fail-soft contract and every
  existing caller (`add`/`rename`/`remove`/`setDefault`/`setRetention`)
  are unchanged — pinned directly.

**`docs/vault.md`** — "On-disk format" updated for the v1 admin
relaxation; "Portability" rewritten to describe both bundle generations
(`exportVault`/`importVault` v1, `exportProfile`/`restoreProfile` v2 +
jarMeta + directives/merge/atomicity/single-flight/generation); "Rotation
& recovery"'s adopt paragraph corrected from "two rotations" to "this
recovery-key rotation... mints no admin key at all". The threat-model
donor bullet is UNCHANGED per the leg's scoping (it references the DD7
sever-offer workflow — leg 3's touch).

**Pinned-test inversions/rework (DD6, rename/invert never silent-edit)**

- `test/unit/vault-export-import.test.js`: both FRESH-profile-import
  tests renamed and their six admin-mint assertion sites
  (`typeof res.adminPrivateKeyB64`/`notDeepEqual admin seal`/
  `openAllWithAdminKey` donor-rejected-but-new-key-works triplets)
  INVERTED to assert `'adminPrivateKeyB64' in res === false`, no admin
  fields in the adopted manager, and BOTH the donor key and a dummy
  well-formed admin key failing with the no-admin STATE error.
- `test/unit/vault-manager-v2.test.js`: the AC3 section header and the
  "an ABSENT admin pair on v1 is still malformed" test INVERTED
  (renamed, now the v1 twin of AC2 — validates, unlocks by
  master+recovery, admin paths fail with the no-admin STATE error); a
  NEW sibling test added pinning that a LONE admin field on v1 is still
  malformed (the relaxation only legalizes both-absent). The two AC5
  adopt blocks (no-admin v2 bundle fresh-adopt; with-admin v2 bundle
  fresh-adopt) REWORKED (no direct inversion target, per the design
  review): both now assert NO admin fields land in the adopted manager
  regardless of the bundle's own admin state, and an admin probe fails
  with the no-admin STATE error rather than opening.
- `test/unit/vault-rekey-gate.test.js`: "eight" → "ten" throughout
  (header comment, section comment, test title); the entry-wall test
  gained `exportProfile`/`restoreProfile` busy-at-entry assertions and a
  post-release `exportProfile` sanity check.

**New unit suites** (all Electron-free, FAST_SCRYPT, temp dirs)

- `test/unit/vault-bundle-v2.test.js` (9 tests) — `exportProfile` shape/
  byte-scan/carried-vaults/no-write/locked/no-admin/global-only;
  `decryptJarMeta` round-trip + tamper (ciphertext flip, AAD-splice
  across sourceId, malformed shape); `restoreProfile` v1-normalization,
  bad format/version, the `generation` field's distinct-nonce guarantee;
  an adversarial-replay test (donor recovery dead, dummy admin
  no-admin-STATE, donor master still unlocks).
- `test/unit/vault-restore-directives.test.js` (13 tests) — FRESH:
  'new' create-then-write + result mapping, jar-id `-N` reconciliation,
  the adopt-rerun residue exception (`'existing'` legal on a
  still-`!isSetUp()` profile when the destination is a residue jar),
  the ordinary case (`_resolveTarget` naturally admits only 'global' on
  a truly empty registry), the degenerate skip-all-but-one-jar case.
  EXISTING: collision-refused, `mode:'replace'`, `'new'`. Mapping
  validation: unknown sourceId, omitted entry, unknown destination,
  reserved-id-space newJar name. Single-flight guard (busy on a
  concurrent call, released on success AND throw, not spuriously stuck).
- `test/unit/vault-restore-merge.test.js` (3 tests) — all three counter
  classes (identical/diverged/disjoint) in one scenario with zero data
  loss and the `' (imported)'` marking; a no-collision landing carries
  no `mergeReport`; byte-identical-INCLUDING-timestamps re-restore
  skips everything (documents that `saveItem` always re-stamps
  `updatedAt`, so the suite injects a fixed `now()` dep for determinism).
- `test/unit/vault-restore-fault-injection.test.js` (3 tests) — FRESH
  and EXISTING mid-list `'new'`-verify-failure: earlier landed, later
  untouched, fresh leaves `isSetUp()` false, both rerun to completion
  over the residue; a zeroize-discipline pin (monkeypatched
  `decryptItems` throws on the second vault; the per-iteration `finally`
  is proven to have zeroized that vault key despite the throw).
- `test/unit/jars-verify-persisted.test.js` (5 tests) — present/absent/
  unwritable-store(closed db)/a genuinely-failed-fail-soft-save reading
  back the pre-add state/every existing caller unaffected.

#### Deviations from the Leg Spec

- **Ruling 3's fresh-profile `'existing'`-directive restriction was
  NARROWED at implementation, not dropped, after it collided with
  ruling 4's own adopt-rerun residue edge case.** The leg spec's ruling
  3 reads "only 'new'/'skip'/global→global are legal directives" on a
  fresh profile; ruling 4's residue bullet says a rerun's mapping step
  "lists existing jars as destinations" for a profile still
  `!isSetUp()`. Implemented as: NO fresh-specific gate beyond
  `_resolveTarget` itself — a truly fresh profile's `listJars()` is
  empty, so `_resolveTarget` naturally admits only `'global'` (ruling
  3's stated outcome, reached structurally); a profile carrying
  adopt-rerun residue jars (created, never adopted) legally maps
  `'existing'` onto them, which is what makes ruling 4's own documented
  recovery path reachable. An initial implementation added an explicit
  `fresh && destination !== 'global' → throw` gate matching ruling 3's
  literal wording; this BROKE the residue-rerun fault-injection test
  (a legitimate rerun onto residue jars was refused), which is what
  surfaced the conflict — removed before landing. No AC depended on
  the stricter literal reading; the residue-rerun ACs (per-vault
  atomicity + rerun) are what the corrected behavior satisfies.

#### Notes

- No new dependencies. `main.js`, every `register-*-ipc` file,
  renderer/chrome code, and the delegates were not touched (leg 3's
  scope) — `exportProfile`/`restoreProfile` are unwired store surface
  only; `createJar`/`verifyJarPersisted` are injected-dep seams a real
  caller has not filled in yet.
- Per-suite wall-clock (isolated `node --test <file>` runs, this
  machine): `vault-bundle-v2.test.js` 0.30s (9 tests),
  `vault-restore-directives.test.js` 0.51s (13 tests),
  `vault-restore-merge.test.js` 0.21s (3 tests),
  `vault-restore-fault-injection.test.js` 0.24s (3 tests),
  `jars-verify-persisted.test.js` 0.09s (5 tests),
  `vault-export-import.test.js` 0.39s (12 tests, 2 inverted),
  `vault-manager-v2.test.js` 0.60s (17 tests, 2 inverted/1 new/2
  reworked), `vault-rekey-gate.test.js` 0.19s (6 tests, updated). Every
  suite is well under the ~10s budget (F2 debrief watch item) — no
  suite needed splitting, no tagged tier introduced.
- Full unit suite: 4212 pass / 0 fail (baseline 4178 + 34 new tests:
  33 across the five new files above, plus 1 new sibling test in
  `vault-manager-v2.test.js`). `npm run lint`, `npm run format:check`,
  and `npm run typecheck` all clean for every file this leg touched.
  `npm run typecheck` still reports its PRE-EXISTING errors in
  `main.js`, `vault-sheet-errors.js`, and `menu-controller.js` (leg 1's
  uncommitted tree, out of this leg's scope — reported, not fixed; see
  Anomalies).

---

### Leg 3 — restore-workflow-wiring

**Status**: landed
**Started**: 2026-09-02
**Completed**: 2026-09-02

#### Changes Made

**Store (`src/main/vault/vault-store.js`)**

- `previewRestoreBundle()` / `_previewRestoreBundle()` (ruling 2) — gated
  (`_enterGatedOp`, now the ELEVENTH gated op; `vault-rekey-gate.test.js`
  updated eight→ten→eleven in this leg's own touch), NOT single-flight
  (a preview never writes). Verifies the bundle secret (master or
  recovery), then per bundle vault: unwraps the vault key, decrypts,
  runs `validateImportedItems` (cycle-2 HIGH — a malformed-plaintext
  vault fails HERE, before any commit), decrypts jarMeta via the leg-2
  helper, takes `.length`, discards the plaintext. Returns
  `{ labels: [{ sourceId, jarMeta, itemCount }] }` — no key material, no
  decrypted content. Per-vault key zeroized in a per-iteration `finally`;
  the bundle mrk is ALWAYS zeroized in the outer `finally` (preview never
  installs anything, unlike `restoreProfile`'s adopt hand-off).
- `mintGeneration()` / `_severOffer` / `severOfferRoute()` in `main.js`
  live beside the store but are main-side session state (DD7) — the
  (secretKind × lock-state) route truth table itself is extracted to a
  new pure module, `src/main/vault/sever-offer.js`
  (`computeSeverOfferRoute`), unit-tested Electron-free.

**Held-import store (`src/main/vault/pending-imports.js`, re-modeled)**

- Record shape: `hold(chromeId, { bundle })` → `{ bundle, handle }` only
  (ruling 1 — no destination/overwrite at pick). `stashSecret(chromeId,
  { secret, secretKind, labels }, handle)` — binds the store preview's
  verified secret + labels, arms a `SAFETY_DROP_MS` (5 min) timer
  (injected setTimeout/clearTimeout, the `vault-human.js`
  `CAPTURE_DROP_MS` precedent). `take()` CANCELS the timer WITHOUT
  zeroizing (cycle-2 HIGH — the commit now owns the buffer); every other
  exit (`clear`, timer expiry, `dropAll`) zeroizes + cancels.
  `peekLabels()` — the page's non-secret `{ handle, labels }` projection.
  `chromeIds()` / `dropAll()` — the vault-lock bulk-drop enumeration
  (mirrors the reveals store).

**Reveal store (`src/main/vault/pending-compromise-reveals.js`,
generalized per DD6 ruling 5)**

- `stash(chromeId, recoveryKey, reason)` — `reason` ∈
  `COMPROMISE_REASON` (`'compromise'`) | `ADOPT_REASON` (`'adopt'`),
  both now exported. `ack(chromeId)` returns `{ reason } | null` (was a
  bare boolean) so the caller can fire the completion broadcast for
  EITHER flow. `rekey()` preserves reason across the H2 resurface.
  `resurface-compromise-reveal.js` needed NO code change — it was
  already reason-agnostic (forwards only `recoveryKey`).

**main.js**

- `getVaultStore()` deps gain `createJar`/`verifyJarPersisted` (leg 2
  left these as unfilled injection seams).
- `onLock` hook now also calls `_pendingVaultImports.dropAll()` (DD5's
  lock row, manual AND idle — the same hook).
- `releaseVaultHoldsForWindow` DELETED its `_pendingAdoptAdminKeys.delete`
  call; now calls `_pendingVaultImports.clear(chromeId)` (closes the
  recon leak DD5 names) before `_autolockSuppression.releaseWindow`.
- DELETED: `_pendingAdoptAdminKeys` (the whole Map), `stashAdoptAdminKey`,
  `takeAdoptAdminKey`.
- `vaultImportBeginFromFile(chromeId)` — dropped the `destinationTarget`
  param entirely (ruling 1); `dropPendingVaultImport`/
  `clearPendingVaultImport` — the DD5 drop helper.
- `vaultImportPreviewFromSheet(chromeId, buf, secretKind)` (replaces
  `vaultImportFromSheet`) — runs the store preview, stashes an
  INDEPENDENT COPY of the secret (`Buffer.from(buf)`) onto the held
  record so the overlay handler's own dual-zeroize of `buf` can't
  destroy the commit's copy.
- `vaultImportFetchLabels(chromeId)` — the labels-fetch delegate.
- `vaultImportCommit(chromeId, handle, mapping)` — peeks (never blindly
  takes) the record, refuses on a handle mismatch or a pre-secret record
  (`{ ok:false, reason:'state' }`, never a partial write), THEN takes +
  runs `restoreProfile`, always zeroizes the secret in `finally`. On a
  fresh result: sets `_severOffer`, stashes the reveal under
  `ADOPT_REASON` BEFORE sending `vault-recovery-show` (H2 ordering),
  sends via `webContents.fromId(chromeId)`.
- `vaultImportSeverDismiss()` — clears `_severOffer`.
- `ackCompromiseReveal` renamed `ackVaultReveal` — now the SOLE
  recovery-show ack path (generalized, fires the completion broadcast
  for either reason).
- `vaultChangeMaster` / `vaultRecover` success branches both now clear
  `_severOffer`; `vaultChangeMaster` also gains a `broadcastVaultLockState()`
  call (the squawk-0059 inert-duplicate idiom — it previously broadcast
  nothing, so another window's sever card would have lingered stale).

**register-overlay-ipc.js**

- `vaultImport` injection renamed `vaultImportPreview`; the
  `menu-overlay:vault-import` handler now sends
  `chrome?.send('vault-import-labels-ready')` (no payload) on success —
  no more fresh-adopt branch, no more `stashAdoptAdminKey` call.
- `stashAdoptAdminKey`/`takeAdoptAdminKey` injections DELETED;
  `ackCompromiseReveal` injection renamed `ackVaultReveal`. The
  `activated` handler's `vault-recovery-show` branch collapsed from an
  `if (adminPrivateKey !== undefined) … else ackCompromiseReveal(...)`
  to a single unconditional `ackVaultReveal?.(chromeForAttachment(rec.win)?.id)`.

**register-browser-ipc.js**

- `internal-vault-pick-import-file` — no longer threads a
  `destinationTarget` argument.
- `internal-vault-begin-import-unlock` — fully bare (no payload; no more
  `overwrite`/`handle` binding — `setPendingVaultImportOverwrite`
  DELETED, it no longer exists at all).
- NEW: `internal-vault-import-labels`, `internal-vault-import-commit`
  (payload-shape-validates before calling the delegate), `internal-vault-sever-dismiss`.

**register-vault-ipc.js**

- `internal-vault-state` gains `severOffer: getSeverOffer ? getSeverOffer() : null`.
- NEW: `internal-vault-export-profile` — builds via `store.exportProfile()`,
  reuses the SAME `vaultSaveBundle` injection `internal-vault-export`
  already had; returns `carried` (source ids landed) on success.

**Preload / types (`src/preload/internal-preload.js`,
`src/renderer/renderer-globals.d.ts`)**

- `pickImportFile()` / `beginImportUnlock()` lost their arguments;
  new `exportProfile`, `fetchImportLabels`, `commitImport`,
  `onVaultImportLabelsReady`/`offVaultImportLabelsReady`, `severDismiss`.

**Page (`src/renderer/pages/vault.js`)**

- `openImportModal`/`openExportModal` REPLACED by `openImportPickModal`
  (pick-only, no destination/replace UI), `openMappingModal` (one row
  per bundle vault — Skip / Create new jar / Use an existing vault, a
  disabled "Choose…" placeholder so nothing is pre-selected, reuses
  `buildVaultSelect` for the destination sub-picker per the leg's
  "never leave it orphaned" edge case, a Replace-or-Merge choice gated
  on an async `hasVault` collision probe), `openCompletionModal`
  (renders directly from the commit reply), `openExportProfileModal`
  (whole-profile).
- `buildSeverOfferCard` (DD7) — rendered in BOTH lock states in
  `buildSettingsSection`.
- `pendingImportRecord` / `lastViewVaults` module state; a
  `onVaultImportLabelsReady` listener auto-opens the mapping modal; a
  "Resume restore" banner (both the Settings section and the not-set-up
  page) re-opens it from the cache after a forced broadcast-close
  (ruling 9); a `pagehide` listener best-effort drops the held record.
- `refresh()` now also fetches `bridge.fetchImportLabels()` in the same
  `Promise.all`.
- `vault-page-model.js` (`src/shared/`) — `selectVaultView` gains the
  `severOffer` projection (same defensive-normalization discipline as
  `compromiseReport`), carried through both lock states, dropped for
  not-set-up.

**Docs** — `docs/vault.md` gained "The restore workflow (multi-vault,
Leg 3)" subsection (pick → secret → mapping → commit → sever offer,
held-bundle lifetime, the broadcast-close+resume contract) and the
threat-model donor-password bullet rewritten to state the "alive until
sever, dead after" property explicitly (DD7). CLAUDE.md needed no edit
— no counts/commands it states changed (SEAM_COUNT, the twelve sheet
templates, and `RENDERER_LINE_BUDGET` are all untouched by this leg).

#### Pinned-Test Casualty Dispositions (rename/invert, never silent-edit)

- `vault-pending-imports.test.js` — RE-MODELED in place (same filename,
  entirely new body): every `destinationTarget`/`overwrite` test
  replaced by `hold`/`stashSecret`/`take`/`clear`/`peekLabels`
  window-isolation tests, the timer cancel-on-consume race, and a new
  held-bundle lifetime MATRIX test walking all six drop paths in one
  scenario.
- `vault-request-triggers.test.js:207-208` (now further down the file)
  — `makeImportHarness`'s `vaultImportBegin` fake dropped its
  `destinationTarget` param; `setPendingVaultImportOverwrite` fake
  DELETED; new tests added for `fetchImportLabels`/`commitImport`/`severDismiss`.
- `window-factory.test.js:301-366` — `vaultHoldsFake`'s
  `pendingAdoptKeys` Map (modeling the deleted admin-key store) renamed
  to `pendingImports` (a Set, modeling `_pendingVaultImports.clear`) —
  the holder-level assertions (suppression sharing across
  `'adopt'`/`'compromise'` reasons) were unaffected and kept verbatim;
  only the "what gets dropped" half changed. NOTE: the leg spec's cited
  `clearPendingAdoptAdminKey` injectable in
  `test/unit/helpers/window-factory-harness.js` does not exist in this
  codebase (verified by grep before editing) — the citation was stale;
  the real casualty is entirely inside `window-factory.test.js`'s own
  local fake, re-modeled as above.
- `vault-import-handler.test.js` — RE-MODELED (same filename): every
  fresh-adopt/admin-key-chain test DELETED (that behavior moved to the
  commit step, which this file's handler — now preview-only — never
  reaches); remaining tests re-targeted at the preview delegate
  (`vaultImportPreview`), plus new format/busy/state reason-forwarding
  coverage and a `vault-import-labels-ready` payload-free-send assertion.
- `vault-compromise-handlers.test.js` — `makeSurfacing()`'s separate
  `adoptKeys` Map + `stashAdoptAdminKey`/`takeAdoptAdminKey` DELETED,
  replaced by `stashAdoptReveal` riding the SAME generalized reveal
  store under `ADOPT_REASON`; the four "ack kind" tests renamed and
  re-asserted against `ackVaultReveal` (kind 2's adopt-only case now
  expects the completion broadcast, matching ruling 5, and no second
  sheet ever, since the chain is gone); added a new adopt-specific
  orphan-resurface test (reason-preservation) mirroring the existing
  compromise one.
- `vault-sheet-errors.js` / `vault-sheet-errors.test.js` —
  `VAULT_IMPORT_CONFIG` RENAMED `VAULT_IMPORT_PREVIEW_CONFIG` (collision
  dropped — no longer reachable at the secret step) with a NEW
  `VAULT_RESTORE_COMMIT_CONFIG` (busy/state only, no auth — the secret
  was already verified at preview).

#### New Test Files

- `test/unit/vault-restore-preview.test.js` (8 tests) — v1/v2 label
  shape, jarMeta decrypt, preview-never-installs, wrong-secret auth
  error, no-secret-in-labels byte-scan, the cycle-2 HIGH
  malformed-plaintext-at-secret-step pin (monkeypatched `decryptItems`,
  the fault-injection-suite idiom), a duplicate-id pin, a jarMeta-tamper
  pin.
- `test/unit/vault-sever-offer.test.js` (4 tests) — the extracted
  `computeSeverOfferRoute` truth table, including the "route flips live
  with lock state on the same offer" edge case.
- `test/unit/vault-restore-workflow-invariants.test.js` (6 tests) —
  grep-AC suite (CLAUDE.md's Grep-AC convention) codifying the leg's own
  Verification Steps as a permanent regression net: `adminPrivateKeyB64`
  only on the provision path, `vault-adminkey-show` has exactly one live
  send, `renderer.js` line count unchanged, zero inline
  `instanceof Vault*Error` ladders outside the mapper, no vault-page
  `exportVault` caller, and a source-scan proving `render()`'s forced
  `closeActivePageModal()` never itself drops the held record (ruling 9).

#### Deviations from the Leg Spec

- **None functionally** — one structural refactor beyond the spec's
  literal text: `severOfferRoute()`'s (secretKind × lock-state) logic
  was extracted from `main.js` into a new pure module,
  `src/main/vault/sever-offer.js`, so the AC's "BOTH pinned, including
  the lock-state flip" requirement could be satisfied with a real unit
  test rather than an assertion resting on main.js glue (which this
  codebase's own convention treats as untestable — main.js is never
  `require()`'d under `node:test`). Same footprint, additive file, no
  behavior change.
- The leg's cited `window-factory-harness.js` `clearPendingAdoptAdminKey`
  injectable (Inputs section) does not exist in the codebase — see the
  casualty disposition above.

#### Notes

- No new dependencies.
- Per-suite wall-clock (isolated `node --test <file>` runs, this
  machine): `vault-restore-preview.test.js` 0.28s (8 tests),
  `vault-pending-imports.test.js` 0.04s (21 tests),
  `vault-sever-offer.test.js` 0.04s (4 tests),
  `vault-restore-workflow-invariants.test.js` 0.04s (6 tests),
  `vault-import-handler.test.js` 0.04s (9 tests),
  `vault-compromise-handlers.test.js` 0.05s (13 tests),
  `vault-request-triggers.test.js` 0.05s (20 tests),
  `window-factory.test.js` 0.04s (18 tests, 3 re-modeled),
  `vault-page-model.test.js` 0.05s (19 tests, 4 new),
  `vault-sheet-errors.test.js` 0.05s (12 tests, renamed/reworked),
  `vault-rekey-gate.test.js` 0.19s (updated to "eleven"),
  `vault-compromise-report-surface.test.js` 0.15s (unchanged, verified
  still green), `seam-contract.test.js` 0.04s (1 new budget test). Every
  suite is well under the ~10s budget — no suite needed splitting.
- Full unit suite: **4249 pass / 0 fail** (baseline 4212 + 37 net new).
  `npm run lint` (~3.7s), `npm run format:check` (~5.5s, prettier
  auto-applied to every touched file), and `npm run typecheck` (~0.4s)
  all clean — no pre-existing errors remain (leg 2's Anomalies-listed
  typecheck errors were already resolved by the FD-spawned fix pass
  noted there; this leg introduced none new). Full `npm test` wall-clock
  ≈ 5.2–6.1s across repeated runs.
- Out-of-scope findings: none observed beyond what leg 2's Anomalies
  section already recorded (already resolved before this leg started).

---

## Flight Director Notes

- 2026-09-02: Flight marked `in-flight`; branch
  `flight/03-multi-vault-portability` created off `main` (5eaec48);
  planning artifacts committed (61a5318). Crew file
  `.flightops/agent-crews/leg-execution.md` validated (Crew /
  Interaction Protocol / Prompts present).
- 2026-09-02: Leg 1 `substrate-prep` designed
  (`legs/01-substrate-prep.md`). **Risk tier: HIGH** — the DD8 half
  changes a security-critical shared surface (the app-wide sheet
  dismissal substrate, both processes) and reverses shipped behavior;
  the DD9 half touches nine live IPC delegates. The flight spec
  pre-ruled design review mandatory for this leg; tiering high
  regardless. Design review spawning per the leg-execution protocol
  (max 2 cycles).
- 2026-09-02: Leg 1 design review cycle 1 — **approve with changes**
  (baseline: 4135 tests / lint / format all green). Incorporated:
  ladder-site count corrected nine→EIGHT (reviewer grepped all of
  `src/main/`; the "nine" was a propagated miscount from the F2
  debrief/recon — flight.md DD9 wording corrected too, recon table
  left as snapshot); allowlist membership VERIFIED per template (all
  nine candidate menuTypes render password inputs and are IN;
  `vault-import-unlock` aliases the `vault-import` template); the
  chrome-side flag is applied at the single `overlay-menus.js:63-75`
  open funnel (~20 scattered call sites all pass through it);
  chrome-trusted payload ruled deliberate (dismissible/keepFocus
  precedent); two benign sweep hits pre-located in
  `auth-challenges.test.js`. **Material finding: close-on-lock does
  not exist today** — the lock path is broadcast-only, no
  `closeMenuOverlay` anywhere, and credential sheets hold no autolock
  suppression. FD ruling: DD8's contract names close-on-lock, and
  survive-blur raises the exposure, so the leg ADDS it (new hard
  close reason, scoped to the allowlist, `vault-unlock` exempt —
  lock is its precondition; show sheets never lock-close). Substantive
  change → cycle 2 re-review spawned.
- 2026-09-02: Leg 1 design review cycle 2 (delta-scoped) — **approve
  with changes**, incorporated: close-on-lock hook anchored at the
  store's `onLock` callback (`main.js:769`), the only site covering
  BOTH manual lock and the autolock idle timer (which calls
  `store.lockNow()` directly from `vault-store.js:624`, bypassing
  `vaultLockNow()`); idle-timer-path test required; the two
  exhaustive-reason test arrays named (`menu-overlay-manager.test.js
  :493-502`, `:540-549`); safety-net-pin comment for the unreachable
  vault-unlock × 'vault-lock' combination; allowlist flag applied
  after the options spread at the funnel. Reviewer confirmed no
  bypass path around the `overlay-menus.js` funnel, no new race class
  from close-on-lock (stale-token guard covers mid-submit closes),
  and the vault-unlock exemption is necessary (idle timer can refire
  while the prompt sits open over a locked vault). Max review cycles
  reached; leg marked `ready`. `[HANDOFF:review-needed]` → proceeding
  to implementation spawn.
- 2026-09-02: Leg 1 implementation landed (4178 pass / 43 new tests,
  lint+format clean, renderer.js untouched, uncommitted per the
  deferred-commit model). Developer deviation accepted: the funnel's
  blur flag is set UNCONDITIONALLY from the allowlist (true/false)
  rather than only-when-true, closing the caller-override gap in both
  directions.
- 2026-09-02: Leg 2 `bundle-v2-store` designed
  (`legs/02-bundle-v2-store.md`). **Risk tier: HIGH** — new persisted
  bundle format, adopt-path crypto behavior change (no admin mint),
  gated-op lifecycle membership, security-sensitive throughout; the
  flight pre-ruled design review mandatory. Notable leg-level rulings
  recorded in the artifact: additive entry points (`exportProfile` /
  `restoreProfile`; `exportVault`/`importVault` untouched until leg 3
  rewires), ONE shared adopt core so DD6's no-admin change lands once
  for both paths, `jars.verifyPersisted(id)` as the additive registry
  read-back (save() fail-soft contract unchanged), gate count goes to
  TEN not nine (exportProfile also gated — flight-permitted
  variation), wall-clock ruling = FAST_SCRYPT everywhere + split
  suites over tagged tiers. Design review spawning (max 2 cycles).
- 2026-09-02: Leg 2 design review cycle 1 — **approve with changes**.
  HIGH caught pre-implementation: DD6's no-admin adopt is impossible
  against a v1-effective source manager (`_readManager` requires the
  admin pair at v1; `setup()` still writes v1, so v1 is the DEFAULT
  state and the six pinned adopt tests all use it; the adopted doc
  must stay at the bundle's version because the retained donor master
  envelope is AAD-bound to it and a recovery-kind adopt cannot
  re-wrap). FD ruling (leg ruling 10): relax `_readManager`'s v1
  branch to the same optional-but-paired rule as v2 — one rule, both
  versions; no legitimately-created v1 manager changes outcome
  (setup always minted admin); tamper trade-off documented at the
  check; flight.md DD6 annotated. Also folded in (mediums/low):
  `changeMasterPassword:1310-1426` cited as the required
  loop-zeroize model (one live vault key at a time); the shared adopt
  core's mrk-ownership hand-off spelled out (callers null their
  binding on the install signal); single-flight guard clarified as an
  INSTANCE field (`_rekeyInProgress` pattern); byte-scan citation
  corrected to `:195-198`; jarMeta primitives named
  (`deriveHkdfKey` + `wrapVaultKey`/`unwrapVaultKey` + AAD helper
  idiom — no new crypto surface); jarMeta decrypt ruled a store
  HELPER for leg 3's label step, `restoreProfile` never reads it.
  Reviewer timing check: existing crypto suites run 180-570 ms under
  FAST_SCRYPT — the ~10 s budget is generous. Substantive changes
  (v1 relaxation is new scope) → cycle 2 re-review spawned.
- 2026-09-02: Leg 2 design review cycle 2 (delta-scoped) — **approve
  with changes**, incorporated: the missed ruling-10 direct pin added
  (`vault-manager-v2.test.js:211,244-255` — "absent admin pair on v1
  is still malformed" INVERTS under the relaxation); ruling 11's
  citation corrected (changeMasterPassword actually collects 2×N keys
  into one outer finally — restoreProfile's per-iteration policy is
  deliberately STRICTER; cite the discipline, not the mechanism);
  doc staleness folded in (vault-store.js:65-80 format header +
  rotateAdminKey:1101 comment). Reviewer's sweep confirmed ruling 10
  is contained: NO other site in vault-store.js/vault-crypto.js
  assumes v1⇒admin (all presence-based), no third design option
  exists (master envelopes cannot be re-AAD'd without the password),
  and the not-yet-consumed jarMeta helper export has direct precedent
  (`_acquireRekeyGate`, F2). Max review cycles reached; leg marked
  `ready`. `[HANDOFF:review-needed]` → implementation spawn.
- 2026-09-02: Leg 2 implementation landed (4212 pass / 34 new, lint +
  format clean, new suites 0.09-0.51 s — far under the wall-clock
  watch). Developer deviation accepted and logged in the leg entry:
  ruling 3's literal "no existing-jar directives on fresh" yielded to
  ruling 4's residue-rerun reachability (`_resolveTarget` alone
  enforces the empty-registry outcome). FD action on the Anomalies
  entry below: the typecheck errors are in three LEG-1 files — this
  flight's OWN uncommitted work (leg 1's Developer ran
  suite/lint/format but not typecheck), not pre-existing debt. The
  completion checklist requires typecheck green and leg 3 builds in
  main.js, so a targeted fix Developer is spawned NOW
  (grounding-in-path; no squawk — the breakage is uncommitted flight
  work), before leg 3 design.
- 2026-09-02: Typecheck fix landed — root cause was missing contextual
  types on the leg-1 mapper configs (all six main.js errors cleared by
  annotating `vault-sheet-errors.js`; main.js itself untouched) plus
  the `survivesBlur` field missing from the `MenuEntry` d.ts.
  Typecheck now fully clean repo-wide; 4212 pass / lint / format
  clean.
- 2026-09-02: Leg 3 `restore-workflow-wiring` designed
  (`legs/03-restore-workflow-wiring.md`). **Risk tier: HIGH** — IPC
  reshape of a security-sensitive multi-step flow, lifecycle/state
  changes (held-bundle matrix, reveal-store generalization), and it
  reverses shipped behavior (chain deletion); flight pre-ruled review
  mandatory. Notable leg rulings for review to strike at: the held
  record gains the ZEROIZABLE secret buffer after the preview step
  (commit re-derives; store API untouched); secret verification is a
  new thin store `previewRestoreBundle` composed from leg-2 pieces
  (items NOT decrypted for preview — counts from ciphertext array
  length); reveal store generalizes with a reason parameter and
  `ack → {reason}|null`; sever route computed at state-query time
  from secretKind + lock state, card fires only existing triggers,
  one new window-scoped dismiss handler; export UI goes
  whole-profile (operator may veto at HAT); vault.js gains a budget
  pin. Design review spawning (max 2 cycles).
- 2026-09-02: Leg 3 design review cycle 1 — **approve with changes**;
  three HIGHs, all incorporated: (1) preview item counts CANNOT come
  from ciphertext shape (doc.items is ONE GCM blob) — ruling 2
  corrected to decrypt-then-discard, the `listItemsMeta` precedent,
  with per-vault key zeroize; (2) the secret-bearing held record had
  NO drop trigger on tab-close/navigate-away — ruling 4 gains
  `pagehide` clearing AND a bounded 5-minute safety-drop timer (the
  `vault-human.js` CAPTURE_DROP_MS precedent), both matrix rows;
  (3) "no UI caller of exportVault" was unsatisfiable — the jars
  page's delete-time export (`jars-section-controller.js:638`) is an
  intentional single-vault caller, criterion scoped to the vault
  page's modal. Mediums folded in: generation minted in main.js at
  both stash sites (no vault-store touch); `vaultChangeMaster`
  success gains `broadcastVaultLockState()` (other windows' sever
  cards would linger — recover already broadcasts);
  `pending-imports.js` gains a `chromeIds()`/bulk-drop enumeration
  for the zero-arg global onLock hook. Lows: citation drift fixed
  (`_compromiseReport` main.js:944; change-master/recover
  vault-store.js:1306/:1433 post-leg-2); preview gating rationale
  restated honestly (block starting an import mid-rekey, not
  exportVault's local-read rationale). Reviewer confirmed: no missed
  casualty tests in the sweep, all leg-2 dependencies exist as
  assumed, `vault-import-unlock` correctly in the blur allowlist and
  lock-closing. Substantive changes → cycle 2 re-review spawned.
- 2026-09-02: Leg 3 design review cycle 2 (delta-scoped) — **approve
  with changes**; three findings, all resolved in the artifact:
  (1) preview now runs `validateImportedItems` per vault so
  malformed-plaintext bundles fail at the secret step, not mid-commit
  after earlier vaults landed; (2) the take()/timer race specified —
  `take()` cancels the safety-drop timer on consume (vault-human's
  dropCapture choke-point pattern), timers injected via deps for
  wall-clock-free tests, pagehide demoted to best-effort (no
  send-on-pagehide precedent exists; the timer is the authoritative
  bound); (3) the new change-master broadcast closes other windows'
  mapping modals via the page's shipped closeActivePageModal-on-
  refresh invariant — FD-ruled ACCEPT (the invariant stays
  unexempted) + cheap resume: forced closes don't drop the held
  record, a labels-bearing record surfaces a resume-restore
  affordance re-entering mapping without secret re-entry (new leg
  ruling 9). Max review cycles reached; remaining items were
  specified fixes, not open questions — leg marked `ready`.
  `[HANDOFF:review-needed]` → implementation spawn (final autonomous
  leg; flight-end review + commit follow).
- 2026-09-02: Leg 3 implementation landed (4249 pass / 37 net-new,
  lint + format + typecheck clean; renderer.js untouched at
  1835/1836; vault.js pinned at budget 2820, landed 2555). Developer
  deviation accepted: sever-route logic extracted to
  `src/main/vault/sever-offer.js` so the route truth table is
  unit-testable (main.js is never required under node:test). One
  stale leg citation surfaced in the casualty pass: the
  `clearPendingAdoptAdminKey` harness injectable did not exist —
  disposition recorded in the leg entry. All three autonomous legs
  now landed, uncommitted → Phase 2d: flight-end Reviewer spawned
  over the full diff (Sonnet, per the never-Opus reviewer rule).
- 2026-09-02: Operator advises `main` moved: squawk 0062 (PR #203,
  Badging API strip — webview-preload.js + pin test) landed at
  c3fefbb. Verified zero file overlap with the flight's diff and a
  clean merge-tree. Sequenced AFTER the in-flight review to keep its
  scope honest: review → fixes → leg commit → merge origin/main →
  re-run all gates on the merged tree → draft PR.
- 2026-09-02: Flight-end review — **[HANDOFF:confirmed]**, zero
  blocking issues across four adversarial passes; Reviewer re-ran all
  gates itself (4249/0, lint/format/typecheck clean) and verified the
  security-critical criteria by direct reading (no adopt admin mint,
  no secrets in IPC/labels, zeroize matrix incl. the timer race, v1
  relaxation containment, blur+lock contract, automation gate admits
  no vault-* type). Three non-blocking notes recorded verbatim in the
  review; the third (sheet-side `survivesBlur` flags are a manually
  synced copy of the allowlist, the existing `dismissible` pattern)
  is carried to the flight debrief as a maintenance note. Legs 1-3 →
  `completed`; committing, then merging origin/main (squawk 0062) and
  re-running gates before the draft PR.

---

## Decisions

*(none yet)*

---

## Deviations

*(none yet)*

---

## Anomalies

- 2026-09-02 (Leg 2): `npm run typecheck` reports pre-existing errors
  outside this leg's scope, unchanged before/after this leg's edits —
  `src/main/main.js` (six `Record<string, string | true>` index-signature
  errors on the vault error-mapper config objects at the delegate call
  sites), `src/main/vault/vault-sheet-errors.js` (three errors on a
  class-as-object-key pattern), and `src/renderer/menu-controller.js`
  (one — `survivesBlur` missing from `MenuEntry`). All three files belong
  to leg 1's uncommitted tree (`vault-sheet-errors.js` is new in leg 1;
  `main.js`/`menu-controller.js` are leg-1-modified) and are out of this
  leg's STORE-ONLY scope (`main.js`, delegates, renderer/chrome — leg 3).
  Reported per the leg's "out-of-scope breakage: report it, don't fix
  it" instruction; not fixed here.
- 2026-09-02: Resolved by an FD-spawned targeted typecheck-fix pass —
  `VaultSheetErrorConfig`-typed the eight config constants and typed
  `CLASS_CHECK_ORDER` in `vault-sheet-errors.js` (fixes the `main.js` six
  too, no `main.js` call-site changes needed), and added `survivesBlur?:
  boolean` to `MenuEntry` in `renderer-globals.d.ts`; `npm run typecheck`
  now clean, `npm test` still 4212/0, lint/format:check clean.

---

## Session Notes

- 2026-09-02: Flight planning opened post-PR-#200 merge; local `main`
  synced to 5eaec48. Recon report produced before spec drafting.
- 2026-09-02: Operator interview ruled six open questions (merge
  identity = item id; collisions = keep-both-mark-incoming, no picker;
  held bundle drops on lock/close; sever offer = session card; vault
  credential sheets SURVIVE blur — reverses the shipped default;
  separate guided HAT leg). Spec drafted (DD1–DD12) + behavior spec
  `multi-vault-adopt` drafted.
- 2026-09-02: Architect design review cycle 1 — **approve with
  changes**. Highest finding: the draft's new no-step-up sever op fired
  the flight's own hijack-hardening divert trigger at review; DD7
  re-ruled to route the sever card to the EXISTING step-up-carrying
  ops (`changeMasterPassword` / `recoverMasterPassword`) — no new
  crypto surface. Also folded in: DD8's dual-sited blur mechanism
  (main + renderer guard sites, new blur-survival axis, allowlist);
  DD6's expanded inversion list (`vault-manager-v2.test.js:509-569`,
  `:601-646` need structural rework; `window-factory.test.js:301-366`)
  and the adopt-reveal stash/resurface gap; DD3's jar-registry
  fail-soft verify, single-directory vault-txn fact, and restore
  concurrency note; DD2's pinned-shape casualties; DD11 (new):
  renderer.js budget at ceiling, lockstep registries, focus-driven
  access-key refresh. Citation drifts corrected (`:1668-1669`,
  `:1707`). Note: the recon report above retains its original
  pre-drift citations as a snapshot; flight.md carries the corrected
  ones.
- 2026-09-02: Architect design review cycle 2 (delta-scoped) —
  **approve with changes**, no third cycle needed. DD7's re-ruled
  routing verified on all four axes (`secretKind` is a literal
  parameter at `main.js:1081`; both routes sever; card trigger rides
  existing bare-trigger IPC; post-lock covered). Three small gaps
  folded in: DD3's registry-verify step is NEW jars.js surface (named
  as such); DD6's reveal-store reuse obstacles named (baked reason
  string, ack-boolean flow discrimination at `main.js:914-919`); DD8
  allowlist membership ruled — `vault-unlock` in scope (the operator's
  literal scenario; operator may veto at spec walk), with
  `vault-controller-capture.test.js:163`'s `'blur'` case handled under
  the pin rules. Spec walk with operator is next; status stays
  `planning` until operator approval.
- 2026-09-02: Spec walk-through presented (flagging the DD7 re-rule
  cost, the `vault-unlock` blur-allowlist ruling, and the no-picker
  merge shape); operator approved as-is. Flight marked `ready`;
  `/agentic-workflow` invoked, starting with `substrate-prep`.
