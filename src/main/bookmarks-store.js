// @ts-check
'use strict';

// Bookmarks store (Flight 1 "Bookmarking Core and Surfaces" DD1/DD2, rewritten
// M15 Flight 2 "Jar-Scoped Bookmarks" Leg 2 / flight DD1-DD4, leg L2-DD-C/D).
//
// Design: ELECTRON-FREE, jarId-first, STATELESS — no module-scoped bookmark
// array. Truth lives in app-db.js's `bookmarks` table (schema v3); every
// method resolves the live factory (app-db.js's createBookmarksStore(),
// resolved once in load(userDataPath) — the jars.js/settings-store.js
// load()-resolves-the-seam precedent) and reads/writes through it directly.
// `load(userDataPath)` is retained for SHAPE PARITY with init-profile.js:72's
// sibling calls (the ordering signal is "after appDb.open()") but reads
// nothing into memory — there is no in-memory cache left to populate.
//
// API (DD3): list(jarId), add(jarId, {url,title,icon}), update(jarId, id,
// patch), remove(jarId, id), reorder(jarId, ids), clearJar(jarId). The id
// alone never authorizes a mutation (history-store.js's deleteVisit
// precedent) — every by-id operation is jar-scoped at the SQL layer
// (app-db.js's findById/update/remove, all `WHERE jar_id = ? AND id = ?`).
//
// Ordering (DD2): display order is the table's `position` column,
// `ORDER BY position ASC`. Positions are kept gap-free `0..n-1` per jar:
// add() appends at n (countByJar); remove() renormalizes the remaining rows;
// reorder() rewrites the full order. Every multi-row rewrite runs inside
// app-db.js's `reorderPositions` transaction (L2-DD-A) — a throw mid-rewrite
// can never leave duplicate positions.
//
// Identity (DD2): one bookmark per EXACT committed-URL string match per jar —
// the `(jar_id, url)` unique index is the database-level enforcement of this
// (the SAME url in two DIFFERENT jars is legal and expected, the feature's
// core claim); the shared src/shared/bookmark-url.js predicate
// (`bookmarkUrlsMatch`) is still the identity check the business logic
// consults (never re-derived locally), so a future change to that predicate
// is picked up here too. add() is idempotent by this rule (re-adding an
// existing URL in the SAME jar returns the existing entry, `created: false`,
// no duplicate row). update() REJECTS (as a no-op, `{ok:false, reason:
// 'duplicate-url'}`) an edit whose new URL exactly matches a DIFFERENT
// existing bookmark IN THE SAME JAR.
//
// Row validation (L2-DD-D, Flight 1's exact drop/repair split, moved from
// load-time array validation to READ-TIME per-row validation): `list()`
// drops url-invalid/id-invalid rows and repairs title/icon IN THE RETURNED
// COPIES ONLY — it never writes back or deletes during a read (a read stays
// a read). Mutation results (add/update/remove) are shaped the same way but
// never dropped — a row a caller just wrote or is removing is inherently
// business-valid by construction (its url passed validUrl before the write).
//
// Store API returns COPIES, never internal references (leg Implementation
// Guidance #1) — every read/mutation result is a fresh object.

const appDb = require('./app-db');
const { isSafeTabUrl } = require('../shared/url-safety');
const { bookmarkUrlsMatch } = require('../shared/bookmark-url');

// Mirrors favicon-fetch.js's DATA_IMAGE_RE exactly (deliberate duplication —
// favicon-fetch.js carries its own copy; there has never been a cross-module
// importer). MODULE-PRIVATE: the dead export it once carried, and the test
// pinning that export, were removed in M15 F3 "Drag Interactions" Leg 2
// (DD10). The constant itself is live — `cleanIcon` below is its one use.
const DATA_IMAGE_RE = /^data:image\//i;

/** @typedef {{ id: string, jarId: string, url: string, title: string, icon: string | null, position: number, addedAt: number }} Bookmark */

/** @type {ReturnType<typeof appDb.createBookmarksStore> | null} */
let store = null;

// Monotonic per-process mint counter (jars.js's slug-collision-suffix idiom
// has no direct analog here — bookmark ids carry no user-facing meaning, so a
// timestamp+counter is sufficient and never collides within a process).
let idSeq = 0;
function mintId() {
  return `bm-${Date.now().toString(36)}-${(++idSeq).toString(36)}`;
}

/** @param {unknown} v @returns {v is string} */
function validUrl(v) {
  return typeof v === 'string' && isSafeTabUrl(v) && v.trim().toLowerCase() !== 'about:blank';
}

/** @param {unknown} title @param {string} url @returns {string} */
function cleanTitle(title, url) {
  return typeof title === 'string' && title.trim() ? title : url;
}

/** @param {unknown} icon @returns {string | null} */
function cleanIcon(icon) {
  if (typeof icon !== 'string' || icon === '') return null; // empty-string normalizes to absent
  return DATA_IMAGE_RE.test(icon) ? icon : null; // any other data:/non-data: scheme -> no icon, entry kept
}

/**
 * Shape a raw table row into the public Bookmark shape, repairing
 * title/icon — used by every mutation return AND by list()'s per-row
 * validator below. Never drops (dropping is list()'s job alone, L2-DD-D).
 * @param {import('./app-db').BookmarkRow} row
 * @returns {Bookmark}
 */
function toBookmark(row) {
  return {
    id: row.id,
    jarId: row.jarId,
    url: row.url,
    title: cleanTitle(row.title, row.url),
    icon: cleanIcon(row.icon),
    position: row.position,
    addedAt: row.addedAt
  };
}

/**
 * Read-time per-row validate+repair (L2-DD-D): url is DROP-worthy (an entry
 * with no recoverable identity is discarded outright, never written back);
 * id is DROP-worthy (a non-string/empty id can never be addressed by
 * remove/update/reorder — defense-in-depth; the PRIMARY KEY constraint
 * already makes this practically unreachable through this store's own
 * writes). title/icon are REPAIRED via toBookmark.
 * @param {import('./app-db').BookmarkRow} row
 * @returns {Bookmark | null}
 */
function sanitizeRow(row) {
  if (typeof row.id !== 'string' || !row.id) return null;
  if (!validUrl(row.url)) return null;
  return toBookmark(row);
}

/**
 * Initialise the store: resolve the app-db factory. Safe to call again
 * (re-resolves against whatever app-db handle is currently open).
 *
 * `userDataPath` is accepted (unused in the body) for SHAPE PARITY with every
 * sibling store's `load(userDataPath, opts?)` signature — initProfileAndStores
 * calls it the same way it calls jars.load(path)/settings.load(path). Unlike
 * Flight 1's document-row version, this reads NOTHING into memory — the
 * `bookmarks` table is the only source of truth, queried live per call.
 *
 * @param {string} _userDataPath — the Electron userData directory (injected
 *   from whenReady; accepted for signature parity, unused in the body).
 */
function load(_userDataPath) {
  store = appDb.createBookmarksStore();
}

/**
 * @param {string} jarId
 * @returns {Bookmark[]}
 */
function list(jarId) {
  const rows = /** @type {any} */ (store).listByJar(jarId);
  /** @type {Bookmark[]} */
  const out = [];
  for (const row of rows) {
    const sanitized = sanitizeRow(row);
    if (sanitized) out.push(sanitized);
  }
  return out;
}

/**
 * DD2 idempotent add: a url exactly matching an existing bookmark IN THE
 * SAME JAR returns that existing entry unchanged (`created: false`, no
 * duplicate, no write) — register-bookmarks-ipc.js uses `created` to skip
 * the broadcast on a duplicate add race.
 * @param {string} jarId
 * @param {{ url?: unknown, title?: unknown, icon?: unknown }} [input]
 * @returns {{ ok: true, bookmark: Bookmark, created: boolean } | { ok: false, reason: 'invalid-url' }}
 */
function add(jarId, { url, title, icon } = {}) {
  if (!validUrl(url)) return { ok: false, reason: 'invalid-url' };
  const s = /** @type {any} */ (store);
  const existing = s.findByUrl(jarId, url);
  if (existing && bookmarkUrlsMatch(existing.url, url)) {
    return { ok: true, bookmark: toBookmark(existing), created: false };
  }
  const position = s.countByJar(jarId);
  /** @type {import('./app-db').BookmarkRow} */
  const row = {
    id: mintId(),
    jarId,
    url: /** @type {string} */ (url),
    title: cleanTitle(title, /** @type {string} */ (url)),
    icon: cleanIcon(icon),
    position,
    addedAt: Date.now()
  };
  s.insert(row);
  return { ok: true, bookmark: toBookmark(row), created: true };
}

/**
 * @param {string} jarId
 * @param {string} id
 * @param {{ url?: unknown, title?: unknown, icon?: unknown }} [patch]
 * @returns {{ ok: true, bookmark: Bookmark } | { ok: false, reason: 'not-found' | 'invalid-url' | 'duplicate-url' }}
 */
function update(jarId, id, patch = {}) {
  const s = /** @type {any} */ (store);
  const entry = s.findById(jarId, id);
  if (!entry) return { ok: false, reason: 'not-found' };

  let nextUrl = entry.url;
  if (patch.url !== undefined) {
    if (!validUrl(patch.url)) return { ok: false, reason: 'invalid-url' };
    // DD3 URL-collision ruling: an update whose new URL exactly matches a
    // DIFFERENT existing bookmark IN THE SAME JAR is rejected as a no-op —
    // preserves the one-bookmark-per-exact-URL-per-jar invariant. Rejected
    // BEFORE any mutation. Setting a bookmark's url to its OWN current url
    // is not a collision (the found row IS this entry).
    const collision = s.findByUrl(jarId, patch.url);
    if (collision && collision.id !== id && bookmarkUrlsMatch(collision.url, patch.url)) {
      return { ok: false, reason: 'duplicate-url' };
    }
    nextUrl = /** @type {string} */ (patch.url);
  }
  const nextTitle = patch.title !== undefined ? cleanTitle(patch.title, nextUrl) : entry.title;
  const nextIcon = patch.icon !== undefined ? cleanIcon(patch.icon) : entry.icon;
  s.update(jarId, id, { url: nextUrl, title: nextTitle, icon: nextIcon });
  return {
    ok: true,
    bookmark: toBookmark({
      id,
      jarId,
      url: nextUrl,
      title: nextTitle,
      icon: nextIcon,
      position: entry.position,
      addedAt: entry.addedAt
    })
  };
}

/**
 * @param {string} jarId
 * @param {string} id
 * @returns {{ ok: true, bookmark: Bookmark } | { ok: false, reason: 'not-found' }}
 */
function remove(jarId, id) {
  const s = /** @type {any} */ (store);
  const entry = s.findById(jarId, id);
  if (!entry) return { ok: false, reason: 'not-found' };
  s.remove(jarId, id);
  // Position invariant: renormalize the remaining rows to a gap-free
  // 0..n-1, preserving their relative (position-ordered) order — L2-DD-A's
  // transactional rewrite, same primitive reorder() below uses.
  const remaining = s.listByJar(jarId);
  s.reorderPositions(
    jarId,
    remaining.map((/** @type {any} */ r) => r.id)
  );
  return { ok: true, bookmark: toBookmark(entry) };
}

/**
 * Reorder to the given id sequence, scoped to one jar. Edge Cases (leg
 * spec): unknown/missing ids in `ids` are ignored; entries OMITTED from
 * `ids` are preserved, appended in their PRIOR relative order — a malformed
 * reorder never drops data. Always succeeds (a reorder has no failure mode
 * short of a non-array input, which is treated as a no-op over the current
 * order). The full rewrite runs in ONE transaction (L2-DD-A).
 * @param {string} jarId
 * @param {unknown} ids
 * @returns {{ ok: true, bookmarks: Bookmark[] }}
 */
function reorder(jarId, ids) {
  const s = /** @type {any} */ (store);
  const current = s.listByJar(jarId); // already position-ordered
  if (!Array.isArray(ids)) return { ok: true, bookmarks: list(jarId) };

  const byId = new Map(current.map((/** @type {any} */ b) => [b.id, b]));
  /** @type {any[]} */
  const next = [];
  const used = new Set();
  for (const id of ids) {
    if (typeof id !== 'string') continue; // malformed entry in the id list — ignore
    if (used.has(id)) continue; // duplicate id in the payload — ignore the repeat
    const b = byId.get(id);
    if (!b) continue; // unknown id (or belongs to a different jar) — ignore
    next.push(b);
    used.add(id);
  }
  // Preserve entries omitted from the id list, appended in PRIOR order.
  for (const b of current) {
    if (!used.has(b.id)) next.push(b);
  }
  s.reorderPositions(
    jarId,
    next.map((b) => b.id)
  );
  return { ok: true, bookmarks: list(jarId) };
}

/**
 * DD9 lifecycle: drop every bookmark for a jar (jar delete, and the
 * Bookmarks clear-data class). Not called from wipeJarData (identity wipe
 * keeps bookmarks — DD9).
 * @param {string} jarId
 * @returns {number} rows deleted
 */
function clearJar(jarId) {
  const s = /** @type {any} */ (store);
  return s.clearJar(jarId);
}

module.exports = { load, list, add, update, remove, reorder, clearJar };
