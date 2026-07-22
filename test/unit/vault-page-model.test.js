'use strict';

// Pure state-selection tests for src/shared/vault-page-model.js (M12 Flight 3,
// Leg 1 / DD9). No DOM — the page's three-state selection is verified here; live
// aria/keyboard coverage is the F5 HAT (the page is internal-session, so it is not
// axe-auditable — flight DD9).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { selectVaultView, vaultNavEntries, SETTINGS_ID, VAULTS_ID } = require('../../src/shared/vault-page-model.js');

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

// ── vaultNavEntries: the two-level master-detail left-nav entry model (M12 F5 HAT batch) ──

const jars = [
  { id: 'personal', name: 'Personal', color: '#4caf50' },
  { id: 'work', name: 'Work', color: '#2196f3' }
];

// Convenience: the Vaults group's children (the per-vault entries).
const childrenOf = (entries) => entries.find((e) => e.kind === 'group').children;

test('nav entries = a Settings entry then a Vaults group whose children are the vaults, in order', () => {
  const entries = vaultNavEntries(
    [
      { vaultId: 'global', label: 'Global' },
      { vaultId: 'personal', label: 'Personal' },
      { vaultId: 'work', label: 'Work' }
    ],
    jars
  );
  // Two top-level entries: Settings, then the Vaults group.
  assert.deepEqual(entries.map((e) => [e.id, e.kind]), [
    [SETTINGS_ID, 'settings'],
    [VAULTS_ID, 'group']
  ]);
  assert.equal(entries[1].label, 'Vaults');
  // Each vault is an indented child of the Vaults group, in order.
  assert.deepEqual(childrenOf(entries).map((e) => [e.id, e.kind]), [
    ['global', 'global'],
    ['personal', 'jar'],
    ['work', 'jar']
  ]);
});

test('the global vault (not a persistent jar) is kind "global"; jars are kind "jar" with their color', () => {
  const entries = vaultNavEntries(
    [
      { vaultId: 'global', label: 'Global', count: 2 },
      { vaultId: 'personal', label: 'Personal', count: 5 }
    ],
    jars
  );
  const children = childrenOf(entries);
  const global = children.find((e) => e.id === 'global');
  const personal = children.find((e) => e.id === 'personal');
  assert.equal(global.kind, 'global');
  assert.equal(global.color, undefined); // globe, no dot
  assert.equal(global.count, 2);
  assert.equal(personal.kind, 'jar');
  assert.equal(personal.color, '#4caf50');
  assert.equal(personal.count, 5);
});

test('a jar with no color joins to null (the controller applies the fallback)', () => {
  const entries = vaultNavEntries(
    [{ vaultId: 'work', label: 'Work' }],
    [{ id: 'work', name: 'Work' }] // no color
  );
  const children = childrenOf(entries);
  assert.equal(children[0].kind, 'jar');
  assert.equal(children[0].color, null);
});

test('empty vaults → Settings + an empty Vaults group; malformed inputs degrade safely', () => {
  assert.deepEqual(vaultNavEntries([], jars).map((e) => e.id), [SETTINGS_ID, VAULTS_ID]);
  assert.deepEqual(childrenOf(vaultNavEntries([], jars)), []);
  assert.deepEqual(vaultNavEntries(undefined, undefined).map((e) => e.id), [SETTINGS_ID, VAULTS_ID]);
  assert.deepEqual(childrenOf(vaultNavEntries(undefined, undefined)), []);
  // a vault row missing its id is dropped from the group's children
  const entries = vaultNavEntries([{ label: 'orphan' }, { vaultId: 'work', label: 'Work' }], jars);
  assert.deepEqual(childrenOf(entries).map((e) => e.id), ['work']);
});
