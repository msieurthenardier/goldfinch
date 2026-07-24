'use strict';

// Unit tests for the setup() master-password guard widening (M12 Flight 3 Leg 4
// first-run-setup) — the one landed-F1 vault-store.js edit. setup() now accepts a
// NON-EMPTY Buffer (the chrome-owned vault-set sheet submits the password as a zeroizable
// Buffer over menu-overlay:vault-setup) in ADDITION to the F1 non-empty string. scrypt /
// deriveMasterKey accepts a Buffer password (the unlock path already relies on it), so a
// Buffer-set store must be unlockable by the equivalent password string — proving the
// derivation is byte-consistent across the two entry shapes.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vault-setup-'));
}
function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
function makeStore(dir) {
  return vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => [] });
}

test('setup accepts a non-empty Buffer master password; the equivalent string then unlocks it', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    const buf = Buffer.from(MASTER, 'utf8');
    const out = await store.setup({ masterPassword: buf });
    assert.equal(typeof out.recoveryKeyDisplay, 'string');
    assert.ok(out.recoveryKeyDisplay.length > 0);
    assert.equal(store.isSetUp(), true);
    assert.equal(store.isUnlocked(), true, 'setup leaves the manager unlocked');

    // Lock, then unlock with the equivalent STRING — proves the Buffer password derived
    // the same master key the string would (byte-consistent scrypt input).
    store.lockNow();
    assert.equal(store.isUnlocked(), false);
    await store.unlock(MASTER);
    assert.equal(store.isUnlocked(), true, 'the string equivalent unlocks a Buffer-set store');
  } finally {
    rm(dir);
  }
});

test('setup still rejects a non-string, non-Buffer master password', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await assert.rejects(store.setup({ masterPassword: 12345 }), (e) => e instanceof vs.VaultStateError);
    await assert.rejects(store.setup({ masterPassword: null }), (e) => e instanceof vs.VaultStateError);
    assert.equal(store.isSetUp(), false, 'a rejected setup writes nothing');
  } finally {
    rm(dir);
  }
});

test('setup rejects an EMPTY Buffer (the non-empty guard holds for both shapes)', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await assert.rejects(store.setup({ masterPassword: Buffer.alloc(0) }), (e) => e instanceof vs.VaultStateError);
    await assert.rejects(store.setup({ masterPassword: '' }), (e) => e instanceof vs.VaultStateError);
    assert.equal(store.isSetUp(), false);
  } finally {
    rm(dir);
  }
});
