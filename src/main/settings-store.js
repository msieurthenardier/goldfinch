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
const { SEARCH_ENGINE_IDS } = require('../shared/search-engines');
const appDb = require('./app-db');

// ---------------------------------------------------------------------------
// Schema defaults
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   version: number,
 *   homePage: string | null,
 *   toolbarPins: { media: boolean, shields: boolean, devtools: boolean },
 *   automationEnabled: boolean,
 *   automationKeyHashes: Record<string, string>,
 *   automationAdminKeyHash: string,
 *   automationPort: number,
 *   spellcheck: boolean,
 *   restoreSession: boolean,
 *   vaultAutoLockMinutes: number,
 *   bookmarksBarEnabled: boolean,
 *   searchEngine: string | null
 * }} Settings
 */

/** @type {Settings} */
const DEFAULTS = {
  // v2 (issue #117): the restoreSession default flipped false → true. Stored
  // rows with version < 2 pass through migrateStored() below before repair.
  //
  // v3 (M16 Flight 1 "Search Engine as a Preference" / DD5): no default
  // CHANGED — the bump exists only to force a save-on-migrate persist. This is
  // a DELIBERATE DEPARTURE from this ladder's own convention (see the
  // automationEnabled comment below: "the version ladder in migrateStored()
  // exists only for changed defaults on EXISTING keys, never for additive
  // ones"). searchEngine below is a brand-new additive key that would
  // ordinarily skip the ladder entirely, exactly like spellcheck or
  // bookmarksBarEnabled — it doesn't, because the mission's resolved ruling
  // requires BOTH searchEngine and homePage pinned explicit to disk for every
  // profile that runs this build, now, while both are legitimately
  // Google-by-default: an existing profile that never touched settings is, on
  // disk, indistinguishable from a fresh install, and Flight 2's flip to
  // unset-by-default must reach only the latter. The v2→v3 migrateStored()
  // rung below carries no transform of its own — the unconditional version
  // stamp IS the mechanism, since it flags `migrated: true` and trips load()'s
  // existing save-on-migrate save(). A row-less profile has no rung to run at
  // all, so it gets the equivalent best-effort pin directly in load()'s no-row
  // branch — see the "DD5: row-less pin" comment there.
  version: 3,
  homePage: 'https://www.google.com',
  toolbarPins: { media: true, shields: true, devtools: false },
  // Automation surface gating (Flight 4). off-by-default: the MCP surface binds
  // under --automation-dev but the auth gate 401s everything until this is true
  // AND a valid key is presented. Additive keys — no schema version bump (load()
  // merges over Object.keys(DEFAULTS); the version ladder in migrateStored()
  // exists only for changed defaults on EXISTING keys, never for additive ones).
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
  // Restore session on startup (M09 Flight 9 / DD7; default flipped ON by
  // issue #117 — shipping it off meant no snapshot was ever captured, so a lost
  // session was unrecoverable, and the M09 "regression baseline" rationale for
  // default-off is superseded). The v1 → v2 step in migrateStored() discards the
  // serializer-frozen `false` from v1 rows so the flip reaches existing profiles.
  // Follows the automationEnabled template — an explicit strict-boolean validator
  // (NOT spellcheck's typeof-fallback). Read directly by main at whenReady
  // (startup-only, no live side-effect); a clean-start-per-launch preference is
  // the Settings → Startup toggle.
  restoreSession: true,
  // Vault idle auto-lock timeout, in minutes (Mission 12 Flight 1 / Leg 2). The
  // password-manager MRK auto-locks after this many minutes of inactivity. Additive
  // integer key — no schema version bump; follows the automationPort integer-range
  // template (an explicit [1, 1440] validator, NOT the typeof fallback). Read by the
  // vault-store's injected getAutoLockMinutes at each operation to arm the idle timer.
  vaultAutoLockMinutes: 10,
  // Bookmarks bar visibility (M15 F1 Leg 3 / DD7). Off-by-default (a new chrome
  // row must not appear unannounced on upgrade). Additive boolean — no schema
  // version bump, no migration; the restoreSession template (explicit strict-
  // boolean validator, NOT the typeof fallback — see VALIDATORS below). Read by
  // window-controller.js's applyBookmarksBar at boot and live via the
  // settings-changed broadcast (multi-window sync); flipped from either the
  // Settings checkbox or Ctrl+Shift+B (toggle-bookmarks-bar main-side channel).
  bookmarksBarEnabled: false,
  // Search engine for address-bar searches and the page "Search for …" context
  // item (M16 Flight 1 "Search Engine as a Preference" / DD1). Stores a
  // curated ENGINE ID, never a URL template — VALIDATORS.searchEngine below
  // checks membership against src/shared/search-engines.js's SEARCH_ENGINE_IDS,
  // the single table both this validator and (leg 2) the renderer's URL
  // construction read from, so a stored value can never smuggle an arbitrary
  // URL. Defaults to 'google', matching the hardcoded Google URL this
  // preference replaces (navigation-controller.js's toUrl, leg 2) — nothing in
  // this flight may regress an existing install. `null` is representable (DD2
  // — homePage and searchEngine share one unset sentinel, since persistence is
  // a JSON document row with no schema-level "nullable" concept) but is NEVER
  // the default here; the flip to unset-by-default is Flight 2's, once the
  // welcome-page surface that handles unset exists. This key is why DEFAULTS.
  // version bumped to 3 — see the version comment above.
  searchEngine: 'google'
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
  // home page (it would silently strand the user on a blank tab). Widened for
  // `null` (M16 F1 / DD2): null is the ONE unset representation for this key —
  // `''` remains invalid, same as before, so unset can never mean two
  // different stored things. Nothing in this flight WRITES null (Flight 2's
  // clear affordance does); the validator accepts it now so a null value
  // survives repair once Flight 2 starts producing it.
  homePage: (v) =>
    v === null ||
    (typeof v === 'string' &&
      isSafeTabUrl(v) &&
      v.trim().toLowerCase() !== 'about:blank'),

  // searchEngine (M16 F1 / DD1, DD2): null (unset — see homePage above) or
  // membership in the curated table's id set. Deliberately a MEMBERSHIP check,
  // not a shape check (e.g. "is a string") — DD8 (M15 debrief house rule)
  // requires refusal claims to be executable: relaxing this to `typeof v ===
  // 'string'` must redden at least one unit test (search-engines.test.js's
  // negative-control assertions), never silently pass. A removed/renamed
  // engine id repairs to the default at load, same as any other rejected value.
  searchEngine: (v) => v === null || SEARCH_ENGINE_IDS.has(/** @type {any} */ (v)),

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

  // bookmarksBarEnabled: strictly boolean (M15 F1 Leg 3 / DD7) — the
  // restoreSession template, NOT the typeof-fallback (a boolean-typed key still
  // needs an explicit validator to reject e.g. a stray truthy string cleanly —
  // consistency with automationEnabled/restoreSession, not a null/array hazard
  // like the object-typed keys above).
  bookmarksBarEnabled: (v) => typeof v === 'boolean',

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

// ---------------------------------------------------------------------------
// Version-gated migration ladder (cumulative steps, run before repairConfig).
//
// Per-rung guards (M16 F1 / DD5 implementation trap): each transform is gated
// on its OWN `from` threshold, not on the single "from < DEFAULTS.version"
// check that used to double as both "should we migrate at all" and "should we
// run the v1→v2 transform" — those were the same condition only while
// DEFAULTS.version was 2. Bumping the version constant without re-guarding the
// v1→v2 transform would wrongly re-run it (discard restoreSession) on every v2
// row, not just genuine v1 rows.
//
// v1 → v2 (issue #117): the restoreSession default flipped false → true. save()
// has always serialized the WHOLE config object, so every v1 row touched by any
// set() carries an explicit `restoreSession: false` stamped by the serializer —
// indistinguishable from a deliberate opt-out. The step discards the stored
// value so the key refills from DEFAULTS (true). Accepted trade-off (issue
// #117): a deliberate 0.10–0.11 opt-out is overridden once; the toggle remains.
//
// v2 → v3 (M16 F1 / DD5): NO transform of its own — there is nothing to
// discard or reshape. The rung's entire content is the unconditional version
// stamp at the end of this function, whose sole purpose is flagging
// `migrated: true` so load()'s save-on-migrate path force-persists the
// resolved config (searchEngine + homePage explicit on disk — see the
// DEFAULTS.version comment for the full rationale). Do not invent a v3
// transform here; there isn't one.
// ---------------------------------------------------------------------------

/**
 * @param {any} stored — the deserialized row/legacy payload, pre-repair
 * @returns {{ stored: any, migrated: boolean }}
 */
function migrateStored(stored) {
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) {
    return { stored, migrated: false };
  }
  // An absent/non-integer version cannot prove v2+ — treat as v1 (migrate).
  const from =
    typeof stored.version === 'number' && Number.isInteger(stored.version)
      ? stored.version
      : 1;
  if (from >= DEFAULTS.version) {
    return { stored, migrated: false };
  }
  const next = { ...stored };
  // v1 → v2: discard restoreSession (repairConfig refills it from DEFAULTS).
  // Re-guarded on `from < 2` specifically — see the per-rung note above — so a
  // v2 row bumped to v3 does NOT re-discard a deliberate restoreSession:false
  // opt-out.
  if (from < 2) {
    delete next.restoreSession;
  }
  // v2 → v3: the stamp itself is the whole rung (see the comment block above).
  next.version = DEFAULTS.version;
  return { stored: next, migrated: true };
}

/**
 * Deserialize + migrate + repair raw bytes (a document row payload or legacy
 * JSON file contents). NEVER throws — a deserialize failure (corrupt bytes)
 * repairs to fresh defaults, same as today's corrupt-file handling.
 *
 * Returns `needsPersist` rather than reusing migrateStored()'s `migrated` name
 * (M16 F1 / DD5 design-review finding): the two questions are related but not
 * identical. `migrated` means "the ladder actually transformed the stored
 * shape"; `needsPersist` means "the resolved config the caller is about to use
 * differs from what is currently on disk, so the pin-on-load rule (load()'s
 * row-present branch) must write it back." Those coincide for a version-ladder
 * migration, but NOT for corrupt bytes: the catch below resolves to fresh
 * defaults in memory — a resolved config that, for a genuinely corrupt row,
 * has never actually been written anywhere — so it must also request a
 * persist. The old shape hardcoded `migrated: false` here, which meant a
 * corrupt DOCUMENT ROW (as opposed to a corrupt legacy settings.json, which
 * saves unconditionally on the other path) was repaired only in memory and
 * silently never written back — caught by design review, not by the original
 * implementation.
 * @param {string} raw
 * @returns {{ config: Settings, needsPersist: boolean }}
 */
function parseAndRepair(raw) {
  try {
    const { stored, migrated } = migrateStored(codec.deserialize(raw));
    return { config: repairConfig(stored), needsPersist: migrated };
  } catch {
    return { config: freshDefaults(), needsPersist: true };
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
    const parsed = parseAndRepair(row);
    config = parsed.config;
    if (parsed.needsPersist) {
      // Pin-on-load (M16 F1 / DD5): a version-ladder migration OR a corrupt-row
      // repair both leave the resolved config different from what's on disk —
      // persist it. Best-effort inside load()'s never-throw contract: on a
      // failed write the idempotent ladder/repair simply re-runs at the next
      // load (Edge Cases: in-memory config is already correct either way).
      try {
        save(config);
      } catch {
        // best-effort — the in-memory config is already correct.
      }
    }
    return config;
  }

  try {
    const file = path.join(dir, 'settings.json');
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8');
      config = parseAndRepair(raw).config;
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
      // DD5: row-less pin. No settings row AND no legacy settings.json means
      // this profile has never run with the preference system at all — fresh
      // install, or (this flight's whole point) an existing profile that
      // simply never touched Settings. Both are, on disk, indistinguishable
      // from each other, and per the DEFAULTS.version comment, both must be
      // pinned Google-explicit now so that "no row" once again means exactly
      // "never ran this build" after this flight lands — which is what Flight
      // 2's flip to an unset-by-default fresh profile needs to target.
      // Best-effort, same never-throw posture as the migration save above: a
      // failed pin leaves in-memory defaults correct and simply retries next
      // load (idempotent).
      config = freshDefaults();
      try {
        save(config);
      } catch {
        // best-effort — the in-memory config is already correct defaults.
      }
    }
  } catch {
    // Any error (read failure, etc.) → fall back to defaults, WITHOUT
    // attempting a pin (Edge Cases: the never-throw boot contract outranks
    // pinning in this vanishingly rare path — a save() here would sit inside
    // the same try that just proved something upstream is throwing, e.g.
    // fs.existsSync; the idempotent pin above simply retries at the next
    // load).
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
