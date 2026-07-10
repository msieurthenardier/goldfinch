'use strict';

// Unit tests for src/main/jars.js (v2 lifecycle model + three-shape load
// migration, M06 Flight 1 Legs 1-2).
//
// No electron-stub needed — jars.js is Electron-free (no require('electron'));
// the userData path is injected via load(userDataPath).
//
// The store is a MODULE-SCOPED SINGLETON, so lifecycle/persistence tests re-require
// it fresh per test (cache-bust, the downloads-store.test.js pattern) with a real
// temp dir. Pure validateContainers/isSafeColor cases use the shared top-level
// require — they touch no module state.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { BURNER } = require('../../src/shared/burner');
const { validateContainers, isSafeColor } = require('../../src/main/jars');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-jars-'));
}

function removeTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function freshStore() {
  const resolved = require.resolve('../../src/main/jars');
  delete require.cache[resolved];
  return require('../../src/main/jars');
}

function storeFile(dir) {
  return path.join(dir, 'containers.json');
}

function writeStore(dir, payload) {
  fs.writeFileSync(storeFile(dir), typeof payload === 'string' ? payload : JSON.stringify(payload));
}

// The DD3 legacy probe target: load() treats this dir's existence as "the app
// has run before" (main.js pre-warms persist:goldfinch on every launch).
function probeDir(dir) {
  fs.mkdirSync(path.join(dir, 'Partitions', 'goldfinch'), { recursive: true });
}

function readStore(dir) {
  return JSON.parse(fs.readFileSync(storeFile(dir), 'utf8'));
}

// A valid v2 envelope factory.
function v2(containers, defaultId = null) {
  return { version: 2, defaultId, containers };
}

// Helpers
const validDefault = { id: 'default', name: 'Default', color: '#9aa0ac', partition: 'persist:goldfinch' };
const validPersonal = { id: 'personal', name: 'Personal', color: '#4caf50', partition: 'persist:container:personal' };
const validWork = { id: 'work', name: 'Work', color: '#2196f3', partition: 'persist:container:work' };
const validBanking = { id: 'banking', name: 'Banking', color: '#f5c518', partition: 'persist:container:banking' };

// ---------------------------------------------------------------------------
// All-valid passthrough
// ---------------------------------------------------------------------------
test('all-valid input: all entries are kept', () => {
  const result = validateContainers([validDefault, validPersonal, validWork]);
  assert.equal(result.length, 3);
  assert.ok(result.some((c) => c.id === 'default'));
  assert.ok(result.some((c) => c.id === 'personal'));
  assert.ok(result.some((c) => c.id === 'work'));
});

// ---------------------------------------------------------------------------
// Mixed valid / invalid — valid ones survive, invalid dropped
// ---------------------------------------------------------------------------
test('mixed valid and invalid: valid entries are kept, invalid dropped', () => {
  const input = [
    validDefault,
    { id: 123, name: 'Bad id (number)', partition: 'persist:x' },
    { id: '', name: 'Empty id', partition: 'persist:x' },
    null,
    'string',
    42,
    validPersonal
  ];
  const result = validateContainers(input);
  assert.ok(result.some((c) => c.id === 'default'));
  assert.ok(result.some((c) => c.id === 'personal'));
  // The invalid entries should NOT appear
  assert.equal(result.filter((c) => c.id === 123 || c.id === '').length, 0);
});

// ---------------------------------------------------------------------------
// Missing / non-string partition dropped
// ---------------------------------------------------------------------------
test('entry with missing partition is dropped', () => {
  const input = [validDefault, { id: 'no-partition', name: 'No partition' }];
  const result = validateContainers(input);
  assert.ok(!result.some((c) => c.id === 'no-partition'));
});

test('entry with non-string partition (number) is dropped', () => {
  const input = [validDefault, { id: 'num-partition', name: 'Num', partition: 12345 }];
  const result = validateContainers(input);
  assert.ok(!result.some((c) => c.id === 'num-partition'));
});

// ---------------------------------------------------------------------------
// Bad partition prefix dropped (must start with "persist:")
// ---------------------------------------------------------------------------
test('entry with partition not starting with persist: is dropped', () => {
  const input = [
    validDefault,
    { id: 'bad-prefix', name: 'Bad', partition: 'session:evil' },
    { id: 'also-bad', name: 'Also bad', partition: 'goldfinch' }
  ];
  const result = validateContainers(input);
  assert.ok(!result.some((c) => c.id === 'bad-prefix'));
  assert.ok(!result.some((c) => c.id === 'also-bad'));
});

// ---------------------------------------------------------------------------
// Duplicate ids deduped (first occurrence wins)
// ---------------------------------------------------------------------------
test('duplicate ids: first occurrence wins', () => {
  const input = [
    validDefault,
    { id: 'dup', name: 'First', color: '#111111', partition: 'persist:container:dup-a' },
    { id: 'dup', name: 'Second', color: '#222222', partition: 'persist:container:dup-b' }
  ];
  const result = validateContainers(input);
  const dups = result.filter((c) => c.id === 'dup');
  assert.equal(dups.length, 1);
  assert.equal(dups[0].name, 'First');
});

// ---------------------------------------------------------------------------
// TWO DISTINCT IDS SHARING ONE PARTITION → only first kept (the core isolation guarantee)
// ---------------------------------------------------------------------------
test('two distinct ids sharing one partition: only first is kept', () => {
  const input = [
    validDefault,
    { id: 'alice', name: 'Alice', color: '#aaaaaa', partition: 'persist:container:shared' },
    { id: 'bob', name: 'Bob', color: '#bbbbbb', partition: 'persist:container:shared' }
  ];
  const result = validateContainers(input);
  // Only one entry with that partition must survive
  const withSharedPartition = result.filter((c) => c.partition === 'persist:container:shared');
  assert.equal(withSharedPartition.length, 1);
  assert.equal(withSharedPartition[0].id, 'alice');
  // Bob must be absent
  assert.ok(!result.some((c) => c.id === 'bob'));
});

// ---------------------------------------------------------------------------
// Non-default entry with partition 'persist:goldfinch' dropped (kept as-is per
// flight DD5 — persist:goldfinch is valid ONLY on id 'default')
// ---------------------------------------------------------------------------
test('non-default entry with partition persist:goldfinch is dropped', () => {
  const input = [validDefault, { id: 'hijack', name: 'Hijack', color: '#ff0000', partition: 'persist:goldfinch' }];
  const result = validateContainers(input);
  assert.ok(!result.some((c) => c.id === 'hijack'));
  // The real default should still be present
  assert.ok(result.some((c) => c.id === 'default'));
});

// ---------------------------------------------------------------------------
// No floor (flipped from the v1 "default floor" tests): the v2 model has no
// injected default entry — an input without one validates to exactly its
// survivors (flight DD2: empty/default-less is a valid state, never repaired
// by injecting entries; the default FLAG is repaired instead, on load).
// ---------------------------------------------------------------------------
test('no floor: missing default entry is NOT injected', () => {
  const input = [validPersonal, validWork];
  const result = validateContainers(input);
  assert.equal(result.length, 2, 'only the survivors — nothing injected');
  assert.ok(
    !result.some((c) => c.id === 'default'),
    'no default entry must be conjured from thin air'
  );
});

test('no floor: empty input validates to an empty array', () => {
  assert.deepEqual(validateContainers([]), []);
});

// ---------------------------------------------------------------------------
// Reserved burner namespace (flight DD4): remap, never drop
// ---------------------------------------------------------------------------
test('reserved id burner is remapped to jar-burner; partition and name preserved', () => {
  const input = [{ id: 'burner', name: 'Burner', color: '#ff8c42', partition: 'persist:container:burner' }];
  const result = validateContainers(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'jar-burner');
  assert.equal(result[0].name, 'Burner', 'display name untouched by the remap');
  assert.equal(result[0].partition, 'persist:container:burner', 'partition string preserved');
});

test('reserved id burner-2 is remapped to jar-burner-2', () => {
  const input = [{ id: 'burner-2', name: 'Ephemeral?', color: '#abc', partition: 'persist:container:burner-2' }];
  const result = validateContainers(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'jar-burner-2');
  assert.equal(result[0].partition, 'persist:container:burner-2');
});

test('remap collision: input with both burner and jar-burner keeps BOTH (remapped → jar-burner-1)', () => {
  const input = [
    { id: 'burner', name: 'Burner', color: '#ff8c42', partition: 'persist:container:burner' },
    { id: 'jar-burner', name: 'Literal', color: '#123456', partition: 'persist:container:jar-burner' }
  ];
  const result = validateContainers(input);
  assert.equal(result.length, 2, 'remap never drops an entry');
  const remapped = result.find((c) => c.partition === 'persist:container:burner');
  const literal = result.find((c) => c.partition === 'persist:container:jar-burner');
  assert.equal(remapped.id, 'jar-burner-1', 'remap suffixes past the literal claim');
  assert.equal(literal.id, 'jar-burner', 'the literal jar-burner keeps its id');
});

// ---------------------------------------------------------------------------
// Non-array input → empty array
// ---------------------------------------------------------------------------
test('non-array input returns empty array', () => {
  assert.deepEqual(validateContainers(null), []);
  assert.deepEqual(validateContainers(undefined), []);
  assert.deepEqual(validateContainers({}), []);
  assert.deepEqual(validateContainers('string'), []);
  assert.deepEqual(validateContainers(42), []);
});

// ---------------------------------------------------------------------------
// __proto__ entry yields no unexpected keys on the built object
// ---------------------------------------------------------------------------
test('__proto__ entry does not pollute the resulting object', () => {
  // JSON.parse makes __proto__ a literal own-property, not a prototype chain attack.
  // The rebuild (field-by-field) must not leak it.
  const poisonedEntry = JSON.parse(
    '{"id":"safe","partition":"persist:container:safe","name":"Safe","color":"#ffffff","__proto__":{"polluted":true}}'
  );
  const result = validateContainers([validDefault, poisonedEntry]);
  const safe = result.find((c) => c.id === 'safe');
  assert.ok(safe, 'valid entry with extra __proto__ key should be kept');
  assert.ok(!Object.prototype.hasOwnProperty.call(safe, '__proto__'), '__proto__ must not appear as own property');
  assert.ok(!('polluted' in safe), 'prototype pollution must not occur');
  // Only the four expected keys
  const keys = Object.keys(safe);
  assert.deepEqual(keys.sort(), ['color', 'id', 'name', 'partition']);
});

// ---------------------------------------------------------------------------
// name > 24 chars truncated
// ---------------------------------------------------------------------------
test('name longer than 24 chars is truncated to 24', () => {
  const longName = 'A'.repeat(30);
  const input = [validDefault, { id: 'long-name', name: longName, partition: 'persist:container:long-name' }];
  const result = validateContainers(input);
  const entry = result.find((c) => c.id === 'long-name');
  assert.ok(entry);
  assert.ok(entry.name.length <= 24, `name should be truncated, got length ${entry.name.length}`);
});

// ---------------------------------------------------------------------------
// Non-string name/color coerced
// ---------------------------------------------------------------------------
test('non-string name is coerced with String()', () => {
  const input = [
    validDefault,
    { id: 'num-name', name: 12345, color: '#aabbcc', partition: 'persist:container:num-name' }
  ];
  const result = validateContainers(input);
  const entry = result.find((c) => c.id === 'num-name');
  assert.ok(entry);
  assert.equal(typeof entry.name, 'string');
  assert.equal(entry.name, '12345');
});

test('undefined name is coerced to string (String(undefined) = "undefined")', () => {
  // String(undefined) = 'undefined' which is truthy, so || 'Jar' does NOT fire.
  // This mirrors the same logic in add() — the 'Jar' fallback only kicks in for
  // values that coerce to an empty string (e.g. empty string itself).
  const input = [validDefault, { id: 'no-name', partition: 'persist:container:no-name' }];
  const result = validateContainers(input);
  const entry = result.find((c) => c.id === 'no-name');
  assert.ok(entry);
  assert.equal(entry.name, 'undefined');
});

test('empty-string name falls back to Jar', () => {
  const input = [validDefault, { id: 'empty-name', name: '', partition: 'persist:container:empty-name' }];
  const result = validateContainers(input);
  const entry = result.find((c) => c.id === 'empty-name');
  assert.ok(entry);
  assert.equal(entry.name, 'Jar');
});

test('non-string color falls back to default color', () => {
  const input = [
    validDefault,
    { id: 'bad-color', name: 'BadColor', color: 42, partition: 'persist:container:bad-color' },
    { id: 'null-color', name: 'NullColor', color: null, partition: 'persist:container:null-color' },
    { id: 'obj-color', name: 'ObjColor', color: { hex: '#fff' }, partition: 'persist:container:obj-color' }
  ];
  const result = validateContainers(input);
  ['bad-color', 'null-color', 'obj-color'].forEach((id) => {
    const entry = result.find((c) => c.id === id);
    assert.ok(entry, `entry ${id} should be present`);
    assert.equal(entry.color, '#b06ef5', `${id} should have default color`);
  });
});

test('valid hex color string is kept', () => {
  const input = [
    validDefault,
    { id: 'str-color', name: 'StrColor', color: '#ff0000', partition: 'persist:container:str-color' }
  ];
  const result = validateContainers(input);
  const entry = result.find((c) => c.id === 'str-color');
  assert.ok(entry);
  assert.equal(entry.color, '#ff0000');
});

// ---------------------------------------------------------------------------
// isSafeColor — accepted values
// ---------------------------------------------------------------------------
test('isSafeColor accepts 6-digit hex (#9aa0ac)', () => {
  assert.equal(isSafeColor('#9aa0ac'), true);
});

test('isSafeColor accepts 3-digit hex (#abc)', () => {
  assert.equal(isSafeColor('#abc'), true);
});

test('isSafeColor accepts 4-digit hex CSS4 RGBA shorthand (#abcd)', () => {
  assert.equal(isSafeColor('#abcd'), true);
});

test('isSafeColor accepts 8-digit hex CSS4 RGBA (#11223344)', () => {
  assert.equal(isSafeColor('#11223344'), true);
});

test('isSafeColor accepts lowercase CSS color keyword (red)', () => {
  assert.equal(isSafeColor('red'), true);
});

test('isSafeColor accepts mixed-case CSS color keyword (RebeccaPurple)', () => {
  assert.equal(isSafeColor('RebeccaPurple'), true);
});

// ---------------------------------------------------------------------------
// isSafeColor — rejected values
// ---------------------------------------------------------------------------
test('isSafeColor rejects url() function notation', () => {
  assert.equal(isSafeColor('url(x)'), false);
});

test('isSafeColor rejects value with semicolon (red;)', () => {
  assert.equal(isSafeColor('red;'), false);
});

test('isSafeColor rejects injection payload (#000"><img>)', () => {
  assert.equal(isSafeColor('#000"><img>'), false);
});

test('isSafeColor rejects value with double-quote (red")', () => {
  assert.equal(isSafeColor('red"'), false);
});

test('isSafeColor rejects rgb() function notation (rgb(0,0,0))', () => {
  assert.equal(isSafeColor('rgb(0,0,0)'), false);
});

test('isSafeColor rejects 2-digit hex (#12)', () => {
  assert.equal(isSafeColor('#12'), false);
});

test('isSafeColor rejects 7-digit hex (#1234567)', () => {
  assert.equal(isSafeColor('#1234567'), false);
});

test('isSafeColor rejects hex with non-hex chars (#xyz)', () => {
  assert.equal(isSafeColor('#xyz'), false);
});

test("isSafeColor rejects empty string ('')", () => {
  assert.equal(isSafeColor(''), false);
});

test("isSafeColor rejects string with leading whitespace ('  red')", () => {
  assert.equal(isSafeColor('  red'), false);
});

test('isSafeColor rejects non-string number (123)', () => {
  assert.equal(isSafeColor(123), false);
});

test('isSafeColor rejects non-string null', () => {
  assert.equal(isSafeColor(null), false);
});

test("isSafeColor rejects keyword with space ('a b')", () => {
  assert.equal(isSafeColor('a b'), false);
});

// ---------------------------------------------------------------------------
// validateContainers — injection payload in color falls back to default
// ---------------------------------------------------------------------------
test('validateContainers: injection payload color falls back to default; other fields preserved', () => {
  const input = [
    validDefault,
    {
      id: 'poisoned',
      name: 'PoisonedColor',
      color: '#000"><img src=x onerror=alert(1)>',
      partition: 'persist:container:poisoned'
    }
  ];
  const result = validateContainers(input);
  const entry = result.find((c) => c.id === 'poisoned');
  assert.ok(entry, 'container with injection color should still be kept');
  assert.equal(entry.color, '#b06ef5', 'injection payload color should fall back to default');
  assert.equal(entry.name, 'PoisonedColor', 'name should be preserved');
  assert.equal(entry.partition, 'persist:container:poisoned', 'partition should be preserved');
});

// ===========================================================================
// BURNER identity constant (flight DD4)
// ===========================================================================
test('BURNER is frozen with the fixed identity shape', () => {
  assert.ok(Object.isFrozen(BURNER), 'BURNER must be frozen');
  assert.deepEqual(BURNER, { id: 'burner', name: 'Burner', color: '#ff8c42' });
});

// ===========================================================================
// load(userDataPath) — branch (a): the v2 envelope (the DD3/CP2 migration
// matrix for branches (b)/(c) follows below)
// ===========================================================================
test('load of a valid v2 envelope restores containers + defaultId', () => {
  const dir = makeTempDir();
  try {
    writeStore(dir, v2([validPersonal, validWork], 'work'));
    const store = freshStore();
    store.load(dir);
    assert.deepEqual(store.list().map((c) => c.id), ['personal', 'work']);
    assert.equal(store.getDefault().id, 'work');
  } finally {
    removeTempDir(dir);
  }
});

test('load of an empty v2 envelope stays empty — no reseed; getDefault() is BURNER', () => {
  const dir = makeTempDir();
  try {
    writeStore(dir, v2([], null));
    const store = freshStore();
    store.load(dir);
    assert.deepEqual(store.list(), [], 'empty is a VALID persisted state (flight DD2)');
    assert.equal(store.getDefault(), BURNER, 'null defaultId means Burner is the default');
  } finally {
    removeTempDir(dir);
  }
});

test('load repairs a dangling defaultId to the first surviving jar', () => {
  const dir = makeTempDir();
  try {
    writeStore(dir, v2([validPersonal, validWork], 'ghost'));
    const store = freshStore();
    store.load(dir);
    assert.equal(store.getDefault().id, 'personal');
  } finally {
    removeTempDir(dir);
  }
});

test('load treats a non-string defaultId as dangling → repair', () => {
  const dir = makeTempDir();
  try {
    writeStore(dir, v2([validPersonal], 42));
    const store = freshStore();
    store.load(dir);
    assert.equal(store.getDefault().id, 'personal');
  } finally {
    removeTempDir(dir);
  }
});

test('load repairs a defaultId whose entry was dropped by validation (repair runs AFTER validation)', () => {
  const dir = makeTempDir();
  try {
    // 'broken' holds the flag but has a bad partition → dropped → flag moves on.
    const broken = { id: 'broken', name: 'Broken', color: '#fff', partition: 'session:evil' };
    writeStore(dir, v2([broken, validPersonal, validWork], 'broken'));
    const store = freshStore();
    store.load(dir);
    assert.equal(store.getDefault().id, 'personal', 'flag lands on the first SURVIVING jar');
  } finally {
    removeTempDir(dir);
  }
});

test('load remaps reserved burner ids from a v2 file (data survives under the new id)', () => {
  const dir = makeTempDir();
  try {
    const saved = { id: 'burner', name: 'Burner', color: '#ff8c42', partition: 'persist:container:burner' };
    writeStore(dir, v2([saved], 'burner'));
    const store = freshStore();
    store.load(dir);
    assert.equal(store.list().length, 1);
    assert.equal(store.list()[0].id, 'jar-burner');
    assert.equal(store.list()[0].partition, 'persist:container:burner');
    // The old id is now dangling → repaired to the (remapped) first jar.
    assert.equal(store.getDefault().id, 'jar-burner');
  } finally {
    removeTempDir(dir);
  }
});

// ===========================================================================
// Three-shape load migration — the DD3/CP2 matrix. Every seed expectation here
// is PROBE-EXPLICIT (probe dir present → legacy, absent → fresh): Leg 1's
// unconditional "corrupt/missing → fresh seed" pins are folded in below with
// both probe sides tested, because post-first-run the partition dir always
// exists and corrupt/missing then means the LEGACY seed.
// ===========================================================================

test('v1 migration: operator-shaped array survives whole, defaultId default, rewritten as v2 exactly once, reload idempotent', () => {
  const dir = makeTempDir();
  try {
    const custom = { id: 'scratch', name: 'Scratch', color: '#123456', partition: 'persist:container:scratch' };
    writeStore(dir, [validDefault, validPersonal, validWork, validBanking, custom]);
    let store = freshStore();
    store.load(dir);
    assert.deepEqual(store.list().map((c) => c.id), ['default', 'personal', 'work', 'banking', 'scratch']);
    assert.equal(store.getDefault().id, 'default');
    const onDisk = readStore(dir);
    assert.equal(onDisk.version, 2, 'the v1 file is rewritten as a v2 envelope inside load()');
    assert.equal(onDisk.defaultId, 'default');
    // The rewrite happens exactly ONCE: a second load parses the v2 envelope,
    // and branch (a) never re-saves — the file BYTES must be untouched (state
    // idempotency alone would not prove that).
    const bytesAfterFirst = fs.readFileSync(storeFile(dir), 'utf8');
    store = freshStore();
    store.load(dir);
    assert.deepEqual(store.list().map((c) => c.id), ['default', 'personal', 'work', 'banking', 'scratch']);
    assert.equal(store.getDefault().id, 'default');
    assert.equal(fs.readFileSync(storeFile(dir), 'utf8'), bytesAfterFirst, 'second load must not rewrite the file');
  } finally {
    removeTempDir(dir);
  }
});

test('v1 migration: array without a default entry → defaultId lands on the first surviving entry', () => {
  const dir = makeTempDir();
  try {
    writeStore(dir, [validPersonal, validWork]);
    const store = freshStore();
    store.load(dir);
    assert.deepEqual(store.list().map((c) => c.id), ['personal', 'work']);
    assert.equal(store.getDefault().id, 'personal', "no surviving 'default' → first surviving entry");
    assert.equal(readStore(dir).defaultId, 'personal');
  } finally {
    removeTempDir(dir);
  }
});

test('v1 migration: reserved burner id migrates under the remapped jar-burner id, partition intact', () => {
  const dir = makeTempDir();
  try {
    const saved = { id: 'burner', name: 'Burner', color: '#ff8c42', partition: 'persist:container:burner' };
    writeStore(dir, [validDefault, saved]);
    const store = freshStore();
    store.load(dir);
    assert.deepEqual(store.list().map((c) => c.id), ['default', 'jar-burner']);
    const remapped = store.list().find((c) => c.id === 'jar-burner');
    assert.equal(remapped.partition, 'persist:container:burner', 'partition string preserved by the remap');
    assert.equal(readStore(dir).containers.some((c) => c.id === 'burner'), false, 'the reserved id never reaches disk');
  } finally {
    removeTempDir(dir);
  }
});

test('v1 array validating to zero entries + probe dir present → legacy seed (falls through to the probe)', () => {
  const dir = makeTempDir();
  try {
    writeStore(dir, [1, 'x', { id: 123 }]);
    probeDir(dir);
    const store = freshStore();
    store.load(dir);
    assert.deepEqual(store.list().map((c) => c.id), ['default', 'personal', 'work', 'banking']);
    assert.equal(store.getDefault().id, 'default');
  } finally {
    removeTempDir(dir);
  }
});

test('v1 array validating to zero entries without probe dir → fresh seed', () => {
  const dir = makeTempDir();
  try {
    writeStore(dir, [1, 'x', { id: 123 }]);
    const store = freshStore();
    store.load(dir);
    assert.deepEqual(store.list().map((c) => c.id), ['personal', 'work']);
    assert.equal(store.getDefault().id, 'personal');
  } finally {
    removeTempDir(dir);
  }
});

test('no file + probe dir present → legacy seed by content; v2 file written', () => {
  const dir = makeTempDir();
  try {
    probeDir(dir);
    const store = freshStore();
    store.load(dir);
    assert.deepEqual(store.list().map((c) => c.id), ['default', 'personal', 'work', 'banking']);
    assert.equal(store.getDefault().id, 'default');
    assert.deepEqual(
      store.list().filter((c) => c.partition === 'persist:goldfinch').map((c) => c.id),
      ['default'],
      'persist:goldfinch on default only'
    );
    const onDisk = readStore(dir);
    assert.equal(onDisk.version, 2, 'the legacy seed is persisted inside the same load() call');
    assert.equal(onDisk.defaultId, 'default');
    assert.equal(onDisk.containers.length, 4);
  } finally {
    removeTempDir(dir);
  }
});

test('v2-shaped envelope with the wrong version + no probe dir → fresh seed (neither the v1 nor the v2 arm)', () => {
  const dir = makeTempDir();
  try {
    writeStore(dir, { version: 3, defaultId: 'x', containers: [validPersonal] });
    const store = freshStore();
    store.load(dir);
    assert.deepEqual(store.list().map((c) => c.id), ['personal', 'work'], 'unknown version = reseed via probe');
    assert.equal(store.getDefault().id, 'personal');
    assert.equal(readStore(dir).version, 2, 'rewritten as the current envelope');
  } finally {
    removeTempDir(dir);
  }
});

test('missing file without probe dir → fresh seed (Personal default + Work); v2 file written', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.load(dir);
    assert.deepEqual(store.list().map((c) => c.id), ['personal', 'work']);
    assert.equal(store.getDefault().id, 'personal', 'Personal is the fresh-seed default');
    const onDisk = readStore(dir);
    assert.equal(onDisk.version, 2, 'the fresh seed is persisted inside the same load() call');
    assert.equal(onDisk.defaultId, 'personal');
  } finally {
    removeTempDir(dir);
  }
});

test('launch-#2 pin: fresh seed persists, so a probe dir appearing later does NOT re-seed as legacy', () => {
  const dir = makeTempDir();
  try {
    let store = freshStore();
    store.load(dir); // true first run: no file, no probe dir → fresh seed, saved
    assert.deepEqual(store.list().map((c) => c.id), ['personal', 'work']);
    // main.js pre-warms persist:goldfinch on every launch — simulate launch #2.
    probeDir(dir);
    store = freshStore();
    store.load(dir);
    assert.deepEqual(store.list().map((c) => c.id), ['personal', 'work'], 'STILL Personal+Work — the saved seed outlives the probe');
    assert.equal(store.getDefault().id, 'personal');
  } finally {
    removeTempDir(dir);
  }
});

test('userData dir not yet created (true first boot) → seed still persists; launch #2 stays fresh', () => {
  // Integration-only failure caught at M06 F1 Leg 4: on a real first run the
  // dev-redirected userData dir does not exist yet when load() runs in whenReady
  // (Electron creates it lazily), so the DD3c synchronous seed persist would
  // ENOENT into save()'s fail-soft catch — and the pre-warm then makes launch #2
  // re-probe the fresh install as legacy. save() must create the directory.
  const base = makeTempDir();
  const dir = path.join(base, 'goldfinch-dev'); // never mkdir'd here
  try {
    let store = freshStore();
    store.load(dir);
    assert.deepEqual(store.list().map((c) => c.id), ['personal', 'work']);
    assert.equal(readStore(dir).version, 2, 'seed persisted even though the dir had to be created');
    // Launch #2 with the probe dir present (pre-warm fired) must NOT flip to legacy.
    probeDir(dir);
    store = freshStore();
    store.load(dir);
    assert.deepEqual(store.list().map((c) => c.id), ['personal', 'work'], 'saved seed wins over the probe');
    assert.equal(store.getDefault().id, 'personal');
  } finally {
    removeTempDir(base);
  }
});

test('corrupt JSON + probe dir present → legacy seed; file rewritten as v2', () => {
  const dir = makeTempDir();
  try {
    writeStore(dir, '{not json!!!');
    probeDir(dir);
    const store = freshStore();
    assert.doesNotThrow(() => store.load(dir));
    assert.deepEqual(store.list().map((c) => c.id), ['default', 'personal', 'work', 'banking']);
    assert.equal(store.getDefault().id, 'default', 'post-first-run corrupt means the LEGACY seed, never fresh');
    assert.equal(readStore(dir).version, 2);
  } finally {
    removeTempDir(dir);
  }
});

test('corrupt JSON without probe dir → fresh seed; file rewritten as v2', () => {
  const dir = makeTempDir();
  try {
    writeStore(dir, '{not json!!!');
    const store = freshStore();
    assert.doesNotThrow(() => store.load(dir));
    assert.deepEqual(store.list().map((c) => c.id), ['personal', 'work']);
    assert.equal(store.getDefault().id, 'personal');
    assert.equal(readStore(dir).version, 2);
  } finally {
    removeTempDir(dir);
  }
});

test('empty v2 envelope is NOT rewritten into a seed — empty-is-valid is untouched by migration', () => {
  const dir = makeTempDir();
  try {
    writeStore(dir, v2([], null));
    const bytes = fs.readFileSync(storeFile(dir), 'utf8');
    const store = freshStore();
    store.load(dir);
    assert.deepEqual(store.list(), []);
    assert.equal(store.getDefault(), BURNER);
    assert.equal(fs.readFileSync(storeFile(dir), 'utf8'), bytes, 'a valid empty store is never reseeded (DD2)');
  } finally {
    removeTempDir(dir);
  }
});

test('seed clone integrity: a mutation after a legacy load never leaks into a later reseed', () => {
  const dir = makeTempDir();
  try {
    probeDir(dir);
    const store = freshStore();
    store.load(dir); // legacy seed — the third place the constants are instantiated
    store.rename('default', { name: 'X' });
    // Drop the persisted file so the SAME module instance re-runs branch (c):
    // if load() aliased LEGACY_DEFAULTS instead of cloning, the rename above
    // would have mutated the constant and 'X' would resurface here.
    fs.rmSync(storeFile(dir));
    store.load(dir);
    assert.equal(store.list().find((c) => c.id === 'default').name, 'Default', 'the seed constant must be pristine');
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Persistence on non-v2 shapes (flipped from Leg 1's interim suppression pins:
// post-migration EVERY load shape assigns storePath, so a later mutation DOES
// persist). Each pin asserts the post-add FILE SHAPE — a v2 envelope whose
// containers include the new jar — because branch (b)/(c)'s load-time rewrite
// alone would make a bare "file changed" assertion pass vacuously.
// ---------------------------------------------------------------------------
test('persistence pin (flipped Leg 1 suppression): v1 load → add() → v2 envelope on disk includes the new jar', () => {
  const dir = makeTempDir();
  try {
    writeStore(dir, JSON.stringify([validDefault, validPersonal]));
    const store = freshStore();
    store.load(dir);
    store.add('Scratch', '#123456');
    const onDisk = readStore(dir);
    assert.equal(onDisk.version, 2);
    assert.deepEqual(
      onDisk.containers.map((c) => c.id),
      ['default', 'personal', 'scratch'],
      'the post-add write must include the new jar — not just the load-time rewrite'
    );
    assert.equal(onDisk.defaultId, 'default');
  } finally {
    removeTempDir(dir);
  }
});

test('persistence pin (flipped Leg 1 suppression): missing-file load → add() → v2 envelope on disk includes the new jar', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.load(dir);
    store.add('Scratch');
    const onDisk = readStore(dir);
    assert.equal(onDisk.version, 2);
    assert.deepEqual(
      onDisk.containers.map((c) => c.id),
      ['personal', 'work', 'scratch'],
      'the fresh seed plus the added jar reach disk'
    );
  } finally {
    removeTempDir(dir);
  }
});

test('add() before load() does not throw and writes nothing (no storePath yet)', () => {
  const store = freshStore();
  const created = store.add('Preload', '#abcdef');
  assert.equal(created.id, 'preload');
  assert.equal(fs.existsSync('null.tmp'), false, 'no literal null.tmp may appear in cwd');
});

// ===========================================================================
// save() — atomic tmp+rename, v2 envelope shape
// ===========================================================================
test('save is atomic and writes the v2 envelope {version, defaultId, containers}', () => {
  const dir = makeTempDir();
  try {
    writeStore(dir, v2([], null));
    const store = freshStore();
    store.load(dir);
    store.add('Alpha', '#111111');
    const onDisk = readStore(dir);
    assert.equal(onDisk.version, 2);
    assert.equal(onDisk.defaultId, 'alpha');
    assert.deepEqual(onDisk.containers, [
      { id: 'alpha', name: 'Alpha', color: '#111111', partition: 'persist:container:alpha' }
    ]);
    assert.equal(fs.existsSync(storeFile(dir) + '.tmp'), false, 'tmp file must be renamed away');
  } finally {
    removeTempDir(dir);
  }
});

test('mutations round-trip through a reload', () => {
  const dir = makeTempDir();
  try {
    writeStore(dir, v2([validPersonal, validWork], 'personal'));
    let store = freshStore();
    store.load(dir);
    store.rename('work', { name: 'Job', color: '#000' });
    store.setDefault('work');
    store.remove('personal');

    store = freshStore();
    store.load(dir);
    assert.deepEqual(store.list(), [
      { id: 'work', name: 'Job', color: '#000', partition: 'persist:container:work' }
    ]);
    assert.equal(store.getDefault().id, 'work');
  } finally {
    removeTempDir(dir);
  }
});

// ===========================================================================
// Lifecycle API — add / rename / remove / setDefault / getDefault (flight DD2/DD5)
// ===========================================================================

// Every lifecycle test below runs against a persistence-ENABLED store (a valid v2
// file) so the DD2 invariant is exercised with save() live.
function loadedStore(dir, containers, defaultId) {
  writeStore(dir, v2(containers, defaultId));
  const store = freshStore();
  store.load(dir);
  return store;
}

test('add into an empty store auto-claims the default flag (DD2: no null-with-jars)', () => {
  const dir = makeTempDir();
  try {
    const store = loadedStore(dir, [], null);
    assert.equal(store.getDefault(), BURNER);
    const created = store.add('Alpha');
    assert.equal(store.getDefault().id, created.id, 'the first jar added becomes default');
    assert.equal(readStore(dir).defaultId, created.id, 'auto-claim is persisted');
  } finally {
    removeTempDir(dir);
  }
});

test('add into a non-empty store does NOT move the default flag', () => {
  const dir = makeTempDir();
  try {
    const store = loadedStore(dir, [validPersonal], 'personal');
    store.add('Beta');
    assert.equal(store.getDefault().id, 'personal');
  } finally {
    removeTempDir(dir);
  }
});

test('add cannot mint a reserved id: slug remap applies at mint time, display name untouched', () => {
  const dir = makeTempDir();
  try {
    const store = loadedStore(dir, [], null);
    const created = store.add('Burner');
    assert.equal(created.id, 'jar-burner');
    assert.equal(created.name, 'Burner');
    assert.equal(created.partition, 'persist:container:jar-burner');
    const again = store.add('burner 2');
    assert.equal(again.id, 'jar-burner-2', "'burner 2' slugs to reserved burner-2 → jar-burner-2");
    const collide = store.add('Burner');
    assert.equal(collide.id, 'jar-burner-1', 'collision loop suffixes past the existing jar-burner');
  } finally {
    removeTempDir(dir);
  }
});

test('rename updates name and color via the add() rules; id/partition untouched; persists', () => {
  const dir = makeTempDir();
  try {
    const store = loadedStore(dir, [validPersonal], 'personal');
    const updated = store.rename('personal', { name: 'X'.repeat(30), color: 'not a color;' });
    assert.equal(updated.id, 'personal', 'id immutable (DD5)');
    assert.equal(updated.partition, 'persist:container:personal', 'partition immutable (DD5)');
    assert.equal(updated.name, 'X'.repeat(24), 'name truncated to 24');
    assert.equal(updated.color, '#b06ef5', 'unsafe color falls back');
    assert.equal(readStore(dir).containers[0].name, 'X'.repeat(24), 'rename persisted');
  } finally {
    removeTempDir(dir);
  }
});

test('rename with only one of {name, color} preserves the other field', () => {
  const dir = makeTempDir();
  try {
    const store = loadedStore(dir, [validPersonal], 'personal');
    store.rename('personal', { name: 'Mine' });
    assert.equal(store.list()[0].color, '#4caf50', 'color untouched by a name-only rename');
    store.rename('personal', { color: '#abcdef' });
    assert.equal(store.list()[0].name, 'Mine', 'name untouched by a color-only rename');
    assert.equal(store.list()[0].color, '#abcdef');
  } finally {
    removeTempDir(dir);
  }
});

test('rename of an unknown id returns null (no throw)', () => {
  const dir = makeTempDir();
  try {
    const store = loadedStore(dir, [validPersonal], 'personal');
    assert.equal(store.rename('ghost', { name: 'Nope' }), null);
  } finally {
    removeTempDir(dir);
  }
});

test('remove returns the removed container (the IPC layer needs its partition)', () => {
  const dir = makeTempDir();
  try {
    const store = loadedStore(dir, [validPersonal, validWork], 'personal');
    const removed = store.remove('work');
    assert.deepEqual(removed, {
      id: 'work',
      name: 'Work',
      color: '#2196f3',
      partition: 'persist:container:work'
    });
    assert.deepEqual(store.list().map((c) => c.id), ['personal']);
  } finally {
    removeTempDir(dir);
  }
});

test('remove of the default jar moves the flag to the first remaining jar in list order', () => {
  const dir = makeTempDir();
  try {
    const banking = { id: 'banking', name: 'Banking', color: '#f5c518', partition: 'persist:container:banking' };
    const store = loadedStore(dir, [validPersonal, validWork, banking], 'personal');
    store.remove('personal');
    assert.equal(store.getDefault().id, 'work', 'first REMAINING jar inherits the flag');
    assert.equal(readStore(dir).defaultId, 'work');
  } finally {
    removeTempDir(dir);
  }
});

test('remove of a non-default jar leaves the flag alone', () => {
  const dir = makeTempDir();
  try {
    const store = loadedStore(dir, [validPersonal, validWork], 'work');
    store.remove('personal');
    assert.equal(store.getDefault().id, 'work');
  } finally {
    removeTempDir(dir);
  }
});

test('remove of the sole jar empties the list; getDefault() is BURNER; next add re-claims', () => {
  const dir = makeTempDir();
  try {
    const store = loadedStore(dir, [validPersonal], 'personal');
    const removed = store.remove('personal');
    assert.equal(removed.id, 'personal');
    assert.deepEqual(store.list(), []);
    assert.equal(store.getDefault(), BURNER, 'Burner is the default when no jars remain');
    assert.equal(readStore(dir).defaultId, null, 'null defaultId persisted (DD2 empty state)');
    const created = store.add('Rebuilt');
    assert.equal(store.getDefault().id, created.id, 'a subsequent add auto-claims the flag');
  } finally {
    removeTempDir(dir);
  }
});

test('remove of an unknown id returns null (no throw)', () => {
  const dir = makeTempDir();
  try {
    const store = loadedStore(dir, [validPersonal], 'personal');
    assert.equal(store.remove('ghost'), null);
    assert.equal(store.list().length, 1);
  } finally {
    removeTempDir(dir);
  }
});

test('setDefault: existing id → true and persists; unknown id → false', () => {
  const dir = makeTempDir();
  try {
    const store = loadedStore(dir, [validPersonal, validWork], 'personal');
    assert.equal(store.setDefault('work'), true);
    assert.equal(store.getDefault().id, 'work');
    assert.equal(readStore(dir).defaultId, 'work');
    assert.equal(store.setDefault('ghost'), false);
    assert.equal(store.getDefault().id, 'work', 'a rejected setDefault leaves the flag alone');
  } finally {
    removeTempDir(dir);
  }
});

test('setDefault(null) while jars exist → false (DD2: Burner-as-default only when empty)', () => {
  const dir = makeTempDir();
  try {
    const store = loadedStore(dir, [validPersonal], 'personal');
    assert.equal(store.setDefault(null), false);
    assert.equal(store.getDefault().id, 'personal');
  } finally {
    removeTempDir(dir);
  }
});

test('setDefault is idempotent: current holder → true; null-while-empty → true', () => {
  const dir = makeTempDir();
  try {
    const store = loadedStore(dir, [validPersonal], 'personal');
    assert.equal(store.setDefault('personal'), true, 'setting the current holder again succeeds');
    store.remove('personal');
    assert.equal(store.setDefault(null), true, 'setDefault(null) while already empty is a no-op success');
    assert.equal(store.getDefault(), BURNER);
  } finally {
    removeTempDir(dir);
  }
});

test('list() returns the live array (consumers depend on it) with no isDefault field', () => {
  const dir = makeTempDir();
  try {
    const store = loadedStore(dir, [validPersonal], 'personal');
    assert.equal(store.list(), store.list(), 'same array identity across calls');
    assert.deepEqual(Object.keys(store.list()[0]).sort(), ['color', 'id', 'name', 'partition']);
  } finally {
    removeTempDir(dir);
  }
});
