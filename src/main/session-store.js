// @ts-check
'use strict';

// Session store: durable, wholesale-replaced persistence of the open-window/tab
// topology for setting-gated session restore (M09 Flight 9, DD1).
//
// Design — clones downloads-store.js's DURABILITY DISCIPLINE with settings-store.js's
// OBJECT schema (one document replaced wholesale, not an append log):
// - ELECTRON-FREE: does NOT require the electron module, does NOT call app.getPath at
//   module scope. The userData dir is INJECTED at load(userDataPath).
// - Persists through app-db.js's `documents` row seam (flight 10-1 DD2-DD4):
//   one row keyed 'session', written wholesale by write(). A one-time legacy
//   migration reads `session.json` when no row exists yet, validates it
//   through the SAME validateSnapshot below, writes the row via write(), then
//   renames the file `.migrated` (best-effort — DD5).
// - Never-throws load: a missing / corrupt / bad-shape row or file → no usable
//   session (read() → null). The app must still boot.
// - Codec seam: load/write use a { serialize, deserialize } pair defaulting to
//   JSON.stringify/parse so a future backend swaps only the pair.
//
// On-disk shape — a single OBJECT snapshot (NOT downloads' array-of-records):
//   { version: 1, windows: [ { tabs: [ { url, jarId, active }, ... ] } ] }
//
// One validateSnapshot is reused on LOAD (load-bearing — untrusted bytes; a tab's
// url feeds createTab) and WRITE (belt-and-suspenders). It drops malformed members:
// a tab without a non-empty string url AND jarId is dropped; a window with zero
// surviving tabs is dropped; a snapshot with zero surviving windows makes read()
// return null — so leg 3's single `if (restoreOn && snapshot)` gate is provably
// sufficient and can never boot zero windows.

const fs = require('fs');
const path = require('path');
const appDb = require('./app-db');

const FILE_NAME = 'session.json';
const SCHEMA_VERSION = 1;

/**
 * @typedef {{ url: string, jarId: string, active: boolean }} SessionTab
 * @typedef {{ tabs: SessionTab[] }} SessionWindow
 * @typedef {{ version: number, windows: SessionWindow[] }} SessionSnapshot
 */

/** @type {string | null} */
let dir = null;

/** @type {{ read(): string | null, write(payload: string, now?: number): void, remove(): void } | null} */
let docStore = null;

/** @type {SessionSnapshot | null} */
let snapshot = null;

const defaultSerialize = (/** @type {object} */ c) => JSON.stringify(c, null, 2);
const defaultDeserialize = (/** @type {string} */ s) => JSON.parse(s);

/** @type {{ serialize: (c: object) => string, deserialize: (s: string) => any }} */
let codec = { serialize: defaultSerialize, deserialize: defaultDeserialize };

// ---------------------------------------------------------------------------
// validateSnapshot — reused on load (untrusted bytes) and write. Drops malformed
// members; returns a snapshot object (possibly with zero windows) or null when the
// top-level shape is unusable. Never throws.
// ---------------------------------------------------------------------------

/**
 * @param {any} x
 * @returns {SessionSnapshot | null}
 */
function validateSnapshot(x) {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return null;
  if (!Array.isArray(x.windows)) return null;
  /** @type {SessionWindow[]} */
  const windows = [];
  for (const w of x.windows) {
    if (w === null || typeof w !== 'object' || Array.isArray(w) || !Array.isArray(w.tabs)) continue;
    /** @type {SessionTab[]} */
    const tabs = [];
    for (const t of w.tabs) {
      if (t === null || typeof t !== 'object' || Array.isArray(t)) continue;
      if (typeof t.url !== 'string' || t.url === '') continue;
      if (typeof t.jarId !== 'string' || t.jarId === '') continue;
      tabs.push({ url: t.url, jarId: t.jarId, active: !!t.active });
    }
    if (tabs.length === 0) continue; // drop a zero-surviving-tab window
    windows.push({ tabs });
  }
  return { version: SCHEMA_VERSION, windows };
}

// ---------------------------------------------------------------------------
// load / read / write / clear
// ---------------------------------------------------------------------------

/**
 * Initialise the store. Safe to call again (re-reads the row). NEVER throws.
 * @param {string} userDataPath — the Electron userData directory (injected from whenReady).
 * @param {{ serialize?: (c: object) => string, deserialize?: (s: string) => any }} [opts]
 */
function load(userDataPath, opts = {}) {
  dir = userDataPath;
  codec = {
    serialize: opts.serialize ?? defaultSerialize,
    deserialize: opts.deserialize ?? defaultDeserialize,
  };

  // Resolve the document store and read the row OUTSIDE the catch-all below:
  // an app-db-not-open error is a programmer error (mis-ordered boot) and
  // must propagate — never dissolve into "no usable session" (design
  // review). The never-throw contract below still covers everything else
  // (JSON parse, validation, migration rename).
  docStore = appDb.createDocumentStore('session');
  const row = docStore.read();

  if (row !== null) {
    try {
      snapshot = validateSnapshot(codec.deserialize(row));
    } catch {
      snapshot = null;
    }
    return;
  }

  try {
    const file = path.join(dir, FILE_NAME);
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8');
      let parsed = null;
      try {
        parsed = codec.deserialize(raw);
      } catch {
        parsed = null;
      }
      // One-time migration: write() validates the parsed payload, persists
      // the row (even a corrupt legacy file migrates its repaired-to-empty
      // result — DD5), and updates the in-memory snapshot; the legacy file
      // is then renamed to mark it superseded.
      write(parsed);
      try {
        fs.renameSync(file, file + '.migrated');
      } catch {
        // best-effort — migration already completed via the row write (DD5).
      }
    } else {
      snapshot = null;
    }
  } catch {
    // Any error (read error, etc.) → no usable session.
    // load() MUST NEVER THROW — the app must still boot.
    snapshot = null;
  }
}

/**
 * @returns {SessionSnapshot | null} the loaded snapshot, or null when there is no
 *   usable session (missing / corrupt / bad-shape / zero surviving windows).
 */
function read() {
  if (!snapshot || snapshot.windows.length === 0) return null;
  return snapshot;
}

/**
 * Validate then persist a snapshot to its document row. Errors PROPAGATE
 * (callers write best-effort). Updates the in-memory snapshot.
 * @param {any} nextSnapshot
 */
function write(nextSnapshot) {
  const v = validateSnapshot(nextSnapshot) || { version: SCHEMA_VERSION, windows: [] };
  /** @type {any} */ (docStore).write(codec.serialize(v));
  snapshot = v;
}

/**
 * Remove the persisted session (row + any lingering legacy file) and clear
 * the in-memory snapshot. NEVER throws. A `.migrated` sibling is deliberate
 * history (DD5/DD6) — this only ever removes the BARE session.json.
 */
function clear() {
  snapshot = null;
  try {
    if (docStore) docStore.remove();
  } catch {
    // best-effort — row removal must not throw (M09 semantics preserved).
  }
  try {
    if (dir !== null) {
      const file = path.join(dir, FILE_NAME);
      if (fs.existsSync(file)) fs.rmSync(file);
    }
  } catch {
    // best-effort: a failed unlink must not throw.
  }
}

module.exports = { load, read, write, clear };
