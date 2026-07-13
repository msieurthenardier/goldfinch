'use strict';

// Unit tests for src/shared/jar-panel-model.js (M08 Flight 2, Leg 1 / flight DD1).
//
// Pure, dependency-free ES module — exercised via require(esm) below
// (destructuring the module namespace, same as jar-data-classes.test.js). The
// module itself imports nothing (stricter than jar-page-model.js, which
// imports burner.js); this test is the one place JAR_DATA_CLASSES is imported,
// to assert panelForDataClass's totality over every CURRENT data-class id
// without coupling the shared module to jar-data-classes.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { JAR_PANELS, panelForDataClass } = require('../../src/shared/jar-panel-model');
const { JAR_DATA_CLASSES } = require('../../src/shared/jar-data-classes');

// ---------------------------------------------------------------------------
// JAR_PANELS shape / order / frozen-ness
// ---------------------------------------------------------------------------
test('JAR_PANELS is frozen and every descriptor is frozen', () => {
  assert.ok(Object.isFrozen(JAR_PANELS));
  for (const p of JAR_PANELS) assert.ok(Object.isFrozen(p), `panel "${p.id}" should be frozen`);
});

test('JAR_PANELS ids are exactly [history, cookies, site-data] in order', () => {
  assert.deepEqual(
    JAR_PANELS.map((p) => p.id),
    ['history', 'cookies', 'site-data']
  );
});

test('JAR_PANELS labels match the flight-spec copy', () => {
  assert.deepEqual(
    JAR_PANELS.map((p) => p.label),
    ['History', 'Cookies', 'Other site data']
  );
});

// ---------------------------------------------------------------------------
// panelForDataClass — totality over the real JAR_DATA_CLASSES ids
// ---------------------------------------------------------------------------
test('panelForDataClass maps every current JAR_DATA_CLASSES id to a non-null panel id', () => {
  for (const c of JAR_DATA_CLASSES) {
    const panelId = panelForDataClass(c.id);
    assert.notEqual(panelId, null, `data class "${c.id}" should map to a panel`);
    assert.ok(
      JAR_PANELS.some((p) => p.id === panelId),
      `panelForDataClass("${c.id}") returned "${panelId}", which is not a real JAR_PANELS id`
    );
  }
});

test('panelForDataClass: cookies -> cookies', () => {
  assert.equal(panelForDataClass('cookies'), 'cookies');
});

test('panelForDataClass: storage -> site-data', () => {
  assert.equal(panelForDataClass('storage'), 'site-data');
});

test('panelForDataClass: cache -> site-data', () => {
  assert.equal(panelForDataClass('cache'), 'site-data');
});

test('panelForDataClass: history -> history (anticipatory, Flight 3 has no JAR_DATA_CLASSES entry yet)', () => {
  assert.equal(panelForDataClass('history'), 'history');
});

// ---------------------------------------------------------------------------
// Fail-closed for unknown ids
// ---------------------------------------------------------------------------
test('panelForDataClass: unknown id returns null (fail-closed)', () => {
  assert.equal(panelForDataClass('bogus'), null);
});

test('panelForDataClass: null/undefined/empty string return null (fail-closed)', () => {
  assert.equal(panelForDataClass(null), null);
  assert.equal(panelForDataClass(undefined), null);
  assert.equal(panelForDataClass(''), null);
});
