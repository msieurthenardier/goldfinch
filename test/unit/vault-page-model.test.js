'use strict';

// Pure state-selection tests for src/shared/vault-page-model.js (M12 Flight 3,
// Leg 1 / DD9). No DOM — the page's three-state selection is verified here; live
// aria/keyboard coverage is the F5 HAT (the page is internal-session, so it is not
// axe-auditable — flight DD9).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  selectVaultView,
  compromiseCardRows,
  vaultNavEntries,
  SETTINGS_ID,
  VAULTS_ID
} = require('../../src/shared/vault-page-model.js');

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
  const empty = { mode: 'not-set-up', vaults: [], adminProvisioned: false, compromiseReport: null, severOffer: null };
  assert.deepEqual(selectVaultView(), empty);
  assert.deepEqual(selectVaultView(null), empty);
  assert.deepEqual(selectVaultView({ setUp: true, unlocked: true }), {
    mode: 'unlocked',
    vaults: [],
    adminProvisioned: false,
    compromiseReport: null,
    severOffer: null
  });
});

// ---------------------------------------------------------------------------
// M18 F3 L3 (DD7): severOffer — the same defensive-normalization + lock-state
// matrix discipline as compromiseReport above.
// ---------------------------------------------------------------------------

test('DD7 matrix: severOffer rides BOTH the locked and unlocked views (the card persists; route flips live with lock state)', () => {
  for (const unlocked of [true, false]) {
    const view = selectVaultView({
      setUp: true,
      unlocked,
      vaults: rows,
      severOffer: { route: unlocked ? 'change-master' : 'recover' }
    });
    assert.equal(view.mode, unlocked ? 'unlocked' : 'locked');
    assert.deepEqual(view.severOffer, { route: unlocked ? 'change-master' : 'recover' });
  }
});

test('not-set-up drops severOffer too (a fresh-adopted profile is by definition set up)', () => {
  const view = selectVaultView({
    setUp: false,
    unlocked: false,
    severOffer: { route: 'recover' }
  });
  assert.equal(view.severOffer, null);
});

test('severOffer is normalized: malformed/absent → null; only the two valid route literals are admitted', () => {
  const base = { setUp: true, unlocked: true, vaults: rows };
  assert.equal(selectVaultView(base).severOffer, null);
  assert.equal(selectVaultView({ ...base, severOffer: 'recover' }).severOffer, null, 'a bare string is not an object');
  assert.equal(selectVaultView({ ...base, severOffer: [] }).severOffer, null, 'an array is not admitted');
  assert.equal(selectVaultView({ ...base, severOffer: { route: 'bogus' } }).severOffer, null, 'an invalid route');
  assert.deepEqual(selectVaultView({ ...base, severOffer: { route: 'change-master' } }).severOffer, {
    route: 'change-master'
  });
  assert.deepEqual(selectVaultView({ ...base, severOffer: { route: 'recover' } }).severOffer, { route: 'recover' });
});

// ---------------------------------------------------------------------------
// M18 F2 L4 (flight DD1/DD6; R4/R8 — the lock-state matrix at the page-model
// level, per design-review M4: vault.js has no DOM harness, so DOM placement /
// copy pins are leg 5's behavior test; the MODEL half is pinned here).
// ---------------------------------------------------------------------------

test('R8 matrix: the compromise report rides BOTH the locked and unlocked views (the card renders wherever the page lands)', () => {
  const report = { admin: true, vaultIds: ['global', 'personal'] };
  for (const unlocked of [true, false]) {
    const view = selectVaultView({ setUp: true, unlocked, vaults: rows, compromiseReport: report });
    assert.equal(view.mode, unlocked ? 'unlocked' : 'locked');
    assert.deepEqual(view.compromiseReport, report, `report carried while unlocked=${unlocked}`);
  }
});

test('R4 matrix: adminProvisioned is carried in BOTH lock states (strict === true), and false when absent', () => {
  for (const unlocked of [true, false]) {
    assert.equal(selectVaultView({ setUp: true, unlocked, adminProvisioned: true }).adminProvisioned, true);
    assert.equal(selectVaultView({ setUp: true, unlocked }).adminProvisioned, false);
    assert.equal(selectVaultView({ setUp: true, unlocked, adminProvisioned: 1 }).adminProvisioned, false);
  }
});

test('not-set-up drops both fields (a rotated profile is by definition set up)', () => {
  const view = selectVaultView({
    setUp: false,
    unlocked: false,
    adminProvisioned: true,
    compromiseReport: { admin: true, vaultIds: ['x'] }
  });
  assert.equal(view.adminProvisioned, false);
  assert.equal(view.compromiseReport, null);
});

test('the compromise report is normalized: malformed → null; vaultIds keeps non-empty strings only; admin is strict boolean', () => {
  const base = { setUp: true, unlocked: true, vaults: rows };
  assert.equal(selectVaultView({ ...base, compromiseReport: 'rotated' }).compromiseReport, null);
  assert.equal(selectVaultView({ ...base, compromiseReport: ['x'] }).compromiseReport, null);
  assert.deepEqual(selectVaultView({ ...base, compromiseReport: {} }).compromiseReport, {
    admin: false,
    vaultIds: []
  });
  assert.deepEqual(
    selectVaultView({
      ...base,
      compromiseReport: { admin: 1, vaultIds: ['global', 7, null, '', 'work'] }
    }).compromiseReport,
    { admin: false, vaultIds: ['global', 'work'] }
  );
});

// ---------------------------------------------------------------------------
// compromiseCardRows — the "Everything rotated" card's revoked-keys row model,
// extracted after behavior-test run 2026-09-02-02-22-01 (checkpoint 7). Leg 4
// had reassigned the card's DOM pins to that behavior test, leaving NO unit
// layer over the report → rendered-rows mapping; these pins close that gap.
// ---------------------------------------------------------------------------

test('compromiseCardRows: rotation WITH revocations — admin row first ("Admin key — Revoked"), then one row per revoked vault by display label, `global` handled', () => {
  const vaults = [
    { vaultId: 'global', label: 'Global' },
    { vaultId: 'personal', label: 'Personal' }
  ];
  assert.deepEqual(compromiseCardRows({ admin: true, vaultIds: ['global', 'personal'] }, vaults), [
    { label: 'Admin key', hint: '— Revoked' },
    { label: 'Global', hint: '— Revoked' },
    { label: 'Personal', hint: '— Revoked' }
  ]);
  // A revoked id with no matching vault row (e.g. an unregistered on-disk vault
  // swept by the registry∪disk union) falls back to the raw id.
  assert.deepEqual(compromiseCardRows({ admin: false, vaultIds: ['orphan'] }, vaults), [
    { label: 'orphan', hint: '— Revoked' }
  ]);
});

test('compromiseCardRows: rotation with NOTHING to revoke → zero rows (the card still renders — an empty list is the CORRECT state after a repeat rotation)', () => {
  const vaults = [{ vaultId: 'global', label: 'Global' }];
  assert.deepEqual(compromiseCardRows({ admin: false, vaultIds: [] }, vaults), []);
  // Defensive halves: a malformed report or missing vault rows never throw.
  assert.deepEqual(compromiseCardRows(null, vaults), []);
  assert.deepEqual(compromiseCardRows({ admin: 1, vaultIds: 'global' }, vaults), []);
  assert.deepEqual(compromiseCardRows({ admin: true, vaultIds: ['global'] }, undefined), [
    { label: 'Admin key', hint: '— Revoked' },
    { label: 'global', hint: '— Revoked' }
  ]);
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
  assert.deepEqual(
    entries.map((e) => [e.id, e.kind]),
    [
      [SETTINGS_ID, 'settings'],
      [VAULTS_ID, 'group']
    ]
  );
  assert.equal(entries[1].label, 'Vaults');
  // Each vault is an indented child of the Vaults group, in order.
  assert.deepEqual(
    childrenOf(entries).map((e) => [e.id, e.kind]),
    [
      ['global', 'global'],
      ['personal', 'jar'],
      ['work', 'jar']
    ]
  );
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
  assert.deepEqual(
    vaultNavEntries([], jars).map((e) => e.id),
    [SETTINGS_ID, VAULTS_ID]
  );
  assert.deepEqual(childrenOf(vaultNavEntries([], jars)), []);
  assert.deepEqual(
    vaultNavEntries(undefined, undefined).map((e) => e.id),
    [SETTINGS_ID, VAULTS_ID]
  );
  assert.deepEqual(childrenOf(vaultNavEntries(undefined, undefined)), []);
  // a vault row missing its id is dropped from the group's children
  const entries = vaultNavEntries([{ label: 'orphan' }, { vaultId: 'work', label: 'Work' }], jars);
  assert.deepEqual(
    childrenOf(entries).map((e) => e.id),
    ['work']
  );
});
