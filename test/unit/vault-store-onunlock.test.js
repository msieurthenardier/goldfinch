'use strict';

// Unit tests for the onUnlock hook fired from vault-store's _installMrk choke
// point (M12 Flight 2 Leg 2 chrome-unlock, DD10). Because ALL three unlock paths
// (master / recovery / admin) funnel through _installMrk, firing onUnlock there —
// symmetric with onLock in lockNow — guarantees the toolbar indicator can never
// show "locked" while the store is unlocked. The hook is guarded so a failing
// broadcast never rejects unlock().
//
// Electron-free (the vault-store.test.js pattern): real temp dir, FAST scrypt.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vault-onunlock-'));
}
function makeStore(dir, overrides = {}) {
  return vs.load(dir, {
    scryptParams: FAST_SCRYPT,
    getAutoLockMinutes: () => 10,
    listJars: () => [{ id: 'work' }],
    ...overrides,
  });
}

test('onUnlock fires from _installMrk for master, recovery, AND admin unlock', async () => {
  const dir = tmpDir();
  try {
    const setupStore = makeStore(dir);
    const { recoveryKeyDisplay, adminPrivateKeyB64 } = await setupStore.setup({ masterPassword: MASTER });

    let calls = 0;
    const s = makeStore(dir, { onUnlock: () => { calls += 1; } });

    // (a) master
    await s.unlock(MASTER);
    assert.equal(s.isUnlocked(), true);
    assert.equal(calls, 1, 'master unlock fires onUnlock');

    // (b) recovery
    s.unlockWithRecovery(recoveryKeyDisplay);
    assert.equal(s.isUnlocked(), true);
    assert.equal(calls, 2, 'recovery unlock fires onUnlock');

    // (c) admin private key
    s.unlockWithAdmin(adminPrivateKeyB64);
    assert.equal(s.isUnlocked(), true);
    assert.equal(calls, 3, 'admin unlock fires onUnlock');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a wrong master password never fires onUnlock (no _installMrk, store stays locked)', async () => {
  const dir = tmpDir();
  try {
    const setupStore = makeStore(dir);
    await setupStore.setup({ masterPassword: MASTER });

    let calls = 0;
    const s = makeStore(dir, { onUnlock: () => { calls += 1; } });

    await assert.rejects(s.unlock('wrong-password'), (e) => e instanceof vs.VaultAuthError);
    assert.equal(s.isUnlocked(), false);
    assert.equal(calls, 0, 'a failed unlock broadcasts nothing');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a throwing onUnlock hook is swallowed — unlock() still resolves and the store is unlocked', async () => {
  const dir = tmpDir();
  try {
    const setupStore = makeStore(dir);
    await setupStore.setup({ masterPassword: MASTER });

    const s = makeStore(dir, {
      onUnlock: () => { throw new Error('broadcast blew up'); },
    });

    // The guard around onUnlock (try/catch in _installMrk) must keep the throw
    // from rejecting unlock() — the store is already unlocked by then.
    await assert.doesNotReject(s.unlock(MASTER));
    assert.equal(s.isUnlocked(), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('no onUnlock injected → unlock still works (Absent → no behavior change)', async () => {
  const dir = tmpDir();
  try {
    const setupStore = makeStore(dir);
    await setupStore.setup({ masterPassword: MASTER });

    const s = makeStore(dir); // no onUnlock dep
    await assert.doesNotReject(s.unlock(MASTER));
    assert.equal(s.isUnlocked(), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
