'use strict';

// Unit tests for src/shared/jar-data-classes.js (M06 Flight 4, Leg 1 / DD2).
//
// Pure, dependency-free ES module (M07 Flight 2 sweep) — exercised via
// require(esm) below (destructuring the module namespace, same as jar-ipc.js).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { JAR_DATA_CLASSES, jarDataClassById } = require('../../src/shared/jar-data-classes');

// Electron's ClearStorageDataOptions.storages taxonomy — a literal copy (NOT a
// require of electron's own types) so this test independently pins the set we
// promise never to exceed. Verified live against the installed Electron's
// electron.d.ts:20369 at leg design time.
const ELECTRON_STORAGES_TAXONOMY = new Set([
  'cookies',
  'filesystem',
  'indexdb',
  'localstorage',
  'shadercache',
  'websql',
  'serviceworkers',
  'cachestorage'
]);

// ---------------------------------------------------------------------------
// Shape / frozen-ness
// ---------------------------------------------------------------------------
test('JAR_DATA_CLASSES is frozen and every descriptor is frozen', () => {
  assert.ok(Object.isFrozen(JAR_DATA_CLASSES));
  for (const c of JAR_DATA_CLASSES) assert.ok(Object.isFrozen(c), `descriptor "${c.id}" should be frozen`);
});

test('ids are unique and exactly [cookies, storage, cache, history] in order', () => {
  const ids = JAR_DATA_CLASSES.map((c) => c.id);
  assert.deepEqual(ids, ['cookies', 'storage', 'cache', 'history']);
  assert.equal(new Set(ids).size, ids.length);
});

test('every non-null storages value is a subset of the Electron ClearStorageDataOptions taxonomy', () => {
  for (const c of JAR_DATA_CLASSES) {
    if (c.storages === null) continue;
    assert.ok(Array.isArray(c.storages), `"${c.id}".storages should be an array or null`);
    for (const s of c.storages) {
      assert.ok(ELECTRON_STORAGES_TAXONOMY.has(s), `"${c.id}".storages contains "${s}", not in the Electron taxonomy`);
    }
  }
});

test('every descriptor has a non-empty label', () => {
  for (const c of JAR_DATA_CLASSES) {
    assert.equal(typeof c.label, 'string');
    assert.ok(c.label.length > 0, `"${c.id}" should have a non-empty label`);
  }
});

// ---------------------------------------------------------------------------
// Per-class mapping (DD2)
// ---------------------------------------------------------------------------
test('cookies maps to exactly ["cookies"]', () => {
  assert.deepEqual(jarDataClassById('cookies').storages, ['cookies']);
});

test('storage maps to the full non-cookie storages set, labeled "Site storage"', () => {
  const storage = jarDataClassById('storage');
  assert.equal(storage.label, 'Site storage');
  assert.deepEqual(storage.storages, ['filesystem', 'indexdb', 'localstorage', 'websql', 'serviceworkers', 'cachestorage']);
});

test('cache is the null sentinel (not a clearStorageData storages set)', () => {
  assert.equal(jarDataClassById('cache').storages, null);
});

// ---------------------------------------------------------------------------
// history (M08 Flight 3 / DD1) — the `custom` discriminator
// ---------------------------------------------------------------------------
test('history is the null-storages sentinel, discriminated via custom: "history", frozen, labeled "History"', () => {
  const history = jarDataClassById('history');
  assert.ok(Object.isFrozen(history));
  assert.equal(history.label, 'History');
  assert.equal(history.storages, null);
  assert.equal(history.custom, 'history');
});

test('history is the ONLY descriptor carrying a custom discriminator', () => {
  for (const c of JAR_DATA_CLASSES) {
    if (c.id === 'history') continue;
    assert.equal(c.custom, undefined, `"${c.id}" should not carry a custom discriminator`);
  }
});

// ---------------------------------------------------------------------------
// jarDataClassById
// ---------------------------------------------------------------------------
test('jarDataClassById round-trips every id in JAR_DATA_CLASSES', () => {
  for (const c of JAR_DATA_CLASSES) {
    assert.equal(jarDataClassById(c.id), c);
  }
});

test('jarDataClassById returns null for an unknown id', () => {
  assert.equal(jarDataClassById('nonexistent'), null);
  assert.equal(jarDataClassById(''), null);
  assert.equal(jarDataClassById('COOKIES'), null); // case-sensitive
});
