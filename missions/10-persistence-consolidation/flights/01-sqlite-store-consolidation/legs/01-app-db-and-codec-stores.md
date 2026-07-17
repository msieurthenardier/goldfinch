# Leg: app-db-and-codec-stores

**Status**: completed
**Flight**: [SQLite Store Consolidation](../flight.md)

## Objective

Create the Electron-free `src/main/app-db.js` substrate (SQLite `app.db` with
the history-store's proven seams) plus a shared document read/write seam, and
convert the three codec-seam stores — `settings-store.js`,
`downloads-store.js`, `session-store.js` — to persist through it, each with
one-time JSON migration and updated unit tests, keeping the app fully
runnable.

## Context

- Flight DDs govern: DD2 (separate `app.db`), DD3 (single `documents` table,
  doc-per-store rows), DD4 (module-singleton `app-db.js` + document seam),
  DD5 (migrate-then-rename-`.migrated`), DD6 (quarantine → fresh defaults),
  DD7 (lifecycle), DD1 (`node:sqlite` only — no new dependencies).
- The reference implementation is `src/main/history-store.js` — clone its
  seams, do not import it: `attemptOpen` (`history-store.js:136` — WAL +
  `synchronous=NORMAL` pragmas, `PRAGMA user_version`-gated bootstrap),
  `quarantineCorruptFile` (`history-store.js:114` — renames db + `-wal` +
  `-shm` to `.corrupt-<epoch>`, best-effort), `open` (`history-store.js:254`
  — mkdir, attempt/quarantine/re-attempt), idempotent `close`
  (`history-store.js:278` — own `isOpen` flag; `DatabaseSync.close()` throws
  on double-close), prepared statements rebuilt per open.
- The three stores' codec seams are the swap point (their documented
  purpose): `settings-store.js:179` — `let codec = { serialize: …,
  deserialize: … }`; `session-store.js:50` — same; `downloads-store.js`
  (seam at :59-62, DD9 comment at :15). Public APIs must not change:
  `settings-store` (`module.exports = { DEFAULTS, load, get, getAll, set }`,
  :331), `downloads-store` (`{ load, list, append, remove, clear, getNextId }`,
  :246), `session-store` (`{ load, read, write, clear }`, :149).
- This leg does NOT touch `jars.js` / `shields.js` / `init-profile.js`
  (leg 2's scope). To keep the app runnable, it adds minimal `main.js`
  wiring only (see guidance step 5); leg 2 folds the open into the reshaped
  `initProfileAndStores` per DD7/DD9.

## Inputs

- Clean flight branch `flight/01-sqlite-store-consolidation`; suite baseline
  1973 pass / 0 fail; `src/main/app-db.js` does not exist.
- `node:sqlite` loads unflagged on dev-host Node 22.22 (verified).

## Outputs

- `src/main/app-db.js` — new module: `open(userDataPath)`, `close()`,
  `isOpen()`, `createDocumentStore(name)` (or equivalent seam — see
  guidance), quarantine handling, schema v1.
- `settings-store.js`, `downloads-store.js`, `session-store.js` persist via
  `app.db` `documents` rows; legacy JSON migrates once then renames to
  `.migrated`.
- `main.js`: `appDb.open(app.getPath('userData'))` wired immediately before
  `initProfileAndStores(...)`; `appDb.close()` beside `historyStore.close()`
  at `will-quit`.
- New `test/unit/app-db.test.js`; updated store unit tests; suite green.

## Acceptance Criteria

- [x] `src/main/app-db.js` exists, Electron-free (`grep -c "require('electron')" → 0`),
      module-singleton, with WAL + `synchronous=NORMAL` pragmas,
      `user_version=1` schema bootstrap creating
      `documents(store TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
      quarantine-and-recreate of the `app.db`/`-wal`/`-shm` family on a
      failed open, and idempotent `close()`.
- [x] Settings, downloads, and session stores read/write their document row
      through the shared seam; their public module APIs and codec-seam
      option signatures are byte-compatible with today (no caller changes
      outside `main.js` wiring).
- [x] One-time migration per store: row-absent + legacy JSON present →
      existing load/repair logic runs on the JSON, repaired result written
      as the row, file renamed `<name>.json.migrated` (best-effort, never
      fatal). Row-present → JSON ignored (no re-import). No JSON, no row →
      defaults exactly as today.
- [x] `session-store.clear()` deletes the row (and any lingering legacy
      file), preserving its M09 semantics.
- [x] The write path is synchronous end-to-end (safe for jars' leg-2
      save-inside-load) — pinned by a unit test that writes during a load
      sequence.
- [x] `npm test` green (no regressions; new app-db + migration tests
      added), `npm run typecheck` green, `npm run lint` green.
- [x] App boots: `main.js` wiring present (open before
      `initProfileAndStores`, close at `will-quit` beside
      `historyStore.close()`).

## Verification Steps

- `node --test test/unit/app-db.test.js test/unit/settings-store.test.js
  test/unit/downloads-store.test.js test/unit/session-store.test.js` — green.
- `npm test` / `npm run typecheck` / `npm run lint` — green.
- Grep checks: no `require('electron')` in `app-db.js`; no remaining
  `writeFileSync` tmp+rename path in the three converted stores' save/write
  functions (their file I/O is migration-read + rename only).

## Implementation Guidance

1. **`src/main/app-db.js`** — clone the history-store seams for a new
   `userData/app.db`. Export the singleton lifecycle (`open(userDataPath)`,
   `close()`, `isOpen()`) plus the document seam. Recommended seam shape
   (final call is the implementer's within DD4):
   `createDocumentStore(name)` → `{ read(): string|null, write(payload: string, now?: number): void, remove(): void }`
   backed by prepared statements (`SELECT payload FROM documents WHERE store = ?1`,
   `INSERT INTO documents(store, payload, updated_at) VALUES (?1, ?2, ?3)
   ON CONFLICT(store) DO UPDATE SET payload = excluded.payload, updated_at =
   excluded.updated_at`, `DELETE …`). Keep the two live-probed sqlite
   gotchas (history-store header): never mix bare `?` with numbered `?N` in
   one statement. `updated_at` takes an optional caller-supplied `now`
   defaulting to `Date.now()` — the app-db unit tests use the explicit
   param; the three stores' public APIs don't thread `now`, so their writes
   ride the default. **Accepted scope (design review): `updated_at` is
   audit-only metadata, read by no store logic — the determinism discipline
   applies to app-db's own test surface, not the converted stores.**
2. **Convert `settings-store.js`** — in `load(userDataPath, opts)`: resolve
   the document store (`appDb.createDocumentStore('settings')`) into a
   module-scoped `docStore` variable (the pattern for all three stores —
   analogous to the existing `dir`), and read the row. **CRITICAL (design
   review): the document-store resolution and row read sit OUTSIDE/BEFORE
   the store's existing catch-all try/catch** — all three loads today wrap
   their whole body in a swallow-everything try ("load() MUST NEVER
   THROW"); an app-db-not-open error must propagate (mis-ordered boot is a
   programmer error), never dissolve into "fall back to defaults". The
   never-throw contract continues to cover everything *else* (JSON parse,
   repair, rename). If the row is `null`, attempt legacy-file migration:
   read `userDataPath/settings.json` raw; if present, `codec.deserialize` +
   existing merge-repair (unchanged logic), then `save()` (now a row write)
   and rename the file `.migrated`. `save()` (`settings-store.js:255`)
   becomes `docStore.write(codec.serialize(nextConfig))` — errors still
   propagate. Keep the in-memory `config` cache semantics identical. Each
   store gains a unit test pinning "`load()` throws when app-db is not
   open" (mirroring history-store's before-open throw tests).
3. **Convert `downloads-store.js`** — same pattern on its envelope
   (`{ version, nextId, records }`); `save()` (:119) → row write; migration
   reads `downloads.json` through existing `validateRecord`/prune logic.
4. **Convert `session-store.js`** — same; `write()` (:127) → row write
   after `validateSnapshot` (unchanged); `clear()` (:139) → row `remove()`
   + removal of any lingering **bare** `session.json` only (a `.migrated`
   artifact is deliberate history, DD5/DD6). `clear()` keeps its
   never-throws contract — wrap the row `remove()` best-effort like
   today's file removal. Fold in a touch-up of the pre-existing
   `main.js:3739-3741` comment ("session-store .write() throws without a
   load()-set dir") — the failure mode shifts to "doc store unresolved".
5. **`main.js` wiring (minimal)** — `const appDb = require('./app-db');`
   then `appDb.open(app.getPath('userData'));` on the line immediately
   before the `initProfileAndStores(...)` call, with a one-line comment
   noting leg 2 folds it into the reshaped seam; `appDb.close()` in the
   existing `will-quit` handler beside `historyStore.close()` (after it or
   before it — order between the two DBs is immaterial; both after
   `before-quit` writers).
6. **Tests** — new `test/unit/app-db.test.js` (house style:
   `history-store.test.js` — cache-busted singleton, `mkdtempSync` temp
   dirs): fresh create + WAL family on disk, bootstrap `user_version`,
   document read/write/upsert/remove round-trip, corrupt-file quarantine
   (`.corrupt-<epoch>` siblings + fresh recreate), idempotent close,
   write-during-load synchrony. Update the three store suites: **require
   app-db ONCE per test file — do NOT cache-bust it between tests** (design
   review: busting both singletons creates a require-order hazard where a
   re-required store captures a stale app-db instance); reset per test via
   `appDb.open(newTmpDir)` (open safely closes-and-reopens, DD4) with a
   final `close()`; if the store's own suite cache-busts its store module,
   it must re-require against the same live app-db instance. Add
   migration cases per store (seeded legacy JSON → values intact + rename;
   corrupt JSON → repaired defaults migrate; row-wins-over-stray-JSON;
   fresh-dir defaults). Existing behavioral assertions must pass unmodified
   except where they asserted the JSON file itself — those convert to
   row/`.migrated` assertions (a named, deliberate change per DD9's
   spirit).
7. **Docs touch-lite** — update the three stores' header comments (codec
   seam now feeds the `documents` row; file path lines) but leave CLAUDE.md
   / BACKLOG to leg 3.

## Edge Cases

- **Corrupt legacy JSON at migration** — existing repair semantics run
  (loads never throw); the repaired result is what migrates; the corrupt
  original still renames `.migrated` (it's the rollback artifact, corrupt
  or not).
- **`.migrated` already exists** (re-migration after DB quarantine) —
  `renameSync` overwrite is acceptable; never fatal if it throws (log and
  continue — migration completed, the rename is best-effort per DD5).
- **`app-db` not open when a store loads** — programmer error; throw
  clearly (matches history-store's `assertOpen` style) so tests catch
  mis-ordering, never silently fall back to files.
- **Double `open()`** — close-then-reopen or no-op; pick history-store
  parity (its `open` closes an existing handle first if any — check and
  mirror).
- **Session snapshot absent** (fresh profile) — `read()` returns null
  exactly as today's missing-file case.

## Files Affected

- `src/main/app-db.js` — new
- `src/main/settings-store.js`, `src/main/downloads-store.js`,
  `src/main/session-store.js` — persistence target swap (APIs unchanged)
- `src/main/main.js` — two wiring lines + comment
- `test/unit/app-db.test.js` — new
- `test/unit/settings-store.test.js`, `test/unit/downloads-store.test.js`,
  `test/unit/session-store.test.js` — setup + migration cases

---

## Post-Completion Checklist

**Complete ALL steps before signaling handoff:**

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header)
- [x] Do NOT commit (flight-end review/commit model)

## Citation Audit

Citations verified against current code at leg design time (2026-07-17):
`history-store.js:114/136/254/278` (quarantine/attemptOpen/open/close),
`settings-store.js:179/255/331` (codec/save/exports),
`session-store.js:50/92/117/127/139/149`, `downloads-store.js:59/119/138/246`
— all `OK` via symbol grep.
