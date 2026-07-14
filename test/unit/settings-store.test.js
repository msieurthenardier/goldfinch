'use strict';

// Unit tests for src/main/settings-store.js
//
// No Electron stub needed — the module is Electron-free (no require('electron'),
// no app.getPath at module scope). The userData path is injected via load().
//
// Each test (or setup) creates a real temp dir and cleans up after itself.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// Helper: create a fresh temp dir and return it, plus a cleanup function.
// ---------------------------------------------------------------------------
function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-settings-'));
}

function removeTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Re-require settings-store fresh per test group so module-scoped state
// (dir, config, codec) doesn't leak across tests.
//
// Node's module cache means a plain require() after the first will return the
// same instance. We reload by deleting from the cache each time.
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
  try {
    const store = freshStore();
    const result = store.load(dir);
    assert.equal(result.version, 1);
    assert.equal(result.homePage, 'https://www.google.com');
    assert.equal(store.get('homePage'), 'https://www.google.com');
    assert.equal(store.get('version'), 1);
    assert.equal(store.get('restoreOnStartup'), false);
  } finally {
    removeTempDir(dir);
  }
});

test('restoreOnStartup is a validated additive boolean setting', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.load(dir);
    store.set('restoreOnStartup', true);
    assert.equal(store.load(dir).restoreOnStartup, true);
    assert.throws(() => store.set('restoreOnStartup', 'true'), TypeError);
    assert.equal(store.get('restoreOnStartup'), true);
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Test: set → persist → reload round-trip
// ---------------------------------------------------------------------------
test('set → persist → reload round-trip', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.load(dir);
    store.set('homePage', 'https://example.com/');

    // Reload from same dir — should pick up persisted value
    const result = store.load(dir);
    assert.equal(result.homePage, 'https://example.com/');
    assert.equal(store.get('homePage'), 'https://example.com/');
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Test: atomic write produces valid JSON on disk
// ---------------------------------------------------------------------------
test('atomic write produces valid JSON on disk', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.load(dir);
    store.set('homePage', 'https://test.example.com/');

    const filePath = path.join(dir, 'settings.json');
    assert.ok(fs.existsSync(filePath), 'settings.json should exist after set');

    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw); // throws if invalid JSON
    assert.equal(parsed.homePage, 'https://test.example.com/');
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Test: corrupt file → defaults (no throw)
// ---------------------------------------------------------------------------
test('corrupt file repair → defaults, no throw', () => {
  const dir = makeTempDir();
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
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Test: bad single field repaired, valid fields kept
// ---------------------------------------------------------------------------
test('bad-field repair keeps valid siblings', () => {
  const dir = makeTempDir();
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
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Test: set throws on javascript: scheme, prior value kept
// ---------------------------------------------------------------------------
test('set throws on javascript: URL, prior value kept', () => {
  const dir = makeTempDir();
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
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Test: set throws on goldfinch:// URL
// ---------------------------------------------------------------------------
test('set throws on goldfinch:// URL', () => {
  const dir = makeTempDir();
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
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Test: set throws on about:blank (excluded even though isSafeTabUrl admits it)
// ---------------------------------------------------------------------------
test('set throws on about:blank (excluded from homePage)', () => {
  const dir = makeTempDir();
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
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Test: set accepts https:// URL
// ---------------------------------------------------------------------------
test('set accepts valid https:// URL', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.load(dir);
    const updated = store.set('homePage', 'https://valid.example.com/path?q=1');
    assert.equal(updated.homePage, 'https://valid.example.com/path?q=1');
    assert.equal(store.get('homePage'), 'https://valid.example.com/path?q=1');
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Test: unknown key throws TypeError
// ---------------------------------------------------------------------------
test('set unknown key throws TypeError', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.load(dir);

    assert.throws(
      () => store.set('nonExistentKey', 'value'),
      (err) => err instanceof TypeError && err.message.includes('unknown settings key')
    );
  } finally {
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
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Test: version field is present in loaded config
// ---------------------------------------------------------------------------
test('version field is present after load', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    const result = store.load(dir);
    assert.ok('version' in result, 'version key should be present');
    assert.equal(typeof result.version, 'number');
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Test: custom serializer round-trip (opts.serialize / opts.deserialize)
// ---------------------------------------------------------------------------
test('custom serializer round-trip', () => {
  const dir = makeTempDir();
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
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// toolbarPins tests
// ---------------------------------------------------------------------------

// Test: toolbarPins default on first load
test('toolbarPins — default on first load (no settings.json)', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    const result = store.load(dir);
    assert.deepEqual(result.toolbarPins, { media: true, shields: true, devtools: false });
    assert.deepEqual(store.get('toolbarPins'), { media: true, shields: true, devtools: false });
  } finally {
    removeTempDir(dir);
  }
});

// Test: set full toolbarPins → persist → reload
test('toolbarPins — set full map persists and reloads', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.load(dir);
    store.set('toolbarPins', { media: false, shields: true, devtools: false });

    const result = store.load(dir);
    assert.deepEqual(result.toolbarPins, { media: false, shields: true, devtools: false });
    assert.deepEqual(store.get('toolbarPins'), { media: false, shields: true, devtools: false });
  } finally {
    removeTempDir(dir);
  }
});

// Test: set partial {media:false} → normalized to full map (missing keys → defaults)
test('toolbarPins — set partial map normalizes to full map', () => {
  const dir = makeTempDir();
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
    removeTempDir(dir);
  }
});

// Test: devtools defaults to false; a settings file written before this leg (only
// {media,shields}, no devtools) auto-populates devtools:false via the normalizer
// (forward-compat — no version bump, no migration). And a devtools:true write
// persists across a reload (the pin-state-persists-across-restart contract).
test('toolbarPins — devtools default false + persistence round-trip', () => {
  const dir = makeTempDir();
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
    removeTempDir(dir);
  }
});

// Test: set throws on invalid toolbarPins values, prior value kept
test('toolbarPins — set throws on null, prior value kept', () => {
  const dir = makeTempDir();
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
    removeTempDir(dir);
  }
});

test('toolbarPins — set throws on array, prior value kept', () => {
  const dir = makeTempDir();
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
    removeTempDir(dir);
  }
});

test('toolbarPins — set throws on string, prior value kept', () => {
  const dir = makeTempDir();
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
    removeTempDir(dir);
  }
});

test('toolbarPins — set throws on non-boolean value, prior value kept', () => {
  const dir = makeTempDir();
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
    removeTempDir(dir);
  }
});

// Test: load stored partial {media:false} → {media:false, shields:true} (forward-compat)
test('toolbarPins — load stored partial map merges with defaults (forward-compat)', () => {
  const dir = makeTempDir();
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
    removeTempDir(dir);
  }
});

// Test: load malformed toolbarPins (string) → default {media:true, shields:true}
test('toolbarPins — load malformed toolbarPins falls back to default', () => {
  const dir = makeTempDir();
  try {
    const bad = JSON.stringify({ version: 1, homePage: 'https://www.google.com', toolbarPins: 'x' });
    fs.writeFileSync(path.join(dir, 'settings.json'), bad, 'utf8');

    const store = freshStore();
    const result = store.load(dir);

    assert.deepEqual(result.toolbarPins, { media: true, shields: true, devtools: false });
    assert.deepEqual(store.get('toolbarPins'), { media: true, shields: true, devtools: false });
  } finally {
    removeTempDir(dir);
  }
});

// Test: getAll().toolbarPins is a fresh object (mutating snapshot doesn't corrupt store)
test('toolbarPins — getAll returns a fresh nested object', () => {
  const dir = makeTempDir();
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
    removeTempDir(dir);
  }
});

test('automation keys — additive load with NO version bump (version stays 1)', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    const result = store.load(dir);
    assert.equal(result.version, 1, 'schema version must NOT be bumped for additive keys');
  } finally {
    removeTempDir(dir);
  }
});

// --- automationEnabled validator ---
test('automationEnabled — set true persists and reloads', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.load(dir);
    store.set('automationEnabled', true);
    const result = store.load(dir);
    assert.equal(result.automationEnabled, true);
  } finally {
    removeTempDir(dir);
  }
});

test('automationEnabled — set throws on non-boolean (truthy not coerced), prior kept', () => {
  const dir = makeTempDir();
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
    removeTempDir(dir);
  }
});

// --- automationKeyHashes validator ---
test('automationKeyHashes — set a valid hex map persists and reloads', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.load(dir);
    store.set('automationKeyHashes', { work: HEX_A, personal: HEX_B });
    const result = store.load(dir);
    assert.deepEqual(result.automationKeyHashes, { work: HEX_A, personal: HEX_B });
  } finally {
    removeTempDir(dir);
  }
});

test('automationKeyHashes — set throws on null/array, prior kept', () => {
  const dir = makeTempDir();
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
    removeTempDir(dir);
  }
});

test('automationKeyHashes — set throws on non-hex / wrong-length / non-string values', () => {
  const dir = makeTempDir();
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
    removeTempDir(dir);
  }
});

test('automationKeyHashes — load malformed map falls back to default {}', () => {
  const dir = makeTempDir();
  try {
    const bad = JSON.stringify({ version: 1, automationKeyHashes: { work: 'nope' } });
    fs.writeFileSync(path.join(dir, 'settings.json'), bad, 'utf8');
    const store = freshStore();
    const result = store.load(dir);
    assert.deepEqual(result.automationKeyHashes, {});
  } finally {
    removeTempDir(dir);
  }
});

test('automationKeyHashes — getAll returns a fresh nested map (no live-ref leak)', () => {
  const dir = makeTempDir();
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
    removeTempDir(dir);
  }
});

test('automationKeyHashes — freshDefaults does not share the DEFAULTS map across loads', () => {
  const dirA = makeTempDir();
  const dirB = makeTempDir();
  try {
    const store = freshStore();
    store.load(dirA);
    store.set('automationKeyHashes', { work: HEX_A });

    // A fresh load over a clean dir must yield an EMPTY map — not the one mutated above.
    const result = store.load(dirB);
    assert.deepEqual(result.automationKeyHashes, {});
  } finally {
    removeTempDir(dirA);
    removeTempDir(dirB);
  }
});

// --- automationAdminKeyHash validator ---
test('automationAdminKeyHash — accepts empty string and a 64-hex digest', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.load(dir);
    store.set('automationAdminKeyHash', HEX_A);
    assert.equal(store.get('automationAdminKeyHash'), HEX_A);
    store.set('automationAdminKeyHash', '');
    assert.equal(store.get('automationAdminKeyHash'), '');
  } finally {
    removeTempDir(dir);
  }
});

test('automationAdminKeyHash — set throws on non-hex / wrong-length / non-string', () => {
  const dir = makeTempDir();
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
    removeTempDir(dir);
  }
});

// --- automationPort validator (Flight 5 / DD1) ---
test('automationPort — default on first load is 49707', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    const result = store.load(dir);
    assert.equal(result.automationPort, 49707);
    assert.equal(store.get('automationPort'), 49707);
  } finally {
    removeTempDir(dir);
  }
});

test('automationPort — accepts in-range integers (boundaries + middle), persists and reloads', () => {
  const dir = makeTempDir();
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
    removeTempDir(dir);
  }
});

test('automationPort — set throws on out-of-range / non-integer / non-number, prior kept', () => {
  const dir = makeTempDir();
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
    removeTempDir(dir);
  }
});

test('automationPort — load malformed/out-of-range value is repaired to default', () => {
  const dir = makeTempDir();
  try {
    const bad = JSON.stringify({ version: 1, automationPort: 70000 });
    fs.writeFileSync(path.join(dir, 'settings.json'), bad, 'utf8');
    const store = freshStore();
    const result = store.load(dir);
    assert.equal(result.automationPort, 49707, 'out-of-range stored port should repair to default');
    assert.equal(store.get('automationPort'), 49707);
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// spellcheck (Flight 4 / DD1) — additive boolean, default OFF, no version bump,
// no validator/normalizer (rides the typeof-match fallback in load()).
// ---------------------------------------------------------------------------

test('spellcheck — default on first load is false (no settings.json)', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    const result = store.load(dir);
    assert.equal(result.spellcheck, false);
    assert.equal(store.get('spellcheck'), false);
    // Additive key must NOT bump the schema version.
    assert.equal(result.version, 1, 'schema version must NOT be bumped for the additive spellcheck key');
  } finally {
    removeTempDir(dir);
  }
});

test('spellcheck — set true persists and reloads (round-trip)', () => {
  const dir = makeTempDir();
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
    removeTempDir(dir);
  }
});

test('spellcheck — config written before this leg (no spellcheck key) loads with false (forward-compat)', () => {
  const dir = makeTempDir();
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
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// F9 / F14 / F17 — set() fallback validation, own-key guard, failed-save state
// ---------------------------------------------------------------------------

test('spellcheck — set throws on a string via the typeof fallback', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.load(dir);
    assert.throws(
      () => store.set('spellcheck', 'true'),
      (err) => err instanceof TypeError && err.message.includes('invalid value')
    );
    assert.equal(store.get('spellcheck'), false);
  } finally {
    removeTempDir(dir);
  }
});

test('set rejects inherited Object.prototype keys as unknown settings keys', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.load(dir);
    assert.throws(
      () => store.set('toString', 'x'),
      (err) => err instanceof TypeError && err.message.includes('unknown settings key')
    );
  } finally {
    removeTempDir(dir);
  }
});

test('failed serialization leaves the prior config live', () => {
  const dir = makeTempDir();
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
    removeTempDir(dir);
  }
});
