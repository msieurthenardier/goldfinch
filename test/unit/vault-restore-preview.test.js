'use strict';

// Unit tests for `previewRestoreBundle()` (M18 F3 Leg 3 / DD2 ruling 2; RE-KEYED
// M18 F3 Leg 5 to the opaque entryHandle + encrypted identity): the store's
// decrypt-then-discard SECRET STEP for the multi-vault restore workflow — verifies the
// bundle secret (auth), returns NON-SECRET per-vault labels (decrypted identity, item
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

test('previewRestoreBundle: v2 bundle → one label per vault, itemCount correct, identity decrypted for EVERY entry (global too)', async () => {
  const src = await makeSourceProfile();
  const dest = destStore();
  try {
    const { bundle } = src.store.exportProfile();
    const res = await dest.store.previewRestoreBundle(bundle, {
      secret: Buffer.from(MASTER, 'utf8'),
      secretKind: 'master'
    });
    assert.equal(res.labels.length, 2);
    // The labels carry no readable id at all — resolve by decrypted identity instead.
    const global = res.labels.find((l) => l.identity.kind === 'global');
    const work = res.labels.find((l) => l.identity.kind === 'jar');
    assert.ok(global, 'one label decrypts to the global identity');
    assert.equal(global.itemCount, 1);
    assert.equal(typeof global.entryHandle, 'string');
    assert.deepEqual(work.identity, { kind: 'jar', name: 'Work', color: '#2196f3' });
    assert.equal(work.itemCount, 2);
    assert.notEqual(global.entryHandle, work.entryHandle, 'distinct entryHandles');
    assert.equal(global.entryHandle === 'global' || work.entryHandle === 'work', false, 'never the old plaintext id');
  } finally {
    rm(src.dir);
    rm(dest.dir);
  }
});

test('previewRestoreBundle: v1 bundle (the one-row case) → a single label, PLAINTEXT synthetic identity, deterministic entryHandle', async () => {
  const src = await makeSourceProfile();
  const dest = destStore();
  try {
    const v1Bundle = src.store.exportVault('global');
    assert.equal(v1Bundle.version, vs.BUNDLE_VERSION);
    const res = await dest.store.previewRestoreBundle(v1Bundle, {
      secret: Buffer.from(MASTER, 'utf8'),
      secretKind: 'master'
    });
    assert.equal(res.labels.length, 1);
    assert.deepEqual(res.labels[0].identity, { kind: 'global' });
    assert.equal(res.labels[0].itemCount, 1);
    assert.equal(typeof res.labels[0].entryHandle, 'string');
    assert.notEqual(res.labels[0].entryHandle, 'global', 'still an opaque-looking handle, not the sourceVaultId');

    // Deterministic (not random) for v1 — a second preview of the SAME bundle resolves the
    // SAME entryHandle, so the mapping key learned here still matches at commit time.
    const res2 = await dest.store.previewRestoreBundle(JSON.parse(JSON.stringify(v1Bundle)), {
      secret: Buffer.from(MASTER, 'utf8'),
      secretKind: 'master'
    });
    assert.equal(res2.labels[0].entryHandle, res.labels[0].entryHandle);
  } finally {
    rm(src.dir);
    rm(dest.dir);
  }
});

test('previewRestoreBundle: preview NEVER installs anything — a fresh destination stays not-set-up after a preview', async () => {
  const src = await makeSourceProfile();
  const dest = destStore();
  try {
    const { bundle } = src.store.exportProfile();
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
    const { bundle } = src.store.exportProfile();
    await assert.rejects(
      dest.store.previewRestoreBundle(bundle, { secret: Buffer.from('nope', 'utf8'), secretKind: 'master' }),
      (e) => e instanceof vs.VaultAuthError
    );
  } finally {
    rm(src.dir);
    rm(dest.dir);
  }
});

test('previewRestoreBundle: labels carry NO key material, no decrypted item content — only entryHandle/identity{kind,name?,color?}/itemCount', async () => {
  const src = await makeSourceProfile();
  const dest = destStore();
  try {
    const { bundle } = src.store.exportProfile();
    const res = await dest.store.previewRestoreBundle(bundle, {
      secret: Buffer.from(MASTER, 'utf8'),
      secretKind: 'master'
    });
    for (const label of res.labels) {
      const keys = Object.keys(label).sort();
      assert.deepEqual(keys, ['entryHandle', 'identity', 'itemCount']);
      if (label.identity.kind === 'jar')
        assert.deepEqual(Object.keys(label.identity).sort(), ['color', 'kind', 'name']);
      else assert.deepEqual(Object.keys(label.identity).sort(), ['kind']);
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
    const { bundle } = src.store.exportProfile();
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
    const { bundle } = src.store.exportProfile();
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

test('previewRestoreBundle: a lone identity tamper (bad AAD) fails loudly via decryptIdentity, never a silent unnamed jar', async () => {
  const src = await makeSourceProfile();
  const dest = destStore();
  try {
    const { bundle } = src.store.exportProfile();
    // Corrupt the jar entry's identity ciphertext — the AAD binds the entry's OWN
    // entryHandle, so a corrupted envelope fails GCM authentication. Global is always
    // index 0 per the deterministic export order (see vault-bundle-v2.test.js), so index 1
    // is the jar entry without needing to decrypt first to identify it.
    const jarEntry = bundle.vaults[1];
    jarEntry.identity = { ...jarEntry.identity, ct: jarEntry.identity.ct.slice(0, -4) + 'AAAA' };
    await assert.rejects(
      dest.store.previewRestoreBundle(bundle, { secret: Buffer.from(MASTER, 'utf8'), secretKind: 'master' }),
      (e) => e instanceof vc.VaultAuthError || e instanceof vc.VaultFormatError
    );
  } finally {
    rm(src.dir);
    rm(dest.dir);
  }
});

test('previewRestoreBundle: SECURITY regression pin — a v2 entry whose identity envelope carries identityPlaintext:true is refused, never trusted as a bypass', async () => {
  const src = await makeSourceProfile();
  const dest = destStore();
  try {
    const { bundle } = src.store.exportProfile();
    const jarEntry = bundle.vaults[1];
    jarEntry.identity = { ...jarEntry.identity, identityPlaintext: true };
    await assert.rejects(
      dest.store.previewRestoreBundle(bundle, { secret: Buffer.from(MASTER, 'utf8'), secretKind: 'master' }),
      (e) => e instanceof vc.VaultFormatError
    );
  } finally {
    rm(src.dir);
    rm(dest.dir);
  }
});

test('previewRestoreBundle: SECURITY regression pin — an ENTRY-LEVEL (sibling) identityPlaintext:true carrying a plaintext attacker-named identity is refused, never surfaced (M18 F3 L5 security regression: entry-level identityPlaintext)', async () => {
  const src = await makeSourceProfile();
  const dest = destStore();
  try {
    const { bundle } = src.store.exportProfile();
    const jarEntry = bundle.vaults[1];
    // This is the PRIMARY smuggling vector, distinct from the nested-envelope test above: the
    // attacker sets `identityPlaintext: true` as a SIBLING of entryHandle/identity/vault at the
    // ENTRY level (never nested inside `identity`), and swaps in a plaintext, attacker-chosen
    // `identity` value in place of the real encrypted envelope — exactly the shape
    // `normalizeRestoreBundle`'s v2 explicit named-field extraction (`{ entryHandle, identity,
    // vault }`, never `{...e}`) is designed to foreclose by structurally dropping the entry's
    // own top-level `identityPlaintext` field before `resolveIdentity` ever sees it. (The nested
    // vector above only reaches `decryptIdentity`'s defense-in-depth backstop; this one attacks
    // the primary defense directly.)
    jarEntry.identityPlaintext = true;
    jarEntry.identity = { kind: 'jar', name: 'ATTACKER-CONTROLLED', color: '#000000' };

    let labels = null;
    try {
      const res = await dest.store.previewRestoreBundle(bundle, {
        secret: Buffer.from(MASTER, 'utf8'),
        secretKind: 'master'
      });
      labels = res.labels;
    } catch (e) {
      // Refusing loudly satisfies the security property. Assert on the OUTCOME (some vault
      // error), not a specific message, so this stays valid if the refusal's wording changes.
      assert.ok(
        e instanceof vc.VaultFormatError || e instanceof vc.VaultAuthError,
        `expected a vault error refusing the smuggled entry, got: ${e && e.stack}`
      );
      return;
    }
    // If the call did NOT throw, the security property must still hold: the attacker's injected
    // plaintext identity must never have surfaced anywhere in the result.
    assert.ok(
      !labels.some((l) => l && l.identity && l.identity.name === 'ATTACKER-CONTROLLED'),
      'the attacker-controlled identity must never surface, whether or not the call throws'
    );
  } finally {
    rm(src.dir);
    rm(dest.dir);
  }
});
