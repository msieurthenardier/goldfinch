'use strict';

// Unit tests for vault-store's COMPROMISE ROTATION (Mission 18, Flight 2,
// Leg 3 / flight DD1–DD3): `compromiseRotate` — the single op that mints a
// fresh MRK + fresh vault keys, re-encrypts every vault's items, drops every
// access envelope, removes the admin provision, re-wraps under a REQUIRED new
// master password (v2 no-admin manager — the first v2 writer), commits through
// the leg-2 transaction primitive, installs the new MRK post-commit, and
// returns the one-time recovery key + revocation report.
//
// Electron-free (temp dirs, FAST_SCRYPT, on-disk byte probes — the
// vault-key-rotation.test.js idioms). Old-material replay drives vault-crypto
// DIRECTLY against on-disk docs where no store API exists for the negative
// (raw-MRK / raw-vault-key GCM probes — the F4 adversarial style). The suites:
//   • FULL SEVER (criterion 1): every captured pre-rotation credential and raw
//     key fails after the rotation; the new credentials succeed; items intact;
//     ciphertext rotated; manager v2 no-admin on disk with the kdf preserved.
//   • Report correctness + out-of-sever-scope pins (pre-rotation bundles stay
//     adoptable/importable BY DESIGN — compromise mode severs the LIVE
//     profile, not previously exported artifacts the operator holds; feeds the
//     CP5 threat-model bullet).
//   • Corrupt/foreign/unregistered vault handling (the registry∪disk union).
//   • R7 both branches (VaultPasswordReuseError), wrong credentials, the
//     malformed-display VaultFormatError.
//   • Busy/exclusivity + the double-rotate manager-lock queue.
//   • The INTERRUPTION matrix (criterion 2, op-level): monkeypatched syscall
//     kills across the rotation — the op's committed-flag failure
//     discrimination guarantees the op's outcome always tells the truth about
//     the disk (resolved ⇔ entirely new, rejected ⇔ entirely old), including
//     the design-review HIGH post-discriminator pins.
//   • The lock-state matrix (store half): succeeds from locked and unlocked,
//     both end unlocked with onUnlock fired.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');
const vc = require('../../src/main/vault/vault-crypto');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const OLD_MASTER = 'old compromised master';
const NEW_MASTER = 'entirely different new master';
const JARS = [{ id: 'work' }, { id: 'personal' }];

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-comp-rot-'));
}
function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
function makeStore(dir, overrides = {}) {
  return vs.load(dir, {
    scryptParams: FAST_SCRYPT,
    getAutoLockMinutes: () => 10,
    listJars: () => JARS,
    ...overrides
  });
}
function vaultsDir(dir) {
  return path.join(dir, 'vaults');
}
function readManager(dir) {
  return JSON.parse(fs.readFileSync(path.join(vaultsDir(dir), 'manager.json'), 'utf8'));
}
function readVaultDoc(dir, id) {
  return vc.parseVault(fs.readFileSync(path.join(vaultsDir(dir), `${id}.gfvault`)));
}
function loginItem(overrides = {}) {
  return { type: 'login', title: 'Example', username: 'u', password: 'hunter2', ...overrides };
}

/** Byte snapshot of a directory: Map<name, Buffer>. */
function snapshot(dir) {
  return new Map(
    fs
      .readdirSync(dir)
      .sort()
      .map((n) => [n, fs.readFileSync(path.join(dir, n))])
  );
}

/** Assert `dir` is byte-identical to a prior snapshot (same names, same bytes). */
function assertSnapshotUnchanged(dir, before, label) {
  const current = snapshot(dir);
  assert.deepEqual([...current.keys()], [...before.keys()], `${label}: same file set`);
  for (const [name, bytes] of before) {
    assert.ok(current.get(name).equals(bytes), `${label}: ${name} byte-identical`);
  }
}

// The store's mrk-envelope AAD, reconstructed for direct-GCM replay probes
// (vault-store does not export it — the leg-2 fixture idiom).
function mrkAad(version) {
  return Buffer.from(`gfvault/mrk-env/v${version}`, 'utf8');
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Fail fast instead of hanging when a lock/gate regression deadlocks. */
function withTimeout(promise, label, ms = 5000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Poll until `cond()` is true (hard-timeout — never hangs the suite). */
async function until(cond, label, ms = 5000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${label}`);
    await tick();
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The full-sever fixture: a provisioned-admin v1 profile (setup still writes
 * v1) with the global vault + 2 jar vaults, items in each, and a minted access
 * key on `work`. Captures EVERY pre-rotation credential/material the sever
 * must invalidate: recovery display, admin private key, access-key secret, raw
 * MRK bytes, a raw vault-key's bytes, and byte snapshots of manager + vaults.
 */
async function severFixture(dir, overrides = {}) {
  const store = makeStore(dir, overrides);
  const { recoveryKeyDisplay, adminPrivateKeyB64 } = await store.setup({ masterPassword: OLD_MASTER });
  store.saveItem('global', loginItem({ id: 'g1', title: 'G-ITEM' }));
  store.saveItem('work', loginItem({ id: 'w1', title: 'W-ITEM' }));
  store.saveItem('personal', loginItem({ id: 'p1', title: 'P-ITEM' }));
  const { secret: accessSecret } = await store.mintAccessKey('work', { masterPassword: OLD_MASTER });
  return {
    store,
    vdir: vaultsDir(dir),
    oldRecovery: recoveryKeyDisplay,
    oldAdminPriv: adminPrivateKeyB64,
    oldAccessSecret: accessSecret,
    oldMrkBytes: Buffer.from(store.mrk),
    oldWorkKeyBytes: Buffer.from(store.vaultKeys.get('work')),
    oldBytes: snapshot(vaultsDir(dir))
  };
}

function rotateMaster(store, { oldMaster = OLD_MASTER, newMaster = NEW_MASTER } = {}) {
  return store.compromiseRotate({
    oldMasterPassword: Buffer.from(oldMaster, 'utf8'),
    newMasterPassword: Buffer.from(newMaster, 'utf8')
  });
}

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

test('compromiseRotate: argument guards — missing/ambiguous credentials, missing new password, not set up', async () => {
  const dir = tmpDir();
  try {
    const state = (e) => e instanceof vs.VaultStateError;
    // Not set up: refused before any credential work.
    const fresh = makeStore(dir);
    await assert.rejects(rotateMaster(fresh), state, 'not set up');

    await fresh.setup({ masterPassword: OLD_MASTER });
    await assert.rejects(fresh.compromiseRotate({}), state, 'no credential at all');
    await assert.rejects(
      fresh.compromiseRotate({ oldMasterPassword: Buffer.from(OLD_MASTER) }),
      state,
      'missing newMasterPassword'
    );
    await assert.rejects(
      fresh.compromiseRotate({ recoveryKey: '', newMasterPassword: Buffer.from(NEW_MASTER) }),
      state,
      'empty recoveryKey'
    );
    await assert.rejects(
      fresh.compromiseRotate({
        oldMasterPassword: Buffer.from(OLD_MASTER),
        recoveryKey: 'AAAAA-AAAAA',
        newMasterPassword: Buffer.from(NEW_MASTER)
      }),
      state,
      'both credential branches supplied'
    );
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// AC1 — FULL SEVER (criterion 1)
// ---------------------------------------------------------------------------

test('FULL SEVER: every captured old credential/material fails, new credentials succeed, items intact, ciphertext rotated, manager v2 no-admin, kdf preserved (AC1)', async () => {
  const dir = tmpDir();
  const dir2 = tmpDir();
  try {
    const fx = await severFixture(dir);
    const itemsBefore = {
      global: fx.store.listItems('global'),
      work: fx.store.listItems('work'),
      personal: fx.store.listItems('personal')
    };

    const out = await rotateMaster(fx.store);

    // ---- return shape + report ----
    assert.equal(typeof out.recoveryKey, 'string');
    assert.ok(out.recoveryKey.length > 0, 'a one-time recovery display is returned');
    assert.notEqual(out.recoveryKey, fx.oldRecovery, 'the recovery key is freshly minted');
    assert.equal(out.revoked.admin, true, 'the v1 fixture carried the admin pair — reported revoked');
    assert.deepEqual(out.revoked.vaultIds, ['work'], 'exactly the vaults that carried access envelopes');

    // ---- the profile ends UNLOCKED and items round-trip IDENTICAL live ----
    assert.equal(fx.store.isUnlocked(), true, 'the rotation ends unlocked (DD3/DD6)');
    assert.deepEqual(fx.store.listItems('global'), itemsBefore.global, 'global items identical');
    assert.deepEqual(fx.store.listItems('work'), itemsBefore.work, 'work items identical');
    assert.deepEqual(fx.store.listItems('personal'), itemsBefore.personal, 'personal items identical');

    // ---- manager on disk: v2, NO admin fields, kdf unchanged ----
    const manager = readManager(dir);
    assert.equal(manager.version, 2, 'the rotation is the first v2 writer (v1 → v2 transition)');
    assert.equal(manager.mrk.admin, undefined, 'no admin seal');
    assert.equal(manager.adminPublicKeyB64, undefined, 'no admin public key');
    assert.deepEqual(manager.kdf, FAST_SCRYPT, 'manager.kdf preserved — never swapped for a constant');

    // ---- every .gfvault: exactly one (mrk) envelope, item ciphertext byte-different ----
    for (const id of ['global', 'work', 'personal']) {
      const newDoc = readVaultDoc(dir, id);
      assert.deepEqual(
        vc.listEnvelopeKeyIds(newDoc),
        ['mrk'],
        `${id}: exactly one envelope — access envelopes dropped`
      );
      const oldDoc = vc.parseVault(fx.oldBytes.get(`${id}.gfvault`));
      assert.notEqual(newDoc.items.ct, oldDoc.items.ct, `${id}: item ciphertext rotated (byte-different)`);
    }

    // ---- OLD credentials all fail against the LIVE profile ----
    const auth = (e) => e instanceof vs.VaultAuthError;
    let s = makeStore(dir);
    assert.throws(() => s.unlockWithRecovery(fx.oldRecovery), auth, 'old recovery key severed');
    s = makeStore(dir);
    assert.throws(
      () => s.unlockWithAdmin(fx.oldAdminPriv),
      (e) => e instanceof vs.VaultStateError && /no admin key provisioned/.test(e.message),
      'old admin key severed — the provision itself is gone'
    );
    s = makeStore(dir);
    assert.throws(() => s.openVaultWithAccessKey('work', fx.oldAccessSecret), auth, 'old access secret severed');
    s = makeStore(dir);
    await assert.rejects(s.unlock(OLD_MASTER), auth, 'old master password severed');

    // ---- raw-material replay (vault-crypto directly — no store API for these) ----
    for (const id of ['global', 'work', 'personal']) {
      const newDoc = readVaultDoc(dir, id);
      const env = newDoc.envelopes.find((e) => e.keyId === 'mrk');
      assert.throws(
        () => vc.unwrapVaultKey(env, fx.oldMrkBytes, mrkAad(newDoc.version)),
        auth,
        `${id}: the raw old MRK fails direct GCM against the new mrk envelope`
      );
    }
    assert.throws(
      () => vc.decryptItems(readVaultDoc(dir, 'work').items, fx.oldWorkKeyBytes),
      auth,
      'the raw old vault key fails direct GCM against the rotated items blob'
    );

    // ---- the SNAPSHOTTED old files still open with the old credentials (the
    // capture was valid) — but the live dir does not (asserted above) ----
    fs.mkdirSync(vaultsDir(dir2), { recursive: true });
    for (const [name, bytes] of fx.oldBytes) {
      fs.writeFileSync(path.join(vaultsDir(dir2), name), bytes);
    }
    const snap = makeStore(dir2);
    await snap.unlock(OLD_MASTER);
    assert.deepEqual(
      snap.listItems('work').map((i) => i.title),
      ['W-ITEM'],
      'snapshotted old files open with the old master — the sever is of the live profile'
    );
    snap.lockNow();
    const snapRec = makeStore(dir2);
    snapRec.unlockWithRecovery(fx.oldRecovery);
    assert.equal(snapRec.isUnlocked(), true, 'snapshotted old files open with the old recovery key');
    snapRec.lockNow();

    // ---- NEW credentials both open the live profile ----
    s = makeStore(dir);
    await s.unlock(NEW_MASTER);
    assert.deepEqual(s.listItems('personal'), itemsBefore.personal, 'new master opens; items survive a cold load');
    s.lockNow();
    s = makeStore(dir);
    s.unlockWithRecovery(out.recoveryKey);
    assert.equal(s.isUnlocked(), true, 'the returned one-time recovery key opens the profile');
    s.lockNow();
  } finally {
    rm(dir);
    rm(dir2);
  }
});

// ---------------------------------------------------------------------------
// AC4 — report correctness
// ---------------------------------------------------------------------------

test('report: no access envelopes anywhere → revoked.vaultIds is empty (admin still reported)', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: OLD_MASTER });
    store.saveItem('work', loginItem({ id: 'w1' }));
    const out = await rotateMaster(store);
    assert.deepEqual(out.revoked, { admin: true, vaultIds: [] }, 'no vault carried an access envelope');
  } finally {
    rm(dir);
  }
});

test('report: a GLOBAL-vault access key pins GLOBAL_ID in revoked.vaultIds (the Q1 vaultIds ruling)', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: OLD_MASTER });
    store.saveItem('global', loginItem({ id: 'g1' }));
    store.saveItem('work', loginItem({ id: 'w1' }));
    await store.mintAccessKey('global', { masterPassword: OLD_MASTER });
    await store.mintAccessKey('work', { masterPassword: OLD_MASTER });
    const out = await rotateMaster(store);
    assert.deepEqual(
      [...out.revoked.vaultIds].sort(),
      ['global', 'work'],
      'the global vault appears by its id — mintAccessKey accepts the global target'
    );
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// Out-of-sever-scope pins: previously exported bundles are NOT severed — by
// design (they carry their own envelopes/kdf/managerVersion; same class as the
// snapshotted-old-files assertion). Feeds CP5's threat-model bullet: compromise
// mode severs the LIVE PROFILE, not artifacts the operator already holds.
// ---------------------------------------------------------------------------

test('out-of-sever-scope: a bundle exported BEFORE the rotation still adopts onto a fresh profile with the OLD credentials and still imports into the rotated profile', async () => {
  const dir = tmpDir();
  const freshDir = tmpDir();
  try {
    const fx = await severFixture(dir);
    const bundle = fx.store.exportVault('work');

    await rotateMaster(fx.store);

    // (a) fresh-profile adopt with the OLD (pre-rotation) master — expected to work.
    const freshStore = makeStore(freshDir, { listJars: () => [] });
    const adopted = await freshStore.importVault(bundle, { secret: Buffer.from(OLD_MASTER), secretKind: 'master' });
    assert.equal(adopted.fresh, true, 'the pre-rotation bundle adopts onto a fresh profile');
    assert.deepEqual(
      freshStore.listItems('global').map((i) => i.title),
      ['W-ITEM'],
      'the adopted vault decrypts with material carried in the bundle itself'
    );

    // (b) import into the ROTATED profile (unlocked post-rotation): the bundle
    // opens with its own old secret and is re-keyed under the NEW MRK.
    const imported = await fx.store.importVault(bundle, {
      destinationTarget: 'work',
      secret: Buffer.from(OLD_MASTER),
      secretKind: 'master',
      overwrite: true
    });
    assert.equal(imported.vaultId, 'work');
    assert.deepEqual(
      fx.store.listItems('work').map((i) => i.title),
      ['W-ITEM'],
      'the bundle imports into the rotated profile'
    );
  } finally {
    rm(dir);
    rm(freshDir);
  }
});

// ---------------------------------------------------------------------------
// The registry∪disk union (design review Q3): corrupt / foreign / unregistered
// ---------------------------------------------------------------------------

test('a content-corrupt .gfvault fails the rotation cleanly PRE-COMMIT: disk byte-identical, gate/lock released, store usable, retry succeeds', async () => {
  const dir = tmpDir();
  try {
    const fx = await severFixture(dir);
    fs.writeFileSync(path.join(fx.vdir, 'rogue.gfvault'), 'not a vault document', 'utf8');
    const before = snapshot(fx.vdir);

    await assert.rejects(
      rotateMaster(fx.store),
      (e) => e instanceof vs.VaultFormatError,
      'an unparseable vault file is an integrity anomaly — surfaced, never skipped'
    );

    assertSnapshotUnchanged(fx.vdir, before, 'corrupt-vault failure');
    assert.equal(fx.store._rekeyInProgress, false, 'the gate is released');
    assert.equal(fx.store.saveItem('work', loginItem({ id: 'w1', title: 'Still writable' })).title, 'Still writable');
    fs.unlinkSync(path.join(fx.vdir, 'rogue.gfvault'));
    const out = await rotateMaster(fx.store);
    assert.equal(typeof out.recoveryKey, 'string', 'the rotation succeeds once the anomaly is removed');
  } finally {
    rm(dir);
  }
});

test('a foreign .gfvault (mrk envelope NOT under the old MRK) fails the rotation cleanly PRE-COMMIT', async () => {
  const dir = tmpDir();
  try {
    const fx = await severFixture(dir);
    // A well-formed vault wrapped under a DIFFERENT MRK — parseable, but its
    // mrk envelope cannot unwrap under this profile's old MRK.
    const foreignMrk = vc.newVaultKey();
    const foreignKey = vc.newVaultKey();
    const env = { keyId: 'mrk', type: 'mrk', ...vc.wrapVaultKey(foreignKey, foreignMrk, mrkAad(vc.VERSION)) };
    fs.writeFileSync(
      path.join(fx.vdir, 'foreign.gfvault'),
      vc.serializeVault({
        vaultId: 'foreign',
        kdf: FAST_SCRYPT,
        envelopes: [env],
        items: vc.encryptItems([], foreignKey)
      }),
      'utf8'
    );
    foreignMrk.fill(0);
    foreignKey.fill(0);
    const before = snapshot(fx.vdir);

    await assert.rejects(
      rotateMaster(fx.store),
      (e) => e instanceof vs.VaultAuthError,
      'an un-unwrappable vault during a security operation fails the rotation loudly'
    );

    assertSnapshotUnchanged(fx.vdir, before, 'foreign-vault failure');
    assert.equal(fx.store._rekeyInProgress, false, 'the gate is released');
    assert.equal(fx.store.saveItem('work', loginItem({ id: 'w1', title: 'Usable' })).title, 'Usable');
  } finally {
    rm(dir);
  }
});

test('UNION PIN: a .gfvault OUTSIDE the registry that unwraps under the old MRK is rotated like any other (registry drift never leaves a vault severed)', async () => {
  const dir = tmpDir();
  try {
    const fx = await severFixture(dir);
    // A vault file no jar names (registry drift) — wrapped under the REAL MRK.
    const ghostKey = vc.newVaultKey();
    const env = { keyId: 'mrk', type: 'mrk', ...vc.wrapVaultKey(ghostKey, fx.store.mrk, mrkAad(vc.VERSION)) };
    const ghostItems = [loginItem({ id: 'gh1', title: 'GHOST-ITEM', createdAt: 1, updatedAt: 1 })];
    fs.writeFileSync(
      path.join(fx.vdir, 'ghost.gfvault'),
      vc.serializeVault({
        vaultId: 'ghost',
        kdf: FAST_SCRYPT,
        envelopes: [env],
        items: vc.encryptItems(ghostItems, ghostKey)
      }),
      'utf8'
    );
    const ghostCtBefore = readVaultDoc(dir, 'ghost').items.ct;

    await rotateMaster(fx.store);

    // The unregistered vault was re-keyed: old MRK fails its NEW envelope...
    const newDoc = readVaultDoc(dir, 'ghost');
    assert.notEqual(newDoc.items.ct, ghostCtBefore, 'ghost item ciphertext rotated');
    assert.throws(
      () => vc.unwrapVaultKey(newDoc.envelopes[0], fx.oldMrkBytes, mrkAad(newDoc.version)),
      (e) => e instanceof vs.VaultAuthError,
      'the old MRK no longer opens the drifted vault'
    );
    // ...and the ghost key itself was rotated (the captured key fails the new blob)...
    assert.throws(
      () => vc.decryptItems(newDoc.items, ghostKey),
      (e) => e instanceof vs.VaultAuthError,
      'the pre-rotation ghost vault key is severed'
    );
    ghostKey.fill(0);
    // ...while the NEW MRK round-trips its items (registered as a jar here so
    // the store API can address it).
    const s = makeStore(dir, { listJars: () => [...JARS, { id: 'ghost' }] });
    await s.unlock(NEW_MASTER);
    assert.deepEqual(
      s.listItems('ghost').map((i) => i.title),
      ['GHOST-ITEM'],
      'the drifted vault opens under the new profile — not severed'
    );
    s.lockNow();
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// Double-rotate + already-v2 (v1 → v2 covered in FULL SEVER)
// ---------------------------------------------------------------------------

test('double-rotate: a second compromiseRotate queued on the manager lock runs post-release against the NEW profile; a fresh-credential rotate of the (already-v2, no-admin) profile succeeds', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: OLD_MASTER });
    store.saveItem('work', loginItem({ id: 'w1', title: 'Kept' }));

    // Queue BOTH on the manager lock without awaiting between them: the first
    // rotates; the second runs after release, where the OLD credential now
    // fails the step-up against the rotated manager.
    const first = rotateMaster(store, { newMaster: 'first new master' });
    const second = rotateMaster(store, { newMaster: 'second new master' });
    const out1 = await withTimeout(first, 'the first queued rotation');
    await assert.rejects(
      withTimeout(second, 'the second queued rotation'),
      (e) => e instanceof vs.VaultAuthError,
      'the old credential fails against the already-rotated profile'
    );

    // The failed attempt wrote nothing: the FIRST rotation's credentials are live
    // and the dir carries no transaction residue.
    assert.deepEqual(
      fs.readdirSync(vaultsDir(dir)).sort(),
      ['global.gfvault', 'manager.json', 'work.gfvault'],
      'no journal/staged residue from the refused second attempt'
    );
    let s = makeStore(dir);
    await s.unlock('first new master');
    assert.deepEqual(
      s.listItems('work').map((i) => i.title),
      ['Kept']
    );
    s.lockNow();
    s = makeStore(dir);
    s.unlockWithRecovery(out1.recoveryKey);
    assert.equal(s.isUnlocked(), true);
    s.lockNow();

    // A fresh-credential second rotate on the now-v2 no-admin profile succeeds:
    // idempotent shape — still v2, admin stays absent, revoked.admin false.
    const out2 = await store.compromiseRotate({
      oldMasterPassword: Buffer.from('first new master'),
      newMasterPassword: Buffer.from('second new master')
    });
    assert.equal(out2.revoked.admin, false, 'a previously rotated profile has no admin pair to revoke');
    const manager = readManager(dir);
    assert.equal(manager.version, 2, 'still v2');
    assert.equal(manager.mrk.admin, undefined, 'admin stays absent');
    assert.equal(manager.adminPublicKeyB64, undefined, 'admin pubkey stays absent');
    s = makeStore(dir);
    await s.unlock('second new master');
    assert.deepEqual(
      s.listItems('work').map((i) => i.title),
      ['Kept']
    );
    s.lockNow();
  } finally {
    rm(dir);
  }
});

test('minimal profile: rotation with ZERO jar vaults (global only) succeeds', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir, { listJars: () => [] });
    await store.setup({ masterPassword: OLD_MASTER });
    const out = await rotateMaster(store);
    assert.deepEqual(out.revoked, { admin: true, vaultIds: [] });
    assert.deepEqual(fs.readdirSync(vaultsDir(dir)).sort(), ['global.gfvault', 'manager.json']);
    const s = makeStore(dir, { listJars: () => [] });
    await s.unlock(NEW_MASTER);
    assert.equal(s.isUnlocked(), true);
    s.lockNow();
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// AC2 — R7 both branches + wrong credentials + malformed display
// ---------------------------------------------------------------------------

test('R7 master branch: new password byte-equal to old → VaultPasswordReuseError BEFORE any scrypt/write; disk byte-identical (Buffer and string forms)', async () => {
  const dir = tmpDir();
  try {
    const fx = await severFixture(dir);
    const reuse = (e) => e instanceof vs.VaultPasswordReuseError;
    await assert.rejects(rotateMaster(fx.store, { newMaster: OLD_MASTER }), reuse, 'Buffer/Buffer reuse refused');
    await assert.rejects(
      fx.store.compromiseRotate({ oldMasterPassword: OLD_MASTER, newMasterPassword: Buffer.from(OLD_MASTER) }),
      reuse,
      'string/Buffer reuse refused (byte-equality, not identity)'
    );
    assertSnapshotUnchanged(fx.vdir, fx.oldBytes, 'master-branch reuse refusal');
    // Discriminable from wrong-credential failures (the leg-4 mapping contract).
    assert.ok(!(new vs.VaultPasswordReuseError('x') instanceof vs.VaultAuthError));
  } finally {
    rm(dir);
  }
});

test('R7 recovery branch: reuse detected via the test-unwrap (an unwrap SUCCESS is the reuse) → VaultPasswordReuseError, disk byte-identical', async () => {
  const dir = tmpDir();
  try {
    const fx = await severFixture(dir);
    await assert.rejects(
      fx.store.compromiseRotate({ recoveryKey: fx.oldRecovery, newMasterPassword: Buffer.from(OLD_MASTER) }),
      (e) => e instanceof vs.VaultPasswordReuseError,
      'the candidate unwrapped the old master envelope — reuse'
    );
    assertSnapshotUnchanged(fx.vdir, fx.oldBytes, 'recovery-branch reuse refusal');
  } finally {
    rm(dir);
  }
});

test('R7 recovery branch GOOD case: a distinct new password passes the test-unwrap swallow and the rotation succeeds from the recovery credential', async () => {
  const dir = tmpDir();
  try {
    const fx = await severFixture(dir);
    fx.store.lockNow(); // the recovery branch must work from locked too.
    const out = await fx.store.compromiseRotate({
      recoveryKey: fx.oldRecovery,
      newMasterPassword: Buffer.from(NEW_MASTER)
    });
    assert.equal(fx.store.isUnlocked(), true, 'ends unlocked');
    assert.deepEqual(out.revoked.vaultIds, ['work']);
    const s = makeStore(dir);
    await s.unlock(NEW_MASTER);
    assert.deepEqual(
      s.listItems('work').map((i) => i.title),
      ['W-ITEM']
    );
    s.lockNow();
    const s2 = makeStore(dir);
    assert.throws(
      () => s2.unlockWithRecovery(fx.oldRecovery),
      (e) => e instanceof vs.VaultAuthError,
      'the recovery key that authorized the rotation is itself severed'
    );
  } finally {
    rm(dir);
  }
});

test('wrong credentials: a wrong old master and a wrong recovery key each throw VaultAuthError and leave the disk byte-identical', async () => {
  const dir = tmpDir();
  try {
    const fx = await severFixture(dir);
    const auth = (e) => e instanceof vs.VaultAuthError;
    await assert.rejects(rotateMaster(fx.store, { oldMaster: 'not the master' }), auth, 'wrong old master');
    const wrong = vc.generateRecoveryKey(); // valid shape, wrong bytes.
    await assert.rejects(
      fx.store.compromiseRotate({ recoveryKey: wrong.display, newMasterPassword: Buffer.from(NEW_MASTER) }),
      auth,
      'wrong recovery key'
    );
    wrong.material.fill(0);
    assertSnapshotUnchanged(fx.vdir, fx.oldBytes, 'wrong-credential refusals');
    assert.equal(fx.store._rekeyInProgress, false, 'no gate left raised');
  } finally {
    rm(dir);
  }
});

test('a malformed recovery display throws VaultFormatError from parseRecoveryKey — NOT VaultAuthError (the leg-4 error-mapping pin)', async () => {
  const dir = tmpDir();
  try {
    const fx = await severFixture(dir);
    await assert.rejects(
      fx.store.compromiseRotate({
        recoveryKey: 'definitely !!not!! base32',
        newMasterPassword: Buffer.from(NEW_MASTER)
      }),
      (e) => e instanceof vs.VaultFormatError && !(e instanceof vs.VaultAuthError),
      'malformed display is a format failure, distinct from wrong-credential'
    );
    assertSnapshotUnchanged(fx.vdir, fx.oldBytes, 'malformed-display refusal');
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// AC4 — busy / exclusivity
// ---------------------------------------------------------------------------

test("busy: gated ops during the rotation's gate window throw VaultBusyError; they work again after the rotation completes", async () => {
  const dir = tmpDir();
  const realWrapMaster = vc.wrapMaster;
  try {
    const fx = await severFixture(dir);

    // Park the rotation INSIDE its gate window: wrapMaster (the new master
    // envelope build) runs strictly after the gate is raised, so a deferred
    // there holds the window open deterministically (the shared-singleton
    // monkeypatch idiom).
    let releaseWrap;
    const parked = new Promise((resolve) => {
      releaseWrap = resolve;
    });
    vc.wrapMaster = async (...args) => {
      await parked;
      return realWrapMaster(...args);
    };

    const rotation = rotateMaster(fx.store);
    rotation.catch(() => {}); // settled below — never unhandled.
    await until(() => fx.store._rekeyInProgress, 'the rotation to raise the gate');

    const busy = (e) => e instanceof vs.VaultBusyError;
    assert.throws(() => fx.store.saveItem('work', loginItem()), busy, 'saveItem refused mid-rotation');
    assert.throws(() => fx.store.exportVault('work'), busy, 'exportVault refused mid-rotation');
    assert.throws(() => fx.store.deleteVault('work'), busy, 'deleteVault refused mid-rotation');

    releaseWrap();
    const out = await withTimeout(rotation, 'the parked rotation');
    assert.equal(typeof out.recoveryKey, 'string');
    assert.equal(fx.store._rekeyInProgress, false, 'gate released after commit');
    assert.equal(fx.store.saveItem('work', loginItem({ id: 'w1', title: 'After' })).title, 'After');
  } finally {
    vc.wrapMaster = realWrapMaster;
    rm(dir);
  }
});

test('busy: a rotation on a store whose re-key gate is already raised fails with VaultBusyError from _acquireRekeyGate, writing nothing', async () => {
  const dir = tmpDir();
  try {
    const fx = await severFixture(dir);
    const release = await withTimeout(fx.store._acquireRekeyGate(), 'manual gate acquire');
    await assert.rejects(
      rotateMaster(fx.store),
      (e) => e instanceof vs.VaultBusyError,
      'only one rotation at a time — never a queue'
    );
    assertSnapshotUnchanged(fx.vdir, fx.oldBytes, 'busy refusal');
    release();
    const out = await rotateMaster(fx.store);
    assert.equal(typeof out.recoveryKey, 'string', 'the rotation succeeds once the gate is lowered');
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// AC3 — the INTERRUPTION matrix (criterion 2, op-level). The op's
// committed-flag failure discrimination makes its outcome the truth about the
// disk: REJECTED ⇔ entirely old (byte-identical, rolled back in-op), RESOLVED
// ⇔ entirely new (new credentials live). Kill points are the leg-2 syscall
// families across the rotation's whole write sequence.
// ---------------------------------------------------------------------------

class InducedCrash extends Error {}

const KILL_EXPECTED_FILES = ['global.gfvault', 'manager.json', 'work.gfvault'];

async function killFixture(dir) {
  const store = makeStore(dir, { listJars: () => [{ id: 'work' }] });
  await store.setup({ masterPassword: OLD_MASTER });
  store.saveItem('global', loginItem({ id: 'g1', title: 'G-ITEM' }));
  store.saveItem('work', loginItem({ id: 'w1', title: 'W-ITEM' }));
  return { store, vdir: vaultsDir(dir), oldBytes: snapshot(vaultsDir(dir)) };
}

/** Count how many times `syscall` fires during the async `fn` (no fault). */
async function countCallsAsync(syscall, fn) {
  const original = fs[syscall];
  let calls = 0;
  fs[syscall] = (...args) => {
    calls += 1;
    return original.apply(fs, args);
  };
  try {
    await fn();
  } finally {
    fs[syscall] = original;
  }
  return calls;
}

/**
 * Run async `fn` with `syscall` throwing InducedCrash on its Nth call.
 * Best-effort sites (dir fsync) swallow the fault — then `fn` resolves and
 * `crashed` is false while the fault still fired. The committed-branch
 * discrimination can ALSO resolve `fn` after a genuine post-discriminator
 * fault — the resolved-value assertions below are what pin that.
 */
async function withCrashAtAsync(syscall, n, fn) {
  const original = fs[syscall];
  let calls = 0;
  fs[syscall] = (...args) => {
    calls += 1;
    if (calls === n) throw new InducedCrash(`induced ${syscall} crash at call #${n}`);
    return original.apply(fs, args);
  };
  try {
    const value = await fn();
    return { crashed: false, value };
  } catch (err) {
    if (!(err instanceof InducedCrash)) throw err;
    return { crashed: true, value: undefined };
  } finally {
    fs[syscall] = original;
  }
}

/**
 * The AC3 core assertion. Rejected op ⇒ the disk is BYTE-IDENTICAL to the
 * pre-rotation snapshot (rolled back in-op) and the old master opens a fresh
 * load. Resolved op ⇒ the disk is ENTIRELY NEW (v2 manager, every vault
 * ciphertext rotated) and the new master + returned recovery key open a fresh
 * load while the old master fails. Either way: no journal/staged/temp residue
 * and the live store's lock/gate are released.
 */
async function assertKillOutcome(dir, fx, outcome, label) {
  assert.deepEqual(fs.readdirSync(fx.vdir).sort(), KILL_EXPECTED_FILES, `${label}: no journal/staged/temp residue`);
  assert.equal(fx.store._rekeyInProgress, false, `${label}: gate released`);
  assert.equal(fx.store._inFlightOps, 0, `${label}: counter drained`);
  if (outcome.crashed) {
    assertSnapshotUnchanged(fx.vdir, fx.oldBytes, `${label}: entirely OLD`);
    const s = makeStore(dir, { listJars: () => [{ id: 'work' }] });
    await s.unlock(OLD_MASTER);
    assert.deepEqual(
      s.listItems('work').map((i) => i.title),
      ['W-ITEM'],
      `${label}: old credentials open`
    );
    s.lockNow();
    return false;
  }
  const manager = readManager(dir);
  assert.equal(manager.version, 2, `${label}: the rotated v2 manager landed`);
  for (const name of ['global.gfvault', 'work.gfvault']) {
    assert.ok(!snapshot(fx.vdir).get(name).equals(fx.oldBytes.get(name)), `${label}: ${name} rotated — entirely NEW`);
  }
  assert.equal(fx.store.isUnlocked(), true, `${label}: the live store ends unlocked on the success path`);
  let s = makeStore(dir, { listJars: () => [{ id: 'work' }] });
  await s.unlock(NEW_MASTER);
  assert.deepEqual(
    s.listItems('work').map((i) => i.title),
    ['W-ITEM'],
    `${label}: new master opens, items intact`
  );
  s.lockNow();
  s = makeStore(dir, { listJars: () => [{ id: 'work' }] });
  await assert.rejects(s.unlock(OLD_MASTER), (e) => e instanceof vs.VaultAuthError, `${label}: old master severed`);
  s = makeStore(dir, { listJars: () => [{ id: 'work' }] });
  s.unlockWithRecovery(outcome.value.recoveryKey);
  assert.equal(s.isUnlocked(), true, `${label}: the returned one-time recovery key is live — never lost`);
  s.lockNow();
  return true;
}

for (const syscall of ['renameSync', 'writeSync', 'fsyncSync', 'unlinkSync']) {
  test(`interruption matrix: ${syscall} throwing at every Nth call across the rotation — the op's outcome always matches the disk (AC3)`, async () => {
    // Dry run to enumerate this syscall's kill points inside the rotation.
    const dryDir = tmpDir();
    let total;
    try {
      const dry = await killFixture(dryDir);
      total = await countCallsAsync(syscall, () => rotateMaster(dry.store));
    } finally {
      rm(dryDir);
    }
    assert.ok(total > 0, `${syscall} participates in the rotation's write sequence`);

    let sawOld = false;
    let sawNew = false;
    for (let n = 1; n <= total; n++) {
      const dir = tmpDir();
      try {
        const fx = await killFixture(dir);
        const outcome = await withCrashAtAsync(syscall, n, () => rotateMaster(fx.store));
        const isNew = await assertKillOutcome(dir, fx, outcome, `${syscall} #${n}/${total}`);
        if (isNew) sawNew = true;
        else sawOld = true;
      } finally {
        rm(dir);
      }
    }

    // Commit-discriminator sanity per family (mirrors the leg-2 matrix): rename
    // and fsync kills straddle the commit point; every writeSync kill is
    // pre-commit; the sole unlinkSync (journal removal) is post-discriminator —
    // where the op RETURNS SUCCESS rather than crashing (the review HIGH).
    if (syscall === 'renameSync' || syscall === 'fsyncSync') {
      assert.ok(sawOld && sawNew, `${syscall} matrix exercises both rollback and roll-forward`);
    } else if (syscall === 'writeSync') {
      assert.ok(sawOld && !sawNew, 'every writeSync kill point is pre-commit — entirely old only');
    } else {
      assert.ok(sawNew && !sawOld, 'the unlinkSync kill point is post-discriminator — success only');
    }
  });
}

test('POST-DISCRIMINATOR PIN (design-review HIGH): an in-process throw at the FIRST final rename — after the commit rename — still returns SUCCESS with the new credentials live', async () => {
  const dir = tmpDir();
  const originalRename = fs.renameSync;
  try {
    const fx = await killFixture(dir);
    // Semantic (not positional) kill point: the first rename whose SOURCE is a
    // staged member — begin's writeFileAtomic renames end at staged names but
    // START at `.tmp-` names, so this fires exactly at the first final rename,
    // strictly after the journal-state discriminator rename.
    let thrown = false;
    fs.renameSync = (src, dest) => {
      if (!thrown && /\.stage-[0-9a-f]{12}$/.test(String(src))) {
        thrown = true;
        throw new InducedCrash('induced crash at the first final rename');
      }
      return originalRename.call(fs, src, dest);
    };
    let out;
    try {
      out = await rotateMaster(fx.store);
    } finally {
      fs.renameSync = originalRename;
    }
    assert.equal(thrown, true, 'the kill point fired');
    // The op reported SUCCESS — never "nothing changed" over a rotated disk —
    // and finished the roll-forward itself.
    const isNew = await assertKillOutcome(dir, fx, { crashed: false, value: out }, 'post-discriminator rename');
    assert.equal(isNew, true);
  } finally {
    fs.renameSync = originalRename;
    rm(dir);
  }
});

test('committed-journal residue: journal removal failing even during in-op recovery → op still returns SUCCESS; the next load rolls forward as a no-op and removes the journal', async () => {
  const dir = tmpDir();
  const originalUnlink = fs.unlinkSync;
  try {
    const fx = await killFixture(dir);
    // Journal removal fails PERSISTENTLY during the op (commit's unlink AND the
    // committed-branch recovery's unlink): the one state a throw-once cannot
    // produce — the committed journal survives the op.
    fs.unlinkSync = () => {
      throw new InducedCrash('unlink disabled for the whole op');
    };
    let out;
    try {
      out = await rotateMaster(fx.store);
    } finally {
      fs.unlinkSync = originalUnlink;
    }
    assert.equal(typeof out.recoveryKey, 'string', 'the durably committed rotation reports success');
    assert.equal(fx.store.isUnlocked(), true, 'new credentials live immediately');
    const journals = fs.readdirSync(fx.vdir).filter((n) => /^txn-[0-9a-f]{12}\.journal\.committed$/.test(n));
    assert.equal(journals.length, 1, 'the committed journal survived the op');

    // Next load: constructor recovery rolls forward as an ENOENT-tolerant no-op
    // and removes the journal; the new credentials open.
    const s = makeStore(dir, { listJars: () => [{ id: 'work' }] });
    assert.deepEqual(fs.readdirSync(fx.vdir).sort(), KILL_EXPECTED_FILES, 'the journal is gone after the next load');
    await s.unlock(NEW_MASTER);
    assert.deepEqual(
      s.listItems('work').map((i) => i.title),
      ['W-ITEM']
    );
    s.lockNow();
  } finally {
    fs.unlinkSync = originalUnlink;
    rm(dir);
  }
});

test('in-process PRE-COMMIT failure leaves a fully usable store: disk untouched, no residue, lock+gate released, mutations and a retry rotation succeed', async () => {
  const dir = tmpDir();
  try {
    const fx = await killFixture(dir);
    // writeSync #2 = the first STAGED member write (after the journal write) —
    // an in-process pre-commit failure with the journal already on disk.
    const outcome = await withCrashAtAsync('writeSync', 2, () => rotateMaster(fx.store));
    assert.equal(outcome.crashed, true, 'the pre-commit fault rejects the op');
    assertSnapshotUnchanged(fx.vdir, fx.oldBytes, 'pre-commit failure');
    assert.deepEqual(fs.readdirSync(fx.vdir).sort(), KILL_EXPECTED_FILES, 'no journal/staged residue');
    assert.equal(fx.store._rekeyInProgress, false, 'gate released');
    assert.equal(fx.store._inFlightOps, 0, 'counter drained');
    // The SAME store instance keeps working: gated mutation + a clean retry.
    assert.equal(fx.store.saveItem('work', loginItem({ id: 'w1', title: 'Post-fault' })).title, 'Post-fault');
    const out = await rotateMaster(fx.store);
    assert.equal(typeof out.recoveryKey, 'string', 'the retry rotation succeeds');
    const s = makeStore(dir, { listJars: () => [{ id: 'work' }] });
    await s.unlock(NEW_MASTER);
    assert.deepEqual(
      s.listItems('work').map((i) => i.title),
      ['Post-fault']
    );
    s.lockNow();
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// AC4 — the lock-state matrix (store half): both entry states end UNLOCKED
// with onUnlock fired (the DD3/DD6 lifecycle rule).
// ---------------------------------------------------------------------------

test('lock-state matrix: the rotation succeeds from a LOCKED store (never unlocked this session) and ends unlocked with onUnlock fired', async () => {
  const dir = tmpDir();
  try {
    const seed = makeStore(dir);
    await seed.setup({ masterPassword: OLD_MASTER });
    seed.saveItem('work', loginItem({ id: 'w1', title: 'Kept' }));
    seed.lockNow();

    let unlocks = 0;
    const store = makeStore(dir, { onUnlock: () => unlocks++ });
    assert.equal(store.isUnlocked(), false, 'never unlocked this session');
    const out = await rotateMaster(store);
    assert.equal(typeof out.recoveryKey, 'string');
    assert.equal(store.isUnlocked(), true, 'ends unlocked from a locked entry state');
    assert.equal(unlocks, 1, 'onUnlock fired exactly once (the post-commit install)');
    assert.deepEqual(
      store.listItems('work').map((i) => i.title),
      ['Kept'],
      'immediately readable — no re-unlock step'
    );
  } finally {
    rm(dir);
  }
});

test('lock-state matrix: the rotation succeeds from an UNLOCKED store and ends unlocked with onUnlock fired', async () => {
  const dir = tmpDir();
  try {
    let unlocks = 0;
    const store = makeStore(dir, { onUnlock: () => unlocks++ });
    await store.setup({ masterPassword: OLD_MASTER }); // setup installs directly — no onUnlock.
    store.saveItem('work', loginItem({ id: 'w1', title: 'Kept' }));
    assert.equal(store.isUnlocked(), true);
    assert.equal(unlocks, 0, 'baseline: nothing fired yet');
    await rotateMaster(store);
    assert.equal(store.isUnlocked(), true, 'ends unlocked from an unlocked entry state');
    assert.equal(unlocks, 1, 'onUnlock fired exactly once');
    assert.deepEqual(
      store.listItems('work').map((i) => i.title),
      ['Kept']
    );
  } finally {
    rm(dir);
  }
});
