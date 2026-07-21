'use strict';

// Integration tests for the human fill orchestration (Mission 12, Flight 2, Leg 3
// pick-and-fill, DD5/DD6/DD9) — createVaultHuman's reachableItems + fillHuman,
// driven against a REAL vault store (faithful credential resolution under the MRK)
// with fake webContents/registry/fill-delegate handles. Verifies:
//   - the happy path calls fillDelegate with the RESOLVED credential and returns
//     no password;
//   - the re-check ORDER: locked → ineligible(burner, BEFORE scope) → out-of-scope
//     (cross-vault) → origin-mismatch — each refusal does NOT call fillDelegate;
//   - a 'global' vaultId can NOT fill a burner tab (the DD9 linchpin);
//   - reachableItems is []-safe for burner / closed tabs and metadata-only.
//
// Electron-free (the vault-store.test.js FAST-scrypt + temp-dir pattern).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');
const { createVaultHuman } = require('../../src/main/vault/vault-human');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';
const JARS = [
  { id: 'work', partition: 'persist:container:work' },
  { id: 'personal', partition: 'persist:container:personal' },
];
const A = 'https://a.example';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-human-')); }
function rm(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

// Build a harness: a real, set-up, unlocked store + saved credentials + a
// createVaultHuman wired to fakes. wcId map:
//   10 → work-jar tab @ A         20 → burner tab @ A
//   11 → work-jar tab @ evil      30 → closed tab (fromId null)
async function makeHarness(dir) {
  const store = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => JARS });
  await store.setup({ masterPassword: MASTER });
  const workItem = store.saveItem('work', { type: 'login', title: 'Work', username: 'w@a', password: 'work-pass', origin: A });
  const globalItem = store.saveItem('global', { type: 'login', title: 'Global', username: 'g@a', password: 'global-pass', origin: A });

  const urls = { 10: A + '/login', 11: 'https://evil.example/login', 20: A + '/login' };
  const entries = new Map([
    [10, { partition: 'persist:container:work', trusted: false }],
    [11, { partition: 'persist:container:work', trusted: false }],
    [20, { partition: 'burner:1', trusted: false }],
  ]);

  const fillCalls = [];
  const human = createVaultHuman({
    getVaultStore: () => store,
    fromId: (id) => (urls[id] != null ? { getURL: () => urls[id] } : null),
    getTabEntry: (id) => entries.get(id),
    listJars: () => JARS,
    fillDelegate: (arg) => fillCalls.push(arg),
  });
  return { store, human, fillCalls, workItem, globalItem };
}

test('happy path (jar credential): fillDelegate gets the resolved credential; no password returned', async () => {
  const dir = tmpDir();
  try {
    const { human, fillCalls, workItem } = await makeHarness(dir);
    const res = human.fillHuman({ wcId: 10, vaultId: 'work', itemId: workItem.id });

    assert.deepEqual(res, { filled: true });
    assert.equal(fillCalls.length, 1);
    assert.deepEqual(fillCalls[0], { wcId: 10, credential: { username: 'w@a', password: 'work-pass' } });
    // The RETURN carries no password (grep + key assertion).
    assert.ok(!('credential' in res) && !('password' in res));
    assert.ok(!JSON.stringify(res).includes('work-pass'), 'no password value in the fill result');
  } finally { rm(dir); }
});

test('happy path (global credential on a jar tab): global is in scope, fills', async () => {
  const dir = tmpDir();
  try {
    const { human, fillCalls, globalItem } = await makeHarness(dir);
    const res = human.fillHuman({ wcId: 10, vaultId: 'global', itemId: globalItem.id });
    assert.deepEqual(res, { filled: true });
    assert.deepEqual(fillCalls[0].credential, { username: 'g@a', password: 'global-pass' });
  } finally { rm(dir); }
});

test('BURNER tab is ineligible even with vaultId "global" — the DD9 linchpin (before the scope assert)', async () => {
  const dir = tmpDir();
  try {
    const { human, fillCalls, globalItem } = await makeHarness(dir);
    const res = human.fillHuman({ wcId: 20, vaultId: 'global', itemId: globalItem.id });
    assert.deepEqual(res, { filled: false, reason: 'ineligible' });
    assert.equal(fillCalls.length, 0, 'fillDelegate never called for a burner tab');
  } finally { rm(dir); }
});

test('cross-vault vaultId (sibling jar) is refused out-of-scope; fillDelegate not called', async () => {
  const dir = tmpDir();
  try {
    const { human, fillCalls, workItem } = await makeHarness(dir);
    // wcId 10 is a WORK tab; a 'personal' vaultId is neither 'global' nor the tab's jar.
    const res = human.fillHuman({ wcId: 10, vaultId: 'personal', itemId: workItem.id });
    assert.deepEqual(res, { filled: false, reason: 'out-of-scope' });
    assert.equal(fillCalls.length, 0);
  } finally { rm(dir); }
});

test('origin-mismatch (tab navigated away) is refused; fillDelegate not called', async () => {
  const dir = tmpDir();
  try {
    const { human, fillCalls, workItem } = await makeHarness(dir);
    // wcId 11 is a work tab whose live URL is evil.example — the work item's origin is A.
    const res = human.fillHuman({ wcId: 11, vaultId: 'work', itemId: workItem.id });
    assert.deepEqual(res, { filled: false, reason: 'origin-mismatch' });
    assert.equal(fillCalls.length, 0);
  } finally { rm(dir); }
});

test('locked (vault locked between pick and fill) → reason:locked; fillDelegate not called', async () => {
  const dir = tmpDir();
  try {
    const { store, human, fillCalls, workItem } = await makeHarness(dir);
    store.lockNow();
    const res = human.fillHuman({ wcId: 10, vaultId: 'work', itemId: workItem.id });
    assert.deepEqual(res, { filled: false, reason: 'locked' });
    assert.equal(fillCalls.length, 0);
  } finally { rm(dir); }
});

test('unknown itemId (e.g. stale pick) → origin-mismatch; fillDelegate not called', async () => {
  const dir = tmpDir();
  try {
    const { human, fillCalls } = await makeHarness(dir);
    const res = human.fillHuman({ wcId: 10, vaultId: 'work', itemId: 'does-not-exist' });
    assert.deepEqual(res, { filled: false, reason: 'origin-mismatch' });
    assert.equal(fillCalls.length, 0);
  } finally { rm(dir); }
});

test('reachableItems: origin-filtered metadata for a jar tab (global + jar, no password)', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const rows = human.reachableItems(10);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.vaultId).sort(), ['global', 'work']);
    assert.ok(!JSON.stringify(rows).includes('pass'), 'no password value in the picker model');
  } finally { rm(dir); }
});

test('reachableItems: [] for a burner tab and [] for a closed (fromId null) tab', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    assert.deepEqual(human.reachableItems(20), [], 'burner → []');
    assert.deepEqual(human.reachableItems(30), [], 'closed tab (fromId null) → []');
  } finally { rm(dir); }
});

test('reachableItems: [] when the store is locked', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    store.lockNow();
    assert.deepEqual(human.reachableItems(10), []);
  } finally { rm(dir); }
});
