'use strict';

// Unit tests for the bundle v2 EXPORT side (M18 F3 Leg 2 / flight DD1 ruling
// 2): `exportProfile()` — the whole-profile, multi-vault, all-ciphertext
// bundle — plus its jarMeta encrypt/decrypt helpers and the v1-normalization
// half of `restoreProfile`'s version gate (ruling 9). The multi-vault
// restore DIRECTIVE/OUTCOME matrix lives in vault-restore-directives.test.js;
// merge lives in vault-restore-merge.test.js; fault injection lives in
// vault-restore-fault-injection.test.js — this file is the export + shape/
// gate half.
//
// Electron-free: real temp dirs + FAST scrypt (the vault-store.test.js idiom).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');
const vc = require('../../src/main/vault/vault-crypto');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vault-bundle-v2-'));
}
function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
function managerPath(dir) {
  return path.join(dir, 'vaults', 'manager.json');
}

/**
 * A source profile with a global vault + two jar vaults, one of which is
 * LAZY (registered but never saved into — proves the "carried" contract).
 * Jar creation/verification are injected fakes mirroring jars.js's real
 * shape — this suite never touches jars.js itself.
 */
function makeJarDeps() {
  /** @type {Array<{id: string, name: string, color: string, partition: string, retentionDays: number}>} */
  const containers = [];
  return {
    containers,
    listJars: () => containers,
    createJar: (name, color) => {
      const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'jar';
      let id = base;
      let n = 1;
      while (containers.some((c) => c.id === id)) id = `${base}-${n++}`;
      const c = { id, name, color, partition: `persist:container:${id}`, retentionDays: 30 };
      containers.push(c);
      return c;
    },
    verifyJarPersisted: (id) => containers.some((c) => c.id === id)
  };
}

async function makeSourceProfile() {
  const dir = tmpDir();
  const deps = makeJarDeps();
  const store = vs.load(dir, { scryptParams: FAST_SCRYPT, listJars: deps.listJars });
  const setupResult = await store.setup({ masterPassword: MASTER });
  // Two jars registered; only 'work' gets a vault saved — 'lazy' stays item-less.
  deps.containers.push(
    { id: 'work', name: 'Work', color: '#2196f3', partition: 'persist:container:work', retentionDays: 30 },
    { id: 'lazy', name: 'Lazy', color: '#f5c518', partition: 'persist:container:lazy', retentionDays: 30 }
  );
  store.saveItem('global', { type: 'login', title: 'Global Item', username: 'g@example.com', password: 'g-secret' });
  store.saveItem('work', { type: 'login', title: 'Work Item', username: 'w@example.com', password: 'w-secret' });
  return { dir, store, deps, setupResult };
}

// ---------------------------------------------------------------------------
// exportProfile — shape, byte-scan, carried-vaults contract
// ---------------------------------------------------------------------------

test('exportProfile(): v2 bundle carries global + every ON-DISK jar vault (lazy jar absent), admin pair when provisioned, ciphertext-only', async () => {
  const src = await makeSourceProfile();
  try {
    const bundle = src.store.exportProfile();

    assert.equal(bundle.format, 'gfvault-bundle');
    assert.equal(bundle.version, vs.BUNDLE_VERSION_V2);
    assert.equal(bundle.version, 2);
    assert.equal(bundle.managerVersion, 1);
    assert.deepEqual(bundle.kdf, FAST_SCRYPT);
    assert.equal(typeof bundle.adminPublicKeyB64, 'string', 'admin pair rides — setup() provisions it');
    for (const slot of ['master', 'recovery', 'admin']) {
      assert.ok(bundle.mrk[slot] && typeof bundle.mrk[slot].ct === 'string', `mrk.${slot} present`);
    }

    // The lazy jar is ABSENT; global + work are carried — the result names what was carried.
    const carried = bundle.vaults.map((v) => v.sourceId).sort();
    assert.deepEqual(carried, ['global', 'work']);

    const globalEntry = bundle.vaults.find((v) => v.sourceId === 'global');
    assert.equal('jarMeta' in globalEntry, false, 'the global vault carries no jarMeta');
    assert.equal(globalEntry.vault.format, 'gfvault');
    assert.equal(typeof globalEntry.vault.items.ct, 'string');

    const workEntry = bundle.vaults.find((v) => v.sourceId === 'work');
    assert.ok(workEntry.jarMeta, 'the work jar entry carries jarMeta');
    assert.equal(typeof workEntry.jarMeta.ct, 'string');
    assert.equal(typeof workEntry.jarMeta.salt, 'string');

    // Byte-scan (the :165 idiom): no jar name, no color, no item plaintext anywhere.
    const serialized = JSON.stringify(bundle);
    assert.equal(serialized.includes('Work'), false, 'no plaintext jar name');
    assert.equal(serialized.includes('#2196f3'), false, 'no plaintext jar color');
    assert.equal(serialized.includes('g-secret'), false, 'no plaintext global item secret');
    assert.equal(serialized.includes('w-secret'), false, 'no plaintext work item secret');
    assert.equal(serialized.includes(MASTER), false, 'no plaintext master password');
  } finally {
    rm(src.dir);
  }
});

test('exportProfile(): no write side-effect; requires UNLOCKED (VaultLockedError — unlock-window policy, mirrors exportVault)', async () => {
  const src = await makeSourceProfile();
  try {
    const before = fs.readFileSync(managerPath(src.dir));
    src.store.exportProfile();
    assert.deepEqual(fs.readFileSync(managerPath(src.dir)), before, 'manager.json byte-identical after export');

    src.store.lockNow();
    assert.throws(
      () => src.store.exportProfile(),
      (e) => e instanceof vs.VaultLockedError
    );
  } finally {
    rm(src.dir);
  }
});

test('exportProfile(): a NO-admin profile omits both admin fields', async () => {
  const dir = tmpDir();
  try {
    const store = vs.load(dir, { scryptParams: FAST_SCRYPT, listJars: () => [] });
    await store.setup({ masterPassword: MASTER });
    // Compromise rotation is the cheapest way to reach a no-admin v2 manager in this
    // suite (v1/v2 no-admin fixture construction lives in vault-manager-v2.test.js) —
    // it removes the admin provision as part of its rewrite (M18 F2 Leg 3 / DD1).
    const rotated = await store.compromiseRotate({ oldMasterPassword: MASTER, newMasterPassword: 'a brand new one' });
    assert.equal(rotated.revoked.admin, true);
    const bundle = store.exportProfile();
    assert.equal('admin' in bundle.mrk, false, 'no admin seal in a no-admin bundle');
    assert.equal('adminPublicKeyB64' in bundle, false, 'no admin pubkey in a no-admin bundle');
  } finally {
    rm(dir);
  }
});

test('exportProfile(): global-only profile (zero jar vaults) exports a valid one-entry vaults array with no jarMeta anywhere', async () => {
  const dir = tmpDir();
  try {
    const store = vs.load(dir, { scryptParams: FAST_SCRYPT, listJars: () => [] });
    await store.setup({ masterPassword: MASTER });
    const bundle = store.exportProfile();
    assert.equal(bundle.vaults.length, 1);
    assert.equal(bundle.vaults[0].sourceId, 'global');
    assert.equal('jarMeta' in bundle.vaults[0], false);
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// jarMeta encrypt/decrypt — round trip + tamper (loud, never a silent unnamed jar)
// ---------------------------------------------------------------------------

test("decryptJarMeta: round-trips a jar entry's encrypted identity; a TAMPERED envelope fails GCM auth LOUDLY (never a silent unnamed jar)", async () => {
  const src = await makeSourceProfile();
  try {
    const bundle = src.store.exportProfile();
    const workEntry = bundle.vaults.find((v) => v.sourceId === 'work');

    const manager = JSON.parse(fs.readFileSync(managerPath(src.dir), 'utf8'));
    const mrk = await vc.unwrapMaster(manager.mrk.master, MASTER, { version: manager.version, params: manager.kdf });
    try {
      const meta = vs.decryptJarMeta(mrk, 'work', workEntry.jarMeta);
      assert.deepEqual(meta, { name: 'Work', color: '#2196f3' });

      // Tamper: flip a byte in the ciphertext.
      const tampered = { ...workEntry.jarMeta, ct: Buffer.from('0000000000000000', 'hex').toString('base64') };
      assert.throws(
        () => vs.decryptJarMeta(mrk, 'work', tampered),
        (e) => e instanceof vs.VaultAuthError
      );

      // Tamper: splice the envelope onto a DIFFERENT sourceId (AAD mismatch).
      assert.throws(
        () => vs.decryptJarMeta(mrk, 'lazy', workEntry.jarMeta),
        (e) => e instanceof vs.VaultAuthError
      );

      // Malformed envelope shape → VaultFormatError, not a crash.
      assert.throws(
        () => vs.decryptJarMeta(mrk, 'work', { ct: 'x', tag: 'y' }),
        (e) => e instanceof vs.VaultFormatError
      );
    } finally {
      mrk.fill(0);
    }
  } finally {
    rm(src.dir);
  }
});

// ---------------------------------------------------------------------------
// restoreProfile — v1 normalization (ruling 9) + version gate + generation field
// ---------------------------------------------------------------------------

test('restoreProfile(): a v1 bundle normalizes to a one-row v2 shape internally and fresh-adopts identically to importVault', async () => {
  const dir = tmpDir();
  try {
    const store = vs.load(dir, { scryptParams: FAST_SCRYPT, listJars: () => [] });
    await store.setup({ masterPassword: MASTER });
    store.saveItem('global', { type: 'login', title: 'X', username: 'u', password: 'p' });
    const v1Bundle = store.exportVault('global');
    assert.equal(v1Bundle.version, 1);

    const freshDir = tmpDir();
    try {
      const fresh = vs.load(freshDir, { scryptParams: FAST_SCRYPT, listJars: () => [] });
      const res = await fresh.restoreProfile(JSON.parse(JSON.stringify(v1Bundle)), {
        secret: Buffer.from(MASTER, 'utf8'),
        secretKind: 'master',
        mapping: { [v1Bundle.sourceVaultId]: { directive: 'existing', destination: 'global' } }
      });
      assert.equal(res.fresh, true);
      assert.equal(res.results.length, 1);
      assert.equal(res.results[0].outcome, 'landed');
      assert.equal(res.results[0].destination, 'global');
      assert.equal(typeof res.recoveryKeyDisplay, 'string');
      assert.equal(fresh.listItems('global')[0].password, 'p');
      assert.equal(JSON.parse(fs.readFileSync(managerPath(freshDir), 'utf8')).version, 1);
    } finally {
      rm(freshDir);
    }
  } finally {
    rm(dir);
  }
});

test('restoreProfile(): unknown bundle version → VaultFormatError; unknown format → VaultFormatError', async () => {
  const dir = tmpDir();
  try {
    const store = vs.load(dir, { scryptParams: FAST_SCRYPT, listJars: () => [] });
    await assert.rejects(
      store.restoreProfile({ format: 'gfvault-bundle', version: 3 }, { secret: Buffer.from('x'), mapping: {} }),
      (e) => e instanceof vs.VaultFormatError && /unsupported bundle version/.test(e.message)
    );
    await assert.rejects(
      store.restoreProfile({ format: 'nonsense', version: 2 }, { secret: Buffer.from('x'), mapping: {} }),
      (e) => e instanceof vs.VaultFormatError && /unknown bundle format/.test(e.message)
    );
  } finally {
    rm(dir);
  }
});

test('restoreProfile(): the generation field is a fresh {completedAt,nonce} on every call — two consecutive restores of the SAME bundle produce distinct generation values', async () => {
  const src = await makeSourceProfile();
  try {
    const bundle = src.store.exportProfile();

    const destDir = tmpDir();
    try {
      const dest = vs.load(destDir, { scryptParams: FAST_SCRYPT, listJars: () => [] });
      await dest.setup({ masterPassword: 'dest master pw' });
      const skipAll = { global: { directive: 'skip' }, work: { directive: 'skip' } };
      const r1 = await dest.restoreProfile(JSON.parse(JSON.stringify(bundle)), {
        secret: Buffer.from(MASTER, 'utf8'),
        secretKind: 'master',
        mapping: skipAll
      });
      const r2 = await dest.restoreProfile(JSON.parse(JSON.stringify(bundle)), {
        secret: Buffer.from(MASTER, 'utf8'),
        secretKind: 'master',
        mapping: skipAll
      });
      assert.notEqual(r1.generation.nonce, r2.generation.nonce, 'distinct nonces');
      assert.equal(typeof r1.generation.completedAt, 'number');
      assert.equal(typeof r2.generation.completedAt, 'number');
    } finally {
      rm(destDir);
    }
  } finally {
    rm(src.dir);
  }
});

// ---------------------------------------------------------------------------
// Adversarial replay (the vault-key-rotation.test.js idiom) — post-adopt, the
// donor recovery key is dead and a dummy admin key fails no-admin STATE.
// ---------------------------------------------------------------------------

test('adversarial replay: post fresh-adopt via restoreProfile, the DONOR recovery key fails auth; a dummy admin key fails with the no-admin STATE error; the donor master still unlocks', async () => {
  const src = await makeSourceProfile();
  try {
    const bundle = src.store.exportProfile();
    const donorRecovery = src.setupResult.recoveryKeyDisplay;

    const freshDir = tmpDir();
    try {
      const fresh = vs.load(freshDir, { scryptParams: FAST_SCRYPT, listJars: () => [] });
      await fresh.restoreProfile(JSON.parse(JSON.stringify(bundle)), {
        secret: Buffer.from(MASTER, 'utf8'),
        secretKind: 'master',
        mapping: { global: { directive: 'existing', destination: 'global' }, work: { directive: 'skip' } }
      });

      fresh.lockNow();
      assert.throws(
        () => fresh.unlockWithRecovery(donorRecovery),
        (e) => e instanceof vc.VaultAuthError,
        'the donor recovery key is dead after adopt'
      );
      const dummyAdmin = vc.generateAdminKeypair().privateKeyB64;
      assert.throws(
        () => fresh.unlockWithAdmin(dummyAdmin),
        (e) => e instanceof vs.VaultStateError && e.message === 'no admin key provisioned'
      );
      await fresh.unlock(Buffer.from(MASTER, 'utf8'));
      assert.equal(fresh.isUnlocked(), true, 'the donor master password still unlocks (DD4 residual)');
    } finally {
      rm(freshDir);
    }
  } finally {
    rm(src.dir);
  }
});
