# Flight: Compromise-Mode Rotation

**Status**: ready
**Mission**: [Vault Portability & Compromise Mode](../../mission.md)

## Contributing to Criteria

- [ ] **Full sever, one action** (criterion 1) — the transactional re-key,
      revocation reporting, required different-new-master
- [ ] **Interruption-safe re-key** (criterion 2) — journal + load-time
      recovery, fault-injection verified
- [ ] **Compromise-mode surfacing** (criterion 3) — single post-commit
      recovery sheet, hybrid witnessed behavior test
      (`compromise-mode-rotation`, drafted at planning)
- [ ] **Docs tell the new truth** (criterion 9, compromise-mode half) —
      threat-model "already-extracted MRK" bullet answered; rotation and
      manager-format docs updated

Flight 3 owns criteria 4–8 (portability, restore workflow, adopt, master
severing) and the docs' portability half.

---

## Pre-Flight

### Objective

Implement compromise mode end-to-end: one operator action (the Flight-1
ruled flow — entry row → confirm modal → combined credential sheet →
re-key → single recovery sheet → completion card) that mints a fresh MRK
and fresh vault keys, re-encrypts every vault's items, drops every
per-jar access envelope, removes the admin provision, and re-wraps under
a required **new** master password — as a crash-safe multi-file
transaction with load-time recovery, after which no previously issued or
extracted key material opens anything.

### Open Questions

- [x] All flight-level questions were ruled at planning (operator
      interview, 2026-09-01) — see Design Decisions. Remaining detail
      (journal encoding, exact v2 field shapes, busy-error UX copy) is
      leg-design territory within the constraints below.

### Design Decisions

**DD1 — Manager format v2: admin fields optional (operator ruling).**
`version: 2` managers permit `mrk.admin` and `adminPublicKeyB64` to be
**absent** (unprovisioned/revoked); when present they are validated
exactly as today. Load-loudly is preserved: absent = deliberate state,
malformed-present = `VaultFormatError`. v1 managers (all three slots
required) remain readable unchanged.
- **Version/AAD rule (hazard named at planning):** manager envelopes bind
  the *document's* version in their AAD (`envelopeAad(keyId, type,
  version)`; unwrap sites currently pass the constant `MANAGER_VERSION` —
  `vault-store.js:640-652` and the unwrap call sites). Under v2, every
  unwrap passes the **document's stated version**, and a document's
  envelopes are always homogeneous: **v2 is written only by operations
  that rewrite the full envelope set** (compromise rotation here; fresh
  adopt in Flight 3; optionally `setup`). Single-slot rotations preserve
  the document's existing version and AAD — no mixed-version documents
  can exist. `_assertMrkGeneration` and step-up semantics unchanged.
- **Pairing rule (read side):** `mrk.admin` and `adminPublicKeyB64` are
  present *together* or absent *together*; one without the other is
  malformed-present → `VaultFormatError` (a lone seal is unopenable; a
  lone pubkey corrupts export and fools `revalidate`).
- **Downstream acceptance:** every reader of the admin provision handles
  absence: `unlockWithAdmin` / `openAllWithAdminKey` → clean "no admin
  key provisioned" error; `adminPublicKey()` → null (which
  `vault-context.revalidate()` already fail-closes admin grants against);
  `rotateAdminKey` doubles as from-scratch provision (already true,
  `vault-store.js:867`) and writes both fields together; the Settings
  master-key section renders a "provision" state — fed by a new
  non-secret `adminProvisioned` bit on the internal vault-state surface
  (the current broadcast is `{setUp, unlocked}` only; the page has no
  existing way to know).
- Rationale: the operator chose the version bump over an in-band marker —
  cleaner long-term, and Flight 3's bundle work builds on the same
  optional-admin semantics. Trade-off: the AAD/version rule above must be
  implemented exactly, and it is the flight's most reviewable surface.

**DD2 — Transaction scheme: journal-FIRST + staged files + single-rename
commit + idempotent load-time recovery.** Ordering (design-review
corrected): (1) the **journal is written first**, naming every
transaction member and its staged sibling name — so recovery never needs
to guess what a crash left behind; (2) staged files are written; (3) the
**commit discriminator** — the scheme's central correctness hinge, stated
here rather than left as encoding detail — is a single atomic
journal-state rename (uncommitted journal name → committed journal name):
journal-present-uncommitted ⇒ **roll back** (delete the staged files the
journal names); journal-present-committed ⇒ **roll forward** (finish the
renames); (4) post-roll cleanup removes the journal. **The journal itself is
written via `writeFileAtomic`** (a torn journal is impossible; a kill
inside its write leaves only swept `.tmp-*` residue, and journal-first
guarantees zero staged files exist at that point), and **rollback is
per-file ENOENT-tolerant** (journal-present-but-staged-files-missing —
the kill-between-journal-and-staging case — rolls back as a natural
no-op). **Staged-file names must be disjoint from the `writeFileAtomic`
temp pattern** (`.tmp-<hex>`, `atomic-write.js:38`) so the orphan sweep
can never delete a committed transaction's staged files. Recovery hooks
into the constructor between path setup and the load-loudly
`_readManager` call (`vault-store.js:333-335`), is idempotent under
double-crash, and is ciphertext-only (the mission's ruled exception). **Residue honesty**: a
hard kill *inside* `writeFileAtomic` (`atomic-write.js:36-82`) leaves a
random-suffixed `.tmp-*` no journal can name — the "no stray files"
verification is scoped to journal-named staged files, plus one bounded
`readdir` of `vaults/` at recovery to sweep orphaned `.tmp-*` (today's
no-directory-scan load path is a description, not a rule; the sweep
removes only `writeFileAtomic`-pattern temp names, never vault content).
Note for the fault-injection suite: the in-process monkeypatch-throw
idiom cannot produce this residue class (writeFileAtomic's own cleanup
runs) — cover it by constructing the residue state directly on disk.

**DD3 — Write exclusivity: manager lock + re-key gate + drain.** The
rotation runs under `_withManagerLock` (joining the four serialized
manager ops as the fifth, `vault-store.js:562-577`) **and** a store-wide
re-key-in-progress gate. Design-review-corrected shape:
- **The gate is not entry-check-only.** Mutators that `await` between
  their entry check and their write (`mintAccessKey` awaits scrypt,
  `importVault` likewise) could otherwise resume post-commit and write a
  pre-rotation document. So: (a) every gated mutator holds an in-flight
  counter for its duration; the re-key **drains** — waits for the counter
  to reach zero after raising the gate, before writing the journal; (b)
  every mutator re-checks the gate immediately before each `_writeVault`
  as a second wall. The pinned race test covers the mid-await
  interleaving specifically, not just entry-time races.
- **Gated op list (complete)**: `saveItem`, `deleteItem`,
  `saveItemPreservingSecrets`, `mintAccessKey`, `revokeAccessKey`,
  `importVault`, `exportVault`, and **`deleteVault`** (reached from jar
  delete, `jar-registry-ipc.js:97` — omitting it would let a racing jar
  delete unlink a journal-named file and have roll-forward resurrect a
  vault for a jar the registry no longer has). Each fails fast with a
  distinct busy error while the gate is up.
- **Automation reads stay un-gated — ruled non-goal.** A read racing the
  roll-forward can observe a mixed-directory instant but is provably
  fail-closed (stale session keys GCM-fail → caught → empty,
  `vault-context.js:337-341`; `accessEnvelopeExists` reads disk fresh;
  `adminPublicKey()` null fails admin grants). Do not gate reads.
- **MRK-generation discipline, re-derived for this op** (it does not
  borrow the single-slot idiom): both credential branches derive the
  *old* MRK from the entered credential — never from `this.mrk` — and
  every wrap targets the fresh local MRK, so the op is independent of
  live-lock state mid-flight; `_installMrk(newMrk)` runs **strictly
  post-commit** (installing pre-commit would flip live state before
  durability), leaving the profile unlocked (criterion 3) regardless of
  whether autolock fired mid-derive. `_installMrk` → `_resetKeys` already
  zeroizes and clears **every** cached vault key
  (`importVault:1136-1138` shows the single-vault manual form; here the
  install does it wholesale) — no separate eviction pass.

**DD4 — One combined credential sheet (operator ruling).** The
master-unlocked/locked-with-password branch reuses the
`vault-change-master` template shape (old + new + confirm, one sheet;
mode `compromise`, lede reworded to the ruled framing); the
recovery-entry branch (forgot password) reuses the `vault-recover` shape
(recovery key + new password + confirm). Both enforce R7 (new ≠ old):
master branch compares against the step-up entry at submit;
recovery branch test-unwraps the old master envelope with the candidate
(`unwrapMaster`, `vault-crypto.js:367`, with `manager.kdf` + the doc's
stated version, both in scope inside the store op) — **the good case
throws `VaultAuthError` and must be swallowed as "not a reuse"**, and in
the *reuse* case the test-unwrap **succeeds**, so the unwrapped MRK
buffer must be zeroized before surfacing the ruled inline error. From
locked, the sheet doubles as unlock (mission ruling / R4).
- **Mode carriage (design-review corrected):** the templates are pure
  builders and main's submit handlers see only
  `getCurrentMenu() = {menuType, token, jarId?}` — a model-carried mode
  flag never reaches main. The compromise variants therefore get
  **distinct menuTypes** (e.g. `vault-compromise` / `vault-compromise-
  recover`, with sheet-registry and a11y-fixture entries), and main
  routes on `current.menuType` — **main is authoritative** about whether
  a submit reaches `changeMasterPassword` or `compromiseRotate`; never a
  renderer-supplied flag. (Main-held pending-flow state is the fallback
  if leg design finds registry entries heavier than expected.)
This supersedes the prototype's two-sheet composition; R9's ordering
semantics (confirm → credentials → commit → recovery sheet → card) are
unchanged.

**DD5 — Surfacing: single post-commit recovery sheet with suppression +
teardown.** After the durable commit (never before — criterion 3), the
new recovery key is shown once on the dismiss-locked `vault-recovery-show`
sheet; autolock is suppressed from just before the sheet opens until the
acknowledgment. **Suppression authority (design-review corrected — a
second independent map would be hazardous):** two flows driving the
store's single suppression boolean with independent `size===0` checks
means whichever empties first un-suppresses while the other still holds a
live dismiss-locked reveal — autolock during a one-time-key display, the
exact lockout criterion 3 exists to prevent. So this flight introduces
**one refcounted suppression holder** (`acquire(chromeId, reason)` /
`release(...)`; the store flag is `holders > 0`; the window-`close`
teardown releases all of that window's holds, same hook point as
`window-factory.js:263`), and **migrates the existing adopt flow's
`_pendingAdoptAdminKeys` suppression onto it** in the same leg — Flight
3's DD8 removal then simply deletes the adopt caller. **Squawk 0051's
suppression pins are re-modeled in this flight, not Flight 3** (second
review): those tests (`test/unit/window-factory.test.js:278-350`) are
fake-delegate-based and would stay green while modeling the retired
`size===0` contract — the migration leg renames/re-models them to the
holder contract; Flight 3 then only deletes the adopt-specific callers
and their tests. **No admin sheet
and no stash-then-chain**: this flow does not use F4's two-sheet
machinery. A
pre-commit failure closes the credential sheet with the ruled error
("nothing changed; your existing keys remain valid") and shows no secret.

**DD6 — Completion report and lock-state matrix.** The rotation returns
the revoked set (whether an admin provision was removed + jar ids whose
access envelopes were dropped); main broadcasts completion
(`broadcastToChromeAndInternal` idiom, `main.js:785`) and the page
renders the ruled persistent card (R8: uniform "Revoked" rows; renders
post-flow **regardless of entry lock state** — the flow ends unlocked
because the fresh MRK is installed). **Card persistence semantics
(design-review question, answered):** the revocation report is held
**main-side in memory** for the app session and exposed on the internal
vault-state surface (beside the new `adminProvisioned` bit), so the card
survives page reloads and re-renders; it is **not persisted to disk**
(`manager.json` stays crypto-only) and clears on operator dismissal or
app relaunch — after a relaunch the operator still holds the
acknowledged recovery key and the master-key section shows the
unprovisioned-admin state. Acceptance cluster (from Flight 1): entry row
visible in both lock states at the bottom of Settings; card renders from
both entry states; placement consistent.

**DD7 — Export/import on an admin-revoked or v2-source profile
(operator-directed; design-review expanded).** The admin slot in a bundle
is vestigial post-F4 (fresh adopt discards it; import never opens with
it). Three coordinated changes, all in this flight — this flight is what
makes v2 sources exist, so the compatibility work cannot wait for Flight
3:
- `exportVault` on a v2 manager without admin omits the admin fields;
  **import validation is relaxed to tolerate an absent admin slot**
  (backward-compatible: v1 bundles with the slot stay valid;
  `vault-store.js:1019-1036` loop becomes two-required-plus-optional).
- **The bundle carries the source manager's version** (a new optional
  bundle field; absent ⇒ 1, so existing bundles are unaffected) — without
  it, bundle envelopes from a v2 manager are AAD-bound to version 2 while
  both import unwrap sites pass the constant `MANAGER_VERSION` = 1
  (`vault-store.js:1062`, `:1067`), making every v2-source bundle
  cryptographically un-importable with a misleading "wrong secret"
  failure. Both unwrap sites pass the bundle's stated manager version.
- **Fresh adopt writes its manager at the bundle's manager version** —
  adopt retains the donor master envelope verbatim while re-wrapping the
  other slots; wrapping those at a different version than the retained
  envelope would create exactly the mixed-version document DD1 forbids
  (a manager that validates at boot but fails AAD on every master
  unlock).
Flight 3's bundle v2 formalizes multi-vault; this flight keeps
export/import correct and non-dead-ending for rotated profiles.

**DD8 — Adopt-admin ruling recorded (implemented in Flight 3).** Operator
ruling at this flight's planning: fresh adopt also stops minting an admin
key — recovery-only surfacing, admin severed by omission (mission
criterion 6 amended). Consequence noted for Flight 3: F4's
stash-then-chain machinery (`register-overlay-ipc.js:120-133`,
`_pendingAdoptAdminKeys`, the window-factory hook) loses its last
consumer and is removed there; squawk 0051's tests pin that machinery and
must be retired with it (rename/invert, not silently deleted).

**DD9 — Behavior-test apparatus (hybrid witnessed; act/observe audited).**
Spec `tests/behavior/compromise-mode-rotation.md` (drafted at planning).
**Act path**: page surfaces driven by the goldfinch-development MCP at
admin tier (confirm modal is page DOM — drivable); sheet steps performed
by the operator (sheets are excluded from automation by design — the
mission's never-widen constraint). **Observe path** (cited): sheet
presence via `enumerateWindows.sheetVisible` (admin-only, verified live
in Flight 1); page DOM/screenshots of the internal vault page (admin
tier); on-disk `manager.json`/`.gfvault` state via filesystem apparatus
(flat `userData/vaults/` layout, `vault-store.js:296-348`); negative
replay probes via the Electron-free store harness
(`test/unit/vault-key-rotation.test.js:21-51` idiom). Sheet *contents*
are operator-attested only.

### Prerequisites

- [ ] Flight 1 completed (rulings R1–R9 final) — done 2026-09-01
- [ ] Mission criteria 1/3/6 amendments committed — done at planning
- [ ] Dev environment restored: the `goldfinch-dev` profile was wiped at
      Flight 1 teardown — before the behavior-test/HAT leg, relaunch with
      `DEV_MINT` **once** to mint fresh automation keys, update the
      standing MCP config, then relaunch without (per CLAUDE.md /
      docs/dev-testing.md)
- [ ] Behavior-test apparatus probe (MCP admin attach + internal-page
      capture) before the leg that runs the spec
- [ ] Operator availability for the HAT leg

### Pre-Flight Checklist

- [x] All open questions resolved (ruled at planning interview)
- [x] Design decisions documented (DD1–DD9)
- [ ] Prerequisites verified (dev-profile restore pending; probe at the
      behavior/HAT leg)
- [x] Validation approach defined (see Verification)
- [x] Legs defined

---

## In-Flight

### Technical Approach

Store-first, UI-second, verification-last — each leg carries its own
tests and doc updates. The store work happens in the Electron-free
harness (temp dirs, `FAST_SCRYPT`, on-disk byte probes —
`vault-key-rotation.test.js` idioms); fault injection extends the
`vault-atomic-write.test.js` monkeypatch idiom (throw on the Nth
`renameSync`) across the multi-file sequence. The UI leg clones the
rotate-recovery wiring end-to-end (page kebab-section →
`internal-preload` → `register-browser-ipc` bare trigger → chrome
`vault-controller` → sheet template mode → `register-overlay-ipc`
submit handler with token/Uint8Array/zeroize discipline → store delegate
in `main.js`) with the Flight-1 ruled surfaces. Sheet-handler tests use
the stubbed-sheet harness (`vault-rotation-handlers.test.js:19-56`).

### Checkpoints

- [ ] CP1: Manager v2 + optional-admin + bundle-version compat lands —
      all readers handle absence; v1 read-compat pinned. **Pinned tests
      this changes are inverted/renamed, never silently edited** (Flight
      1 debrief rule): `test/unit/vault-export-import.test.js:161` ("all
      three mrk envelopes" export pin) and the three-slot bundle
      assertions at `:259`/`:344`; the import three-slot-loop coverage;
      the corrupt-manager exact-directory-listing assertion
      (`test/unit/vault-store.test.js:710`) wherever the journal can
      coexist
- [ ] CP2: Transaction/journal layer lands — fault-injection suite
      proves old-or-new-never-mixed at every kill point; recovery
      idempotent under double-crash; orphaned-temp sweep covered via
      constructed on-disk residue
- [ ] CP3: Re-key op lands — full sever pinned by adversarial on-disk
      tests; drain + gate races pinned including the mid-await
      interleaving; revocation report correct
- [ ] CP4: Flow wiring lands — lock-state matrix tests green; suite,
      typecheck, lint clean
- [ ] CP5: Behavior test `compromise-mode-rotation` run (hybrid
      witnessed) passes; guided HAT passed; docs updated
      (`docs/vault.md` rotation + threat model: the "already-extracted
      MRK" bullet gains its answer)

### Adaptation Criteria

**Divert if**:
- The transaction layer grows beyond a contained journal+staged scheme
  (e.g. needs a generation-directory redesign) — pre-named divert: it
  becomes its own leg cluster with a fresh design review
- The v2 version/AAD rule proves incompatible with an existing unwrap
  site in a way the design review didn't catch — stop and re-rule; never
  ship mixed-version envelope documents

**Acceptable variations**:
- Busy-error copy, journal field names, staged-file naming — leg-level
- Folding the export/import relaxation (DD7) into leg 1 or leg 2,
  whichever touches the surface naturally

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are
> planned and created one at a time as work progresses. This list will
> evolve based on discoveries during implementation.

- [ ] `manager-v2-optional-admin` - Format v2 read/write + version/AAD
      rule + pairing rule, all admin-absence readers, export/import
      compat (relaxation + bundle manager-version field + adopt-at-
      bundle-version) (DD1, DD7), pinned-test inversions (CP1 list);
      HIGH risk (load path + format) — design review mandatory
- [ ] `txn-journal-layer` - The journal-first staged-commit transaction
      primitive + load-time recovery + the drain/gate exclusivity
      machinery (DD2, DD3), fault-injection matrix incl. constructed
      residue states and the mid-await race pin; HIGH risk — design
      review mandatory (pre-split from the re-key op at design review's
      recommendation: the fault matrix is a leg's worth of work)
- [ ] `compromise-rotate-op` - The `compromiseRotate` store op on top of
      the transaction layer: credential branches + R7 enforcement (incl.
      reuse-case MRK zeroize), fresh MRK/vault keys, re-encryption,
      envelope drops, revocation report, post-commit `_installMrk`;
      adversarial on-disk suite (DD3, DD4 store half); HIGH risk —
      design review mandatory
- [ ] `flow-wiring` - Page entry (both lock states) + confirm modal (R3
      copy) + compromise menuTypes and sheets (DD4 — new menuTypes join:
      the `menu-overlay.js` menuType→template map + JSDoc union
      (~:2382-2402), the `vault-controller.js` SHEET_STATES table
      (:399-475) + a11y audit-driver hooks (:602-640), the
      `scripts/a11y-audit.mjs` skip list (:432), and
      `test/unit/seam-contract.test.js` tier-2 expectations) +
      post-commit recovery sheet on the refcounted suppression holder,
      adopt-flow migration + 0051 pin re-modeling included (DD5) +
      completion card, main-side report state + `adminProvisioned` bit
      (DD6) + lock-state matrix tests + `docs/vault.md` updates;
      MED-HIGH risk
- [ ] `behavior-spec-and-hat` *(HAT)* - Finalize + run the
      `compromise-mode-rotation` hybrid witnessed spec; guided HAT: a
      real rotation on the restored dev profile, operator at the
      controls (both entry states, reuse-rejection probe, negative
      replay of captured old material)

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing (suite + typecheck + lint; fault-injection suite
      included)
- [ ] Documentation updated (`docs/vault.md`; CLAUDE.md only if commands
      change)

### Verification

- **Criterion 1 (full sever)**: adversarial on-disk unit tests — capture
  old recovery key, admin private key, access-key secret, raw MRK and a
  vault key before rotation; after rotation every one fails
  (GCM/auth), the new master password and new recovery key succeed, item
  plaintext round-trips, and the revocation report names exactly the
  jars that carried access envelopes. `.gfvault` item ciphertext must be
  byte-different (inverting the existing rotations' byte-identical
  assertions).
- **Criterion 2 (interruption safety)**: fault-injection suite over the
  full write sequence — for every kill point (each staged write, the
  journal write, the commit rename, each post-commit rename), a fresh
  `load()` yields a profile that is entirely old or entirely new, opens
  with the corresponding credentials, and leaves no stray temp/staged
  files.
- **Criterion 3 (surfacing)**: `/behavior-test compromise-mode-rotation`
  (hybrid witnessed) + the guided HAT; IPC-layer unit tests pin the
  handler logic (stubbed sheet), the behavior test pins the real
  composition and commit-before-surfacing ordering.
- **Lock-state matrix** (R4/R8): unit tests on the page model + the
  behavior test's both-entry variant.
