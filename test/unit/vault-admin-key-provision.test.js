'use strict';

// Unit tests for the M12 Flight 4 Leg 3 admin-key PROVISION/ROTATION op on vault-store.js
// (DD4): rotateAdminKey. A constant-size manager.json rewrite gated by a master-password
// step-up — mints a fresh X25519 admin keypair, re-seals ONLY manager.mrk.admin to the new
// public key, overwrites adminPublicKeyB64, and returns the new one-time admin private key.
// The MRK is never re-keyed, so every `.gfvault` file and the other mrk slots are untouched.
// Rotation and the from-scratch provision are the SAME op (F3's setup-minted admin private
// key was discarded — the seal is orphaned; provision mints anew).
//
// Electron-free: the store injects userDataPath + a listJars() provider (the mkdtempSync
// harness), FAST scrypt for quick derivations.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';
const JARS = [{ id: 'work' }];

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vault-admin-'));
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
// rotateAdminKey — master-password step-up, rewrites ONLY manager.mrk.admin + adminPublicKeyB64
// ---------------------------------------------------------------------------

test('rotateAdminKey: new key opens the seal + ALL vaults (global + jar); only mrk.admin + adminPublicKeyB64 change; .gfvault untouched', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    // The setup-minted admin private key is the PRE-rotation ("old") key — F3 discards it in
    // the real app; here we hold it to prove invalidation below.
    const { adminPrivateKeyB64: oldPriv } = await store.setup({ masterPassword: MASTER });
    store.saveItem('global', loginItem({ title: 'GlobalKept' }));
    store.saveItem('work', loginItem({ title: 'WorkKept' })); // create the jar vault

    const before = readManager(dir);
    const gfGlobalBefore = readVaultBytes(dir, 'global');
    const gfWorkBefore = readVaultBytes(dir, 'work');

    const newPriv = await store.rotateAdminKey({ masterPassword: MASTER });
    assert.equal(typeof newPriv, 'string');
    assert.ok(newPriv.length > 0);
    assert.notEqual(newPriv, oldPriv, 'a fresh admin private key is minted');

    const after = readManager(dir);
    // ONLY the admin slot + the public key changed.
    assert.deepEqual(after.mrk.master, before.mrk.master, 'master slot untouched');
    assert.deepEqual(after.mrk.recovery, before.mrk.recovery, 'recovery slot untouched');
    assert.notDeepEqual(after.mrk.admin, before.mrk.admin, 'admin slot re-sealed');
    assert.notEqual(after.adminPublicKeyB64, before.adminPublicKeyB64, 'adminPublicKeyB64 overwritten');
    // Both .gfvault files are byte-for-byte unchanged (the MRK is never re-keyed).
    assert.ok(gfGlobalBefore.equals(readVaultBytes(dir, 'global')), 'global .gfvault byte-unchanged');
    assert.ok(gfWorkBefore.equals(readVaultBytes(dir, 'work')), 'work .gfvault byte-unchanged');

    // The NEW admin private key opens the seal AND unlocks EVERY vault (global + the jar).
    const s = makeStore(dir);
    const keys = s.openAllWithAdminKey(newPriv);
    assert.deepEqual([...keys.keys()].sort(), ['global', 'work'], 'admin key opens all vaults');
    assert.deepEqual(s.readVaultItems('global', keys.get('global')).map((i) => i.title), ['GlobalKept']);
    assert.deepEqual(s.readVaultItems('work', keys.get('work')).map((i) => i.title), ['WorkKept']);
    for (const k of keys.values()) k.fill(0);
  } finally {
    rm(dir);
  }
});

test('rotateAdminKey: the OLD admin private key no longer opens the seal after rotation (invalidation)', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    const { adminPrivateKeyB64: oldPriv } = await store.setup({ masterPassword: MASTER });
    store.saveItem('global', loginItem());

    const newPriv = await store.rotateAdminKey({ masterPassword: MASTER });

    const s = makeStore(dir);
    // The re-sealed manager.mrk.admin is bound to the NEW public key — the old private key's
    // ECDH derives the wrong wrapping key → GCM auth fails → VaultAuthError.
    assert.throws(() => s.openAllWithAdminKey(oldPriv), (e) => e instanceof vs.VaultAuthError);
    // The new key still works (sanity — invalidation is scoped to the old key only).
    const keys = s.openAllWithAdminKey(newPriv);
    assert.ok(keys.has('global'));
    for (const k of keys.values()) k.fill(0);
  } finally {
    rm(dir);
  }
});

test('rotateAdminKey: from-scratch PROVISION — a setup manager whose admin key was discarded yields a usable admin key', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    // Model F3: setup mints an admin keypair but the private half is DISCARDED (never surfaced),
    // so the on-disk seal is orphaned from the operator's view. Provision mints anew.
    await store.setup({ masterPassword: MASTER }); // discard the returned adminPrivateKeyB64
    store.saveItem('global', loginItem({ title: 'Provisioned' }));

    const provisioned = await store.rotateAdminKey({ masterPassword: MASTER });
    assert.equal(typeof provisioned, 'string');
    assert.ok(provisioned.length > 0);

    // The provisioned key is immediately usable — it opens the seal + reads items.
    const s = makeStore(dir);
    const keys = s.openAllWithAdminKey(provisioned);
    assert.deepEqual(s.readVaultItems('global', keys.get('global')).map((i) => i.title), ['Provisioned']);
    for (const k of keys.values()) k.fill(0);
  } finally {
    rm(dir);
  }
});

test('rotateAdminKey: a WRONG master-password step-up throws VaultAuthError and rotates NOTHING', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    const { adminPrivateKeyB64: origPriv } = await store.setup({ masterPassword: MASTER });
    const managerBytesBefore = fs.readFileSync(managerPath(dir));

    await assert.rejects(
      store.rotateAdminKey({ masterPassword: 'wrong-master' }),
      (e) => e instanceof vs.VaultAuthError
    );
    // manager.json is byte-for-byte unchanged — nothing was written before the step-up failed.
    assert.ok(managerBytesBefore.equals(fs.readFileSync(managerPath(dir))), 'manager.json untouched');
    // The ORIGINAL admin key still opens the seal — the failed rotation never re-sealed it.
    const s = makeStore(dir);
    const keys = s.openAllWithAdminKey(origPriv);
    assert.ok(keys.has('global'), 'the original admin key still works after a refused rotation');
    for (const k of keys.values()) k.fill(0);
  } finally {
    rm(dir);
  }
});

test('rotateAdminKey: accepts a Buffer master password (the sheet submits a zeroizable Buffer)', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    store.saveItem('global', loginItem());

    const newPriv = await store.rotateAdminKey({ masterPassword: Buffer.from(MASTER, 'utf8') });
    const s = makeStore(dir);
    const keys = s.openAllWithAdminKey(newPriv);
    assert.ok(keys.has('global'));
    for (const k of keys.values()) k.fill(0);
  } finally {
    rm(dir);
  }
});

test('rotateAdminKey: while LOCKED throws VaultLockedError (route to unlock)', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    store.lockNow();
    await assert.rejects(
      store.rotateAdminKey({ masterPassword: MASTER }),
      (e) => e instanceof vs.VaultLockedError
    );
  } finally {
    rm(dir);
  }
});

test('rotateAdminKey: a missing/empty master password throws before any crypto (nothing written)', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    const managerBytesBefore = fs.readFileSync(managerPath(dir));
    await assert.rejects(store.rotateAdminKey({}), (e) => e instanceof vs.VaultStateError);
    await assert.rejects(store.rotateAdminKey({ masterPassword: '' }), (e) => e instanceof vs.VaultStateError);
    assert.ok(managerBytesBefore.equals(fs.readFileSync(managerPath(dir))), 'manager.json untouched');
  } finally {
    rm(dir);
  }
});
