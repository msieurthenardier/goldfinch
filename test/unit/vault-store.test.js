'use strict';

// Unit tests for src/main/vault/vault-store.js — the stateful, lockable, persisted
// vault manager built on the Manager Root Key (MRK) composition (Mission 12,
// Flight 1, Leg 2).
//
// Electron-free: the store injects userDataPath + a listJars() provider + the
// idle-timer functions, so the whole suite runs headlessly with real temp dirs
// (the settings-store.test.js mkdtempSync pattern). scrypt runs at FAST params so
// the many unlock/step-up derivations stay quick; production params are exercised
// by vault-crypto's own suite.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');
const vc = require('../../src/main/vault/vault-crypto');

// Memory-cheap scrypt for fast round-trips (vault-crypto pins the production
// params). Stored in manager.json's kdf at setup, so unlock/step-up reuse it.
const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';
const JARS = [{ id: 'work' }, { id: 'personal' }];

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vault-'));
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
  return { type: 'login', title: 'Example', username: 'user@example.com', password: 'hunter2', ...overrides };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test('setup writes manager.json + the global vault; returns recovery + admin key once', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    assert.equal(store.isSetUp(), false);

    const out = await store.setup({ masterPassword: MASTER });
    assert.equal(typeof out.recoveryKeyDisplay, 'string');
    assert.equal(typeof out.adminPrivateKeyB64, 'string');
    assert.ok(out.recoveryKeyDisplay.length > 0 && out.adminPrivateKeyB64.length > 0);

    assert.ok(fs.existsSync(managerPath(dir)), 'manager.json exists');
    assert.ok(fs.existsSync(vaultPath(dir, 'global')), 'global vault exists');
    assert.equal(store.isSetUp(), true);
    assert.equal(store.isUnlocked(), true, 'setup leaves the manager unlocked');

    // manager.json holds only the admin PUBLIC key + wrapped MRK envelopes.
    const manager = JSON.parse(fs.readFileSync(managerPath(dir), 'utf8'));
    assert.equal(manager.format, 'gfmanager');
    assert.equal(typeof manager.adminPublicKeyB64, 'string');
    for (const slot of ['master', 'recovery', 'admin']) {
      assert.ok(manager.mrk[slot] && typeof manager.mrk[slot].ct === 'string', `mrk.${slot} present`);
    }
  } finally {
    rm(dir);
  }
});

test('double setup throws (no silent overwrite of manager.json)', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    await assert.rejects(store.setup({ masterPassword: 'other' }), (e) => e instanceof vs.VaultStateError);
  } finally {
    rm(dir);
  }
});

test('unlock before setup throws a typed not-set-up error', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await assert.rejects(store.unlock(MASTER), (e) => e instanceof vs.VaultStateError);
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// Three unlock paths + wrong-secret-stays-locked
// ---------------------------------------------------------------------------

test('all three unlock paths (master / recovery / admin) open the manager', async () => {
  const dir = tmpDir();
  try {
    const setupStore = makeStore(dir);
    const { recoveryKeyDisplay, adminPrivateKeyB64 } = await setupStore.setup({ masterPassword: MASTER });
    setupStore.saveItem('global', loginItem({ title: 'Seed' }));

    // (a) master
    let s = makeStore(dir);
    await s.unlock(MASTER);
    assert.equal(s.isUnlocked(), true);
    assert.deepEqual(s.listItems('global').map((i) => i.title), ['Seed']);

    // (b) recovery
    s = makeStore(dir);
    s.unlockWithRecovery(recoveryKeyDisplay);
    assert.equal(s.isUnlocked(), true);
    assert.deepEqual(s.listItems('global').map((i) => i.title), ['Seed']);

    // (c) admin private key
    s = makeStore(dir);
    s.unlockWithAdmin(adminPrivateKeyB64);
    assert.equal(s.isUnlocked(), true);
    assert.deepEqual(s.listItems('global').map((i) => i.title), ['Seed']);
  } finally {
    rm(dir);
  }
});

test('a wrong secret on any path throws and leaves the manager LOCKED', async () => {
  const dir = tmpDir();
  try {
    const setupStore = makeStore(dir);
    await setupStore.setup({ masterPassword: MASTER });

    const s = makeStore(dir);

    // wrong master
    await assert.rejects(s.unlock('wrong-password'), (e) => e instanceof vs.VaultAuthError);
    assert.equal(s.isUnlocked(), false);
    assert.equal(s.mrk, null, 'mrk stays null after a failed unlock');

    // a save/mint while locked throws
    assert.throws(() => s.saveItem('global', loginItem()), (e) => e instanceof vs.VaultLockedError);

    // wrong recovery (valid 20-byte material, wrong value)
    assert.throws(() => s.unlockWithRecovery('A'.repeat(32)), (e) => e instanceof vs.VaultAuthError);
    assert.equal(s.isUnlocked(), false);

    // wrong admin key
    const otherAdmin = vc.generateAdminKeypair();
    assert.throws(() => s.unlockWithAdmin(otherAdmin.privateKeyB64), (e) => e instanceof vs.VaultAuthError);
    assert.equal(s.isUnlocked(), false);
    assert.equal(s.mrk, null);
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// Recovery after forgotten master + set a new master
// ---------------------------------------------------------------------------

test('recovery unlocks a forgotten master, then a new master can be set (items untouched)', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    const { recoveryKeyDisplay } = await store.setup({ masterPassword: MASTER });
    store.saveItem('global', loginItem({ title: 'Kept', password: 'do-not-reencrypt' }));

    const ctBefore = JSON.parse(fs.readFileSync(vaultPath(dir, 'global'), 'utf8')).items;

    store.lockNow();
    // master is "forgotten" — the single recoverMasterPassword op (M12 F4 Leg 2 / DD3): the
    // recovery key unwraps + installs the MRK (the user ends unlocked) AND sets a new master in
    // one atomic op. This replaces the old unlockWithRecovery + changeMasterPassword pairing —
    // changeMasterPassword now REQUIRES the old password (an old-password step-up), which a
    // forgotten-master user by definition cannot supply, so recover is the dedicated path.
    await store.recoverMasterPassword({
      recoveryDisplay: recoveryKeyDisplay, newMasterPassword: 'brand-new-master',
    });
    assert.equal(store.isUnlocked(), true, 'recover leaves the manager unlocked');

    const ctAfter = JSON.parse(fs.readFileSync(vaultPath(dir, 'global'), 'utf8')).items;
    assert.deepEqual(ctAfter, ctBefore, 'item ciphertext is not rewritten by a recover / master change');

    // The NEW master unlocks; the OLD one no longer does.
    store.lockNow();
    await store.unlock('brand-new-master');
    assert.deepEqual(store.listItems('global').map((i) => i.title), ['Kept']);

    store.lockNow();
    await assert.rejects(store.unlock(MASTER), (e) => e instanceof vs.VaultAuthError);
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// Lazy jar vaults
// ---------------------------------------------------------------------------

test('a jar vault created lazily after setup is recoverable by recovery AND admin', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    const { recoveryKeyDisplay, adminPrivateKeyB64 } = await store.setup({ masterPassword: MASTER });

    // No jar vault yet — first save lazily creates it, minting no operator secret.
    assert.ok(!fs.existsSync(vaultPath(dir, 'work')));
    const saved = store.saveItem('work', loginItem({ title: 'Work login' }));
    assert.equal(typeof saved.id, 'string');
    assert.ok(fs.existsSync(vaultPath(dir, 'work')), 'lazy jar vault created on first save');

    // Recovery (created after setup) opens it.
    let s = makeStore(dir);
    s.unlockWithRecovery(recoveryKeyDisplay);
    assert.deepEqual(s.listItems('work').map((i) => i.title), ['Work login']);

    // Admin key opens it too.
    s = makeStore(dir);
    s.unlockWithAdmin(adminPrivateKeyB64);
    assert.deepEqual(s.listItems('work').map((i) => i.title), ['Work login']);
  } finally {
    rm(dir);
  }
});

test('saveItem upserts by id and listItems reflects the update', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    const a = store.saveItem('global', loginItem({ title: 'One' }));
    store.saveItem('global', loginItem({ title: 'Two' }));
    assert.equal(store.listItems('global').length, 2);
    // Update the first by id.
    store.saveItem('global', { id: a.id, type: 'login', title: 'One-edited', password: 'x' });
    const titles = store.listItems('global').map((i) => i.title).sort();
    assert.deepEqual(titles, ['One-edited', 'Two']);
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// Burner / unknown-jar exclusion
// ---------------------------------------------------------------------------

test('saving to a burner / unknown jar id is refused with no file created', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });

    for (const badId of ['burner', 'not-a-jar', 'personal-typo']) {
      assert.throws(() => store.saveItem(badId, loginItem()), (e) => e instanceof vs.VaultStateError);
      assert.ok(!fs.existsSync(vaultPath(dir, badId)), `no vault file created for "${badId}"`);
    }
    // A jar that IS in listJars() is accepted.
    store.saveItem('personal', loginItem({ title: 'ok' }));
    assert.ok(fs.existsSync(vaultPath(dir, 'personal')));
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// In-memory-only + zeroize on lock
// ---------------------------------------------------------------------------

test('lockNow zeroizes the MRK + vault keys and drops references', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    store.saveItem('global', loginItem());

    const mrkRef = store.mrk;
    const vaultKeyRef = store.vaultKeys.get('global');
    assert.ok(Buffer.isBuffer(mrkRef) && mrkRef.some((b) => b !== 0), 'MRK holds key material while unlocked');
    assert.ok(Buffer.isBuffer(vaultKeyRef));

    store.lockNow();

    assert.equal(store.isUnlocked(), false);
    assert.equal(store.mrk, null);
    assert.equal(store.vaultKeys.size, 0);
    assert.ok(mrkRef.every((b) => b === 0), 'the MRK buffer is zeroized in place');
    assert.ok(vaultKeyRef.every((b) => b === 0), 'the vault-key buffer is zeroized in place');

    // Reading items requires a fresh unlock.
    assert.throws(() => store.listItems('global'), (e) => e instanceof vs.VaultLockedError);
  } finally {
    rm(dir);
  }
});

test('lockNow fires the onLock hook EXACTLY once — the single vault-lock-state broadcast both lock channels rely on (M12 F5 I6/I8)', async () => {
  const dir = tmpDir();
  try {
    let onLockCalls = 0;
    // onLock stands in for main.js's broadcastVaultLockState. The internal-vault-lock and the
    // chrome-trust vault-lock channel handlers BOTH just call this store's lockNow() and must
    // NOT re-broadcast — so one lockNow() must yield exactly one onLock (no double-broadcast).
    const store = makeStore(dir, { onLock: () => { onLockCalls += 1; } });
    await store.setup({ masterPassword: MASTER });
    store.saveItem('global', loginItem());

    store.lockNow();
    assert.equal(store.isUnlocked(), false);
    assert.equal(onLockCalls, 1, 'exactly one onLock/broadcast per lockNow');

    // Idempotent: locking again is a no-op lock, still a single fire per call (never a burst).
    store.lockNow();
    assert.equal(onLockCalls, 2, 'each explicit lockNow fires onLock once — never more');
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// Idle auto-lock (injected timer)
// ---------------------------------------------------------------------------

test('the idle timer arms from the setting, resets on each op, and locks on fire', async () => {
  const dir = tmpDir();
  try {
    let armed = null;
    let armCount = 0;
    let cleared = 0;
    const store = makeStore(dir, {
      getAutoLockMinutes: () => 5,
      setTimeout: (fn, ms) => {
        armCount += 1;
        armed = { fn, ms };
        return `token-${armCount}`;
      },
      clearTimeout: () => {
        cleared += 1;
      },
    });

    await store.setup({ masterPassword: MASTER });
    assert.ok(armed, 'setup arms the idle timer');
    assert.equal(armed.ms, 5 * 60 * 1000, 'timer duration comes from getAutoLockMinutes()');
    const armAfterSetup = armCount;

    // Any op resets (clears + re-arms) the timer.
    store.listItems('global');
    assert.ok(armCount > armAfterSetup, 'an operation re-arms the timer');
    assert.ok(cleared > 0, 'an operation clears the prior timer');

    // Firing the timer zeroizes keys and locks.
    const mrkRef = store.mrk;
    armed.fn();
    assert.equal(store.isUnlocked(), false, 'the manager locks when the idle timer fires');
    assert.ok(mrkRef.every((b) => b === 0), 'firing the timer zeroizes the MRK');
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// Step-up re-auth + access keys
// ---------------------------------------------------------------------------

test('mintAccessKey step-up refuses a wrong password and mints nothing', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    store.saveItem('work', loginItem({ title: 'Work' }));

    await assert.rejects(
      store.mintAccessKey('work', { masterPassword: 'wrong' }),
      (e) => e instanceof vs.VaultAuthError
    );

    // No access envelope was added.
    const doc = vc.parseVault(fs.readFileSync(vaultPath(dir, 'work')));
    assert.equal(doc.envelopes.filter((e) => e.keyId !== 'mrk').length, 0);
  } finally {
    rm(dir);
  }
});

test('an access key opens ONLY its own vault; revoke takes effect immediately', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    store.saveItem('work', loginItem({ title: 'Work item' }));
    store.saveItem('personal', loginItem({ title: 'Personal item' }));

    const { secret, keyId } = await store.mintAccessKey('work', { masterPassword: MASTER });

    // The access path needs no manager unlock.
    const reader = makeStore(dir);
    const workKey = reader.unlockVaultWithAccessKey('work', secret);
    const workDoc = vc.parseVault(fs.readFileSync(vaultPath(dir, 'work')));
    assert.deepEqual(vc.decryptItems(workDoc.items, workKey).map((i) => i.title), ['Work item']);

    // It does NOT open the global vault (no access envelope there) nor a sibling.
    assert.throws(() => reader.unlockVaultWithAccessKey('global', secret), (e) => e instanceof vs.VaultAuthError);
    assert.throws(() => reader.unlockVaultWithAccessKey('personal', secret), (e) => e instanceof vs.VaultAuthError);

    // Revoke — immediate effect for a fresh reader.
    assert.equal(store.revokeAccessKey('work', keyId), true);
    const reader2 = makeStore(dir);
    assert.throws(() => reader2.unlockVaultWithAccessKey('work', secret), (e) => e instanceof vs.VaultAuthError);
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// listAccessKeys (M12 F3 Leg 5) — keyIds ONLY (no secret), MRK-gated, allowlisted.
// ---------------------------------------------------------------------------

test('listAccessKeys returns minted grants by keyId ONLY — no secret — and filters the mrk sentinel', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    store.saveItem('work', loginItem({ title: 'Work' }));

    // No access keys yet — but the mrk envelope is filtered out, so the list is empty.
    assert.deepEqual(store.listAccessKeys('work'), []);

    const { secret, keyId } = await store.mintAccessKey('work', { masterPassword: MASTER });
    const { keyId: keyId2 } = await store.mintAccessKey('work', { masterPassword: MASTER });

    const keys = store.listAccessKeys('work');
    assert.deepEqual(keys.map((k) => k.keyId).sort(), [keyId, keyId2].sort());
    // keyId ONLY — never a secret, and never the mrk sentinel.
    for (const k of keys) {
      assert.deepEqual(Object.keys(k), ['keyId']);
      assert.notEqual(k.keyId, 'mrk');
    }
    const json = JSON.stringify(keys);
    assert.equal(json.includes(secret), false, 'the minted secret must NEVER appear in listAccessKeys');
  } finally {
    rm(dir);
  }
});

test('listAccessKeys is MRK-gated (locked → VaultLockedError) and allowlist-resolved (burner/unknown rejected)', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });

    // An uncreated but ALLOWLISTED vault lists as empty (no file yet).
    assert.deepEqual(store.listAccessKeys('personal'), []);
    // The manager-wide global vault is reachable via the sentinel.
    assert.deepEqual(store.listAccessKeys('global'), []);

    // A burner/unknown target is rejected by _resolveTarget (no raw-path construction).
    assert.throws(() => store.listAccessKeys('burner-xyz'), (e) => e instanceof vs.VaultStateError);
    assert.throws(() => store.listAccessKeys('../../etc/passwd'), (e) => e instanceof vs.VaultStateError);

    // Locked → VaultLockedError (policy MRK-gate — uniform locked-routing).
    store.lockNow();
    assert.throws(() => store.listAccessKeys('work'), (e) => e instanceof vs.VaultLockedError);
  } finally {
    rm(dir);
  }
});

test('resolveTarget is the PUBLIC allowlist passthrough for the revoke handler (validated id or throw)', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    assert.equal(store.resolveTarget('work'), 'work');
    assert.equal(store.resolveTarget('global'), 'global');
    assert.throws(() => store.resolveTarget('burner-xyz'), (e) => e instanceof vs.VaultStateError);
    // Needs no MRK — the allowlist is manager-lock-independent.
    store.lockNow();
    assert.equal(store.resolveTarget('work'), 'work');
  } finally {
    rm(dir);
  }
});

test('mintAccessKey accepts a Buffer step-up master password (no widening) and mints a usable key', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    store.saveItem('work', loginItem({ title: 'Work' }));

    // The chrome-sheet path hands the password as a zeroizable Buffer (the vault-stepup-mint
    // channel's Buffer.from copy). mintAccessKey has no string guard — it accepts it natively.
    const buf = Buffer.from(MASTER, 'utf8');
    const { secret, keyId } = await store.mintAccessKey('work', { masterPassword: buf });
    assert.equal(typeof secret, 'string');
    assert.equal(typeof keyId, 'string');

    // The minted key genuinely opens its vault (a Buffer step-up is a real re-auth).
    const reader = makeStore(dir);
    const workKey = reader.unlockVaultWithAccessKey('work', secret);
    const workDoc = vc.parseVault(fs.readFileSync(vaultPath(dir, 'work')));
    assert.deepEqual(vc.decryptItems(workDoc.items, workKey).map((i) => i.title), ['Work']);

    // A WRONG Buffer step-up password refuses (VaultAuthError) and mints nothing.
    await assert.rejects(
      store.mintAccessKey('work', { masterPassword: Buffer.from('wrong', 'utf8') }),
      (e) => e instanceof vs.VaultAuthError
    );
    assert.equal(store.listAccessKeys('work').length, 1, 'the wrong-password attempt minted nothing');
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// Defense-in-depth: a jar id colliding with GLOBAL_ID cannot alias the manager-
// wide global vault (M12 F1 security review). jars.js now reserves `global`
// (isReservedId) so a container can no longer mint that id, but a store written
// BEFORE that fix could still surface a `{ id: 'global' }` entry via listJars().
// _resolveTarget's jar allowlist and openAllWithAdminKey's jar enumeration both
// EXCLUDE such an entry, so the colliding jar never becomes a second, jar-scoped
// route to the manager-wide vault; the `global` slot is ALWAYS the true global vault.
// ---------------------------------------------------------------------------
test('a listJars() entry with id `global` cannot reach the manager-wide global vault via the jar path', async () => {
  const dir = tmpDir();
  try {
    // Seed the TRUE manager-wide global vault with a marker item + a real jar vault.
    const store = makeStore(dir, { listJars: () => [{ id: 'work' }] });
    const { adminPrivateKeyB64 } = await store.setup({ masterPassword: MASTER });
    store.saveItem('global', loginItem({ title: 'MANAGER-WIDE-GLOBAL' }));
    store.saveItem('work', loginItem({ title: 'Work item' }));

    // A poisoned pre-existing install: a jar whose id collides with the sentinel.
    const poisoned = makeStore(dir, { listJars: () => [{ id: 'global' }, { id: 'work' }] });

    // openAllWithAdminKey enumerates GLOBAL_ID once; the colliding jar entry is
    // excluded, so there is exactly one `global` key and it opens the TRUE global
    // vault (decrypts the manager-wide marker) — no phantom / no mis-map onto a jar.
    const opened = poisoned.openAllWithAdminKey(adminPrivateKeyB64);
    assert.equal(opened.size, 2, 'exactly the global + work vaults — the colliding jar adds no phantom entry');
    const globalKey = opened.get('global');
    assert.ok(globalKey, 'the true global vault is present under the `global` slot');
    assert.deepEqual(
      poisoned.readVaultItems('global', globalKey).map((i) => i.title),
      ['MANAGER-WIDE-GLOBAL'],
      'the `global` slot decrypts the manager-wide vault, never a jar'
    );

    // A jar-scoped access secret can never reach the global vault: no `access`
    // envelope lives on the global .gfvault (access keys are a per-jar concept),
    // so a bare secret unlocking `global` throws — the escalation is closed.
    assert.throws(
      () => poisoned.unlockVaultWithAccessKey('global', 'any-bogus-secret'),
      (e) => e instanceof vs.VaultAuthError,
      'a jar access secret opens nothing on the manager-wide global vault'
    );
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// Corrupt files surface loudly (never quarantined)
// ---------------------------------------------------------------------------

test('a corrupt manager.json throws at load and is never quarantined', async () => {
  const dir = tmpDir();
  try {
    fs.mkdirSync(path.join(dir, 'vaults'), { recursive: true });
    fs.writeFileSync(managerPath(dir), '{{ not json', 'utf8');

    assert.throws(() => makeStore(dir), (e) => e instanceof vs.VaultFormatError);

    // The file is untouched — no rename / .bak / recreate.
    assert.deepEqual(fs.readdirSync(path.join(dir, 'vaults')), ['manager.json']);
    assert.equal(fs.readFileSync(managerPath(dir), 'utf8'), '{{ not json');
  } finally {
    rm(dir);
  }
});

test('a corrupt .gfvault throws on access and is never quarantined', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    store.saveItem('work', loginItem());

    fs.writeFileSync(vaultPath(dir, 'work'), 'not a vault document', 'utf8');

    const s = makeStore(dir);
    await s.unlock(MASTER);
    assert.throws(() => s.listItems('work'), (e) => e instanceof vs.VaultFormatError);
    // File still present, unchanged (loud, not quarantined).
    assert.equal(fs.readFileSync(vaultPath(dir, 'work'), 'utf8'), 'not a vault document');
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// mrk-envelope AAD tamper
// ---------------------------------------------------------------------------

test('the mrk-envelope AAD is load-bearing: a version-mismatched AAD fails unwrap', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });

    // Reconstruct the global vault with the SAME MRK + SAME ciphertext but an mrk
    // envelope wrapped under the WRONG AAD version (v2 instead of the doc's v1).
    const mrk = Buffer.from(store.mrk); // copy the live MRK
    const vaultKey = vc.newVaultKey();
    const badEnv = {
      keyId: 'mrk',
      type: 'mrk',
      ...vc.wrapVaultKey(vaultKey, mrk, Buffer.from('gfvault/mrk-env/v2')),
    };
    const json = vc.serializeVault({
      vaultId: 'global',
      envelopes: [badEnv],
      items: vc.encryptItems([], vaultKey),
    });
    fs.writeFileSync(vaultPath(dir, 'global'), json, 'utf8');

    const s = makeStore(dir);
    await s.unlock(MASTER);
    // The store unwraps with the correct AAD (v1) → GCM authentication fails.
    assert.throws(() => s.listItems('global'), (e) => e instanceof vs.VaultAuthError);
  } finally {
    rm(dir);
  }
});

test('flipping a byte of the mrk envelope ciphertext fails authentication', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });

    const doc = JSON.parse(fs.readFileSync(vaultPath(dir, 'global'), 'utf8'));
    const env = doc.envelopes.find((e) => e.keyId === 'mrk');
    const ct = Buffer.from(env.ct, 'base64');
    ct[0] ^= 0xff;
    env.ct = ct.toString('base64');
    fs.writeFileSync(vaultPath(dir, 'global'), JSON.stringify(doc), 'utf8');

    const s = makeStore(dir);
    await s.unlock(MASTER);
    assert.throws(() => s.listItems('global'), (e) => e instanceof vs.VaultAuthError);
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// No plaintext on disk
// ---------------------------------------------------------------------------

test('no plaintext password / recovery / admin-priv / item-secret is written to disk', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    const { recoveryKeyDisplay, adminPrivateKeyB64 } = await store.setup({ masterPassword: MASTER });
    const ITEM_SECRET = 'SUPER-SECRET-item-value-9f3a';
    store.saveItem('work', loginItem({ title: 'Bank', password: ITEM_SECRET }));
    const { secret } = await store.mintAccessKey('work', { masterPassword: MASTER });

    // Concatenate every persisted file as raw bytes.
    const vdir = path.join(dir, 'vaults');
    const blob = fs.readdirSync(vdir)
      .map((n) => fs.readFileSync(path.join(vdir, n)))
      .reduce((acc, b) => Buffer.concat([acc, b]), Buffer.alloc(0))
      .toString('latin1');

    for (const needle of [MASTER, recoveryKeyDisplay, adminPrivateKeyB64, ITEM_SECRET, secret]) {
      assert.ok(!blob.includes(needle), `disk must not contain the plaintext "${needle.slice(0, 12)}…"`);
    }
    // Sanity: the recovery display's raw material must not leak either.
    assert.ok(!blob.includes(recoveryKeyDisplay.replace(/-/g, '')), 'ungrouped recovery key must not appear');
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// Empty vault (no items yet)
// ---------------------------------------------------------------------------

test('listItems on the freshly set-up global vault returns an empty array', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    assert.deepEqual(store.listItems('global'), []);
    // An uncreated jar vault also lists empty (no lazy creation on read).
    assert.deepEqual(store.listItems('work'), []);
    assert.ok(!fs.existsSync(vaultPath(dir, 'work')), 'listItems must not create a vault file');
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// deleteVault + hasVault (M12 F4 Leg 6) — completes the vault lifecycle: a jar
// DELETE removes its `.gfvault`, a jar WIPE spares it. DESTRUCTIVE + irreversible;
// the GLOBAL vault is guarded.
// ---------------------------------------------------------------------------

test('deleteVault unlinks an existing jar .gfvault and evicts+zeroizes the cached key', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    // A jar vault is created lazily on the first save into that jar.
    store.saveItem('work', loginItem({ title: 'Work' }));
    assert.ok(fs.existsSync(vaultPath(dir, 'work')), 'jar vault file exists after save');
    const keyRef = store.vaultKeys.get('work');
    assert.ok(Buffer.isBuffer(keyRef) && keyRef.some((b) => b !== 0), 'a cached key holds material');

    const result = store.deleteVault('work');

    assert.deepEqual(result, { deleted: true });
    assert.ok(!fs.existsSync(vaultPath(dir, 'work')), 'the .gfvault file is gone');
    assert.equal(store.vaultKeys.has('work'), false, 'the cached key is evicted');
    assert.ok(keyRef.every((b) => b === 0), 'the evicted key buffer is zeroized in place');
    // The GLOBAL vault is untouched by a jar delete.
    assert.ok(fs.existsSync(vaultPath(dir, 'global')), 'the global vault survives');
  } finally {
    rm(dir);
  }
});

test('deleteVault on a jar with no vault is a clean ENOENT no-op → { deleted: false }, no throw', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    assert.ok(!fs.existsSync(vaultPath(dir, 'work')), 'no jar vault (the common case)');
    // Never touched → no cached key; the call must not throw.
    assert.deepEqual(store.deleteVault('work'), { deleted: false });
  } finally {
    rm(dir);
  }
});

test('deleteVault refuses the GLOBAL vault and never unlinks it', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    assert.ok(fs.existsSync(vaultPath(dir, 'global')), 'global vault exists');
    assert.throws(() => store.deleteVault(vs.GLOBAL_ID), (e) => e instanceof vs.VaultStateError);
    assert.ok(fs.existsSync(vaultPath(dir, 'global')), 'the global vault file is still there');
    // The literal 'global' resolves to GLOBAL_ID and is refused just the same.
    assert.throws(() => store.deleteVault('global'), (e) => e instanceof vs.VaultStateError);
  } finally {
    rm(dir);
  }
});

test('hasVault is true for a jar with a saved vault, false otherwise', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    assert.equal(store.hasVault('work'), false, 'no vault before any save');
    store.saveItem('work', loginItem({ title: 'Work' }));
    assert.equal(store.hasVault('work'), true, 'vault present after a save');
    // The global vault exists from setup.
    assert.equal(store.hasVault('global'), true);
  } finally {
    rm(dir);
  }
});
