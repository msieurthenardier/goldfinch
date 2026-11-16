'use strict';

// Mission 23 Flight 2 leg `vault-format-v2` (DD6): every bundle path, driven end to end through the
// public API. Each round trip ends in a FRESH store instance on the destination directory, unlocked,
// with every item deep-equal to the source and every file version 2 bound to its destination id.
// Version-1 inputs come from the independent oracle (`test/helpers/vault-oracle.js`).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const vs = require('../../src/main/vault/vault-store');
const vc = require('../../src/main/vault/vault-crypto');
const {
  MASTER,
  tmpDir,
  rm,
  vaultFile,
  readDoc,
  makeStore,
  makeProfile,
  sampleItems,
  identityItem,
  openFile,
  oracle
} = require('../helpers/vault-profile-fixture');

const byId = (items) => [...items].sort((a, b) => (a.id < b.id ? -1 : 1));
const secret = () => Buffer.from(MASTER, 'utf8');

/** A jar registry that can grow (a fake of jars.js's add/verify), for a fresh adopt's 'new' directive. */
function jarDeps(seed = []) {
  const containers = seed.map((c) => ({ ...c }));
  return {
    listJars: () => containers,
    createJar: (name, color) => {
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const c = { id, name, color, partition: `persist:container:${id}`, retentionDays: 30 };
      containers.push(c);
      return c;
    },
    verifyJarPersisted: (id) => containers.some((c) => c.id === id)
  };
}

/** Every file in `dir` is version 2, bound to its slot id (oracle, raw node:crypto), and a fresh store reads `expected`. */
async function assertLanded(dir, expected, extraDeps = {}) {
  const fresh = makeStore(dir, extraDeps);
  await fresh.unlock(MASTER);
  for (const [id, items] of Object.entries(expected)) {
    const doc = readDoc(dir, id);
    assert.equal(doc.version, 2, `${id}: version 2`);
    assert.equal(doc.vaultId, id, `${id}: bound to its destination id`);
    assert.deepEqual(byId(openFile(dir, id, fresh.mrk, id).items), byId(items), `${id}: oracle at version 2`);
    assert.deepEqual(byId(fresh.listItems(id)), byId(items), `${id}: fresh store, deep-equal`);
  }
  return fresh;
}

/** A mixed source profile: global (v2), work (v1, oracle, with an access key), play (v2). */
async function mixedSource() {
  const access = oracle.newAccessKey();
  const p = await makeProfile({
    v1: { work: { items: [...sampleItems('old'), identityItem('old')], accessKeys: [access] } },
    v2: { play: { items: sampleItems('new') } }
  });
  p.store.saveItem('global', {
    id: 'g1',
    type: 'login',
    title: 'G',
    username: 'g',
    password: 'gp',
    origin: 'https://g.example'
  });
  const expected = {
    global: p.store.listItems('global'),
    work: p.store.listItems('work'),
    play: p.store.listItems('play')
  };
  return { ...p, access, expected };
}

const mappingFor = (bundle, dests, mode) => {
  const map = {};
  bundle.vaults.forEach((e, i) => {
    map[e.entryHandle] = { directive: 'existing', destination: dests[i], ...(mode ? { mode } : {}) };
  });
  return map;
};

// ---------------------------------------------------------------------------
// AC6 - single-vault export and import
// ---------------------------------------------------------------------------

test('AC6: exporting a version-2 vault embeds its document verbatim, with its real id', async () => {
  const p = await makeProfile({ v2: { play: { items: sampleItems('p') } } });
  try {
    const bundle = p.store.exportVault('play');
    assert.equal(bundle.sourceVaultId, 'play');
    assert.equal(bundle.vault.version, 2);
    assert.equal(bundle.vault.vaultId, 'play');
    assert.deepEqual(bundle.vault, readDoc(p.dir, 'play'));
  } finally {
    rm(p.dir);
  }
});

test("AC6: importVault decrypts with the bundle's id and writes version 2 bound to the DESTINATION id (a different one)", async () => {
  const src = await makeProfile({ v2: { play: { items: sampleItems('p') } } });
  const dst = await makeProfile({});
  try {
    const bundle = JSON.parse(JSON.stringify(src.store.exportVault('play')));
    const r = await dst.store.importVault(bundle, {
      destinationTarget: 'third',
      secret: secret(),
      secretKind: 'master'
    });
    assert.equal(r.vaultId, 'third');
    await assertLanded(dst.dir, { third: src.store.listItems('play') });
  } finally {
    rm(src.dir);
    rm(dst.dir);
  }
});

test('AC6: a fresh adopt of a version-2 single-vault bundle lands global, version 2, openable after a restart', async () => {
  const src = await makeProfile({ v2: { play: { items: sampleItems('p') } } });
  const dir = tmpDir();
  try {
    const bundle = JSON.parse(JSON.stringify(src.store.exportVault('play')));
    const adopter = makeStore(dir);
    const r = await adopter.importVault(bundle, { secret: secret(), secretKind: 'master' });
    assert.equal(r.fresh, true);
    await assertLanded(dir, { global: src.store.listItems('play') });
  } finally {
    rm(src.dir);
    rm(dir);
  }
});

test('AC6: an edited embedded id fails clearly (a format error before the secret is tried), not as a wrong password', async () => {
  const src = await makeProfile({ v2: { play: { items: sampleItems('p') }, work: { items: sampleItems('w') } } });
  const dst = await makeProfile({});
  try {
    const good = JSON.parse(JSON.stringify(src.store.exportVault('play')));
    const goodWork = JSON.parse(JSON.stringify(src.store.exportVault('work')));
    const badField = JSON.parse(JSON.stringify(good));
    badField.vault.vaultId = 'work';
    const badSource = JSON.parse(JSON.stringify(good));
    badSource.sourceVaultId = 'work';
    // the restore's mapping is keyed by the synthetic handle, which is a function of sourceVaultId only
    const handleOf = async (b) => (await src.store.previewRestoreBundle(b, { secret: secret() })).labels[0].entryHandle;
    const cases = [
      [badField, await handleOf(good)],
      [badSource, await handleOf(goodWork)]
    ];
    const wrong = () => Buffer.from('not the password');
    for (const [bundle, handle] of cases) {
      // a WRONG secret on purpose: were the secret tried first, this would be VaultAuthError
      await assert.rejects(
        dst.store.importVault(bundle, { destinationTarget: 'third', secret: wrong(), secretKind: 'master' }),
        (e) => e instanceof vc.VaultFormatError && !(e instanceof vc.VaultAuthError)
      );
      await assert.rejects(
        dst.store.restoreProfile(bundle, {
          secret: wrong(),
          mapping: { [handle]: { directive: 'existing', destination: 'third' } }
        }),
        (e) => e instanceof vc.VaultFormatError && !(e instanceof vc.VaultAuthError)
      );
      await assert.rejects(
        dst.store.previewRestoreBundle(bundle, { secret: wrong() }),
        (e) => e instanceof vc.VaultFormatError && !(e instanceof vc.VaultAuthError)
      );
    }
    assert.equal(fs.existsSync(vaultFile(dst.dir, 'third')), false, 'nothing written');
  } finally {
    rm(src.dir);
    rm(dst.dir);
  }
});

test('AC6: a version-1 single-vault bundle (oracle-built document) imports and produces version 2', async () => {
  const src = await makeProfile({ v1: { work: { items: [...sampleItems('old'), identityItem('old')] } } });
  const dst = await makeProfile({});
  try {
    const bundle = JSON.parse(JSON.stringify(src.store.exportVault('work')));
    assert.equal(bundle.vault.version, 1, "the embedded document is the oracle's version 1");
    await dst.store.importVault(bundle, { destinationTarget: 'third', secret: secret(), secretKind: 'master' });
    await assertLanded(dst.dir, { third: src.store.listItems('work') });
  } finally {
    rm(src.dir);
    rm(dst.dir);
  }
});

// ---------------------------------------------------------------------------
// AC7 - profile export
// ---------------------------------------------------------------------------

test('AC7: profile export rebuilds every entry as version 2 bound to its handle; no real jar id, no access envelope; a mixed profile works', async () => {
  const src = await mixedSource();
  try {
    await src.store.mintAccessKey('play', { masterPassword: MASTER }); // a version-2 file with an access envelope too
    const { bundle } = src.store.exportProfile();
    assert.equal(bundle.version, vs.BUNDLE_VERSION_V2, 'no bundle version change');
    assert.equal(bundle.vaults.length, 3);
    const text = JSON.stringify(bundle);
    for (const id of ['global', 'work', 'play', 'third']) {
      assert.ok(!text.includes(`"${id}"`), `no real id "${id}" anywhere in the bundle`);
    }
    for (const entry of bundle.vaults) {
      const doc = entry.vault;
      assert.equal(doc.version, 2);
      assert.equal(doc.vaultId, entry.entryHandle, 'the embedded document states the handle');
      assert.deepEqual(
        doc.envelopes.map((e) => e.keyId),
        ['mrk'],
        'no access envelope'
      );
      assert.ok(!text.includes('hkdf-access'));
    }
    assert.ok(!text.includes(src.access.keyId), "the version-1 file's access key id is not carried");
    // decrypts, with hand-written AADs, under the handle
    const names = ['global', 'work', 'play'];
    bundle.vaults.forEach((entry, i) => {
      const opened = oracle.openWithMaster(entry.vault, src.store.mrk, entry.entryHandle);
      assert.deepEqual(byId(opened.items), byId(src.expected[names[i]]));
      assert.throws(() => oracle.openWithMaster(entry.vault, src.store.mrk, names[i]), 'not under the real id');
    });
    // the live files are untouched by an export
    assert.equal(readDoc(src.dir, 'work').version, 1);
  } finally {
    rm(src.dir);
  }
});

// ---------------------------------------------------------------------------
// AC8 - restore, preview and adopt, end to end
// ---------------------------------------------------------------------------

test('AC8: profile export -> restoreProfile (replace) on the same profile', async () => {
  const src = await mixedSource();
  try {
    const bundle = JSON.parse(JSON.stringify(src.store.exportProfile().bundle));
    const res = await src.store.restoreProfile(bundle, {
      secret: secret(),
      mapping: mappingFor(bundle, ['global', 'work', 'play'], 'replace')
    });
    assert.deepEqual(
      res.results.map((r) => r.outcome),
      ['landed', 'landed', 'landed']
    );
    await assertLanded(src.dir, src.expected);
  } finally {
    rm(src.dir);
  }
});

test("AC8: profile export -> restoreProfile (merge) on the same profile, and the preview's counts and labels", async () => {
  const src = await mixedSource();
  try {
    const bundle = JSON.parse(JSON.stringify(src.store.exportProfile().bundle));
    const preview = await src.store.previewRestoreBundle(bundle, { secret: secret() });
    assert.deepEqual(
      preview.labels.map((l) => l.itemCount),
      [src.expected.global.length, src.expected.work.length, src.expected.play.length].map((n) => n)
    );
    assert.deepEqual(
      preview.labels.map((l) => l.identity.kind),
      ['global', 'jar', 'jar']
    );
    assert.deepEqual(
      preview.labels.map((l) => l.identity.name),
      [undefined, 'Work', 'Play']
    );
    const res = await src.store.restoreProfile(bundle, {
      secret: secret(),
      mapping: mappingFor(bundle, ['global', 'work', 'play'], 'merge')
    });
    assert.ok(res.results.every((r) => r.outcome === 'landed' && r.mergeReport.conflictCopies === 0));
    // merging a vault with itself changes nothing; the version-1 file keeps its version (a merge rewrites in place)
    assert.equal(readDoc(src.dir, 'work').version, 1);
    assert.equal(readDoc(src.dir, 'play').version, 2);
    const fresh = makeStore(src.dir);
    await fresh.unlock(MASTER);
    for (const id of ['global', 'work', 'play']) assert.deepEqual(byId(fresh.listItems(id)), byId(src.expected[id]));
  } finally {
    rm(src.dir);
  }
});

test('AC8: profile export -> restoreProfile onto a FRESH profile (adopt): every file version 2, bound to the destination ids', async () => {
  const src = await mixedSource();
  const dir = tmpDir();
  try {
    const bundle = JSON.parse(JSON.stringify(src.store.exportProfile().bundle));
    const deps = jarDeps();
    const adopter = makeStore(dir, deps);
    const [g, w, p] = bundle.vaults.map((e) => e.entryHandle);
    const res = await adopter.restoreProfile(bundle, {
      secret: secret(),
      mapping: {
        [g]: { directive: 'existing', destination: 'global' },
        [w]: { directive: 'new', newJar: { name: 'Work', color: '#2196f3' } },
        [p]: { directive: 'new', newJar: { name: 'Play', color: '#e91e63' } }
      }
    });
    assert.equal(res.fresh, true);
    assert.deepEqual(
      res.results.map((r) => r.destination),
      ['global', 'work', 'play']
    );
    await assertLanded(dir, src.expected, deps);
  } finally {
    rm(src.dir);
    rm(dir);
  }
});

test('AC8: a single-vault bundle holding a version-2 document through restoreProfile (the synthetic-handle case)', async () => {
  const src = await mixedSource();
  try {
    const single = JSON.parse(JSON.stringify(src.store.exportVault('play')));
    const preview = await src.store.previewRestoreBundle(single, { secret: secret() });
    assert.equal(preview.labels.length, 1);
    const handle = preview.labels[0].entryHandle;
    assert.notEqual(handle, 'play', 'the synthetic handle is not the binding id');
    assert.equal(preview.labels[0].itemCount, src.expected.play.length);
    const res = await src.store.restoreProfile(single, {
      secret: secret(),
      mapping: { [handle]: { directive: 'existing', destination: 'third' } }
    });
    assert.equal(res.results[0].outcome, 'landed');
    await assertLanded(src.dir, { third: src.expected.play });
    // and on a fresh profile
    const dir = tmpDir();
    try {
      const adopter = makeStore(dir);
      const r2 = await adopter.restoreProfile(single, {
        secret: secret(),
        mapping: { [handle]: { directive: 'existing', destination: 'global' } }
      });
      assert.equal(r2.fresh, true);
      await assertLanded(dir, { global: src.expected.play });
    } finally {
      rm(dir);
    }
  } finally {
    rm(src.dir);
  }
});

test('AC8: version-1 bundles of both kinds (oracle-built documents) restore to version 2', async () => {
  const src = await mixedSource();
  try {
    const { bundle } = src.store.exportProfile(); // before 'third' exists
    // a single-vault bundle of the oracle's version-1 file
    const single = JSON.parse(JSON.stringify(src.store.exportVault('work')));
    assert.equal(single.vault.version, 1);
    const handle = (await src.store.previewRestoreBundle(single, { secret: secret() })).labels[0].entryHandle;
    await src.store.restoreProfile(single, {
      secret: secret(),
      mapping: { [handle]: { directive: 'existing', destination: 'third' } }
    });
    await assertLanded(src.dir, { third: src.expected.work });

    // a profile bundle as the RELEASED code made it: every entry a version-1 document whose plaintext
    // vaultId is the handle (the oracle builds them under the profile's master key)
    const names = ['global', 'work', 'play'];
    const old = JSON.parse(JSON.stringify(bundle));
    old.vaults.forEach((entry, i) => {
      entry.vault = oracle.buildDoc({
        version: 1,
        vaultId: entry.entryHandle,
        mrk: src.store.mrk,
        items: src.expected[names[i]]
      }).doc;
      assert.equal(entry.vault.version, 1);
    });
    const dir = tmpDir();
    try {
      const deps = jarDeps();
      const adopter = makeStore(dir, deps);
      const [g, w, p] = old.vaults.map((e) => e.entryHandle);
      await adopter.restoreProfile(old, {
        secret: secret(),
        mapping: {
          [g]: { directive: 'existing', destination: 'global' },
          [w]: { directive: 'new', newJar: { name: 'Work', color: '#2196f3' } },
          [p]: { directive: 'skip' }
        }
      });
      await assertLanded(dir, { global: src.expected.global, work: src.expected.work }, deps);
    } finally {
      rm(dir);
    }
  } finally {
    rm(src.dir);
  }
});

// ---------------------------------------------------------------------------
// AC9 - compromise rotation writes version 2
// ---------------------------------------------------------------------------

const NEW_PW = 'a brand new master password 1';

async function rotationCase(name, build) {
  test(`AC9: compromise rotation on ${name} - every vault version 2 under a new key bound to its slot id, items intact, access envelopes gone`, async () => {
    const p = await build();
    try {
      const before = {};
      const oldKeys = {};
      for (const id of ['global', 'work', 'play']) {
        before[id] = byId(p.store.listItems(id));
        oldKeys[id] = openFile(p.dir, id, p.store.mrk).vaultKey;
      }
      await p.store.compromiseRotate({ oldMasterPassword: MASTER, newMasterPassword: NEW_PW });
      const manager = JSON.parse(fs.readFileSync(`${p.dir}/vaults/manager.json`, 'utf8'));
      assert.equal(manager.version, 2, 'the manager at its rotated version');
      for (const id of ['global', 'work', 'play']) {
        const doc = readDoc(p.dir, id);
        assert.equal(doc.version, 2, `${id} is version 2`);
        assert.equal(doc.vaultId, id);
        assert.deepEqual(
          doc.envelopes.map((e) => e.keyId),
          ['mrk'],
          'access envelopes gone'
        );
        const opened = openFile(p.dir, id, p.store.mrk); // new master key, hand-written v2 AADs
        assert.ok(!opened.vaultKey.equals(oldKeys[id]), 'a new vault key');
        assert.deepEqual(byId(opened.items), before[id]);
      }
      const fresh = makeStore(p.dir);
      await fresh.unlock(NEW_PW);
      for (const id of ['global', 'work', 'play']) assert.deepEqual(byId(fresh.listItems(id)), before[id]);
      assert.throws(() => fresh.openVaultWithAccessKey('work', p.accessSecret ?? 'x'), vc.VaultAuthError);
    } finally {
      rm(p.dir);
    }
  });
}

rotationCase('an all-version-1 profile', async () => {
  const access = oracle.newAccessKey();
  const p = await makeProfile({
    v1: {
      global: { items: sampleItems('g') },
      work: { items: sampleItems('w'), accessKeys: [access] },
      play: { items: sampleItems('p') }
    }
  });
  p.accessSecret = access.secret;
  return p;
});
rotationCase('a mixed profile', async () => {
  const access = oracle.newAccessKey();
  const p = await makeProfile({
    v1: { work: { items: sampleItems('w'), accessKeys: [access] } },
    v2: { play: { items: sampleItems('p') } }
  });
  p.accessSecret = access.secret;
  return p;
});
rotationCase('an all-version-2 profile', async () => {
  const p = await makeProfile({ v2: { work: { items: sampleItems('w') }, play: { items: sampleItems('p') } } });
  p.accessSecret = (await p.store.mintAccessKey('work', { masterPassword: MASTER })).secret;
  return p;
});
