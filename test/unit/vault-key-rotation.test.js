'use strict';

// Unit tests for the M12 Flight 4 Leg 2 operator-secret ROTATION ops on vault-store.js
// (DD3): rotateRecovery, changeMasterPassword (extended with an old-password step-up), and
// recoverMasterPassword (the single recover-after-forgotten-master op). Each is a constant-
// size manager.json rewrite — the MRK is never re-keyed, so `.gfvault` files are untouched
// and each op rewrites ONLY its own `manager.mrk.*` slot.
//
// Electron-free: the store injects userDataPath + a listJars() provider (the settings-store
// mkdtempSync harness), FAST scrypt for quick derivations.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');
const vc = require('../../src/main/vault/vault-crypto');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';
const JARS = [{ id: 'work' }];

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vault-rot-'));
}
function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
function makeStore(dir, overrides = {}) {
  return vs.load(dir, {
    scryptParams: FAST_SCRYPT,
    getAutoLockMinutes: () => 10,
    listJars: () => JARS,
    ...overrides,
  });
}
function vaultPath(dir, id) {
  return path.join(dir, 'vaults', `${id}.gfvault`);
}
function managerPath(dir) {
  return path.join(dir, 'vaults', 'manager.json');
}
function readManager(dir) {
  return JSON.parse(fs.readFileSync(managerPath(dir), 'utf8'));
}
function readVaultBytes(dir, id) {
  return fs.readFileSync(vaultPath(dir, id)); // Buffer — byte-exact comparison
}
function loginItem(overrides = {}) {
  return { type: 'login', title: 'Example', username: 'u', password: 'hunter2', ...overrides };
}

// ---------------------------------------------------------------------------
// rotateRecovery — master-password step-up, rewrites ONLY manager.mrk.recovery
// ---------------------------------------------------------------------------

test('rotateRecovery: new recovery unlocks, old fails; only manager.mrk.recovery changed; .gfvault untouched', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    const { recoveryKeyDisplay: oldRecovery } = await store.setup({ masterPassword: MASTER });
    store.saveItem('global', loginItem({ title: 'Kept' }));

    const before = readManager(dir);
    const gfBefore = readVaultBytes(dir, 'global');

    const newRecovery = await store.rotateRecovery({ masterPassword: MASTER });
    assert.equal(typeof newRecovery, 'string');
    assert.ok(newRecovery.length > 0);
    assert.notEqual(newRecovery, oldRecovery, 'a fresh recovery key is minted');

    const after = readManager(dir);
    // ONLY the recovery slot changed.
    assert.deepEqual(after.mrk.master, before.mrk.master, 'master slot untouched');
    assert.deepEqual(after.mrk.admin, before.mrk.admin, 'admin slot untouched');
    assert.notDeepEqual(after.mrk.recovery, before.mrk.recovery, 'recovery slot rewrapped');
    // The .gfvault file is byte-for-byte unchanged (the MRK is never re-keyed).
    assert.ok(gfBefore.equals(readVaultBytes(dir, 'global')), 'global .gfvault byte-unchanged');

    // The NEW recovery key unlocks; the OLD one no longer does.
    let s = makeStore(dir);
    s.unlockWithRecovery(newRecovery);
    assert.deepEqual(s.listItems('global').map((i) => i.title), ['Kept']);

    s = makeStore(dir);
    assert.throws(() => s.unlockWithRecovery(oldRecovery), (e) => e instanceof vs.VaultAuthError);
    assert.equal(s.isUnlocked(), false);

    // The master password still unlocks (unchanged).
    s = makeStore(dir, {});
    await s.unlock(MASTER);
    assert.equal(s.isUnlocked(), true);
  } finally {
    rm(dir);
  }
});

test('rotateRecovery: a WRONG master-password step-up throws VaultAuthError and rotates NOTHING', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    const managerBytesBefore = fs.readFileSync(managerPath(dir));

    await assert.rejects(
      store.rotateRecovery({ masterPassword: 'wrong-master' }),
      (e) => e instanceof vs.VaultAuthError
    );
    // manager.json is byte-for-byte unchanged — nothing was written before the step-up failed.
    assert.ok(managerBytesBefore.equals(fs.readFileSync(managerPath(dir))), 'manager.json untouched');
  } finally {
    rm(dir);
  }
});

test('rotateRecovery: while LOCKED throws VaultLockedError (route to unlock)', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    store.lockNow();
    await assert.rejects(
      store.rotateRecovery({ masterPassword: MASTER }),
      (e) => e instanceof vs.VaultLockedError
    );
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// changeMasterPassword — old-password step-up, rewrites ONLY manager.mrk.master
// ---------------------------------------------------------------------------

test('changeMasterPassword: new master unlocks, old fails; only manager.mrk.master changed; .gfvault untouched', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    const { recoveryKeyDisplay } = await store.setup({ masterPassword: MASTER });
    store.saveItem('global', loginItem({ title: 'Kept' }));

    const before = readManager(dir);
    const gfBefore = readVaultBytes(dir, 'global');

    await store.changeMasterPassword({ oldMasterPassword: MASTER, newMasterPassword: 'brand-new-master' });

    const after = readManager(dir);
    assert.notDeepEqual(after.mrk.master, before.mrk.master, 'master slot rewrapped');
    assert.deepEqual(after.mrk.recovery, before.mrk.recovery, 'recovery slot untouched');
    assert.deepEqual(after.mrk.admin, before.mrk.admin, 'admin slot untouched');
    assert.ok(gfBefore.equals(readVaultBytes(dir, 'global')), 'global .gfvault byte-unchanged');

    // NEW master unlocks; OLD master rejected; recovery still valid (not rotated).
    let s = makeStore(dir);
    await s.unlock('brand-new-master');
    assert.deepEqual(s.listItems('global').map((i) => i.title), ['Kept']);

    s = makeStore(dir);
    await assert.rejects(s.unlock(MASTER), (e) => e instanceof vs.VaultAuthError);

    s = makeStore(dir);
    s.unlockWithRecovery(recoveryKeyDisplay);
    assert.equal(s.isUnlocked(), true, 'recovery key still unlocks after a master change');
  } finally {
    rm(dir);
  }
});

test('changeMasterPassword: a WRONG old password throws VaultAuthError and writes NOTHING', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    const managerBytesBefore = fs.readFileSync(managerPath(dir));

    await assert.rejects(
      store.changeMasterPassword({ oldMasterPassword: 'not-the-master', newMasterPassword: 'brand-new-master' }),
      (e) => e instanceof vs.VaultAuthError
    );
    assert.ok(managerBytesBefore.equals(fs.readFileSync(managerPath(dir))), 'manager.json untouched');
    // The ORIGINAL master still unlocks — the failed change never rewrote the envelope.
    const s = makeStore(dir);
    await s.unlock(MASTER);
    assert.equal(s.isUnlocked(), true);
  } finally {
    rm(dir);
  }
});

test('changeMasterPassword: accepts Buffer old + new passwords (the sheet submits zeroizable Buffers)', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });

    await store.changeMasterPassword({
      oldMasterPassword: Buffer.from(MASTER, 'utf8'),
      newMasterPassword: Buffer.from('buffer-new-master', 'utf8'),
    });

    const s = makeStore(dir);
    await s.unlock('buffer-new-master');
    assert.equal(s.isUnlocked(), true);
  } finally {
    rm(dir);
  }
});

test('changeMasterPassword: while LOCKED throws VaultLockedError', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    store.lockNow();
    await assert.rejects(
      store.changeMasterPassword({ oldMasterPassword: MASTER, newMasterPassword: 'x' }),
      (e) => e instanceof vs.VaultLockedError
    );
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// recoverMasterPassword — recovery-key step-up, from LOCKED, rewrites ONLY mrk.master
// ---------------------------------------------------------------------------

test('recoverMasterPassword: valid recovery from LOCKED → unlocked + new master; only mrk.master changed; .gfvault untouched', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    const { recoveryKeyDisplay } = await store.setup({ masterPassword: MASTER });
    store.saveItem('global', loginItem({ title: 'Kept' }));

    const before = readManager(dir);
    const gfBefore = readVaultBytes(dir, 'global');

    store.lockNow();
    await store.recoverMasterPassword({
      recoveryDisplay: recoveryKeyDisplay, newMasterPassword: 'recovered-master',
    });
    // The user ends UNLOCKED (they recovered) and can immediately read items.
    assert.equal(store.isUnlocked(), true, 'recover installs the MRK — the user ends unlocked');
    assert.deepEqual(store.listItems('global').map((i) => i.title), ['Kept']);

    const after = readManager(dir);
    assert.notDeepEqual(after.mrk.master, before.mrk.master, 'master slot rewrapped');
    assert.deepEqual(after.mrk.recovery, before.mrk.recovery, 'recovery slot untouched (key still valid)');
    assert.deepEqual(after.mrk.admin, before.mrk.admin, 'admin slot untouched');
    assert.ok(gfBefore.equals(readVaultBytes(dir, 'global')), 'global .gfvault byte-unchanged');

    // The NEW master unlocks; the OLD one no longer does; the recovery key STILL unlocks.
    let s = makeStore(dir);
    await s.unlock('recovered-master');
    assert.equal(s.isUnlocked(), true);

    s = makeStore(dir);
    await assert.rejects(s.unlock(MASTER), (e) => e instanceof vs.VaultAuthError);

    s = makeStore(dir);
    s.unlockWithRecovery(recoveryKeyDisplay);
    assert.equal(s.isUnlocked(), true, 'the recovery key is not rotated by a recover');
  } finally {
    rm(dir);
  }
});

test('recoverMasterPassword: a WRONG recovery key throws VaultAuthError, writes NOTHING, stays LOCKED (not a skip-flag)', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    const { recoveryKeyDisplay } = await store.setup({ masterPassword: MASTER });
    store.lockNow();
    const managerBytesBefore = fs.readFileSync(managerPath(dir));

    // A different, valid-shape recovery key (right format, wrong bytes).
    const wrong = vc.generateRecoveryKey();
    await assert.rejects(
      store.recoverMasterPassword({ recoveryDisplay: wrong.display, newMasterPassword: 'nope' }),
      (e) => e instanceof vs.VaultAuthError
    );
    wrong.material.fill(0);

    assert.equal(store.isUnlocked(), false, 'a wrong recovery key installs no MRK — still locked');
    assert.ok(managerBytesBefore.equals(fs.readFileSync(managerPath(dir))), 'manager.json untouched');
    // The ORIGINAL master + recovery both still work — nothing was rewritten.
    let s = makeStore(dir);
    await s.unlock(MASTER);
    assert.equal(s.isUnlocked(), true);
    s = makeStore(dir);
    s.unlockWithRecovery(recoveryKeyDisplay);
    assert.equal(s.isUnlocked(), true);
  } finally {
    rm(dir);
  }
});

test('recoverMasterPassword: accepts a Buffer new master password', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    const { recoveryKeyDisplay } = await store.setup({ masterPassword: MASTER });
    store.lockNow();
    await store.recoverMasterPassword({
      recoveryDisplay: recoveryKeyDisplay, newMasterPassword: Buffer.from('buffer-recovered', 'utf8'),
    });
    const s = makeStore(dir);
    await s.unlock('buffer-recovered');
    assert.equal(s.isUnlocked(), true);
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// Concurrency + generation guard (PR#112 finding 3): serialized manager mutations
// don't lose a slot update, and a lockNow() mid-derive never persists an envelope
// wrapping a zeroized MRK.
// ---------------------------------------------------------------------------

test('concurrent rotateRecovery + rotateAdminKey both take effect (no lost slot update, finding 3)', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    const { recoveryKeyDisplay } = await store.setup({ masterPassword: MASTER });

    // Fire both manager mutations without awaiting between them — the mutex serializes them
    // so neither reads the pre-write manager and clobbers the other's slot. Both step up with
    // the SAME master (neither changes it), so both legitimately succeed.
    const [newRecovery, newAdminPriv] = await Promise.all([
      store.rotateRecovery({ masterPassword: MASTER }),
      store.rotateAdminKey({ masterPassword: MASTER }),
    ]);

    // BOTH slot updates survived a cold reload: the NEW recovery unlocks AND the NEW admin key unlocks.
    const s1 = makeStore(dir);
    s1.unlockWithRecovery(newRecovery);
    assert.equal(s1.isUnlocked(), true, 'the new recovery key works');

    const s2 = makeStore(dir);
    s2.unlockWithAdmin(newAdminPriv);
    assert.equal(s2.isUnlocked(), true, 'the new admin key works');

    // The OLD recovery no longer works (it was genuinely rotated, not clobbered back by admin's write).
    const s3 = makeStore(dir);
    assert.throws(() => s3.unlockWithRecovery(recoveryKeyDisplay), (e) => e instanceof vs.VaultAuthError);
  } finally {
    rm(dir);
  }
});

test('lockNow() during a rotateRecovery derive is caught: nothing is written, the recovery slot is intact (finding 3)', async () => {
  const dir = tmpDir();
  try {
    // A store whose scrypt derive we can interleave a lockNow() into: wrap unwrapMaster so
    // the lock fires WHILE the step-up derive is in flight (before the recovery wrap).
    const store = makeStore(dir);
    const { recoveryKeyDisplay } = await store.setup({ masterPassword: MASTER });
    const managerBefore = readManager(dir);

    // Monkeypatch the crypto step-up used inside rotateRecovery to lock mid-derive.
    const realUnwrap = vc.unwrapMaster;
    vc.unwrapMaster = async (...args) => {
      const mrk = await realUnwrap(...args);
      store.lockNow(); // zeroizes + bumps the generation while we're "inside" the op
      return mrk;
    };
    try {
      await assert.rejects(
        () => store.rotateRecovery({ masterPassword: MASTER }),
        (e) => e instanceof vs.VaultLockedError,
        'a lock mid-derive is refused, not persisted'
      );
    } finally {
      vc.unwrapMaster = realUnwrap;
    }

    // manager.json is byte-unchanged: no recovery slot wrapping a zeroized MRK was written.
    assert.deepEqual(readManager(dir), managerBefore, 'the manager is untouched after the refused rotation');
    // The ORIGINAL recovery key still unlocks (the slot was never corrupted).
    const s = makeStore(dir);
    s.unlockWithRecovery(recoveryKeyDisplay);
    assert.equal(s.isUnlocked(), true, 'the original recovery key still works');
  } finally {
    rm(dir);
  }
});
