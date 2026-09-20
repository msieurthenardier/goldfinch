'use strict';

// Unit tests for Mission 21 Flight 2 Leg 3 (identity-item-type): the `identity`
// ITEM_TYPES addition, LD2's one-profile-per-vault enforcement at every write path
// (not just saveItem), and DD3's tolerant-and-reporting bundle importer across all
// three `validateImportedItems` call sites. Electron-free: real temp dirs + FAST
// scrypt (the vault-export-import.test.js / vault-restore-merge.test.js idiom).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');
const vc = require('../../src/main/vault/vault-crypto');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';
const JARS = [{ id: 'work', name: 'Work', color: '#000', partition: 'persist:container:work', retentionDays: 30 }];

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vault-identity-item-'));
}
function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
function makeStore(dir, jars = []) {
  return vs.load(dir, { scryptParams: FAST_SCRYPT, listJars: () => jars, now: () => 1000 });
}
function vaultPath(dir, id) {
  return path.join(dir, 'vaults', `${id}.gfvault`);
}
function identityItem(overrides = {}) {
  return { type: 'identity', title: 'Me', fullName: 'Jane Doe', email: 'jane@example.com', ...overrides };
}
// bundle.vaults[0] is always global, then one entry per jar, per _exportProfile's
// deterministic order (the vault-restore-merge.test.js / vault-restore-directives.test.js
// precedent — resolved POSITIONALLY, never by re-decrypting to identify).
function entriesOf(bundle) {
  return { global: bundle.vaults[0].entryHandle, work: bundle.vaults[1] && bundle.vaults[1].entryHandle };
}

/* ---------------------------------------------------------------------------
 * ITEM_TYPES / error-string sanity (DD4)
 * ------------------------------------------------------------------------- */

test('ITEM_TYPES recognizes identity; the two hardcoded validation strings name it', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir, JARS);
    await store.setup({ masterPassword: MASTER });
    // _normalizeItem (via saveItem).
    const saved = store.saveItem('work', identityItem());
    assert.equal(saved.type, 'identity');
    assert.throws(
      () => store.saveItem('work', { type: 'bogus' }),
      (e) => e instanceof vs.VaultStateError && /login\|card\|note\|identity/.test(e.message)
    );
    // saveItemPreservingSecrets's independent type check (the second hardcoded string).
    assert.throws(
      () => store.saveItemPreservingSecrets('work', { type: 'bogus' }, []),
      (e) => e instanceof vs.VaultStateError && /login\|card\|note\|identity/.test(e.message)
    );
  } finally {
    rm(dir);
  }
});

/* ---------------------------------------------------------------------------
 * LD2 — enforced in `_saveItem` (the cheap choke point): a second identity
 * item is REFUSED outright, no write at all.
 * ------------------------------------------------------------------------- */

test('LD2: saveItem refuses a SECOND identity item (different id) — no write, first profile untouched', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir, JARS);
    await store.setup({ masterPassword: MASTER });
    const first = store.saveItem('work', identityItem({ id: 'profile-1' }));
    assert.throws(
      () => store.saveItem('work', identityItem({ id: 'profile-2', fullName: 'Someone Else' })),
      (e) => e instanceof vs.VaultStateError && /only one identity item/.test(e.message)
    );
    const items = store.listItems('work');
    const identities = items.filter((it) => it.type === 'identity');
    assert.equal(identities.length, 1, 'still exactly one identity item');
    assert.equal(identities[0].id, first.id);
    assert.equal(identities[0].fullName, 'Jane Doe', 'the first profile is untouched');
  } finally {
    rm(dir);
  }
});

test('LD2: saveItem freely EDITS the existing identity profile (same id) — no refusal', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir, JARS);
    await store.setup({ masterPassword: MASTER });
    const first = store.saveItem('work', identityItem({ id: 'profile-1' }));
    const updated = store.saveItem('work', identityItem({ id: first.id, fullName: 'Jane Q. Doe' }));
    assert.equal(updated.fullName, 'Jane Q. Doe');
    assert.equal(store.listItems('work').filter((it) => it.type === 'identity').length, 1);
  } finally {
    rm(dir);
  }
});

test('LD2: the FIRST identity item in an empty vault is always allowed (lazy vault creation)', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir, JARS);
    await store.setup({ masterPassword: MASTER });
    const saved = store.saveItem('work', identityItem());
    assert.equal(saved.type, 'identity');
  } finally {
    rm(dir);
  }
});

/* ---------------------------------------------------------------------------
 * partitionImportedItems — DD3's tolerant counterpart to validateImportedItems.
 * ------------------------------------------------------------------------- */

test('partitionImportedItems: drops unrecognized types, reports them, keeps every known item', () => {
  const items = [
    { type: 'login', id: 'a' },
    { type: 'giftcard', id: 'b' },
    { type: 'identity', id: 'c' },
    { type: 'punchcard', id: 'd' }
  ];
  const result = vs.partitionImportedItems(items);
  assert.deepEqual(
    result.items.map((i) => i.id),
    ['a', 'c']
  );
  assert.deepEqual(result.skippedTypes.sort(), ['giftcard', 'punchcard']);
});

test('partitionImportedItems: a bundle where EVERY item is unknown imports nothing and reports everything', () => {
  const items = [
    { type: 'giftcard', id: 'a' },
    { type: 'giftcard', id: 'b' }
  ];
  const result = vs.partitionImportedItems(items);
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.skippedTypes, ['giftcard']);
});

test('partitionImportedItems: skippedTypes is deduped (first-seen order)', () => {
  const items = [
    { type: 'giftcard', id: 'a' },
    { type: 'punchcard', id: 'b' },
    { type: 'giftcard', id: 'c' }
  ];
  const result = vs.partitionImportedItems(items);
  assert.deepEqual(result.skippedTypes, ['giftcard', 'punchcard']);
});

test('partitionImportedItems: STILL throws on genuine corruption — non-array, non-object item, missing/duplicate id', () => {
  assert.throws(() => vs.partitionImportedItems({ not: 'an array' }), /item array/);
  assert.throws(() => vs.partitionImportedItems('nope'), /item array/);
  assert.throws(() => vs.partitionImportedItems([{ type: 'login' }]), /string id/);
  assert.throws(
    () =>
      vs.partitionImportedItems([
        { type: 'login', id: 'x' },
        { type: 'login', id: 'x' }
      ]),
    /duplicate item id/
  );
  // A bad-typed item mixed with a duplicate-id pair still throws — id/shape checks
  // are NOT relaxed, only the type check is.
  assert.throws(
    () =>
      vs.partitionImportedItems([
        { type: 'giftcard', id: 'y' },
        { type: 'login', id: 'y' }
      ]),
    /duplicate item id/
  );
});

test('validateImportedItems (the STRICT, .gfvault-parse-adjacent validator) is UNCHANGED — still throws on any unknown type', () => {
  assert.throws(() => vs.validateImportedItems([{ type: 'bogus', id: 'a' }]), /invalid type/);
  // identity is now recognized, though — no longer "bogus" itself.
  const ok = [{ type: 'identity', id: 'a' }];
  assert.equal(vs.validateImportedItems(ok), ok);
});

/* ---------------------------------------------------------------------------
 * capSingleIdentity — LD2's cap for a bundle vault carrying >1 identity item,
 * independent of any destination.
 * ------------------------------------------------------------------------- */

test('capSingleIdentity: keeps the FIRST identity item, drops the rest, reports the drop', () => {
  const items = [
    { id: 'a', type: 'login' },
    { id: 'i1', type: 'identity', fullName: 'First' },
    { id: 'i2', type: 'identity', fullName: 'Second' },
    { id: 'b', type: 'note' },
    { id: 'i3', type: 'identity', fullName: 'Third' }
  ];
  const result = vs.capSingleIdentity(items);
  assert.deepEqual(
    result.items.map((i) => i.id),
    ['a', 'i1', 'b']
  );
  assert.equal(result.droppedIdentity, true);
});

test('capSingleIdentity: a single identity item, or none, is a pass-through with no drop', () => {
  const items = [
    { id: 'a', type: 'login' },
    { id: 'i1', type: 'identity' }
  ];
  const result = vs.capSingleIdentity(items);
  assert.deepEqual(result, { items, droppedIdentity: false });
  const none = vs.capSingleIdentity([{ id: 'a', type: 'login' }]);
  assert.equal(none.droppedIdentity, false);
});

/* ---------------------------------------------------------------------------
 * mergeVaultItems — LD2's merge-collision ruling: keep destination's identity
 * profile, refuse (and report) the incoming one, whatever its id.
 * ------------------------------------------------------------------------- */

test('mergeVaultItems: a DISJOINT-id incoming identity item is refused when destination already has one', () => {
  const existing = [{ id: 'dest-id', type: 'identity', fullName: 'Destination Person' }];
  const incoming = [{ id: 'incoming-id', type: 'identity', fullName: 'Incoming Person' }];
  const result = vs.mergeVaultItems(existing, incoming);
  assert.equal(result.identitySkipped, true);
  assert.deepEqual(result.items, existing, "destination's profile is untouched; nothing else landed");
  assert.deepEqual(result.mergeReport, { imported: 0, skippedIdentical: 0, conflictCopies: 0 });
});

test('mergeVaultItems: a SAME-id but DIVERGED incoming identity item is ALSO refused — never a conflict copy', () => {
  const existing = [{ id: 'same-id', type: 'identity', fullName: 'Original' }];
  const incoming = [{ id: 'same-id', type: 'identity', fullName: 'Changed' }];
  const result = vs.mergeVaultItems(existing, incoming);
  assert.equal(result.identitySkipped, true);
  assert.deepEqual(result.items, existing);
  assert.equal(result.items.length, 1, 'never a second identity item, even under the same id');
});

test('mergeVaultItems: a SAME-id, byte-IDENTICAL incoming identity item is an ordinary no-op (skippedIdentical)', () => {
  const item = { id: 'same-id', type: 'identity', fullName: 'Same' };
  const existing = [{ ...item }];
  const incoming = [{ ...item }];
  const result = vs.mergeVaultItems(existing, incoming);
  assert.equal(result.identitySkipped, false);
  assert.deepEqual(result.mergeReport, { imported: 0, skippedIdentical: 1, conflictCopies: 0 });
});

test('mergeVaultItems: the FIRST identity item lands normally when destination has none yet', () => {
  const existing = [];
  const incoming = [{ id: 'i1', type: 'identity', fullName: 'New' }];
  const result = vs.mergeVaultItems(existing, incoming);
  assert.equal(result.identitySkipped, false);
  assert.deepEqual(result.items, incoming);
  assert.deepEqual(result.mergeReport, { imported: 1, skippedIdentical: 0, conflictCopies: 0 });
});

test('mergeVaultItems: TWO incoming identity items (a malformed bundle) — first lands, second refused', () => {
  const existing = [];
  const incoming = [
    { id: 'i1', type: 'identity', fullName: 'First' },
    { id: 'i2', type: 'identity', fullName: 'Second' }
  ];
  const result = vs.mergeVaultItems(existing, incoming);
  assert.equal(result.identitySkipped, true);
  assert.deepEqual(
    result.items.map((i) => i.id),
    ['i1']
  );
});

test('mergeVaultItems: identity handling never disturbs the ordinary login/card/note merge behavior', () => {
  const existing = [{ id: 'a', type: 'login', title: 'A', username: 'u', password: 'p' }];
  const incoming = [{ id: 'a', type: 'login', title: 'A', username: 'u', password: 'p' }];
  const result = vs.mergeVaultItems(existing, incoming);
  assert.equal(result.identitySkipped, false);
  assert.deepEqual(result.mergeReport, { imported: 0, skippedIdentical: 1, conflictCopies: 0 });
});

/* ---------------------------------------------------------------------------
 * _importVault (site 1, :2236-ish) — no live caller in src/main (verified);
 * store-only return-shape proof via decryptItems injection (the
 * vault-restore-preview.test.js "cycle-2 HIGH pin" idiom — GCM stays
 * authentic, the "decrypted" plaintext is crafted).
 * ------------------------------------------------------------------------- */

async function makeSourceWithLogin() {
  const dir = tmpDir();
  const store = makeStore(dir);
  await store.setup({ masterPassword: MASTER });
  store.saveItem('global', { type: 'login', title: 'Example', username: 'u', password: 'p', origin: 'https://x' });
  return { dir, store };
}

test('_importVault (fresh profile): an unknown-type item is dropped + reported; known items still land', async () => {
  const src = await makeSourceWithLogin();
  const destDir = tmpDir();
  const dest = makeStore(destDir);
  const original = vc.decryptItems;
  try {
    const bundle = JSON.parse(JSON.stringify(src.store.exportVault('global')));
    vc.decryptItems = () => [
      { type: 'login', id: 'a', title: 'Known', username: 'u', password: 'p' },
      { type: 'giftcard', id: 'b', title: 'Unknown' }
    ];
    const res = await dest.importVault(bundle, { secret: Buffer.from(MASTER, 'utf8'), secretKind: 'master' });
    vc.decryptItems = original; // restore BEFORE reading back — listItems decrypts too.
    assert.equal(res.imported, true);
    assert.equal(res.fresh, true);
    assert.deepEqual(res.skippedTypes, ['giftcard']);
    const items = dest.listItems('global');
    assert.deepEqual(
      items.map((i) => i.id),
      ['a']
    );
  } finally {
    vc.decryptItems = original;
    rm(src.dir);
    rm(destDir);
  }
});

test('_importVault (fresh profile): a bundle vault with TWO identity items caps to one, reports "identity"', async () => {
  const src = await makeSourceWithLogin();
  const destDir = tmpDir();
  const dest = makeStore(destDir);
  const original = vc.decryptItems;
  try {
    const bundle = JSON.parse(JSON.stringify(src.store.exportVault('global')));
    vc.decryptItems = () => [
      { type: 'identity', id: 'i1', title: 'Me', fullName: 'First' },
      { type: 'identity', id: 'i2', title: 'Me', fullName: 'Second' }
    ];
    const res = await dest.importVault(bundle, { secret: Buffer.from(MASTER, 'utf8'), secretKind: 'master' });
    vc.decryptItems = original; // restore BEFORE reading back — listItems decrypts too.
    assert.deepEqual(res.skippedTypes, ['identity']);
    const items = dest.listItems('global');
    const identities = items.filter((i) => i.type === 'identity');
    assert.equal(identities.length, 1);
    assert.equal(identities[0].id, 'i1');
  } finally {
    vc.decryptItems = original;
    rm(src.dir);
    rm(destDir);
  }
});

test('_importVault (existing profile): unknown type reported the same way on the re-key/existing branch', async () => {
  const src = await makeSourceWithLogin();
  const destDir = tmpDir();
  const dest = makeStore(destDir, JARS);
  await dest.setup({ masterPassword: 'a different destination master' });
  const original = vc.decryptItems;
  try {
    const bundle = JSON.parse(JSON.stringify(src.store.exportVault('global')));
    vc.decryptItems = () => [
      { type: 'login', id: 'a', title: 'Known', username: 'u', password: 'p' },
      { type: 'giftcard', id: 'b', title: 'Unknown' }
    ];
    const res = await dest.importVault(bundle, {
      destinationTarget: 'work',
      secret: Buffer.from(MASTER, 'utf8'),
      secretKind: 'master'
    });
    vc.decryptItems = original; // restore BEFORE reading back — listItems decrypts too.
    assert.equal(res.fresh, false);
    assert.deepEqual(res.skippedTypes, ['giftcard']);
    assert.deepEqual(
      dest.listItems('work').map((i) => i.id),
      ['a']
    );
  } finally {
    vc.decryptItems = original;
    rm(src.dir);
    rm(destDir);
  }
});

test('a well-formed bundle (no unknown types) omits skippedTypes entirely — exact-shape unchanged', async () => {
  const src = await makeSourceWithLogin();
  const destDir = tmpDir();
  const dest = makeStore(destDir, JARS);
  await dest.setup({ masterPassword: 'a different destination master' });
  try {
    const bundle = JSON.parse(JSON.stringify(src.store.exportVault('global')));
    const res = await dest.importVault(bundle, {
      destinationTarget: 'work',
      secret: Buffer.from(MASTER, 'utf8'),
      secretKind: 'master'
    });
    assert.deepEqual(res, { imported: true, fresh: false, vaultId: 'work' });
  } finally {
    rm(src.dir);
    rm(destDir);
  }
});

/* ---------------------------------------------------------------------------
 * restoreProfile COMMIT (site 2, :2496-ish) — per-entry exception handling +
 * skippedTypes reporting.
 * ------------------------------------------------------------------------- */

async function makeSourceProfile() {
  const dir = tmpDir();
  const store = makeStore(dir, JARS);
  await store.setup({ masterPassword: MASTER });
  store.saveItem('global', { type: 'login', title: 'Global', username: 'g', password: 'gp' });
  store.saveItem('work', { type: 'login', title: 'Work', username: 'w', password: 'wp' });
  return { dir, store };
}
function destStore() {
  const dir = tmpDir();
  return { dir, store: makeStore(dir, JARS) };
}

test('restoreProfile COMMIT: an unknown-type item lands the vault, reporting what it skipped (no merge)', async () => {
  const src = await makeSourceProfile();
  const dest = destStore();
  const original = vc.decryptItems;
  try {
    const { bundle } = src.store.exportProfile();
    const entries = entriesOf(bundle);
    let call = 0;
    vc.decryptItems = (blob, key, version) => {
      call++;
      if (call === 1) {
        // global entry's decrypted items.
        return [
          { type: 'login', id: 'g1', title: 'Global', username: 'g', password: 'gp' },
          { type: 'giftcard', id: 'g2', title: 'Unknown' }
        ];
      }
      return original(blob, key, version);
    };
    const res = await dest.store.restoreProfile(JSON.parse(JSON.stringify(bundle)), {
      secret: Buffer.from(MASTER, 'utf8'),
      secretKind: 'master',
      mapping: {
        [entries.global]: { directive: 'existing', destination: 'global' },
        [entries.work]: { directive: 'skip' }
      }
    });
    const globalRow = res.results.find((r) => r.entryHandle === entries.global);
    assert.equal(globalRow.outcome, 'landed');
    assert.deepEqual(globalRow.skippedTypes, ['giftcard']);
    assert.deepEqual(
      dest.store.listItems('global').map((i) => i.id),
      ['g1']
    );
  } finally {
    vc.decryptItems = original;
    rm(src.dir);
    rm(dest.dir);
  }
});

test('restoreProfile COMMIT: LD2 merge collision — destination keeps its identity profile, incoming reported skipped', async () => {
  const src = await makeSourceProfile();
  const dest = destStore();
  // Destination is already set up (an EXISTING-profile restore, per the mapping below)
  // and its 'work' jar already has an identity profile.
  await dest.store.setup({ masterPassword: 'a different destination master' });
  dest.store.saveItem('work', identityItem({ id: 'dest-identity', fullName: 'Destination Person' }));
  const original = vc.decryptItems;
  try {
    const { bundle } = src.store.exportProfile();
    const entries = entriesOf(bundle);
    let call = 0;
    vc.decryptItems = (blob, key, version) => {
      call++;
      if (call === 1) {
        // The bundle's OWN 'work' vault items — carries a colliding identity item.
        return [{ type: 'identity', id: 'incoming-identity', title: 'Me', fullName: 'Incoming Person' }];
      }
      return original(blob, key, version); // the destination's own (real) items.
    };
    const res = await dest.store.restoreProfile(JSON.parse(JSON.stringify(bundle)), {
      secret: Buffer.from(MASTER, 'utf8'),
      secretKind: 'master',
      mapping: {
        [entries.global]: { directive: 'skip' },
        [entries.work]: { directive: 'existing', destination: 'work', mode: 'merge' }
      }
    });
    const workRow = res.results.find((r) => r.entryHandle === entries.work);
    assert.equal(workRow.outcome, 'landed');
    assert.deepEqual(workRow.skippedTypes, ['identity']);
    const identities = dest.store.listItems('work').filter((i) => i.type === 'identity');
    assert.equal(identities.length, 1, 'never a second identity profile');
    assert.equal(identities[0].id, 'dest-identity');
    assert.equal(identities[0].fullName, 'Destination Person', "destination's own profile is untouched");
  } finally {
    vc.decryptItems = original;
    rm(src.dir);
    rm(dest.dir);
  }
});

test('restoreProfile COMMIT: a genuinely malformed entry fails ONLY that entry — earlier AND later results survive', async () => {
  const jars = [
    { id: 'work', name: 'Work', color: '#000', partition: 'persist:container:work', retentionDays: 30 },
    { id: 'home', name: 'Home', color: '#111', partition: 'persist:container:home', retentionDays: 30 }
  ];
  const srcDir = tmpDir();
  const src = makeStore(srcDir, jars);
  await src.setup({ masterPassword: MASTER });
  src.saveItem('global', { type: 'login', title: 'Global', username: 'g', password: 'gp' });
  src.saveItem('work', { type: 'login', title: 'Work', username: 'w', password: 'wp' });
  src.saveItem('home', { type: 'login', title: 'Home', username: 'h', password: 'hp' });

  const destDir = tmpDir();
  const dest = makeStore(destDir, jars);
  const original = vc.decryptItems;
  try {
    const { bundle } = src.exportProfile();
    // bundle.vaults = [global, work, home] — the MIDDLE entry ('work') gets malformed
    // (duplicate item id), 'global' (earlier) and 'home' (later) stay real.
    const entries = {
      global: bundle.vaults[0].entryHandle,
      work: bundle.vaults[1].entryHandle,
      home: bundle.vaults[2].entryHandle
    };
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
    const res = await dest.restoreProfile(JSON.parse(JSON.stringify(bundle)), {
      secret: Buffer.from(MASTER, 'utf8'),
      secretKind: 'master',
      mapping: {
        [entries.global]: { directive: 'existing', destination: 'global' },
        [entries.work]: { directive: 'existing', destination: 'work' },
        [entries.home]: { directive: 'existing', destination: 'home' }
      }
    });
    assert.equal(res.results.find((r) => r.entryHandle === entries.global).outcome, 'landed', 'earlier entry survives');
    assert.equal(
      res.results.find((r) => r.entryHandle === entries.work).outcome,
      'failed',
      'the malformed entry alone fails'
    );
    assert.equal(
      res.results.find((r) => r.entryHandle === entries.home).outcome,
      'landed',
      'later entry still processed'
    );
    // `dest` is a FRESH profile and this entry failed, so `anyFailed` skips the
    // manager adopt (ruling 4's residue-recovery contract) — `dest` stays LOCKED
    // (listItems would throw VaultLockedError), so assert against the files
    // actually written to disk instead.
    assert.equal(dest.isSetUp(), false, 'no manager adopted — the residue awaits a rerun');
    assert.ok(fs.existsSync(vaultPath(destDir, 'global')), 'the earlier vault landed on disk');
    assert.ok(fs.existsSync(vaultPath(destDir, 'home')), 'the later vault landed on disk too');
    assert.ok(!fs.existsSync(vaultPath(destDir, 'work')), 'the failed entry wrote nothing');
  } finally {
    vc.decryptItems = original;
    rm(srcDir);
    rm(destDir);
  }
});

/* ---------------------------------------------------------------------------
 * restoreProfile PREVIEW (site 3, :2660-ish) — must report skipped types too,
 * never silently under-count.
 * ------------------------------------------------------------------------- */

test('previewRestoreBundle: itemCount counts only KNOWN items; skippedTypes names the rest', async () => {
  const src = await makeSourceProfile();
  const dest = destStore();
  const original = vc.decryptItems;
  try {
    const { bundle } = src.store.exportProfile();
    const entries = entriesOf(bundle);
    let call = 0;
    vc.decryptItems = (blob, key, version) => {
      call++;
      if (call === 1) {
        return [
          { type: 'login', id: 'g1', title: 'Global', username: 'g', password: 'gp' },
          { type: 'giftcard', id: 'g2', title: 'Unknown' },
          { type: 'punchcard', id: 'g3', title: 'Also unknown' }
        ];
      }
      return original(blob, key, version);
    };
    const res = await dest.store.previewRestoreBundle(bundle, {
      secret: Buffer.from(MASTER, 'utf8'),
      secretKind: 'master'
    });
    const globalLabel = res.labels.find((l) => l.entryHandle === entries.global);
    assert.equal(globalLabel.itemCount, 1, 'only the known login counts');
    assert.deepEqual(globalLabel.skippedTypes.sort(), ['giftcard', 'punchcard']);
    // The OTHER (work) entry is untouched — every entry still resolves; preview
    // never aborts wholesale over a type it merely does not recognize.
    const workLabel = res.labels.find((l) => l.entryHandle === entries.work);
    assert.equal(workLabel.itemCount, 1);
    assert.equal(workLabel.skippedTypes, undefined);
  } finally {
    vc.decryptItems = original;
    rm(src.dir);
    rm(dest.dir);
  }
});

test('previewRestoreBundle: a bundle vault with two identity items reports itemCount=1 and skippedTypes ["identity"]', async () => {
  const src = await makeSourceProfile();
  const dest = destStore();
  const original = vc.decryptItems;
  try {
    const { bundle } = src.store.exportProfile();
    const entries = entriesOf(bundle);
    let call = 0;
    vc.decryptItems = (blob, key, version) => {
      call++;
      if (call === 1) {
        return [
          { type: 'identity', id: 'i1', title: 'Me', fullName: 'First' },
          { type: 'identity', id: 'i2', title: 'Me', fullName: 'Second' }
        ];
      }
      return original(blob, key, version);
    };
    const res = await dest.store.previewRestoreBundle(bundle, {
      secret: Buffer.from(MASTER, 'utf8'),
      secretKind: 'master'
    });
    const globalLabel = res.labels.find((l) => l.entryHandle === entries.global);
    assert.equal(globalLabel.itemCount, 1);
    assert.deepEqual(globalLabel.skippedTypes, ['identity']);
  } finally {
    vc.decryptItems = original;
    rm(src.dir);
    rm(dest.dir);
  }
});

test('previewRestoreBundle: STILL fails the WHOLE preview on genuine corruption (unchanged — malformed, not merely unknown)', async () => {
  const src = await makeSourceProfile();
  const dest = destStore();
  const original = vc.decryptItems;
  try {
    const { bundle } = src.store.exportProfile();
    let call = 0;
    vc.decryptItems = (blob, key, version) => {
      call++;
      if (call === 1) return { not: 'an array' };
      return original(blob, key, version);
    };
    await assert.rejects(
      dest.store.previewRestoreBundle(bundle, { secret: Buffer.from(MASTER, 'utf8'), secretKind: 'master' }),
      (e) => e instanceof vc.VaultFormatError && /item array/.test(e.message)
    );
  } finally {
    vc.decryptItems = original;
    rm(src.dir);
    rm(dest.dir);
  }
});

/* ---------------------------------------------------------------------------
 * The `.gfvault` PARSE path is UNTOUCHED and keeps loading loudly (DD3 softens
 * ONLY the bundle-import item-type check, never parseVault/_readManager).
 * ------------------------------------------------------------------------- */

test('.gfvault parse path: a tampered embedded vault document in an import bundle still throws loudly (importVault)', async () => {
  const src = await makeSourceWithLogin();
  const destDir = tmpDir();
  const dest = makeStore(destDir);
  try {
    const bundle = JSON.parse(JSON.stringify(src.store.exportVault('global')));
    bundle.vault = 'not a vault document'; // tampered — parseVault must reject this, not decrypt-then-discard.
    await assert.rejects(
      dest.importVault(bundle, { secret: Buffer.from(MASTER, 'utf8'), secretKind: 'master' }),
      (e) => e instanceof vc.VaultFormatError
    );
    assert.equal(dest.isSetUp(), false, 'nothing was adopted — the failure is before any write');
  } finally {
    rm(src.dir);
    rm(destDir);
  }
});

test('.gfvault parse path: an unknown-version embedded vault document still throws loudly (restoreProfile)', async () => {
  const src = await makeSourceProfile();
  const dest = destStore();
  try {
    const { bundle } = src.store.exportProfile();
    const entries = entriesOf(bundle);
    // Tamper the GLOBAL entry's embedded .gfvault doc version — parseVault's own
    // format/version gate, never softened by this leg's DD3 work.
    bundle.vaults[0].vault = { ...bundle.vaults[0].vault, version: 999 };
    await assert.rejects(
      dest.store.restoreProfile(JSON.parse(JSON.stringify(bundle)), {
        secret: Buffer.from(MASTER, 'utf8'),
        secretKind: 'master',
        mapping: {
          [entries.global]: { directive: 'existing', destination: 'global' },
          [entries.work]: { directive: 'skip' }
        }
      }),
      (e) => e instanceof vc.VaultFormatError
    );
  } finally {
    rm(src.dir);
    rm(dest.dir);
  }
});
