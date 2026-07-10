'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { BURNER } = require('../../src/shared/burner');
const { isSafeColor } = require('../../src/shared/safe-color');
const { buildJarPageModel, PALETTE } = require('../../src/shared/jar-page-model');

const personal = { id: 'personal', name: 'Personal', color: '#4caf50' };
const work = { id: 'work', name: 'Work', color: '#2196f3' };

// ---------------------------------------------------------------------------
// Truth table (leg spec AC: flagged jar marked; Burner-default when null; empty
// registry → Burner-only list; input array not mutated)
// ---------------------------------------------------------------------------

test('the flagged jar is marked isDefault; Burner is not', () => {
  const rows = buildJarPageModel([personal, work], 'work');
  assert.equal(rows.length, 3);
  assert.equal(rows[0].id, 'personal');
  assert.equal(rows[0].isDefault, false);
  assert.equal(rows[1].id, 'work');
  assert.equal(rows[1].isDefault, true);
  assert.equal(rows[2].id, BURNER.id);
  assert.equal(rows[2].isDefault, false);
  assert.equal(rows[2].isBurner, true);
});

test('defaultId null marks the Burner row as default and no persistent jar', () => {
  const rows = buildJarPageModel([personal, work], null);
  assert.equal(rows.find((r) => r.id === 'personal').isDefault, false);
  assert.equal(rows.find((r) => r.id === 'work').isDefault, false);
  const burnerRow = rows.find((r) => r.isBurner);
  assert.equal(burnerRow.isDefault, true);
});

test('defaultId undefined (boot snapshot pending) also marks Burner default', () => {
  const rows = buildJarPageModel([personal], undefined);
  assert.equal(rows.find((r) => r.isBurner).isDefault, true);
});

test('empty registry yields a Burner-only list, marked default', () => {
  const rows = buildJarPageModel([], null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].isBurner, true);
  assert.equal(rows[0].isDefault, true);
  assert.equal(rows[0].id, BURNER.id);
  assert.equal(rows[0].name, BURNER.name);
  assert.equal(rows[0].color, BURNER.color);
});

test('undefined containers array behaves like empty (Burner-only)', () => {
  const rows = buildJarPageModel(/** @type {any} */ (undefined), null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].isBurner, true);
});

test('the input containers array is not mutated', () => {
  const containers = [personal, work];
  const snapshot = JSON.parse(JSON.stringify(containers));
  buildJarPageModel(containers, 'personal');
  assert.deepEqual(containers, snapshot);
  assert.equal(containers.length, 2); // no Burner row pushed onto the input
});

test('persistent jars keep containers order; Burner always trails', () => {
  const rows = buildJarPageModel([work, personal], 'personal');
  assert.deepEqual(rows.map((r) => r.id), ['work', 'personal', BURNER.id]);
});

test('malformed entries (null, non-string id) are skipped, never thrown on', () => {
  assert.doesNotThrow(() => {
    const rows = buildJarPageModel(/** @type {any} */ ([null, { id: 42 }, personal]), 'personal');
    assert.deepEqual(rows.map((r) => r.id), ['personal', BURNER.id]);
  });
});

test('a jar with a non-string color falls back to an empty string (caller applies isSafeColor)', () => {
  const rows = buildJarPageModel([{ id: 'x', name: 'X', color: 42 }], null);
  assert.equal(rows[0].color, '');
});

test('a jar missing name falls back to its id', () => {
  const rows = buildJarPageModel([{ id: 'x', color: '#fff' }], null);
  assert.equal(rows[0].name, 'x');
});

// ---------------------------------------------------------------------------
// Verification Steps node -e snippet, pinned as a test
// ---------------------------------------------------------------------------
test('verification snippet: buildJarPageModel([], null) is a burner-only default list', () => {
  const rows = buildJarPageModel([], null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].isDefault, true);
});

// ---------------------------------------------------------------------------
// PALETTE (leg spec AC: 10-14 hex entries, distinct, first a sensible default,
// every entry isSafeColor-clean, array frozen)
// ---------------------------------------------------------------------------

test('PALETTE has between 10 and 14 entries', () => {
  assert.ok(PALETTE.length >= 10 && PALETTE.length <= 14, `expected 10-14 entries, got ${PALETTE.length}`);
});

test('every PALETTE entry passes isSafeColor', () => {
  for (const color of PALETTE) {
    assert.ok(isSafeColor(color), `${color} should pass isSafeColor`);
  }
});

test('PALETTE entries are unique', () => {
  const unique = new Set(PALETTE);
  assert.equal(unique.size, PALETTE.length);
});

test('PALETTE is frozen', () => {
  assert.ok(Object.isFrozen(PALETTE));
  assert.throws(() => {
    // @ts-expect-error intentional mutation attempt against a frozen array
    PALETTE.push('#000000');
  });
});

test('PALETTE[0] is a sensible default-new-jar color (defined, isSafeColor-clean)', () => {
  assert.equal(typeof PALETTE[0], 'string');
  assert.ok(isSafeColor(PALETTE[0]));
});
