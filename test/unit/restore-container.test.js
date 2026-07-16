'use strict';

// Unit tests for src/shared/restore-container.js (M09 Flight 9, Leg 3 — AC5b).
//
// The privacy-adjacent DD4 deleted-jar-drop rule, pinned BOTH directions as a real
// unit assertion (not a source-scan): a known jarId resolves to its container; an
// UNKNOWN jarId resolves to null — NOT a default. This is the same rigor leg 2 applied
// to resolvePersistJar. The renderer's boot loop `continue`s (drops the tab) on null,
// so a deleted jar's saved tab is never home-substituted.
//
// Pure module, required directly (the tab-drag-zone.test.js / tab-order.test.js house
// pattern — no DOM, no Electron).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveRestoreContainer } = require('../../src/shared/restore-container');

// A live jars snapshot, the shape the renderer's `containers` array carries.
const CONTAINERS = [
  { id: 'jar-work', name: 'Work', partition: 'persist:jar-work' },
  { id: 'jar-personal', name: 'Personal', partition: 'persist:jar-personal' },
];

// ---------------------------------------------------------------------------
// Reading 1 — a known jarId resolves to the matching container (by id).
// ---------------------------------------------------------------------------

test('known jarId → the matching container', () => {
  assert.equal(resolveRestoreContainer('jar-work', CONTAINERS), CONTAINERS[0]);
  assert.equal(resolveRestoreContainer('jar-personal', CONTAINERS), CONTAINERS[1]);
});

// ---------------------------------------------------------------------------
// Reading 2 — an unknown jarId (jar deleted between quit and relaunch) resolves
// to null, NOT a default/fallback container. This is the DROP signal.
// ---------------------------------------------------------------------------

test('unknown jarId → null (NOT a default) — the deleted-jar drop', () => {
  assert.equal(resolveRestoreContainer('jar-deleted', CONTAINERS), null);
  // A burner-style id (never a registered jar) also resolves to null.
  assert.equal(resolveRestoreContainer('burner:3', CONTAINERS), null);
});

// ---------------------------------------------------------------------------
// Empty containers → null for any jarId (the purest drop case).
// ---------------------------------------------------------------------------

test('empty containers → null for any jarId', () => {
  assert.equal(resolveRestoreContainer('jar-work', []), null);
});
