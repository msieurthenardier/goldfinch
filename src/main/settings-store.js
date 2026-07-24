// @ts-check
'use strict';

// Settings store: durable, secure, schema-versioned app preferences.
//
// Design:
// - ELECTRON-FREE: does NOT require('electron'), does NOT call app.getPath at
//   module scope. The userData path is INJECTED at load(userDataPath).
// - Persists through app-db.js's `documents` row seam (flight 10-1 DD2-DD4):
//   one row keyed 'settings', written wholesale on every save(). A one-time
//   legacy migration reads `settings.json` when no row exists yet, repairs it
//   through the SAME merge-with-repair logic below, writes the row, then
//   renames the file `.migrated` (best-effort — DD5).
// - Safe-default repair: corrupt/unreadable data → defaults (load never throws);
//   a bad single field is repaired to default while valid siblings are kept.
// - Pluggable serialization seam (DD6): load/save use a { serialize, deserialize }
//   pair defaulting to JSON.stringify/JSON.parse so a future safeStorage backend
//   replaces only the pair, not the schema or the document-row write path.
// - Validated writes: every set() is checked before mutating; unknown keys and
//   invalid values throw TypeError; save() errors propagate so the caller knows.

const fs = require('fs');
const path = require('path');
const { isSafeTabUrl } = require('../shared/url-safety');
const appDb = require('./app-db');

// ---------------------------------------------------------------------------
// Schema defaults
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   version: number,
 *   homePage: string,
 *   toolbarPins: { media: boolean, shields: boolean, devtools: boolean },
 *   automationEnabled: boolean,
 *   automationKeyHashes: Record<string, string>,
 *   automationAdminKeyHash: string,
 *   automationPort: number,
 *   spellcheck: boolean,
 *   restoreSession: boolean,
 *   vaultAutoLockMinutes: number
 * }} Settings
 */

/** @type {Settings} */
const DEFAULTS = {
  version: 1,
  homePage: 'https://www.google.com',
  toolbarPins: { media: true, shields: true, devtools: false },
  // Automation surface gating (Flight 4). off-by-default: the MCP surface binds
  // under --automation-dev but the auth gate 401s everything until this is true
  // AND a valid key is presented. Additive keys — no schema version bump (load()
  // merges over Object.keys(DEFAULTS) with no version-gated migration).
  automationEnabled: false,
  // jarId → SHA-256 hex hash of that jar's automation key (DD5). Plaintext keys
  // are never persisted — only their hashes live here.
  automationKeyHashes: {},
  // SHA-256 hex hash of the admin key, or '' when no admin key is minted (DD6).
  automationAdminKeyHash: '',
  // Configurable MCP listen port (DD1). Default moved off the squatted 7777 into
  // the IANA dynamic range. GOLDFINCH_MCP_PORT env overrides this at resolve time;
  // a change takes effect on next launch (no live rebind).
  automationPort: 49707,
  // In-field spellcheck for web content (Flight 4 / DD1). Opt-in, default OFF so
  // nothing fetches the Chromium Hunspell dictionary until the user enables it.
  // Additive boolean — no schema version bump, no migration. It rides the no-validator
  // typeof-match fallback in load() (typeof false === typeof DEFAULTS.spellcheck), so a
  // settings file written before this leg auto-populates to false. Gated at the SESSION
  // layer in main.js (setSpellCheckerLanguages), never in the WebContentsView's webPreferences
  // (immutable after construction), so the toggle can reach already-open tabs.
  spellcheck: false,
  // Restore session on startup (M09 Flight 9 / DD7). Opt-in, default OFF: with it
  // off, startup is behaviorally byte-identical to today (the mission's absolute
  // regression baseline). Follows the automationEnabled template — an explicit
  // strict-boolean validator (NOT spellcheck's typeof-fallback). Additive, no schema
  // version bump. Read directly by main at whenReady (startup-only, no live side-effect).
  restoreSession: false,
  // Vault idle auto-lock timeout, in minutes (Mission 12 Flight 1 / Leg 2). The
  // password-manager MRK auto-locks after this many minutes of inactivity. Additive
  // integer key — no schema version bump; follows the automationPort integer-range
  // template (an explicit [1, 1440] validator, NOT the typeof fallback). Read by the
  // vault-store's injected getAutoLockMinutes at each operation to arm the idle timer.
  vaultAutoLockMinutes: 10
};

// SHA-256 hex digests are exactly 64 lowercase hex chars.
const HEX64 = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Fresh defaults: returns a deep copy of DEFAULTS so config.toolbarPins is
// never the DEFAULTS.toolbarPins reference (shared-reference hazard guard).
// ---------------------------------------------------------------------------

/** @returns {Settings} */
function freshDefaults() {
  return {
    ...DEFAULTS,
    toolbarPins: { ...DEFAULTS.toolbarPins },
    // Deep-copy the automation key map too — otherwise every load shares the one
    // DEFAULTS.automationKeyHashes object (same shared-reference hazard as toolbarPins).
    automationKeyHashes: { ...DEFAULTS.automationKeyHashes }
  };
}

// ---------------------------------------------------------------------------
// Per-key validators
// Keys without a validator are accepted as-is if the stored value's typeof
// matches the default's typeof (type-compatibility check in merge-with-repair).
// NOTE: typeof null === 'object' and typeof [] === 'object', so any object-typed
// key MUST have an explicit validator — the typeof fallback would wrongly accept
// null and arrays.
// ---------------------------------------------------------------------------

/** @type {Record<string, (v: unknown) => boolean>} */
const VALIDATORS = {
  // about:blank is excluded: isSafeTabUrl admits it but it is not a meaningful
  // home page (it would silently strand the user on a blank tab).
  homePage: (v) =>
    typeof v === 'string' &&
    isSafeTabUrl(v) &&
    v.trim().toLowerCase() !== 'about:blank',

  // toolbarPins: an object of booleans — lenient on which keys are present
  // (forward-compat: a future 3rd pinnable item in DEFAULTS is filled by the
  // normalizer even if the stored map lacks it). Rejects null, arrays, and
  // non-boolean values.
  toolbarPins: (v) =>
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.values(/** @type {object} */ (v)).every((x) => typeof x === 'boolean'),

  // automationEnabled: strictly boolean (no truthy coercion).
  automationEnabled: (v) => typeof v === 'boolean',

  // restoreSession: strictly boolean (M09 Flight 9 / DD7) — the automationEnabled
  // template, so a truthy 'yes'/1 is rejected rather than silently enabling restore.
  restoreSession: (v) => typeof v === 'boolean',

  // automationKeyHashes: a plain object (NOT null, NOT an array) whose every
  // value is a 64-char lowercase-hex SHA-256 digest. Deliberately strict — it
  // does NOT ride toolbarPins' lenient boolean-map pattern. A non-hex / null /
  // array value rejects the whole map, so validateKey only ever sees clean hex.
  automationKeyHashes: (v) =>
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.values(/** @type {object} */ (v)).every(
      (x) => typeof x === 'string' && HEX64.test(x)
    ),

  // automationAdminKeyHash: '' (no admin key) or a 64-char lowercase-hex digest.
  automationAdminKeyHash: (v) =>
    typeof v === 'string' && (v === '' || HEX64.test(v)),

  // automationPort: an integer in the registered/dynamic port range [1024, 65535].
  // Number.isInteger rejects strings, null, arrays, booleans, and non-integers —
  // no extra guards needed.
  automationPort: (v) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 1024 && v <= 65535,

  // vaultAutoLockMinutes: an integer in [1, 1440] (1 min .. 24 h). The
  // automationPort integer-range validator is the template — Number.isInteger
  // rejects strings, null, arrays, booleans, and non-integers; the bounds reject
  // 0/negative and anything over a day.
  vaultAutoLockMinutes: (v) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 1440
};

// ---------------------------------------------------------------------------
// Per-key normalizers (applied after validation in load + set)
// ---------------------------------------------------------------------------

/** @type {Record<string, (v: any) => any>} */
const NORMALIZERS = {
  // Deep-merge onto defaults: stored {media:false} → {media:false, shields:true}
  // (forward-compat: a future 3rd item in DEFAULTS.toolbarPins defaults to
  // pinned for existing files that lack it — no consumer needs to spread defaults).
  toolbarPins: (v) => ({ ...DEFAULTS.toolbarPins, ...v })
};

// ---------------------------------------------------------------------------
// Module-scoped state
// ---------------------------------------------------------------------------

/** @type {string | null} */
let dir = null;

/** @type {{ read(): string | null, write(payload: string, now?: number): void, remove(): void } | null} */
let docStore = null;

/** @type {Settings} */
let config = freshDefaults();

const defaultSerialize = (/** @type {object} */ c) => JSON.stringify(c, null, 2);
const defaultDeserialize = (/** @type {string} */ s) => JSON.parse(s);

/** @type {{ serialize: (c: object) => string, deserialize: (s: string) => any }} */
let codec = { serialize: defaultSerialize, deserialize: defaultDeserialize };

// ---------------------------------------------------------------------------
// Merge-with-repair: start from a fresh copy of DEFAULTS, then for each known
// key, take the stored value only if it passes validation (or, for keys
// without a validator, only if the typeof matches the default). Shared by the
// row-read path and the legacy-JSON migration path — same repair semantics
// either way.
// ---------------------------------------------------------------------------

/**
 * @param {any} stored
 * @returns {Settings}
 */
function repairConfig(stored) {
  const merged = /** @type {any} */ (freshDefaults());
  for (const key of /** @type {(keyof typeof DEFAULTS)[]} */ (Object.keys(DEFAULTS))) {
    if (Object.prototype.hasOwnProperty.call(stored, key)) {
      const val = stored[key];
      const validator = Object.hasOwn(VALIDATORS, key) ? VALIDATORS[key] : null;
      const normalizer = Object.hasOwn(NORMALIZERS, key) ? NORMALIZERS[key] : null;
      if (validator) {
        if (validator(val)) {
          // Apply normalizer to the validated value (e.g. deep-merge toolbarPins
          // onto defaults for forward-compat — a future 3rd item fills in here).
          merged[key] = normalizer ? normalizer(val) : val;
        }
        // else: keep the default (repair)
      } else {
        // No validator: accept if type-compatible with the default.
        // NOTE: typeof null === 'object' — object-typed keys must have an explicit
        // validator (see VALIDATORS above) to avoid accepting null/arrays here.
        if (typeof val === typeof DEFAULTS[key]) {
          merged[key] = normalizer ? normalizer(val) : val;
        }
      }
    }
  }
  return merged;
}

/**
 * Deserialize + repair raw bytes (a document row payload or legacy JSON file
 * contents). NEVER throws — a deserialize failure (corrupt bytes) repairs to
 * fresh defaults, same as today's corrupt-file handling.
 * @param {string} raw
 * @returns {Settings}
 */
function parseAndRepair(raw) {
  try {
    return repairConfig(codec.deserialize(raw));
  } catch {
    return freshDefaults();
  }
}

// ---------------------------------------------------------------------------
// load(userDataPath, opts?)
// ---------------------------------------------------------------------------

/**
 * Initialise the store. Must be called before get/set.
 * Safe to call again (re-reads the row; merges onto fresh DEFAULTS).
 *
 * @param {string} userDataPath — the Electron userData directory (injected from whenReady).
 * @param {{ serialize?: (c: object) => string, deserialize?: (s: string) => any }} [opts]
 * @returns {Settings}
 */
function load(userDataPath, opts = {}) {
  dir = userDataPath;
  codec = {
    serialize: opts.serialize ?? defaultSerialize,
    deserialize: opts.deserialize ?? defaultDeserialize
  };

  // Resolve the document store and read the row OUTSIDE the catch-all below:
  // an app-db-not-open error is a programmer error (mis-ordered boot) and
  // must propagate — never dissolve into "fall back to defaults" (design
  // review). The never-throw contract below still covers everything else
  // (JSON parse, repair, migration rename).
  docStore = appDb.createDocumentStore('settings');
  const row = docStore.read();

  if (row !== null) {
    config = parseAndRepair(row);
    return config;
  }

  try {
    const file = path.join(dir, 'settings.json');
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8');
      config = parseAndRepair(raw);
      // One-time migration: the repaired result becomes the row (even a
      // corrupt legacy file migrates its repaired-to-defaults result — DD5),
      // then the legacy file is renamed to mark it superseded.
      save(config);
      try {
        fs.renameSync(file, file + '.migrated');
      } catch {
        // best-effort — migration already completed via the row write (DD5).
      }
    } else {
      config = freshDefaults();
    }
  } catch {
    // Any error (read failure, etc.) → fall back to defaults.
    // load() MUST NEVER THROW — the app must still boot.
    config = freshDefaults();
  }

  return config;
}

// ---------------------------------------------------------------------------
// save()
// ---------------------------------------------------------------------------

/**
 * Persist the current config to its document row.
 * Errors PROPAGATE — do not swallow (callers / the bridge learn the set failed).
 */
function save(nextConfig = config) {
  /** @type {any} */ (docStore).write(codec.serialize(nextConfig));
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
 * @returns {Settings}
 */
function getAll() {
  return {
    ...config,
    toolbarPins: { ...config.toolbarPins },
    // Deep-copy the key map so callers can't mutate the live stored map through
    // the returned reference (same guard as toolbarPins).
    automationKeyHashes: { ...config.automationKeyHashes }
  };
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
 * @returns {Settings}
 */
function set(key, value) {
  if (dir === null) {
    throw new Error('settings-store: set before load');
  }
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
    throw new TypeError('unknown settings key: "' + key + '"');
  }
  const validator = Object.hasOwn(VALIDATORS, key) ? VALIDATORS[key] : null;
  if (validator ? !validator(value) : typeof value !== typeof DEFAULTS[key]) {
    throw new TypeError('invalid value for "' + key + '"');
  }
  // Normalize after validation (e.g. partial toolbarPins → full map).
  const normalizer = Object.hasOwn(NORMALIZERS, key) ? NORMALIZERS[key] : null;
  const nextConfig = { ...config, [key]: normalizer ? normalizer(value) : value };
  save(nextConfig); // propagates on error
  config = nextConfig;
  return config;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { DEFAULTS, load, get, getAll, set };
