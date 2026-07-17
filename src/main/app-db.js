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
// - Never throws on a corrupt existing file: open() quarantines a bad app.db
//   (and its -wal/-shm siblings) to a `.corrupt-<ms-epoch>` sibling and
//   recreates fresh — the app must boot.
// - close() is idempotent: DatabaseSync.close() throws on a second call, so
//   this store tracks its own open/closed flag and guards it.

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// ---------------------------------------------------------------------------
// Schema v1 (flight DD3 — implement exactly)
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE documents (
  store      TEXT    PRIMARY KEY,
  payload    TEXT    NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

const FILE_NAME = 'app.db';

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
 * Open (or create) the database at dbPath, apply pragmas, and bootstrap the
 * schema when user_version is 0. Throws on any failure (corrupt file,
 * mid-bootstrap error) — the caller decides whether to quarantine and retry.
 * @param {string} dbPath
 * @returns {import('node:sqlite').DatabaseSync}
 */
function attemptOpen(dbPath) {
  const handle = new DatabaseSync(dbPath);
  try {
    handle.exec('PRAGMA journal_mode = WAL');
    handle.exec('PRAGMA synchronous = NORMAL');
    const versionRow = /** @type {any} */ (handle.prepare('PRAGMA user_version').get());
    if (versionRow.user_version === 0) {
      handle.exec(SCHEMA_SQL);
      handle.exec('PRAGMA user_version = 1');
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
    deleteDoc: d.prepare('DELETE FROM documents WHERE store = ?1')
  };
}

// ---------------------------------------------------------------------------
// open(userDataPath) / close() / isOpen()
// ---------------------------------------------------------------------------

/**
 * Open (or reopen) the app database at `<userDataPath>/app.db`. Creates the
 * directory first. Applies WAL + synchronous=NORMAL and bootstraps schema v1
 * when `user_version` is 0. NEVER throws on a corrupt existing file: the bad
 * file (and its -wal/-shm siblings) is quarantined to an
 * `app.db.corrupt-<ms-epoch>` sibling and a fresh database is created — the
 * app must boot. Calling open() while already open closes first (safe,
 * idempotent re-open — DD4, used by tests to reset between cases).
 * @param {string} userDataPath
 */
function open(userDataPath) {
  if (dbOpen) {
    close();
  }

  fs.mkdirSync(userDataPath, { recursive: true });
  const dbPath = path.join(userDataPath, FILE_NAME);

  try {
    db = attemptOpen(dbPath);
  } catch {
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
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  open,
  close,
  isOpen,
  createDocumentStore
};
