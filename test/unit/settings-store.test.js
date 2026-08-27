'use strict';

// Unit tests for src/main/settings-store.js
//
// No Electron stub needed — the module is Electron-free (no require('electron'),
// no app.getPath at module scope). The userData path is injected via load().
//
// Each test creates a real temp dir and cleans up after itself. settings-store
// now persists through app-db.js's document-row seam (flight 10-1 DD2-DD4):
// app-db is required ONCE for the whole file (never cache-busted — cache-busting
// both singletons creates a require-order hazard, design review) and reset per
// test via appDb.open(dir) (safe close-then-reopen, DD4).
//
// Each test (or setup) creates a real temp dir and cleans up after itself.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const appDb = require('../../src/main/app-db');
// require(esm) — same synchronous-ESM-from-CJS idiom settings-store.js itself
// uses for src/shared/ imports (Node ≥22).
const { SEARCH_ENGINE_IDS } = require('../../src/shared/search-engines');

// ---------------------------------------------------------------------------
// Helper: create a fresh temp dir and return it, plus a cleanup function.
// ---------------------------------------------------------------------------
function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-settings-'));
}

function removeTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Read the raw 'settings' document row payload directly off app.db, bypassing
// the store — used to assert on the row (the migration target) the way older
// tests asserted on settings.json directly.
function readRow(dir) {
  const check = new DatabaseSync(path.join(dir, 'app.db'));
  try {
    const row = /** @type {any} */ (check.prepare('SELECT payload FROM documents WHERE store = ?1').get('settings'));
    return row ? row.payload : null;
  } finally {
    check.close();
  }
}

// ---------------------------------------------------------------------------
// Re-require settings-store fresh per test group so module-scoped state
// (dir, config, codec) doesn't leak across tests.
//
// Node's module cache means a plain require() after the first will return the
// same instance. We reload by deleting from the cache each time. app-db is
// NOT cache-busted here — settings-store's own `require('./app-db')` resolves
// against the SAME live singleton every time (design review: re-requiring
// both would create a require-order hazard where a re-required store
// captures a stale app-db instance).
// ---------------------------------------------------------------------------
function freshStore() {
  // Delete from cache so the next require() re-evaluates the module.
  const resolved = require.resolve('../../src/main/settings-store');
  delete require.cache[resolved];
  return require('../../src/main/settings-store');
}

// ---------------------------------------------------------------------------
// Test: defaults on first load (no settings.json present)
// ---------------------------------------------------------------------------
// RENAMED (M16 F1 / DD5 — was 'defaults on first load — no settings.json
// present'): the old name and body pinned "a fresh profile's config exists
// only in memory, no row write" — the EXACT OPPOSITE of pin-on-load. Renamed
// rather than deleted-and-re-added so git blame documents the intent shift
// (Flight Control convention for tests that pin behavior a new design
// deliberately breaks — design review finding, methodology rule).
//
// RENAMED again (M16 F2 L2 / DD5 — was 'defaults on first load — no
// settings.json present, pinned to disk at v3 (DD5)', which pinned
// homePage/searchEngine to the removed engine fallback's URL/id): DEFAULTS
// flips both keys to `null` this leg — a fresh profile is now pinned
// null-explicit, not Google-explicit. The pin-ON-LOAD mechanism itself
// (asserted below) is unchanged.
test('defaults on first load — no settings.json present, pinned to disk at v3 as null/null (DD5)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    const result = store.load(dir);
    assert.equal(result.version, 3);
    assert.equal(result.homePage, null);
    assert.equal(result.searchEngine, null);
    assert.equal(store.get('homePage'), null);
    assert.equal(store.get('version'), 3);
    assert.equal(store.get('searchEngine'), null);

    // DD5 pin-on-load: a row-less profile is pinned explicit at v3 immediately
    // at load, not left row-less until some later set().
    const row = JSON.parse(/** @type {string} */ (readRow(dir)));
    assert.equal(row.version, 3);
    assert.equal(row.homePage, null);
    assert.equal(row.searchEngine, null);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Test: set → persist → reload round-trip
// ---------------------------------------------------------------------------
test('set → persist → reload round-trip', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    store.set('homePage', 'https://example.com/');

    // Reload from same dir — should pick up persisted value
    const result = store.load(dir);
    assert.equal(result.homePage, 'https://example.com/');
    assert.equal(store.get('homePage'), 'https://example.com/');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Test: vaultAutoLockMinutes get/set round-trip + out-of-range rejection (M12 F3 Leg 5).
// The vault page's auto-lock number input binds to this existing settings key over the
// internal-settings-get/set bridge (no new IPC); an out-of-range write throws the validator's
// TypeError → the invoke rejects → the page surfaces it.
// ---------------------------------------------------------------------------
test('vaultAutoLockMinutes: default 10, valid [1,1440] round-trips, out-of-range/non-integer rejected', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    const result = store.load(dir);
    assert.equal(result.vaultAutoLockMinutes, 10, 'default is 10 minutes');
    assert.equal(store.get('vaultAutoLockMinutes'), 10);

    // Valid in-range write round-trips through get + a reload.
    store.set('vaultAutoLockMinutes', 30);
    assert.equal(store.get('vaultAutoLockMinutes'), 30);
    assert.equal(store.load(dir).vaultAutoLockMinutes, 30, 'persisted across reload');

    // The boundaries are accepted.
    store.set('vaultAutoLockMinutes', 1);
    assert.equal(store.get('vaultAutoLockMinutes'), 1);
    store.set('vaultAutoLockMinutes', 1440);
    assert.equal(store.get('vaultAutoLockMinutes'), 1440);

    // Out-of-range + non-integer are rejected by the existing validator (TypeError), and the
    // stored value is unchanged.
    for (const bad of [0, -1, 1441, 5000, 10.5, '30', null, NaN]) {
      assert.throws(() => store.set('vaultAutoLockMinutes', bad), TypeError, `must reject ${String(bad)}`);
    }
    assert.equal(store.get('vaultAutoLockMinutes'), 1440, 'a rejected write leaves the value unchanged');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Test: set() writes a valid JSON row (was: "atomic write produces valid
// JSON on disk" — settings.json is no longer the write target; the document
// row is, per the flight 10-1 migration).
// ---------------------------------------------------------------------------
test('set() persists a valid JSON row', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    store.set('homePage', 'https://test.example.com/');

    const raw = readRow(dir);
    assert.ok(raw !== null, 'settings row should exist after set');
    const parsed = JSON.parse(/** @type {string} */ (raw)); // throws if invalid JSON
    assert.equal(parsed.homePage, 'https://test.example.com/');
    assert.ok(!fs.existsSync(path.join(dir, 'settings.json')), 'set() must not write settings.json');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Test: corrupt file → defaults (no throw)
// ---------------------------------------------------------------------------
test('corrupt file repair → defaults, no throw', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    // Write garbage to settings.json
    fs.writeFileSync(path.join(dir, 'settings.json'), '{{not valid json!!', 'utf8');

    const store = freshStore();
    let result;
    assert.doesNotThrow(() => {
      result = store.load(dir);
    });
    // RENAMED (M16 F2 L2 / DD5 — was 'https://www.google.com'): DEFAULTS.homePage is null now.
    assert.equal(result.homePage, null);
    // v3 (M16 F1 / DD5): the legacy-file import path saves unconditionally, so
    // even a repaired-to-defaults corrupt file lands on disk at the current
    // schema version.
    assert.equal(result.version, 3);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Test: bad single field repaired, valid fields kept
// ---------------------------------------------------------------------------
test('bad-field repair keeps valid siblings', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    // Write a settings.json with an invalid homePage (stored at schema v1)
    const badSettings = JSON.stringify({ homePage: 'javascript:bad', version: 1 });
    fs.writeFileSync(path.join(dir, 'settings.json'), badSettings, 'utf8');

    const store = freshStore();
    const result = store.load(dir);

    // homePage should be repaired to default.
    // RENAMED (M16 F2 L2 / DD5 — was 'https://www.google.com'): DEFAULTS.homePage is null now.
    assert.equal(result.homePage, null, 'invalid homePage should be repaired to default');
    // the migration ladder migrates a v1 row straight to the current schema
    // version (v3, M16 F1 / DD5) — there is no longer an intermediate v2 stop
    // reachable via a single load() call.
    assert.equal(result.version, 3);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Test: set throws on javascript: scheme, prior value kept
// ---------------------------------------------------------------------------
test('set throws on javascript: URL, prior value kept', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    const priorValue = store.get('homePage');

    assert.throws(
      () => store.set('homePage', 'javascript:alert(1)'),
      (err) => err instanceof TypeError && err.message.includes('invalid value')
    );
    // Prior value must be kept
    assert.equal(store.get('homePage'), priorValue);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Test: set throws on goldfinch:// URL
// ---------------------------------------------------------------------------
test('set throws on goldfinch:// URL', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    const priorValue = store.get('homePage');

    assert.throws(
      () => store.set('homePage', 'goldfinch://settings'),
      (err) => err instanceof TypeError && err.message.includes('invalid value')
    );
    assert.equal(store.get('homePage'), priorValue);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Test: set throws on about:blank (excluded even though isSafeTabUrl admits it)
// ---------------------------------------------------------------------------
test('set throws on about:blank (excluded from homePage)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    const priorValue = store.get('homePage');

    assert.throws(
      () => store.set('homePage', 'about:blank'),
      (err) => err instanceof TypeError && err.message.includes('invalid value')
    );
    assert.equal(store.get('homePage'), priorValue);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Test: set accepts https:// URL
// ---------------------------------------------------------------------------
test('set accepts valid https:// URL', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    const updated = store.set('homePage', 'https://valid.example.com/path?q=1');
    assert.equal(updated.homePage, 'https://valid.example.com/path?q=1');
    assert.equal(store.get('homePage'), 'https://valid.example.com/path?q=1');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Test: unknown key throws TypeError
// ---------------------------------------------------------------------------
test('set unknown key throws TypeError', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);

    assert.throws(
      () => store.set('nonExistentKey', 'value'),
      (err) => err instanceof TypeError && err.message.includes('unknown settings key')
    );
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Test: set before load throws a clear Error (not a cryptic null-read)
// ---------------------------------------------------------------------------
test('set before load throws a clear error', () => {
  const store = freshStore();
  // Do NOT call load() — dir is null

  assert.throws(
    () => store.set('homePage', 'https://example.com/'),
    (err) => err instanceof Error && err.message.includes('set before load')
  );
});

// ---------------------------------------------------------------------------
// Test: getAll() returns a shallow copy; mutating it does not affect store state
// ---------------------------------------------------------------------------
test('getAll returns a copy — mutating it does not affect store', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);

    const snapshot = store.getAll();
    const originalValue = snapshot.homePage;

    // Mutate the snapshot
    snapshot.homePage = 'https://mutated.example.com/';

    // Store must be unaffected
    assert.equal(store.get('homePage'), originalValue);
    assert.equal(store.getAll().homePage, originalValue);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Test: version field is present in loaded config
// ---------------------------------------------------------------------------
test('version field is present after load', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    const result = store.load(dir);
    assert.ok('version' in result, 'version key should be present');
    assert.equal(typeof result.version, 'number');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Test: custom serializer round-trip (opts.serialize / opts.deserialize)
// ---------------------------------------------------------------------------
test('custom serializer round-trip', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    // A custom codec that wraps the JSON in a simple envelope string
    // to confirm the seam is actually used.
    const serializeLog = [];
    const deserializeLog = [];

    const customSerialize = (obj) => {
      const s = 'CUSTOM:' + JSON.stringify(obj);
      serializeLog.push(s);
      return s;
    };
    const customDeserialize = (s) => {
      deserializeLog.push(s);
      if (!s.startsWith('CUSTOM:')) throw new Error('unexpected format');
      return JSON.parse(s.slice('CUSTOM:'.length));
    };

    const store = freshStore();
    store.load(dir, { serialize: customSerialize, deserialize: customDeserialize });

    // set() should call serialize
    store.set('homePage', 'https://custom-serializer.example.com/');
    assert.ok(serializeLog.length > 0, 'custom serialize should have been called');

    // Reload: deserialize should be called
    const result = store.load(dir, { serialize: customSerialize, deserialize: customDeserialize });
    assert.ok(deserializeLog.length > 0, 'custom deserialize should have been called');
    assert.equal(result.homePage, 'https://custom-serializer.example.com/');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// toolbarPins tests
// ---------------------------------------------------------------------------

// Test: toolbarPins default on first load
test('toolbarPins — default on first load (no settings.json)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    const result = store.load(dir);
    assert.deepEqual(result.toolbarPins, { media: true, shields: true, devtools: false });
    assert.deepEqual(store.get('toolbarPins'), { media: true, shields: true, devtools: false });
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// Test: set full toolbarPins → persist → reload
test('toolbarPins — set full map persists and reloads', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    store.set('toolbarPins', { media: false, shields: true, devtools: false });

    const result = store.load(dir);
    assert.deepEqual(result.toolbarPins, { media: false, shields: true, devtools: false });
    assert.deepEqual(store.get('toolbarPins'), { media: false, shields: true, devtools: false });
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// Test: set partial {media:false} → normalized to full map (missing keys → defaults)
test('toolbarPins — set partial map normalizes to full map', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    store.set('toolbarPins', { media: false });

    // After set, both get and getAll should return the normalized full map
    assert.deepEqual(store.get('toolbarPins'), { media: false, shields: true, devtools: false });
    assert.deepEqual(store.getAll().toolbarPins, { media: false, shields: true, devtools: false });

    // Also verify persistence: reload should preserve the normalized value
    const result = store.load(dir);
    assert.deepEqual(result.toolbarPins, { media: false, shields: true, devtools: false });
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// Test: devtools defaults to false; a settings file written before this leg (only
// {media,shields}, no devtools) auto-populates devtools:false via the normalizer
// (forward-compat — no version bump, no migration). And a devtools:true write
// persists across a reload (the pin-state-persists-across-restart contract).
test('toolbarPins — devtools default false + persistence round-trip', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    // Simulate a pre-leg settings file lacking the devtools key.
    const store = freshStore();
    store.load(dir);
    store.set('toolbarPins', { media: true, shields: false });
    // Reload: the normalizer fills the missing devtools key with its default (false).
    let result = store.load(dir);
    assert.equal(result.toolbarPins.devtools, false);
    assert.deepEqual(store.get('toolbarPins'), { media: true, shields: false, devtools: false });

    // Pin DevTools and reload: the pinned state survives the round-trip.
    store.set('toolbarPins', { media: true, shields: false, devtools: true });
    result = store.load(dir);
    assert.equal(result.toolbarPins.devtools, true);
    assert.deepEqual(store.get('toolbarPins'), { media: true, shields: false, devtools: true });
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// Test: set throws on invalid toolbarPins values, prior value kept
test('toolbarPins — set throws on null, prior value kept', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    const prior = store.get('toolbarPins');

    assert.throws(
      () => store.set('toolbarPins', null),
      (err) => err instanceof TypeError && err.message.includes('invalid value')
    );
    assert.deepEqual(store.get('toolbarPins'), prior);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('toolbarPins — set throws on array, prior value kept', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    const prior = store.get('toolbarPins');

    assert.throws(
      () => store.set('toolbarPins', []),
      (err) => err instanceof TypeError && err.message.includes('invalid value')
    );
    assert.deepEqual(store.get('toolbarPins'), prior);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('toolbarPins — set throws on string, prior value kept', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    const prior = store.get('toolbarPins');

    assert.throws(
      () => store.set('toolbarPins', 'x'),
      (err) => err instanceof TypeError && err.message.includes('invalid value')
    );
    assert.deepEqual(store.get('toolbarPins'), prior);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('toolbarPins — set throws on non-boolean value, prior value kept', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    const prior = store.get('toolbarPins');

    assert.throws(
      () => store.set('toolbarPins', { media: 'no' }),
      (err) => err instanceof TypeError && err.message.includes('invalid value')
    );
    assert.deepEqual(store.get('toolbarPins'), prior);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// Test: load stored partial {media:false} → {media:false, shields:true} (forward-compat)
test('toolbarPins — load stored partial map merges with defaults (forward-compat)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    // Write a settings.json with only media:false (shields missing — simulates a future file
    // read by an older build, or a file written before shields was added)
    const partial = JSON.stringify({ version: 1, homePage: 'https://www.google.com', toolbarPins: { media: false } });
    fs.writeFileSync(path.join(dir, 'settings.json'), partial, 'utf8');

    const store = freshStore();
    const result = store.load(dir);

    // Both get() and getAll() must return the fully-merged map (missing shields AND
    // devtools both filled from DEFAULTS — devtools defaults to false, shields true)
    assert.deepEqual(result.toolbarPins, { media: false, shields: true, devtools: false });
    assert.deepEqual(store.get('toolbarPins'), { media: false, shields: true, devtools: false });
    assert.deepEqual(store.getAll().toolbarPins, { media: false, shields: true, devtools: false });
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// Test: load malformed toolbarPins (string) → default {media:true, shields:true}
test('toolbarPins — load malformed toolbarPins falls back to default', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const bad = JSON.stringify({ version: 1, homePage: 'https://www.google.com', toolbarPins: 'x' });
    fs.writeFileSync(path.join(dir, 'settings.json'), bad, 'utf8');

    const store = freshStore();
    const result = store.load(dir);

    assert.deepEqual(result.toolbarPins, { media: true, shields: true, devtools: false });
    assert.deepEqual(store.get('toolbarPins'), { media: true, shields: true, devtools: false });
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// Test: getAll().toolbarPins is a fresh object (mutating snapshot doesn't corrupt store)
test('toolbarPins — getAll returns a fresh nested object', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);

    const snapshot = store.getAll();
    // Mutate the returned snapshot's toolbarPins
    snapshot.toolbarPins.media = false;
    snapshot.toolbarPins.shields = false;

    // Store must be unaffected
    assert.deepEqual(store.get('toolbarPins'), { media: true, shields: true, devtools: false });
    assert.deepEqual(store.getAll().toolbarPins, { media: true, shields: true, devtools: false });
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Automation gating keys (Flight 4): automationEnabled / automationKeyHashes /
// automationAdminKeyHash. Additive keys — no schema version bump.
// ---------------------------------------------------------------------------

// A valid 64-char lowercase-hex SHA-256 digest fixture.
const HEX_A = 'a'.repeat(64);
const HEX_B = '0123456789abcdef'.repeat(4); // 64 chars

test('automation keys — defaults on first load (off, empty map, empty admin hash)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    const result = store.load(dir);
    assert.equal(result.automationEnabled, false);
    assert.deepEqual(result.automationKeyHashes, {});
    assert.equal(result.automationAdminKeyHash, '');
    assert.equal(store.get('automationEnabled'), false);
    assert.deepEqual(store.get('automationKeyHashes'), {});
    assert.equal(store.get('automationAdminKeyHash'), '');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('automation keys — additive load rides the current schema version (no additive bump)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    const result = store.load(dir);
    // The additive automation keys themselves never bumped the schema — v3 is
    // the searchEngine/homePage force-persist bump (M16 F1 / DD5), unrelated
    // to automation. A fresh profile now lands on v3, not v2, because DD5's
    // rung is a no-row profile's schema version too (pin-on-load).
    assert.equal(result.version, 3);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// --- automationEnabled validator ---
test('automationEnabled — set true persists and reloads', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    store.set('automationEnabled', true);
    const result = store.load(dir);
    assert.equal(result.automationEnabled, true);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('automationEnabled — set throws on non-boolean (truthy not coerced), prior kept', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    for (const bad of [1, 'true', null, {}, []]) {
      assert.throws(
        () => store.set('automationEnabled', bad),
        (err) => err instanceof TypeError && err.message.includes('invalid value')
      );
    }
    assert.equal(store.get('automationEnabled'), false);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// --- automationKeyHashes validator ---
test('automationKeyHashes — set a valid hex map persists and reloads', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    store.set('automationKeyHashes', { work: HEX_A, personal: HEX_B });
    const result = store.load(dir);
    assert.deepEqual(result.automationKeyHashes, { work: HEX_A, personal: HEX_B });
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('automationKeyHashes — set throws on null/array, prior kept', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    for (const bad of [null, [HEX_A]]) {
      assert.throws(
        () => store.set('automationKeyHashes', bad),
        (err) => err instanceof TypeError && err.message.includes('invalid value')
      );
    }
    assert.deepEqual(store.get('automationKeyHashes'), {});
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('automationKeyHashes — set throws on non-hex / wrong-length / non-string values', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    const bads = [
      { work: 'not-a-hash' },
      { work: HEX_A.toUpperCase() }, // uppercase rejected (lowercase only)
      { work: HEX_A.slice(0, 63) }, // too short
      { work: HEX_A + 'a' }, // too long
      { work: 123 }, // non-string
      { ok: HEX_A, bad: 'xyz' } // one bad value rejects the whole map
    ];
    for (const bad of bads) {
      assert.throws(
        () => store.set('automationKeyHashes', bad),
        (err) => err instanceof TypeError && err.message.includes('invalid value')
      );
    }
    assert.deepEqual(store.get('automationKeyHashes'), {});
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('automationKeyHashes — load malformed map falls back to default {}', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const bad = JSON.stringify({ version: 1, automationKeyHashes: { work: 'nope' } });
    fs.writeFileSync(path.join(dir, 'settings.json'), bad, 'utf8');
    const store = freshStore();
    const result = store.load(dir);
    assert.deepEqual(result.automationKeyHashes, {});
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('automationKeyHashes — getAll returns a fresh nested map (no live-ref leak)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    store.set('automationKeyHashes', { work: HEX_A });

    const snapshot = store.getAll();
    snapshot.automationKeyHashes.work = HEX_B;
    snapshot.automationKeyHashes.injected = HEX_B;

    // Store must be unaffected by mutation of the snapshot.
    assert.deepEqual(store.get('automationKeyHashes'), { work: HEX_A });
    assert.deepEqual(store.getAll().automationKeyHashes, { work: HEX_A });
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('automationKeyHashes — freshDefaults does not share the DEFAULTS map across loads', () => {
  const dirA = makeTempDir();
  const dirB = makeTempDir();
  try {
    const store = freshStore();
    appDb.open(dirA);
    store.load(dirA);
    store.set('automationKeyHashes', { work: HEX_A });

    // A fresh load over a clean dir must yield an EMPTY map — not the one mutated above.
    // appDb.open(dirB) resets the singleton onto the new dir (DD4) before the store
    // re-resolves its document store against it.
    appDb.open(dirB);
    const result = store.load(dirB);
    assert.deepEqual(result.automationKeyHashes, {});
  } finally {
    appDb.close();
    removeTempDir(dirA);
    removeTempDir(dirB);
  }
});

// --- automationAdminKeyHash validator ---
test('automationAdminKeyHash — accepts empty string and a 64-hex digest', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    store.set('automationAdminKeyHash', HEX_A);
    assert.equal(store.get('automationAdminKeyHash'), HEX_A);
    store.set('automationAdminKeyHash', '');
    assert.equal(store.get('automationAdminKeyHash'), '');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('automationAdminKeyHash — set throws on non-hex / wrong-length / non-string', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    for (const bad of ['nope', HEX_A.toUpperCase(), HEX_A.slice(0, 10), 123, null, {}]) {
      assert.throws(
        () => store.set('automationAdminKeyHash', bad),
        (err) => err instanceof TypeError && err.message.includes('invalid value')
      );
    }
    assert.equal(store.get('automationAdminKeyHash'), '');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// --- automationPort validator (Flight 5 / DD1) ---
test('automationPort — default on first load is 49707', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    const result = store.load(dir);
    assert.equal(result.automationPort, 49707);
    assert.equal(store.get('automationPort'), 49707);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('automationPort — accepts in-range integers (boundaries + middle), persists and reloads', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    for (const good of [1024, 49707, 65535]) {
      store.set('automationPort', good);
      assert.equal(store.get('automationPort'), good);
      const result = store.load(dir);
      assert.equal(result.automationPort, good);
    }
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('automationPort — set throws on out-of-range / non-integer / non-number, prior kept', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    const prior = store.get('automationPort');
    for (const bad of [1023, 65536, 1024.5, '49707', null, [], true]) {
      assert.throws(
        () => store.set('automationPort', bad),
        (err) => err instanceof TypeError && err.message.includes('invalid value')
      );
    }
    assert.equal(store.get('automationPort'), prior);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('automationPort — load malformed/out-of-range value is repaired to default', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const bad = JSON.stringify({ version: 1, automationPort: 70000 });
    fs.writeFileSync(path.join(dir, 'settings.json'), bad, 'utf8');
    const store = freshStore();
    const result = store.load(dir);
    assert.equal(result.automationPort, 49707, 'out-of-range stored port should repair to default');
    assert.equal(store.get('automationPort'), 49707);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// spellcheck (Flight 4 / DD1) — additive boolean, default OFF, no version bump,
// no validator/normalizer (rides the typeof-match fallback in load()).
// ---------------------------------------------------------------------------

test('spellcheck — default on first load is false (no settings.json)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    const result = store.load(dir);
    assert.equal(result.spellcheck, false);
    assert.equal(store.get('spellcheck'), false);
    // The additive spellcheck key never bumped the schema itself — v3 is the
    // searchEngine/homePage force-persist bump (M16 F1 / DD5); a fresh profile
    // lands there via the row-less pin-on-load path.
    assert.equal(result.version, 3);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('spellcheck — set true persists and reloads (round-trip)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    store.set('spellcheck', true);
    const result = store.load(dir);
    assert.equal(result.spellcheck, true);
    assert.equal(store.get('spellcheck'), true);

    // Toggle back OFF and confirm it round-trips too.
    store.set('spellcheck', false);
    const result2 = store.load(dir);
    assert.equal(result2.spellcheck, false);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('spellcheck — config written before this leg (no spellcheck key) loads with false (forward-compat)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    // Simulate a pre-leg settings file that predates the spellcheck key entirely.
    const preLeg = JSON.stringify({
      version: 1,
      homePage: 'https://www.google.com',
      toolbarPins: { media: true, shields: true, devtools: false }
    });
    fs.writeFileSync(path.join(dir, 'settings.json'), preLeg, 'utf8');

    const store = freshStore();
    const result = store.load(dir);

    // The merge-with-repair loop fills the missing additive key from DEFAULTS (false).
    assert.equal(result.spellcheck, false);
    assert.equal(store.get('spellcheck'), false);
    // Sibling keys from the pre-leg file are preserved.
    assert.equal(result.homePage, 'https://www.google.com');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// restoreSession (M09 Flight 9 / DD7; default flipped ON in schema v2 — issue
// #117). EXPLICIT strict-boolean validator (the automationEnabled template — a
// truthy non-boolean is rejected, NOT coerced).
// ---------------------------------------------------------------------------

test('restoreSession — default on first load is true (fresh profile, issue #117)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    const result = store.load(dir);
    assert.equal(result.restoreSession, true);
    assert.equal(store.get('restoreSession'), true);
    // v3 (M16 F1 / DD5) — a fresh profile is pinned there via the row-less
    // pin-on-load path; restoreSession's own default flip was the earlier v2.
    assert.equal(result.version, 3);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('restoreSession — set false persists and reloads (v2 opt-out survives, no re-migration)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    store.set('restoreSession', false);
    // The reload passes back through migrateStored(); the row is already v2, so
    // the explicit opt-out is NOT discarded (the migration is one-time).
    const result = store.load(dir);
    assert.equal(result.restoreSession, false);
    assert.equal(store.get('restoreSession'), false);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('restoreSession — set throws on a truthy non-boolean, prior value unchanged', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    // A truthy string must NOT coerce — the strict validator throws BEFORE
    // mutating (set() validates-before-mutate), so the value stays at its default.
    assert.throws(
      () => store.set('restoreSession', 'yes'),
      (err) => err instanceof TypeError && err.message.includes('invalid value')
    );
    assert.equal(store.get('restoreSession'), true);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// bookmarksBarEnabled (M15 F1 Leg 3 / DD7). Additive boolean, off-by-default,
// EXPLICIT strict-boolean validator (the restoreSession template).
// ---------------------------------------------------------------------------

test('bookmarksBarEnabled — default on first load is false, additive (no version bump)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    const result = store.load(dir);
    assert.equal(result.bookmarksBarEnabled, false);
    assert.equal(store.get('bookmarksBarEnabled'), false);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('bookmarksBarEnabled — set true persists and reloads', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    store.set('bookmarksBarEnabled', true);
    const result = store.load(dir);
    assert.equal(result.bookmarksBarEnabled, true);
    assert.equal(store.get('bookmarksBarEnabled'), true);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('bookmarksBarEnabled — set throws on a truthy non-boolean, prior value unchanged', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    assert.throws(
      () => store.set('bookmarksBarEnabled', 1),
      (err) => err instanceof TypeError && err.message.includes('invalid value')
    );
    assert.equal(store.get('bookmarksBarEnabled'), false);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('bookmarksBarEnabled — config written before this leg (no bookmarksBarEnabled key) loads with false (forward-compat)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    // Simulate a pre-leg settings file that predates the bookmarksBarEnabled key entirely.
    const preLeg = JSON.stringify({
      version: 2,
      homePage: 'https://www.google.com',
      toolbarPins: { media: true, shields: true, devtools: false }
    });
    fs.writeFileSync(path.join(dir, 'settings.json'), preLeg, 'utf8');

    const store = freshStore();
    const result = store.load(dir);

    // The merge-with-repair loop fills the missing additive key from DEFAULTS (false).
    assert.equal(result.bookmarksBarEnabled, false);
    assert.equal(store.get('bookmarksBarEnabled'), false);
    assert.equal(result.homePage, 'https://www.google.com');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// searchEngine (M16 Flight 1 "Search Engine as a Preference" / DD1, DD2, DD8).
// Curated-allowlist validator built off src/shared/search-engines.js's
// SEARCH_ENGINE_IDS — null (unset) or exact membership, nothing else.
//
// DD8 (M15 debrief house rule) — red-when-neutered: the tests below are
// designed so that relaxing VALIDATORS.searchEngine to `(v) => v === null ||
// typeof v === 'string'` makes at least one of them fail. Verified by hand
// once (see the flight log for the exact failing test name(s)): temporarily
// neuter the validator, run this file, confirm red, then restore.
// ---------------------------------------------------------------------------

// RENAMED (M16 F2 L2 / DD5 — was 'searchEngine — default on first load is
// "google"'): DEFAULTS.searchEngine is null now — a fresh profile has no
// engine chosen; the welcome surface asks the first time a search needs one.
test('searchEngine — default on first load is null (unset)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    const result = store.load(dir);
    assert.equal(result.searchEngine, null);
    assert.equal(store.get('searchEngine'), null);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('searchEngine — every curated id round-trips through set() (DD8 positive control)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    for (const id of SEARCH_ENGINE_IDS) {
      const updated = store.set('searchEngine', id);
      assert.equal(updated.searchEngine, id);
      assert.equal(store.get('searchEngine'), id);
      // Persists too, not just in memory.
      const reloaded = store.load(dir);
      assert.equal(reloaded.searchEngine, id);
    }
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('searchEngine — null accepted (unset representable, DD2), round-trips through set()', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    store.set('searchEngine', 'duckduckgo'); // move off the default first
    const updated = store.set('searchEngine', null);
    assert.equal(updated.searchEngine, null);
    assert.equal(store.get('searchEngine'), null);
    const reloaded = store.load(dir);
    assert.equal(reloaded.searchEngine, null, 'a stored null survives load unchanged — it is valid, not repaired');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// --- DD8 negative controls: set() rejection, prior value kept ---

test('searchEngine — non-curated id ("kagi") rejected by set(), prior value kept', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    const prior = store.get('searchEngine');
    assert.throws(
      () => store.set('searchEngine', 'kagi'),
      (err) => err instanceof TypeError && err.message.includes('invalid value')
    );
    assert.equal(store.get('searchEngine'), prior);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('searchEngine — URL-shaped string rejected by set(), prior value kept (no user-supplied template)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    const prior = store.get('searchEngine');
    assert.throws(
      () => store.set('searchEngine', 'https://evil.example/?q=%s'),
      (err) => err instanceof TypeError && err.message.includes('invalid value')
    );
    assert.equal(store.get('searchEngine'), prior);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('searchEngine — empty string rejected by set(), prior value kept (null is the only unset representation)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    const prior = store.get('searchEngine');
    assert.throws(
      () => store.set('searchEngine', ''),
      (err) => err instanceof TypeError && err.message.includes('invalid value')
    );
    assert.equal(store.get('searchEngine'), prior);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('searchEngine — object value rejected by set(), prior value kept', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    const prior = store.get('searchEngine');
    assert.throws(
      () => store.set('searchEngine', { id: 'google' }),
      (err) => err instanceof TypeError && err.message.includes('invalid value')
    );
    assert.equal(store.get('searchEngine'), prior);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// --- DD8 negative controls: load() repair, same hostile values ---

test('searchEngine — non-curated / hostile stored values repair to the default at load()', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const hostileValues = ['kagi', 'https://evil.example/?q=%s', '', { id: 'google' }];
    for (const bad of hostileValues) {
      // seedRow() overwrites the whole row (write() is an upsert) — one open
      // db for the whole loop, re-seeded each iteration.
      seedRow({ version: 3, searchEngine: bad, homePage: 'https://kept.example.com/' });
      const store = freshStore();
      const result = store.load(dir);
      // RENAMED (M16 F2 L2 / DD5 — was 'google'): repair-to-default now means repair-to-unset.
      assert.equal(result.searchEngine, null, `stored ${JSON.stringify(bad)} should repair to default`);
      assert.equal(result.homePage, 'https://kept.example.com/', 'valid sibling key is kept');
    }
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('searchEngine — an id removed from the curated table repairs silently to the default at load()', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    // Simulates upgrading past a release where an engine was pulled from the
    // table — the mission's "repair without blocking startup" criterion.
    seedRow({ version: 3, searchEngine: 'altavista' });
    const store = freshStore();
    const result = store.load(dir);
    // RENAMED (M16 F2 L2 / DD5 — was 'google'): repair-to-default now means repair-to-unset.
    assert.equal(result.searchEngine, null);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// homePage: null representable (M16 F1 / DD2) — '' stays invalid so unset
// never has two stored meanings.
// ---------------------------------------------------------------------------

test('homePage — null accepted (DD2), round-trips through set() and load()', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    const updated = store.set('homePage', null);
    assert.equal(updated.homePage, null);
    const reloaded = store.load(dir);
    assert.equal(reloaded.homePage, null, 'a stored null survives load unchanged — it is valid, not repaired');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('homePage — empty string in a stored row still repairs to default (not a second unset representation)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    seedRow({ version: 3, homePage: '', searchEngine: 'google' });
    const store = freshStore();
    const result = store.load(dir);
    // RENAMED (M16 F2 L2 / DD5 — was 'https://www.google.com'): DEFAULTS.homePage is null now.
    assert.equal(result.homePage, null, "'' must repair to default, not survive as a second unset sentinel");
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('homePage — set("") still throws (unchanged by the DD2 null-widening)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    assert.throws(
      () => store.set('homePage', ''),
      (err) => err instanceof TypeError && err.message.includes('invalid value')
    );
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Pin-on-load migration/pinning matrix (M16 F1 / DD5) — the four cases the
// leg's Verification Steps enumerate: v2 row → v3 pinned; corrupt row →
// defaults + pinned; no row → defaults + pinned (covered above by the two
// renamed tests); valid v3 row → untouched (idempotent).
// ---------------------------------------------------------------------------

test('pin-on-load: a corrupt SETTINGS ROW (not a legacy file) repairs to defaults AND persists the repair', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    // Write garbage directly to the 'settings' document row (distinct from the
    // legacy-settings.json corrupt-file case, which already saved
    // unconditionally before this leg — this is the gap design review found:
    // parseAndRepair's catch used to hardcode migrated:false).
    appDb.createDocumentStore('settings').write('{{not valid json!!');

    const store = freshStore();
    const result = store.load(dir);

    // RENAMED (M16 F2 L2 / DD5 — was 'https://www.google.com' / 'google'): a corrupt row now repairs to null/null.
    assert.equal(result.homePage, null);
    assert.equal(result.searchEngine, null);
    assert.equal(result.version, 3);

    const row = JSON.parse(/** @type {string} */ (readRow(dir)));
    assert.equal(row.version, 3, 'the corrupt row is repaired in memory AND the repair is persisted');
    assert.equal(row.homePage, null);
    assert.equal(row.searchEngine, null);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('pin-on-load idempotency: a pinned v3 row is not redundantly rewritten in a way that changes its content', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store1 = freshStore();
    store1.load(dir); // row-less pin: writes the row for the first time
    const afterFirst = JSON.parse(/** @type {string} */ (readRow(dir)));

    const store2 = freshStore();
    store2.load(dir); // row now present and already v3 — must not be re-migrated
    const afterSecond = JSON.parse(/** @type {string} */ (readRow(dir)));

    assert.deepEqual(afterSecond, afterFirst, "repeat load does not change the pinned row's content");
    assert.equal(afterSecond.version, 3);
    // RENAMED (M16 F2 L2 / DD5 — was 'google'): the pinned default is null now.
    assert.equal(afterSecond.searchEngine, null);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('pin-on-load idempotency: a valid, already-current v3 row with custom values is untouched', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    seedRow({ version: 3, homePage: 'https://custom.example.com/', searchEngine: 'duckduckgo', restoreSession: false });

    const store = freshStore();
    const result = store.load(dir);
    assert.equal(result.homePage, 'https://custom.example.com/');
    assert.equal(result.searchEngine, 'duckduckgo');
    assert.equal(result.restoreSession, false);

    // Reload again — still untouched.
    const result2 = store.load(dir);
    assert.equal(result2.homePage, 'https://custom.example.com/');
    assert.equal(result2.searchEngine, 'duckduckgo');
    assert.equal(result2.restoreSession, false);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('pin-on-load: null homePage/searchEngine in an already-v3 row survive load unchanged (not repaired)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    seedRow({ version: 3, homePage: null, searchEngine: null });

    const store = freshStore();
    const result = store.load(dir);
    assert.equal(result.homePage, null);
    assert.equal(result.searchEngine, null);

    // A second load must not disturb the nulls either (idempotent — nothing
    // to migrate, and repairConfig treats a validator-accepted null as valid).
    const result2 = store.load(dir);
    assert.equal(result2.homePage, null);
    assert.equal(result2.searchEngine, null);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('pin-on-load: legacy settings.json containing a hostile searchEngine repairs through the same shared path', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    // Proves the legacy-file path shares parseAndRepair with the row path —
    // no extra code, but the leg's Edge Cases call for a dedicated test.
    const legacy = JSON.stringify({ version: 1, searchEngine: 'kagi', homePage: 'https://legacy.example.com/' });
    fs.writeFileSync(path.join(dir, 'settings.json'), legacy, 'utf8');

    const store = freshStore();
    const result = store.load(dir);

    // RENAMED (M16 F2 L2 / DD5 — was 'google'): repair-to-default now means repair-to-unset.
    assert.equal(result.searchEngine, null, 'hostile legacy value repairs to default');
    assert.equal(result.homePage, 'https://legacy.example.com/', 'valid sibling key is kept');
    assert.equal(result.version, 3);
    assert.ok(fs.existsSync(path.join(dir, 'settings.json.migrated')));
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// v1 → v2 migration transform (issue #117): save() serializes the WHOLE
// config, so v1 rows carry a serializer-stamped `restoreSession: false`
// indistinguishable from a deliberate opt-out. The ladder discards the stored
// value (refills true from DEFAULTS) whenever `from < 2`. Per-rung guards
// (M16 F1 / DD5) mean a v1 row now migrates straight to the CURRENT schema
// version (v3) in one load() call — there is no longer an intermediate v2
// stop reachable on its own — so every "stamps version" assertion below
// targets 3, not 2. The transform itself (the restoreSession discard) is
// unchanged; only the terminal stamped number moved.
// ---------------------------------------------------------------------------

// Seed a raw 'settings' row directly (simulating a profile written by 0.10–0.11).
function seedRow(payloadObj) {
  appDb.createDocumentStore('settings').write(JSON.stringify(payloadObj));
}

test('v1→v3 migration — v1 row with restoreSession:false loads as true and persists at v3', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    seedRow({ version: 1, homePage: 'https://kept.example.com/', restoreSession: false });

    const store = freshStore();
    const result = store.load(dir);

    assert.equal(result.restoreSession, true, 'serializer-frozen false is discarded → new default');
    assert.equal(result.version, 3);
    // RENAMED (M16 F2 L2 / DD5 — was 'google'): fills from DEFAULTS.searchEngine, now null.
    assert.equal(result.searchEngine, null, 'a v1 row predates searchEngine entirely — fills from DEFAULTS');
    assert.equal(result.homePage, 'https://kept.example.com/', 'sibling keys survive the migration');

    // The migrated row is persisted at load (one-time), stamped v3, with
    // searchEngine now explicit (DD5 force-persist).
    const row = JSON.parse(/** @type {string} */ (readRow(dir)));
    assert.equal(row.version, 3);
    assert.equal(row.restoreSession, true);
    assert.equal(row.homePage, 'https://kept.example.com/');
    assert.equal(row.searchEngine, null);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('v1→v3 migration — v1 row with restoreSession:true stays true', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    seedRow({ version: 1, restoreSession: true });

    const store = freshStore();
    const result = store.load(dir);

    assert.equal(result.restoreSession, true);
    assert.equal(result.version, 3);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// RENAMED (M16 F1 / DD5 — was 'v1→v2 migration — v2 row with
// restoreSession:false is NOT re-migrated (stays false)'): the old body
// asserted the row was NOT rewritten at load — true only while v2 WAS the
// current schema version. Now a v2 row is exactly DD5's "v2 row → v3 pinned"
// case: it DOES get rewritten (stamped to v3, searchEngine filled explicit),
// while the restoreSession:false opt-out is correctly NOT re-discarded (the
// v1→v2 transform is guarded on `from < 2`, and this row is already v2).
// Renamed rather than deleted-and-re-added so git blame documents the intent
// shift (same convention as the two pin-on-load renames above).
test('v2 row migrates to v3 (searchEngine pinned explicit), restoreSession:false opt-out NOT re-discarded', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    seedRow({ version: 2, restoreSession: false, homePage: 'https://kept.example.com/' });

    const store = freshStore();
    const result = store.load(dir);

    assert.equal(
      result.restoreSession,
      false,
      'a v2 opt-out is respected forever — the v1→v2 transform does not re-run on a v2 row'
    );
    assert.equal(result.version, 3);
    // RENAMED (M16 F2 L2 / DD5 — was 'google'): fills from DEFAULTS.searchEngine, now null.
    assert.equal(result.searchEngine, null, 'absent on the v2 row — fills from DEFAULTS');
    assert.equal(result.homePage, 'https://kept.example.com/');

    // DD5: the v2→v3 rung's only content is the version stamp, but that stamp
    // sets `migrated: true` and DOES trip the save-on-migrate persist — so,
    // unlike the pre-DD5 world, this row IS rewritten at load.
    const row = JSON.parse(/** @type {string} */ (readRow(dir)));
    assert.equal(row.version, 3);
    assert.equal(row.restoreSession, false);
    assert.equal(row.searchEngine, null);
    assert.equal(row.homePage, 'https://kept.example.com/');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('v1→v3 migration — a version-less row cannot prove v2+ and migrates', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    seedRow({ homePage: 'https://kept.example.com/', restoreSession: false });

    const store = freshStore();
    const result = store.load(dir);

    assert.equal(result.restoreSession, true);
    assert.equal(result.version, 3);
    assert.equal(result.homePage, 'https://kept.example.com/');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('v1→v3 migration — legacy settings.json (v1) imports with the new defaults', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    // A pre-0.10 file predates restoreSession AND searchEngine entirely — both
    // absent keys fill from DEFAULTS and the imported row is stamped v3.
    const legacy = JSON.stringify({ version: 1, homePage: 'https://legacy.example.com/' });
    fs.writeFileSync(path.join(dir, 'settings.json'), legacy, 'utf8');

    const store = freshStore();
    const result = store.load(dir);

    assert.equal(result.restoreSession, true);
    assert.equal(result.version, 3);
    // RENAMED (M16 F2 L2 / DD5 — was 'google'): fills from DEFAULTS.searchEngine, now null.
    assert.equal(result.searchEngine, null);
    const row = JSON.parse(/** @type {string} */ (readRow(dir)));
    assert.equal(row.version, 3);
    assert.equal(row.restoreSession, true);
    assert.equal(row.searchEngine, null);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// F9 / F14 / F17 — set() fallback validation, own-key guard, failed-save state
// ---------------------------------------------------------------------------

test('spellcheck — set throws on a string via the typeof fallback', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    assert.throws(
      () => store.set('spellcheck', 'true'),
      (err) => err instanceof TypeError && err.message.includes('invalid value')
    );
    assert.equal(store.get('spellcheck'), false);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('set rejects inherited Object.prototype keys as unknown settings keys', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    assert.throws(
      () => store.set('toString', 'x'),
      (err) => err instanceof TypeError && err.message.includes('unknown settings key')
    );
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('failed serialization leaves the prior config live', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir, {
      serialize: () => {
        throw new Error('serialize failed');
      }
    });
    const prior = store.get('homePage');
    assert.throws(() => store.set('homePage', 'https://rejected.example.com/'), /serialize failed/);
    assert.equal(store.get('homePage'), prior);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// app-db integration (flight 10-1, leg 1): app-db-not-open propagation +
// legacy-JSON migration semantics (DD5).
// ---------------------------------------------------------------------------

test('load() throws when app-db is not open (mis-ordered boot must propagate, not fall back to defaults)', () => {
  const dir = makeTempDir();
  try {
    // Deliberately do NOT call appDb.open(dir) — app-db starts closed.
    const store = freshStore();
    assert.throws(() => store.load(dir), /app db not open/);
  } finally {
    removeTempDir(dir);
  }
});

test('migration: legacy settings.json is imported once, values intact, then renamed .migrated', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const legacy = JSON.stringify({ version: 1, homePage: 'https://legacy.example.com/', spellcheck: true });
    fs.writeFileSync(path.join(dir, 'settings.json'), legacy, 'utf8');

    const store = freshStore();
    const result = store.load(dir);

    assert.equal(result.homePage, 'https://legacy.example.com/');
    assert.equal(result.spellcheck, true);
    assert.equal(store.get('homePage'), 'https://legacy.example.com/');

    // The row now holds the migrated value.
    const row = readRow(dir);
    assert.ok(row !== null);
    assert.equal(JSON.parse(/** @type {string} */ (row)).homePage, 'https://legacy.example.com/');

    // The legacy file is gone; a .migrated sibling remains as the rollback artifact.
    assert.ok(!fs.existsSync(path.join(dir, 'settings.json')), 'settings.json should be renamed away');
    assert.ok(fs.existsSync(path.join(dir, 'settings.json.migrated')), 'settings.json.migrated should exist');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('migration: corrupt legacy settings.json still migrates (repaired-to-defaults row + rename)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    fs.writeFileSync(path.join(dir, 'settings.json'), '{{not valid json!!', 'utf8');

    const store = freshStore();
    const result = store.load(dir);

    // RENAMED (M16 F2 L2 / DD5 — was 'https://www.google.com'): DEFAULTS.homePage is null now.
    assert.equal(result.homePage, null, 'corrupt legacy JSON repairs to defaults');

    const row = readRow(dir);
    assert.ok(row !== null, 'the repaired-to-defaults result still migrates as the row');
    assert.equal(JSON.parse(/** @type {string} */ (row)).homePage, null);

    assert.ok(!fs.existsSync(path.join(dir, 'settings.json')));
    assert.ok(fs.existsSync(path.join(dir, 'settings.json.migrated')), 'the corrupt original still renames .migrated');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('migration: a present row wins over a stray legacy settings.json (no re-import)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    // Seed the row directly (simulating an already-migrated profile).
    const store = freshStore();
    store.load(dir);
    store.set('homePage', 'https://row-wins.example.com/');

    // Now drop a stray legacy file with a DIFFERENT value — this must be ignored.
    fs.writeFileSync(
      path.join(dir, 'settings.json'),
      JSON.stringify({ version: 1, homePage: 'https://should-be-ignored.example.com/' }),
      'utf8'
    );

    const store2 = freshStore();
    const result = store2.load(dir);
    assert.equal(result.homePage, 'https://row-wins.example.com/', 'row wins; stray JSON is not re-imported');

    // The stray file is untouched (no rename — no migration happened).
    assert.ok(fs.existsSync(path.join(dir, 'settings.json')));
    assert.ok(!fs.existsSync(path.join(dir, 'settings.json.migrated')));
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// RENAMED (M16 F1 / DD5 — was 'migration: no row, no legacy file → defaults,
// no migration side effects'): the old body asserted `readRow(dir) === null`
// — the EXACT OPPOSITE of pin-on-load. Renamed rather than deleted-and-re-
// added so git blame documents the intent shift (same convention as the
// 'defaults on first load' rename above; both cover the row-less scenario
// from different angles — this one also pins the no-legacy-file side effect).
//
// RENAMED again (M16 F2 L2 / DD5 — was 'migration: no row, no legacy file →
// defaults, pinned to disk (DD5 row-less pin-on-load)', which pinned
// Google-explicit): DEFAULTS flips to null/null this leg — a fresh profile is
// now pinned null-explicit. The pin-on-load mechanism itself is unchanged.
test('migration: no row, no legacy file → defaults, pinned to disk as null/null (DD5 row-less pin-on-load)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    const result = store.load(dir);
    assert.equal(result.homePage, null);
    assert.equal(result.searchEngine, null);
    assert.equal(result.version, 3);

    const row = JSON.parse(/** @type {string} */ (readRow(dir)));
    assert.equal(row.homePage, null, 'DD5: a fresh profile is pinned explicit at load, not left row-less');
    assert.equal(row.searchEngine, null);
    assert.equal(row.version, 3);

    // Still no legacy file was ever present, so no migration-rename side effect.
    assert.ok(!fs.existsSync(path.join(dir, 'settings.json.migrated')));
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('write-during-load synchrony: settings.load() can run mid-boot with app-db already receiving writes', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    // Simulate another store already having written to app-db before settings
    // loads (jars' leg-2 save-inside-load concern, DD7) — the write must be
    // durable and visible synchronously, with no interference between rows.
    const jarsDoc = appDb.createDocumentStore('jars');
    jarsDoc.write('{"seeded":true}', 1000);

    const store = freshStore();
    const result = store.load(dir);
    // RENAMED (M16 F2 L2 / DD5 — was 'https://www.google.com'): DEFAULTS.homePage is null now.
    assert.equal(result.homePage, null);
    assert.equal(jarsDoc.read(), '{"seeded":true}', 'concurrent-store row is untouched by settings load');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});
