'use strict';

// Unit tests for MANAGER FORMAT v2 — optional admin provision (M18 F2 Leg 1;
// flight DD1/DD7). Covers the leg's AC2–AC5 matrix:
//   - AC2: a hand-constructed v2 manager (fixtures wrap envelopes at AAD version 2
//     via vault-crypto DIRECTLY — no store writer emits v2 yet) unlocks by master /
//     recovery / (when provisioned) admin; absence yields the ruled, discriminable
//     VaultStateError('no admin key provisioned') and adminPublicKey() === null.
//   - AC3: lone admin field (v2) / absent pair (v1) / unknown-or-non-numeric manager
//     version → VaultFormatError; bundle managerVersion outside {absent, 1, 2} →
//     import error.
//   - AC3b: a mixed-version document (version:2 doc, master envelope AAD-wrapped at
//     1) fails unlock LOUDLY (VaultAuthError) — never opens, never repairs (the
//     vault-store.test.js:743 AAD-tamper pattern, at the manager layer).
//   - AC4: every single-slot rotation preserves the document's version (v2 stays v2,
//     v1 stays v1) with AAD-homogeneous envelopes; rotateAdminKey doubles as the
//     from-scratch provision on a no-admin v2 manager.
//   - AC5: export from a no-admin v2 manager omits the admin fields and stamps
//     managerVersion:2; the bundle fresh-adopts (on-disk version === the bundle's
//     managerVersion; every mrk slot unwraps at the doc version — homogeneity) and
//     existing-profile-imports; a with-admin v2 bundle adopts with the admin pair
//     riding at version 2; a pre-change v1 bundle (no managerVersion) still imports
//     both ways.
//
// Electron-free: real temp dirs + FAST scrypt + on-disk probes (the
// vault-key-rotation.test.js idioms).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');
const vc = require('../../src/main/vault/vault-crypto');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';
const DEST_MASTER = 'a different destination master';
const JARS = [{ id: 'work' }, { id: 'personal' }];

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vault-mgr-v2-'));
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
function vaultPath(dir, id) {
  return path.join(dir, 'vaults', `${id}.gfvault`);
}
function managerPath(dir) {
  return path.join(dir, 'vaults', 'manager.json');
}
function readManager(dir) {
  return JSON.parse(fs.readFileSync(managerPath(dir), 'utf8'));
}
// The store's (unexported) mrk-envelope AAD for a `.gfvault` document — bound to the
// GFVAULT doc version (a separate version space from the manager's).
function gfvaultMrkAad() {
  return Buffer.from(`gfvault/mrk-env/v${vc.VERSION}`, 'utf8');
}
// The ruled no-admin refusal: a VaultStateError carrying EXACTLY this message —
// discriminable by the flow-wiring leg's Settings state; explicitly NOT a
// VaultFormatError (absence is a deliberate state) and NOT a GCM VaultAuthError.
function isNoAdminError(e) {
  return (
    e instanceof vs.VaultStateError &&
    !(e instanceof vs.VaultFormatError) &&
    !(e instanceof vs.VaultAuthError) &&
    e.message === 'no admin key provisioned'
  );
}
// Simulate the on-disk bundle file round-trip (export serializes to a file; import
// JSON.parses it back).
function roundTrip(bundle) {
  return JSON.parse(JSON.stringify(bundle));
}

/**
 * Hand-construct a manager document + seeded global vault ON DISK via vault-crypto
 * directly — NEVER a store writer (no store op emits v2 in this leg). Envelopes are
 * wrapped at the DOCUMENT'S version (AAD homogeneity), except when a test injects a
 * deliberate mismatch via `masterAadVersion`.
 */
async function writeManagerFixture(dir, { version, withAdmin, masterAadVersion } = {}) {
  const mrk = vc.newVaultKey();
  const recovery = vc.generateRecoveryKey();
  const masterEnv = await vc.wrapMaster(mrk, MASTER, {
    version: masterAadVersion ?? version,
    params: FAST_SCRYPT
  });
  const recoveryEnv = vc.wrapRecovery(mrk, recovery.material, { version });
  recovery.material.fill(0);
  const manager = {
    format: 'gfmanager',
    version,
    kdf: FAST_SCRYPT,
    mrk: { master: masterEnv, recovery: recoveryEnv }
  };
  let admin = null;
  if (withAdmin) {
    admin = vc.generateAdminKeypair();
    manager.mrk.admin = vc.sealToAdmin(mrk, admin.publicKey, { version });
    manager.adminPublicKeyB64 = admin.publicKeyB64;
  }
  fs.mkdirSync(path.join(dir, 'vaults'), { recursive: true });
  fs.writeFileSync(managerPath(dir), JSON.stringify(manager), 'utf8');

  // Seed a global vault under the same MRK (the .gfvault version space is untouched
  // by this leg — its mrk envelope stays bound to the gfvault doc version).
  const vaultKey = vc.newVaultKey();
  const mrkEnv = { keyId: 'mrk', type: 'mrk', ...vc.wrapVaultKey(vaultKey, mrk, gfvaultMrkAad()) };
  const items = [
    {
      id: 'seed1',
      type: 'login',
      title: 'Example',
      username: 'user@example.com',
      password: 'hunter2',
      origin: 'https://example.com',
      createdAt: 1,
      updatedAt: 1
    }
  ];
  fs.writeFileSync(
    vaultPath(dir, 'global'),
    vc.serializeVault({
      vaultId: 'global',
      kdf: FAST_SCRYPT,
      envelopes: [mrkEnv],
      items: vc.encryptItems(items, vaultKey)
    }),
    'utf8'
  );
  mrk.fill(0);
  vaultKey.fill(0);
  return { recoveryDisplay: recovery.display, admin };
}

// ---------------------------------------------------------------------------
// AC2 — v2 read + unlock paths, admin present and absent
// ---------------------------------------------------------------------------

test('AC2: a v2 WITH-admin manager unlocks by master, by recovery, and by admin; items readable', async () => {
  const dir = tmpDir();
  try {
    const fx = await writeManagerFixture(dir, { version: 2, withAdmin: true });
    const store = makeStore(dir); // load-loudly accepts the v2 document.
    assert.equal(store.isSetUp(), true);

    await store.unlock(MASTER);
    assert.equal(store.isUnlocked(), true, 'master unlocks a v2 manager');
    assert.equal(store.listItems('global')[0].password, 'hunter2', 'the seeded item decrypts');

    store.lockNow();
    store.unlockWithRecovery(fx.recoveryDisplay);
    assert.equal(store.isUnlocked(), true, 'recovery unlocks a v2 manager');

    store.lockNow();
    store.unlockWithAdmin(fx.admin.privateKeyB64);
    assert.equal(store.isUnlocked(), true, 'admin unlocks a v2 with-admin manager');

    assert.equal(store.adminPublicKey(), fx.admin.publicKeyB64);

    // openAllWithAdminKey opens the seeded global vault too (stateless path).
    const opened = store.openAllWithAdminKey(fx.admin.privateKeyB64);
    assert.ok(opened.has('global'));
    for (const k of opened.values()) k.fill(0);
  } finally {
    rm(dir);
  }
});

test('AC2: a v2 NO-admin manager unlocks by master + recovery; admin paths fail with the exact ruled VaultStateError; adminPublicKey() is null (coerced)', async () => {
  const dir = tmpDir();
  try {
    const fx = await writeManagerFixture(dir, { version: 2, withAdmin: false });
    const store = makeStore(dir); // absence is a DELIBERATE state — load accepts it.

    await store.unlock(MASTER);
    assert.equal(store.isUnlocked(), true, 'master unlocks a no-admin v2 manager');
    assert.equal(store.listItems('global')[0].password, 'hunter2');

    store.lockNow();
    store.unlockWithRecovery(fx.recoveryDisplay);
    assert.equal(store.isUnlocked(), true, 'recovery unlocks a no-admin v2 manager');

    // The ruled, discriminable no-admin refusal — NOT VaultFormatError, NOT a GCM error.
    const someAdminPriv = vc.generateAdminKeypair().privateKeyB64;
    assert.throws(() => store.unlockWithAdmin(someAdminPriv), isNoAdminError);
    assert.throws(() => store.openAllWithAdminKey(someAdminPriv), isNoAdminError);
    assert.equal(store.isUnlocked(), true, 'the no-admin refusal never disturbs lock state');

    // null, COERCED — the raw doc field would read back undefined.
    assert.equal(store.adminPublicKey(), null);
    assert.notEqual(store.adminPublicKey(), undefined);
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// AC3 — malformed-present, v1 rules unchanged, unknown versions
// ---------------------------------------------------------------------------

test('AC3: a LONE admin field on v2 (either one) is malformed-present → VaultFormatError at read', async () => {
  for (const lone of ['seal-only', 'pub-only']) {
    const dir = tmpDir();
    try {
      const withAdminDir = tmpDir();
      try {
        // Build a well-formed with-admin v2 doc, then strip exactly one pair member.
        await writeManagerFixture(withAdminDir, { version: 2, withAdmin: true });
        const doc = readManager(withAdminDir);
        if (lone === 'seal-only') delete doc.adminPublicKeyB64;
        else delete doc.mrk.admin;
        fs.mkdirSync(path.join(dir, 'vaults'), { recursive: true });
        fs.writeFileSync(managerPath(dir), JSON.stringify(doc), 'utf8');

        assert.throws(
          () => makeStore(dir),
          (e) => e instanceof vs.VaultFormatError && /together/.test(e.message),
          `${lone}: a lone admin field is malformed-present`
        );
        // Load-loudly: the file is untouched (never quarantined/repaired).
        assert.deepEqual(readManager(dir), doc);
      } finally {
        rm(withAdminDir);
      }
    } finally {
      rm(dir);
    }
  }
});

test('AC3: an ABSENT admin pair on v1 is still malformed (v1 rules unchanged) → VaultFormatError', async () => {
  const dir = tmpDir();
  try {
    await writeManagerFixture(dir, { version: 1, withAdmin: false });
    assert.throws(
      () => makeStore(dir),
      (e) => e instanceof vs.VaultFormatError
    );
  } finally {
    rm(dir);
  }
});

test('AC3: manager version 3 / non-numeric → VaultFormatError at read', async () => {
  for (const version of [3, '2', null]) {
    const dir = tmpDir();
    try {
      await writeManagerFixture(dir, { version: 2, withAdmin: true });
      const doc = readManager(dir);
      doc.version = version;
      fs.writeFileSync(managerPath(dir), JSON.stringify(doc), 'utf8');
      assert.throws(
        () => makeStore(dir),
        (e) => e instanceof vs.VaultFormatError && /unsupported version/.test(e.message),
        `version ${JSON.stringify(version)} is refused`
      );
    } finally {
      rm(dir);
    }
  }
});

test('AC3: bundle managerVersion outside {absent, 1, 2} → import error; a lone bundle admin field → import error', async () => {
  const srcDir = tmpDir();
  const destDir = tmpDir();
  try {
    const srcStore = makeStore(srcDir);
    await srcStore.setup({ masterPassword: MASTER });
    srcStore.saveItem('global', { type: 'login', title: 'X', username: 'u', password: 'hunter2' });
    const goodBundle = roundTrip(srcStore.exportVault('global'));

    const store = makeStore(destDir);
    await store.setup({ masterPassword: DEST_MASTER });

    const importIt = (bundle) =>
      store.importVault(bundle, {
        destinationTarget: 'work',
        secret: Buffer.from(MASTER, 'utf8'),
        secretKind: 'master'
      });

    for (const bad of [3, '1', 0]) {
      const bundle = roundTrip(goodBundle);
      bundle.managerVersion = bad;
      await assert.rejects(
        () => importIt(bundle),
        (e) => e instanceof vs.VaultFormatError && /managerVersion/.test(e.message),
        `managerVersion ${JSON.stringify(bad)} is refused`
      );
    }

    // Pairing rule at import: one admin field without the other is malformed.
    const sealOnly = roundTrip(goodBundle);
    delete sealOnly.adminPublicKeyB64;
    await assert.rejects(
      () => importIt(sealOnly),
      (e) => e instanceof vs.VaultFormatError && /together/.test(e.message)
    );
    const pubOnly = roundTrip(goodBundle);
    delete pubOnly.mrk.admin;
    await assert.rejects(
      () => importIt(pubOnly),
      (e) => e instanceof vs.VaultFormatError && /together/.test(e.message)
    );
    // Nothing was written for the refused imports.
    assert.equal(fs.existsSync(vaultPath(destDir, 'work')), false);
  } finally {
    rm(srcDir);
    rm(destDir);
  }
});

// ---------------------------------------------------------------------------
// AC3b — mixed-version negative (DD1 homogeneity / the flight's divert criterion)
// ---------------------------------------------------------------------------

test('AC3b: a version:2 document whose MASTER envelope was wrapped at AAD version 1 fails unlock LOUDLY (VaultAuthError) — never opens, never repairs', async () => {
  const dir = tmpDir();
  try {
    await writeManagerFixture(dir, { version: 2, withAdmin: true, masterAadVersion: 1 });
    const before = fs.readFileSync(managerPath(dir), 'utf8');

    const store = makeStore(dir); // structural validation passes — the defect is cryptographic.
    // The store unwraps at the DOCUMENT'S stated version (2); the envelope's AAD says 1 → GCM fails.
    await assert.rejects(store.unlock(MASTER), (e) => e instanceof vs.VaultAuthError);
    assert.equal(store.isUnlocked(), false, 'a mixed-version document never opens');
    // Load-loudly: no repair/quarantine — the file is byte-identical.
    assert.equal(fs.readFileSync(managerPath(dir), 'utf8'), before);
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// AC4 — single-slot rotations preserve the document's version (v2 stays v2,
// v1 stays v1); rotateAdminKey provisions on a no-admin v2 manager
// ---------------------------------------------------------------------------

test('AC4: changeMasterPassword / rotateRecovery / rotateAdminKey / recoverMasterPassword on a v2 manager preserve version:2 and its envelopes unwrap afterward', async () => {
  const dir = tmpDir();
  try {
    const fx = await writeManagerFixture(dir, { version: 2, withAdmin: true });
    const store = makeStore(dir);
    await store.unlock(MASTER);

    // changeMasterPassword — v2 preserved; the new master unlocks (AAD-homogeneous).
    const NEW_MASTER = 'an entirely new master password';
    await store.changeMasterPassword({ oldMasterPassword: MASTER, newMasterPassword: NEW_MASTER });
    assert.equal(readManager(dir).version, 2, 'changeMasterPassword preserves version 2');
    store.lockNow();
    await store.unlock(NEW_MASTER);
    assert.equal(store.isUnlocked(), true);

    // rotateRecovery — v2 preserved; the new recovery unlocks; the old fails.
    const newRecovery = await store.rotateRecovery({ masterPassword: NEW_MASTER });
    assert.equal(readManager(dir).version, 2, 'rotateRecovery preserves version 2');
    store.lockNow();
    store.unlockWithRecovery(newRecovery);
    assert.equal(store.isUnlocked(), true);
    store.lockNow();
    assert.throws(
      () => store.unlockWithRecovery(fx.recoveryDisplay),
      (e) => e instanceof vs.VaultAuthError
    );
    await store.unlock(NEW_MASTER);

    // rotateAdminKey — v2 preserved; the new admin key opens; the old is rejected.
    const newAdminPriv = await store.rotateAdminKey({ masterPassword: NEW_MASTER });
    assert.equal(readManager(dir).version, 2, 'rotateAdminKey preserves version 2');
    store.lockNow();
    store.unlockWithAdmin(newAdminPriv);
    assert.equal(store.isUnlocked(), true);
    store.lockNow();
    assert.throws(
      () => store.unlockWithAdmin(fx.admin.privateKeyB64),
      (e) => e instanceof vs.VaultAuthError
    );

    // recoverMasterPassword — from locked, by the current recovery key; v2 preserved;
    // the recovered-to master unlocks after a restart-shaped reload.
    const RECOVERED_MASTER = 'recovered master password';
    await store.recoverMasterPassword({ recoveryDisplay: newRecovery, newMasterPassword: RECOVERED_MASTER });
    assert.equal(readManager(dir).version, 2, 'recoverMasterPassword preserves version 2');
    const reloaded = makeStore(dir);
    await reloaded.unlock(RECOVERED_MASTER);
    assert.equal(reloaded.isUnlocked(), true);
    assert.equal(reloaded.listItems('global')[0].password, 'hunter2', 'items survive every rotation');
  } finally {
    rm(dir);
  }
});

test('AC4: the same single-slot rotations on a v1 (setup) manager preserve version:1', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    assert.equal(readManager(dir).version, 1);

    const NEW_MASTER = 'new v1 master';
    await store.changeMasterPassword({ oldMasterPassword: MASTER, newMasterPassword: NEW_MASTER });
    assert.equal(readManager(dir).version, 1, 'changeMasterPassword preserves version 1');

    const newRecovery = await store.rotateRecovery({ masterPassword: NEW_MASTER });
    assert.equal(readManager(dir).version, 1, 'rotateRecovery preserves version 1');

    await store.rotateAdminKey({ masterPassword: NEW_MASTER });
    assert.equal(readManager(dir).version, 1, 'rotateAdminKey preserves version 1');

    await store.recoverMasterPassword({ recoveryDisplay: newRecovery, newMasterPassword: MASTER });
    assert.equal(readManager(dir).version, 1, 'recoverMasterPassword preserves version 1');
    // Sanity: the document still opens after the full rotation tour.
    store.lockNow();
    await store.unlock(MASTER);
    assert.equal(store.isUnlocked(), true);
    // v1 rules still hold on the rewritten document: all three slots + pubkey present.
    const m = readManager(dir);
    for (const slot of ['master', 'recovery', 'admin']) {
      assert.ok(m.mrk[slot], `mrk.${slot} present`);
    }
    assert.equal(typeof m.adminPublicKeyB64, 'string');
  } finally {
    rm(dir);
  }
});

test('AC4: rotateAdminKey on a NO-admin v2 manager PROVISIONS from scratch — both fields written together, version preserved', async () => {
  const dir = tmpDir();
  try {
    await writeManagerFixture(dir, { version: 2, withAdmin: false });
    const store = makeStore(dir);
    await store.unlock(MASTER);
    assert.equal(store.adminPublicKey(), null, 'unprovisioned before');

    const adminPriv = await store.rotateAdminKey({ masterPassword: MASTER });
    const m = readManager(dir);
    assert.equal(m.version, 2, 'provision preserves version 2');
    assert.ok(m.mrk.admin && typeof m.mrk.admin.ct === 'string', 'admin seal written');
    assert.equal(typeof m.adminPublicKeyB64, 'string', 'admin pubkey written (the pair, together)');
    assert.equal(typeof store.adminPublicKey(), 'string', 'provisioned after');

    // The freshly provisioned key opens the manager and the vaults (seal at AAD v2).
    store.lockNow();
    store.unlockWithAdmin(adminPriv);
    assert.equal(store.isUnlocked(), true);
    const opened = store.openAllWithAdminKey(adminPriv);
    assert.ok(opened.has('global'));
    for (const k of opened.values()) k.fill(0);
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// AC5 — export/import/adopt across the version + admin-absence matrix
// ---------------------------------------------------------------------------

test('AC5: export from a NO-admin v2 manager omits the admin fields and stamps managerVersion:2', async () => {
  const dir = tmpDir();
  try {
    await writeManagerFixture(dir, { version: 2, withAdmin: false });
    const store = makeStore(dir);
    await store.unlock(MASTER);

    const bundle = store.exportVault('global');
    assert.equal(bundle.format, 'gfvault-bundle');
    assert.equal(bundle.version, 1, 'BUNDLE_VERSION stays 1 (the bump is reserved for Flight 3)');
    assert.equal(bundle.managerVersion, 2, 'the source manager version rides the bundle');
    assert.ok(bundle.mrk.master && bundle.mrk.recovery, 'master + recovery always present');
    assert.equal('admin' in bundle.mrk, false, 'no admin seal in a no-admin bundle');
    assert.equal('adminPublicKeyB64' in bundle, false, 'no admin pubkey in a no-admin bundle');
    // Still ciphertext-only.
    const serialized = JSON.stringify(bundle);
    assert.equal(serialized.includes('hunter2'), false);
    assert.equal(serialized.includes(MASTER), false);
  } finally {
    rm(dir);
  }
});

test('AC5: export from a WITH-admin v1 manager is unchanged apart from managerVersion:1 (admin pair still rides)', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    store.saveItem('global', { type: 'login', title: 'X', username: 'u', password: 'hunter2' });
    const bundle = store.exportVault('global');
    assert.equal(bundle.managerVersion, 1);
    assert.ok(bundle.mrk.admin, 'admin seal present on a with-admin bundle');
    assert.equal(typeof bundle.adminPublicKeyB64, 'string');
  } finally {
    rm(dir);
  }
});

test('AC5: a no-admin v2 bundle FRESH-adopts — on-disk version equals the bundle managerVersion, every mrk slot unwraps at the doc version, donor master unlocks after restart', async () => {
  const srcDir = tmpDir();
  const freshDir = tmpDir();
  try {
    await writeManagerFixture(srcDir, { version: 2, withAdmin: false });
    const srcStore = makeStore(srcDir);
    await srcStore.unlock(MASTER);
    const bundle = roundTrip(srcStore.exportVault('global'));

    const store = vs.load(freshDir, { scryptParams: FAST_SCRYPT, listJars: () => [] });
    assert.equal(store.isSetUp(), false);
    const res = await store.importVault(bundle, {
      destinationTarget: 'global',
      secret: Buffer.from(MASTER, 'utf8'),
      secretKind: 'master'
    });
    assert.equal(res.fresh, true);
    assert.equal(store.isUnlocked(), true, 'fresh adopt leaves the profile unlocked');

    // On-disk version === the bundle's managerVersion (the AC5 probe).
    const m = readManager(freshDir);
    assert.equal(m.version, bundle.managerVersion, 'adopted manager written at the bundle managerVersion');
    assert.equal(m.version, 2);

    // Adopt still mints a fresh admin pair TODAY (Flight 3 removes that) — the
    // no-admin bundle simply adopts as WITH-admin, both fields present.
    assert.ok(m.mrk.admin && typeof m.mrk.admin.ct === 'string', 'adopt minted an admin seal');
    assert.equal(typeof m.adminPublicKeyB64, 'string', 'adopt minted an admin pubkey');

    // AAD HOMOGENEITY: every mrk slot unwraps at the DOC'S stated version, via
    // vault-crypto directly (master = the retained donor envelope; recovery/admin =
    // the adopt-minted ones, opened with the RETURNED one-time secrets).
    const donorMrk = await vc.unwrapMaster(m.mrk.master, MASTER, { version: m.version, params: m.kdf });
    donorMrk.fill(0);
    const recMaterial = vc.parseRecoveryKey(res.recoveryKeyDisplay);
    const recMrk = vc.unwrapRecovery(m.mrk.recovery, recMaterial, { version: m.version });
    recMaterial.fill(0);
    recMrk.fill(0);
    const admMrk = vc.openAdminSeal(m.mrk.admin, vc.importAdminPrivateKey(res.adminPrivateKeyB64), {
      version: m.version
    });
    admMrk.fill(0);

    // RESTART-shaped reload: a fresh store over the adopted dir reads the v2 doc and
    // the DONOR master password unlocks (AAD-correct retained envelope).
    const reloaded = vs.load(freshDir, { scryptParams: FAST_SCRYPT, listJars: () => [] });
    await reloaded.unlock(MASTER);
    assert.equal(reloaded.isUnlocked(), true, 'donor master unlocks after restart');
    assert.equal(reloaded.listItems('global')[0].password, 'hunter2');
    // The returned one-time secrets work through the store surface too.
    reloaded.lockNow();
    reloaded.unlockWithRecovery(res.recoveryKeyDisplay);
    assert.equal(reloaded.isUnlocked(), true);
    const opened = reloaded.openAllWithAdminKey(res.adminPrivateKeyB64);
    assert.ok(opened.has('global'));
    for (const k of opened.values()) k.fill(0);
  } finally {
    rm(srcDir);
    rm(freshDir);
  }
});

test('AC5: a no-admin v2 bundle EXISTING-profile-imports into a set-up profile (re-key under the destination MRK)', async () => {
  const srcDir = tmpDir();
  const destDir = tmpDir();
  try {
    await writeManagerFixture(srcDir, { version: 2, withAdmin: false });
    const srcStore = makeStore(srcDir);
    await srcStore.unlock(MASTER);
    const bundle = roundTrip(srcStore.exportVault('global'));

    const store = makeStore(destDir);
    await store.setup({ masterPassword: DEST_MASTER });
    const res = await store.importVault(bundle, {
      destinationTarget: 'work',
      secret: Buffer.from(MASTER, 'utf8'),
      secretKind: 'master'
    });
    assert.deepEqual(res, { imported: true, fresh: false, vaultId: 'work' });
    assert.equal(store.listItems('work')[0].password, 'hunter2');
    // The destination manager is untouched — still the v1 setup document.
    assert.equal(readManager(destDir).version, 1);
    // Re-keyed: readable after a restart under the DESTINATION master.
    store.lockNow();
    await store.unlock(Buffer.from(DEST_MASTER, 'utf8'));
    assert.equal(store.listItems('work')[0].password, 'hunter2');
  } finally {
    rm(srcDir);
    rm(destDir);
  }
});

test('AC5: a WITH-admin v2 bundle fresh-adopts with the admin pair riding at version 2 (homogeneity; donor admin discarded, donor recovery discarded)', async () => {
  const srcDir = tmpDir();
  const freshDir = tmpDir();
  try {
    const fx = await writeManagerFixture(srcDir, { version: 2, withAdmin: true });
    const srcStore = makeStore(srcDir);
    await srcStore.unlock(MASTER);
    const bundle = roundTrip(srcStore.exportVault('global'));
    assert.equal(bundle.managerVersion, 2);
    assert.ok(bundle.mrk.admin, 'with-admin v2 bundle carries the admin pair');

    const store = vs.load(freshDir, { scryptParams: FAST_SCRYPT, listJars: () => [] });
    const res = await store.importVault(bundle, {
      destinationTarget: 'global',
      secret: Buffer.from(MASTER, 'utf8'),
      secretKind: 'master'
    });
    const m = readManager(freshDir);
    assert.equal(m.version, 2, 'adopted at the bundle managerVersion');

    // The minted admin seal is AAD-bound at the doc version (2) — unwrap directly.
    const admMrk = vc.openAdminSeal(m.mrk.admin, vc.importAdminPrivateKey(res.adminPrivateKeyB64), {
      version: m.version
    });
    admMrk.fill(0);
    // Force-rotation still applies: the DONOR admin key and recovery are rejected.
    assert.throws(
      () => store.openAllWithAdminKey(fx.admin.privateKeyB64),
      (e) => e instanceof vs.VaultAuthError
    );
    store.lockNow();
    assert.throws(
      () => store.unlockWithRecovery(fx.recoveryDisplay),
      (e) => e instanceof vs.VaultAuthError
    );
    // Donor master + the returned secrets all open the adopted v2 profile.
    await store.unlock(MASTER);
    assert.equal(store.listItems('global')[0].password, 'hunter2');
    store.lockNow();
    store.unlockWithRecovery(res.recoveryKeyDisplay);
    assert.equal(store.isUnlocked(), true);
  } finally {
    rm(srcDir);
    rm(freshDir);
  }
});

test('AC5: a PRE-CHANGE v1 bundle (no managerVersion field) still imports both ways (absent ⇒ 1)', async () => {
  const srcDir = tmpDir();
  const freshDir = tmpDir();
  const destDir = tmpDir();
  try {
    const srcStore = makeStore(srcDir);
    await srcStore.setup({ masterPassword: MASTER });
    srcStore.saveItem('global', { type: 'login', title: 'X', username: 'u', password: 'hunter2' });
    const bundle = roundTrip(srcStore.exportVault('global'));
    // Simulate a bundle exported BEFORE this leg: no managerVersion field at all.
    delete bundle.managerVersion;

    // Fresh adopt: effective managerVersion 1 → adopted manager written at v1.
    const fresh = vs.load(freshDir, { scryptParams: FAST_SCRYPT, listJars: () => [] });
    await fresh.importVault(bundle, {
      destinationTarget: 'global',
      secret: Buffer.from(MASTER, 'utf8'),
      secretKind: 'master'
    });
    assert.equal(readManager(freshDir).version, 1, 'a pre-change bundle adopts at v1');
    const reloaded = vs.load(freshDir, { scryptParams: FAST_SCRYPT, listJars: () => [] });
    await reloaded.unlock(MASTER);
    assert.equal(reloaded.listItems('global')[0].password, 'hunter2');

    // Existing-profile import: re-keys under the destination as before.
    const dest = makeStore(destDir);
    await dest.setup({ masterPassword: DEST_MASTER });
    await dest.importVault(bundle, {
      destinationTarget: 'personal',
      secret: Buffer.from(MASTER, 'utf8'),
      secretKind: 'master'
    });
    assert.equal(dest.listItems('personal')[0].password, 'hunter2');
  } finally {
    rm(srcDir);
    rm(freshDir);
    rm(destDir);
  }
});
