// @ts-check
'use strict';

// Bookmarks store (Flight 1 "Bookmarking Core and Surfaces" / DD1, Leg 1).
//
// Design: ELECTRON-FREE, following the ACTUAL jars.js COLLECTION template
// (not settings-store.js's whole-config template — design-review correction:
// no store in src/main/ takes { documentStore } as injected deps). Module-
// scope `require('./app-db')`, document store resolved INSIDE load(userDataPath)
// — same shape as jars.js/settings-store.js's own load(). No legacy JSON file
// to migrate (greenfield — no `bookmark` identifier existed anywhere in src/
// before this leg), so load() is a straight row-read, unlike jars.js's
// three-shape migration ladder.
//
// Envelope: { version: 1, bookmarks: [ { id, url, title, icon, addedAt } ] }.
// Array ORDER IS DISPLAY ORDER (DD1) — reorder() rewrites the array directly,
// no separate position field. Whole-document rewrite per mutation — the same
// O(n) trade-off jars.js accepts at personal-browser scale (DD1).
//
// Entry validation (AC2), mirroring jars.js's per-field discipline (some
// fields are DROP-worthy, others are REPAIRED — never conflate the two):
//   - url: DROP-worthy, like jars.js's partition — must pass isSafeTabUrl AND
//     not be 'about:blank' (the settings-store homePage validator precedent).
//     A malformed/unsafe url means the WHOLE entry is unrecoverable.
//   - title: REPAIRED, like jars.js's name — a non-empty string, else falls
//     back to the entry's own (already-validated) url.
//   - icon: REPAIRED, like jars.js's color — absent/null/non-string/empty-
//     string all normalize to `null` (kept, not dropped); a non-empty string
//     must match favicon-fetch.js's DATA_IMAGE_RE (`/^data:image\//i`) or it
//     also normalizes to `null` (design-review tightening: no other data:
//     scheme, and an invalid icon degrades to the monogram fallback rather
//     than sinking the whole entry).
//
// Identity (DD2): one bookmark per EXACT committed-URL string match, via the
// shared src/shared/bookmark-url.js predicate (`bookmarkUrlsMatch`) — never
// re-derive the comparison locally. add() is idempotent by this rule
// (re-adding an existing URL returns the existing entry, `created: false`,
// no duplicate row). update() REJECTS (as a no-op, `{ok:false, reason:
// 'duplicate-url'}`) an edit whose new URL exactly matches a DIFFERENT
// existing bookmark — preserves the one-bookmark-per-exact-URL invariant.
//
// load() NEVER throws: a corrupt/wrong-shape row repairs the WHOLE store to
// empty (jars.js's corrupt-row-bytes precedent — an app-db-not-open error is
// a programmer error and still propagates, never dissolved into a fallback).
// An individual malformed entry inside an otherwise-valid array is DROPPED,
// valid siblings kept (jars.js's validateContainers precedent).
//
// Store API returns COPIES, never internal references (leg Implementation
// Guidance #1) — every read/mutation result is a fresh object/array so a
// caller cannot mutate the live in-memory store through the returned value.

const appDb = require('./app-db');
const { isSafeTabUrl } = require('../shared/url-safety');
const { bookmarkUrlsMatch } = require('../shared/bookmark-url');

const SCHEMA_VERSION = 1;

// Mirrors favicon-fetch.js's DATA_IMAGE_RE exactly (AC2 — design-review
// tightening: only a data:image/... icon is valid; every other data: scheme
// degrades to no-icon rather than being trusted verbatim).
const DATA_IMAGE_RE = /^data:image\//i;

/** @typedef {{ id: string, url: string, title: string, icon: string | null, addedAt: number }} Bookmark */

/** @type {Bookmark[]} */
let bookmarks = [];

/** @type {{ read(): string | null, write(payload: string, now?: number): void, remove(): void } | null} */
let docStore = null;

const defaultSerialize = (/** @type {object} */ c) => JSON.stringify(c, null, 2);
const defaultDeserialize = (/** @type {string} */ s) => JSON.parse(s);

/** @type {{ serialize: (c: object) => string, deserialize: (s: string) => any }} */
let codec = { serialize: defaultSerialize, deserialize: defaultDeserialize };

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
  if (typeof icon !== 'string' || icon === '') return null; // AC2: empty-string normalizes to absent
  return DATA_IMAGE_RE.test(icon) ? icon : null; // AC2: any other data:/non-data: scheme -> no icon, entry kept
}

/** @param {unknown} v @returns {number} */
function cleanAddedAt(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : Date.now();
}

/** @param {Bookmark} b @returns {Bookmark} */
function copy(b) {
  return { ...b };
}

// Per-entry validate+repair, jars.js's validateContainers shape: url is
// DROP-worthy (an entry with no recoverable identity is discarded outright);
// title/icon/addedAt are REPAIRED; id is DROP-worthy (a non-string/empty id
// can never be addressed by remove/update/reorder). Dedupe by id AND by exact
// url (first occurrence wins, jars.js's id/partition dedupe precedent) — the
// second half of DD2's invariant is enforced live by add()/update(), but a
// row could in principle be hand-edited into a URL-duplicate state, so load()
// stays defense-in-depth here too.
/** @param {unknown} saved @returns {Bookmark[]} */
function validateEntries(saved) {
  if (!Array.isArray(saved)) return [];
  const seenId = new Set();
  const seenUrl = new Set();
  /** @type {Bookmark[]} */
  const kept = [];
  for (const entry of saved) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const { id, url } = /** @type {any} */ (entry);
    if (typeof id !== 'string' || !id) continue;
    if (!validUrl(url)) continue;
    if (seenId.has(id) || seenUrl.has(url)) continue;
    seenId.add(id);
    seenUrl.add(url);
    kept.push({
      id,
      url,
      title: cleanTitle(/** @type {any} */ (entry).title, url),
      icon: cleanIcon(/** @type {any} */ (entry).icon),
      addedAt: cleanAddedAt(/** @type {any} */ (entry).addedAt)
    });
  }
  return kept;
}

/**
 * Initialise the store. Must be called before list/add/update/remove/reorder.
 * Safe to call again (re-reads the row).
 *
 * `userDataPath` is accepted (unused in the body) for SHAPE PARITY with every
 * sibling store's `load(userDataPath, opts?)` signature — initProfileAndStores
 * calls it the same way it calls jars.load(path)/settings.load(path). There is
 * no legacy JSON file to migrate here (greenfield — no `bookmark` identifier
 * existed anywhere in src/ before this leg), so unlike jars.js this module
 * never resolves a path on disk; the app-db row is the only source of truth.
 *
 * @param {string} userDataPath — the Electron userData directory (injected from whenReady).
 * @param {{ serialize?: (c: object) => string, deserialize?: (s: string) => any }} [opts]
 * @returns {Bookmark[]}
 */
function load(userDataPath, opts = {}) {
  codec = {
    serialize: opts.serialize ?? defaultSerialize,
    deserialize: opts.deserialize ?? defaultDeserialize
  };

  // Resolve the document store and read the row OUTSIDE the catch-all below:
  // an app-db-not-open error is a programmer error (mis-ordered boot) and
  // must propagate — never dissolve into "fall back to empty" (jars.js /
  // settings-store.js precedent). The never-throw contract below still
  // covers everything else (JSON parse, entry repair).
  docStore = appDb.createDocumentStore('bookmarks');
  const row = docStore.read();

  if (row === null) {
    bookmarks = [];
    return list();
  }

  try {
    const saved = codec.deserialize(row);
    bookmarks = validateEntries(saved && saved.bookmarks);
  } catch {
    // Corrupt row bytes — never throw; repair the WHOLE store to empty
    // (jars.js's corrupt-row precedent) rather than guessing at partial data.
    bookmarks = [];
  }
  return list();
}

// Fail-soft: a bookmark mutation must not crash the app on a write failure
// (jars.js's save() precedent — the ENTIRE body stays inside the swallow).
function save() {
  try {
    /** @type {any} */ (docStore).write(codec.serialize({ version: SCHEMA_VERSION, bookmarks }));
  } catch {
    /* ignore */
  }
}

/** @returns {Bookmark[]} */
function list() {
  return bookmarks.map(copy);
}

/**
 * DD2 idempotent add: a url exactly matching an existing bookmark returns
 * that existing entry unchanged (`created: false`, no duplicate, no write) —
 * the caller (register-bookmarks-ipc.js) uses `created` to skip the
 * broadcast on a duplicate add race (leg Edge Cases).
 * @param {{ url?: unknown, title?: unknown, icon?: unknown }} [input]
 * @returns {{ ok: true, bookmark: Bookmark, created: boolean } | { ok: false, reason: 'invalid-url' }}
 */
function add({ url, title, icon } = {}) {
  if (!validUrl(url)) return { ok: false, reason: 'invalid-url' };
  const existing = bookmarks.find((b) => bookmarkUrlsMatch(b.url, url));
  if (existing) return { ok: true, bookmark: copy(existing), created: false };
  /** @type {Bookmark} */
  const entry = {
    id: mintId(),
    url: /** @type {string} */ (url),
    title: cleanTitle(title, /** @type {string} */ (url)),
    icon: cleanIcon(icon),
    addedAt: Date.now()
  };
  bookmarks.push(entry);
  save();
  return { ok: true, bookmark: copy(entry), created: true };
}

/**
 * @param {string} id
 * @param {{ url?: unknown, title?: unknown, icon?: unknown }} [patch]
 * @returns {{ ok: true, bookmark: Bookmark } | { ok: false, reason: 'not-found' | 'invalid-url' | 'duplicate-url' }}
 */
function update(id, patch = {}) {
  const entry = bookmarks.find((b) => b.id === id);
  if (!entry) return { ok: false, reason: 'not-found' };

  let nextUrl = entry.url;
  if (patch.url !== undefined) {
    if (!validUrl(patch.url)) return { ok: false, reason: 'invalid-url' };
    // DD3/AC3 URL-collision ruling: an update whose new URL exactly matches a
    // DIFFERENT existing bookmark is rejected as a no-op — preserves the
    // one-bookmark-per-exact-URL invariant. Rejected BEFORE any mutation.
    const collision = bookmarks.find((b) => b.id !== id && bookmarkUrlsMatch(b.url, patch.url));
    if (collision) return { ok: false, reason: 'duplicate-url' };
    nextUrl = /** @type {string} */ (patch.url);
  }
  if (patch.title !== undefined) entry.title = cleanTitle(patch.title, nextUrl);
  if (patch.icon !== undefined) entry.icon = cleanIcon(patch.icon);
  entry.url = nextUrl;
  save();
  return { ok: true, bookmark: copy(entry) };
}

/**
 * @param {string} id
 * @returns {{ ok: true, bookmark: Bookmark } | { ok: false, reason: 'not-found' }}
 */
function remove(id) {
  const idx = bookmarks.findIndex((b) => b.id === id);
  if (idx === -1) return { ok: false, reason: 'not-found' };
  const [removed] = bookmarks.splice(idx, 1);
  save();
  return { ok: true, bookmark: copy(removed) };
}

/**
 * Reorder to the given id sequence. Edge Cases (leg spec): unknown/missing
 * ids in `ids` are ignored; entries OMITTED from `ids` are preserved,
 * appended in their PRIOR relative order — a malformed reorder never drops
 * data. Always succeeds (a reorder has no failure mode short of a non-array
 * input, which is treated as a no-op over the current order).
 * @param {unknown} ids
 * @returns {{ ok: true, bookmarks: Bookmark[] }}
 */
function reorder(ids) {
  if (!Array.isArray(ids)) return { ok: true, bookmarks: list() };
  const byId = new Map(bookmarks.map((b) => [b.id, b]));
  /** @type {Bookmark[]} */
  const next = [];
  const used = new Set();
  for (const id of ids) {
    if (typeof id !== 'string') continue; // malformed entry in the id list — ignore
    if (used.has(id)) continue; // duplicate id in the payload — ignore the repeat
    const b = byId.get(id);
    if (!b) continue; // unknown id — ignore
    next.push(b);
    used.add(id);
  }
  // Preserve entries omitted from the id list, appended in PRIOR order.
  for (const b of bookmarks) {
    if (!used.has(b.id)) next.push(b);
  }
  bookmarks = next;
  save();
  return { ok: true, bookmarks: list() };
}

module.exports = { load, list, add, update, remove, reorder, DATA_IMAGE_RE };
