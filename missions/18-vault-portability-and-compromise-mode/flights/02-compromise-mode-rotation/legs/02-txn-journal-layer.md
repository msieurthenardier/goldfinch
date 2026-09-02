# Leg: Transaction/Journal Layer + Write Exclusivity

**Status**: completed
**Flight**: [Compromise-Mode Rotation](../flight.md)

## Objective

Build the multi-file transaction primitive (journal-first, staged files,
single-rename commit, idempotent load-time recovery) and the write-
exclusivity machinery (re-key gate + in-flight drain + busy errors) that
the compromise-rotation op (leg 3) will run on — fully pinned by a
fault-injection matrix before any consumer exists. No user-facing change
in this leg.

## Context (ground truth after leg 1)

- Leg 1 landed: manager v2 + version threading live; suite at 4024/4024.
- The corrupt-manager exact-listing pin `test/unit/vault-store.test.js:710`
  (`readdirSync === ['manager.json']`) collides with any journal file in
  `vaults/` — re-modeled in THIS leg (leg-1 handoff note, per CP1).
- `writeFileAtomic` (`atomic-write.js:36-82`): temp `dest.tmp-<12hex>` in
  same dir, fsync, rename, best-effort dir fsync; strictly single-file.
- Constructor hook point: path setup (`vault-store.js:320-322`) …
  load-loudly `_readManager` guard (`:364-366`) — recovery runs between them.
- The two write sinks: `_writeManager` (`:463-466`), `_writeVault`
  (`:490-498`). `_withManagerLock` (`:611-622`) serializes the four
  manager ops. Ops outside it that mutate vault files: `saveItem`,
  `deleteItem`, `saveItemPreservingSecrets`, `mintAccessKey`,
  `revokeAccessKey`, `importVault`, `exportVault` (reads manager+vault),
  `deleteVault` (from jar delete, `jar-registry-ipc.js:94-102`,
  fail-closed composition — a busy throw returns
  `{ok:false,'vault-delete-failed'}` and keeps the jar: verified safe at
  flight design review).
- Fault-injection idiom: monkeypatch the shared `node:fs` singleton
  (`test/unit/vault-atomic-write.test.js`, header `:6-10`) — note this
  idiom CANNOT produce in-`writeFileAtomic` kill residue (its own
  cleanup runs); that class is covered by constructing residue states
  directly on disk (flight DD2).

## Scope

1. **Transaction primitive** — new module `src/main/vault/vault-txn.js`
   (Electron-free, deps-injected like the store; keeps `vault-store.js`
   bounded). API shape (final names leg-implementer's choice, semantics
   fixed):
   - `beginTransaction(dir, members)` where members = `[{finalName,
     content}]` → writes the **journal first** via `writeFileAtomic`
     (uncommitted name, e.g. `txn-<id>.journal`), naming every member's
     final and staged name; then writes each staged file **also via
     `writeFileAtomic`** (design-review HIGH: unsynced staged writes
     would allow durable-commit + torn-staged-content after power loss —
     the one mixed state no in-process test can catch; the `.tmp-`
     residue this creates is already sweep-covered). Staged naming
     **disjoint from `.tmp-`**, e.g. `<finalName>.stage-<id>`; committed
     and uncommitted journal names form one recognizable pattern family
     so `recover`'s scan and the defensive check share a single match.
     **Defensive invariant**: `beginTransaction` refuses if any journal
     (either state) already exists; `recover` finding two journals is an
     impossible state and throws loudly rather than guessing. Returns a
     handle.
   - `commit(handle)` → the single atomic journal-state rename
     (uncommitted → committed journal name) — the durable commit point,
     with the same best-effort dir-fsync treatment as `atomic-write.js`
     — then performs the final renames, then removes the journal.
   - `recover(dir)` → idempotent scan run at load: committed journal ⇒
     roll forward (finish renames, ENOENT-tolerant per file, remove
     journal); uncommitted journal ⇒ roll back (delete journal-named
     staged files, ENOENT-tolerant, remove journal); then one bounded
     `readdir` sweep deleting only `writeFileAtomic`-pattern
     `*.tmp-<hex>` orphans. Never reads, parses, or repairs vault
     content. Safe on double-crash (re-run at any point). **ENOENT-
     tolerant on a missing `vaults/` dir** (fresh profile — the dir is
     created lazily; recovery must be a silent no-op there).
     Sweep-concurrency argument, stated: `writeFileAtomic` is fully
     synchronous and recovery runs synchronously in the constructor
     before any store op — in-process concurrent `.tmp-` creation during
     the sweep is impossible; cross-process concurrency is out of scope
     (single app instance).
   - Journal content: plain JSON (txn id, member list) — no secrets, no
     ciphertext.
2. **Store integration (recovery only)**: `VaultStore` constructor calls
   `recover(vaultsDir)` between path setup (`:320-322`) and the
   load-loudly `_readManager` guard (`:364-366`). No store op uses
   `beginTransaction` yet (leg 3 does).
3. **Write exclusivity machinery** in `vault-store.js`:
   - A re-key gate (`_rekeyInProgress`) + in-flight counter. Each of the
     eight gated ops: (a) entry check — throws a new **`VaultBusyError`**
     (exported, distinct message) when the gate is up; (b) holds the
     counter for its full duration, **released in `finally`**
     (design-review: any throw while holding — including a second-wall
     `VaultBusyError` or an ordinary auth error — must not deadlock the
     drain); (c) **the second wall lives inside the write sinks
     themselves** (`_writeVault`, `_writeManager`) rather than at call
     sites — this automatically covers the indirect sink
     `_writeVaultForKey` and every future caller; leg 3's transaction
     writes bypass these sinks, so the rotation never self-blocks.
   - Second-wall coherence notes (design-review): `exportVault` performs
     no writes — it is gated at entry for its **reads** (prevents minting
     a portable bundle of about-to-be-severed credentials mid-rotation
     and guarantees a consistent manager+vault snapshot); `deleteVault`
     mutates via `unlinkSync`, not the sinks — both are fully
     synchronous, so entry-check + drain genuinely suffices for them
     (no await window on a single-threaded loop). Only `mintAccessKey`
     and `importVault` are async — DD3's named mid-await hazards.
   - The four `_withManagerLock` ops do **not** join the counter
     (designer ruling, recorded for leg 3): lock serialization is their
     coverage — leg 3's rotation enters `_withManagerLock` first, then
     raises the gate and drains inside its lock turn, so no manager op
     can interleave; the sink-level second wall covers them incidentally
     regardless.
   - Internal `_acquireRekeyGate()`: raises the gate, **drains** (awaits
     counter === 0), returns a release function. No public consumer yet
     (leg 3); tested directly.
4. **Test re-modeling**: rename/re-model `vault-store.test.js:710`'s
   exact-listing pin to assert "no unexpected files" in a way that
   remains true while recovery may transiently create/remove journal
   files (post-recovery state must still be exactly the expected vault
   files).
5. **Fault-injection + race suites** (new
   `test/unit/vault-txn.test.js` + additions):
   - Kill matrix via fs monkeypatch (throw on Nth `renameSync` /
     `writeSync` / `fsyncSync` / **`unlinkSync`** across a multi-member
     transaction — `unlinkSync` covers crashes in rollback's staged
     deletes and in journal removal) — after each induced failure,
     `recover()` + a fresh `load()` yields a directory that is
     **entirely old or entirely new**, opens with the corresponding
     credentials (drive with real small vault fixtures), and leaves no
     journal, no staged files.
   - Constructed residue states (written directly to disk, no
     monkeypatch): uncommitted journal + zero staged; uncommitted +
     partial staged; **uncommitted + full staged** (crash immediately
     before the commit rename); committed + zero renames done; committed
     + partial renames; **committed + all renames done, journal removal
     crashed** (recovery = clean ENOENT-tolerant no-op roll-forward);
     orphan `.tmp-<hex>` files; a committed journal + staged files
     alongside — sweep must NOT delete staged files named by a committed
     journal (the disjoint-naming pin). Recovery idempotence: run
     `recover()` twice, same result.
   - Race pins: op entered before gate → drain blocks the acquire until
     it finishes; op arriving after gate → `VaultBusyError` at entry; the
     **mid-await interleaving** — a `mintAccessKey` past its entry check
     awaiting scrypt when the gate raises → acquire's drain waits for it;
     after release, a queued op's second-wall re-check throws if the gate
     re-raises; **a gated op that fails mid-flight (e.g. auth error)
     releases the counter in `finally` and a subsequent
     `_acquireRekeyGate()` still drains to zero** (deadlock pin).
     `deleteVault`-busy through the jar-delete composition returns
     `{ok:false}` with the jar kept.

Out of scope: the `compromiseRotate` op itself, any UI, any use of the
transaction by existing ops, journal encoding beyond the semantics above.

## Acceptance Criteria

- [x] AC1: The kill matrix passes at every induced failure point —
      old-or-new, never mixed; correct credentials open the surviving
      state; no stray journal/staged files after recovery.
- [x] AC2: Every constructed residue state recovers deterministically and
      idempotently (double-run identical); the `.tmp-` sweep removes only
      temp-pattern orphans and never a committed transaction's staged
      files.
- [x] AC3: All eight gated ops throw `VaultBusyError` at entry while the
      gate is up; the drain + second-wall race pins pass, including the
      mid-scrypt interleaving; jar-delete composition stays fail-closed
      on busy.
- [x] AC4: `recover()` runs on every store construction; a store with no
      journal present loads exactly as before (zero behavior change —
      full existing suite green).
- [x] AC5: The `:710` listing pin is renamed/re-modeled, not silently
      edited; `npm test` (4024 + new), `typecheck`, `lint`,
      `format:check` all clean.

## Verification

Electron-free harness throughout (temp dirs, FAST_SCRYPT, on-disk byte
probes). AC1 fixtures: a real two-vault profile built via `setup()` +
`saveItem`, transaction members constructed as a full re-wrapped file set
(the leg may hand-build "new state" content via vault-crypto — it does
not need the leg-3 op). AC3's jar-delete case goes through
`jar-registry-ipc`'s handler with a stubbed registry (existing test
idiom).

## Citation Audit (2026-09-01)

Leg-1 handoff notes incorporated (listing-pin collision at `:710` —
drift-checked at implementation since leg 1 added lines elsewhere;
`READABLE_MANAGER_VERSIONS`/`isEnvelopeShaped` available module-local).
Other citations carried from the flight's twice-reviewed DD2/DD3 and the
planning interrogation; `jar-registry-ipc.js:94-102` fail-closed
composition verified at the flight's second design review.
