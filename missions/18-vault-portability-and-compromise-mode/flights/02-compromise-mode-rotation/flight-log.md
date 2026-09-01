# Flight Log: Compromise-Mode Rotation

**Flight**: [flight.md](flight.md)
**Mission**: [Vault Portability & Compromise Mode](../../mission.md)

Execution notes land here. Anomalies land **at occurrence** (Flight 1
debrief rule), not at teardown.

## Planning Notes (2026-09-01)

- Upstream recon skipped with rationale: source artifacts (mission,
  Flight 1 log/debrief) were written 2026-08-31/09-01 and their code
  citations were verified at the Flight 1 debrief against a tree that has
  not changed since (`main` at 83eceac, artifact-only commits).
- Code interrogation report (write sinks, lock coverage, enumeration
  recipe, rotate-recovery wiring, test idioms, format validation) is
  reflected in the spec's DD citations.
- Operator rulings at planning interview: one combined credential sheet
  (supersedes the prototype's two-sheet composition); manager format v2
  with optional admin fields; export omits absent admin + import
  tolerates absence; HAT leg included; **fresh adopt stops minting admin
  keys** (mission criterion 6 amended — extends R5 to restore; Flight 3
  implements; F4 stash-then-chain machinery loses its last consumer).

## Anomalies

*(none yet)*


## Flight Director Notes

- 2026-09-01 — Flight started via /agentic-workflow. Status
  `ready` → `in-flight`; branch `flight/02-compromise-mode-rotation`
  created from `main` (2c5c144). Crew phase file validated (Flight 1).
- **Leg 1 `manager-v2-optional-admin` designed. Risk tier: HIGH** —
  format/lifecycle change on the load path (the store's most conservative
  code), shared-interface change (every unwrap site), pinned-test
  inversions. Design review mandatory per tier and per flight spec.
  Citations pre-verified by the flight's two Architect passes today;
  leg artifact carries its own audit note.
- Leg 1 design review: **approve with changes**, one cycle. Notable:
  the reviewer caught that the CP1 inversion list over-reached — the
  adopt admin-rotation pins (`vault-export-import.test.js:259/:344`)
  stay UNCHANGED this flight (their inversion is Flight 3's); added the
  mixed-version negative fixture (AC3b) pinning DD1's homogeneity rule;
  ruled the no-admin error as `VaultStateError('no admin key
  provisioned')`; `adminPublicKey()` coerces to null with typedef
  updates; BUNDLE_VERSION stays 1 explicitly. Second review cycle
  skipped — all changes were the reviewer's own prescriptions, no new
  design introduced. Leg 1 → `ready`; implementing Developer spawned.
- 2026-09-01 — **Leg 1 `manager-v2-optional-admin` LANDED.** Implemented
  to spec, no deviations:
  - `_readManager` accepts version 1 or 2 (a `READABLE_MANAGER_VERSIONS`
    set; `MANAGER_VERSION` stays 1 and is now used ONLY by `setup`'s
    writes). v1 rules unchanged; v2 requires master+recovery and enforces
    the admin PAIRING rule (present together / absent together; lone
    field → `VaultFormatError`). A shared `isEnvelopeShaped` helper backs
    both the manager's and the bundle's slot validation.
  - Version threading: every manager-envelope unwrap/wrap site now passes
    the DOCUMENT'S stated version (`unlock`, `unlockWithRecovery`,
    `unlockWithAdmin`, all four rotation ops' step-ups and re-wraps,
    `mintAccessKey`, `openAllWithAdminKey`, both import bundle unwraps).
    Single-slot rotations preserve the version they read.
  - Absence readers: `unlockWithAdmin`/`openAllWithAdminKey` on a
    no-admin manager throw `VaultStateError` with the exact ruled message
    `'no admin key provisioned'`; `adminPublicKey()` returns `null`
    coerced (`?? null`), with the three `@returns` typedef updates
    (`vault-store.js`, `vault-context.js`, `automation/mcp-server.js`).
  - Export omits the admin pair when unprovisioned and always stamps
    `managerVersion` (source manager's version); `BUNDLE_FORMAT`/
    `BUNDLE_VERSION` stay v1; stale JSDoc + inline comment rewritten.
  - Import accepts `managerVersion` absent (⇒1) or 1/2, requires
    master+recovery, tolerates the admin pair absent (pairing rule
    enforced), unwraps at the bundle's effective version; fresh adopt
    writes the manager at that version and wraps its minted
    recovery/admin envelopes at the same version (homogeneity with the
    retained donor master envelope). Adopt still mints admin (Flight 3
    changes that, DD8).
  - Pinned tests: `vault-export-import.test.js`'s "all three mrk
    envelopes" export pin renamed/inverted to the new contract
    (master+recovery always; admin-pair-when-provisioned;
    `managerVersion`). The adopt admin-rotation pins (now `:268`/`:353`
    after line drift from the added assertions above them) are textually
    UNTOUCHED and passing. No other test pinned the import three-slot
    loop (verified by grep), so the ":161 + import validation pins"
    inversion list collapsed to the one export pin.
  - New suite `test/unit/vault-manager-v2.test.js` (16 tests) covers the
    AC2–AC5 matrix with hand-constructed v2 fixtures wrapped via
    vault-crypto directly (never a store writer), incl. AC3b's
    mixed-version loud-failure fixture and AC5's on-disk
    version-equals-bundle-managerVersion + per-slot direct-AAD-unwrap
    homogeneity probes.
  - Verification: **before 4008 / after 4024 tests, all passing** (16
    added, 0 removed, 1 renamed); `npm test` 4024 pass / 0 fail,
    `npm run typecheck` clean, `npm run lint` clean, `npm run
    format:check` clean.
  - Note for the `txn-journal-layer` leg: the corrupt-manager
    exact-directory-listing pin (`vault-store.test.js:710`,
    `readdirSync === ['manager.json']`) is untouched this leg and WILL
    collide with any journal file coexisting in `vaults/` — re-model it
    there, per CP1's note.
- **Leg 2 `txn-journal-layer` designed. Risk tier: HIGH** — new
  load-path behavior (recovery scan on every construction), crash-safety
  machinery, shared write-path gating across eight ops, test
  re-modeling. Design review mandatory. Leg-1 handoff notes (listing-pin
  collision, module-local helpers, version-as-live-data) folded into the
  leg's Context. legs_completed: 1 of 5.
- Leg 2 design review: **approve with changes**, one cycle. HIGH catch:
  staged files must also go through `writeFileAtomic` — unsynced staged
  writes would permit durable-commit + torn-staged-content after power
  loss, undetectable by any in-process test. Also folded in: `unlinkSync`
  in the kill matrix + two explicit residue states (journal-removal
  crash; full-staged pre-commit); finally-release + deadlock pin;
  second wall moved INTO the write sinks (covers `_writeVaultForKey`
  automatically; txn writes bypass sinks so no self-block);
  exportVault-gating rationale stated; defensive one-journal invariant;
  fresh-profile ENOENT tolerance; citation refreshes. Designer ruling
  recorded for leg 3: rotation enters `_withManagerLock` first, then
  raises gate + drains inside its lock turn; manager ops rely on lock
  serialization, not the counter. Second cycle skipped — reviewer
  prescriptions plus one recorded designer ruling, no contested design.
  Leg 2 → `ready`; implementing Developer spawned.
- 2026-09-01 — **Leg 2 `txn-journal-layer` LANDED.** Implemented to spec,
  no deviations; no anomalies during implementation.
  - **Transaction primitive** — new `src/main/vault/vault-txn.js`
    (Electron-free, `node:fs`/`path`/`crypto` + `atomic-write` only).
    Name family: `txn-<12hex>.journal` (uncommitted) /
    `txn-<12hex>.journal.committed` (committed) — one `JOURNAL_RE`
    backing both `recover`'s scan and `beginTransaction`'s defensive
    check — and staged `<finalName>.stage-<12hex>`, disjoint from the
    `.tmp-<12hex>` atomic-write temp pattern. `beginTransaction(dir,
    members)` writes the journal FIRST, then every staged file, all via
    `writeFileAtomic` (the design review's HIGH); refuses if any journal
    (either state) exists; validates member names against the name
    family and path separators. `commit(handle)` performs the single
    atomic journal-state rename (best-effort dir fsync, the
    atomic-write treatment), the final renames, then journal removal.
    `recover(dir)` rolls forward (committed) / back (uncommitted),
    per-file ENOENT-tolerant, ENOENT-tolerant on a missing `vaults/`
    (fresh profile), idempotent, throws loudly (`VaultTxnError`) on the
    impossible two-journal state or a malformed journal, then sweeps
    only `*.tmp-<12hex>` orphans in one bounded readdir. Journal
    content: plain JSON `{format, version, id, members:[{finalName,
    stagedName}]}` — no secrets, no ciphertext (byte-probed by test).
  - **Store integration (recovery only)**: the `VaultStore` constructor
    calls `vtxn.recover(this.vaultsDir)` between path setup and the
    load-loudly `_readManager` guard. No store op uses the transaction
    yet (leg 3).
  - **Write exclusivity** in `vault-store.js`: exported
    `VaultBusyError`; `_rekeyInProgress` gate + `_inFlightOps` counter +
    `_drainWaiters`; `_enterGatedOp()` (entry check + counter hold,
    release-in-`finally`, idempotent release, nested holds counted);
    `_acquireRekeyGate()` (busy if already raised, raises then drains to
    zero, returns idempotent release). The eight gated ops (`saveItem`,
    `deleteItem`, `saveItemPreservingSecrets`, `mintAccessKey`,
    `revokeAccessKey`, `importVault`, `exportVault`, `deleteVault`) are
    thin gated wrappers over renamed `_`-inner bodies (bodies textually
    unchanged). The SECOND WALL lives inside `_writeManager` /
    `_writeVault` (covers `_writeVaultForKey` and future callers; leg
    3's txn writes bypass the sinks so the rotation never self-blocks).
    The four `_withManagerLock` ops do not join the counter (designer
    ruling, recorded).
  - **Test re-model**: `vault-store.test.js`'s corrupt-manager
    exact-listing pin (`readdirSync === ['manager.json']`, was `:710`)
    renamed to "…and no unexpected files appear" and re-modeled to a
    no-unexpected-files assertion (+ explicit manager-present +
    byte-unchanged probes) — rename/re-model, not a silent edit.
  - **New suites**: `test/unit/vault-txn.test.js` (22 tests) — API
    semantics (journal-first order pin via recorded renames;
    every-write-via-writeFileAtomic pin; journal-content no-secrets
    pin; validation; one-journal invariants; missing-dir no-op), the
    kill matrix (renameSync ×8, writeSync ×4, fsyncSync ×10, unlinkSync
    ×1 — every Nth call, real two-vault fixtures, hand-built re-wrapped
    NEW state via vault-crypto, entirely-old-or-entirely-new byte
    assertions + credential opens + per-syscall commit-discriminator
    outcome checks), six constructed residue states + the `.tmp` sweep
    near-miss pin + the disjoint-naming pin, double-crash matrices
    (recover itself killed at every unlinkSync of rollback / renameSync
    of roll-forward, re-run), recovery idempotence everywhere, and both
    constructor-recovery integration pins (AC4).
    `test/unit/vault-rekey-gate.test.js` (6 tests) — all-eight entry
    wall, direct sink second wall, the mid-scrypt interleaving (deferred
    `unwrapMaster` monkeypatch: drain blocks the acquire, late op busy
    at entry, resumed mint refused at the sink, counter drains, no
    write persisted), the re-raise cycle, the deadlock pin (auth-failed
    mint + failed import release their holds; acquire drains under a
    hard fail-fast timeout), and the sync-op coherence pin. One
    addition to `test/unit/jar-registry-ipc.test.js`: jar delete during
    a raised gate through the real handler + real store →
    `{ok:false, error:'vault-delete-failed'}`, jar and vault kept,
    retry succeeds after release.
  - Verification: **before 4024 / after 4053 tests, all passing** (29
    added, 0 removed, 1 renamed/re-modeled); `npm test` 4053 pass /
    0 fail, `npm run typecheck` clean, `npm run lint` clean,
    `npm run format:check` clean.
  - Handoff for `compromise-rotate-op` (leg 3): consume
    `require('./vault-txn')`'s **`beginTransaction(dir, members)`**
    (members `[{finalName, content}]`, returns a handle) and
    **`commit(handle)`**; acquire exclusivity via
    **`store._acquireRekeyGate()`** (async, returns an idempotent
    release fn) INSIDE the rotation's `_withManagerLock` turn, release
    in `finally`. Member names must be plain basenames outside the
    txn/stage/tmp name family (`manager.json` / `<id>.gfvault` are
    fine). `VaultBusyError` is exported from `vault-store`;
    `VaultTxnError` + the name-family helpers
    (`uncommittedJournalName`/`committedJournalName`/`stagedName`) from
    `vault-txn`. Remember `_ensureVaultsDir()` before beginning a
    transaction, and that the rotation's writes must go through the
    transaction — the sinks' second wall refuses while the gate is up.
- **Leg 3 `compromise-rotate-op` designed. Risk tier: HIGH** — the
  security-critical core: new store op minting/severing the whole key
  hierarchy, first v2 writer, first transaction consumer, lifecycle
  change (ends unlocked from any entry state). Design review mandatory.
  Leg-2 handoff API quoted verbatim into the leg's Context; new exported
  `VaultPasswordReuseError` named for leg 4's sheet mapping.
  legs_completed: 2 of 5.
- Leg 3 design review: **approve with changes**, one cycle. HIGH catch:
  in-process commit failure AFTER the discriminator rename was
  unhandled — disk durably rotated while the op rethrew ("nothing
  changed" over a rotated profile, one-time recovery key lost). Fixed:
  the catch branches on the txn handle's `committed` flag — committed ⇒
  finish roll-forward, install, return success; uncommitted ⇒ rollback,
  rethrow. Designer rulings on the review's three questions: (Q1)
  report field is `vaultIds` (global vault can carry access keys);
  (Q2) KDF params: preserve `manager.kdf`, never the constant — the
  existing rotation idiom, correct for adopted profiles; (Q3)
  enumeration is the registry∪disk union — unknown `.gfvault` that
  unwraps under the old MRK is rotated, one that doesn't fails the
  rotation loudly pre-commit. Also folded in: pre-rotation-bundle
  out-of-sever-scope pins (feeds the threat-model doc), corrupt-vault
  clean-failure rows, old-vault-key negative, double-rotate pin,
  zero-jar row, zeroization ownership clarifications, Buffer.equals
  justification + check order, parseRecoveryKey error-class note for
  leg 4. Reviewer verified: no drain deadlock (no gated op takes the
  manager lock), sink bypass real, onUnlock-from-install safe. Second
  cycle skipped — prescriptions + recorded rulings. Leg 3 → `ready`;
  implementing Developer spawned.
- 2026-09-01 — **Leg 3 `compromise-rotate-op` LANDED.** Implemented to
  spec; no anomalies during implementation; two recorded deviations
  (both interpretive, neither a design change — below).
  - **`compromiseRotate(args)`** on `VaultStore` (after
    `recoverMasterPassword`, its own section). Signature:
    `{ oldMasterPassword?, recoveryKey?, newMasterPassword }`
    (master branch = old+new, string|Buffer per the store's
    `isNonEmptySecret` idiom; recovery branch = display string + new;
    supplying both branches is a `VaultStateError`; requires
    `isSetUp()`). Returns `{ recoveryKey: <one-time display>,
    revoked: { admin: <bool>, vaultIds: [<ids that carried ≥1 access
    envelope>] } }` — `vaultIds` per the Q1 ruling (GLOBAL_ID can
    appear). Runs inside `_withManagerLock`; gate acquired AFTER the
    credential validates (fail cheap before drain), released in
    `finally`.
  - R7 exactly as ruled: master branch does `Buffer.equals`
    byte-equality FIRST (helper `secretsEqual`, with the
    timing-safety-not-required justification comment) then the scrypt
    step-up; recovery branch unwraps via the recovery envelope then
    TEST-unwraps the old master envelope with the candidate — success
    ⇒ zeroize probe MRK + throw; `VaultAuthError` from that specific
    call swallowed as not-a-reuse, anything else propagates. New
    exported **`VaultPasswordReuseError`** (plain Error subclass,
    discriminable from `VaultAuthError`). Malformed display →
    `VaultFormatError` from `parseRecoveryKey` (pinned).
  - Enumeration = registry recipe (GLOBAL + `listJars()` minus
    'global' impostors, null-skip) ∪ `readdir` of `*.gfvault` (Q3):
    an unregistered vault unwrapping under the old MRK is rotated
    (pinned); a corrupt (`VaultFormatError`) or un-unwrappable
    (`VaultAuthError`) file fails the rotation loudly pre-commit,
    disk byte-identical, store usable after (pinned, one row each).
    Direct `_readVault`-level reads only — no gated op is called
    internally.
  - Rebuild: fresh MRK + fresh key per vault; each rebuilt `.gfvault`
    carries EXACTLY ONE (mrk) envelope at the doc's own AAD version,
    `kdf: doc.kdf` preserved. New manager at `version: 2` (new
    module constant `MANAGER_VERSION_V2`; `READABLE_MANAGER_VERSIONS`
    now derives from both constants), NO admin fields,
    `kdf: manager.kdf` preserved (Q2). One transaction:
    `manager.json` + every rebuilt vault via
    `beginTransaction`/`commit`; catch branches on the handle's
    `committed` flag — uncommitted ⇒ `recover()` + rethrow;
    committed ⇒ `recover()` (roll-forward) then proceed to
    `_installMrk` + normal return (the review HIGH — pinned two ways:
    throw at the first final rename, and persistent journal-unlink
    failure).
  - Post-commit `_installMrk(newMrk)` — ends unlocked from both entry
    states, `onUnlock` fired once (pinned both states). Zeroization:
    old MRK + every old/new vault-key working buffer in `finally`;
    `newMrk` owned by `_installMrk` on success / the `finally` on
    uncommitted failure; caller password buffers never touched.
  - **Deviation 1 (zeroization wording):** the leg's "decrypted item
    plaintext … zeroized in `finally`" cannot be implemented
    literally — `decryptItems` returns parsed JS objects (the only
    plaintext form at this layer; the intermediate Buffer is internal
    to vault-crypto), and JS objects cannot be filled. The items are
    scoped per loop iteration and released immediately (same exposure
    class as every `listItems` call); documented in an inline
    comment. No design change — a physical constraint of the
    existing crypto API.
  - **Deviation 2 (committed-branch recover hardening):** the ruled
    committed branch runs `recover()` then proceeds; the leg does not
    say what to do if that recover ITSELF throws (e.g. the journal
    unlink keeps failing). Rethrowing would violate the ruling's own
    rationale ("nothing changed" over a durably rotated disk), so the
    committed-branch `recover()` is wrapped best-effort — a failure
    is swallowed and the idempotent constructor recovery at next load
    is the backstop. Pinned by the persistent-unlink test row, which
    also realizes the leg's "journal removal after all renames →
    committed-journal no-op roll-forward at next load" kill point
    (unreachable by a throw-once monkeypatch, since the op's own
    in-catch recovery otherwise cleans it up).
  - **New suite `test/unit/vault-compromise-rotate.test.js` (26
    tests)** — every Scope-3 row: full sever (all captured
    credentials/materials fail incl. raw-MRK and raw-vault-key GCM
    probes; snapshotted old files still open — capture validity;
    items identical; ciphertext byte-different; v2 no-admin manager,
    kdf preserved), report correctness (none case + GLOBAL_ID pin),
    out-of-sever-scope bundle pins (pre-rotation bundle adopts fresh
    AND imports into the rotated profile — feeds CP5's threat-model
    bullet), corrupt/foreign/union rows, old-vault-key negative,
    double-rotate (queued on the manager lock; old credential fails
    post-release; fresh-credential re-rotate of the v2 no-admin
    profile: admin stays absent, `revoked.admin` false), minimal
    zero-jar profile, R7 matrix (both branches + wrong credentials
    byte-identical disk + malformed display), busy/exclusivity (gated
    ops refused inside the gate window via a parked `wrapMaster`;
    rotation on a raised gate busy), the interruption matrix
    (renameSync ×8 / writeSync ×4 / fsyncSync ×10 / unlinkSync ×1 —
    op outcome ⇔ disk state: rejected ⇒ byte-identical old +
    old-credentials open; resolved ⇒ v2 + rotated ciphertext + new
    master and returned recovery key open + old master severed; no
    residue; gate/counter released; per-family
    rollback/roll-forward sanity), the two post-discriminator
    success pins, the pre-commit in-process-throw usable-store row,
    and the lock-state matrix. Note: the leg's "fresh `load()` +
    `recover` yields entirely-old/new" is asserted in its stronger
    op-level form — the op's in-process discrimination already
    recovers before returning, so the matrix pins op-outcome ⇔
    disk-state and then fresh-load credential checks on top.
  - Verification: **before 4053 / after 4079 tests, all passing** (26
    added, 0 removed, 0 modified — the leg was purely additive to
    tests as specified); `npm test` 4079 pass / 0 fail,
    `npm run typecheck` clean, `npm run lint` clean,
    `npm run format:check` clean.
  - Handoff for `flow-wiring` (leg 4): call
    **`store.compromiseRotate(args)`** — async, master branch
    `{ oldMasterPassword, newMasterPassword }` (Buffers from the
    sheet; strings also accepted), recovery branch
    `{ recoveryKey: <display string>, newMasterPassword }`; never
    both. Resolves `{ recoveryKey: string, revoked: { admin:
    boolean, vaultIds: string[] } }` — surface `recoveryKey` once
    (never persisted; render `vaultIds` rows incl. a possible
    `'global'` with its display label). Error mapping:
    **`VaultPasswordReuseError`** (new export from vault-store) →
    the ruled inline copy; `VaultAuthError` → wrong credential;
    `VaultFormatError` → malformed recovery display (also
    corrupt-vault integrity failures); `VaultBusyError` → rotation
    already in progress; `VaultStateError` → argument/not-set-up.
    Every PRE-COMMIT failure leaves disk + live state untouched and
    the store immediately usable ("nothing changed; your existing
    keys remain valid" is truthful); once the op RESOLVES the
    rotation is durable and the profile is UNLOCKED (`onUnlock`
    fired from `_installMrk` — the vault-state broadcast will have
    fired BEFORE the promise resolves). Timing: two scrypt derives
    (step-up + new wrap; recovery branch also runs a probe derive)
    plus per-vault AES work — an interactive-latency await at
    production params, so the sheet needs its pending state. The op
    does NOT zeroize the caller's password buffers — the sheet
    handler owns them (`changeMasterPassword` idiom). Do not wrap
    the call in any gated op; it takes the manager lock + re-key
    gate itself.
- 2026-09-01 — Leg 3 deviations ACCEPTED by Flight Director: (1)
  item-plaintext zeroization scoped per loop iteration (decryptItems
  returns parsed objects; the intermediate Buffer is internal to
  vault-crypto) — documented inline; (2) committed-branch recover() is
  best-effort with the constructor-recovery backstop, pinned by the
  persistent-unlink test — rethrowing would violate the ruling's own
  rationale. Neither is a design change. legs_completed: 3 of 5.
- **Leg 4 `flow-wiring` designed. Risk tier: HIGH** (spec said MED-HIGH;
  tiered up per when-in-doubt: it migrates the lockout-critical
  suppression discipline for BOTH flows, adds secret-handling IPC
  handlers, and re-models security-relevant pins). Design review
  spawned.
- Leg 4 design review: **approve with changes**, one cycle. Two HIGHs:
  (H1) the recovery-show ack branch needed explicit cross-flow
  discrimination — per-window compromise marker consumed only-if-
  present, exact (chromeId, reason) holder release, four ack-kind tests;
  (H2, designer ruling) window-close during the pending op — RULED
  hold-and-resurface: reveal+report stashed and hold acquired BEFORE
  any sheet interaction, null-guarded window path, resurface on next
  chrome boot; app-quit loses the reveal — accepted documented residual
  (not a lockout: operator knows the new master and can re-mint).
  Q2 ruled: both-reveals-one-window unreachable (dismiss-locked sheet
  blocks the page); ack checks adopt marker first anyway. Mediums:
  branch switch is close-then-reopen via sendActivated (no in-sheet
  swap idiom exists; model-replace would ride the 'superseded' clobber);
  holder extracted to a new unit-testable module (main.js untestable by
  pin); completion trigger = re-broadcast vault-lock-state; AC4 DOM
  pins reassigned to leg 5's behavior test. Second cycle skipped —
  prescriptions + two recorded rulings. Leg 4 → `ready`; implementing
  Developer spawned. legs_completed: 3 of 5.
- 2026-09-01 — **Leg 4 `flow-wiring` LANDED.** Implemented to spec; no
  anomalies during implementation; four recorded deviations (all
  interpretive/additive — below). Shipped:
  - **Page entry + R3 confirm modal** (`vault.js`/`.css`): the R2 row
    (explainer "Think a key or your master password leaked?" + danger
    "Rotate Everything…") in BOTH lock states at the ruled positions
    (unlocked: bottom of Master-key management; locked: below Auto-lock,
    per the R4 amendment); the confirm modal carries the leg's verbatim
    R3 copy with the understanding-checkbox gating a danger Continue;
    Continue closes the modal and fires the new bare trigger chain
    (`bridge.requestCompromiseRotate()` → `internal-vault-request-compromise`
    → `vault-request-compromise` → chrome opens `vault-compromise`).
  - **Compromise sheets**: two new menuTypes — `vault-compromise`
    (change-master shape + "Use your recovery key instead" switch) and
    `vault-compromise-recover` (recover shape) — built by the new shared
    `vault-compromise-template.js`, submit "Rotate everything"
    (danger-styled), aria-live PENDING state ("Rotating everything —
    this can take a moment.", fields+submit+switch disabled,
    Cancel/Escape live per L1/L2). Branch switch is the ruled M1
    close-then-reopen: channel-4 `{id:'use-recovery'}` → main closes
    ('activated') → chrome `handleActivation` gains a `vault-compromise`
    case reopening the recover variant — never a model replace. Both
    joined EVERY named registry: menu-overlay TEMPLATES map + JSDoc
    union + NODE_OF_ENTRY + dispatch, vault-controller overlayStates +
    two `openVault*ForAudit` hooks, a11y-audit SHEET_STATES (+2),
    seam-contract SEAM_COUNT 34 → 36 with the renderer seam block +
    CLAUDE.md dual-source notes updated in lockstep, and the automation
    allowlist admits nothing new (docs enumeration extended).
  - **Overlay IPC** (`register-overlay-ipc.js`): `menu-overlay:vault-compromise`
    + `:vault-compromise-recover`, injection-gated, full discipline
    (recordForSheetSender, open-token, `Uint8Array` checks, Buffer
    copies, dual-zeroize ×4 in finally) PLUS an explicit menuType
    predicate (deviation 3). **H2 success ordering implemented exactly**:
    chromeId captured pre-await; on resolution main FIRST stashes the
    reveal + report and acquires the holder (one atomic
    `stashCompromiseReveal`), THEN null-guards `rec.sheet`/`rec.win` —
    window alive → close ('activated', stale-token no-op if dismissed
    mid-op) + `vault-recovery-show {recoveryKey, replacing:true}`;
    window gone → reveal stays pending and **re-surfaces on the next
    chrome boot** via a new optional `onChromeBooted` hook in
    app-lifecycle's `window-boot-config` handler (fires after the
    queued-send flush; main re-keys the orphaned reveal + its hold to
    the new window and re-opens the sheet). **H1 ack discrimination**:
    the recovery-show activated branch checks the adopt marker FIRST,
    then `ackCompromiseReveal` consumes this window's compromise marker
    only-if-present — exact `(chromeId,'compromise')` release — then
    the M3 completion trigger (re-broadcast `vault-lock-state`; chrome
    handlers verified inert on the duplicate unlocked state — the
    indicator re-render is idempotent and both continuation guards are
    phase/null-gated). `main.js` delegate maps all five leg-3 error
    classes to non-secret reasons ('reuse'/'auth'/'format'/'busy'/'state'),
    rethrows unknowns.
  - **Suppression holder (DD5)**: NEW module
    `src/main/vault/autolock-suppression.js` —
    `acquire/release(chromeId, reason)` + `releaseWindow`, store flag =
    holders > 0, transition-only pushes (never force-constructs the
    store on an unrelated close). Adopt flow MIGRATED onto it (stash →
    acquire 'adopt'; take/clear → exact release; adopt logic otherwise
    untouched). Window-factory close hook re-modeled:
    `clearPendingAdoptAdminKey` → `releaseVaultHoldsForWindow` (drops
    the adopt key + releases ALL of that window's holds; a pending
    compromise reveal deliberately survives for the H2 resurface). NEW
    module `src/main/vault/pending-compromise-reveals.js` — the
    per-window reveal store (stash/ack/rekey), holder-coupled so the
    hold moves atomically with the record.
  - **Completion state + card (DD6)**: `internal-vault-state` gains the
    additive `adminProvisioned` (derived `store.adminPublicKey() !== null`,
    setUp-guarded + try/caught non-throwing) and `compromiseReport`
    (main-side in-memory for the app session, set at op resolution so
    the card renders from the next state fetch regardless of the
    broadcast). New bare dismiss channel
    `internal-vault-compromise-dismiss` (internal-vault-lock idiom,
    `{ok:true}`, injection-gated). Page renders the R8 card — title
    "Everything rotated", the Flight-1 ruled body copy, "Revoked keys"
    with uniform "— Revoked" hints (Admin key first, then per-vault
    display labels incl. Global), Dismiss → clear + refresh — in BOTH
    view states; `selectVaultView` normalizes + carries both fields
    (locked AND unlocked; dropped for not-set-up). Master-key kebab
    renders "Provision admin key" when unprovisioned (relabeled state,
    existing action).
  - **Tests**: before **4079 / after 4112, all passing** (+33 added, 0
    removed, 4 renamed/re-modeled — the 0051 window-factory suppression
    pins, now fake-delegating over the REAL holder and pinning the DD5
    cross-flow case). New `autolock-suppression.test.js` (7: refcount,
    idempotent-pair, exact-pair release, cross-flow interleaving both
    orders, window-close scoping, transition-only pushes, inert
    inputs); new `vault-compromise-handlers.test.js` (12: gating, both
    handlers' discipline + reason pass-through incl. 'reuse' + unknown-
    rejection zeroize, the H2 stash-before-sheet ordering pin, the
    null-guarded window-gone path + resurface re-key (hold moves with
    the reveal), and the FOUR ack kinds — setup/rotate no-op,
    adopt-only, compromise-only, both-flows-different-windows with the
    suppression-never-dips pin); register-vault-ipc +7 (state fields,
    non-throwing degradation, report in both lock states, dismiss
    gating/clear/forbidden); vault-request-triggers +2;
    vault-page-model +4 (the R4/R8 model-level lock-state matrix +
    report normalization); app-lifecycle +1 (onChromeBooted placement
    after the queued-send flush).
  - **Docs** (`docs/vault.md`): Rotation & recovery gains the
    compromise-mode section (what it rotates, required new master,
    single post-commit reveal, revocation card, v2 manager result, busy
    semantics, the sever-scope and app-quit residual); the threat-model
    "already-extracted MRK" bullet now carries its answer + the two
    stated bounds; on-disk format documents manager v2 optional-admin +
    the pairing/homogeneity rules; Portability's bundle list corrected
    to leg 1's shipped contract (admin pair conditional,
    `managerVersion`); the two "compromise-mode backlog" residuals
    reworded; the never-readable sheet enumeration gains the two new
    menuTypes. No new commands (CLAUDE.md touched ONLY for the
    lockstep-pinned seam-count/line-budget dual-source notes).
  - **Deviation 1 (error-state reading)**: scope 2's "unexpected/
    pre-commit failure: sheet closes to an error state" is implemented
    as the sheet TRANSITIONING to an inline error state (pending
    cleared, DD5's ruled copy shown, sheet stays open for Cancel) —
    closing outright would leave the ruled copy with no visible surface
    (chrome toasts are architecturally invisible behind the guest view,
    the M15 H5 finding). Presentation-level interpretation, not a
    design change.
  - **Deviation 2 ('format' mapping split per branch)**: recover branch
    → the wrong-key idiom ("Wrong recovery key. Nothing was changed." —
    a malformed display reads as a mistyped key; the leg's "existing
    message idioms"); master branch → DD5's pre-commit copy (there is
    no display to malform there — a 'format' is an integrity anomaly).
  - **Deviation 3 (menuType predicate)**: both compromise submit
    handlers gate on `current.menuType` in addition to sender/token —
    the M15 F3 named-predicates discipline, applied because this
    channel triggers a destructive whole-hierarchy re-key (sibling
    rotation handlers don't carry it; additive hardening, pinned).
  - **Deviation 4 (budget/count bumps)**: RENDERER_LINE_BUDGET
    1828 → 1835 (+7, the minimum per-sheet seam footprint) and
    SEAM_COUNT 34 → 36, each with its CLAUDE.md dual-source note
    updated in the same change per the pinned lockstep rule — extended
    with documentation, never silently edited.
  - Verification: `npm test` 4112 pass / 0 fail, `npm run typecheck`
    clean, `npm run lint` clean, `npm run format:check` clean.
  - **Handoff for `behavior-spec-and-hat` (leg 5)** — exact shipped
    surfaces for the spec finalization:
    - Entry row: explainer "Think a key or your master password
      leaked?"; button "Rotate Everything…" (`.vault-btn.danger`).
      Placement: unlocked → bottom of the Master-key management
      subsection; locked → below the Auto-lock block.
    - Confirm modal (page DOM, MCP-drivable): title "Rotate
      everything"; lede "This creates fresh keys for your vault and
      locks out anyone who may have your old ones. Everything you've
      saved is kept."; steps under "What happens next": "Enter your
      current master password." / "Choose a new master password." /
      "Save the new recovery key — it's shown once."; consequence
      "Your admin key and all jar access keys will be revoked. You'll
      create new ones afterward."; checkbox "I understand my old keys
      will stop working" gating danger "Continue" (starts disabled).
    - Sheets (operator-attested): menuTypes `vault-compromise` /
      `vault-compromise-recover` (node ids `#sheet-vault-compromise`,
      `#sheet-vault-compromise-recover`); both headings "Rotate
      everything"; submit "Rotate everything"; switch link "Use your
      recovery key instead" (master sheet only); field labels "Current
      master password" / "Recovery key" / "New master password" /
      "Confirm new master password"; pending note "Rotating everything
      — this can take a moment." (Cancel stays enabled). Inline errors:
      reuse "Your new master password must be different from your old
      one."; wrong master "Wrong current master password. Nothing was
      changed."; wrong/malformed recovery key "Wrong recovery key.
      Nothing was changed."; busy "A rotation is already in
      progress."; unexpected "Nothing changed; your existing keys
      remain valid."
    - Recovery reveal: the EXISTING `vault-recovery-show` dismiss-locked
      sheet with `replacing: true` (the "replaces your previous key"
      line shows), opened post-commit; its ack fires the completion
      broadcast (a `vault-lock-state` re-broadcast).
    - Card: `role="status"`, `.vault-compromise-card`; title
      "Everything rotated"; body "Fresh keys are in place, and your new
      recovery key was shown once on the secure prompt. Your old master
      password, recovery key, and admin key no longer work."; subtitle
      "Revoked keys"; rows "<label> — Revoked" (Admin key first, then
      vault display labels; global renders as "Global"); "Dismiss"
      button. Renders in both view states; unlocked placement is
      between Import/Export and Master-key management.
    - Dismiss channel: `internal-vault-compromise-dismiss`
      (`bridge.compromiseDismiss()`); state fields:
      `adminProvisioned`, `compromiseReport {admin, vaultIds}` on
      `internal-vault-state`. Kebab label when unprovisioned:
      "Provision admin key".
    - Resurface behavior: window dies mid-op or with the reveal
      unacked → reveal re-keys and the recovery-show sheet re-opens on
      the NEXT chrome boot (`window-boot-config` served); app-quit
      with a pending reveal loses it (documented residual). The
      dev-profile restore prerequisite (DEV_MINT once) is still
      pending from the flight spec.
- 2026-09-01 — Leg 4 deviations ACCEPTED by Flight Director (all four
  are existing-discipline applications, not design changes: in-sheet
  inline error over invisible toasts; per-branch 'format' error mapping;
  menuType predicate per M15 F3; budget/seam-count extensions with
  lockstep CLAUDE.md updates). **All autonomous legs complete (4 of 5).
  Phase 2d: flight-end Reviewer spawned over the full uncommitted diff**
  (legs 1–4; suite 4008 → 4112).
- 2026-09-01 — **Flight-end review: [HANDOFF:confirmed], zero blocking
  findings.** Reviewer independently ran the battery (4112/4112,
  typecheck/lint/format clean) and spot-verified every load-bearing AC
  against the diff. Non-blocking tidies applied by FD at Reviewer
  direction: CLAUDE.md:305 sheet-family count Eleven→Twelve (+
  `compromise` in the list; prettier clean), leg 3/4 AC checkboxes
  ticked. Legs 1–4 → `completed`. Committing the flight and opening the
  draft PR; leg 5 (behavior test + HAT) remains.
