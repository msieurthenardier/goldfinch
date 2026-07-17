'use strict';

// Unit tests for src/main/shields.js
//
// No Electron stub needed — flight 10-1 DD8 (leg 2) brought shields up to house
// discipline: no require('electron'), no app.getPath at module scope. The
// userData path is injected via load(userDataPath), and shields.js now persists
// through app-db.js's document-row seam. app-db is required ONCE for the whole
// file (never cache-busted — the settings-store.test.js require-order-hazard
// ruling) and reset per test via appDb.open(dir); shields.js itself IS
// cache-busted per test (freshStore(), the jars.test.js pattern) so
// module-scoped state (config, docStore, codec) never leaks across tests.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const appDb = require('../../src/main/app-db');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-shields-'));
}

function removeTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Re-require shields fresh per test so module-scoped state (config, docStore,
// codec) doesn't leak across tests — mirrors jars.test.js's freshStore().
function freshStore() {
  const resolved = require.resolve('../../src/main/shields');
  delete require.cache[resolved];
  return require('../../src/main/shields');
}

// Read the raw 'shields' document row payload directly off app.db, bypassing
// the store — used to assert on the row (the migration target).
function readRow(dir) {
  const check = new DatabaseSync(path.join(dir, 'app.db'));
  try {
    const row = /** @type {any} */ (
      check.prepare('SELECT payload FROM documents WHERE store = ?1').get('shields')
    );
    return row ? JSON.parse(row.payload) : null;
  } finally {
    check.close();
  }
}

// A single top-level require for the pure functions below (isTrackingParam,
// stripUrl touch no module state, so instance identity doesn't matter).
const shieldsPure = require('../../src/main/shields');

// ---------------------------------------------------------------------------
// isTrackingParam
// ---------------------------------------------------------------------------
test('isTrackingParam: gclid is a tracking param', () => {
  assert.equal(shieldsPure.isTrackingParam('gclid'), true);
});

test('isTrackingParam: utm_source prefix is a tracking param', () => {
  assert.equal(shieldsPure.isTrackingParam('utm_source'), true);
});

test('isTrackingParam: hsa_ prefix is a tracking param', () => {
  assert.equal(shieldsPure.isTrackingParam('hsa_x'), true);
});

test('isTrackingParam: pk_ prefix is a tracking param', () => {
  assert.equal(shieldsPure.isTrackingParam('pk_y'), true);
});

test('isTrackingParam: mtm_ prefix is a tracking param', () => {
  assert.equal(shieldsPure.isTrackingParam('mtm_z'), true);
});

test('isTrackingParam: GCLID is case-insensitive → true', () => {
  assert.equal(shieldsPure.isTrackingParam('GCLID'), true);
});

test('isTrackingParam: q is not a tracking param', () => {
  assert.equal(shieldsPure.isTrackingParam('q'), false);
});

// ---------------------------------------------------------------------------
// stripUrl
// ---------------------------------------------------------------------------
test('stripUrl: mixed URL preserves non-tracking params and strips tracking ones', () => {
  const result = shieldsPure.stripUrl('https://example.com/path?q=hello&utm_source=foo');
  assert.ok(result !== null, 'should return a stripped URL (not null)');
  const u = new URL(result);
  assert.equal(u.searchParams.get('q'), 'hello', 'q param should be preserved');
  assert.equal(u.searchParams.has('utm_source'), false, 'utm_source should be stripped');
});

test('stripUrl: URL with no tracking params returns null', () => {
  assert.equal(shieldsPure.stripUrl('https://example.com/path?q=hello&page=2'), null);
});

test('stripUrl: invalid URL returns null', () => {
  assert.equal(shieldsPure.stripUrl('not-a-url'), null);
});

// ---------------------------------------------------------------------------
// active (pre-load — docStore is null, save() is a silent no-op)
// ---------------------------------------------------------------------------
test('active: default config + valid strategy + unpaused site → true', () => {
  const shields = freshStore();
  const result = shields.active('block', 'example.com');
  assert.equal(result, true);
});

test('active: paused site → false', () => {
  const shields = freshStore();
  shields.setPaused('paused-site.com', true);
  assert.equal(shields.active('block', 'paused-site.com'), false);
});

test('active: master enabled:false → false', () => {
  const shields = freshStore();
  shields.set({ enabled: false });
  assert.equal(shields.active('block', 'example.com'), false);
});

// ---------------------------------------------------------------------------
// isPaused (pre-load)
// ---------------------------------------------------------------------------
test('isPaused: site in pausedSites → true', () => {
  const shields = freshStore();
  shields.setPaused('tracked-site.com', true);
  assert.equal(shields.isPaused('tracked-site.com'), true);
});

test('isPaused: absent site → false', () => {
  const shields = freshStore();
  assert.equal(shields.isPaused('not-paused.com'), false);
});

test('isPaused: empty string → false', () => {
  const shields = freshStore();
  assert.equal(shields.isPaused(''), false);
});

// ---------------------------------------------------------------------------
// F3 + F8: pausedSites shape safety (load / set / isPaused / setPaused)
// ---------------------------------------------------------------------------
test('F3 load: null pausedSites coerces to [] and active never throws', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    fs.writeFileSync(path.join(dir, 'shields.json'), JSON.stringify({ pausedSites: null }));
    const shields = freshStore();
    const cfg = shields.load(dir);
    assert.deepEqual(cfg.pausedSites, []);
    assert.doesNotThrow(() => shields.active('block', 'x.com'));
    assert.equal(shields.active('block', 'x.com'), true);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('F3 load: string pausedSites coerces to [] (no char-split)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    fs.writeFileSync(path.join(dir, 'shields.json'), JSON.stringify({ pausedSites: 'ab' }));
    const shields = freshStore();
    const cfg = shields.load(dir);
    assert.deepEqual(cfg.pausedSites, []);
    assert.equal(shields.isPaused('a'), false);
    assert.equal(shields.isPaused('b'), false);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('F8 set: non-array pausedSites does not corrupt state into single chars', () => {
  const shields = freshStore();
  shields.set({ pausedSites: 'ab' });
  const sites = shields.get().pausedSites;
  assert.ok(Array.isArray(sites), 'pausedSites must remain an array');
  assert.deepEqual(sites, []);
  assert.equal(sites.includes('a'), false);
  assert.equal(sites.includes('b'), false);
  // isPaused / active must not throw
  assert.doesNotThrow(() => shields.isPaused('a'));
  assert.doesNotThrow(() => shields.active('block', 'x.com'));
});

test('F3+F8 setPaused after a bad pausedSites value keeps a proper array', () => {
  const shields = freshStore();
  shields.set({ pausedSites: 'ab' });
  shields.setPaused('safe.example.com', true);
  const sites = shields.get().pausedSites;
  assert.ok(Array.isArray(sites));
  assert.deepEqual(sites, ['safe.example.com']);
  assert.equal(shields.isPaused('safe.example.com'), true);
  assert.equal(shields.isPaused('a'), false);
});

test('F8 set: unknown keys and wrong-typed flags are ignored', () => {
  const shields = freshStore();
  shields.set({ enabled: 'nope', notAKey: true, block: false });
  const cfg = shields.get();
  assert.equal(cfg.enabled, true, 'wrong-typed enabled must not apply');
  assert.equal(cfg.block, false, 'boolean block must apply');
  assert.equal(Object.hasOwn(cfg, 'notAKey'), false);
});

// ---------------------------------------------------------------------------
// app-db integration (flight 10-1, leg 2): app-db-not-open propagation,
// legacy-JSON migration semantics (DD5), and DD10's refined save() discipline.
// ---------------------------------------------------------------------------

test('load() throws when app-db is not open (mis-ordered boot must propagate, not fall back to defaults)', () => {
  const dir = makeTempDir();
  try {
    // Deliberately do NOT call appDb.open(dir) — app-db starts closed.
    const shields = freshStore();
    assert.throws(() => shields.load(dir), /app db not open/);
  } finally {
    removeTempDir(dir);
  }
});

test('save(): not-loaded state is a silent no-op (no docStore yet, no throw) — today\'s pre-load semantics, unchanged', () => {
  const shields = freshStore();
  assert.doesNotThrow(() => shields.set({ enabled: false }));
  assert.equal(shields.get().enabled, false, 'the in-memory mutation still applies even though nothing persists');
  assert.doesNotThrow(() => shields.setPaused('never-loaded.example.com', true));
});

test('save(): loaded-state write failure propagates (DD10 refined) — the old swallow-everything catch is gone', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const shields = freshStore();
    shields.load(dir, {
      serialize: () => {
        throw new Error('boom');
      }
    });
    assert.throws(() => shields.set({ enabled: false }), /boom/);
    assert.throws(() => shields.setPaused('x.com', true), /boom/);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('migration: legacy shields.json is imported once, values intact, then renamed .migrated', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const legacy = JSON.stringify({ enabled: false, block: false, pausedSites: ['x.com'] });
    fs.writeFileSync(path.join(dir, 'shields.json'), legacy, 'utf8');

    const shields = freshStore();
    const result = shields.load(dir);

    assert.equal(result.enabled, false);
    assert.equal(result.block, false);
    assert.deepEqual(result.pausedSites, ['x.com']);

    const row = readRow(dir);
    assert.ok(row !== null);
    assert.equal(row.enabled, false);
    assert.deepEqual(row.pausedSites, ['x.com']);

    // The legacy file is gone; a .migrated sibling remains as the rollback artifact.
    assert.ok(!fs.existsSync(path.join(dir, 'shields.json')), 'shields.json should be renamed away');
    assert.ok(fs.existsSync(path.join(dir, 'shields.json.migrated')), 'shields.json.migrated should exist');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('migration: corrupt legacy shields.json still migrates (repaired-to-defaults row + rename)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    fs.writeFileSync(path.join(dir, 'shields.json'), '{{not valid json!!', 'utf8');

    const shields = freshStore();
    const result = shields.load(dir);

    assert.equal(result.enabled, true, 'corrupt legacy JSON repairs to defaults');

    const row = readRow(dir);
    assert.ok(row !== null, 'the repaired-to-defaults result still migrates as the row');
    assert.equal(row.enabled, true);

    assert.ok(!fs.existsSync(path.join(dir, 'shields.json')));
    assert.ok(fs.existsSync(path.join(dir, 'shields.json.migrated')), 'the corrupt original still renames .migrated');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('migration: a present row wins over a stray legacy shields.json (no re-import)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    // Seed the row directly (simulating an already-migrated profile).
    const shields = freshStore();
    shields.load(dir);
    shields.set({ enabled: false });

    // Now drop a stray legacy file with a DIFFERENT value — this must be ignored.
    fs.writeFileSync(path.join(dir, 'shields.json'), JSON.stringify({ enabled: true }), 'utf8');

    const shields2 = freshStore();
    const result = shields2.load(dir);
    assert.equal(result.enabled, false, 'row wins; stray JSON is not re-imported');

    // The stray file is untouched (no rename — no migration happened).
    assert.ok(fs.existsSync(path.join(dir, 'shields.json')));
    assert.ok(!fs.existsSync(path.join(dir, 'shields.json.migrated')));
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('migration: no row, no legacy file → defaults, no migration side effects', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const shields = freshStore();
    const result = shields.load(dir);
    assert.equal(result.enabled, true);
    assert.equal(readRow(dir), null, 'a fresh profile seeds defaults in memory only, no row write');
    assert.ok(!fs.existsSync(path.join(dir, 'shields.json.migrated')));
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});
