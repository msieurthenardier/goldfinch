'use strict';

// Unit tests for src/shared/jar-data-classes.js (M06 Flight 4, Leg 1 / DD2).
//
// Pure, dependency-free dual-export module — the CJS branch is exercised via
// require() below; the globalThis branch is exercised with the same `vm`
// technique test/unit/jars-page-shared-scripts.test.js uses to prove the
// classic-<script> load path actually populates the expected globals (no
// `module`/`require` in the sandbox, so the module's dual-export tail takes its
// globalThis branch, exactly as it does in the real goldfinch://jars document).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

test('ids are unique and exactly [cookies, storage, cache] in order', () => {
  const ids = JAR_DATA_CLASSES.map((c) => c.id);
  assert.deepEqual(ids, ['cookies', 'storage', 'cache']);
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
// jarDataClassById
// ---------------------------------------------------------------------------
test('jarDataClassById round-trips every id in JAR_DATA_CLASSES', () => {
  for (const c of JAR_DATA_CLASSES) {
    assert.equal(jarDataClassById(c.id), c);
  }
});

test('jarDataClassById returns null for an unknown id', () => {
  assert.equal(jarDataClassById('history'), null);
  assert.equal(jarDataClassById(''), null);
  assert.equal(jarDataClassById('COOKIES'), null); // case-sensitive
});

// ---------------------------------------------------------------------------
// Browser global branch (classic <script>, no module/require) — the vm
// technique jars-page-shared-scripts.test.js uses for the shared-scope net,
// applied here directly to prove THIS module's globalThis branch is correct,
// not just collision-free.
// ---------------------------------------------------------------------------
test('the globalThis branch (classic <script> load) populates JAR_DATA_CLASSES and jarDataClassById', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/shared/jar-data-classes.js'), 'utf8');
  const sandbox = {};
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: 'jar-data-classes.js' });
  // Array.from(...) here runs against the OUTER realm's Array constructor, so the
  // result is a plain outer-realm array — comparing the vm-realm array directly
  // against an outer-realm literal trips Node assert's cross-realm identity check
  // ("same structure but not reference-equal") even though the contents match.
  assert.deepEqual(
    Array.from(sandbox.JAR_DATA_CLASSES, (c) => c.id),
    ['cookies', 'storage', 'cache']
  );
  assert.equal(typeof sandbox.jarDataClassById, 'function');
  assert.equal(sandbox.jarDataClassById('cache').storages, null);
  assert.equal(sandbox.jarDataClassById('nope'), null);
});
