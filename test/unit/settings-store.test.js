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
    const row = /** @type {any} */ (
      check.prepare('SELECT payload FROM documents WHERE store = ?1').get('settings')
    );
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
test('defaults on first load — no settings.json present', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    const result = store.load(dir);
    assert.equal(result.version, 1);
    assert.equal(result.homePage, 'https://www.google.com');
    assert.equal(store.get('homePage'), 'https://www.google.com');
    assert.equal(store.get('version'), 1);
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
    assert.equal(result.homePage, 'https://www.google.com');
    assert.equal(result.version, 1);
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
    // Write a settings.json with an invalid homePage but correct version
    const badSettings = JSON.stringify({ homePage: 'javascript:bad', version: 1 });
    fs.writeFileSync(path.join(dir, 'settings.json'), badSettings, 'utf8');

    const store = freshStore();
    const result = store.load(dir);

    // homePage should be repaired to default
    assert.equal(result.homePage, 'https://www.google.com', 'invalid homePage should be repaired to default');
    // version is type-compatible and has no validator → should be kept
    assert.equal(result.version, 1);
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

test('automation keys — additive load with NO version bump (version stays 1)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    const result = store.load(dir);
    assert.equal(result.version, 1, 'schema version must NOT be bumped for additive keys');
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
      { work: HEX_A.slice(0, 63) },  // too short
      { work: HEX_A + 'a' },         // too long
      { work: 123 },                 // non-string
      { ok: HEX_A, bad: 'xyz' },     // one bad value rejects the whole map
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
    // Additive key must NOT bump the schema version.
    assert.equal(result.version, 1, 'schema version must NOT be bumped for the additive spellcheck key');
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
    const preLeg = JSON.stringify({ version: 1, homePage: 'https://www.google.com', toolbarPins: { media: true, shields: true, devtools: false } });
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
// restoreSession (M09 Flight 9 / DD7) — additive boolean, default OFF, no version
// bump, EXPLICIT strict-boolean validator (the automationEnabled template — a truthy
// non-boolean is rejected, NOT coerced, so it can never silently enable restore).
// ---------------------------------------------------------------------------

test('restoreSession — default on first load is false (no settings.json)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    const result = store.load(dir);
    assert.equal(result.restoreSession, false);
    assert.equal(store.get('restoreSession'), false);
    // Additive key must NOT bump the schema version.
    assert.equal(result.version, 1, 'schema version must NOT be bumped for the additive restoreSession key');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('restoreSession — set true persists and reloads (round-trip)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    store.set('restoreSession', true);
    const result = store.load(dir);
    assert.equal(result.restoreSession, true);
    assert.equal(store.get('restoreSession'), true);
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
    // A truthy string must NOT coerce to true — the strict validator throws BEFORE
    // mutating (set() validates-before-mutate), so the value stays at its default.
    assert.throws(
      () => store.set('restoreSession', 'yes'),
      (err) => err instanceof TypeError && err.message.includes('invalid value')
    );
    assert.equal(store.get('restoreSession'), false);
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

    assert.equal(result.homePage, 'https://www.google.com', 'corrupt legacy JSON repairs to defaults');

    const row = readRow(dir);
    assert.ok(row !== null, 'the repaired-to-defaults result still migrates as the row');
    assert.equal(JSON.parse(/** @type {string} */ (row)).homePage, 'https://www.google.com');

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

test('migration: no row, no legacy file → defaults, no migration side effects', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    const result = store.load(dir);
    assert.equal(result.homePage, 'https://www.google.com');
    assert.equal(readRow(dir), null, 'a fresh profile seeds defaults in memory only, no row write');
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
    assert.equal(result.homePage, 'https://www.google.com');
    assert.equal(jarsDoc.read(), '{"seeded":true}', 'concurrent-store row is untouched by settings load');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});
