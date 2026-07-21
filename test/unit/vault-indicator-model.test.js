'use strict';

// Unit tests for the pure vault ("lock") indicator model (M12 Flight 2 Leg 2
// chrome-unlock, DD10). Maps the pushed `{ setUp, unlocked }` lock-state snapshot
// to the toolbar indicator's render model: hidden / locked / unlocked.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildVaultIndicatorModel } = require('../../src/shared/vault-indicator-model.js');

test('not set up → hidden (regardless of the unlocked flag)', () => {
  assert.deepEqual(buildVaultIndicatorModel({ setUp: false, unlocked: false }), {
    visible: false, state: 'locked',
  });
  // A nonsensical unlocked-while-not-set-up snapshot still hides (visibility gates on setUp).
  assert.deepEqual(buildVaultIndicatorModel({ setUp: false, unlocked: true }), {
    visible: false, state: 'locked',
  });
});

test('set up + locked → visible, locked', () => {
  assert.deepEqual(buildVaultIndicatorModel({ setUp: true, unlocked: false }), {
    visible: true, state: 'locked',
  });
});

test('set up + unlocked → visible, unlocked', () => {
  assert.deepEqual(buildVaultIndicatorModel({ setUp: true, unlocked: true }), {
    visible: true, state: 'unlocked',
  });
});

test('never throws on malformed / partial / missing input (defensive coercion)', () => {
  assert.deepEqual(buildVaultIndicatorModel(null), { visible: false, state: 'locked' });
  assert.deepEqual(buildVaultIndicatorModel(undefined), { visible: false, state: 'locked' });
  assert.deepEqual(buildVaultIndicatorModel({}), { visible: false, state: 'locked' });
  // Truthy-but-non-boolean fields coerce.
  assert.deepEqual(buildVaultIndicatorModel({ setUp: 1, unlocked: 'yes' }), {
    visible: true, state: 'unlocked',
  });
});
