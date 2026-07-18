'use strict';

// Shields: active privacy protection config + URL/cookie policy helpers.
// Enforcement (webRequest wiring) lives in main.js, which reads this live
// config so toggles take effect immediately across every session/jar.
//
// Design (flight 10-1 DD8, leg 2 — brought up to house discipline):
// - ELECTRON-FREE: does NOT require('electron'). The userData path is
//   INJECTED at load(userDataPath), like settings-store/downloads-store/jars.
// - Persists through app-db.js's `documents` row seam: one row keyed
//   'shields', written wholesale on every save(). A one-time legacy migration
//   reads `shields.json` when no row exists yet, repairs it through the SAME
//   merge-over-DEFAULTS logic below, writes the row, then renames the file
//   `.migrated` (best-effort — DD5).
// - Pluggable serialization seam: load/save use a { serialize, deserialize }
//   pair defaulting to JSON.stringify/JSON.parse, injectable via load(userDataPath, opts?).
// - save() (DD10, refined by design review): the not-loaded state (no prior
//   load()) stays a silent no-op — today's semantics, depended on by ~9
//   pre-load mutation call sites. Once loaded, a write failure PROPAGATES
//   (uncaught) — the old swallow-everything catch is gone. This matches the
//   existing internal-settings-set precedent (settings.set already throws
//   uncaught into ipcMain.handle rejection).

const fs = require('fs');
const path = require('path');
const appDb = require('./app-db');

const FILE_NAME = 'shields.json';

const DEFAULTS = {
  enabled: true, // master switch
  block: true, // cancel requests to known trackers
  strip: true, // strip tracking params + trim Referer
  isolate: true, // strip third-party Cookie / Set-Cookie
  farble: true, // fingerprint noise + navigator spoofing (preload)
  pausedSites: [] // registrable domains where shields are off
};

let config = { ...DEFAULTS };

/** @type {{ read(): string | null, write(payload: string, now?: number): void, remove(): void } | null} */
let docStore = null;

const defaultSerialize = (/** @type {object} */ c) => JSON.stringify(c, null, 2);
const defaultDeserialize = (/** @type {string} */ s) => JSON.parse(s);

/** @type {{ serialize: (c: object) => string, deserialize: (s: string) => any }} */
let codec = { serialize: defaultSerialize, deserialize: defaultDeserialize };

// pausedSites must always be an array. A null/string from disk or a bad set()
// patch would make isPaused throw (or use string .includes substring semantics)
// and setPaused's `new Set(string)` explode into single-char entries — both
// hit the request hot path via active().
function normalizePausedSites(value) {
  return Array.isArray(value) ? value : [];
}

// Merge-over-DEFAULTS repair (the existing semantics, unchanged by the DD8
// rework): a shallow spread of the stored object onto DEFAULTS, with
// pausedSites shape-normalized. Shared by the row-read path and the legacy-
// JSON migration path. NEVER throws — a deserialize failure repairs to
// fresh defaults.
/** @param {string} raw */
function parseAndRepair(raw) {
  try {
    const merged = { ...DEFAULTS, ...codec.deserialize(raw) };
    merged.pausedSites = normalizePausedSites(merged.pausedSites);
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Initialise the store. Safe to call again (re-reads the row).
 *
 * @param {string} userDataPath — the Electron userData directory (injected from whenReady).
 * @param {{ serialize?: (c: object) => string, deserialize?: (s: string) => any }} [opts]
 * @returns {typeof DEFAULTS}
 */
function load(userDataPath, opts = {}) {
  codec = {
    serialize: opts.serialize ?? defaultSerialize,
    deserialize: opts.deserialize ?? defaultDeserialize
  };

  // Resolve the document store and read the row OUTSIDE the minimal catch-all
  // below: an app-db-not-open error is a programmer error (mis-ordered boot)
  // and must propagate — never dissolve into "fall back to defaults" (design
  // review, same discipline as settings/downloads/session/jars). The
  // catch-all still preserves "boot on corrupt state" for everything else.
  docStore = appDb.createDocumentStore('shields');
  const row = docStore.read();

  if (row !== null) {
    config = parseAndRepair(row);
    return config;
  }

  try {
    const file = path.join(userDataPath, FILE_NAME);
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8');
      config = parseAndRepair(raw);
      // One-time migration: the repaired result becomes the row (even a
      // corrupt legacy file migrates its repaired-to-defaults result — DD5),
      // then the legacy file is renamed to mark it superseded.
      save();
      try {
        fs.renameSync(file, file + '.migrated');
      } catch {
        // best-effort — migration already completed via the row write (DD5).
      }
    } else {
      config = { ...DEFAULTS };
    }
  } catch {
    // Any error (read failure, etc.) → fall back to defaults.
    // load() MUST NEVER THROW — the app must still boot.
    config = { ...DEFAULTS };
  }

  return config;
}

// DD10 (refined by design review): the not-loaded state (no prior load())
// stays a silent no-op — today's semantics, depended on by ~9 pre-load
// mutation call sites in shields.test.js (lines 65-191, none throw-wrapped).
// Once loaded, the row write is UNGUARDED: a write failure propagates
// (uncaught) rather than being swallowed, so a caller (and its IPC handler)
// learns the set failed.
function save() {
  if (!docStore) return;
  docStore.write(codec.serialize(config));
}

function get() {
  return config;
}

function set(patch) {
  if (!patch || typeof patch !== 'object') return config;
  const next = { ...config };
  for (const key of Object.keys(patch)) {
    // Only known DEFAULTS keys; ignore unknown / wrong-typed values.
    if (!Object.hasOwn(DEFAULTS, key)) continue;
    const val = patch[key];
    if (key === 'pausedSites') {
      next.pausedSites = normalizePausedSites(val);
    } else if (typeof val === typeof DEFAULTS[key]) {
      next[key] = val;
    }
  }
  config = next;
  save();
  return config;
}

function isPaused(site) {
  return !!site && Array.isArray(config.pausedSites) && config.pausedSites.includes(site);
}

function setPaused(site, paused) {
  const s = new Set(normalizePausedSites(config.pausedSites));
  paused ? s.add(site) : s.delete(site);
  config.pausedSites = [...s];
  save();
  return config;
}

// Is a strategy active for a given first-party site (master on, strategy on,
// site not paused)?
function active(strategy, site) {
  return config.enabled && config[strategy] && !isPaused(site);
}

// --- tracking parameter stripping ---------------------------------------

const TRACKING_PARAMS = new Set([
  'gclid',
  'gclsrc',
  'dclid',
  'gbraid',
  'wbraid',
  'gad_source',
  'fbclid',
  'msclkid',
  'yclid',
  'twclid',
  'ttclid',
  'igshid',
  'igsh',
  'mc_eid',
  'mc_cid',
  'mkt_tok',
  'vero_id',
  'vero_conv',
  '_openstat',
  'oly_anon_id',
  'oly_enc_id',
  'wickedid',
  'li_fat_id',
  'rb_clickid',
  's_cid',
  'icid',
  'ir_clickid',
  '_hsenc',
  '_hsmi',
  'ml_subscriber',
  'ml_subscriber_hash',
  'guccounter',
  'guce_referrer',
  'guce_referrer_sig'
]);

function isTrackingParam(key) {
  const k = key.toLowerCase();
  return (
    TRACKING_PARAMS.has(k) ||
    k.startsWith('utm_') ||
    k.startsWith('hsa_') ||
    k.startsWith('pk_') ||
    k.startsWith('mtm_')
  );
}

// Returns a cleaned URL string if any tracking params were removed, else null.
function stripUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (![...u.searchParams.keys()].some(isTrackingParam)) return null;
    for (const key of [...u.searchParams.keys()]) {
      if (isTrackingParam(key)) u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return null;
  }
}

module.exports = { DEFAULTS, load, save, get, set, isPaused, setPaused, active, stripUrl, isTrackingParam };
