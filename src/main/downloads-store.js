// @ts-check
'use strict';

// Downloads store: durable, terminal-only persistence for the app-level downloads
// model (Flight 5, Leg 1 / DD3, DD9).
//
// Design — mirrors settings-store.js's DURABILITY DISCIPLINE, not its schema shape:
// - ELECTRON-FREE: does NOT require('electron'), does NOT call app.getPath at
//   module scope. The userData path is INJECTED at load(userDataPath).
// - Atomic persistence: writes to a temp file then renames (same filesystem as the
//   target, so rename is atomic on POSIX and near-atomic on Windows).
// - Corrupt→empty: a corrupt/unreadable file or a bad top-level shape → an empty
//   record set with nextId reset to 1 (load never throws). History loss on a corrupt
//   file is accepted, same posture as settings.
// - Pluggable serialization seam (DD9): load/save use a { serialize, deserialize }
//   pair defaulting to JSON.stringify/JSON.parse so a future SQLite/safeStorage
//   backend replaces only the pair (or the whole module behind this repo interface).
//
// What it is NOT: this is an ARRAY-OF-RECORDS store, so it does NOT copy
// settings-store's fixed-key DEFAULTS/VALIDATORS/NORMALIZERS merge (an object-schema
// fit, wrong here). It uses a per-RECORD validator that drops malformed entries.
//
// On-disk shape (an OBJECT, not a bare array, so nextId persists independently of the
// records — a high-id record can be pruned/removed without re-issuing its id):
//   { version: 1, nextId: <int>, records: [ <terminal record>, ... ] }
//
// Record schema (TERMINAL ONLY — in-progress lives in the manager's memory, DD3):
//   { id, url, filename, savePath, state, received, total, mime?, startTime, endTime, error? }
//   where state ∈ {'completed','cancelled','interrupted'}.

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FILE_NAME = 'downloads.json';
const SCHEMA_VERSION = 1;
// Cap the persisted set to the newest 500 records by id (DD3). Bounded memory +
// disk; the SQLite migration (BACKLOG/DD9) lifts this.
const MAX_RECORDS = 500;
const TERMINAL_STATES = new Set(['completed', 'cancelled', 'interrupted']);

// ---------------------------------------------------------------------------
// Module-scoped state (singleton, like settings-store)
// ---------------------------------------------------------------------------

/** @type {string | null} */
let dir = null;

/** @type {number} */
let nextId = 1;

/** @type {Array<object>} */
let records = [];

const defaultSerialize = (/** @type {object} */ c) => JSON.stringify(c, null, 2);
const defaultDeserialize = (/** @type {string} */ s) => JSON.parse(s);

/** @type {{ serialize: (c: object) => string, deserialize: (s: string) => any }} */
let codec = { serialize: defaultSerialize, deserialize: defaultDeserialize };

// ---------------------------------------------------------------------------
// Per-record validator: drop entries missing a positive integer id, a string
// filename, or a terminal state. Coerce/clamp the rest. Never throws.
// ---------------------------------------------------------------------------

/**
 * @param {any} r
 * @returns {object | null} a normalized record, or null if it must be dropped
 */
function validateRecord(r) {
  if (r === null || typeof r !== 'object' || Array.isArray(r)) return null;
  if (!Number.isInteger(r.id) || r.id <= 0) return null;
  if (typeof r.filename !== 'string') return null;
  if (typeof r.state !== 'string' || !TERMINAL_STATES.has(r.state)) return null;

  // Coerce/clamp the rest to sane shapes; missing/odd values get safe defaults.
  const received = Number.isFinite(r.received) && r.received >= 0 ? r.received : 0;
  const total = Number.isFinite(r.total) && r.total >= 0 ? r.total : 0;
  /** @type {object} */
  const out = {
    id: r.id,
    url: typeof r.url === 'string' ? r.url : '',
    filename: r.filename,
    savePath: typeof r.savePath === 'string' ? r.savePath : null,
    state: r.state,
    received,
    total,
    startTime: Number.isFinite(r.startTime) ? r.startTime : 0,
    endTime: Number.isFinite(r.endTime) ? r.endTime : 0
  };
  if (typeof r.mime === 'string') out.mime = r.mime;
  if (typeof r.error === 'string') out.error = r.error;
  return out;
}

// ---------------------------------------------------------------------------
// Prune to the newest MAX_RECORDS by id (drop-oldest). Insertion order is by id
// (ids are monotonic), so the largest ids are the newest.
// ---------------------------------------------------------------------------

/** @param {Array<object>} recs */
function pruneOldest(recs) {
  if (recs.length <= MAX_RECORDS) return recs;
  // Sort ascending by id, keep the tail (the newest MAX_RECORDS).
  return recs
    .slice()
    .sort((a, b) => /** @type {any} */ (a).id - /** @type {any} */ (b).id)
    .slice(recs.length - MAX_RECORDS);
}

// ---------------------------------------------------------------------------
// Atomic write — temp file beside the target (same fs → atomic rename).
// Errors PROPAGATE to the caller (manager tolerates them on best-effort paths).
// ---------------------------------------------------------------------------

function save() {
  const file = path.join(/** @type {string} */ (dir), FILE_NAME);
  const tmp = file + '.tmp';
  const payload = { version: SCHEMA_VERSION, nextId, records };
  fs.writeFileSync(tmp, codec.serialize(payload));
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------------------
// load(userDataPath, opts?)
// ---------------------------------------------------------------------------

/**
 * Initialise the store. Must be called before list/append/remove/clear/getNextId.
 * Safe to call again (re-reads the file). NEVER throws.
 *
 * @param {string} userDataPath — the Electron userData directory (injected from whenReady).
 * @param {{ serialize?: (c: object) => string, deserialize?: (s: string) => any }} [opts]
 */
function load(userDataPath, opts = {}) {
  dir = userDataPath;
  codec = {
    serialize: opts.serialize ?? defaultSerialize,
    deserialize: opts.deserialize ?? defaultDeserialize
  };

  try {
    const file = path.join(dir, FILE_NAME);
    if (!fs.existsSync(file)) {
      nextId = 1;
      records = [];
      return;
    }
    const raw = fs.readFileSync(file, 'utf8');
    const stored = codec.deserialize(raw);

    // Bad top-level shape (not an object, or a bare array) → empty.
    if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) {
      nextId = 1;
      records = [];
      return;
    }

    const rawRecords = Array.isArray(stored.records) ? stored.records : [];
    // Per-record validator drops malformed entries; survivors are normalized.
    const valid = [];
    for (const r of rawRecords) {
      const v = validateRecord(r);
      if (v) valid.push(v);
    }
    records = pruneOldest(valid);

    // nextId authority: the persisted nextId. The maxRecordId+1 term only repairs a
    // file that predates the field (or was hand-edited) — it never LOWERS a sane
    // persisted nextId. max(persistedNextId, maxRecordId+1, 1).
    const persistedNextId =
      Number.isInteger(stored.nextId) && stored.nextId >= 1 ? stored.nextId : 1;
    const maxRecordId = records.reduce(
      (m, r) => Math.max(m, /** @type {any} */ (r).id),
      0
    );
    nextId = Math.max(persistedNextId, maxRecordId + 1, 1);
  } catch {
    // Any error (corrupt JSON, read error, bad shape) → empty list, nextId reset.
    // load() MUST NEVER THROW — the app must still boot.
    nextId = 1;
    records = [];
  }
}

// ---------------------------------------------------------------------------
// Repo interface: list / append / remove / clear / getNextId
// ---------------------------------------------------------------------------

/**
 * @returns {Array<object>} a shallow copy of the terminal records (caller cannot
 *   mutate the live array). Records themselves are shared references — callers
 *   treat them as read-only.
 */
function list() {
  return records.slice();
}

/**
 * Append a terminal record, prune to the newest 500 by id, persist atomically.
 * NEVER lowers nextId.
 * @param {object} record
 */
function append(record) {
  records.push(record);
  records = pruneOldest(records);
  save();
}

/**
 * Remove a record by id and persist. NEVER lowers nextId.
 * @param {number} id
 */
function remove(id) {
  records = records.filter((r) => /** @type {any} */ (r).id !== id);
  save();
}

/**
 * Empty the records (keep nextId) and persist. NEVER lowers nextId.
 */
function clear() {
  records = [];
  save();
}

/**
 * Return the current nextId, then increment and persist the bump.
 * Strictly increasing across the store's lifetime; NEVER lowered by remove/prune.
 * @returns {number}
 */
function getNextId() {
  const id = nextId;
  nextId = id + 1;
  save();
  return id;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { load, list, append, remove, clear, getNextId };
