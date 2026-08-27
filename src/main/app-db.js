// @ts-check
'use strict';

// App database: durable, schema-versioned persistence substrate for the small
// config/state stores (settings, downloads, session in this leg; jars/shields
// fold in leg 2). This is the storage substrate decision record — see
// missions/10-persistence-consolidation/flights/01-sqlite-store-consolidation/flight.md
// DD1 (node:sqlite, no new dependency), DD2 (a separate app.db from
// history.db), DD3 (a single `documents` table, one row per store), DD4 (a
// new Electron-free module-singleton owning the handle).
//
// Design — house store pattern, adapted for a live SQLite handle. This is a
// CLONE of history-store.js's proven seams, not a shared import (the two
// stores are deliberately independent — a corrupt app.db must not touch
// history.db and vice versa, DD2):
// - ELECTRON-FREE: does NOT require('electron'). The userData directory is
//   INJECTED at open(userDataPath), mirroring history-store.js.
// - WAL mode + synchronous=NORMAL: direct synchronous writes through cached
//   prepared statements, no queue/batching — this synchronicity is load-
//   bearing for jars' leg-2 save-inside-load sequence (DD7).
// - Schema v1 (DD3): a single `documents` table, one row per store, holding
//   a whole serialized payload — the wholesale-replace workload every
//   converted store already has (settings/downloads/session are all
//   low-cardinality "rewrite the whole thing" stores, not indexed data).
// - Schema v2 (M10 Flight 2, Leg 3 / DD4 VERDICT): adds `cookie_seen`, the
//   retention sweep's cookie first-seen bookkeeping table (metadata only —
//   DD7). This is the first REAL `user_version` ladder step this module has
//   exercised — `attemptOpen` previously branched only on version 0.
// - Never throws on a corrupt existing file: open() quarantines a bad app.db
//   (and its -wal/-shm siblings) to a `.corrupt-<ms-epoch>` sibling and
//   recreates fresh — the app must boot.
// - close() is idempotent: DatabaseSync.close() throws on a second call, so
//   this store tracks its own open/closed flag and guards it.

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// ---------------------------------------------------------------------------
// Schema v1 (flight 10-1 DD3 — implement exactly)
// ---------------------------------------------------------------------------

const SCHEMA_V1_SQL = `
CREATE TABLE documents (
  store      TEXT    PRIMARY KEY,
  payload    TEXT    NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

// ---------------------------------------------------------------------------
// Schema v2 step (M10 Flight 2, Leg 3 / DD4 VERDICT, DD7) — the first real
// `user_version` ladder step this module has ever needed (DD4 review
// annotation (c): pre-leg-3, `attemptOpen` branched only on version 0).
// `cookie_seen` is the retention sweep's cookie first-seen bookkeeping
// table: metadata ONLY (DD7 — jar id, cookie identity tuple, timestamp;
// NEVER a cookie value), one row per (jar, cookie identity), upserted via
// `INSERT OR IGNORE` (DD4 VERDICT: a same-identity value-refresh event pair
// must never reset `first_seen_ms`) and deleted with its jar/cookie on every
// destructive path (DD7 lifecycle — see jar-ipc.js's wipeJarData /
// handleClearData / handleCookiesRemove).
// ---------------------------------------------------------------------------

const SCHEMA_V2_SQL = `
CREATE TABLE cookie_seen (
  jar_id        TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  domain        TEXT    NOT NULL,
  path          TEXT    NOT NULL,
  first_seen_ms INTEGER NOT NULL,
  PRIMARY KEY (jar_id, name, domain, path)
);
`;

// ---------------------------------------------------------------------------
// Schema v3 step (M15 Flight 2 "Jar-Scoped Bookmarks", Leg 2 / flight DD1,
// DD2, DD10; leg L2-DD-A/B/B2). Moves bookmark truth from the app-scoped
// `documents` blob to a jar-keyed table — the `history-store.js` /
// `cookie_seen` table precedent inside app.db. `position` is an explicit
// gap-free `0..n-1` per jar (DD2); the `(jar_id, url)` unique index makes
// "one bookmark per exact URL, per jar" a database constraint (the SAME url
// in two DIFFERENT jars is legal and expected — that is the feature). The
// step also drops the legacy `documents` row (DD10 clean-slate migration) —
// additive-and-ordered like v1->v2, so a profile at any prior version lands
// on v3 in one open, and a fresh v0 profile never pauses at an intermediate
// version.
// ---------------------------------------------------------------------------

const SCHEMA_V3_SQL = `
CREATE TABLE bookmarks (
  id       TEXT PRIMARY KEY,
  jar_id   TEXT    NOT NULL,
  url      TEXT    NOT NULL,
  title    TEXT,
  icon     TEXT,
  position INTEGER NOT NULL,
  added_at INTEGER NOT NULL
);
CREATE INDEX bookmarks_jar_pos ON bookmarks (jar_id, position);
CREATE UNIQUE INDEX bookmarks_jar_url ON bookmarks (jar_id, url);
`;

const CURRENT_VERSION = 3;

const FILE_NAME = 'app.db';

// Migration-failure classification (L2-DD-B): the ONLY discriminating signal
// node:sqlite exposes is `err.errcode`, a raw integer SQLite primary result
// code — `err.code` is the literal string 'ERR_SQLITE_ERROR' for EVERY
// SQLite-thrown error, useless for classification. `require('node:sqlite').
// constants` exports no symbolic names for result codes, so these are
// hardcoded (empirically probed against this repo's Node v22.22.0, live
// corrupt/not-a-db fixtures — see the app-db.test.js errcode pin test):
//   11 = SQLITE_CORRUPT ("database disk image is malformed")
//   26 = SQLITE_NOTADB  ("file is not a database")
const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;

/**
 * @param {unknown} err
 * @returns {boolean} whether `err` is one of the two corruption-class SQLite
 *   result codes (vs. a migration-step bug, e.g. a table collision).
 */
function isCorruptionErrcode(err) {
  const anyErr = /** @type {any} */ (err);
  return !!err && typeof err === 'object' && (anyErr.errcode === SQLITE_CORRUPT || anyErr.errcode === SQLITE_NOTADB);
}

// ---------------------------------------------------------------------------
// Module-scoped state (singleton, like history-store / settings-store)
// ---------------------------------------------------------------------------

/** @type {import('node:sqlite').DatabaseSync | null} */
let db = null;

/** @type {boolean} */
let dbOpen = false;

/** @type {Record<string, import('node:sqlite').StatementSync>} */
let statements = {};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function assertOpen() {
  if (!dbOpen) {
    throw new Error('app db not open');
  }
}

/**
 * Best-effort rename of a corrupt db file and its -wal/-shm siblings to a
 * timestamped `.corrupt-<ms-epoch>` sibling. Never throws.
 * @param {string} dbPath
 */
function quarantineCorruptFile(dbPath) {
  const suffix = '.corrupt-' + Date.now();
  for (const ext of ['', '-wal', '-shm']) {
    const src = dbPath + ext;
    try {
      if (fs.existsSync(src)) {
        fs.renameSync(src, src + suffix);
      }
    } catch {
      // best-effort — a stray lock or permissions error here must not stop
      // the recreate-fresh path below.
    }
  }
}

/**
 * Run one `user_version` ladder step in its OWN transaction (leg L2-DD-A /
 * L2-DD-B2): `bodyFn`'s DDL/DML AND the step's `PRAGMA user_version` bump
 * both live inside one `BEGIN IMMEDIATE` … `COMMIT` — `user_version` is a
 * transactional header field, so a throw partway through `bodyFn` leaves the
 * file at its PRIOR version, durably and consistently (never a durable
 * partial-step artifact at the OLD version number, which would re-run into
 * "already exists" on the next open). On throw: best-effort `ROLLBACK` in
 * its own try/catch (a `ROLLBACK` with no active transaction would itself
 * throw and must not mask the original error — round-2 review note), then
 * classify (L2-DD-B): a corruption-class errcode (11 SQLITE_CORRUPT / 26
 * SQLITE_NOTADB) rethrows UNTAGGED so the outer `open()` catch quarantines
 * exactly as today; any OTHER throw (e.g. a table-name collision) is tagged
 * `err.appDbMigrationFailure = true` and rethrown — `open()` propagates it
 * instead of quarantining, because the file is healthy at its last
 * committed version and destroying it would be strictly worse than failing
 * loudly (the house "programmer errors propagate, never dissolve" rule).
 * @param {import('node:sqlite').DatabaseSync} handle
 * @param {number} targetVersion
 * @param {() => void} bodyFn
 */
function runLadderStep(handle, targetVersion, bodyFn) {
  handle.exec('BEGIN IMMEDIATE');
  try {
    bodyFn();
    handle.exec(`PRAGMA user_version = ${targetVersion}`);
    handle.exec('COMMIT');
  } catch (err) {
    try {
      handle.exec('ROLLBACK');
    } catch {
      // best-effort (quarantineCorruptFile idiom) — see doc comment above.
    }
    if (!isCorruptionErrcode(err)) {
      /** @type {any} */ (err).appDbMigrationFailure = true;
    }
    throw err;
  }
}

/**
 * Open (or create) the database at dbPath, apply pragmas, and step the
 * schema up to `CURRENT_VERSION` via the `user_version` ladder. Steps are
 * CUMULATIVE and strictly additive per version, applied in order from
 * whatever version the file is already at, EACH IN ITS OWN TRANSACTION
 * (leg L2-DD-A/B2 — see runLadderStep):
 *   - 0 → creates schema v1 (`documents`) THEN steps straight through v2
 *     (`cookie_seen`) and v3 (`bookmarks`, M15 F2 Leg 2) in the same open —
 *     a fresh profile lands on `CURRENT_VERSION` directly, never pausing at
 *     an intermediate version.
 *   - 1 → applies the v2 step (`cookie_seen`) then v3.
 *   - 2 → applies ONLY the v3 step (`bookmarks` table + legacy-row delete).
 *   - 3 (== CURRENT_VERSION) → no-op; the file is already current.
 * Throws on any failure (corrupt file, mid-bootstrap error) — the caller
 * decides whether to quarantine and retry, EXCEPT a tagged
 * `err.appDbMigrationFailure` throw (L2-DD-B), which the caller must
 * propagate untouched rather than quarantine.
 * @param {string} dbPath
 * @returns {import('node:sqlite').DatabaseSync}
 */
function attemptOpen(dbPath) {
  const handle = new DatabaseSync(dbPath);
  try {
    handle.exec('PRAGMA journal_mode = WAL');
    handle.exec('PRAGMA synchronous = NORMAL');
    const versionRow = /** @type {any} */ (handle.prepare('PRAGMA user_version').get());
    let version = versionRow.user_version;
    if (version === 0) {
      runLadderStep(handle, 1, () => handle.exec(SCHEMA_V1_SQL));
      version = 1;
    }
    if (version === 1) {
      runLadderStep(handle, 2, () => handle.exec(SCHEMA_V2_SQL));
      version = 2;
    }
    if (version === 2) {
      runLadderStep(handle, CURRENT_VERSION, () => {
        handle.exec(SCHEMA_V3_SQL);
        handle.exec("DELETE FROM documents WHERE store = 'bookmarks'");
      });
      version = CURRENT_VERSION;
    }
    return handle;
  } catch (err) {
    try {
      handle.close();
    } catch {
      // ignore — handle may already be unusable
    }
    throw err;
  }
}

/**
 * (Re)build the cached prepared statements against the current db handle.
 * Must run after every successful open (a fresh DatabaseSync invalidates any
 * prior statements). Every placeholder is numbered and DISTINCT (history-
 * store's live-probed gotcha: never mix a bare `?` with `?N` in one
 * statement).
 */
function prepareStatements() {
  const d = /** @type {import('node:sqlite').DatabaseSync} */ (db);
  statements = {
    selectDoc: d.prepare('SELECT payload FROM documents WHERE store = ?1'),
    upsertDoc: d.prepare(
      'INSERT INTO documents (store, payload, updated_at) VALUES (?1, ?2, ?3) ' +
        'ON CONFLICT(store) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at'
    ),
    deleteDoc: d.prepare('DELETE FROM documents WHERE store = ?1'),
    // cookie_seen (M10 Flight 2, Leg 3 / DD4 VERDICT, DD7) — every
    // placeholder DISTINCT (history-store's live-probed gotcha, cloned
    // discipline). insertCookieSeen is INSERT OR IGNORE (DD4 VERDICT: an
    // existing row's first_seen_ms must survive a same-identity
    // overwrite-then-reinsert event pair).
    insertCookieSeen: d.prepare(
      'INSERT OR IGNORE INTO cookie_seen (jar_id, name, domain, path, first_seen_ms) VALUES (?1, ?2, ?3, ?4, ?5)'
    ),
    deleteCookieSeenByIdentity: d.prepare(
      'DELETE FROM cookie_seen WHERE jar_id = ?1 AND name = ?2 AND domain = ?3 AND path = ?4'
    ),
    deleteCookieSeenByJar: d.prepare('DELETE FROM cookie_seen WHERE jar_id = ?1'),
    selectExpiredCookieSeen: d.prepare(
      'SELECT name, domain, path, first_seen_ms FROM cookie_seen WHERE jar_id = ?1 AND first_seen_ms < ?2'
    ),
    // bookmarks (M15 F2 Leg 2 / flight DD1-DD3, leg L2-DD-A/C/D) — every
    // placeholder DISTINCT (house gotcha, cloned discipline). The id-alone-
    // never-authorizes rule (DD3, history-store.js's deleteVisit precedent)
    // means every by-id lookup/mutation is scoped `WHERE jar_id = ?1 AND id = ?2`.
    selectBookmarksByJar: d.prepare(
      'SELECT id, jar_id, url, title, icon, position, added_at FROM bookmarks WHERE jar_id = ?1 ORDER BY position ASC'
    ),
    selectBookmarkByJarAndId: d.prepare(
      'SELECT id, jar_id, url, title, icon, position, added_at FROM bookmarks WHERE jar_id = ?1 AND id = ?2'
    ),
    selectBookmarkByJarAndUrl: d.prepare(
      'SELECT id, jar_id, url, title, icon, position, added_at FROM bookmarks WHERE jar_id = ?1 AND url = ?2'
    ),
    countBookmarksByJar: d.prepare('SELECT COUNT(*) AS c FROM bookmarks WHERE jar_id = ?1'),
    insertBookmark: d.prepare(
      'INSERT INTO bookmarks (id, jar_id, url, title, icon, position, added_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)'
    ),
    updateBookmark: d.prepare('UPDATE bookmarks SET url = ?1, title = ?2, icon = ?3 WHERE jar_id = ?4 AND id = ?5'),
    updateBookmarkPosition: d.prepare('UPDATE bookmarks SET position = ?1 WHERE jar_id = ?2 AND id = ?3'),
    deleteBookmark: d.prepare('DELETE FROM bookmarks WHERE jar_id = ?1 AND id = ?2'),
    deleteBookmarksByJar: d.prepare('DELETE FROM bookmarks WHERE jar_id = ?1')
  };
}

// ---------------------------------------------------------------------------
// open(userDataPath) / close() / isOpen()
// ---------------------------------------------------------------------------

/**
 * Open (or reopen) the app database at `<userDataPath>/app.db`. Creates the
 * directory first. Applies WAL + synchronous=NORMAL and bootstraps schema v1
 * when `user_version` is 0. On a corrupt existing file (classified by
 * `err.errcode` ∈ {11, 26} — L2-DD-B): the bad file (and its -wal/-shm
 * siblings) is quarantined to an `app.db.corrupt-<ms-epoch>` sibling and a
 * fresh database is created — the app must boot. On a NON-corruption ladder
 * failure (`err.appDbMigrationFailure` — e.g. a migration-step bug), the
 * file is NOT quarantined: it is healthy at its last committed version, and
 * `open()` propagates the error instead of destroying it (L2-DD-B). Calling
 * open() while already open closes first (safe, idempotent re-open — DD4,
 * used by tests to reset between cases).
 * @param {string} userDataPath
 * @param {{ memory?: boolean }} [opts]
 */
function open(userDataPath, opts = {}) {
  if (dbOpen) {
    close();
  }

  if (opts.memory === true) {
    db = attemptOpen(':memory:');
    dbOpen = true;
    prepareStatements();
    return;
  }

  fs.mkdirSync(userDataPath, { recursive: true });
  const dbPath = path.join(userDataPath, FILE_NAME);

  try {
    db = attemptOpen(dbPath);
  } catch (err) {
    if (err && /** @type {any} */ (err).appDbMigrationFailure) {
      // L2-DD-B: a migration-step bug, not corruption — the file is healthy
      // at its last committed version. Destroying it would be strictly
      // worse than failing loudly, so propagate rather than quarantine.
      throw err;
    }
    quarantineCorruptFile(dbPath);
    db = attemptOpen(dbPath);
  }

  dbOpen = true;
  prepareStatements();
}

/**
 * Close the database if open. Safe to call twice — DatabaseSync.close()
 * throws `database is not open` on a second call, so this store owns and
 * guards its own open/closed flag.
 */
function close() {
  if (!dbOpen) return;
  /** @type {import('node:sqlite').DatabaseSync} */ (db).close();
  db = null;
  dbOpen = false;
  statements = {};
}

/**
 * @returns {boolean} whether the database is currently open.
 */
function isOpen() {
  return dbOpen;
}

// ---------------------------------------------------------------------------
// createDocumentStore(name) — the shared read/write/remove seam every
// converted store (settings/downloads/session, and jars/shields in leg 2)
// resolves once at load() time and reuses for every persist.
// ---------------------------------------------------------------------------

/**
 * @param {string} name — the store's row key (e.g. 'settings', 'downloads').
 * @returns {{
 *   read(): string | null,
 *   write(payload: string, now?: number): void,
 *   remove(): void
 * }}
 */
function createDocumentStore(name) {
  return {
    /**
     * @returns {string | null} the store's persisted payload, or null when no
     *   row exists yet (fresh profile or not-yet-migrated legacy JSON).
     */
    read() {
      assertOpen();
      const row = /** @type {any} */ (statements.selectDoc.get(name));
      return row ? row.payload : null;
    },
    /**
     * Upsert this store's row. `now` is audit-only metadata (read by no
     * store logic) — it defaults to Date.now() for callers that don't thread
     * one; app-db's own unit tests pass it explicitly for determinism.
     * @param {string} payload
     * @param {number} [now]
     */
    write(payload, now = Date.now()) {
      assertOpen();
      statements.upsertDoc.run(name, payload, now);
    },
    remove() {
      assertOpen();
      statements.deleteDoc.run(name);
    }
  };
}

// ---------------------------------------------------------------------------
// createCookieSeenStore() — the retention sweep's cookie first-seen
// bookkeeping seam (M10 Flight 2, Leg 3 / DD4 VERDICT, DD7). ONE shared
// instance backs BOTH the `session-created` cookies listener (main.js) and
// the retention-sweep engine's cold-start stamp pass — both write through
// the SAME table via the SAME statements. Metadata only (DD7): no method
// here ever takes or returns a cookie VALUE.
// ---------------------------------------------------------------------------

/**
 * @returns {{
 *   insertIfAbsent(jarId: string, name: string, domain: string, path: string, firstSeenMs: number): boolean,
 *   deleteByIdentity(jarId: string, name: string, domain: string, path: string): boolean,
 *   deleteByJar(jarId: string): number,
 *   selectExpired(jarId: string, cutoffMs: number): Array<{ name: string, domain: string, path: string, firstSeenMs: number }>
 * }}
 */
function createCookieSeenStore() {
  return {
    /**
     * INSERT OR IGNORE (DD4 VERDICT): a no-op against an existing row, so a
     * same-identity value-refresh (the measured `overwrite`/`removed:true`
     * + `inserted`/`removed:false` event pair) never resets `first_seen_ms`
     * for a real row. Also the retention sweep's cold-start stamp primitive
     * (a live session cookie with no bookkeeping row yet gets one stamped
     * `firstSeenMs` — the SAME statement, not a separate code path).
     * @param {string} jarId
     * @param {string} name
     * @param {string} domain
     * @param {string} path
     * @param {number} firstSeenMs
     * @returns {boolean} whether a new row was actually inserted (false when
     *   a row already existed — INSERT OR IGNORE's changes === 0)
     */
    insertIfAbsent(jarId, name, domain, path, firstSeenMs) {
      assertOpen();
      const result = /** @type {any} */ (statements.insertCookieSeen.run(jarId, name, domain, path, firstSeenMs));
      return result.changes > 0;
    },
    /**
     * @param {string} jarId
     * @param {string} name
     * @param {string} domain
     * @param {string} path
     * @returns {boolean} whether a row existed and was deleted
     */
    deleteByIdentity(jarId, name, domain, path) {
      assertOpen();
      const result = /** @type {any} */ (statements.deleteCookieSeenByIdentity.run(jarId, name, domain, path));
      return result.changes > 0;
    },
    /**
     * DD7 lifecycle: bookkeeping dies with its jar — every destructive jar
     * path (wipe, remove, clear-data cookies class) calls this.
     * @param {string} jarId
     * @returns {number} rows deleted
     */
    deleteByJar(jarId) {
      assertOpen();
      const result = /** @type {any} */ (statements.deleteCookieSeenByJar.run(jarId));
      return result.changes;
    },
    /**
     * Rows whose bookkeeping age exceeds a cutoff — the retention sweep's
     * expiry-pass read.
     * @param {string} jarId
     * @param {number} cutoffMs
     * @returns {Array<{ name: string, domain: string, path: string, firstSeenMs: number }>}
     */
    selectExpired(jarId, cutoffMs) {
      assertOpen();
      const rows = /** @type {any[]} */ (statements.selectExpiredCookieSeen.all(jarId, cutoffMs));
      return rows.map((r) => ({ name: r.name, domain: r.domain, path: r.path, firstSeenMs: r.first_seen_ms }));
    }
  };
}

// ---------------------------------------------------------------------------
// createBookmarksStore() — the SQL-level seam for the jar-keyed `bookmarks`
// table (M15 F2 Leg 2 / flight DD1-DD3, leg L2-DD-A/C/D). Owns the prepared
// statements and SQL-level operations only; validation, id minting, and the
// per-row read-time drop/repair split (L2-DD-D) live in bookmarks-store.js —
// the jars.js/settings-store.js SQL/business layering.
// ---------------------------------------------------------------------------

/** @typedef {{ id: string, jarId: string, url: string, title: string | null, icon: string | null, position: number, addedAt: number }} BookmarkRow */

/** @param {any} row @returns {BookmarkRow} */
function rowToBookmark(row) {
  return {
    id: row.id,
    jarId: row.jar_id,
    url: row.url,
    title: row.title,
    icon: row.icon,
    position: row.position,
    addedAt: row.added_at
  };
}

/**
 * @returns {{
 *   listByJar(jarId: string): BookmarkRow[],
 *   findById(jarId: string, id: string): BookmarkRow | null,
 *   findByUrl(jarId: string, url: string): BookmarkRow | null,
 *   countByJar(jarId: string): number,
 *   insert(row: BookmarkRow): void,
 *   update(jarId: string, id: string, fields: { url: string, title: string | null, icon: string | null }): boolean,
 *   remove(jarId: string, id: string): boolean,
 *   reorderPositions(jarId: string, orderedIds: string[]): void,
 *   clearJar(jarId: string): number
 * }}
 */
function createBookmarksStore() {
  return {
    /** Position-ordered (DD2) — display order is ORDER BY position ASC. */
    listByJar(jarId) {
      assertOpen();
      const rows = /** @type {any[]} */ (statements.selectBookmarksByJar.all(jarId));
      return rows.map(rowToBookmark);
    },
    // DD3 / history-store.js's deleteVisit precedent: the id alone never
    // authorizes a read either — every by-id lookup is jar-scoped.
    findById(jarId, id) {
      assertOpen();
      const row = /** @type {any} */ (statements.selectBookmarkByJarAndId.get(jarId, id));
      return row ? rowToBookmark(row) : null;
    },
    findByUrl(jarId, url) {
      assertOpen();
      const row = /** @type {any} */ (statements.selectBookmarkByJarAndUrl.get(jarId, url));
      return row ? rowToBookmark(row) : null;
    },
    countByJar(jarId) {
      assertOpen();
      const row = /** @type {any} */ (statements.countBookmarksByJar.get(jarId));
      return row.c;
    },
    insert(row) {
      assertOpen();
      statements.insertBookmark.run(row.id, row.jarId, row.url, row.title, row.icon, row.position, row.addedAt);
    },
    /** @returns {boolean} whether a row existed and was updated */
    update(jarId, id, { url, title, icon }) {
      assertOpen();
      const result = /** @type {any} */ (statements.updateBookmark.run(url, title, icon, jarId, id));
      return result.changes > 0;
    },
    /** @returns {boolean} whether a row existed and was deleted */
    remove(jarId, id) {
      assertOpen();
      const result = /** @type {any} */ (statements.deleteBookmark.run(jarId, id));
      return result.changes > 0;
    },
    /**
     * L2-DD-A: every multi-row mutation runs in an explicit transaction — a
     * throw mid-loop would leave duplicate positions. Rewrites EXACTLY the
     * given ordered id list to positions 0..n-1 (the caller — bookmarks-
     * store.js's reorder()/remove() — is responsible for computing the full
     * jar-relative order, including omitted/preserved entries, before
     * calling this).
     * @param {string} jarId
     * @param {string[]} orderedIds
     */
    reorderPositions(jarId, orderedIds) {
      assertOpen();
      const d = /** @type {import('node:sqlite').DatabaseSync} */ (db);
      d.exec('BEGIN IMMEDIATE');
      try {
        orderedIds.forEach((id, index) => {
          statements.updateBookmarkPosition.run(index, jarId, id);
        });
        d.exec('COMMIT');
      } catch (err) {
        try {
          d.exec('ROLLBACK');
        } catch {
          // best-effort — see runLadderStep's identical note.
        }
        throw err;
      }
    },
    /**
     * DD9 lifecycle: jar teardown (delete) and the Bookmarks clear-data
     * class both drop every row for a jar in one statement.
     * @param {string} jarId
     * @returns {number} rows deleted
     */
    clearJar(jarId) {
      assertOpen();
      const result = /** @type {any} */ (statements.deleteBookmarksByJar.run(jarId));
      return result.changes;
    }
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  open,
  close,
  isOpen,
  createDocumentStore,
  createCookieSeenStore,
  createBookmarksStore
};
