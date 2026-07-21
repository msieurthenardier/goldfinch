'use strict';

// Pure state-selection tests for src/shared/vault-page-model.js (M12 Flight 3,
// Leg 1 / DD9). No DOM — the page's three-state selection is verified here; live
// aria/keyboard coverage is the F5 HAT (the page is internal-session, so it is not
// axe-auditable — flight DD9).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { selectVaultView } = require('../../src/shared/vault-page-model.js');

const rows = [
  { vaultId: 'global', label: 'Global' },
  { vaultId: 'personal', label: 'Personal' }
];

test('not set up → mode not-set-up, no vault list', () => {
  const view = selectVaultView({ setUp: false, unlocked: false, vaults: rows });
  assert.equal(view.mode, 'not-set-up');
  assert.deepEqual(view.vaults, []);
});

test('set up but locked → mode locked, labels shown', () => {
  const view = selectVaultView({ setUp: true, unlocked: false, vaults: rows });
  assert.equal(view.mode, 'locked');
  assert.deepEqual(view.vaults, rows);
});

test('set up and unlocked → mode unlocked, labels shown', () => {
  const view = selectVaultView({ setUp: true, unlocked: true, vaults: rows });
  assert.equal(view.mode, 'unlocked');
  assert.deepEqual(view.vaults, rows);
});

test('flags are strict === true (truthy-but-not-true does not unlock)', () => {
  assert.equal(selectVaultView({ setUp: 1, unlocked: 1, vaults: rows }).mode, 'not-set-up');
  assert.equal(selectVaultView({ setUp: true, unlocked: 1, vaults: rows }).mode, 'locked');
});

test('malformed / absent payload degrades to not-set-up with no vaults', () => {
  assert.deepEqual(selectVaultView(), { mode: 'not-set-up', vaults: [] });
  assert.deepEqual(selectVaultView(null), { mode: 'not-set-up', vaults: [] });
  assert.deepEqual(selectVaultView({ setUp: true, unlocked: true }), { mode: 'unlocked', vaults: [] });
});

test('vault rows are normalized to { vaultId, label }; a missing label falls back to the id', () => {
  const view = selectVaultView({
    setUp: true,
    unlocked: true,
    vaults: [
      { vaultId: 'global', label: 'Global' },
      { vaultId: 'work' }, // no label
      { label: 'orphan' }, // no vaultId → dropped
      null // dropped
    ]
  });
  assert.deepEqual(view.vaults, [
    { vaultId: 'global', label: 'Global' },
    { vaultId: 'work', label: 'work' }
  ]);
});
