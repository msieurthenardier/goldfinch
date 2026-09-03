'use strict';

// Unit tests for `previewRestoreBundle()` (M18 F3 Leg 3 / DD2 ruling 2): the store's
// decrypt-then-discard SECRET STEP for the multi-vault restore workflow — verifies the
// bundle secret (auth), returns NON-SECRET per-vault labels (source jar name/color, item
// count) for the page's mapping step, and installs nothing. Covers: v1 and v2 bundles (the
// "one-row case"), the byte-scan-adjacent claim that no key material/decrypted content rides
// the return, the gated entry (mirrored in vault-rekey-gate.test.js), and the cycle-2 HIGH
// pin — a GCM-authentic bundle whose plaintext is malformed fails HERE, at the secret step,
// before any restore write.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vault-restore-preview-'));
}
function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

async function makeSourceProfile() {
  const dir = tmpDir();
  const containers = [
    { id: 'work', name: 'Work', color: '#2196f3', partition: 'persist:container:work', retentionDays: 30 }
  ];
  const store = vs.load(dir, { scryptParams: FAST_SCRYPT, listJars: () => containers });
  const setupResult = await store.setup({ masterPassword: MASTER });
  store.saveItem('global', { type: 'login', title: 'Global Item', username: 'g', password: 'gp' });
  store.saveItem('work', { type: 'login', title: 'Work Item 1', username: 'w1', password: 'w1p' });
  store.saveItem('work', { type: 'login', title: 'Work Item 2', username: 'w2', password: 'w2p' });
  return { dir, store, setupResult };
}

function destStore() {
  const dir = tmpDir();
  return { dir, store: vs.load(dir, { scryptParams: FAST_SCRYPT, listJars: () => [] }) };
}

test('previewRestoreBundle: v2 bundle → one label per vault, itemCount correct, jarMeta decrypted for jar vaults, null for global', async () => {
  const src = await makeSourceProfile();
  const dest = destStore();
  try {
    const bundle = src.store.exportProfile();
    const res = await dest.store.previewRestoreBundle(bundle, {
      secret: Buffer.from(MASTER, 'utf8'),
      secretKind: 'master'
    });
    assert.equal(res.labels.length, 2);
    const global = res.labels.find((l) => l.sourceId === 'global');
    const work = res.labels.find((l) => l.sourceId === 'work');
    assert.deepEqual(global, { sourceId: 'global', jarMeta: null, itemCount: 1 });
    assert.deepEqual(work, { sourceId: 'work', jarMeta: { name: 'Work', color: '#2196f3' }, itemCount: 2 });
  } finally {
    rm(src.dir);
    rm(dest.dir);
  }
});

test('previewRestoreBundle: v1 bundle (the one-row case) → a single label, no jarMeta', async () => {
  const src = await makeSourceProfile();
  const dest = destStore();
  try {
    const v1Bundle = src.store.exportVault('global');
    assert.equal(v1Bundle.version, vs.BUNDLE_VERSION);
    const res = await dest.store.previewRestoreBundle(v1Bundle, {
      secret: Buffer.from(MASTER, 'utf8'),
      secretKind: 'master'
    });
    assert.deepEqual(res.labels, [{ sourceId: 'global', jarMeta: null, itemCount: 1 }]);
  } finally {
    rm(src.dir);
    rm(dest.dir);
  }
});

test('previewRestoreBundle: preview NEVER installs anything — a fresh destination stays not-set-up after a preview', async () => {
  const src = await makeSourceProfile();
  const dest = destStore();
  try {
    const bundle = src.store.exportProfile();
    assert.equal(dest.store.isSetUp(), false);
    await dest.store.previewRestoreBundle(bundle, { secret: Buffer.from(MASTER, 'utf8'), secretKind: 'master' });
    assert.equal(dest.store.isSetUp(), false, 'preview writes nothing — no adopt, no manager.json');
  } finally {
    rm(src.dir);
    rm(dest.dir);
  }
});

test('previewRestoreBundle: wrong secret throws VaultAuthError; a wrong recovery key too', async () => {
  const src = await makeSourceProfile();
  const dest = destStore();
  try {
    const bundle = src.store.exportProfile();
    await assert.rejects(
      dest.store.previewRestoreBundle(bundle, { secret: Buffer.from('nope', 'utf8'), secretKind: 'master' }),
      (e) => e instanceof vs.VaultAuthError
    );
  } finally {
    rm(src.dir);
    rm(dest.dir);
  }
});

test('previewRestoreBundle: labels carry NO key material, no decrypted item content — only sourceId/jarMeta{name,color}/itemCount', async () => {
  const src = await makeSourceProfile();
  const dest = destStore();
  try {
    const bundle = src.store.exportProfile();
    const res = await dest.store.previewRestoreBundle(bundle, {
      secret: Buffer.from(MASTER, 'utf8'),
      secretKind: 'master'
    });
    for (const label of res.labels) {
      const keys = Object.keys(label).sort();
      assert.deepEqual(keys, ['itemCount', 'jarMeta', 'sourceId']);
      if (label.jarMeta) assert.deepEqual(Object.keys(label.jarMeta).sort(), ['color', 'name']);
    }
    // A byte-scan of the serialized result finds neither the item titles/usernames/passwords
    // nor anything base64-shaped that could be key material.
    const serialized = JSON.stringify(res);
    assert.ok(!serialized.includes('w1p'), 'no item password');
    assert.ok(!serialized.includes('Work Item'), 'no item title');
  } finally {
    rm(src.dir);
    rm(dest.dir);
  }
});

// ---------------------------------------------------------------------------
// Cycle-2 HIGH pin: a malformed-plaintext vault fails AT THE SECRET STEP, nothing written.
// Monkeypatches vc.decryptItems (the vault-restore-fault-injection.test.js idiom) so the
// bundle's ciphertext stays GCM-authentic but its "decrypted" plaintext is malformed.
// ---------------------------------------------------------------------------

test('previewRestoreBundle: a GCM-authentic bundle whose plaintext is malformed fails HERE (VaultFormatError), before any commit could run — validateImportedItems runs on every vault', async () => {
  const src = await makeSourceProfile();
  const dest = destStore();
  const original = vc.decryptItems;
  try {
    const bundle = src.store.exportProfile();
    let call = 0;
    vc.decryptItems = (blob, key, version) => {
      call++;
      if (call === 2) return { not: 'an array' }; // malformed plaintext — GCM already "passed".
      return original(blob, key, version);
    };
    await assert.rejects(
      dest.store.previewRestoreBundle(bundle, { secret: Buffer.from(MASTER, 'utf8'), secretKind: 'master' }),
      (e) => e instanceof vc.VaultFormatError && /item array/.test(e.message)
    );
    assert.equal(dest.store.isSetUp(), false, 'nothing was ever written — the failure is at the secret step');
  } finally {
    vc.decryptItems = original;
    rm(src.dir);
    rm(dest.dir);
  }
});

test('previewRestoreBundle: a duplicate item id within one bundle vault is caught the same way', async () => {
  const src = await makeSourceProfile();
  const dest = destStore();
  const original = vc.decryptItems;
  try {
    const bundle = src.store.exportProfile();
    let call = 0;
    vc.decryptItems = (blob, key, version) => {
      call++;
      if (call === 2) {
        return [
          { type: 'login', id: 'dup', title: 'a', username: 'u', password: 'p' },
          { type: 'login', id: 'dup', title: 'b', username: 'u2', password: 'p2' }
        ];
      }
      return original(blob, key, version);
    };
    await assert.rejects(
      dest.store.previewRestoreBundle(bundle, { secret: Buffer.from(MASTER, 'utf8'), secretKind: 'master' }),
      (e) => e instanceof vc.VaultFormatError && /duplicate item id/.test(e.message)
    );
  } finally {
    vc.decryptItems = original;
    rm(src.dir);
    rm(dest.dir);
  }
});

test('previewRestoreBundle: a lone jarMeta tamper (bad AAD) fails loudly via decryptJarMeta, never a silent unnamed jar', async () => {
  const src = await makeSourceProfile();
  const dest = destStore();
  try {
    const bundle = src.store.exportProfile();
    // Splice the 'work' entry's jarMeta onto a bundle that otherwise looks fine — the AAD
    // binds sourceId, so a spliced envelope fails GCM authentication.
    const workEntry = bundle.vaults.find((v) => v.sourceId === 'work');
    workEntry.jarMeta = { ...workEntry.jarMeta, ct: workEntry.jarMeta.ct.slice(0, -4) + 'AAAA' };
    await assert.rejects(
      dest.store.previewRestoreBundle(bundle, { secret: Buffer.from(MASTER, 'utf8'), secretKind: 'master' }),
      (e) => e instanceof vc.VaultAuthError || e instanceof vc.VaultFormatError
    );
  } finally {
    rm(src.dir);
    rm(dest.dir);
  }
});
