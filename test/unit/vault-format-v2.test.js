'use strict';

// Mission 23 Flight 2 leg `vault-format-v2` (DD6): version 2 is what the app WRITES anew; version-1
// files keep opening and are never rewritten by this leg. The version-1 inputs are built by the
// independent oracle (`test/helpers/vault-oracle.js`, raw node:crypto), never by the code under test.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const vs = require('../../src/main/vault/vault-store');
const vc = require('../../src/main/vault/vault-crypto');
const { maskComments } = require('../helpers/source-scan');
const {
  MASTER,
  tmpDir,
  rm,
  vaultFile,
  readDoc,
  bytesOf,
  makeStore,
  makeProfile,
  sampleItems,
  identityItem,
  openFile,
  oracle
} = require('../helpers/vault-profile-fixture');

const byId = (items) => [...items].sort((a, b) => (a.id < b.id ? -1 : 1));

// ---------------------------------------------------------------------------
// AC1(a) - the oracle and the store's own reader agree
// ---------------------------------------------------------------------------

test('oracle: a version-1 file built with raw node:crypto opens through the store, by master key and by access key', async () => {
  const access = oracle.newAccessKey();
  const items = [...sampleItems('work'), identityItem('work')];
  const p = await makeProfile({ v1: { work: { items, accessKeys: [access] } } });
  try {
    assert.equal(readDoc(p.dir, 'work').version, 1);
    assert.deepEqual(byId(p.store.listItems('work')), byId(items));
    const { key, keyId } = p.store.openVaultWithAccessKey('work', access.secret);
    assert.equal(keyId, access.keyId);
    assert.ok(key.equals(p.v1Keys.work));
    assert.deepEqual(byId(p.store.readVaultItems('work', key)), byId(items));
    // and the oracle reads what the store writes at version 2 (hand-written AADs)
    p.store.saveItem('play', { type: 'login', title: 'P', username: 'u', password: 'p', origin: 'https://p.example' });
    const doc = readDoc(p.dir, 'play');
    assert.equal(doc.version, 2);
    assert.equal(oracle.openWithMaster(doc, p.store.mrk, 'play').items[0].title, 'P');
  } finally {
    rm(p.dir);
  }
});

// ---------------------------------------------------------------------------
// AC2 - version 2 is written for new files; rewriters keep the document's version
// ---------------------------------------------------------------------------

test('AC2: setup, a jar lazy first write and a manager-less read are version 2, bound to the slot id', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    store.saveItem('work', { type: 'login', title: 'W', username: 'u', password: 'p', origin: 'https://w.example' });
    for (const id of ['global', 'work']) {
      const doc = readDoc(dir, id);
      assert.equal(doc.version, 2);
      assert.equal(doc.vaultId, id);
      assert.equal(openFile(dir, id, store.mrk).items.length, id === 'global' ? 0 : 1);
    }
  } finally {
    rm(dir);
  }
});

test('AC2: a save, a delete, an import of logins and a confirmedOrigins record into a version-1 file leave it version 1 and readable', async () => {
  const items = [...sampleItems('work'), identityItem('work')];
  const p = await makeProfile({ v1: { work: { items } } });
  try {
    const { store, dir } = p;
    const expectV1 = (label) => {
      const doc = readDoc(dir, 'work');
      assert.equal(doc.version, 1, `${label}: still version 1`);
      return openFile(dir, 'work', store.mrk).items; // oracle at version 1
    };
    store.saveItem('work', {
      id: 'extra',
      type: 'login',
      title: 'Extra',
      username: 'u',
      password: 'p',
      origin: 'https://x.example'
    });
    assert.ok(expectV1('save').some((i) => i.id === 'extra'));
    store.deleteItem('work', 'extra');
    assert.ok(!expectV1('delete').some((i) => i.id === 'extra'));
    const imp = store.importLogins(
      'work',
      [{ line: 2, title: 'Imp', origin: 'https://imp.example', username: 'iu', password: 'ip' }],
      { mode: 'merge' }
    );
    assert.equal(imp.written, true);
    assert.ok(expectV1('import logins').some((i) => i.title === 'Imp'));
    assert.deepEqual(store.recordConfirmedOrigin('work', 'work-card', 'https://new.example'), { recorded: true });
    const card = expectV1('confirmedOrigins').find((i) => i.id === 'work-card');
    assert.deepEqual(card.confirmedOrigins, ['https://shop.example', 'https://new.example']);
    store.saveItemPreservingSecrets('work', { id: 'work-login', type: 'login', title: 'Renamed' }, [
      'password',
      'totp',
      'notes'
    ]);
    assert.equal(expectV1('preserving save').find((i) => i.id === 'work-login').title, 'Renamed');
    // the store itself still lists it
    assert.ok(store.listItems('work').length >= items.length);
  } finally {
    rm(p.dir);
  }
});

for (const version of [1, 2]) {
  test(`AC2: minting and revoking an access key on a version-${version} file leave it readable by master key and by its access keys`, async () => {
    const first = oracle.newAccessKey();
    const items = sampleItems('work');
    const p =
      version === 1
        ? await makeProfile({ v1: { work: { items, accessKeys: [first] } } })
        : await makeProfile({ v2: { work: { items } } });
    try {
      const { store, dir } = p;
      const minted = await store.mintAccessKey('work', { masterPassword: MASTER });
      const after = readDoc(dir, 'work');
      assert.equal(after.version, version, 'mint keeps the version');
      assert.equal(after.vaultId, 'work');
      const expected = byId(store.listItems('work'));
      const keys = version === 1 ? [first, minted] : [minted];
      for (const k of keys) {
        const opened = store.openVaultWithAccessKey('work', k.secret);
        assert.deepEqual(byId(store.readVaultItems('work', opened.key)), expected);
        assert.ok(oracle.openAccessEnvelope(after, k.secret).equals(opened.key), 'the oracle opens it too');
      }
      assert.equal(store.revokeAccessKey('work', minted.keyId), true);
      const revoked = readDoc(dir, 'work');
      assert.equal(revoked.version, version, 'revoke keeps the version');
      assert.throws(() => store.openVaultWithAccessKey('work', minted.secret), vc.VaultAuthError);
      assert.deepEqual(byId(store.listItems('work')), expected);
      if (version === 1) {
        assert.ok(store.openVaultWithAccessKey('work', first.secret).key.length === 32);
        assert.deepEqual(openFile(dir, 'work', store.mrk).items.length, expected.length);
      }
    } finally {
      rm(p.dir);
    }
  });
}

test('AC2: a restart reads both versions (a fresh store on the same directory)', async () => {
  const p = await makeProfile({
    v1: { work: { items: sampleItems('work') } },
    v2: { play: { items: sampleItems('play') } }
  });
  try {
    const before = { work: byId(p.store.listItems('work')), play: byId(p.store.listItems('play')) };
    const again = makeStore(p.dir);
    await again.unlock(MASTER);
    assert.deepEqual(byId(again.listItems('work')), before.work);
    assert.deepEqual(byId(again.listItems('play')), before.play);
  } finally {
    rm(p.dir);
  }
});

// ---------------------------------------------------------------------------
// AC3 - a swapped version-2 file is refused at every reader, for the right reason
// ---------------------------------------------------------------------------

async function twoV2Vaults() {
  const p = await makeProfile({ v2: { work: { items: sampleItems('A') }, play: { items: sampleItems('B') } } });
  const access = await p.store.mintAccessKey('work', { masterPassword: MASTER }); // A's access key (jar `work`)
  return { ...p, access };
}

const editField = (dir, slot, field) => {
  const doc = readDoc(dir, slot);
  doc.vaultId = field;
  fs.writeFileSync(vaultFile(dir, slot), JSON.stringify(doc));
};

test("AC3: A's file in B's slot with its own field is refused with VaultWrongVaultError at the human path, the admin path and the access-key path", async () => {
  const p = await twoV2Vaults();
  try {
    const bBytes = bytesOf(p.dir, 'play');
    fs.copyFileSync(vaultFile(p.dir, 'work'), vaultFile(p.dir, 'play'));
    const swapped = bytesOf(p.dir, 'play');
    const fresh = makeStore(p.dir);
    await fresh.unlock(MASTER);
    // (i) human list / reveal / metadata
    assert.throws(() => fresh.listItems('play'), vs.VaultWrongVaultError);
    assert.throws(() => fresh.revealItem('play', 'A-login'), vs.VaultWrongVaultError);
    assert.throws(() => fresh.listItemsMeta('play'), vs.VaultWrongVaultError);
    // (ii) the admin-key path
    assert.throws(() => fresh.openAllWithAdminKey(p.admin), vs.VaultWrongVaultError);
    // (iii) the access-key path: refused at the read, never A's key and never A's items
    assert.throws(() => fresh.openVaultWithAccessKey('play', p.access.secret), vs.VaultWrongVaultError);
    // never a quarantine, never a rewrite
    assert.ok(swapped.equals(bytesOf(p.dir, 'play')), 'the file is untouched by the refusals');
    assert.deepEqual(
      fs.readdirSync(`${p.dir}/vaults`).filter((n) => /corrupt|quarantine/.test(n)),
      []
    );
    // B's own file back: B opens
    fs.writeFileSync(vaultFile(p.dir, 'play'), bBytes);
    assert.equal(fresh.listItems('play').length, 3);
    assert.equal(fresh.openAllWithAdminKey(p.admin).size, 3);
  } finally {
    rm(p.dir);
  }
});

test("AC3: with the plaintext vaultId edited to B, every reader still refuses - authentication failure - and the access key yields A's key but not the items", async () => {
  const p = await twoV2Vaults();
  try {
    const bBytes = bytesOf(p.dir, 'play');
    fs.copyFileSync(vaultFile(p.dir, 'work'), vaultFile(p.dir, 'play'));
    editField(p.dir, 'play', 'play');
    const swapped = bytesOf(p.dir, 'play');
    const fresh = makeStore(p.dir);
    await fresh.unlock(MASTER);
    assert.throws(() => fresh.listItems('play'), vc.VaultAuthError); // key envelope names the slot
    assert.throws(() => fresh.revealItem('play', 'A-login'), vc.VaultAuthError);
    assert.throws(() => fresh.openAllWithAdminKey(p.admin), vc.VaultAuthError);
    // the access envelope's AAD has no id: A's access key opens A's key from the file in B's slot ...
    const { key } = fresh.openVaultWithAccessKey('play', p.access.secret);
    assert.ok(key.length === 32);
    // ... and the items AAD for B stops the read
    assert.throws(() => fresh.readVaultItems('play', key), vc.VaultAuthError);
    assert.ok(swapped.equals(bytesOf(p.dir, 'play')));
    assert.deepEqual(
      fs.readdirSync(`${p.dir}/vaults`).filter((n) => /corrupt|quarantine/.test(n)),
      []
    );
    fs.writeFileSync(vaultFile(p.dir, 'play'), bBytes);
    assert.equal(fresh.listItems('play').length, 3);
  } finally {
    rm(p.dir);
  }
});

// ---------------------------------------------------------------------------
// AC4 - a version cannot be relabelled
// ---------------------------------------------------------------------------

test('AC4: a version-2 file relabelled 1 and an oracle version-1 file relabelled 2 both fail to open', async () => {
  const p = await makeProfile({
    v1: { work: { items: sampleItems('work') } },
    v2: { play: { items: sampleItems('play') } }
  });
  try {
    const relabel = (slot, version) => {
      const doc = readDoc(p.dir, slot);
      doc.version = version;
      fs.writeFileSync(vaultFile(p.dir, slot), JSON.stringify(doc));
    };
    relabel('play', 1);
    relabel('work', 2);
    const fresh = makeStore(p.dir);
    await fresh.unlock(MASTER);
    assert.throws(() => fresh.listItems('play'), vc.VaultAuthError);
    assert.throws(() => fresh.listItems('work'), vc.VaultAuthError);
    assert.throws(() => fresh.openAllWithAdminKey(p.admin), vc.VaultAuthError);
  } finally {
    rm(p.dir);
  }
});

// ---------------------------------------------------------------------------
// AC5 - a mixed profile works, each file at its own version
// ---------------------------------------------------------------------------

test('AC5: a profile holding a version-1 jar vault beside version-2 vaults - every operation works on each file at its own version', async () => {
  const access = oracle.newAccessKey();
  const v1Items = [...sampleItems('old'), identityItem('old')];
  const p = await makeProfile({
    v1: { work: { items: v1Items, accessKeys: [access] } },
    v2: { play: { items: sampleItems('new') } }
  });
  try {
    const { store, dir } = p;
    const versions = () => ({
      global: readDoc(dir, 'global').version,
      work: readDoc(dir, 'work').version,
      play: readDoc(dir, 'play').version
    });
    assert.deepEqual(versions(), { global: 2, work: 1, play: 2 });

    // list and reveal, on each
    assert.deepEqual(byId(store.listItems('work')), byId(v1Items));
    assert.equal(store.revealItem('work', 'old-login').password, 'old-pw');
    assert.equal(store.revealItem('play', 'new-login').password, 'new-pw');
    assert.equal(store.listItemsMeta('work').length, v1Items.length);

    // save and delete, on each
    store.saveItem('work', {
      id: 'w2',
      type: 'login',
      title: 'W2',
      username: 'u',
      password: 'p',
      origin: 'https://w2.example'
    });
    store.saveItem('play', {
      id: 'p2',
      type: 'login',
      title: 'P2',
      username: 'u',
      password: 'p',
      origin: 'https://p2.example'
    });
    store.deleteItem('work', 'w2');
    store.deleteItem('play', 'p2');
    assert.deepEqual(versions(), { global: 2, work: 1, play: 2 });

    // copy in both directions; confirmedOrigins stripped (as today)
    assert.equal(store.copyItem('work', 'old-identity', 'play').outcome, 'copied');
    assert.equal(store.copyItem('play', 'new-login', 'work').outcome, 'copied');
    const copied = store.listItems('play').find((i) => i.type === 'identity');
    assert.ok(copied && copied.email === 'ada@example.com');
    assert.equal(copied.confirmedOrigins, undefined, 'confirmedOrigins is not carried into another vault');
    assert.ok(store.listItems('work').some((i) => i.title === 'new login'));
    assert.deepEqual(versions(), { global: 2, work: 1, play: 2 });
    assert.equal(
      openFile(dir, 'work', store.mrk).items.length,
      v1Items.length + 1,
      'the version-1 file reads at version 1'
    );
    assert.equal(openFile(dir, 'play', store.mrk).items.length, 4);

    // access keys: mint on each, open, revoke
    const mintedWork = await store.mintAccessKey('work', { masterPassword: MASTER });
    const mintedPlay = await store.mintAccessKey('play', { masterPassword: MASTER });
    const keyWork = store.openVaultWithAccessKey('work', access.secret);
    assert.deepEqual(
      byId(store.readVaultItems('work', keyWork.key)),
      byId(store.listItems('work')),
      'automation read, version 1'
    );
    const keyPlay = store.openVaultWithAccessKey('play', mintedPlay.secret);
    assert.deepEqual(
      byId(store.readVaultItems('play', keyPlay.key)),
      byId(store.listItems('play')),
      'automation read, version 2'
    );
    assert.ok(store.openVaultWithAccessKey('work', mintedWork.secret).key.equals(keyWork.key));
    assert.equal(store.revokeAccessKey('work', mintedWork.keyId), true);
    assert.equal(store.revokeAccessKey('play', mintedPlay.keyId), true);

    // admin key: every vault, each at its own version
    const all = store.openAllWithAdminKey(p.admin);
    assert.deepEqual([...all.keys()].sort(), ['global', 'play', 'work']);
    assert.deepEqual(byId(store.readVaultItems('work', all.get('work'))), byId(store.listItems('work')));
    assert.deepEqual(byId(store.readVaultItems('play', all.get('play'))), byId(store.listItems('play')));
    assert.deepEqual(versions(), { global: 2, work: 1, play: 2 });

    // a restart still reads all three
    const again = makeStore(dir);
    await again.unlock(MASTER);
    assert.deepEqual(byId(again.listItems('work')), byId(store.listItems('work')));
    assert.deepEqual(byId(again.listItems('play')), byId(store.listItems('play')));
  } finally {
    rm(p.dir);
  }
});

test('an automation session holding a vault key reads across a rewrite of the file (keys do not change)', async () => {
  const access = oracle.newAccessKey();
  const p = await makeProfile({ v1: { work: { items: sampleItems('old'), accessKeys: [access] } } });
  try {
    const { key } = p.store.openVaultWithAccessKey('work', access.secret);
    const before = p.store.readVaultItems('work', key).length;
    p.store.saveItem('work', {
      id: 'added',
      type: 'login',
      title: 'Added',
      username: 'u',
      password: 'p',
      origin: 'https://a.example'
    });
    assert.equal(p.store.readVaultItems('work', key).length, before + 1, 'the same key reads the rewritten file');
    assert.equal(readDoc(p.dir, 'work').version, 1);
  } finally {
    rm(p.dir);
  }
});

// ---------------------------------------------------------------------------
// Source scans
// ---------------------------------------------------------------------------

test("source scan: no slot read chooses its decrypt id from the document's own vaultId field", () => {
  const src = maskComments(fs.readFileSync(require.resolve('../../src/main/vault/vault-store.js'), 'utf8'));
  // every `doc.vaultId` / `.vaultId` read in the store is a comparison or a stamp, never an AAD/decrypt argument
  const lines = src.split('\n');
  const offenders = lines.filter((l) =>
    /(mrkEnvelopeAad|itemsAad|decryptItems|encryptItems|unwrapVaultKey)\(.*\b\w*[dD]oc\w*\.vaultId/.test(l)
  );
  assert.deepEqual(offenders, []);
  assert.ok(!/embeddedVaultId/.test(src), 'the embedded-id helper is gone: bundle ids come from bindId');
  assert.ok(/bundleBindId\(/.test(src), 'vacuity floor: the bundle binding helper is in use');
});
