'use strict';

// Unit tests for the bundle v2 EXPORT side (M18 F3 Leg 2 / flight DD1 ruling
// 2; RE-KEYED M18 F3 Leg 5 to close the plaintext-identity leak):
// `exportProfile()` — the whole-profile, multi-vault, all-ciphertext
// bundle — plus its identity encrypt/decrypt helpers and the v1-normalization
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
    const { bundle, carried } = src.store.exportProfile();

    assert.equal(bundle.format, 'gfvault-bundle');
    assert.equal(bundle.version, vs.BUNDLE_VERSION_V2);
    assert.equal(bundle.version, 2);
    assert.equal(bundle.managerVersion, 1);
    assert.deepEqual(bundle.kdf, FAST_SCRYPT);
    assert.equal(typeof bundle.adminPublicKeyB64, 'string', 'admin pair rides — setup() provisions it');
    for (const slot of ['master', 'recovery', 'admin']) {
      assert.ok(bundle.mrk[slot] && typeof bundle.mrk[slot].ct === 'string', `mrk.${slot} present`);
    }

    // The lazy jar is ABSENT; global + work are carried — `carried` names what was carried,
    // as real NAMES (main-process-only, ruling 4c), in the SAME order as bundle.vaults.
    assert.equal(bundle.vaults.length, 2);
    assert.deepEqual(carried, ['Global', 'Work']);

    // Every entry is keyed by an opaque entryHandle — unique, non-empty, no plaintext identity.
    const handles = bundle.vaults.map((v) => v.entryHandle);
    assert.equal(new Set(handles).size, 2, 'entryHandles are unique');
    for (const h of handles) {
      assert.equal(typeof h, 'string');
      assert.ok(h.length > 0);
    }
    assert.equal(
      bundle.vaults.some((v) => v.entryHandle === 'global' || v.entryHandle === 'work'),
      false,
      'entryHandle is never the old plaintext sourceId'
    );

    const globalEntry = bundle.vaults.find((v) => v.entryHandle === handles[0]);
    for (const entry of bundle.vaults) {
      assert.ok(entry.identity, 'EVERY entry (including global) carries an encrypted identity envelope');
      assert.equal(typeof entry.identity.ct, 'string');
      assert.equal(typeof entry.identity.salt, 'string');
      assert.equal(entry.vault.format, 'gfvault');
      // The embedded .gfvault document's own vaultId is scrubbed to the entryHandle — it must
      // never carry a raw local id (the second, independent leak found while adding this test).
      assert.equal(entry.vault.vaultId, entry.entryHandle);
    }
    assert.equal(typeof globalEntry.vault.items.ct, 'string');

    // Byte-scan (the :165 idiom): no jar name, no color, no item plaintext, no local id anywhere.
    const serialized = JSON.stringify(bundle);
    assert.equal(serialized.includes('Work'), false, 'no plaintext jar name');
    assert.equal(serialized.includes('#2196f3'), false, 'no plaintext jar color');
    assert.equal(serialized.includes('g-secret'), false, 'no plaintext global item secret');
    assert.equal(serialized.includes('w-secret'), false, 'no plaintext work item secret');
    assert.equal(serialized.includes(MASTER), false, 'no plaintext master password');
    assert.equal(serialized.includes('"work"'), false, 'the local jar id never appears as a JSON string value');
    assert.equal(serialized.includes('global'), false, 'the GLOBAL_ID sentinel never appears in the bundle');
    // `carried` itself must never be attached to the bundle object handed to the save path.
    assert.equal('carried' in bundle, false);
  } finally {
    rm(src.dir);
  }
});

test('exportProfile(): opacity byte-scan with a fixture whose jar NAME EQUALS its slug (ruling 6, the real-world case) — the exact assertion that would have caught the HAT finding', async () => {
  const dir = tmpDir();
  try {
    // The jar's local id IS its name-slug ('work' === 'work') — the case leg 2's fixtures
    // (name 'Work' vs. id 'work') missed, because the display name differed from the slug.
    const namedJars = [{ id: 'work', name: 'work', color: '#4287f5' }];
    const store = vs.load(dir, { scryptParams: FAST_SCRYPT, listJars: () => namedJars });
    await store.setup({ masterPassword: MASTER });
    store.saveItem('global', { type: 'login', title: 'G', username: 'u', password: 'g-secret' });
    store.saveItem('work', { type: 'login', title: 'W', username: 'u', password: 'w-secret' });

    const { bundle, carried } = store.exportProfile();
    const serialized = JSON.stringify(bundle);
    assert.equal(serialized.includes('work'), false, 'the jar name/slug never appears in the serialized v2 bundle');
    assert.deepEqual(carried, ['Global', 'work'], 'carried (main-only) still names it correctly');
  } finally {
    rm(dir);
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
    const { bundle } = store.exportProfile();
    assert.equal('admin' in bundle.mrk, false, 'no admin seal in a no-admin bundle');
    assert.equal('adminPublicKeyB64' in bundle, false, 'no admin pubkey in a no-admin bundle');
  } finally {
    rm(dir);
  }
});

test('exportProfile(): global-only profile (zero jar vaults) exports a valid one-entry vaults array with an encrypted global identity', async () => {
  const dir = tmpDir();
  try {
    const store = vs.load(dir, { scryptParams: FAST_SCRYPT, listJars: () => [] });
    await store.setup({ masterPassword: MASTER });
    const { bundle, carried } = store.exportProfile();
    assert.equal(bundle.vaults.length, 1);
    assert.notEqual(bundle.vaults[0].entryHandle, 'global', 'entryHandle is opaque, never the sentinel');
    assert.ok(bundle.vaults[0].identity, 'the global vault ALSO carries an encrypted identity envelope');
    assert.deepEqual(carried, ['Global']);
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// identity encrypt/decrypt — round trip + tamper (loud, never a silent unnamed jar)
// ---------------------------------------------------------------------------

test("decryptIdentity: round-trips every entry's encrypted identity (global AND jar); a TAMPERED envelope, an AAD-spliced envelope, and a malformed shape all fail LOUDLY (never a silent unnamed jar)", async () => {
  const src = await makeSourceProfile();
  try {
    const { bundle } = src.store.exportProfile();
    const manager = JSON.parse(fs.readFileSync(managerPath(src.dir), 'utf8'));
    const mrk = await vc.unwrapMaster(manager.mrk.master, MASTER, { version: manager.version, params: manager.kdf });
    try {
      const [entryA, entryB] = bundle.vaults;
      const identities = bundle.vaults.map((e) => vs.decryptIdentity(mrk, e.entryHandle, e.identity));
      const global = identities.find((i) => i.kind === 'global');
      const jar = identities.find((i) => i.kind === 'jar');
      assert.ok(global, 'one entry decrypts to the global identity');
      assert.deepEqual(jar, { kind: 'jar', name: 'Work', color: '#2196f3' });

      // Tamper: flip a byte in the ciphertext.
      const tampered = { ...entryA.identity, ct: Buffer.from('0000000000000000', 'hex').toString('base64') };
      assert.throws(
        () => vs.decryptIdentity(mrk, entryA.entryHandle, tampered),
        (e) => e instanceof vs.VaultAuthError
      );

      // Tamper: splice entryA's identity envelope onto entryB's DIFFERENT entryHandle (AAD mismatch).
      assert.throws(
        () => vs.decryptIdentity(mrk, entryB.entryHandle, entryA.identity),
        (e) => e instanceof vs.VaultAuthError
      );

      // Malformed envelope shape → VaultFormatError, not a crash.
      assert.throws(
        () => vs.decryptIdentity(mrk, entryA.entryHandle, { ct: 'x', tag: 'y' }),
        (e) => e instanceof vs.VaultFormatError
      );
    } finally {
      mrk.fill(0);
    }
  } finally {
    rm(src.dir);
  }
});

test('decryptIdentity: SECURITY regression pin — an envelope carrying identityPlaintext:true is refused loudly, never trusted as-is (tag-smuggling foreclosed, ruling 5)', async () => {
  const src = await makeSourceProfile();
  try {
    const { bundle } = src.store.exportProfile();
    const manager = JSON.parse(fs.readFileSync(managerPath(src.dir), 'utf8'));
    const mrk = await vc.unwrapMaster(manager.mrk.master, MASTER, { version: manager.version, params: manager.kdf });
    try {
      const entry = bundle.vaults[0];
      // A real (well-formed, GCM-authentic) envelope with the plaintext tag ALSO attached must
      // still be refused — decryptIdentity never trusts the tag, only normalizeRestoreBundle's
      // own v1 synthesis is allowed to produce it.
      const smuggled = { ...entry.identity, identityPlaintext: true };
      assert.throws(
        () => vs.decryptIdentity(mrk, entry.entryHandle, smuggled),
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

test('restoreProfile(): a v1 bundle normalizes to a one-row v2 shape internally (fresh entryHandle + a PLAINTEXT tagged synthetic identity) and fresh-adopts identically to importVault', async () => {
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
      // The page never sees the internal entryHandle before commit; this test drives the
      // mapping the same way `_previewRestoreBundle`'s labels would let an operator (by
      // discovering the v1 entry's synthesized directive key indirectly is out of scope for a
      // store-level test) — restoreProfile itself resolves it from the SAME normalization the
      // mapping validation runs against, so mapping directly off `v1Bundle.sourceVaultId` would
      // now be wrong: the real key is the freshly minted entryHandle, which this test cannot
      // predict. Preview first to learn it, exactly as the real flow does.
      const preview = await fresh.previewRestoreBundle(JSON.parse(JSON.stringify(v1Bundle)), {
        secret: Buffer.from(MASTER, 'utf8'),
        secretKind: 'master'
      });
      assert.equal(preview.labels.length, 1);
      assert.deepEqual(preview.labels[0].identity, { kind: 'global' });
      const entryHandle = preview.labels[0].entryHandle;
      assert.notEqual(
        entryHandle,
        'global',
        'the v1 entry still gets a fresh OPAQUE entryHandle, not the sourceVaultId'
      );

      const res = await fresh.restoreProfile(JSON.parse(JSON.stringify(v1Bundle)), {
        secret: Buffer.from(MASTER, 'utf8'),
        secretKind: 'master',
        mapping: { [entryHandle]: { directive: 'existing', destination: 'global' } }
      });
      assert.equal(res.fresh, true);
      assert.equal(res.results.length, 1);
      assert.equal(res.results[0].outcome, 'landed');
      assert.equal(res.results[0].entryHandle, entryHandle);
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

test('restoreProfile(): a v1 bundle whose sourceVaultId names a JAR (not global) normalizes to a plaintext {kind:"jar",name,identityPlaintext:true} synthetic identity', async () => {
  const dir = tmpDir();
  try {
    const deps = makeJarDeps();
    const store = vs.load(dir, { scryptParams: FAST_SCRYPT, listJars: deps.listJars });
    await store.setup({ masterPassword: MASTER });
    deps.containers.push({ id: 'work', name: 'Work', color: '#2196f3', partition: 'x', retentionDays: 30 });
    store.saveItem('work', { type: 'login', title: 'X', username: 'u', password: 'p' });
    const v1Bundle = store.exportVault('work');
    assert.equal(v1Bundle.sourceVaultId, 'work');

    const destDir = tmpDir();
    try {
      const dest = vs.load(destDir, { scryptParams: FAST_SCRYPT, listJars: deps.listJars });
      await dest.setup({ masterPassword: 'dest master pw' });
      const preview = await dest.previewRestoreBundle(JSON.parse(JSON.stringify(v1Bundle)), {
        secret: Buffer.from(MASTER, 'utf8'),
        secretKind: 'master'
      });
      assert.equal(preview.labels.length, 1);
      // v1 carried no color — the synthetic identity is name-only, exactly the legacy shape.
      assert.equal(preview.labels[0].identity.kind, 'jar');
      assert.equal(preview.labels[0].identity.name, 'work');
    } finally {
      rm(destDir);
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

test('restoreProfile(): a v2 entry with no entryHandle, a duplicate entryHandle, or no identity is refused loudly (mirrors the old sourceId checks)', async () => {
  const dir = tmpDir();
  try {
    const store = vs.load(dir, { scryptParams: FAST_SCRYPT, listJars: () => [] });
    const base = {
      format: 'gfvault-bundle',
      version: 2,
      managerVersion: 1,
      kdf: FAST_SCRYPT,
      mrk: { master: {}, recovery: {} }
    };
    await assert.rejects(
      store.restoreProfile(
        { ...base, vaults: [{ identity: { kind: 'global' }, vault: {} }] },
        { secret: Buffer.from('x'), mapping: {} }
      ),
      (e) => e instanceof vc.VaultFormatError && /missing entryHandle/.test(e.message)
    );
    await assert.rejects(
      store.restoreProfile(
        {
          ...base,
          vaults: [
            { entryHandle: 'dup', identity: { kind: 'global' }, vault: {} },
            { entryHandle: 'dup', identity: { kind: 'global' }, vault: {} }
          ]
        },
        { secret: Buffer.from('x'), mapping: {} }
      ),
      (e) => e instanceof vc.VaultFormatError && /duplicate entryHandle/.test(e.message)
    );
    await assert.rejects(
      store.restoreProfile(
        { ...base, vaults: [{ entryHandle: 'h1', vault: {} }] },
        { secret: Buffer.from('x'), mapping: {} }
      ),
      (e) => e instanceof vc.VaultFormatError && /missing its identity/.test(e.message)
    );
  } finally {
    rm(dir);
  }
});

test('restoreProfile(): the generation field is a fresh {completedAt,nonce} on every call — two consecutive restores of the SAME bundle produce distinct generation values', async () => {
  const src = await makeSourceProfile();
  try {
    const { bundle } = src.store.exportProfile();
    const [entryA, entryB] = bundle.vaults;

    const destDir = tmpDir();
    try {
      const dest = vs.load(destDir, { scryptParams: FAST_SCRYPT, listJars: () => [] });
      await dest.setup({ masterPassword: 'dest master pw' });
      const skipAll = {
        [entryA.entryHandle]: { directive: 'skip' },
        [entryB.entryHandle]: { directive: 'skip' }
      };
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
    const { bundle } = src.store.exportProfile();
    const donorRecovery = src.setupResult.recoveryKeyDisplay;

    const freshDir = tmpDir();
    try {
      const fresh = vs.load(freshDir, { scryptParams: FAST_SCRYPT, listJars: () => [] });
      const preview = await fresh.previewRestoreBundle(JSON.parse(JSON.stringify(bundle)), {
        secret: Buffer.from(MASTER, 'utf8'),
        secretKind: 'master'
      });
      const globalLabel = preview.labels.find((l) => l.identity.kind === 'global');
      const jarLabel = preview.labels.find((l) => l.identity.kind === 'jar');
      await fresh.restoreProfile(JSON.parse(JSON.stringify(bundle)), {
        secret: Buffer.from(MASTER, 'utf8'),
        secretKind: 'master',
        mapping: {
          [globalLabel.entryHandle]: { directive: 'existing', destination: 'global' },
          [jarLabel.entryHandle]: { directive: 'skip' }
        }
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
