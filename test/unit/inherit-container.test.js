'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { inheritContainerDecision } = require('../../src/shared/inherit-container');

// ---------------------------------------------------------------------------
// Truth table (M06 F2 HAT Leg 4 / D3 — link/image/selection-search open
// inherits the SOURCE tab's jar)
// ---------------------------------------------------------------------------

test('persistent-jar source (not burner, not internal) → inherit that container (same reference)', () => {
  const persistent = { id: 'work', burner: undefined };
  const result = inheritContainerDecision(persistent, false);
  assert.deepEqual(result, { container: persistent });
  assert.equal(result.container, persistent); // same reference, not a copy
});

test('burner-flagged source → freshBurner sentinel, no container field', () => {
  const burnerContainer = { id: 'burner-123', burner: true };
  const result = inheritContainerDecision(burnerContainer, false);
  assert.deepEqual(result, { freshBurner: true });
  assert.equal(result.container, undefined);
});

test('internal source (Settings/Downloads) → {} regardless of container shape', () => {
  assert.deepEqual(inheritContainerDecision({ id: 'personal' }, true), {});
  assert.deepEqual(inheritContainerDecision({ id: 'burner-1', burner: true }, true), {});
});

test('missing/null source container → {} (no inheritance)', () => {
  assert.deepEqual(inheritContainerDecision(null, false), {});
  assert.deepEqual(inheritContainerDecision(undefined, false), {});
});

test('at most one of container/freshBurner is ever set (never both)', () => {
  const cases = [
    inheritContainerDecision({ id: 'a' }, false),
    inheritContainerDecision({ id: 'b', burner: true }, false),
    inheritContainerDecision({ id: 'c' }, true),
    inheritContainerDecision(null, false)
  ];
  for (const r of cases) {
    assert.ok(!(r.container && r.freshBurner), 'container and freshBurner must not both be set');
  }
});

test('never throws on malformed input', () => {
  assert.doesNotThrow(() => {
    assert.deepEqual(inheritContainerDecision(/** @type {any} */ ('not-an-object'), false), {
      container: 'not-an-object'
    });
  });
  assert.doesNotThrow(() => {
    assert.deepEqual(inheritContainerDecision(/** @type {any} */ (undefined), /** @type {any} */ (undefined)), {});
  });
});
