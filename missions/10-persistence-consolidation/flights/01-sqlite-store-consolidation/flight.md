# Flight: SQLite Store Consolidation

**Status**: landed
**Mission**: [Persistence Consolidation](../../mission.md)

## Contributing to Criteria

- [x] All five config/state surfaces persist through the same durable storage
      substrate as browsing history, surviving upgrade with no data loss
      (one-time automatic migration).
- [x] Missing/corrupt store database → app still boots to a usable state with
      defaults (quarantine-and-recreate).
- [x] Every persisted store Electron-free, dependency-injected, offline
      unit-tested — including shields, brought up to discipline.
- [x] DD1 re-affirmed for the widened footprint; docs current (`CLAUDE.md`
      store sections, BACKLOG seed retired).
- [x] `safeStorage` codec seam survives the migration.

---

## Pre-Flight

### Objective

Move the five JSON-file stores (`settings-store.js`, `shields.js`, `jars.js`,
`downloads-store.js`, `session-store.js`) off standalone `userData/*.json`
files and onto the `node:sqlite` substrate, behind a new Electron-free
`app-db.js` module cloned from the history-store's proven seams
(WAL, `user_version`, quarantine-and-recreate, injected path). Existing
profiles migrate automatically on first boot with nothing lost; the old JSON
files are renamed `.migrated`; store public APIs, validation logic, and codec
seams are preserved so callers and most tests don't change. Shields — the one
store below house discipline — is reworked to match. Docs and BACKLOG are
brought current, with the DD1 substrate ruling explicitly re-affirmed.

### Open Questions

- [x] One DB or two? → DD2 (separate `app.db`).
- [x] Table shape: KV documents vs per-store tables? → DD3 (single
      `documents` table, one row per store).
- [x] Old JSON files after migration: leave vs rename? → DD5 (rename to
      `.migrated`).
- [x] Quarantine recovery: re-import `.migrated` after corruption? → DD6 (no
      — fresh defaults, parity with history precedent).
- [x] Who opens/closes `app.db`, and where in the boot/quit sequence? → DD7.
- [x] Shields signature/discipline changes? → DD8.
- [x] `initProfileAndStores` pin tests? → DD9.
- [x] Downloads per-record table now? → DD3 trade-off (deliberately deferred
      with the out-of-scope in-progress rider).

### Design Decisions

**DD1 — Substrate re-affirmation: built-in `node:sqlite` for the widened
footprint.** The M08 ruling (M08 F1 DD1) extends from one store to the whole
persistence layer: Node's built-in `node:sqlite` (`DatabaseSync`), no vendored
native module.
- Rationale: zero-runtime-dependency identity preserved; the Architect's
  mission-design probe verified Electron 42.6.1's bundled Node is **24.18**
  and `node:sqlite` loads unflagged there (stronger than the BACKLOG's stale
  "≥ 22.12" note, corrected this flight).
- The standing tax, restated for the wider footprint: `node:sqlite` is
  experimental; every future Electron major bump re-runs **all** store suites
  (`history-store` + the new `app-db`/store suites) and treats an API break
  as a first-class migration cost — now blocking the whole persistence layer,
  not just history. Named and accepted.
- Fallback unchanged (vendored `better-sqlite3` on a hard blocker — a
  mission-level decision, not flight-level).

**DD2 — Separate `app.db`, not tables folded into `history.db`.**
- Rationale: blast-radius isolation — a corrupt history DB quarantines
  history alone and config survives, and vice versa; the write-hot,
  high-cardinality visits table stays isolated from small config rows; each
  DB keeps its own independent `user_version` migration ladder.
- Trade-off: a second WAL file family (`app.db` / `-wal` / `-shm`) in
  `userData` and a second `close()` call in the quit sequence. Accepted.

**DD3 — One `documents` table; each store persists as a single serialized
row.** Schema (v1): `documents(store TEXT PRIMARY KEY, payload TEXT NOT NULL,
updated_at INTEGER NOT NULL)`. Every store write is a transactional
whole-document UPSERT of its serialized payload; every load reads one row.
- Rationale: all five stores are **low-cardinality wholesale-replace
  workloads** — exactly the workload the BACKLOG entry itself says JSON
  serves fine; what this flight buys is substrate consolidation (one
  corruption/quarantine discipline, one durability story, transactional
  writes, fewer loose files), not indexing. A doc-per-row design preserves
  each store's public API, `DEFAULTS`/validators/normalizers, legacy-shape
  handling, and `{ serialize, deserialize }` codec seam **verbatim** — the
  codec output simply lands in a TEXT column instead of a file, which is
  precisely the seam's documented purpose, and keeps the future
  `safeStorage` encrypted-codec swap a codec-only change (mission criterion).
- Trade-off: no per-record SQL ops on downloads (the 500-cap keeps the
  document small; a per-record table is the natural follow-on **if** the
  crash-survivable in-progress rider is ever scheduled — deliberately
  deferred with it, per the mission's scope ruling). Accepted.

**DD4 — New Electron-free `src/main/app-db.js` module owns the handle.**
Module-singleton (the house store pattern), cloned from `history-store.js`'s
proven seams: `open(userDataPath)` (mkdir, attempt-open, WAL +
`synchronous=NORMAL` pragmas, `user_version`-gated schema bootstrap,
quarantine-to-`.corrupt-<epoch>`-and-recreate on a failed open),
idempotent `close()` guarded by its own flag, prepared statements rebuilt per
open. Store modules access their row through a small shared document-store
seam (working shape: `createDocumentStore(appDb, name)` returning
`{ read(), write(payload) }` — final shape at leg design) so the five stores
share one tested read/write path instead of five hand-rolled ones. New code
lives in new modules — `main.js` gains only wiring lines (M09 debrief
god-file carry).

**DD5 — Migration semantics: import-once, then rename to `.migrated`.** At
store load, row-absent + legacy JSON present → parse the JSON through the
store's **existing** load/repair/legacy-shape logic (settings merge-repair,
jars three-shape, downloads record validation, session snapshot validation),
write the repaired result as the row, then rename `settings.json` →
`settings.json.migrated` (same for the rest; best-effort, never fatal).
- Rationale for rename over leave-in-place: a live-looking stale JSON invites
  a downgraded binary to silently fork state; `.migrated` makes staleness
  visible while preserving a manual rollback artifact. (Resolves the issue's
  TBD.)
- Fresh profile (no JSON, no row): defaults seeded exactly as today.
  Corrupt JSON at migration: the existing repair-to-defaults semantics
  apply (loads never throw), the repaired result is what migrates.
- **Carve-out (design review): jars' unknown-version envelope never
  migrates.** `jars.js` deliberately keeps an unknown-version
  `containers.json` in memory without ever rewriting the file (pinned by
  `jars-security-forward-version.test.js`), so a future compatible build can
  recover the original envelope unchanged. Migrating that branch would
  lossily re-validate through v2 rules AND rename the original away —
  defeating the guarantee. Ruling: in the unknown-version branch there is
  **no row write and no rename**; the store runs in-memory from the envelope
  exactly as today, and the probe re-runs every boot until a
  version-compatible build handles it. Only known-shape jars files
  (v2 envelope / v1 array / seed cases) migrate.

**DD6 — Quarantine → fresh defaults; `.migrated` files are never
auto-resurrected.** A corrupt `app.db` is quarantined (whole WAL family) and
recreated empty; stores seed defaults. The `.migrated` JSON siblings are NOT
re-imported — they are arbitrarily stale by then, and silently resurrecting
month-old settings/jars is worse than clean defaults. Parity with the
history-store precedent. Accepted: config data-loss on DB corruption, bounded
by the migration-era JSON artifact remaining on disk for manual recovery.
- **Addendum (design review): jars' post-quarantine reseed is
  branch-dependent, and that is deliberate.** Jars' no-store seed path
  probes `userData/Partitions/goldfinch` and seeds either the fresh two-jar
  set or the four-jar legacy set. After an `app.db` quarantine, a profile
  that ever had the legacy `default` jar will reseed the legacy set — this
  exactly mirrors today's behavior on a corrupt `containers.json`, and the
  probe's purpose (keeping a legacy partition's data reachable rather than
  orphaning it) applies with equal force after DB corruption. Accepted as
  intentional parity with current behavior, not forced to a single
  deterministic seed.

**DD7 — Lifecycle placement.** `appDb.open(userDataPath)` happens inside the
reshaped `initProfileAndStores` **before** the four in-seam store loads
(shields, settings, jars, downloads — they need the handle);
`historyStore.open` stays a sibling call in `main.js` (separate DB, separate
concerns — the M08 seam holds). **`session-store.load()` also stays a
`main.js` sibling** (design-review ruling): its separate call site was a
deliberate M09 choice, and under DD4's module-singleton design it simply
reads the already-open `app-db.js` singleton — no signature threading
needed. The M09 comment block at its call site is updated (not deleted) to
reflect the substrate. `appDb.close()` joins `historyStore.close()` at
**`will-quit`** — after `before-quit`'s writers (session terminal snapshot,
downloads interrupted-flush, any settings/jars saves) have run, preserving
the existing write-before-close ordering. The session-store two-writer
discipline (M09 F9) is unchanged — its writes just land in the row. Jars'
synchronous `save()`-inside-`load()` (seed/migrate branches) must remain
safe during the bootstrap sequence — the document seam's `write()` is
synchronous by construction (`DatabaseSync`), verified in leg-1 tests.

**DD8 — Shields brought up to house discipline.** `shields.js` drops
`require('electron')`, takes an injected path/handle like every other store
(its `load()` call site in `init-profile.js` updated), gains the codec seam,
writes transactionally through the shared document seam, and **propagates
write errors** (today it swallows them silently — that weakens the
no-data-loss story and dies here). Its unit test drops the `electron-stub`
require. Public read API (`get`/`set`/`isPaused`/`active`/`stripUrl`/…)
unchanged.

**DD9 — The `initProfileAndStores` pin moves deliberately.** The boot seam's
unit-pinned 4-store signature widens to **app-db open + the same four
stores** (session-store stays a sibling per DD7). The pinning tests
(`init-profile-order.test.js`) are updated as a **named, deliberate** change
in the same leg — not incidentally — and the new shape is re-pinned.

**DD10 — Shields write-errors now propagate (new failure mode, named).**
DD8's error propagation means `shields.set()`/`setPaused()` can now reject
through their IPC handlers. This matches the existing
`internal-settings-set` precedent (settings.set already throws uncaught into
`ipcMain.handle` rejection) — consistent, accepted; noted for leg 2's test
scope.

### Prerequisites

- [x] Suite green on `main` at flight design: **1973 pass / 0 fail**, 13
      suites, ~1.4s; clean tree (only the new mission dir untracked).
- [x] `node:sqlite` unflagged on dev-host Node 22.22 (M08, re-confirmed) and
      in Electron 42.6.1's bundled Node 24.18 (Architect probe, mission
      design).
- [x] The five stores' shapes, call sites, and test files enumerated
      (mission-design survey; recon report in the flight log).
- [ ] Behavior-test apparatus for the live migration gate premise-audited at
      leg design: a seedable profile (dedicated userData dir or
      backup/restore of the dev profile), the out-of-band quit/relaunch
      harness (proven at M09 F10), and an admin MCP key on the rig. If the
      execution session lacks the rig, the live run is HAT-scoped (M09 F9
      precedent) — the structural layer must still be complete.

### Pre-Flight Checklist

- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified (one apparatus audit deferred to leg design,
      named above)
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

Clone the history-store's substrate seams into `app-db.js` (open / pragmas /
`user_version` bootstrap / quarantine / close), add a shared document-store
read/write seam over the `documents` table, then convert the stores in two
passes: first the three codec-seam stores whose shape is already
migration-ready (settings, downloads, session), then the two needing
structural work (jars' three-shape legacy load rides its existing logic —
but note jars has **no codec seam today**; building one is real, named leg-2
work, plus the DD5 unknown-version carve-out; shields gets the DD8
discipline rework) together with the boot-seam reshape (`init-profile.js`)
and quit-ordering wiring in `main.js`. Each store
conversion carries its migration path (DD5) and its unit-test updates in the
same leg. The final leg proves the whole thing against the real app — seeded
profile in, migrated state out, corrupt-DB boot — and lands the docs
(CLAUDE.md store sections, BACKLOG retirement + stale-Node fix, DD1
re-affirmation cross-links).

Unit-test style follows `history-store.test.js`: Electron-free, cache-busted
singletons, `mkdtempSync` temp dirs, tolerate the `ExperimentalWarning`.
Suite-timing awareness (M09 F11 debrief): the fs-heavy store cluster is
already the timing tail — keep new suites lean (no gratuitous per-test DB
rebuilds where a shared fixture serves).

### Checkpoints

- [x] `app-db.js` + document seam exist with quarantine/lifecycle unit
      coverage; settings/downloads/session persist via `app.db` rows with
      migration + tests green.
- [x] jars + shields converted (shields at discipline); boot seam reshaped;
      quit ordering wired; full suite green.
- [x] Live migration gate: seeded profile boots migrated with `.migrated`
      renames + `app.db` family present; corrupt-DB boot recovers; docs
      landed.

### Adaptation Criteria

**Divert if**:
- `node:sqlite` shows a hard defect under the multi-store workload (e.g.
  cross-connection WAL interference between `app.db` and `history.db`) —
  that reopens the mission-level substrate fallback, not a flight patch.
- The migration path cannot preserve some store's data faithfully through
  its existing load logic — stop and re-plan rather than shipping lossy
  migration.

**Acceptable variations**:
- Final shape of the document-store seam (factory vs functions, exact
  statement layout) per leg design.
- Whether shields keeps a thin `load()` compatibility wrapper vs call-site
  signature change — leg's call.
- Exact `.migrated` rename timing (during load vs post-boot sweep).

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are
> planned and created one at a time as the flight progresses.

- [x] `app-db-and-codec-stores` — `app-db.js` substrate + document seam +
      settings/downloads/session conversions with migration + unit tests.
- [x] `jars-shields-boot-seam` — jars + shields conversions (DD8 rework),
      `initProfileAndStores` reshape (DD9), `will-quit` close ordering,
      unit tests.
- [x] `migration-verification-and-docs` — live seeded-profile migration run
      (behavior test `sqlite-store-migration`), corrupt-DB boot check,
      CLAUDE.md + BACKLOG + DD1 re-affirmation docs.

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [ ] Code merged
- [x] Tests passing (unit + typecheck + lint; behavior gate RUN and PASSED 6/6)
- [x] Documentation updated

### Verification

- `npm test` / `npm run typecheck` / `npm run lint` green; suite count grows
  by the new store/app-db tests with no regressions.
- Behavior test `sqlite-store-migration` (tests/behavior/) — the live gate:
  existing-profile migration fidelity + corrupt-DB boot recovery against the
  real app. If the rig is unavailable in-session, the run is HAT-scoped and
  the flight lands with the structural layer proven (M09 F9 precedent,
  recorded honestly in the flight log).
- Manual: fresh-profile boot (no JSON) seeds defaults; `userData` shows the
  `app.db` family and `.migrated` files post-upgrade.
