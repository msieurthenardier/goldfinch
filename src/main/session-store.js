// @ts-check
'use strict';

// Session store: durable, wholesale-replaced persistence of the open-window/tab
// topology for setting-gated session restore (M09 Flight 9, DD1).
//
// Design — clones downloads-store.js's DURABILITY DISCIPLINE with settings-store.js's
// OBJECT schema (one document replaced wholesale, not an append log):
// - ELECTRON-FREE: does NOT require the electron module, does NOT call app.getPath at
//   module scope. The userData dir is INJECTED at load(userDataPath).
// - Atomic persistence: writes a temp file beside the target then renames (same
//   filesystem → atomic on POSIX, near-atomic on Windows).
// - Never-throws load: a missing / corrupt / bad-shape file → no usable session
//   (read() → null). The app must still boot.
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

const FILE_NAME = 'session.json';
const SCHEMA_VERSION = 1;

/**
 * @typedef {{ url: string, jarId: string, active: boolean }} SessionTab
 * @typedef {{ tabs: SessionTab[] }} SessionWindow
 * @typedef {{ version: number, windows: SessionWindow[] }} SessionSnapshot
 */

/** @type {string | null} */
let dir = null;

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
 * Initialise the store from disk. Safe to call again (re-reads). NEVER throws.
 * @param {string} userDataPath — the Electron userData directory (injected from whenReady).
 * @param {{ serialize?: (c: object) => string, deserialize?: (s: string) => any }} [opts]
 */
function load(userDataPath, opts = {}) {
  dir = userDataPath;
  codec = {
    serialize: opts.serialize ?? defaultSerialize,
    deserialize: opts.deserialize ?? defaultDeserialize,
  };
  try {
    const file = path.join(dir, FILE_NAME);
    if (!fs.existsSync(file)) {
      snapshot = null;
      return;
    }
    const raw = fs.readFileSync(file, 'utf8');
    snapshot = validateSnapshot(codec.deserialize(raw));
  } catch {
    // Any error (corrupt JSON, read error, bad shape) → no usable session.
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
 * Validate then atomically persist a snapshot (temp-beside + rename). Errors
 * PROPAGATE (callers write best-effort). Updates the in-memory snapshot.
 * @param {any} nextSnapshot
 */
function write(nextSnapshot) {
  const v = validateSnapshot(nextSnapshot) || { version: SCHEMA_VERSION, windows: [] };
  const file = path.join(/** @type {string} */ (dir), FILE_NAME);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, codec.serialize(v));
  fs.renameSync(tmp, file);
  snapshot = v;
}

/**
 * Remove the persisted session and clear the in-memory snapshot. NEVER throws.
 */
function clear() {
  snapshot = null;
  try {
    const file = path.join(/** @type {string} */ (dir), FILE_NAME);
    if (fs.existsSync(file)) fs.rmSync(file);
  } catch {
    // best-effort: a failed unlink must not throw.
  }
}

module.exports = { load, read, write, clear };
