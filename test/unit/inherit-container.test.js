'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { inheritContainerDecision, inheritFromPartition } = require('../../src/shared/inherit-container');

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

// ---------------------------------------------------------------------------
// inheritFromPartition truth table (DD7, M06 F3 Leg 4 — popup inheritance:
// resolves the opener's forwarded partition STRING, not a Tab/container object)
// ---------------------------------------------------------------------------

const CONTAINERS = [
  { id: 'default', name: 'Default', color: '#9aa0ac', partition: 'persist:goldfinch' },
  { id: 'work', name: 'Work', color: '#2196f3', partition: 'persist:container:work' }
];

test('persistent partition matching a container -> { container: <that reference> }', () => {
  const result = inheritFromPartition('persist:container:work', CONTAINERS);
  assert.deepEqual(result, { container: CONTAINERS[1] });
  assert.equal(result.container, CONTAINERS[1]); // same reference, not a copy
});

test('burner partition (COLON separator, not the hyphen used in burner ids) -> freshBurner sentinel', () => {
  assert.deepEqual(inheritFromPartition('burner:123456789', CONTAINERS), { freshBurner: true });
});

test('popup from a burner tab never inherits the opener\'s own burner container (burner containers are never in `containers` anyway, pinned regardless)', () => {
  const withBurnerLookalike = [...CONTAINERS, { id: 'burner-123456789', partition: 'burner:123456789', burner: true }];
  const result = inheritFromPartition('burner:123456789', withBurnerLookalike);
  assert.deepEqual(result, { freshBurner: true });
  assert.equal(result.container, undefined);
});

test('internal partition (bare `goldfinch-internal`, no persist:/burner: prefix) -> {} default routing', () => {
  assert.deepEqual(inheritFromPartition('goldfinch-internal', CONTAINERS), {});
});

test('null/undefined partition -> {} default routing (opener closed before the popup IPC lands)', () => {
  assert.deepEqual(inheritFromPartition(null, CONTAINERS), {});
  assert.deepEqual(inheritFromPartition(undefined, CONTAINERS), {});
});

test('persistent-looking partition with NO matching container -> {} default (privacy-conservative, never guesses)', () => {
  assert.deepEqual(inheritFromPartition('persist:container:deleted-jar', CONTAINERS), {});
});

test('unrecognized partition format -> {} default, never throws', () => {
  assert.doesNotThrow(() => {
    assert.deepEqual(inheritFromPartition('something-else', CONTAINERS), {});
  });
});

test('missing/empty containers array -> still resolves burner/default correctly, never throws', () => {
  assert.doesNotThrow(() => {
    assert.deepEqual(inheritFromPartition('burner:1', /** @type {any} */ (undefined)), { freshBurner: true });
    assert.deepEqual(inheritFromPartition('persist:container:work', []), {});
    assert.deepEqual(inheritFromPartition('persist:container:work', /** @type {any} */ (null)), {});
  });
});
