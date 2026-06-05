'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

require('../helpers/electron-stub');
const { validateContainers, isSafeColor } = require('../../src/main/jars');

// Helpers
const validDefault = { id: 'default', name: 'Default', color: '#9aa0ac', partition: 'persist:goldfinch' };
const validPersonal = { id: 'personal', name: 'Personal', color: '#4caf50', partition: 'persist:container:personal' };
const validWork = { id: 'work', name: 'Work', color: '#2196f3', partition: 'persist:container:work' };

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
// Non-default entry with partition 'persist:goldfinch' dropped
// ---------------------------------------------------------------------------
test('non-default entry with partition persist:goldfinch is dropped', () => {
  const input = [validDefault, { id: 'hijack', name: 'Hijack', color: '#ff0000', partition: 'persist:goldfinch' }];
  const result = validateContainers(input);
  assert.ok(!result.some((c) => c.id === 'hijack'));
  // The real default should still be present
  assert.ok(result.some((c) => c.id === 'default'));
});

// ---------------------------------------------------------------------------
// Missing default gets the cloned floor
// ---------------------------------------------------------------------------
test('when no valid default entry, floor default is prepended', () => {
  const input = [validPersonal, validWork];
  const result = validateContainers(input);
  assert.ok(
    result.some((c) => c.id === 'default'),
    'floor default must be present'
  );
  // Floor entry should be first
  assert.equal(result[0].id, 'default');
  assert.equal(result[0].partition, 'persist:goldfinch');
});

test('floor default is a clone (not the same reference as DEFAULTS entry)', () => {
  // We cannot directly access DEFAULTS, but we can verify properties are correct
  // and that modifying the result does not produce errors (basic cloned-object check)
  const result = validateContainers([validPersonal]);
  const def = result.find((c) => c.id === 'default');
  assert.ok(def);
  // Mutating the clone should not throw
  def.name = 'MutatedName';
  // Calling again should produce a fresh clone
  const result2 = validateContainers([validPersonal]);
  const def2 = result2.find((c) => c.id === 'default');
  assert.equal(def2.name, 'Default', 'floor default should always be fresh from DEFAULTS');
});

// ---------------------------------------------------------------------------
// Non-array input → empty array (load() will keep DEFAULTS)
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
