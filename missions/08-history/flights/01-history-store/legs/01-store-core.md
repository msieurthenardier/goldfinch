# Leg: store-core

**Status**: completed
**Flight**: [Per-Jar History Store](../flight.md)

## Objective

Create `src/main/history-store.js` — the `node:sqlite`-backed per-jar history
store (schema v1 + FTS5, WAL, full jar-keyed API per flight DD2/DD3/DD8) —
with a comprehensive offline unit suite in `test/unit/history-store.test.js`.

## Context

- Flight DD1: substrate is built-in `node:sqlite` (`DatabaseSync`), the
  operator-ruled zero-dependency path. `ExperimentalWarning` in test output is
  accepted and expected.
- Flight DD2: WAL mode, `synchronous=NORMAL`, direct synchronous writes
  through cached prepared statements. No queue/batching.
- Flight DD3: single `visits` table + FTS5 external-content index with sync
  triggers; store-side sanitization of search input.
- Flight DD8: Electron-free module, directory injected at `open(dir)` — the
  house store pattern (`src/main/settings-store.js:load`,
  `src/main/downloads-store.js:load`). CJS (`src/main/**` is
  `sourceType: 'commonjs'` in `eslint.config.mjs`), `// @ts-check` + JSDoc.
- This is the flight's first leg: nothing else exists yet. The recorder
  (leg 2) and IPC (leg 3) call only the API defined here; the API below is
  the contract — do not rename methods casually.
- Suite-speed constraint (M07): keep fixtures small; no bulk-row perf tests
  in the unit suite (the 50k-row scale probe is leg 4's, uncommitted).

## Inputs

- Clean `flight/01-history-store` branch; no prior legs.
- Host Node ≥22 with unflagged `node:sqlite` (probed at flight design:
  Node 22.22, FTS5 + prefix MATCH working; SQLite 3.50.4).

## Outputs

- `src/main/history-store.js` (new) — module-scoped singleton store, API below.
- `test/unit/history-store.test.js` (new) — offline suite, temp-dir pattern.
- No other file changes (main.js wiring is leg 2; IPC is leg 3).

## API Contract (implement exactly)

Module shape mirrors `settings-store.js` / `downloads-store.js`: module-scoped
state, `module.exports` object, every method throws `Error('history store not
open')` if called before `open()` (programmer error — callers control
lifecycle), except `close()` which is idempotent.

- `open(userDataPath)` — resolves `history.db` inside `userDataPath`;
  `fs.mkdirSync(userDataPath, { recursive: true })` **before** opening (the
  documented mkdirSync-before-synchronous-persist defect class — see
  `src/main/jars.js` `mkdirSync` precedent and CLAUDE.md "Two real-boot defect
  classes"). Opens `DatabaseSync`, applies `PRAGMA journal_mode=WAL` and
  `PRAGMA synchronous=NORMAL`, creates schema v1 when `PRAGMA user_version`
  is 0, then sets `user_version = 1`. **Never throws on a corrupt existing
  file**: if construction or schema bootstrap throws, rename the bad file to
  `history.db.corrupt-<ms-epoch>` (best-effort, including `-wal`/`-shm`
  siblings) and recreate fresh — the app must boot (house `load()` ethos).
  Re-`open()` while open: close then reopen (idempotent-safe for tests).
- `close()` — closes the database if open; safe to call twice.
- `recordVisit({ jarId, url, title, visitedAt })` → `number` (the new visit
  id). `title` optional (nullable), `visitedAt` ms epoch (caller supplies —
  no `Date.now()` inside the store; keeps it deterministic under test).
  Validates: `jarId`/`url` non-empty strings, `visitedAt` finite number —
  throws `TypeError` otherwise (recorder/IPC guard upstream; the store is the
  last line).
- `setTitle(visitId, title)` → `boolean` (row existed). Updates `title`;
  FTS shadow follows via the UPDATE trigger.
- `listRecent(jarId, { limit = 100, before = null } = {})` → array of
  `{ id, url, title, visitedAt }`, ordered `visited_at DESC, id DESC`.
  `before` is a **visit id** acting as a compound cursor: when set, resolve
  that row's `(visited_at, id)` and return rows strictly after it in the
  sort order — SQL (⚠ every placeholder DISTINCT — mixing a bare `?` with
  `?1` collapses onto the same bound slot; design-review live-verified):
  `WHERE jar_id = ?1 AND (visited_at < ?2 OR (visited_at = ?2 AND id < ?3))`
  bound as `(jarId, beforeVisitedAt, beforeId)`.
  Unknown `before` id (or belonging to another jar) → empty array
  (fail-closed, no cross-jar cursor probing). `limit` clamped to 1–500.
- `search(jarId, query, { limit = 50 } = {})` → same row shape, ordered
  `visited_at DESC, id DESC`. **Sanitization (DD3, mandatory)**: split
  `query` on whitespace, strip `"` characters from each token, drop empties;
  if nothing remains → `[]` without touching FTS. Each token becomes
  `"token"*` (quoted phrase + prefix star), joined with spaces (implicit
  AND). Query joins `visits_fts` MATCH to `visits` by rowid and filters
  `jar_id` — a jar's search can never return another jar's rows.
- `deleteVisit(jarId, visitId)` → `boolean`. `DELETE ... WHERE id = ? AND
  jar_id = ?` — the id alone never authorizes deletion (DD8 jar-scoping).
- `clearJar(jarId)` → `number` deleted.
- `countByJar(jarId)` → `number`.
- `pruneExpired(retentionByJarId, now)` → `Record<jarId, number>` of nonzero
  deletion counts. For each `[jarId, days]` entry: delete rows with
  `visited_at < now − days*86_400_000`. Then **orphan GC**:
  `SELECT DISTINCT jar_id FROM visits` minus `Object.keys(retentionByJarId)`
  → `clearJar` each (flight DD6, Architect-pinned shape). `now` ms epoch,
  caller-supplied.

## Schema v1 (implement exactly, from flight DD3)

```sql
CREATE TABLE visits (
  id         INTEGER PRIMARY KEY,
  jar_id     TEXT    NOT NULL,
  url        TEXT    NOT NULL,
  title      TEXT,
  visited_at INTEGER NOT NULL
);
CREATE INDEX visits_jar_time ON visits (jar_id, visited_at DESC);
CREATE INDEX visits_jar_url  ON visits (jar_id, url);
CREATE VIRTUAL TABLE visits_fts USING fts5(
  url, title, content='visits', content_rowid='id',
  prefix='2 3 4'
);
-- DEFAULT unicode61 tokenizer — deliberately NO tokenchars override. With
-- tokenchars '-._/:' a whole URL is ONE token and "exam"* matches nothing
-- (design-review live probe); default tokenization splits
-- https://example.com/page1 into ['https','example','com','page1'].
CREATE TRIGGER visits_ai AFTER INSERT ON visits BEGIN
  INSERT INTO visits_fts(rowid, url, title) VALUES (new.id, new.url, new.title);
END;
CREATE TRIGGER visits_ad AFTER DELETE ON visits BEGIN
  INSERT INTO visits_fts(visits_fts, rowid, url, title)
    VALUES ('delete', old.id, old.url, old.title);
END;
CREATE TRIGGER visits_au AFTER UPDATE ON visits BEGIN
  INSERT INTO visits_fts(visits_fts, rowid, url, title)
    VALUES ('delete', old.id, old.url, old.title);
  INSERT INTO visits_fts(rowid, url, title) VALUES (new.id, new.url, new.title);
END;
```

Prepared statements are created lazily-once after open and cached in a
module-scoped map (recreated on every `open()`; dropped on `close()`).

## Acceptance Criteria

- [x] `src/main/history-store.js` exists, CJS, `// @ts-check`, no
      `require('electron')` anywhere in it.
- [x] `open()` on an empty temp dir creates `history.db` with `user_version=1`
      and the schema objects above — assert **presence of each named object
      individually** in `sqlite_master` (`visits`, `visits_jar_time`,
      `visits_jar_url`, `visits_fts`, `visits_ai`, `visits_ad`, `visits_au`),
      NEVER a total row count: FTS5 external-content creates four shadow
      tables (`visits_fts_config`/`_data`/`_docsize`/`_idx`) that a count
      assertion would trip over. *(design review)*
- [x] Full API round-trips under `node --test`: record → listRecent →
      setTitle → search → deleteVisit → clearJar → countByJar → pruneExpired,
      each pinned by at least one test.
- [x] Cross-jar isolation pinned: with rows in jars A and B, `listRecent(A)`,
      `search(A, …)`, `countByJar(A)` return only A rows; `deleteVisit(A,
      idOfBRow)` returns false and deletes nothing; `clearJar(A)` leaves B
      intact; a `before` cursor id from jar B yields `[]` for jar A.
- [x] Search sanitization pinned: queries containing FTS5 operators
      (`"`, `*`, `(`, `-`, `NEAR`, a lone `"`) never throw; prefix behavior
      works (`exam` matches `https://example.com/…`); empty/whitespace query
      returns `[]`.
- [x] Title backfill pinned: `setTitle` updates the row AND the FTS shadow
      (post-update, `search` finds the visit by the new title and no longer
      by a distinctive old title).
- [x] Retention pinned: `pruneExpired({ a: 30 }, now)` deletes only rows
      older than 30 days for jar `a`; orphan GC deletes all rows of a jar id
      absent from the map; return value maps only nonzero counts.
- [x] Persistence pinned: close → reopen on the same dir → rows still there.
- [x] Corrupt-file recovery pinned: write garbage bytes to `history.db`,
      `open()` succeeds, a `history.db.corrupt-*` file exists beside it,
      store works.
- [x] Paging pinned: with >limit rows (small numbers — e.g. 5 rows, limit 2)
      `listRecent` pages via `before` with no duplicates/gaps, including
      rows sharing one `visited_at` (id tiebreak).
- [x] `npm test`, `npm run typecheck`, `npm run lint` all green; suite
      wall-clock not visibly regressed (target ~1s; no bulk-row fixtures).

## Verification Steps

- `npm test` — new suite passes with the rest; note total wall-clock.
- `npm run typecheck` — clean (JSDoc types on the API; `@types/node` v26
  ships `node:sqlite` types — if a specific type is missing there, use a
  documented `@ts-ignore` with a comment, matching the flat-import precedent).
- `npm run lint` — clean (CJS in `src/main/**`).
- `node -e "const h=require('./src/main/history-store');"` — requiring the
  module alone must not create files or open anything (side-effect-free at
  require time; only `open()` acts).

## Implementation Guidance

1. **Model the file layout on `src/main/downloads-store.js`** (header comment
   explaining role + the substrate decision pointer, module-scoped state,
   validators, exported API object at the bottom). State it replaces the
   JSON codec seam with `node:sqlite` per flight DD1 — one line, pointing at
   `missions/08-history/flights/01-history-store/flight.md` DD1.
2. **`require('node:sqlite')` at module top** (`const { DatabaseSync } =
   require('node:sqlite')`). Do not lazy-require; the warning fires once.
3. **Schema bootstrap** inside a single `db.exec` guarded by
   `user_version`. Read with `db.prepare('PRAGMA user_version').get()`;
   set via `db.exec('PRAGMA user_version = 1')`.
4. **Statement cache**: plain object/Map filled on first use per method or
   eagerly after open — either is fine; must be rebuilt after re-open.
   **Search JOIN — do not alias the FTS table**: `FROM visits_fts AS f …
   WHERE f MATCH ?` throws `no such column: f`; write it unaliased —
   `FROM visits_fts JOIN visits v ON v.id = visits_fts.rowid WHERE
   visits_fts MATCH ?` *(design-review live probe)*.
   **`close()` idempotence is store-owned**: `DatabaseSync.close()` throws
   `database is not open` on a second call — track an open/closed flag in
   the store and guard; neither cited JSON store holds a live handle, so
   this is new territory, not a copyable precedent *(design review)*.
5. **Tests**: copy the apparatus from `test/unit/downloads-store.test.js` —
   `mkdtempSync` temp dir per test in `try/finally` with `rmSync`, and the
   cache-bust `freshStore()` reload (`delete require.cache[...]` then
   re-require). Deterministic timestamps only (pass `visitedAt`/`now`
   explicitly); never `Date.now()` in assertions.
6. **Corrupt-file test**: `writeFileSync(dbPath, 'not a database')` before
   `open()`. `DatabaseSync` may throw at construction OR at first pragma —
   wrap the whole open-and-bootstrap in the recovery try/catch.
7. **Keep every fixture tiny** (≤ ~20 rows). The FTS/prefix behavior needs
   distinct tokens, not volume.

## Edge Cases

- **Same-timestamp visits**: id DESC tiebreak (pinned by the paging test).
- **`title` null**: FTS insert with NULL title is fine (FTS treats it as
  empty); `setTitle` later fills it.
- **URL longer than typical** (data: URLs won't reach the store — recorder
  filters schemes — but the store itself accepts any non-empty string; no
  length cap in v1).
- **`pruneExpired` with empty map**: pure orphan GC — deletes everything
  (no registered jars). Correct and pinned by the orphan test.
- **Unicode in query/title**: unicode61 tokenizer handles it; one test with
  a non-ASCII title.

## Files Affected

- `src/main/history-store.js` — new
- `test/unit/history-store.test.js` — new

---

## Post-Completion Checklist

**Complete ALL steps before signaling:**

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header)
- [x] Do NOT commit (flight-level review + commit happens after the last leg)

## Citation Audit

Citations verified at leg design time: `src/main/settings-store.js:load` /
`src/main/downloads-store.js:load` (injected-dir store pattern, verified via
codebase reconnaissance and Architect design review), `src/main/jars.js`
`mkdirSync` precedent (CLAUDE.md "Two real-boot defect classes" §1, cites
jars.js:218), `eslint.config.mjs` `src/main/**` CommonJS block,
`test/unit/downloads-store.test.js` temp-dir + cache-bust apparatus. All
symbol-form; none line-brittle.
