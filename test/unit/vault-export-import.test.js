'use strict';

// Unit tests for the portable export / import store ops (M12 Flight 4 Leg 1 export-import,
// DD1 — Option A). Electron-free: real temp dirs + FAST scrypt (the vault-store.test.js
// idiom). Covers exportVault (no password, ciphertext-only, all three mrk envelopes),
// importVault on a FRESH profile (adopt the bundle's manager; unlock by the SOURCE master
// password AND, independently, by the SOURCE recovery key — the mission portability
// criterion), and importVault on an EXISTING profile (re-key under the destination MRK;
// refuse-on-collision; unknown-target refused; wrong-secret → VaultAuthError, nothing written).

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vault-eximport-'));
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
function loginItem(overrides = {}) {
  return { type: 'login', title: 'Example', username: 'user@example.com', password: 'hunter2', origin: 'https://example.com', ...overrides };
}
// Simulate the on-disk file round-trip (the real export path JSON-serializes the bundle to a
// file and the import path JSON.parses it back) — proves the bundle is pure serializable data.
function roundTrip(bundle) {
  return JSON.parse(JSON.stringify(bundle));
}

// A fully set-up SOURCE store with one login item in global; returns { dir, store, recovery }.
async function makeSource() {
  const dir = tmpDir();
  const store = makeStore(dir);
  const { recoveryKeyDisplay } = await store.setup({ masterPassword: MASTER });
  store.saveItem('global', loginItem());
  return { dir, store, recovery: recoveryKeyDisplay };
}

// ---------------------------------------------------------------------------
// Import hardening (PR#112 finding 4) — bounded KDF schema + decrypted item array
// ---------------------------------------------------------------------------

test('validateImportedKdf: rejects absent fields (the silent Node-scrypt-default downgrade) and exhausting values', () => {
  // The exact scenario the reviewer demonstrated: only { algo:'scrypt' } → Node defaults.
  assert.throws(() => vs.validateImportedKdf({ algo: 'scrypt' }), (e) => e instanceof vs.VaultFormatError);
  assert.throws(() => vs.validateImportedKdf({ algo: 'scrypt', N: 2 ** 12, r: 8, p: 1 }), /maxmem/); // maxmem absent
  assert.throws(() => vs.validateImportedKdf(null), (e) => e instanceof vs.VaultFormatError);
  assert.throws(() => vs.validateImportedKdf({ algo: 'pbkdf2', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }), /algo/);
  // Resource exhaustion: N far above the cap, or a non-power-of-two N.
  assert.throws(() => vs.validateImportedKdf({ algo: 'scrypt', N: 2 ** 30, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }), /N/);
  assert.throws(() => vs.validateImportedKdf({ algo: 'scrypt', N: 100000, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }), /N/);
  assert.throws(() => vs.validateImportedKdf({ algo: 'scrypt', N: 2 ** 12, r: 8, p: 999, maxmem: 64 * 1024 * 1024 }), /p/);
  // maxmem below scrypt's 128*N*r floor is refused up front (would otherwise throw deep in derive).
  assert.throws(() => vs.validateImportedKdf({ algo: 'scrypt', N: 2 ** 17, r: 8, p: 1, maxmem: 1024 }), /maxmem/);
  // The production params AND the fast test params both pass.
  assert.doesNotThrow(() => vs.validateImportedKdf(vc.SCRYPT_PARAMS));
  assert.doesNotThrow(() => vs.validateImportedKdf(FAST_SCRYPT));
});

test('validateImportedItems: rejects a non-array, a bad type, an absent id, and duplicate ids', () => {
  assert.throws(() => vs.validateImportedItems({ not: 'an array' }), /item array/);
  assert.throws(() => vs.validateImportedItems('nope'), /item array/);
  assert.throws(() => vs.validateImportedItems([{ type: 'bogus', id: 'a' }]), /invalid type/);
  assert.throws(() => vs.validateImportedItems([{ type: 'login' }]), /string id/);
  assert.throws(() => vs.validateImportedItems([{ type: 'login', id: 'x' }, { type: 'login', id: 'x' }]), /duplicate item id/);
  // A well-formed array passes and is returned unchanged.
  const ok = [{ type: 'login', id: 'a' }, { type: 'note', id: 'b' }];
  assert.equal(vs.validateImportedItems(ok), ok);
});

test('importVault rejects a bundle with downgraded/absent KDF params before persisting (finding 4)', async () => {
  const src = await makeSource();
  const bundle = roundTrip(src.store.exportVault('global'));
  // Tamper: strip the KDF down to the algo tag (the Node-default-downgrade vector).
  bundle.kdf = { algo: 'scrypt' };

  const freshDir = tmpDir();
  try {
    const store = vs.load(freshDir, { scryptParams: FAST_SCRYPT, listJars: () => [] });
    await assert.rejects(
      () => store.importVault(bundle, { destinationTarget: 'global', secret: Buffer.from(MASTER, 'utf8'), secretKind: 'master' }),
      (e) => e instanceof vs.VaultFormatError
    );
    // Nothing was written — the profile is still unset (fail-closed before persistence).
    assert.equal(store.isSetUp(), false, 'a rejected import persists nothing');
  } finally {
    rm(freshDir);
    rm(src.dir);
  }
});

// ---------------------------------------------------------------------------
// exportVault — no password, ciphertext-only, all three mrk envelopes
// ---------------------------------------------------------------------------

test('exportVault(global) builds a ciphertext-only bundle with all three mrk envelopes + kdf + the .gfvault — NO password, NO write', async () => {
  const { dir, store } = await makeSource();
  try {
    // exportVault takes ONLY a target — no password argument.
    assert.equal(store.exportVault.length, 1);

    const before = fs.readFileSync(vaultPath(dir, 'global'));
    const bundle = store.exportVault('global');
    // No write side-effect (the file is byte-identical after export).
    assert.deepEqual(fs.readFileSync(vaultPath(dir, 'global')), before);

    assert.equal(bundle.format, 'gfvault-bundle');
    assert.equal(bundle.version, 1);
    assert.equal(bundle.sourceVaultId, 'global');
    assert.deepEqual(bundle.kdf, FAST_SCRYPT);
    assert.equal(typeof bundle.adminPublicKeyB64, 'string');
    // ALL THREE mrk envelopes (review [HIGH]) — each ciphertext, no plaintext.
    for (const slot of ['master', 'recovery', 'admin']) {
      assert.ok(bundle.mrk[slot] && typeof bundle.mrk[slot].ct === 'string', `mrk.${slot} present`);
    }
    // The embedded .gfvault doc: its mrk envelope + item ciphertext.
    assert.equal(bundle.vault.format, 'gfvault');
    assert.ok(bundle.vault.envelopes.some((e) => e.keyId === 'mrk'), 'vault has an mrk envelope');
    assert.equal(typeof bundle.vault.items.ct, 'string');

    // No plaintext secret anywhere in the serialized bundle (the grep AC, in-process).
    const serialized = JSON.stringify(bundle);
    assert.equal(serialized.includes('hunter2'), false, 'no plaintext password in the bundle');
    assert.equal(serialized.includes(MASTER), false, 'no master password in the bundle');
    assert.equal(serialized.includes('user@example.com'), false, 'no plaintext username in the bundle');
  } finally {
    rm(dir);
  }
});

test('exportVault on a LOCKED manager throws VaultLockedError (policy — export is an unlock-window op)', async () => {
  const { dir, store } = await makeSource();
  try {
    store.lockNow();
    assert.throws(() => store.exportVault('global'), (e) => e instanceof vs.VaultLockedError);
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// importVault — FRESH profile (adopt the manager; unlock by master AND by recovery)
// ---------------------------------------------------------------------------

test('FRESH profile import (adopt-manager): sets up + leaves unlocked; the item is readable; manager adopts all three mrk slots + kdf + adminPublicKeyB64', async () => {
  const src = await makeSource();
  const bundle = roundTrip(src.store.exportVault('global'));
  const srcManager = JSON.parse(fs.readFileSync(managerPath(src.dir), 'utf8'));

  const freshDir = tmpDir();
  try {
    const store = vs.load(freshDir, { scryptParams: FAST_SCRYPT, listJars: () => [] });
    assert.equal(store.isSetUp(), false);

    const res = await store.importVault(bundle, { destinationTarget: 'global', secret: Buffer.from(MASTER, 'utf8'), secretKind: 'master' });
    assert.deepEqual(res, { imported: true, fresh: true, vaultId: 'global' });

    // Vault file written; manager adopted; left UNLOCKED (analogous to setup).
    assert.ok(fs.existsSync(vaultPath(freshDir, 'global')), 'global vault written');
    assert.equal(store.isSetUp(), true);
    assert.equal(store.isUnlocked(), true, 'fresh import leaves the profile unlocked');

    const items = store.listItems('global');
    assert.equal(items.length, 1);
    assert.equal(items[0].password, 'hunter2');
    assert.equal(items[0].username, 'user@example.com');

    // The adopted manager mirrors the bundle's envelopes verbatim.
    const adopted = JSON.parse(fs.readFileSync(managerPath(freshDir), 'utf8'));
    assert.equal(adopted.format, 'gfmanager');
    assert.deepEqual(adopted.kdf, srcManager.kdf);
    assert.equal(adopted.adminPublicKeyB64, srcManager.adminPublicKeyB64);
    for (const slot of ['master', 'recovery', 'admin']) {
      assert.deepEqual(adopted.mrk[slot], srcManager.mrk[slot], `mrk.${slot} adopted verbatim`);
    }
  } finally {
    rm(src.dir);
    rm(freshDir);
  }
});

test('FRESH profile import → unlock by the SOURCE MASTER password on restart (the portability criterion)', async () => {
  const src = await makeSource();
  const bundle = roundTrip(src.store.exportVault('global'));

  const freshDir = tmpDir();
  try {
    const store = vs.load(freshDir, { scryptParams: FAST_SCRYPT, listJars: () => [] });
    await store.importVault(bundle, { destinationTarget: 'global', secret: Buffer.from(MASTER, 'utf8'), secretKind: 'master' });

    // Simulate a restart: lock, then unlock with the SOURCE master password.
    store.lockNow();
    assert.equal(store.isUnlocked(), false);
    await store.unlock(Buffer.from(MASTER, 'utf8'));
    assert.equal(store.isUnlocked(), true, 'the source master password unlocks the imported profile');
    assert.equal(store.listItems('global')[0].password, 'hunter2');

    // A wrong master still fails.
    store.lockNow();
    await assert.rejects(store.unlock(Buffer.from('nope', 'utf8')), (e) => e instanceof vc.VaultAuthError);
  } finally {
    rm(src.dir);
    rm(freshDir);
  }
});

test('FRESH profile import → unlock by the SOURCE RECOVERY key on restart (independently of the master password)', async () => {
  const src = await makeSource();
  const bundle = roundTrip(src.store.exportVault('global'));

  const freshDir = tmpDir();
  try {
    const store = vs.load(freshDir, { scryptParams: FAST_SCRYPT, listJars: () => [] });
    // Import by the RECOVERY key (a base32 display STRING carried as Buffer bytes).
    await store.importVault(bundle, { destinationTarget: 'global', secret: Buffer.from(src.recovery, 'utf8'), secretKind: 'recovery' });
    assert.equal(store.isUnlocked(), true);

    // Restart: lock, then unlock with the SOURCE recovery key.
    store.lockNow();
    store.unlockWithRecovery(src.recovery);
    assert.equal(store.isUnlocked(), true, 'the source recovery key unlocks the imported profile');
    assert.equal(store.listItems('global')[0].password, 'hunter2');
  } finally {
    rm(src.dir);
    rm(freshDir);
  }
});

test('FRESH profile import: a WRONG secret → VaultAuthError, NOTHING installed (no manager, no vault)', async () => {
  const src = await makeSource();
  const bundle = roundTrip(src.store.exportVault('global'));

  const freshDir = tmpDir();
  try {
    const store = vs.load(freshDir, { scryptParams: FAST_SCRYPT, listJars: () => [] });
    await assert.rejects(
      store.importVault(bundle, { destinationTarget: 'global', secret: Buffer.from('wrong master', 'utf8'), secretKind: 'master' }),
      (e) => e instanceof vc.VaultAuthError
    );
    assert.equal(store.isSetUp(), false, 'no manager written on a wrong secret');
    assert.equal(store.isUnlocked(), false, 'nothing installed on a wrong secret');
    assert.equal(fs.existsSync(vaultPath(freshDir, 'global')), false, 'no vault written on a wrong secret');
  } finally {
    rm(src.dir);
    rm(freshDir);
  }
});

// ---------------------------------------------------------------------------
// importVault — EXISTING profile (re-key under destination; collisions; refusals)
// ---------------------------------------------------------------------------

test('EXISTING profile import: re-keys the source vault under the DESTINATION MRK; readable by the DESTINATION master password', async () => {
  const src = await makeSource();
  const bundle = roundTrip(src.store.exportVault('global'));

  const destDir = tmpDir();
  try {
    const store = makeStore(destDir); // has JARS work/personal
    await store.setup({ masterPassword: DEST_MASTER });

    const res = await store.importVault(bundle, { destinationTarget: 'work', secret: Buffer.from(MASTER, 'utf8'), secretKind: 'master' });
    assert.deepEqual(res, { imported: true, fresh: false, vaultId: 'work' });
    assert.ok(fs.existsSync(vaultPath(destDir, 'work')), 'the destination vault file was written');

    // Readable right now (destination is unlocked under DEST_MASTER's MRK).
    assert.equal(store.listItems('work')[0].password, 'hunter2');

    // Readable after a restart unlocked by the DESTINATION master password (proves re-key).
    store.lockNow();
    await store.unlock(Buffer.from(DEST_MASTER, 'utf8'));
    assert.equal(store.listItems('work')[0].password, 'hunter2');
    // The SOURCE master password does NOT unlock the destination profile.
    store.lockNow();
    await assert.rejects(store.unlock(Buffer.from(MASTER, 'utf8')), (e) => e instanceof vc.VaultAuthError);
  } finally {
    rm(src.dir);
    rm(destDir);
  }
});

test('EXISTING profile import: refuse-on-collision unless overwrite; unknown target refused; wrong secret writes nothing', async () => {
  const src = await makeSource();
  const bundle = roundTrip(src.store.exportVault('global'));

  const destDir = tmpDir();
  try {
    const store = makeStore(destDir);
    await store.setup({ masterPassword: DEST_MASTER });

    // First import lands the vault at 'work'.
    await store.importVault(bundle, { destinationTarget: 'work', secret: Buffer.from(MASTER, 'utf8'), secretKind: 'master' });

    // Collision: a second import to 'work' refuses unless overwrite:true. The refusal is a CODED
    // VaultCollisionError (M12 F5 HAT tail) — distinguishable from the other VaultStateError causes
    // and from a wrong-secret VaultAuthError — while STILL an instanceof VaultStateError (so the
    // pre-existing catchers are unaffected).
    await assert.rejects(
      store.importVault(bundle, { destinationTarget: 'work', secret: Buffer.from(MASTER, 'utf8'), secretKind: 'master' }),
      (e) => e instanceof vs.VaultCollisionError
        && e instanceof vs.VaultStateError
        && e.code === 'vault-collision'
    );
    // overwrite:true succeeds (REPLACES the destination vault).
    const ok = await store.importVault(bundle, { destinationTarget: 'work', secret: Buffer.from(MASTER, 'utf8'), secretKind: 'master', overwrite: true });
    assert.equal(ok.vaultId, 'work');

    // Unknown / non-persistent destination target is refused by the allowlist — a VaultStateError
    // that is NOT the coded collision (only the :846 destination-collision carries the code).
    await assert.rejects(
      store.importVault(bundle, { destinationTarget: 'no-such-jar', secret: Buffer.from(MASTER, 'utf8'), secretKind: 'master' }),
      (e) => e instanceof vs.VaultStateError && !(e instanceof vs.VaultCollisionError)
    );

    // Wrong secret to a fresh target → VaultAuthError, and no file is written for it.
    assert.equal(fs.existsSync(vaultPath(destDir, 'personal')), false);
    await assert.rejects(
      store.importVault(bundle, { destinationTarget: 'personal', secret: Buffer.from('wrong', 'utf8'), secretKind: 'master' }),
      (e) => e instanceof vc.VaultAuthError
    );
    assert.equal(fs.existsSync(vaultPath(destDir, 'personal')), false, 'nothing written on a wrong secret');
  } finally {
    rm(src.dir);
    rm(destDir);
  }
});

test('EXISTING profile import by the RECOVERY key also re-keys under the destination', async () => {
  const src = await makeSource();
  const bundle = roundTrip(src.store.exportVault('global'));

  const destDir = tmpDir();
  try {
    const store = makeStore(destDir);
    await store.setup({ masterPassword: DEST_MASTER });
    await store.importVault(bundle, { destinationTarget: 'personal', secret: Buffer.from(src.recovery, 'utf8'), secretKind: 'recovery' });
    assert.equal(store.listItems('personal')[0].password, 'hunter2');
  } finally {
    rm(src.dir);
    rm(destDir);
  }
});
