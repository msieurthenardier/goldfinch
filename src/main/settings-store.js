// @ts-check
'use strict';

// Settings store: durable, secure, schema-versioned app preferences.
//
// Design:
// - ELECTRON-FREE: does NOT require('electron'), does NOT call app.getPath at
//   module scope. The userData path is INJECTED at load(userDataPath).
// - Atomic persistence: writes to a temp file then renames (same filesystem
//   as the target, so rename is atomic on POSIX and near-atomic on Windows).
// - Safe-default repair: corrupt/unreadable file → defaults (load never throws);
//   a bad single field is repaired to default while valid siblings are kept.
// - Pluggable serialization seam (DD6): load/save use a { serialize, deserialize }
//   pair defaulting to JSON.stringify/JSON.parse so a future safeStorage backend
//   replaces only the pair, not the schema or atomic write path.
// - Validated writes: every set() is checked before mutating; unknown keys and
//   invalid values throw TypeError; save() errors propagate so the caller knows.

const fs = require('fs');
const path = require('path');
const { isSafeTabUrl } = require('../shared/url-safety');

// ---------------------------------------------------------------------------
// Schema defaults
// ---------------------------------------------------------------------------

/** @type {{ version: number, homePage: string }} */
const DEFAULTS = {
  version: 1,
  homePage: 'https://www.google.com'
};

// ---------------------------------------------------------------------------
// Per-key validators
// Keys without a validator are accepted as-is if the stored value's typeof
// matches the default's typeof (type-compatibility check in merge-with-repair).
// ---------------------------------------------------------------------------

/** @type {Record<string, (v: unknown) => boolean>} */
const VALIDATORS = {
  // about:blank is excluded: isSafeTabUrl admits it but it is not a meaningful
  // home page (it would silently strand the user on a blank tab).
  homePage: (v) =>
    typeof v === 'string' &&
    isSafeTabUrl(v) &&
    v.trim().toLowerCase() !== 'about:blank'
};

// ---------------------------------------------------------------------------
// Module-scoped state
// ---------------------------------------------------------------------------

/** @type {string | null} */
let dir = null;

/** @type {{ version: number, homePage: string }} */
let config = { ...DEFAULTS };

const defaultSerialize = (/** @type {object} */ c) => JSON.stringify(c, null, 2);
const defaultDeserialize = (/** @type {string} */ s) => JSON.parse(s);

/** @type {{ serialize: (c: object) => string, deserialize: (s: string) => any }} */
let codec = { serialize: defaultSerialize, deserialize: defaultDeserialize };

// ---------------------------------------------------------------------------
// load(userDataPath, opts?)
// ---------------------------------------------------------------------------

/**
 * Initialise the store. Must be called before get/set.
 * Safe to call again (re-reads the file; merges onto fresh DEFAULTS).
 *
 * @param {string} userDataPath — the Electron userData directory (injected from whenReady).
 * @param {{ serialize?: (c: object) => string, deserialize?: (s: string) => any }} [opts]
 * @returns {{ version: number, homePage: string }}
 */
function load(userDataPath, opts = {}) {
  dir = userDataPath;
  codec = {
    serialize: opts.serialize ?? defaultSerialize,
    deserialize: opts.deserialize ?? defaultDeserialize
  };

  try {
    const file = path.join(dir, 'settings.json');
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8');
      const stored = codec.deserialize(raw);

      // Merge-with-repair: start from a fresh copy of DEFAULTS, then for each
      // known key, take the stored value only if it passes validation (or, for
      // keys without a validator, only if the typeof matches the default).
      const merged = /** @type {any} */ ({ ...DEFAULTS });
      for (const key of /** @type {(keyof typeof DEFAULTS)[]} */ (Object.keys(DEFAULTS))) {
        if (Object.prototype.hasOwnProperty.call(stored, key)) {
          const val = stored[key];
          if (VALIDATORS[key]) {
            if (VALIDATORS[key](val)) {
              merged[key] = val;
            }
            // else: keep the default (repair)
          } else {
            // No validator: accept if type-compatible with the default
            if (typeof val === typeof DEFAULTS[key]) {
              merged[key] = val;
            }
          }
        }
      }
      config = merged;
    } else {
      config = { ...DEFAULTS };
    }
  } catch {
    // Any error (corrupt JSON, read error, etc.) → fall back to defaults.
    // load() MUST NEVER THROW — the app must still boot.
    config = { ...DEFAULTS };
  }

  return config;
}

// ---------------------------------------------------------------------------
// save()
// ---------------------------------------------------------------------------

/**
 * Atomically persist the current config to settings.json.
 * The temp file lives BESIDE the target in dir (not os.tmpdir) so that the
 * rename is atomic on the same filesystem.
 * Errors PROPAGATE — do not swallow (callers / the bridge learn the set failed).
 */
function save() {
  const file = path.join(/** @type {string} */ (dir), 'settings.json');
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, codec.serialize(config));
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------------------
// get / getAll
// ---------------------------------------------------------------------------

/**
 * @param {keyof typeof DEFAULTS} key
 * @returns {any}
 */
function get(key) {
  return config[key];
}

/**
 * @returns {{ version: number, homePage: string }}
 */
function getAll() {
  return { ...config };
}

// ---------------------------------------------------------------------------
// set(key, value)
// ---------------------------------------------------------------------------

/**
 * Validate and persist a single setting.
 *
 * Throws:
 *   Error       — if called before load() (dir is null)
 *   TypeError   — if key is not in DEFAULTS (unknown key)
 *   TypeError   — if the value fails the key's validator
 *
 * On success: mutates config (copy-on-write), persists atomically, returns
 * the updated config. A save() error propagates so the caller knows.
 *
 * Validates BEFORE mutating so the prior value is kept on rejection.
 *
 * @param {string} key
 * @param {unknown} value
 * @returns {{ version: number, homePage: string }}
 */
function set(key, value) {
  if (dir === null) {
    throw new Error('settings-store: set before load');
  }
  if (!(key in DEFAULTS)) {
    throw new TypeError('unknown settings key: "' + key + '"');
  }
  if (VALIDATORS[key] && !VALIDATORS[key](value)) {
    throw new TypeError('invalid value for "' + key + '"');
  }
  config = { ...config, [key]: value };
  save(); // propagates on error
  return config;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { DEFAULTS, load, get, getAll, set };
