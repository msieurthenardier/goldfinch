// @ts-check
'use strict';

// History store: durable, per-jar browsing-history persistence on Node's
// built-in node:sqlite (DatabaseSync). This is the storage substrate decision
// record — see missions/08-history/flights/01-history-store/flight.md DD1:
// node:sqlite replaces the JSON-file codec pattern (settings-store.js /
// downloads-store.js) because the store needs indexed range queries (recent
// paging) and full-text search (FTS5) at a scale a whole-file JSON rewrite
// cannot serve.
//
// Design — house store pattern, adapted for a live SQLite handle:
// - ELECTRON-FREE: does NOT require('electron'). The userData directory is
//   INJECTED at open(userDataPath), mirroring settings-store.js / downloads-store.js.
// - WAL mode + synchronous=NORMAL (flight DD2): direct synchronous writes
//   through cached prepared statements, no queue/batching.
// - Schema v1 (flight DD3): a single `visits` table + an FTS5 external-content
//   index (`visits_fts`) kept in sync via INSERT/UPDATE/DELETE triggers.
// - Never throws on a corrupt existing file: open() quarantines a bad
//   history.db (and its -wal/-shm siblings) to a `.corrupt-<ms-epoch>` sibling
//   and recreates fresh — the app must boot (same ethos as the JSON stores'
//   corrupt-file tolerance, applied to a real database file).
// - close() is idempotent: DatabaseSync.close() throws on a second call, so
//   this store tracks its own open/closed flag and guards it (new territory —
//   neither JSON store holds a live handle to close).

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// ---------------------------------------------------------------------------
// Schema v1 (flight DD3 — implement exactly)
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
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
`;

const FILE_NAME = 'history.db';
const MIN_LIMIT = 1;
const MAX_LIMIT = 500;
// suggest()'s own clamp (flight-4 leg-1 / DD3-DD4) — deliberately distinct
// from the store's general 1–500 MIN_LIMIT/MAX_LIMIT: the omnibox dropdown
// is a small, fixed-height list, never a paged view.
const SUGGEST_MIN_LIMIT = 1;
const SUGGEST_MAX_LIMIT = 10;

// ---------------------------------------------------------------------------
// Module-scoped state (singleton, like settings-store / downloads-store)
// ---------------------------------------------------------------------------

/** @type {import('node:sqlite').DatabaseSync | null} */
let db = null;

/** @type {boolean} */
let isOpen = false;

/** @type {Record<string, import('node:sqlite').StatementSync>} */
let statements = {};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function assertOpen() {
  if (!isOpen) {
    throw new Error('history store not open');
  }
}

/**
 * Bind the row shape returned by SELECTs against `visits` to the API's
 * camelCase visit shape.
 * @param {any} row
 * @returns {{ id: number, url: string, title: string | null, visitedAt: number }}
 */
function rowToVisit(row) {
  return { id: row.id, url: row.url, title: row.title, visitedAt: row.visited_at };
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
 * prior statements).
 */
function prepareStatements() {
  const d = /** @type {import('node:sqlite').DatabaseSync} */ (db);
  statements = {
    insertVisit: d.prepare(
      'INSERT INTO visits (jar_id, url, title, visited_at) VALUES (?, ?, ?, ?)'
    ),
    setTitle: d.prepare('UPDATE visits SET title = ? WHERE id = ?'),
    listRecentNoCursor: d.prepare(
      'SELECT id, url, title, visited_at FROM visits WHERE jar_id = ? ' +
        'ORDER BY visited_at DESC, id DESC LIMIT ?'
    ),
    findVisitCursor: d.prepare('SELECT jar_id, visited_at FROM visits WHERE id = ?'),
    // ⚠ every placeholder DISTINCT — mixing a bare `?` with `?1` collapses
    // onto the same bound slot (design-review live probe). jarId=?1,
    // beforeVisitedAt=?2 (reused for both comparisons), beforeId=?3, limit=?4.
    listRecentWithCursor: d.prepare(
      'SELECT id, url, title, visited_at FROM visits ' +
        'WHERE jar_id = ?1 AND (visited_at < ?2 OR (visited_at = ?2 AND id < ?3)) ' +
        'ORDER BY visited_at DESC, id DESC LIMIT ?4'
    ),
    // FTS JOIN — do not alias the FTS table: `FROM visits_fts AS f … WHERE f
    // MATCH ?` throws `no such column: f` (design-review live probe). Written
    // unaliased; `visits` is aliased as `v` (that alias is fine, only the FTS
    // side must stay bare).
    search: d.prepare(
      'SELECT v.id, v.url, v.title, v.visited_at FROM visits_fts ' +
        'JOIN visits v ON v.id = visits_fts.rowid ' +
        'WHERE visits_fts MATCH ?1 AND v.jar_id = ?2 ' +
        'ORDER BY v.visited_at DESC, v.id DESC LIMIT ?3'
    ),
    // Frecency-ranked, FTS-narrowed suggest query (flight-4 leg-1 / DD3-DD4,
    // review-probe-verified — implement VERBATIM). Placeholders are ALL
    // distinct (the listRecentWithCursor precedent above): ?1=now (reused
    // FOUR times — the SAME logical value, deliberately, NOT the
    // bare-`?`-mixing hazard the comment above warns about), ?2=ftsQuery,
    // ?3=jarId, ?4=limit. ⚠ node:sqlite binds plain JS numbers as REAL, so
    // the `(?1 - v.visited_at) / 86400000` division does NOT truncate to an
    // integer — do NOT "fix" this with a CAST; that would change the
    // probe-verified age-bucket boundary semantics. Rows are per-URL
    // AGGREGATES (GROUP BY v.url) — `lastVisitedAt` (not `visitedAt`) is a
    // deliberate divergence from the Visit row shape, don't normalize it.
    // The bare `v.title` after `MAX(v.visited_at)` relies on SQLite's
    // bare-column-follows-MAX rule (probe-verified under the FTS join).
    suggest: d.prepare(
      `SELECT v.url, MAX(v.visited_at) AS lastVisitedAt, v.title,
         SUM(CASE
           WHEN ((?1 - v.visited_at) / 86400000) <= 4  THEN 100
           WHEN ((?1 - v.visited_at) / 86400000) <= 14 THEN 70
           WHEN ((?1 - v.visited_at) / 86400000) <= 31 THEN 50
           WHEN ((?1 - v.visited_at) / 86400000) <= 90 THEN 30
           ELSE 10
         END) AS score
       FROM visits_fts
       JOIN visits v ON v.id = visits_fts.rowid
       WHERE visits_fts MATCH ?2 AND v.jar_id = ?3
       GROUP BY v.url
       ORDER BY score DESC, MAX(v.visited_at) DESC, v.url ASC
       LIMIT ?4`
    ),
    deleteVisit: d.prepare('DELETE FROM visits WHERE id = ? AND jar_id = ?'),
    clearJar: d.prepare('DELETE FROM visits WHERE jar_id = ?'),
    countByJar: d.prepare('SELECT COUNT(*) AS c FROM visits WHERE jar_id = ?'),
    pruneJar: d.prepare('DELETE FROM visits WHERE jar_id = ? AND visited_at < ?'),
    distinctJarIds: d.prepare('SELECT DISTINCT jar_id AS jarId FROM visits')
  };
}

// ---------------------------------------------------------------------------
// open(userDataPath) / close()
// ---------------------------------------------------------------------------

/**
 * Open (or reopen) the history store at `<userDataPath>/history.db`. Creates
 * the directory first (mkdirSync-before-synchronous-persist — see
 * `src/main/jars.js` `mkdirSync` precedent, CLAUDE.md "Two real-boot defect
 * classes" §1). Applies WAL + synchronous=NORMAL and bootstraps schema v1
 * when `user_version` is 0. NEVER throws on a corrupt existing file: the bad
 * file (and its -wal/-shm siblings) is quarantined to a
 * `history.db.corrupt-<ms-epoch>` sibling and a fresh database is created —
 * the app must boot. Calling open() while already open closes first (safe,
 * idempotent re-open for tests).
 * @param {string} userDataPath
 */
function open(userDataPath) {
  if (isOpen) {
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

  isOpen = true;
  prepareStatements();
}

/**
 * Close the database if open. Safe to call twice — DatabaseSync.close()
 * throws `database is not open` on a second call, so this store owns and
 * guards its own open/closed flag.
 */
function close() {
  if (!isOpen) return;
  /** @type {import('node:sqlite').DatabaseSync} */ (db).close();
  db = null;
  isOpen = false;
  statements = {};
}

// ---------------------------------------------------------------------------
// recordVisit / setTitle
// ---------------------------------------------------------------------------

/**
 * @param {{ jarId: string, url: string, title?: string | null, visitedAt: number }} visit
 * @returns {number} the new visit id
 */
function recordVisit({ jarId, url, title, visitedAt }) {
  assertOpen();
  if (typeof jarId !== 'string' || jarId.length === 0) {
    throw new TypeError('recordVisit: jarId must be a non-empty string');
  }
  if (typeof url !== 'string' || url.length === 0) {
    throw new TypeError('recordVisit: url must be a non-empty string');
  }
  if (typeof visitedAt !== 'number' || !Number.isFinite(visitedAt)) {
    throw new TypeError('recordVisit: visitedAt must be a finite number');
  }
  const result = /** @type {any} */ (
    statements.insertVisit.run(jarId, url, title ?? null, visitedAt)
  );
  return result.lastInsertRowid;
}

/**
 * @param {number} visitId
 * @param {string | null} title
 * @returns {boolean} whether a row existed and was updated
 */
function setTitle(visitId, title) {
  assertOpen();
  const result = /** @type {any} */ (statements.setTitle.run(title ?? null, visitId));
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// listRecent
// ---------------------------------------------------------------------------

/**
 * @param {string} jarId
 * @param {{ limit?: number, before?: number | null }} [opts]
 * @returns {Array<{ id: number, url: string, title: string | null, visitedAt: number }>}
 */
function listRecent(jarId, { limit = 100, before = null } = {}) {
  assertOpen();
  const clampedLimit = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, limit));

  if (before === null || before === undefined) {
    const rows = /** @type {any[]} */ (
      statements.listRecentNoCursor.all(jarId, clampedLimit)
    );
    return rows.map(rowToVisit);
  }

  const cursorRow = /** @type {any} */ (statements.findVisitCursor.get(before));
  // Unknown `before` id (or belonging to another jar) → empty array
  // (fail-closed, no cross-jar cursor probing).
  if (!cursorRow || cursorRow.jar_id !== jarId) {
    return [];
  }

  const rows = /** @type {any[]} */ (
    statements.listRecentWithCursor.all(jarId, cursorRow.visited_at, before, clampedLimit)
  );
  return rows.map(rowToVisit);
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

/**
 * Sanitize free-text search input into an FTS5 MATCH expression (DD3,
 * mandatory): split on whitespace, strip `"` from each token, drop empties;
 * each surviving token becomes `"token"*` (quoted phrase + prefix star),
 * joined with spaces (implicit AND).
 * @param {string} query
 * @returns {string | null} the FTS5 expression, or null if nothing survives
 */
function sanitizeSearchQuery(query) {
  const tokens = query
    .split(/\s+/)
    .map((t) => t.replace(/"/g, ''))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(' ');
}

/**
 * @param {string} jarId
 * @param {string} query
 * @param {{ limit?: number }} [opts]
 * @returns {Array<{ id: number, url: string, title: string | null, visitedAt: number }>}
 */
function search(jarId, query, { limit = 50 } = {}) {
  assertOpen();
  const clampedLimit = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, limit));
  const ftsQuery = sanitizeSearchQuery(query);
  if (ftsQuery === null) return [];

  const rows = /** @type {any[]} */ (
    statements.search.all(ftsQuery, jarId, clampedLimit)
  );
  return rows.map(rowToVisit);
}

// ---------------------------------------------------------------------------
// suggest
// ---------------------------------------------------------------------------

/**
 * Frecency-ranked, FTS-narrowed omnibox suggestions for one jar (flight-4
 * leg-1, DD3/DD4): age-bucketed visit weights summed per URL, dedupe-by-url
 * (most-recent title wins via the bare-column-after-MAX rule). `now` lives
 * in the options bag but is REQUIRED — no default — matching the
 * `pruneOneJar` determinism contract: this store never calls `Date.now()`
 * itself; the caller (the IPC handler) supplies it.
 * @param {string} jarId
 * @param {string} query
 * @param {{ limit?: number, now: number }} opts
 * @returns {Array<{ url: string, title: string | null, score: number, lastVisitedAt: number }>}
 */
function suggest(jarId, query, { limit = 6, now } = /** @type {any} */ ({})) {
  assertOpen();
  if (typeof jarId !== 'string' || jarId.length === 0) {
    throw new TypeError('suggest: jarId must be a non-empty string');
  }
  if (typeof query !== 'string') {
    throw new TypeError('suggest: query must be a string');
  }
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    throw new TypeError('suggest: now must be a finite number');
  }
  const clampedLimit = Math.min(SUGGEST_MAX_LIMIT, Math.max(SUGGEST_MIN_LIMIT, limit));
  const ftsQuery = sanitizeSearchQuery(query);
  if (ftsQuery === null) return [];

  const rows = /** @type {any[]} */ (
    statements.suggest.all(now, ftsQuery, jarId, clampedLimit)
  );
  return rows.map((row) => ({
    url: row.url,
    title: row.title,
    score: row.score,
    lastVisitedAt: row.lastVisitedAt
  }));
}

// ---------------------------------------------------------------------------
// deleteVisit / clearJar / countByJar
// ---------------------------------------------------------------------------

/**
 * @param {string} jarId
 * @param {number} visitId
 * @returns {boolean}
 */
function deleteVisit(jarId, visitId) {
  assertOpen();
  // The id alone never authorizes deletion (DD8 jar-scoping).
  const result = /** @type {any} */ (statements.deleteVisit.run(visitId, jarId));
  return result.changes > 0;
}

/**
 * @param {string} jarId
 * @returns {number} number of rows deleted
 */
function clearJar(jarId) {
  assertOpen();
  const result = /** @type {any} */ (statements.clearJar.run(jarId));
  return result.changes;
}

/**
 * @param {string} jarId
 * @returns {number}
 */
function countByJar(jarId) {
  assertOpen();
  const row = /** @type {any} */ (statements.countByJar.get(jarId));
  return row.c;
}

// ---------------------------------------------------------------------------
// pruneExpired
// ---------------------------------------------------------------------------

/**
 * For each `[jarId, days]` entry, delete rows older than `now - days*86_400_000`.
 * Then orphan-GC: rows whose jar_id is absent from retentionByJarId are
 * deleted entirely via clearJar (flight DD6, Architect-pinned shape).
 * @param {Record<string, number>} retentionByJarId
 * @param {number} now — ms epoch, caller-supplied
 * @returns {Record<string, number>} nonzero deletion counts, keyed by jarId
 */
function pruneExpired(retentionByJarId, now) {
  assertOpen();
  /** @type {Record<string, number>} */
  const deleted = {};

  for (const [jarId, days] of Object.entries(retentionByJarId)) {
    const cutoff = now - days * 86_400_000;
    const result = /** @type {any} */ (statements.pruneJar.run(jarId, cutoff));
    if (result.changes > 0) {
      deleted[jarId] = (deleted[jarId] ?? 0) + result.changes;
    }
  }

  const registeredJarIds = new Set(Object.keys(retentionByJarId));
  const distinctRows = /** @type {any[]} */ (statements.distinctJarIds.all());
  for (const row of distinctRows) {
    const jarId = row.jarId;
    if (registeredJarIds.has(jarId)) continue;
    const count = clearJar(jarId);
    if (count > 0) {
      deleted[jarId] = (deleted[jarId] ?? 0) + count;
    }
  }

  return deleted;
}

/**
 * Delete rows for ONE jar older than `now - days*86_400_000` — the single-jar
 * counterpart to pruneExpired, for the retention-EDIT path (flight DD4,
 * CRITICAL: a naive `pruneExpired({ [jarId]: days }, now)` call would treat
 * every OTHER jar's id as orphaned — absent from the map — and delete their
 * entire history; this method runs ONLY the per-jar cutoff delete, no orphan
 * sweep, so it's safe by construction for a single-jar caller). Reuses the
 * existing pruneJar prepared statement verbatim. Validates args in
 * recordVisit's style: throws TypeError on a non-string jarId or a
 * non-finite days/now (programmer error — the IPC layer is the validator for
 * user-facing bounds; this is mechanism only).
 * @param {string} jarId
 * @param {number} days
 * @param {number} now — ms epoch, caller-supplied
 * @returns {number} number of rows deleted
 */
function pruneOneJar(jarId, days, now) {
  assertOpen();
  if (typeof jarId !== 'string' || jarId.length === 0) {
    throw new TypeError('pruneOneJar: jarId must be a non-empty string');
  }
  if (typeof days !== 'number' || !Number.isFinite(days)) {
    throw new TypeError('pruneOneJar: days must be a finite number');
  }
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    throw new TypeError('pruneOneJar: now must be a finite number');
  }
  const cutoff = now - days * 86_400_000;
  const result = /** @type {any} */ (statements.pruneJar.run(jarId, cutoff));
  return result.changes;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  open,
  close,
  recordVisit,
  setTitle,
  listRecent,
  search,
  suggest,
  deleteVisit,
  clearJar,
  countByJar,
  pruneExpired,
  pruneOneJar
};
