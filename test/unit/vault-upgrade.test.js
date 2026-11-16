'use strict';

// Mission 23 Flight 2 leg `vault-upgrade` (DD6): the first time the master key is in hand, every
// version-1 vault file becomes version 2 in ONE journalled transaction, verified three times with the
// vault id taken from three different places, undone if the last check fails, and never able to block
// an unlock or strand a journal. The version-1 inputs are built by the independent oracle
// (`test/helpers/vault-oracle.js`, raw node:crypto) - never by the code under test.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const vc = require('../../src/main/vault/vault-crypto');
const vtxn = require('../../src/main/vault/vault-txn');
const vupgrade = require('../../src/main/vault/vault-upgrade');
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vdir = (dir) => path.join(dir, 'vaults');
const residue = (dir) => fs.readdirSync(vdir(dir)).filter((n) => /^txn-|\.stage-|\.tmp-/.test(n));
const managerBytes = (dir) => fs.readFileSync(path.join(vdir(dir), 'manager.json'));
const ids = ['global', 'work', 'play'];

/** A profile whose global and two jar vaults are ALL version 1 (oracle), with an access key on `work`. */
async function v1Profile(extra = {}) {
  const access = oracle.newAccessKey();
  const items = {
    global: [...sampleItems('g'), identityItem('g')],
    work: [...sampleItems('w'), identityItem('w')],
    play: sampleItems('p')
  };
  const p = await makeProfile({
    v1: {
      global: { items: items.global },
      work: { items: items.work, accessKeys: [access] },
      play: { items: items.play }
    },
    extra
  });
  for (const id of ids) assert.equal(readDoc(p.dir, id).version, 1, `${id} starts at version 1`);
  return { ...p, items, access };
}

const versions = (dir) => Object.fromEntries(ids.map((id) => [id, readDoc(dir, id).version]));
const snapshot = (dir) =>
  Object.fromEntries(fs.readdirSync(vdir(dir)).map((n) => [n, fs.readFileSync(path.join(vdir(dir), n))]));

function assertUnchanged(dir, snap, label) {
  const now = snapshot(dir);
  assert.deepEqual(Object.keys(now).sort(), Object.keys(snap).sort(), `${label}: same file set`);
  for (const [n, b] of Object.entries(snap)) assert.ok(now[n].equals(b), `${label}: ${n} byte-identical`);
}

/** Run `fn` with `fs[name]` replaced by `make(original)`; always restored. */
function withPatch(name, make, fn) {
  const original = fs[name];
  fs[name] = make(original);
  const restore = () => {
    fs[name] = original;
  };
  const r = fn();
  if (r && typeof r.then === 'function') return r.finally(restore);
  restore();
  return r;
}

// ---------------------------------------------------------------------------
// AC1 - the pure builder
// ---------------------------------------------------------------------------

test('AC1: buildUpgrade rebuilds a version-1 file as version 2 for the bind id, keeps access envelopes verbatim and in order, keeps kdf', () => {
  const mrk = Buffer.alloc(32, 7);
  const a1 = oracle.newAccessKey();
  const a2 = oracle.newAccessKey();
  const items = sampleItems('w');
  const built = oracle.buildDoc({
    version: 1,
    vaultId: 'work',
    mrk,
    items,
    accessKeys: [a1, a2],
    kdf: { algo: 'scrypt', N: 131072, r: 8, p: 2, maxmem: 201326592 }
  });
  const bytes = Buffer.from(JSON.stringify(built.doc));
  const out = vupgrade.buildUpgrade({ vaults: [{ id: 'work', bindId: 'work', bytes }], mrk });
  assert.deepEqual(out.skipped, []);
  assert.equal(out.upgraded.length, 1);
  const doc = JSON.parse(out.upgraded[0].json.toString('utf8'));
  assert.equal(doc.version, 2);
  assert.equal(doc.vaultId, 'work');
  assert.deepEqual(doc.kdf, built.doc.kdf, 'the informational kdf is kept');
  assert.deepEqual(
    doc.envelopes.map((e) => e.keyId),
    built.doc.envelopes.map((e) => e.keyId),
    'envelope order is kept (mrk first)'
  );
  assert.deepEqual(doc.envelopes.slice(1), built.doc.envelopes.slice(1), 'access envelopes are verbatim');
  // the independent oracle opens the result at version 2 bound to the slot, and an access key still opens it
  assert.deepEqual(oracle.openWithMaster(doc, mrk, 'work').items, items);
  assert.ok(oracle.openAccessEnvelope(doc, a1.secret).equals(built.vaultKey));
  assert.ok(oracle.openAccessEnvelope(doc, a2.secret).equals(built.vaultKey));
  assert.throws(() => oracle.openWithMaster(doc, mrk, 'play'), 'bound to its own slot only');
  assert.doesNotThrow(() => vupgrade.verifyDocument({ doc, id: 'work', mrk, items, envelopes: built.doc.envelopes }));
  assert.throws(() => vupgrade.verifyDocument({ doc, id: 'play', mrk, items, envelopes: built.doc.envelopes }));
});

test('AC1: per-file isolation and reason codes - one bad file never stops the rest; a version-2 file is skipped on a parse alone', () => {
  const mrk = Buffer.alloc(32, 9);
  const good = (id) =>
    Buffer.from(JSON.stringify(oracle.buildDoc({ version: 1, vaultId: id, mrk, items: sampleItems(id) }).doc));
  const tampered = JSON.parse(good('t').toString('utf8'));
  tampered.items.ct = Buffer.from('xxxxxxxx').toString('base64');
  const noMrk = JSON.parse(good('n').toString('utf8'));
  noMrk.envelopes = [];
  const otherKey = Buffer.from(
    JSON.stringify(oracle.buildDoc({ version: 1, vaultId: 'o', mrk: Buffer.alloc(32, 1), items: [] }).doc)
  );
  const v2 = Buffer.from(JSON.stringify(oracle.buildDoc({ version: 2, vaultId: 'v', mrk, items: [] }).doc));
  const input = [
    { id: 'garbage', bytes: Buffer.from('not json') },
    { id: 'a', bytes: good('a') },
    { id: 'tampered', bytes: Buffer.from(JSON.stringify(tampered)) },
    { id: 'nomrk', bytes: Buffer.from(JSON.stringify(noMrk)) },
    { id: 'o', bytes: otherKey },
    { id: 'v', bytes: v2 },
    { id: 'b', bytes: good('b') }
  ].map((v) => ({ ...v, bindId: v.id }));
  // spy on every unwrapped key: all of them must be zeroized when the builder returns
  const seen = [];
  const out = withPatch(
    'readFileSync',
    (o) => o,
    () => {
      const orig = vc.unwrapVaultKey;
      vc.unwrapVaultKey = (...a) => {
        const k = orig(...a);
        seen.push(k);
        return k;
      };
      try {
        return vupgrade.buildUpgrade({ vaults: input, mrk });
      } finally {
        vc.unwrapVaultKey = orig;
      }
    }
  );
  assert.deepEqual(
    out.upgraded.map((u) => u.id),
    ['a', 'b']
  );
  assert.deepEqual(Object.fromEntries(out.skipped.map((s) => [s.id, s.reason])), {
    garbage: 'format',
    tampered: 'items-unreadable',
    nomrk: 'no-mrk-envelope',
    o: 'wrong-key',
    v: 'current'
  });
  assert.ok(seen.length >= 3);
  for (const k of seen)
    assert.ok(
      k.every((b) => b === 0),
      'every working key buffer is zeroized'
    );
});

test('AC1: the builder and the caller are synchronous - non-promise returns and no await in either (source scan)', async () => {
  const mrk = Buffer.alloc(32, 3);
  const r = vupgrade.buildUpgrade({ vaults: [], mrk });
  assert.ok(!(r instanceof Promise) && typeof r.then !== 'function');
  const p = await v1Profile();
  try {
    const store = makeStore(p.dir);
    store.mrk = Buffer.from(p.store.mrk);
    const ret = store._upgradeVaultFiles();
    assert.equal(ret, undefined, 'the caller returns nothing, never a promise');
    assert.deepEqual(versions(p.dir), { global: 2, work: 2, play: 2 }, 'and it had already finished when it returned');
  } finally {
    rm(p.dir);
  }
  const upgradeSrc = maskComments(fs.readFileSync(require.resolve('../../src/main/vault/vault-upgrade.js'), 'utf8'));
  assert.ok(!/\bawait\b|\basync\b/.test(upgradeSrc), 'vault-upgrade.js has no await/async');
  const storeSrc = maskComments(fs.readFileSync(require.resolve('../../src/main/vault/vault-store.js'), 'utf8'));
  const start = storeSrc.indexOf('  _upgradeRegistryIds() {');
  const end = storeSrc.indexOf('  async changeMasterPassword(', start);
  assert.ok(start > 0 && end > start, 'located the upgrade methods');
  const body = storeSrc.slice(start, end);
  assert.ok(!/\bawait\b|\basync\b/.test(body), 'the upgrade methods in vault-store.js have no await/async');
  assert.ok(body.includes('_upgradeVaultFilesCore'), 'scan covers the caller');
});

test('AC1: the call sits in _installMrk after the new key cache and before _touch() and onUnlock', () => {
  const src = maskComments(fs.readFileSync(require.resolve('../../src/main/vault/vault-store.js'), 'utf8'));
  const start = src.indexOf('  _installMrk(mrk) {');
  const end = src.indexOf('\n  }\n', start);
  const body = src.slice(start, end);
  const iCache = body.indexOf('this.vaultKeys = new Map()');
  const iUp = body.indexOf('this._upgradeVaultFiles()');
  const iTouch = body.indexOf('this._touch()');
  const iHook = body.indexOf('this.onUnlock');
  assert.ok(iCache > 0 && iUp > iCache && iTouch > iUp && iHook > iTouch, 'order: cache, upgrade, touch, onUnlock');
});

// ---------------------------------------------------------------------------
// AC2 - which files
// ---------------------------------------------------------------------------

test('AC2: a stray .gfvault (no registered id, or the wrong spelling) is left alone and logged once; a second unlock writes nothing', async () => {
  const lines = [];
  const p = await v1Profile({ log: (l) => lines.push(l) });
  try {
    fs.copyFileSync(vaultFile(p.dir, 'work'), vaultFile(p.dir, 'orphan'));
    fs.copyFileSync(vaultFile(p.dir, 'work'), vaultFile(p.dir, 'Work')); // the registry spells it 'work'
    const stray = { orphan: bytesOf(p.dir, 'orphan'), Work: bytesOf(p.dir, 'Work') };
    const fresh = makeStore(p.dir, { log: (l) => lines.push(l) });
    await fresh.unlock(MASTER);
    assert.deepEqual(versions(p.dir), { global: 2, work: 2, play: 2 });
    assert.ok(bytesOf(p.dir, 'orphan').equals(stray.orphan), 'never bound, never rewritten');
    assert.ok(bytesOf(p.dir, 'Work').equals(stray.Work));
    assert.equal(readDoc(p.dir, 'orphan').version, 1);
    assert.ok(fs.existsSync(vaultFile(p.dir, 'orphan')), 'never deleted');
    for (const id of ['orphan', 'Work']) {
      assert.equal(lines.filter((l) => l.includes(`"${id}"`) && /stray/.test(l)).length, 1, `${id}: logged once`);
    }
    // second unlock: nothing to convert -> no transaction, no write, no mtime change
    const before = Object.fromEntries(
      ids.map((id) => [id, { b: bytesOf(p.dir, id), m: fs.statSync(vaultFile(p.dir, id)).mtimeMs }])
    );
    await sleep(25);
    let begun = 0;
    const origBegin = vtxn.beginTransaction;
    vtxn.beginTransaction = (...a) => {
      begun++;
      return origBegin(...a);
    };
    try {
      fresh.lockNow();
      await fresh.unlock(MASTER);
    } finally {
      vtxn.beginTransaction = origBegin;
    }
    assert.equal(begun, 0, 'no transaction begun');
    for (const id of ids) {
      assert.ok(bytesOf(p.dir, id).equals(before[id].b), `${id}: bytes`);
      assert.equal(fs.statSync(vaultFile(p.dir, id)).mtimeMs, before[id].m, `${id}: mtime`);
    }
    assert.equal(lines.filter((l) => /stray/.test(l)).length, 2, 'the stray lines are not repeated');
  } finally {
    rm(p.dir);
  }
});

test('AC2: a jar with no vault file is nothing to do; a wrong-password unlock attempts and logs nothing', async () => {
  const lines = [];
  const p = await v1Profile({ log: (l) => lines.push(l) });
  try {
    const snap = snapshot(p.dir);
    const fresh = makeStore(p.dir, { log: (l) => lines.push(l) });
    await assert.rejects(() => fresh.unlock('not the password'));
    assertUnchanged(p.dir, snap, 'a wrong password');
    assert.deepEqual(lines, []);
    assert.equal(fs.existsSync(vaultFile(p.dir, 'third')), false, 'a registered jar with no file gets none');
    await fresh.unlock(MASTER);
    assert.equal(fs.existsSync(vaultFile(p.dir, 'third')), false);
  } finally {
    rm(p.dir);
  }
});

// ---------------------------------------------------------------------------
// AC5 - from the real trigger, through a restart
// ---------------------------------------------------------------------------

const NEWPW = 'a new master password after recovery';
const TRIGGERS = {
  unlock: { run: (s) => s.unlock(MASTER), pw: MASTER, manager: 'unchanged' },
  unlockWithRecovery: { run: (s, p) => s.unlockWithRecovery(p.recovery), pw: MASTER, manager: 'unchanged' },
  unlockWithAdmin: { run: (s, p) => s.unlockWithAdmin(p.admin), pw: MASTER, manager: 'unchanged' },
  recoverMasterPassword: {
    run: (s, p) => s.recoverMasterPassword({ recoveryDisplay: p.recovery, newMasterPassword: NEWPW }),
    pw: NEWPW,
    manager: 'rewrapped'
  }
};

for (const [name, trig] of Object.entries(TRIGGERS)) {
  test(`AC5 (${name}): upgrade at the real trigger, then a restart reads every item; keys, manager, residue`, async () => {
    const p = await v1Profile();
    try {
      const managerBefore = managerBytes(p.dir);
      const a = makeStore(p.dir);
      await trig.run(a, p);
      assert.deepEqual(versions(p.dir), { global: 2, work: 2, play: 2 }, 'every file is version 2 after the trigger');
      for (const id of ids) assert.equal(readDoc(p.dir, id).vaultId, id);
      assert.deepEqual(residue(p.dir), [], 'no journal, stage or temp file remains');
      if (trig.manager === 'unchanged') assert.ok(managerBytes(p.dir).equals(managerBefore), 'manager untouched');
      a.lockNow();

      // a restart: a fresh store on the same directory
      const b = makeStore(p.dir);
      await b.unlock(trig.pw);
      for (const id of ids) assert.deepEqual(byId(b.listItems(id)), byId(p.items[id]), `${id}: every item deep-equal`);
      assert.deepEqual(residue(p.dir), []);
      assert.deepEqual(versions(p.dir), { global: 2, work: 2, play: 2 });

      // the access key still opens its vault and reads its items
      const { key } = b.openVaultWithAccessKey('work', p.access.secret);
      assert.deepEqual(byId(b.readVaultItems('work', key)), byId(p.items.work));
      // the admin key still opens every vault
      const all = b.openAllWithAdminKey(p.admin);
      assert.equal(all.size, 3);
      for (const id of ids) assert.deepEqual(byId(b.readVaultItems(id, all.get(id))), byId(p.items[id]));
      // minting a second access key and revoking the first work
      const second = await b.mintAccessKey('work', { masterPassword: trig.pw });
      assert.ok(b.openVaultWithAccessKey('work', second.secret).key.equals(key));
      assert.equal(b.revokeAccessKey('work', p.access.keyId), true);
      assert.throws(() => b.openVaultWithAccessKey('work', p.access.secret), vc.VaultAuthError);
      assert.ok(b.openVaultWithAccessKey('work', second.secret).key.equals(key), 'the new key survives the revoke');
      assert.deepEqual(byId(b.listItems('work')), byId(p.items.work));
      assert.equal(readDoc(p.dir, 'work').version, 2);
    } finally {
      rm(p.dir);
    }
  });
}

// ---------------------------------------------------------------------------
// AC3 / AC7 - three verifications, three sources of the id; the worst cases are caught
// ---------------------------------------------------------------------------

test('AC3/AC7(1): a WRONG id chosen by the builder passes the in-memory check, is rejected on the STAGED bytes, and nothing is renamed', async () => {
  const lines = [];
  const p = await v1Profile();
  try {
    const snap = snapshot(p.dir);
    const store = makeStore(p.dir, { log: (l) => lines.push(l) });
    const calls = [];
    const origVerify = vupgrade.verifyDocument;
    vupgrade.verifyDocument = (a) => {
      calls.push(a.id);
      return origVerify(a);
    };
    // the fault: the builder is handed a wrong bind id for 'work' (the id is chosen wrongly, once)
    const origBuild = vupgrade.buildUpgrade;
    vupgrade.buildUpgrade = (a) =>
      origBuild({ ...a, vaults: a.vaults.map((v) => (v.id === 'work' ? { ...v, bindId: 'play' } : v)) });
    const renamedInto = [];
    try {
      await withPatch(
        'renameSync',
        (o) => (s, d) => {
          renamedInto.push(path.basename(d));
          return o.call(fs, s, d);
        },
        () => store.unlock(MASTER)
      );
    } finally {
      vupgrade.verifyDocument = origVerify;
      vupgrade.buildUpgrade = origBuild;
    }
    // (a) ran on the builder's own (wrong) id and passed; (b) then ran on the id from the member's file name
    assert.deepEqual(calls.slice(0, 3), ['global', 'play', 'play'], '(a) accepted the builder-consistent wrong id');
    assert.equal(calls[3], 'global', '(b) took its first id from a file name');
    assert.equal(calls[4], 'work', '(b) took the id "work" from the file name, not the builder variable');
    assert.equal(calls.length, 5, '(b) failed on the second file; (c) never ran');
    assert.ok(
      lines.some((l) => /verify-staged-failed/.test(l)),
      'logged'
    );
    assert.ok(
      !renamedInto.some((n) => n.endsWith('.gfvault')),
      'nothing was renamed into a final name (rollback only unlinks)'
    );
    assertUnchanged(p.dir, snap, 'after the rejected upgrade');
    assert.deepEqual(residue(p.dir), []);
    assert.deepEqual(byId(store.listItems('work')), byId(p.items.work), 'the profile reads exactly as before');
  } finally {
    rm(p.dir);
  }
});

test('AC3/AC7(2): a fault only the REAL READER sees (after commit) restores every original and the profile is as before', async () => {
  const lines = [];
  const p = await v1Profile();
  try {
    const snap = snapshot(p.dir);
    const store = makeStore(p.dir, { log: (l) => lines.push(l) });
    let hit = false;
    await withPatch(
      'renameSync',
      (o) => (s, d) => {
        const r = o.call(fs, s, d);
        if (!hit && /work\.gfvault$/.test(d) && /\.stage-/.test(s)) {
          hit = true;
          fs.writeFileSync(d, '{"truncated'); // the file the committed rename leaves is not a vault
        }
        return r;
      },
      () => store.unlock(MASTER)
    );
    assert.equal(hit, true, 'the fault fired');
    assert.ok(lines.some((l) => /verify-after-commit-failed/.test(l)));
    assertUnchanged(p.dir, snap, 'after the undo');
    assert.deepEqual(residue(p.dir), []);
    for (const id of ids) assert.deepEqual(byId(store.listItems(id)), byId(p.items[id]));
    // the condition cleared: the next unlock upgrades
    store.lockNow();
    await store.unlock(MASTER);
    assert.deepEqual(versions(p.dir), { global: 2, work: 2, play: 2 });
  } finally {
    rm(p.dir);
  }
});

test('AC3/AC7(3): a document corrupted IN MEMORY is rejected before anything is staged', async () => {
  const lines = [];
  const p = await v1Profile();
  try {
    const snap = snapshot(p.dir);
    const store = makeStore(p.dir, { log: (l) => lines.push(l) });
    const orig = vupgrade.buildUpgrade;
    vupgrade.buildUpgrade = (inp) => {
      const out = orig(inp);
      const doc = JSON.parse(out.upgraded[1].json.toString('utf8'));
      const ct = Buffer.from(doc.items.ct, 'base64');
      ct[0] ^= 0xff;
      doc.items.ct = ct.toString('base64');
      out.upgraded[1].json = Buffer.from(JSON.stringify(doc));
      return out;
    };
    let begun = 0;
    const origBegin = vtxn.beginTransaction;
    vtxn.beginTransaction = (...a) => {
      begun++;
      return origBegin(...a);
    };
    try {
      await store.unlock(MASTER);
    } finally {
      vupgrade.buildUpgrade = orig;
      vtxn.beginTransaction = origBegin;
    }
    assert.equal(begun, 0, 'nothing staged: no transaction was even begun');
    assert.ok(lines.some((l) => /verify-memory-failed/.test(l)));
    assertUnchanged(p.dir, snap, 'in-memory rejection');
  } finally {
    rm(p.dir);
  }
});

test('AC3: the three verifications take their id from three sources (source scan of the caller)', () => {
  const src = maskComments(fs.readFileSync(require.resolve('../../src/main/vault/vault-store.js'), 'utf8'));
  const start = src.indexOf('  _upgradeVaultFilesCore() {');
  const end = src.indexOf('  async changeMasterPassword(', start);
  const body = src.slice(start, end);
  const calls = [...body.matchAll(/vupgrade\.verifyDocument\(\{[\s\S]*?\}\);/g)].map((m) => m[0]);
  assert.equal(calls.length, 3);
  assert.match(calls[0], /id: u\.bindId/, "(a) the builder's bound id");
  assert.match(calls[1], /id: fromName/, "(b) the journal member's final file name");
  assert.match(body, /const fromName = member\.finalName\.slice\(/);
  assert.match(calls[2], /doc: this\._readVault\(id\)/, '(c) the real reader');
  assert.match(calls[2], /\bid,/, '(c) the id from the registry loop');
  assert.match(body, /for \(const id of this\._upgradeRegistryIds\(\)\) \{\s*const u = byId\.get\(id\)/);
});

// ---------------------------------------------------------------------------
// AC4 - never blocks an unlock, never strands a journal
// ---------------------------------------------------------------------------

/** Afterwards: no journal, and a compromise rotation in the same process succeeds. */
async function assertRotationWorks(store, dir) {
  assert.deepEqual(residue(dir), [], 'no journal or staged file behind');
  const r = await store.compromiseRotate({ oldMasterPassword: MASTER, newMasterPassword: 'rotation after upgrade' });
  assert.equal(typeof r.recoveryKey, 'string');
  assert.deepEqual(residue(dir), []);
}

test('AC4: one corrupt file - skipped, the rest upgraded, the bad one fails with its own error, logged once, retried at the next unlock', async () => {
  const lines = [];
  const p = await v1Profile({ log: (l) => lines.push(l) });
  try {
    const playOriginal = bytesOf(p.dir, 'play');
    fs.writeFileSync(vaultFile(p.dir, 'play'), '{"format":"gfvault","version":1, not json');
    const garbage = bytesOf(p.dir, 'play');
    const store = makeStore(p.dir, { log: (l) => lines.push(l) });
    await store.unlock(MASTER);
    assert.equal(readDoc(p.dir, 'work').version, 2);
    assert.equal(readDoc(p.dir, 'global').version, 2);
    assert.ok(bytesOf(p.dir, 'play').equals(garbage), 'the bad file is untouched');
    assert.throws(() => store.listItems('play'), vc.VaultFormatError, 'and fails with its own error');
    store.lockNow();
    await store.unlock(MASTER);
    assert.equal(lines.filter((l) => /"play"/.test(l)).length, 1, 'once per id per process');
    assert.ok(!lines.join('\n').match(/password|secret|ct"|\.gfvault|\/tmp/i), 'no item, path or key in a log line');
    // clear the condition: the next unlock upgrades it
    fs.writeFileSync(vaultFile(p.dir, 'play'), playOriginal);
    store.lockNow();
    await store.unlock(MASTER);
    assert.equal(readDoc(p.dir, 'play').version, 2);
    assert.deepEqual(byId(store.listItems('play')), byId(p.items.play));
    await assertRotationWorks(store, p.dir);
  } finally {
    rm(p.dir);
  }
});

test('AC4: a file that does not unwrap under this master key is skipped (its own auth error), the rest are upgraded', async () => {
  const lines = [];
  const p = await v1Profile({ log: (l) => lines.push(l) });
  try {
    const foreign = oracle.buildDoc({ version: 1, vaultId: 'play', mrk: Buffer.alloc(32, 5), items: [] }).doc;
    oracle.writeDoc(p.dir, 'play', foreign);
    const bytes = bytesOf(p.dir, 'play');
    const store = makeStore(p.dir, { log: (l) => lines.push(l) });
    await store.unlock(MASTER);
    assert.deepEqual(versions(p.dir), { global: 2, work: 2, play: 1 });
    assert.ok(bytesOf(p.dir, 'play').equals(bytes));
    assert.throws(() => store.listItems('play'), vc.VaultAuthError);
    assert.ok(lines.some((l) => /"play": wrong-key/.test(l)));
    fs.rmSync(vaultFile(p.dir, 'play'));
    await assertRotationWorks(store, p.dir);
  } finally {
    rm(p.dir);
  }
});

test('AC4: a missing file is nothing to do (the rest are upgraded)', async () => {
  const lines = [];
  const p = await v1Profile({ log: (l) => lines.push(l) });
  try {
    fs.rmSync(vaultFile(p.dir, 'play'));
    const store = makeStore(p.dir, { log: (l) => lines.push(l) });
    await store.unlock(MASTER);
    assert.equal(readDoc(p.dir, 'work').version, 2);
    assert.equal(fs.existsSync(vaultFile(p.dir, 'play')), false);
    assert.deepEqual(lines, []);
    await assertRotationWorks(store, p.dir);
  } finally {
    rm(p.dir);
  }
});

test('AC4: a stage write failing (disk full) rolls back; no journal; unlock fine; the retry upgrades; rotation works', async () => {
  const lines = [];
  const p = await v1Profile({ log: (l) => lines.push(l) });
  try {
    const snap = snapshot(p.dir);
    const store = makeStore(p.dir, { log: (l) => lines.push(l) });
    let stagedWrites = 0;
    await withPatch(
      'renameSync',
      (o) => (s, d) => {
        if (/\.stage-/.test(d) && ++stagedWrites === 2) throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
        return o.call(fs, s, d);
      },
      () => store.unlock(MASTER)
    );
    assert.equal(stagedWrites >= 2, true, 'the fault fired');
    assert.equal(store.isUnlocked(), true);
    assertUnchanged(p.dir, snap, 'stage failure');
    assert.ok(lines.some((l) => /stage-failed/.test(l)));
    assert.equal(lines.filter((l) => /stage-failed/.test(l)).length, 1);
    store.lockNow();
    await store.unlock(MASTER);
    assert.deepEqual(versions(p.dir), { global: 2, work: 2, play: 2 });
    await assertRotationWorks(store, p.dir);
  } finally {
    rm(p.dir);
  }
});

test('AC4: a read-only vaults directory leaves everything readable at version 1, no journal, unlock succeeds', async (t) => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) return t.skip('root ignores directory modes');
  const lines = [];
  const p = await v1Profile({ log: (l) => lines.push(l) });
  try {
    const snap = snapshot(p.dir);
    const store = makeStore(p.dir, { log: (l) => lines.push(l) });
    fs.chmodSync(vdir(p.dir), 0o500);
    try {
      await store.unlock(MASTER);
    } finally {
      fs.chmodSync(vdir(p.dir), 0o700);
    }
    assert.equal(store.isUnlocked(), true);
    assertUnchanged(p.dir, snap, 'read-only directory');
    assert.ok(lines.some((l) => /stage-failed/.test(l)));
    for (const id of ids) assert.deepEqual(byId(store.listItems(id)), byId(p.items[id]));
    store.lockNow();
    await store.unlock(MASTER);
    assert.deepEqual(versions(p.dir), { global: 2, work: 2, play: 2 });
  } finally {
    fs.chmodSync(vdir(p.dir), 0o700);
    rm(p.dir);
  }
});

test('AC4: beginTransaction throwing is survived (no journal, unlock fine, rotation works afterwards)', async () => {
  const lines = [];
  const p = await v1Profile({ log: (l) => lines.push(l) });
  try {
    const snap = snapshot(p.dir);
    const store = makeStore(p.dir, { log: (l) => lines.push(l) });
    const orig = vtxn.beginTransaction;
    vtxn.beginTransaction = () => {
      throw new Error('begin exploded');
    };
    try {
      await store.unlock(MASTER);
    } finally {
      vtxn.beginTransaction = orig;
    }
    assert.equal(store.isUnlocked(), true);
    assertUnchanged(p.dir, snap, 'beginTransaction throwing');
    assert.ok(!lines.join('\n').includes('begin exploded'), 'the error text is not logged');
    await assertRotationWorks(store, p.dir);
  } finally {
    rm(p.dir);
  }
});

test('AC4: a journal already present is recovered and skipped this time; the next unlock upgrades', async () => {
  const lines = [];
  const p = await v1Profile({ log: (l) => lines.push(l) });
  try {
    const store = makeStore(p.dir, { log: (l) => lines.push(l) });
    // residue appearing AFTER construction (the constructor's recovery already ran)
    const h = vtxn.beginTransaction(vdir(p.dir), [{ finalName: 'play.gfvault', content: Buffer.from('junk') }]);
    assert.equal(h.committed, false);
    const snap = snapshot(p.dir);
    for (const n of Object.keys(snap)) if (/txn-|\.stage-/.test(n)) delete snap[n];
    await store.unlock(MASTER);
    assertUnchanged(p.dir, snap, 'journal present');
    assert.ok(lines.some((l) => /journal-present/.test(l)));
    store.lockNow();
    await store.unlock(MASTER);
    assert.deepEqual(versions(p.dir), { global: 2, work: 2, play: 2 });
    await assertRotationWorks(store, p.dir);
  } finally {
    rm(p.dir);
  }
});

test('AC4: the re-key gate up skips SILENTLY (no log, nothing written); a throwing logger never fails an unlock', async () => {
  const lines = [];
  const p = await v1Profile({ log: (l) => lines.push(l) });
  try {
    const snap = snapshot(p.dir);
    const store = makeStore(p.dir, { log: (l) => lines.push(l) });
    store._rekeyInProgress = true;
    await store.unlock(MASTER);
    store._rekeyInProgress = false;
    assertUnchanged(p.dir, snap, 'gate up');
    assert.deepEqual(lines, [], 'silent');
    store.lockNow();
    await store.unlock(MASTER);
    assert.deepEqual(versions(p.dir), { global: 2, work: 2, play: 2 });

    const q = await v1Profile({
      log: () => {
        throw new Error('sink down');
      }
    });
    try {
      fs.writeFileSync(vaultFile(q.dir, 'play'), 'garbage');
      const s2 = makeStore(q.dir, {
        log: () => {
          throw new Error('sink down');
        }
      });
      await s2.unlock(MASTER);
      assert.equal(s2.isUnlocked(), true);
      assert.equal(readDoc(q.dir, 'work').version, 2);
    } finally {
      rm(q.dir);
    }
  } finally {
    rm(p.dir);
  }
});

// ---------------------------------------------------------------------------
// AC6 - crash safety
// ---------------------------------------------------------------------------

test('AC6: a crash at EVERY rename/unlink of the upgrade leaves a fresh store with all-version-1 or all-version-2, every vault readable', async () => {
  const tpl = await v1Profile();
  const sample = tmpDir();
  try {
    const mrk = Buffer.from(tpl.store.mrk);
    // count the rename + unlink calls of one clean upgrade
    fs.cpSync(tpl.dir, sample, { recursive: true });
    let total = 0;
    const o = { r: fs.renameSync, u: fs.unlinkSync };
    fs.renameSync = (...a) => (total++, o.r.apply(fs, a));
    fs.unlinkSync = (...a) => (total++, o.u.apply(fs, a));
    try {
      await makeStore(sample).unlock(MASTER);
    } finally {
      fs.renameSync = o.r;
      fs.unlinkSync = o.u;
    }
    assert.ok(total >= 9, `a clean upgrade performs a known number of renames/unlinks (${total})`);

    let sawBefore = 0;
    let sawAfter = 0;
    for (let n = 1; n <= total; n++) {
      const dir = tmpDir();
      try {
        fs.cpSync(tpl.dir, dir, { recursive: true });
        const store = makeStore(dir);
        // the process "dies" at the n-th rename/unlink: that call and every later one throws
        let calls = 0;
        const dead =
          (fn) =>
          (...a) => {
            if (++calls >= n) throw new Error('process died');
            return fn.apply(fs, a);
          };
        fs.renameSync = dead(o.r);
        fs.unlinkSync = dead(o.u);
        try {
          await store.unlock(MASTER).catch(() => {});
        } finally {
          fs.renameSync = o.r;
          fs.unlinkSync = o.u;
        }
        const committed = fs.readdirSync(vdir(dir)).some((f) => /\.journal\.committed$/.test(f));
        // a restart: the constructor's recovery runs
        const fresh = makeStore(dir);
        assert.deepEqual(residue(dir), [], `n=${n}: recovery leaves no journal/stage/temp`);
        const v = Object.values(versions(dir));
        assert.ok(
          v.every((x) => x === v[0]),
          `n=${n}: all-or-nothing, got ${v}`
        );
        if (committed) {
          assert.deepEqual(v, [2, 2, 2], `n=${n}: committed -> rolled forward`);
          sawAfter++;
        } else {
          sawBefore += v[0] === 1 ? 1 : 0;
        }
        for (const id of ids) {
          // readable by the oracle at whatever version it now has, and then through the store
          assert.deepEqual(byId(openFile(dir, id, mrk).items), byId(tpl.items[id]), `n=${n} ${id}: oracle`);
        }
        await fresh.unlock(MASTER);
        assert.deepEqual(versions(dir), { global: 2, work: 2, play: 2 }, `n=${n}: the next unlock upgrades`);
        for (const id of ids) assert.deepEqual(byId(fresh.listItems(id)), byId(tpl.items[id]), `n=${n} ${id}`);
        assert.deepEqual(residue(dir), []);
      } finally {
        rm(dir);
      }
    }
    assert.ok(
      sawBefore > 0 && sawAfter > 0,
      `both sides of the commit marker were exercised (${sawBefore}/${sawAfter})`
    );
  } finally {
    rm(tpl.dir);
    rm(sample);
  }
});

// ---------------------------------------------------------------------------
// AC8 - composition
// ---------------------------------------------------------------------------

test('AC8: compromise rotation on a version-1 profile - unlocked (upgrade first) and locked (rotation reads version 1) - one transaction each, final install silent', async () => {
  for (const mode of ['unlocked', 'locked']) {
    const lines = [];
    const p = await v1Profile({ log: (l) => lines.push(l) });
    try {
      const store = makeStore(p.dir, { log: (l) => lines.push(l) });
      if (mode === 'unlocked') await store.unlock(MASTER);
      assert.deepEqual(
        versions(p.dir),
        mode === 'unlocked' ? { global: 2, work: 2, play: 2 } : { global: 1, work: 1, play: 1 }
      );
      let begun = 0;
      const orig = vtxn.beginTransaction;
      vtxn.beginTransaction = (...a) => {
        begun++;
        return orig(...a);
      };
      try {
        await store.compromiseRotate({ oldMasterPassword: MASTER, newMasterPassword: 'rotated master' });
      } finally {
        vtxn.beginTransaction = orig;
      }
      assert.equal(begun, 1, `${mode}: rotation is one transaction`);
      assert.deepEqual(versions(p.dir), { global: 2, work: 2, play: 2 });
      assert.deepEqual(residue(p.dir), []);
      assert.deepEqual(lines, [], `${mode}: the final install's upgrade skipped silently`);
      for (const id of ids) assert.deepEqual(byId(store.listItems(id)), byId(p.items[id]));
      const fresh = makeStore(p.dir);
      await fresh.unlock('rotated master');
      for (const id of ids) assert.deepEqual(byId(fresh.listItems(id)), byId(p.items[id]));
    } finally {
      rm(p.dir);
    }
  }
});

test('AC8: adopt into a directory holding version-1 residue - same-key residue is upgraded, other-key residue does not unwrap and is skipped', async () => {
  const lines = [];
  const src = await makeProfile({ v2: { work: { items: sampleItems('s') } } });
  const dstDir = tmpDir();
  try {
    const bundle = JSON.parse(JSON.stringify(src.store.exportVault('work')));
    // an earlier failed adopt left version-1 files: 'play' under the SAME master key, 'third' under another
    const mine = oracle.buildDoc({ version: 1, vaultId: 'play', mrk: src.store.mrk, items: sampleItems('r') });
    oracle.writeDoc(dstDir, 'play', mine.doc);
    const other = oracle.buildDoc({ version: 1, vaultId: 'third', mrk: Buffer.alloc(32, 8), items: sampleItems('x') });
    oracle.writeDoc(dstDir, 'third', other.doc);
    const otherBytes = bytesOf(dstDir, 'third');
    const dst = makeStore(dstDir, { log: (l) => lines.push(l) });
    await dst.importVault(bundle, { destinationTarget: 'global', secret: Buffer.from(MASTER), secretKind: 'master' });
    assert.equal(readDoc(dstDir, 'play').version, 2, 'same-key residue upgraded');
    assert.deepEqual(byId(dst.listItems('play')), byId(sampleItems('r')));
    assert.equal(readDoc(dstDir, 'third').version, 1, 'other-key residue skipped');
    assert.ok(bytesOf(dstDir, 'third').equals(otherBytes));
    assert.ok(lines.some((l) => /"third": wrong-key/.test(l)));
    assert.deepEqual(residue(dstDir), []);
  } finally {
    rm(src.dir);
    rm(dstDir);
  }
});

test('AC8 (the documented limit): a version-1 file whose own vaultId field names another vault is bound to its SLOT and opens as that slot, as it does today', async () => {
  const p = await makeProfile({});
  try {
    const built = oracle.buildDoc({
      version: 1,
      vaultId: 'play',
      docVaultId: 'work', // the unauthenticated field disagrees with the slot
      mrk: p.store.mrk,
      items: sampleItems('moved')
    });
    oracle.writeDoc(p.dir, 'play', built.doc);
    const fresh = makeStore(p.dir);
    await fresh.unlock(MASTER);
    const doc = readDoc(p.dir, 'play');
    assert.equal(doc.version, 2);
    assert.equal(doc.vaultId, 'play', 'bound to the slot it was found in');
    assert.deepEqual(byId(fresh.listItems('play')), byId(sampleItems('moved')));
    // ... and a version-1 file of ANOTHER vault copied into a slot is likewise opened and bound there:
    // this is the limit the binding does not close (an old copy placed in another slot)
  } finally {
    rm(p.dir);
  }
});

// ---------------------------------------------------------------------------
// AC9 - automation is unaffected
// ---------------------------------------------------------------------------

test('AC9: a session holding an access key across the upgrade keeps its key and reads the file at its new version; automation alone never upgrades', async () => {
  const p = await v1Profile();
  try {
    const store = makeStore(p.dir);
    const { key } = store.openVaultWithAccessKey('work', p.access.secret);
    assert.deepEqual(byId(store.readVaultItems('work', key)), byId(p.items.work));
    const all = store.openAllWithAdminKey(p.admin);
    assert.equal(
      readDoc(p.dir, 'work').version,
      1,
      'access/admin-key paths never install a master key, so never upgrade'
    );
    const keyHex = key.toString('hex');
    await store.unlock(MASTER); // the operator unlocks: the upgrade runs
    assert.equal(readDoc(p.dir, 'work').version, 2);
    assert.equal(key.toString('hex'), keyHex, 'the held key is unchanged');
    assert.deepEqual(
      byId(store.readVaultItems('work', key)),
      byId(p.items.work),
      'the same key reads the upgraded file'
    );
    for (const id of ids) assert.deepEqual(byId(store.readVaultItems(id, all.get(id))), byId(p.items[id]));
  } finally {
    rm(p.dir);
  }
});
