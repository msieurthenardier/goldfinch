'use strict';

// Mission 23 Flight 2 leg 09 (DD6, finding 12): a master re-wrap with a fresh password in
// hand (`changeMasterPassword`, `recoverMasterPassword`, `compromiseRotate`) never uses
// key-derivation parameters weaker than the store's own default. Stronger-or-equal stored
// parameters are kept (same object). Electron-free: temp dirs, fast parameters.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');

const MB = 1024 * 1024;
// The test default. "Weaker" is built through r (N may not go below the validator's 2^12).
const DEFAULT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * MB };
const WEAK_R = { algo: 'scrypt', N: 2 ** 12, r: 4, p: 1, maxmem: 64 * MB };
const STRONGER = { algo: 'scrypt', N: 2 ** 13, r: 8, p: 2, maxmem: 64 * MB };
const OLD = 'old master password';
const NEW = 'a new master password';
const JARS = [{ id: 'work' }];

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-kdf-rewrap-'));
}
function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
function makeStore(dir, scryptParams = DEFAULT) {
  return vs.load(dir, { scryptParams, getAutoLockMinutes: () => 10, listJars: () => JARS });
}
const managerPath = (dir) => path.join(dir, 'vaults', 'manager.json');
const readManager = (dir) => JSON.parse(fs.readFileSync(managerPath(dir), 'utf8'));
const buf = (s) => Buffer.from(s, 'utf8');

// ---------------------------------------------------------------------------
// AC1 — the pure helper
// ---------------------------------------------------------------------------

test('chooseRewrapKdf: table', () => {
  const d = DEFAULT;
  const same = (stored) => assert.equal(vs.chooseRewrapKdf(stored, d), stored, 'same object kept');
  const dflt = (stored) => assert.equal(vs.chooseRewrapKdf(stored, d), d, 'default returned whole');

  same({ ...d }); // equal
  same(STRONGER); // stronger in all
  same({ ...d, N: 2 ** 13 }); // stronger in one, equal elsewhere
  dflt({ ...d, N: 2 ** 11 }); // weaker by N
  dflt({ ...d, r: 4 }); // weaker by r
  dflt({ ...d, p: 0 }); // weaker by p
  const bigD = { algo: 'scrypt', N: 2 ** 13, r: 8, p: 2, maxmem: 64 * MB };
  assert.equal(vs.chooseRewrapKdf({ ...bigD, N: 2 ** 14, p: 1 }, bigD), bigD, 'mixed: N up, p down -> default');
  assert.equal(vs.chooseRewrapKdf({ ...bigD, r: 16, N: 2 ** 12 }, bigD), bigD, 'mixed (high r, low N) -> default');
  // All at or above, but maxmem under scrypt's real need (exactly the validator's floor fails).
  dflt({ ...d, maxmem: 128 * d.N * d.r });
  dflt({ ...d, maxmem: 128 * d.r * (d.N + d.p + 1) });
  same({ ...d, maxmem: 128 * d.r * (d.N + d.p + 2) });
  // Non-scrypt and malformed.
  dflt({ ...d, algo: 'pbkdf2' });
  dflt(null);
  dflt(undefined);
  dflt('scrypt');
  dflt([]);
  dflt({ algo: 'scrypt', N: 2 ** 12, r: 8, p: 1 }); // maxmem missing
  dflt({ ...d, N: '4096' }); // non-number
  dflt({ ...d, r: NaN });
});

// ---------------------------------------------------------------------------
// AC3 — the tampered-edit scenario, from its real trigger
// ---------------------------------------------------------------------------

async function setupTampered(dir) {
  const store = makeStore(dir);
  const { recoveryKeyDisplay } = await store.setup({ masterPassword: OLD });
  store.lockNow();
  const doc = readManager(dir);
  doc.kdf = { ...WEAK_R }; // weaker-but-valid, roomy maxmem
  fs.writeFileSync(managerPath(dir), JSON.stringify(doc), 'utf8');
  return recoveryKeyDisplay;
}

test('recoverMasterPassword: a tampered-weak kdf is raised to the default; new password and recovery key both work', async () => {
  const dir = tmpDir();
  try {
    const recovery = await setupTampered(dir);
    const store = makeStore(dir);
    await assert.rejects(store.unlock(OLD), (e) => e instanceof vs.VaultAuthError, 'edit breaks the password');
    assert.deepEqual(readManager(dir).kdf, WEAK_R, 'no floor on read: still loads');
    await store.recoverMasterPassword({ recoveryDisplay: recovery, newMasterPassword: NEW });
    assert.deepEqual(readManager(dir).kdf, DEFAULT);
    store.lockNow();
    const again = makeStore(dir);
    await again.unlock(NEW);
    again.lockNow();
    again.unlockWithRecovery(recovery);
    assert.equal(again.isUnlocked(), true);
  } finally {
    rm(dir);
  }
});

test('compromiseRotate (recovery branch): a tampered-weak kdf is raised to the default in the new manager', async () => {
  const dir = tmpDir();
  try {
    const recovery = await setupTampered(dir);
    const store = makeStore(dir);
    const res = await store.compromiseRotate({ recoveryKey: recovery, newMasterPassword: buf(NEW) });
    assert.ok(res.recoveryKey);
    assert.deepEqual(readManager(dir).kdf, DEFAULT);
    store.lockNow();
    const again = makeStore(dir);
    await again.unlock(NEW);
    again.lockNow();
    again.unlockWithRecovery(res.recoveryKey);
    assert.equal(again.isUnlocked(), true);
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// AC4 — a genuinely weak profile (envelope really wrapped under weak params)
// ---------------------------------------------------------------------------

test('changeMasterPassword / compromiseRotate (master): a genuinely weak profile is raised; export carries the raised kdf', async () => {
  for (const op of ['change', 'rotate']) {
    const dir = tmpDir();
    try {
      // A store whose own default is weak writes a manager wrapped under WEAK_R.
      const weak = makeStore(dir, WEAK_R);
      await weak.setup({ masterPassword: OLD });
      weak.lockNow();
      const store = makeStore(dir, DEFAULT);
      await store.unlock(OLD); // no floor on read
      assert.deepEqual(readManager(dir).kdf, WEAK_R);
      if (op === 'change') {
        await store.changeMasterPassword({ oldMasterPassword: OLD, newMasterPassword: NEW });
      } else {
        await store.compromiseRotate({ oldMasterPassword: buf(OLD), newMasterPassword: buf(NEW) });
      }
      assert.deepEqual(readManager(dir).kdf, DEFAULT, op);
      assert.deepEqual(store.exportProfile().bundle.kdf, DEFAULT, 'export consistent with the envelope');
      store.lockNow();
      const again = makeStore(dir, DEFAULT);
      await again.unlock(NEW);
      assert.equal(again.isUnlocked(), true);
    } finally {
      rm(dir);
    }
  }
});

test('adopt path: a bundle from a weaker store keeps the donor kdf at adopt, is raised at the next password change', async () => {
  const srcDir = tmpDir();
  const dstDir = tmpDir();
  try {
    const src = makeStore(srcDir, WEAK_R);
    await src.setup({ masterPassword: OLD });
    const bundle = JSON.parse(JSON.stringify(src.exportVault('global')));
    const dst = makeStore(dstDir, DEFAULT);
    await dst.importVault(bundle, { destinationTarget: 'global', secret: buf(OLD), secretKind: 'master' });
    assert.deepEqual(readManager(dstDir).kdf, WEAK_R, 'pin: donor params kept at adopt');
    await dst.changeMasterPassword({ oldMasterPassword: OLD, newMasterPassword: NEW });
    assert.deepEqual(readManager(dstDir).kdf, DEFAULT);
    dst.lockNow();
    await dst.unlock(NEW);
    assert.equal(dst.isUnlocked(), true);
  } finally {
    rm(srcDir);
    rm(dstDir);
  }
});

// ---------------------------------------------------------------------------
// AC5 — stronger is kept, manager.kdf not rewritten
// ---------------------------------------------------------------------------

test('stronger-than-default parameters survive all three operations unchanged', async () => {
  const dir = tmpDir();
  try {
    const first = makeStore(dir, STRONGER);
    const { recoveryKeyDisplay } = await first.setup({ masterPassword: OLD });
    first.lockNow();
    const store = makeStore(dir, DEFAULT);
    await store.unlock(OLD);
    const kdfJson = () => JSON.stringify(readManager(dir).kdf);
    const before = kdfJson();
    await store.changeMasterPassword({ oldMasterPassword: OLD, newMasterPassword: NEW });
    assert.equal(kdfJson(), before, 'change');
    await store.recoverMasterPassword({ recoveryDisplay: recoveryKeyDisplay, newMasterPassword: OLD });
    assert.equal(kdfJson(), before, 'recover');
    const res = await store.compromiseRotate({ oldMasterPassword: buf(OLD), newMasterPassword: buf(NEW) });
    assert.equal(kdfJson(), before, 'rotate (master)');
    await store.compromiseRotate({ recoveryKey: res.recoveryKey, newMasterPassword: buf(OLD) });
    assert.equal(kdfJson(), before, 'rotate (recovery)');
    assert.deepEqual(readManager(dir).kdf, STRONGER);
  } finally {
    rm(dir);
  }
});
