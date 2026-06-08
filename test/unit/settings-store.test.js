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
