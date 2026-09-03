# Leg: bundle-v2-store

**Status**: completed
**Flight**: [Multi-Vault Portability](../flight.md)

## Objective

Land the entire store side of multi-vault portability in the
Electron-free harness: bundle v2 export (whole profile, encrypted jar
identity), the multi-vault restore operation with per-vault directives,
outcomes, jar creation/verification and merge (DD1/DD3/DD4), the
adopt-no-admin change with its pinned-test inversions (DD6 store half),
and gating for the new entry points (DD10). No IPC, no UI — leg 3 wires
the workflow.

## Context

- **DD1/DD3/DD4/DD6/DD10** (flight.md) are this leg's charter; read
  them in full before starting. DD2/DD5/DD7 (workflow/IPC) are leg 3 —
  do not touch main.js delegates or handlers here.
- Leg 1 landed the error mapper (`src/main/vault/vault-sheet-errors.js`)
  and blur contract; this leg is store-only and should not need either,
  but the mapper exists if a new error class needs reason mapping later
  (that wiring is leg 3's).
- The mission rules per-vault atomicity with rerun recovery — NOT
  profile-wide transactionality (that is compromise mode's budget).
  Structural fact from flight review: the jar registry lives outside
  `vaultsDir` and `vault-txn.beginTransaction(dir, members)` is
  single-directory (`vault-txn.js:374-384` exports) — jar creation can
  NEVER join a vault-txn transaction. Do not try. (Cycle-1 review
  strengthened the argument: the registry lives in the app-db SQLite
  file at the userData root — `app-db.js:352` — so even a
  multi-directory txn could not encompass it; full atomicity is
  structurally unreachable, which is why the mission's per-vault +
  rerun ruling is the right shape, not a compromise.)
- Wall-clock ruling (F2 debrief rec 5, decided here per the flight's
  Technical Approach): all new suites run under `FAST_SCRYPT`,
  bundles are constructed programmatically with FAST_SCRYPT kdf
  params, and pure-machinery rows (validation, merge accounting,
  outcome shapes) use pre-built fixtures rather than fresh scrypt
  derives wherever possible. If a suite still nears ~10 s, SPLIT the
  suite file — do not introduce a tagged tier.

## Inputs

(All citations verified 2026-09-02 on branch
`flight/03-multi-vault-portability`, post-leg-1 tree.)

- Bundle constants: `vault-store.js:94-95` (`BUNDLE_FORMAT`,
  `BUNDLE_VERSION = 1`); v1 shape doc'd `:89-95`
- Export: `exportVault(target)` `:1453-1465` (gated, `:1459`),
  `_exportVault` `:1471-1498` (unlock-window policy `:1472`;
  admin-when-provisioned `:1480,:1489-1495`)
- Import: `importVault` `:1531-1542` (gated `:1536`), `_importVault`
  `:1549-1716`; version gate `:1559-1561`; managerVersion threading
  `:1567-1573`, `:1626`, `:1631`; kdf validation `:1603`
  (`validateImportedKdf`); item validation `:1644`
  (`validateImportedItems`); fresh-adopt branch `:1646-1692`
  (vault-before-manager `:1649`; forced recovery rotation
  `:1665-1667`; **admin mint to remove** `:1668-1671`, its comment
  names this flight; donor master retained `:1679`); existing-profile
  branch `:1695-1711` (collision `:1698-1706`, `VaultCollisionError`)
- Write path: `_writeVaultForKey` `:895` (atomic single-file); callers
  `:873`, `:1649`, `:1707`, `:1930`
- Gated ops: `_enterGatedOp` def `:759`; EIGHT call sites today
  (`:1459`, `:1536`, `:1794`, `:1906`, `:2017`, `:2071`, `:2287`,
  `:2486`); suite `test/unit/vault-rekey-gate.test.js` hard-codes
  "eight" at `:6`, `:81`, `:84` and enumerates ops by name
- Jar registry: `jars.js` — store shape `:8` (`{id, name, color,
  partition, retentionDays}`); `slug()` `:388-398`; `add(name, color)`
  `:400-418` (in-memory push BEFORE `save()`, `-N` uniquifier
  `:404`, returns the container regardless of persist outcome);
  `save()` `:374-380` (deliberately fail-soft, swallow-all — comment
  explains why the docStore call must stay inside the try);
  `docStore` is module-private
- Jar id IS the vault-file basename (`_vaultPath`,
  `vault-store.js:463-465` region) — the id-reconciliation problem is
  real (recon finding)
- Pinned tests to invert/rework (DD6):
  `test/unit/vault-export-import.test.js` admin-mint assertions at
  `:247-248`, `:268-269`, `:284-289`, `:346-347`, `:353-354`,
  `:369-373` (re-verify drift before editing — leg 1 did not touch
  this suite); `test/unit/vault-manager-v2.test.js:509-569` and
  `:601-646` (adopt admin-slot AAD-homogeneity coverage — structural
  REWORK, no direct inversion target); **and the ruling-10 direct
  pin `vault-manager-v2.test.js:244-255`** ("an ABSENT admin pair on
  v1 is still malformed (v1 rules unchanged)") plus its section
  header at `:211` — this test INVERTS under the relaxation
  (rename/invert, never silent-edit); byte-scan plaintext-absence
  idiom at `vault-export-import.test.js:165` (assertions in the body
  at `:195-198`)
- Fault-injection idioms: `vault-txn` recovery tests and
  `vault-key-rotation.test.js:21-51` (Electron-free store harness,
  temp dirs, adversarial replay)
- Manager-version rules (design-review cycle 1 — load-bearing for the
  no-admin adopt): `setup()` still writes `MANAGER_VERSION = 1`
  (`vault-store.js:75-82` — v1 is the DEFAULT state of every
  never-rotated profile); `_readManager` `:481-544` REQUIRES the admin
  pair for `doc.version === 1` (`:520-527`) while v2 is
  optional-but-paired; the manager document is single-versioned
  (`unlock()` uses `manager.version` uniformly, `:917-922`); the
  retained donor master envelope is AAD-bound to the source version,
  and a recovery-kind adopt has no plaintext password to re-wrap it
- Multi-key zeroize prior art: `changeMasterPassword`
  `vault-store.js:1310-1426` — the `workingKeys` collect-and-zeroize
  `finally` pattern with `newMrk`/`oldMrk` zeroized-unless-installed;
  the house model for "N vault keys in a loop, one shared MRK"
- Byte-scan assertions at `vault-export-import.test.js:195-198` (the
  `:165` test's body)
- jarMeta crypto fit (design-review verified): exported
  `wrapVaultKey`/`unwrapVaultKey` (`vault-crypto.js:320-334`, generic
  Buffer plaintext + caller-supplied AAD) + `deriveHkdfKey`
  (`:305-307`) — no new crypto surface needed; AAD helper follows the
  `mrkEnvelopeAad`/`envelopeAad` local-helper idiom (`:159-170`)
- `jars.js` read-back feasibility (design-review verified): `docStore`
  exposes synchronous `read()` (`app-db.js:411-415`, SQLite
  `selectDoc.get`); a failed fail-soft `save()` leaves the row
  unchanged, so a read-back correctly reports the pre-add state
- `_enterGatedOp` (`vault-store.js:759-773`) does NOT serialize
  concurrent gated ops against each other (counter, not mutex) — the
  single-flight guard is genuinely needed

## Leg-Level Design Rulings

(These interpret the flight DDs where they left choices open; recorded
here so the design review can strike at them.)

1. **New entry points, additive**: `exportProfile()` produces the v2
   bundle; `restoreProfile(bundle, opts)` consumes v1 AND v2.
   `exportVault(target)` / `importVault(bundle, opts)` keep their
   current single-vault v1 behavior UNCHANGED this leg (main.js still
   calls them until leg 3 rewires; their fate — retirement or
   delegation — is a leg-3 decision recorded there). Shared
   validation/crypto is extracted into private helpers, not
   duplicated: the fresh-adopt core (manager adoption + forced
   recovery rotation) must exist ONCE, used by both `_importVault`'s
   fresh branch and `restoreProfile`'s fresh branch — DD6's
   no-admin-mint change is made in that single core, so both paths
   stop minting at the same commit. **mrk ownership hand-off
   (cycle-1 review)**: `_installMrk(mrk)` takes ownership of the SAME
   buffer (`vault-store.js:967-985`); today `_importVault` protects
   the install with `mrk = null` before its `finally` (`:1685`). A
   callee's reassignment does not propagate to the caller, so the
   shared core must SIGNAL installation (e.g. return
   `{ installed: true }` or take/return ownership explicitly) and
   EACH caller must null its own local `mrk` binding on that signal —
   otherwise the caller's `finally` zeroizes the just-installed live
   MRK. Spell this out in the core's JSDoc and pin it (a post-adopt
   decrypt in the same test run catches a zeroized MRK).
2. **Bundle v2 shape**:
   `{ format: 'gfvault-bundle', version: 2, managerVersion, kdf,
   mrk: { master, recovery, admin? }, adminPublicKeyB64?,
   vaults: [ { sourceId, jarMeta?, vault } ] }`
   — `jarMeta` present for jar vaults only (absent for global), and is
   CIPHERTEXT: the `{ name, color }` pair encrypted under a key
   derived from the bundle MRK via the EXPORTED primitives —
   `deriveHkdfKey(mrk, salt, info)` for the jarMeta key,
   `wrapVaultKey`/`unwrapVaultKey` (generic Buffer plaintext +
   caller-supplied AAD, `vault-crypto.js:320-334`) for the envelope,
   with a `jarMetaAad(...)` local helper binding bundle context +
   `sourceId` (the `mrkEnvelopeAad` idiom). No new crypto surface.
   Requirement: NOTHING human-readable about jars appears pre-secret,
   byte-scan-assertable. **Decrypt responsibility split (cycle-1
   question 3, ruled)**: this leg exports a store-side
   `decryptJarMeta`-style helper (unit-tested, including the tamper →
   loud auth/format error case) for leg 3's pre-mapping label step;
   `restoreProfile` itself does NOT read jarMeta — it consumes the
   explicit `mapping[].newJar.{name, color}` the (leg-3) mapping step
   supplies. The "Lone jarMeta tamper" edge case pins the HELPER's
   loud failure. Export enumerates
   GLOBAL + every jar vault that exists on disk (lazy vaults absent by
   design; the result names which vaults were carried). Admin pair
   rides only when provisioned, exactly as v1.
3. **Restore input**: `restoreProfile(bundle, { secret, secretKind,
   mapping })` where `mapping` is per-sourceId:
   `{ directive: 'existing'|'new'|'skip', destination?,
   mode?: 'replace'|'merge', newJar?: { name, color } }`.
   All crypto before any write (the `_importVault` discipline).
   Fresh profile (`!isSetUp()`): only `'new'`, `'skip'`, and the
   global→global row are legal directives (no existing jars);
   ends in adopt (manager write + `_installMrk`), forced recovery
   rotation, **NO admin mint** — the adopted manager carries no admin
   provision and the result has NO `adminPrivateKeyB64`.
4. **Ordering + atomicity (DD3)**: per directed vault, in order:
   (a) resolve/create destination — for `'new'`:
   `jars.add(name, color)` then **`jars.verifyPersisted(id)`** (NEW
   jars.js surface: a read-back of the persisted document confirming
   the id is on disk; additive — `save()`'s fail-soft contract is NOT
   changed, every existing caller keeps its semantics); a failed
   verify → outcome `failed`, NO vault write, NO rollback attempt
   (removing the phantom would re-enter the same failing save; the
   in-memory jar stays until restart, the report says `failed`, rerun
   recovers) — (b) write the re-keyed vault via `_writeVaultForKey`
   (atomic per file). Fresh adopt: the manager write + `_installMrk`
   happen ONCE, AFTER the vault loop (vault-before-manager invariant
   extended: a mid-list failure leaves vaults+jars on disk but NO
   manager → `isSetUp()` stays false → rerun re-adopts; residue jars
   surface as mapping destinations, the flight's documented recovery
   path). A mid-list failure on an EXISTING profile leaves earlier
   vaults landed (outcome per vault), later untouched — the result
   reports what happened; rerun recovers.
5. **Result shape (DD3)**: ordered
   `{ fresh, results: [ { sourceId, outcome:
   'landed'|'skipped'|'collision-refused'|'failed', destination?,
   mergeReport? } ], generation: { completedAt, nonce },
   recoveryKeyDisplay? }` — `destination` is the DESTINATION jar id
   (source ids never survive; the `-N` uniquifier makes them diverge),
   `collision-refused` is the outcome when the destination holds a
   vault and the directive carried no `mode`, `failed` carries no
   partial write. `generation` is the flight's generation-identity
   field (timestamp + crypto-random nonce). The compromise-report
   surface's matching field is LEG 3 (it lives in main.js session
   state, not the store).
6. **Merge (DD4)**: identity = item id. Same id + deep-equal content →
   `skippedIdentical`. Same id + differing content → incoming lands
   under a FRESH id with its display name visibly marked (suffix
   `' (imported)'` — leg-level per the flight's acceptable
   variations; applied to the item's name/label field per type).
   Different ids coexist (`imported`). Non-interactive; returns
   `mergeReport: { imported, skippedIdentical, conflictCopies }`.
   Merge requires decrypting the destination vault (unlocked MRK —
   guaranteed by `_requireMrk` on the existing-profile path). Replace
   remains whole-vault (the existing `_writeVaultForKey` overwrite),
   reachable only via an explicit `mode: 'replace'` directive.
7. **Concurrency (DD3)**: an INSTANCE-field single-flight guard on
   `restoreProfile` (`this._restoreInFlight`, the `_rekeyInProgress`
   pattern — `vault-store.js:433-436` constructor fields; NOT a bare
   module-scope variable, which would leak across the many per-test
   store instances `vs.load()` creates) — a second concurrent call
   throws `VaultBusyError` at entry; released in `finally`. This is
   IN ADDITION to `_enterGatedOp`, which is a counter, not a mutex
   (`:759-773`), and does not serialize two restores.
8. **Gating (DD10)**: BOTH new entry points take `_enterGatedOp()`
   exactly as their v1 siblings do (`exportProfile` mirrors
   `exportVault`'s read-snapshot rationale; `restoreProfile` mirrors
   `importVault`'s full-duration hold). `vault-rekey-gate.test.js`'s
   "eight" wording and enumeration update to the new count
   (rename/extend, never silent-edit). Note: the flight's DD10 says
   "ninth op" because it counted only the restore; with
   `exportProfile` also gated the count is TEN — this is the
   flight-permitted leg-level variation, recorded here and in the
   flight log.
9. **v1 on the new path**: `restoreProfile` normalizes a v1 bundle to
   a single-entry v2 shape internally (sourceId from
   `bundle.sourceVaultId`, no jarMeta) — the "one-row case" of the
   same flow. The version gate on the NEW path accepts `{1, 2}`;
   `importVault`'s own gate stays v1-only (it never learns v2).
10. **v1 managers relax to optional-but-paired admin (cycle-1 HIGH,
    FD-ruled).** The no-admin adopt is IMPOSSIBLE under today's rules
    for a v1-effective source: the adopted manager must be written at
    the bundle's effective managerVersion (the retained donor master
    envelope is AAD-bound to it, and a recovery-kind adopt has no
    plaintext password to re-wrap), the document is single-versioned,
    and `_readManager` REQUIRES the admin pair at v1 (`:520-527`) —
    so a no-admin v1 adopt would write a manager `_readManager`
    rejects on the next unlock. Since v1 is the DEFAULT state
    (`setup()` writes v1) and recovery-kind adopt of a v1 bundle is a
    first-class mission scenario (the behavior spec's own path),
    minting admin conditionally would violate mission criterion 6.
    Ruling: this leg relaxes `_readManager`'s v1 branch to the SAME
    optional-but-paired rule as v2 — one rule for both versions.
    Blast radius, considered: every legitimately-created v1 manager
    today HAS the admin pair (`setup()` mints it), so no existing
    profile changes validation outcome; the trade-off (a
    slot-deletion tamper on a v1 manager now degrades to the
    no-admin state instead of a loud malformed error — envelope
    integrity itself is still GCM/AAD-protected) is documented in the
    code comment at the relaxed check AND in the top-of-file manager
    format doc block (`vault-store.js:65-80`, whose v1 line
    `_readManager`'s inline comment points at — both go stale
    otherwise); the `rotateAdminKey` comment at `:1101` ("no-admin
    v2") gets its one-line v1 touch-up in the same pass. Any test pinning
    "v1 requires admin" is renamed/inverted per the pinned-test rule.
    Downstream no-admin behavior (state-error probes, key-status,
    auto-mint) already keys on admin PRESENCE, not version — shipped
    app-wide by F2 for v2; the relaxation extends it to v1 documents.
11. **Zeroize discipline in the multi-vault loop (cycle-1 review;
    citation corrected cycle 2).** The house prior art is
    `changeMasterPassword` (`vault-store.js:1310-1426`) — but note
    what it ACTUALLY does: it collects `workingKeys` across the whole
    loop and zeroizes them all in ONE outer `finally` (`:1424`),
    holding 2×N keys live at peak, because its batch-then-one-txn
    shape needs them. `restoreProfile` does NOT mirror that
    mechanism: since ruling 4 writes each vault immediately, the
    policy here is STRICTER — at most one vault key live at a time
    (unwrap → write → zeroize in a per-iteration `finally`), with the
    bundle `mrk` zeroized-unless-installed in the outer `finally`
    (the `_importVault` discipline, extended per ruling 1's
    hand-off). Cite `changeMasterPassword` for the
    zeroize-in-finally + zeroized-unless-installed disciplines, not
    for its collect-array. A mid-loop throw must leave zero live key
    buffers beyond the mrk rule.

## Outputs

- `vault-store.js`: `exportProfile()`, `restoreProfile()`, shared
  adopt/validation helpers, single-flight guard, v2 constants
  (`BUNDLE_VERSION_V2 = 2` or similar beside `:94-95`)
- `jars.js`: `verifyPersisted(id)` (additive read-back)
- Adopt no longer mints admin (single shared core; `_importVault`'s
  fresh branch included); adopt result loses `adminPrivateKeyB64`
- New unit suites (Electron-free): bundle-v2 export/import round-trip,
  restore directives/outcomes/ordering, merge, jar reconciliation,
  adversarial replay, fault injection, gate membership updates
- Pinned-test inversions/rework per DD6
- `docs/vault.md`: bundle v2 format description + the adopt-no-admin
  truth (the workflow/sever/threat-model donor bullet ride leg 3)

## Acceptance Criteria

- [x] `exportProfile()` returns a v2 bundle carrying the global vault
      + every on-disk jar vault, each jar entry with ENCRYPTED
      `{name, color}` jar metadata; a byte-scan of the serialized
      bundle (the `:165` idiom) finds no jar name, no color string, no
      item plaintext; lazy (item-less) jars are absent and the result
      states which vaults were carried; admin pair present iff
      provisioned; gated + unlock-window policy as `exportVault`.
- [x] `restoreProfile()` accepts v1 and v2 (v1 = one-row
      normalization; unknown versions → `VaultFormatError`), runs all
      crypto before any write, and honors every directive:
      existing-jar (replace / merge / collision-refused when
      modeless), new-jar (create → verifyPersisted → write; verify
      failure → `failed`, no vault write), skip, global→global.
- [x] `_readManager` accepts a no-admin v1 manager under the
      optional-but-paired rule (ruling 10): a v1 document with both
      admin fields absent validates and unlocks; a LONE admin field
      (either one) is still malformed at both versions; any existing
      "v1 requires admin" pin is renamed/inverted, never
      silent-edited. A v1-source fresh adopt round-trips through a
      RELOADED store (the restart-shaped pattern,
      `vault-manager-v2.test.js:551-560` idiom): donor master
      unlocks, new recovery key unlocks, admin probe fails with the
      no-admin STATE error.
- [x] Fresh adopt via `restoreProfile`: manager adopted at the
      bundle's managerVersion AFTER the vault loop; forced recovery
      rotation; **NO admin fields in the written manager**
      (`adminPublicKeyB64` absent, `mrk.admin` absent — valid at BOTH
      manager versions per ruling 10); result carries
      `recoveryKeyDisplay` and NO `adminPrivateKeyB64`; profile ends
      unlocked; donor recovery key dead, donor master password ALIVE
      (the DD4 residual, pre-sever).
- [x] `_importVault`'s fresh branch routes through the SAME adopt core
      and equally stops minting admin (its `:1668-1671` block and
      comment are gone); its return shape loses `adminPrivateKeyB64`.
- [x] Jar-id reconciliation pinned: a bundle whose jar slug collides
      with an existing jar lands under the `-N` uniquified id, and
      `results[].destination` maps source → destination explicitly.
- [x] Merge pinned with all three counter classes in one scenario
      (identical id+content, diverged id, disjoint ids), the marked
      copy visible under a fresh id, and zero data loss (every
      pre-merge destination item still present).
- [x] Per-vault atomicity + rerun: an injected mid-list failure leaves
      earlier vaults landed, later untouched, manager ABSENT on fresh
      (isSetUp() false; rerun adopts over the residue) — pinned by a
      fault-injection test on both fresh and existing paths.
- [x] Single-flight guard pinned: concurrent second `restoreProfile`
      → `VaultBusyError`; guard released on success AND on throw.
- [x] Gate membership: both new ops refuse at entry while the re-key
      gate is up and drain like their siblings;
      `vault-rekey-gate.test.js` wording/enumeration updated
      (rename/extend) to the actual op count.
- [x] DD6 pinned-test discipline: the six
      `vault-export-import.test.js` admin assertions renamed/inverted
      (never silent-edited); the two `vault-manager-v2.test.js` adopt
      blocks reworked into no-admin-adopt coverage (adopted manager
      validates under the optional-but-paired rule; a dummy
      well-formed admin key against the adopted profile fails with the
      no-admin STATE error, not auth).
- [x] Adversarial replay (the `vault-key-rotation.test.js` idiom):
      post-adopt, donor recovery key fails auth; dummy admin key fails
      with the no-admin state error; donor master still unlocks.
- [x] `generation` field pinned: two consecutive restores of the same
      bundle produce distinct `generation` values.
- [x] `jars.verifyPersisted(id)` unit-tested directly (present /
      absent / unwritable-store cases); `save()`'s fail-soft behavior
      and every existing jars.js caller unchanged.
- [x] `docs/vault.md` describes bundle v2 + adopt-no-admin.
- [x] Full suite, lint, format green; no new suite exceeds ~10 s
      wall-clock under FAST_SCRYPT (split files if needed; no tagged
      tier).

## Verification Steps

- Run the new suites in isolation with timing
  (`node --test <file>` per project runner conventions) — confirm the
  wall-clock budget.
- `npm test` full suite; lint; `npm run format:check`.
- `grep -n "generateAdminKeypair\|sealToAdmin" src/main/vault/vault-store.js`
  → no hits inside any adopt path (only setup/rotate provision sites
  remain).
- `grep -n "eight" test/unit/vault-rekey-gate.test.js` → no stale
  count.
- Byte-scan assertion present and failing-if-plaintext (temporarily
  plant a plaintext jar name to see it trip, then revert — or assert
  against a known-name fixture).

## Edge Cases

- **v2 bundle with zero jar vaults** (global-only profile): valid,
  one-entry vaults array, no jarMeta anywhere.
- **v2 bundle from a no-admin source**: admin absent throughout;
  adopt/restore fine (v2 optional-but-paired already shipped).
- **Lone jarMeta tamper**: a jarMeta envelope that fails GCM/AAD →
  the store's decrypt helper throws loudly (auth/format) — never a
  silent unnamed jar. Pinned on the HELPER (ruling 2's split:
  `restoreProfile` never reads jarMeta; leg 3's label step is the
  consumer).
- **Mapping references an unknown sourceId / omits a bundle vault**:
  unknown → `VaultStateError` (loud, pre-write); omitted entry =
  implicit skip? NO — require an explicit directive per bundle vault
  (DD2's "every row demands an explicit directive"); a missing one is
  a `VaultStateError` before any write.
- **`newJar` name collides with the RESERVED id space**: `slug()`
  already maps reserved bases to `jar-` prefix — covered, but pin it
  once in the reconciliation test.
- **Duplicate item ids WITHIN one bundle vault**:
  `validateImportedItems` already rejects (uniqueness) — confirm it
  runs on every entry's items in the v2 loop.
- **Restore onto a profile whose default jar changed mid-op**: jar
  registry is main-process singleton, restore is synchronous between
  awaits only at scrypt — the single-flight guard plus gate cover the
  store; registry mutations from the UI mid-restore are the same
  exposure `jars.add` callers have today (out of scope, noted).
- **Fresh adopt where every vault is skipped except one jar vault**:
  legal (lazy global is representable); manager still written, global
  vault file simply absent.

## Files Affected

- `src/main/vault/vault-store.js` — new ops + shared adopt core +
  constants + guard + `_readManager` v1 relaxation (ruling 10) +
  jarMeta helpers
- `src/main/jars.js` — `verifyPersisted`
- `docs/vault.md` — format + adopt sections
- `test/unit/vault-export-import.test.js` — six inversions + v2
  round-trip additions (or a sibling suite for v2)
- `test/unit/vault-manager-v2.test.js` — two-block rework
- `test/unit/vault-rekey-gate.test.js` — count/enumeration update
- `test/unit/` NEW: restore-directives/outcomes suite, merge suite,
  fault-injection suite, jars-verify tests (file split per wall-clock)

---

## Citation Audit

Store citations (`vault-store.js` export/import/adopt/gate sites,
`jars.js` add/save/slug, `vault-txn.js` exports,
`vault-rekey-gate.test.js` counts) read directly from the post-leg-1
working tree 2026-09-02. The six `vault-export-import.test.js` sites
and two `vault-manager-v2.test.js` blocks carry over from the flight
spec's design review (verified against 5eaec48; leg 1 did not modify
either suite) — the design reviewer re-verifies them before
implementation.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry (including suite
      wall-clock numbers — the F2 debrief watch item)
- [x] Set this leg's status to `landed` (in this file's header)
- [x] Do NOT commit — the flight-end review/commit covers all legs
