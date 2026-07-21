'use strict';

// Unit tests for VaultStore.reachableLoginItems (Mission 12, Flight 2, Leg 3
// pick-and-fill, DD5/DD6) — the net-new, origin-filtered, metadata-only human
// picker read. Verifies: global + that-jar merge, exact-origin filter, source
// tagging, METADATA ONLY (never a password / TOTP secret), and `[]`-safety (never
// throws) on locked / burner-null / uncreated targets.
//
// Electron-free (the vault-store.test.js mkdtempSync + FAST scrypt pattern).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';
const JARS = [{ id: 'work' }, { id: 'personal' }];
const A = 'https://a.example';
const B = 'https://b.example';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-reach-')); }
function rm(dir) { fs.rmSync(dir, { recursive: true, force: true }); }
function makeStore(dir, overrides = {}) {
  return vs.load(dir, {
    scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => JARS, ...overrides,
  });
}
function login(over = {}) {
  return { type: 'login', title: 'Example', username: 'u@a', password: 'hunter2', origin: A, ...over };
}

test('merges global + that jar only, exact-origin filtered, source-tagged, metadata-only', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    // global: one A-origin login (match) + one B-origin login (filtered out)
    const g = store.saveItem('global', login({ username: 'g@a', origin: A }));
    store.saveItem('global', login({ username: 'g@b', origin: B }));
    // work: one A-origin login (match) with a TOTP
    const w = store.saveItem('work', login({ username: 'w@a', origin: A, totp: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' }));
    // personal (a SIBLING jar): an A-origin login that must NEVER appear for 'work'
    store.saveItem('personal', login({ username: 'sibling@a', origin: A }));

    const rows = store.reachableLoginItems('work', A);

    // exactly the global + work A-origin matches — the sibling 'personal' is absent.
    assert.equal(rows.length, 2);
    const byUser = Object.fromEntries(rows.map((r) => [r.username, r]));
    assert.ok(byUser['g@a'] && byUser['w@a'], 'global + work A-origin rows present');
    assert.ok(!byUser['g@b'], 'B-origin global row filtered out');
    assert.ok(!byUser['sibling@a'], "a sibling jar's credential never appears");

    // source tagging
    assert.equal(byUser['g@a'].vaultId, 'global');
    assert.equal(byUser['w@a'].vaultId, 'work');
    assert.equal(byUser['g@a'].id, g.id);
    assert.equal(byUser['w@a'].id, w.id);

    // hasTotp flag surfaced (metadata), the secret NOT
    assert.equal(byUser['w@a'].hasTotp, true);
    assert.equal(byUser['g@a'].hasTotp, false);

    // METADATA ONLY — exactly these keys, never a password / totp secret.
    for (const r of rows) {
      assert.deepEqual(
        Object.keys(r).sort(),
        ['hasTotp', 'id', 'origin', 'title', 'username', 'vaultId'],
      );
      assert.ok(!('password' in r), 'no password key');
      assert.ok(!('totp' in r), 'no totp secret key');
    }
    // Belt-and-suspenders: the stored password never appears anywhere in the payload.
    assert.ok(!JSON.stringify(rows).includes('hunter2'), 'no password value in the model');
  } finally { rm(dir); }
});

test('returns [] (never throws) when the store is LOCKED', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    store.saveItem('global', login({ origin: A }));
    store.lockNow();
    assert.equal(store.isUnlocked(), false);
    assert.deepEqual(store.reachableLoginItems('work', A), []);
  } finally { rm(dir); }
});

test('returns [] for a BURNER / non-persistent tab (null jarId) — global not reached', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    store.saveItem('global', login({ origin: A }));
    // A burner tab carries no persistent jar → the caller passes null → [] (DD9):
    // the global vault is NOT reachable via the picker for a burner tab.
    assert.deepEqual(store.reachableLoginItems(null, A), []);
  } finally { rm(dir); }
});

test('an UNCREATED jar vault contributes nothing (no throw); global matches still returned', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    const g = store.saveItem('global', login({ username: 'g@a', origin: A }));
    // 'work' is a persistent jar but its vault file was never created (no save).
    const rows = store.reachableLoginItems('work', A);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, g.id);
    assert.equal(rows[0].vaultId, 'global');
  } finally { rm(dir); }
});

test('an UNKNOWN / non-persistent jarId does not throw — only global contributes', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    store.saveItem('global', login({ origin: A }));
    // 'ghost' is not in listJars() — listItems('ghost') throws VaultStateError; the
    // method catches per-target and skips it rather than surfacing the exception.
    const rows = store.reachableLoginItems('ghost', A);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].vaultId, 'global');
  } finally { rm(dir); }
});

test('empty origin-match set returns [] (a valid, non-throwing state)', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    store.saveItem('global', login({ origin: A }));
    store.saveItem('work', login({ origin: A }));
    assert.deepEqual(store.reachableLoginItems('work', 'https://nomatch.example'), []);
  } finally { rm(dir); }
});
