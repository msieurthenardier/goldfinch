'use strict';

// Mission 23 Flight 2 leg 10 (`vault-binding`, DD6, finding 12): the vault code names the
// document's own version and the vault it is for at every read and write, and STILL writes
// exactly the version-1 bytes. Electron-free: temp dirs, fast parameters. Version 2 is
// reached only through the explicit `readable` option / `readableVersions` seam.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vc = require('../../src/main/vault/vault-crypto');
const vs = require('../../src/main/vault/vault-store');
const { mapVaultSheetError, ...sheetErrors } = require('../../src/main/vault/vault-sheet-errors');
const oracle = require('../helpers/vault-oracle');
const { maskComments, findMatchingBracket, collectSources } = require('../helpers/source-scan');

const FAST = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'a master password for binding';
const BOTH = new Set([1, 2]);
const JARS = [{ id: 'work' }, { id: 'play' }];

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gf-binding-'));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const vaultFile = (dir, id) => path.join(dir, 'vaults', `${id}.gfvault`);
function makeStore(dir, extra = {}) {
  return vs.load(dir, { scryptParams: FAST, getAutoLockMinutes: () => 10, listJars: () => JARS, ...extra });
}
const login = (title) => ({
  type: 'login',
  title,
  username: 'u',
  password: 'p',
  origin: 'https://example.com'
});

// ---------------------------------------------------------------------------
// AC1 / AC2 — the crypto layer
// ---------------------------------------------------------------------------

test('constants: the write version is readable; the single VERSION constant is gone', () => {
  assert.ok(vc.READABLE_VAULT_VERSIONS.has(vc.WRITE_VAULT_VERSION));
  assert.deepEqual([...vc.READABLE_VAULT_VERSIONS], [1, 2], 'versions 1 and 2 are read, permanently');
  assert.equal(vc.WRITE_VAULT_VERSION, 2, 'leg vault-format-v2: new files are version 2');
  assert.equal(vc.VERSION, undefined);
  assert.equal(vc.ACCESS_ENVELOPE_AAD_VERSION, 1);
});

test('AAD builders: exact strings, id required for every version, unknown version throws', () => {
  assert.equal(vc.itemsAad(1, 'a').toString(), 'gfvault/items/1');
  assert.equal(vc.itemsAad(2, 'a').toString(), 'gfvault/items/2/a');
  assert.equal(vc.mrkEnvelopeAad(1, 'a').toString(), 'gfvault/mrk-env/v1');
  assert.equal(vc.mrkEnvelopeAad(2, 'a').toString(), 'gfvault/mrk-env/v2/a');
  for (const fn of [vc.itemsAad, vc.mrkEnvelopeAad]) {
    for (const version of [1, 2]) {
      for (const bad of [undefined, '', null, 7, {}]) {
        assert.throws(() => fn(version, bad), vc.VaultFormatError, `version ${version} id ${String(bad)}`);
      }
    }
    for (const version of [0, 3, undefined, '1', 1.5]) assert.throws(() => fn(version, 'a'), vc.VaultFormatError);
  }
});

test('encryptItems / decryptItems take version and id with no defaults', () => {
  const key = vc.newVaultKey();
  assert.throws(() => vc.encryptItems([], key), vc.VaultFormatError);
  assert.throws(() => vc.encryptItems([], key, 1), vc.VaultFormatError);
  const blob = vc.encryptItems([], key, 1, 'a');
  assert.throws(() => vc.decryptItems(blob, key), vc.VaultFormatError);
  assert.throws(() => vc.decryptItems(blob, key, 1), vc.VaultFormatError);
  assert.deepEqual(vc.decryptItems(blob, key, 1, 'a'), []);
  // version 1 ignores the id's VALUE (every existing file was written without it bound)
  assert.deepEqual(vc.decryptItems(blob, key, 1, 'other'), []);
});

test('the six manager-envelope functions require a version', async () => {
  const key = vc.newVaultKey();
  const rec = vc.generateRecoveryKey();
  const admin = vc.generateAdminKeypair();
  const master = await vc.wrapMaster(key, 'pw', { version: 1, params: FAST });
  const recEnv = vc.wrapRecovery(key, rec.material, { version: 1 });
  const adm = vc.sealToAdmin(key, admin.publicKey, { version: 1 });
  await assert.rejects(vc.wrapMaster(key, 'pw', { params: FAST }), vc.VaultFormatError);
  await assert.rejects(vc.unwrapMaster(master, 'pw', { params: FAST }), vc.VaultFormatError);
  assert.throws(() => vc.wrapRecovery(key, rec.material, {}), vc.VaultFormatError);
  assert.throws(() => vc.unwrapRecovery(recEnv, rec.material, {}), vc.VaultFormatError);
  assert.throws(() => vc.sealToAdmin(key, admin.publicKey, {}), vc.VaultFormatError);
  assert.throws(() => vc.openAdminSeal(adm, admin.privateKey, {}), vc.VaultFormatError);
  assert.throws(() => vc.wrapRecovery(key, rec.material), vc.VaultFormatError, 'no opts at all');
});

test('serializeVault / parseVault: version required and readable-checked; readable defaults to the module set', () => {
  const key = vc.newVaultKey();
  const parts = { vaultId: 'a', kdf: FAST, envelopes: [], items: vc.encryptItems([], key, 1, 'a') };
  assert.throws(() => vc.serializeVault(parts), vc.VaultFormatError);
  assert.throws(() => vc.serializeVault(parts, {}), vc.VaultFormatError);
  assert.throws(() => vc.serializeVault(parts, { version: 3 }), vc.VaultFormatError, 'not readable here');
  const v1 = vc.serializeVault(parts, { version: 1 });
  assert.equal(JSON.parse(v1).version, 1);
  const v2 = vc.serializeVault(parts, { version: 2, readable: BOTH });
  assert.equal(JSON.parse(v2).version, 2);
  assert.throws(() => vc.parseVault(v2, { readable: new Set([1]) }), /unsupported version "2"/, 'an older reader');
  assert.equal(vc.parseVault(v2).version, 2, 'this build reads version 2 by default');
  assert.equal(vc.parseVault(v2, { readable: BOTH }).version, 2);
  assert.equal(vc.parseVault(v1, { readable: BOTH }).version, 1);
  assert.throws(() => vc.parseVault(v1, { readable: new Set([2]) }), vc.VaultFormatError);
});

test('access envelope: AAD pinned at version 1 — takes no version, unwraps whatever the document version', () => {
  const key = vc.newVaultKey();
  const acc = vc.generateAccessKey();
  const env = vc.wrapAccess(key, acc.secret, acc.keyId);
  // a stray version option is ignored, never honoured
  const env2 = vc.wrapAccess(key, acc.secret, acc.keyId, { version: 2 });
  for (const e of [env, env2]) assert.ok(vc.unwrapAccess(e, acc.secret).equals(key));
  assert.ok(vc.unwrapAccess(env, acc.secret, { version: 2 }).equals(key));
  // and the AAD is exactly the version-1 string, whatever a document says
  assert.equal(
    vc.envelopeAad(acc.keyId, 'access', vc.ACCESS_ENVELOPE_AAD_VERSION).toString(),
    `gfvault/env/1/access/${acc.keyId}`
  );
});

// ---------------------------------------------------------------------------
// AC5 — version-2 primitives in isolation
// ---------------------------------------------------------------------------

test('version-2 items are bound to the vault id and the version', () => {
  const key = vc.newVaultKey();
  const blob = vc.encryptItems([{ a: 1 }], key, 2, 'A');
  assert.deepEqual(vc.decryptItems(blob, key, 2, 'A'), [{ a: 1 }]);
  assert.throws(() => vc.decryptItems(blob, key, 2, 'B'), vc.VaultAuthError, 'another id');
  assert.throws(() => vc.decryptItems(blob, key, 1, 'A'), vc.VaultAuthError, 'relabelled version 1');
  const v1 = vc.encryptItems([{ a: 1 }], key, 1, 'A');
  assert.throws(() => vc.decryptItems(v1, key, 2, 'A'), vc.VaultAuthError, 'version-1 blob read as 2');
});

test('a version-2 vault-key envelope is bound to the vault id and the version', () => {
  const mrk = vc.newVaultKey();
  const vaultKey = vc.newVaultKey();
  const env = vc.wrapVaultKey(vaultKey, mrk, vc.mrkEnvelopeAad(2, 'A'));
  assert.ok(vc.unwrapVaultKey(env, mrk, vc.mrkEnvelopeAad(2, 'A')).equals(vaultKey));
  assert.throws(() => vc.unwrapVaultKey(env, mrk, vc.mrkEnvelopeAad(2, 'B')), vc.VaultAuthError);
  assert.throws(() => vc.unwrapVaultKey(env, mrk, vc.mrkEnvelopeAad(1, 'A')), vc.VaultAuthError);
});

test('a version-2 document relabelled version 1 (and the reverse) fails to open', () => {
  const mrk = vc.newVaultKey();
  const key = vc.newVaultKey();
  const build = (version) => {
    const env = { keyId: 'mrk', type: 'mrk', ...vc.wrapVaultKey(key, mrk, vc.mrkEnvelopeAad(version, 'A')) };
    return vc.serializeVault(
      { vaultId: 'A', kdf: FAST, envelopes: [env], items: vc.encryptItems([], key, version, 'A') },
      { version, readable: BOTH }
    );
  };
  const open = (json, relabel) => {
    const doc = vc.parseVault(json, { readable: BOTH });
    const env = doc.envelopes[0];
    const k = vc.unwrapVaultKey(env, mrk, vc.mrkEnvelopeAad(relabel, 'A'));
    return vc.decryptItems(doc.items, k, relabel, 'A');
  };
  assert.deepEqual(open(build(2), 2), []);
  assert.deepEqual(open(build(1), 1), []);
  assert.throws(() => open(build(2), 1), vc.VaultAuthError);
  assert.throws(() => open(build(1), 2), vc.VaultAuthError);
});

// ---------------------------------------------------------------------------
// AC4 — a store-written file, decrypted with AAD strings written by hand and raw node:crypto
// ---------------------------------------------------------------------------

function rawOpen(blob, key, aadText) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
  d.setAAD(Buffer.from(aadText, 'utf8'));
  d.setAuthTag(Buffer.from(blob.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(blob.ct, 'base64')), d.final()]);
}

test('new files are version 2: files the store writes open under hand-written v2 AADs via raw node:crypto', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    store.saveItem('global', login('G'));
    store.saveItem('work', login('W'));
    // item writers that copy envelopes verbatim, and a re-encrypt
    store.saveItem('work', login('W2'));
    const mrk = Buffer.from(store.mrk);
    for (const id of ['global', 'work']) {
      const doc = JSON.parse(fs.readFileSync(vaultFile(dir, id), 'utf8'));
      assert.deepEqual(Object.keys(doc), ['format', 'version', 'vaultId', 'kdf', 'envelopes', 'items']);
      assert.equal(doc.format, 'gfvault');
      assert.equal(doc.version, 2);
      assert.equal(doc.vaultId, id);
      const env = doc.envelopes.find((e) => e.keyId === 'mrk');
      const vaultKey = rawOpen(env, mrk, `gfvault/mrk-env/v2/${id}`);
      const items = JSON.parse(rawOpen(doc.items, vaultKey, `gfvault/items/2/${id}`).toString('utf8'));
      assert.ok(items.length >= 1);
    }
  } finally {
    rm(dir);
  }
});

test('compromise rotation rebuilds files at the write version under the v2 AADs', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    store.saveItem('work', login('W'));
    const rec = await store.compromiseRotate({ oldMasterPassword: MASTER, newMasterPassword: 'brand new master pw 1' });
    assert.ok(rec);
    const doc = JSON.parse(fs.readFileSync(vaultFile(dir, 'work'), 'utf8'));
    assert.equal(doc.version, 2);
    assert.equal(doc.vaultId, 'work');
    const mrk = Buffer.from(store.mrk);
    const vaultKey = rawOpen(doc.envelopes[0], mrk, 'gfvault/mrk-env/v2/work');
    assert.equal(JSON.parse(rawOpen(doc.items, vaultKey, 'gfvault/items/2/work').toString('utf8'))[0].title, 'W');
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// AC6 — the id check: a diagnostic, never a lock-out (version 1); typed refusal (later versions)
// ---------------------------------------------------------------------------

test('a version-1 file at another slot opens as before and the mismatch is logged once per id', async () => {
  const dir = tmpDir();
  try {
    const lines = [];
    const store = makeStore(dir, { log: (l) => lines.push(l) });
    await store.setup({ masterPassword: MASTER });
    store.saveItem('global', login('Moved'));
    assert.equal(lines.length, 0, 'no mismatch on any file the store wrote');
    // a version-1 global file (the oracle's, hand-built under the store's master key), moved into the
    // work slot by hand: version 1 binds no id, so it opens as it always did
    oracle.writeDoc(
      dir,
      'global',
      oracle.buildDoc({
        vaultId: 'global',
        mrk: store.mrk,
        items: [{ id: 'm', type: 'login', title: 'Moved', username: 'u', password: 'p', origin: 'https://example.com' }]
      }).doc
    );
    fs.copyFileSync(vaultFile(dir, 'global'), vaultFile(dir, 'work'));
    // drop the key cache instead of re-unlocking: an unlock now UPGRADES a version-1 file and binds it to its
    // slot (leg `vault-upgrade`; vault-upgrade.test.js states that), which would end this diagnostic's premise
    store.vaultKeys = new Map();
    assert.equal(store.listItems('work')[0].title, 'Moved', 'opens exactly as it does today');
    store.listItems('work');
    assert.equal(lines.length, 1, 'once per id');
    assert.match(lines[0], /"work"/);
    assert.match(lines[0], /"global"/);
    // a different id logs separately
    fs.copyFileSync(vaultFile(dir, 'global'), vaultFile(dir, 'play'));
    store.listItems('play');
    assert.equal(lines.length, 2);
  } finally {
    rm(dir);
  }
});

test('a throwing log sink never fails a read', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir, {
      log: () => {
        throw new Error('sink down');
      }
    });
    await store.setup({ masterPassword: MASTER });
    oracle.writeDoc(
      dir,
      'global',
      oracle.buildDoc({
        vaultId: 'global',
        mrk: store.mrk,
        items: [{ id: 'x', type: 'login', title: 'X', username: 'u', password: 'p', origin: 'https://example.com' }]
      }).doc
    );
    fs.copyFileSync(vaultFile(dir, 'global'), vaultFile(dir, 'work'));
    assert.equal(store.listItems('work').length, 1);
  } finally {
    rm(dir);
  }
});

/** Hand-build a version-2 file for `slot` carrying the field `fieldId`, under `store`'s MRK. */
function writeV2(dir, store, slot, fieldId, titles = ['V2']) {
  const key = vc.newVaultKey();
  const env = { keyId: 'mrk', type: 'mrk', ...vc.wrapVaultKey(key, store.mrk, vc.mrkEnvelopeAad(2, fieldId)) };
  const items = titles.map((t, i) => ({
    id: `i${i}`,
    type: 'login',
    title: t,
    username: 'u',
    password: 'p',
    origin: 'https://example.com',
    createdAt: 1,
    updatedAt: 1
  }));
  fs.writeFileSync(
    vaultFile(dir, slot),
    vc.serializeVault(
      { vaultId: fieldId, kdf: FAST, envelopes: [env], items: vc.encryptItems(items, key, 2, fieldId) },
      { version: 2, readable: BOTH }
    )
  );
}

test('a later-version file whose vaultId is another slot throws VaultWrongVaultError (typed, no id in the message)', async () => {
  const dir = tmpDir();
  try {
    const lines = [];
    const store = makeStore(dir, { log: (l) => lines.push(l) });
    await store.setup({ masterPassword: MASTER });
    writeV2(dir, store, 'work', 'play');
    let err;
    try {
      store.listItems('work');
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof vs.VaultWrongVaultError);
    assert.ok(err instanceof vs.VaultFormatError);
    assert.equal(err.name, 'VaultWrongVaultError');
    assert.ok(!/work|play/.test(err.message), 'the message names no id');
    assert.equal(lines.length, 1);
    assert.ok(/work/.test(lines[0]) && /play/.test(lines[0]), 'the log names both');
    // an older reader (version 2 not readable) refuses with its unsupported-version error
    const plain = makeStore(dir, { readableVersions: new Set([1]) });
    await plain.unlock(MASTER);
    assert.throws(() => plain.listItems('work'), /unsupported version "2"/);
  } finally {
    rm(dir);
  }
});

test('a later-version file at its own slot opens, and an item write keeps that version bound to the slot id', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    writeV2(dir, store, 'work', 'work');
    assert.equal(store.listItems('work')[0].title, 'V2');
    store.saveItem('work', login('Added'));
    const doc = JSON.parse(fs.readFileSync(vaultFile(dir, 'work'), 'utf8'));
    assert.equal(doc.version, 2, "a writer that rewrites a document passes THAT document's version");
    const vaultKey = rawOpen(doc.envelopes[0], Buffer.from(store.mrk), 'gfvault/mrk-env/v2/work');
    const items = JSON.parse(rawOpen(doc.items, vaultKey, 'gfvault/items/2/work').toString('utf8'));
    assert.deepEqual(items.map((i) => i.title).sort(), ['Added', 'V2']);
    // a new file built from a key (a jar's first write) is stamped the write version, not the other's
    store.saveItem('play', login('New'));
    assert.equal(JSON.parse(fs.readFileSync(vaultFile(dir, 'play'), 'utf8')).version, vc.WRITE_VAULT_VERSION);
    assert.equal(vc.WRITE_VAULT_VERSION, 2);
  } finally {
    rm(dir);
  }
});

test('mint and revoke of an access key on a later-version file keep its version and the pinned access AAD', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    writeV2(dir, store, 'work', 'work');
    const { secret, keyId } = await store.mintAccessKey('work', { masterPassword: MASTER });
    const doc = JSON.parse(fs.readFileSync(vaultFile(dir, 'work'), 'utf8'));
    assert.equal(doc.version, 2);
    assert.equal(doc.envelopes.length, 2);
    // the access envelope opens with the version-1 access AAD even though the document is 2
    const reader = makeStore(dir);
    assert.ok(reader.unlockVaultWithAccessKey('work', secret).length === 32);
    assert.equal(store.revokeAccessKey('work', keyId), true);
    const after = JSON.parse(fs.readFileSync(vaultFile(dir, 'work'), 'utf8'));
    assert.equal(after.version, 2, 'revoke keeps the document version');
    assert.equal(after.envelopes.length, 1);
    assert.equal(store.listItems('work')[0].title, 'V2', 'the file still opens after the revoke');
  } finally {
    rm(dir);
  }
});

test('the sheet error tables map VaultWrongVaultError exactly as a VaultFormatError', () => {
  let checked = 0;
  for (const [name, cfg] of Object.entries(sheetErrors)) {
    if (!name.endsWith('_CONFIG') || !('VaultFormatError' in cfg)) continue;
    assert.deepEqual(
      mapVaultSheetError(new vc.VaultWrongVaultError(), cfg),
      mapVaultSheetError(new vs.VaultFormatError('x'), cfg),
      name
    );
    checked++;
  }
  assert.ok(checked >= 1, 'at least one table admits a format error (vacuity guard)');
});

// ---------------------------------------------------------------------------
// AC3 — source scan: no call with fewer arguments than required
// ---------------------------------------------------------------------------

const REQUIRED = { encryptItems: 4, decryptItems: 4, serializeVault: 2, mrkEnvelopeAad: 2, itemsAad: 2 };

/** Count top-level arguments of the call whose '(' is at `open`. */
function argCount(masked, open) {
  const close = findMatchingBracket(masked, open, '(', ')');
  assert.ok(close > open, 'matching bracket');
  const body = masked.slice(open + 1, close);
  if (body.trim() === '') return 0;
  let depth = 0;
  let quote = null;
  let n = 1;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) n++;
  }
  // a trailing comma does not add an argument
  if (/,\s*$/.test(body)) n--;
  return n;
}

/** Every call in `source` that passes fewer arguments than REQUIRED says. */
function shortCalls(source) {
  const masked = maskComments(source);
  const out = [];
  const re = /(?<![\w$])(?:vc\.)?(encryptItems|decryptItems|serializeVault|mrkEnvelopeAad|itemsAad)\s*\(/g;
  let m;
  while ((m = re.exec(masked)) !== null) {
    if (/function\s+$/.test(masked.slice(Math.max(0, m.index - 12), m.index))) continue; // a definition
    const open = m.index + m[0].length - 1;
    const n = argCount(masked, open);
    if (n < REQUIRED[m[1]]) out.push({ fn: m[1], args: n, at: masked.slice(0, m.index).split('\n').length });
  }
  return out;
}

function assertMutated(before, after) {
  assert.notEqual(before, after, 'the mutation changed the source (a no-op replace passes vacuously)');
}

test('source scan: no call to encryptItems / decryptItems / serializeVault / mrkEnvelopeAad / itemsAad in src/ has fewer arguments than required', () => {
  const root = path.join(__dirname, '..', '..', 'src');
  let sawCalls = 0;
  for (const file of collectSources(root)) {
    const src = fs.readFileSync(file, 'utf8');
    sawCalls += (
      maskComments(src).match(/\b(encryptItems|decryptItems|serializeVault|mrkEnvelopeAad|itemsAad)\s*\(/g) || []
    ).length;
    assert.deepEqual(shortCalls(src), [], `${path.relative(root, file)}`);
  }
  assert.ok(sawCalls >= 30, `the scan saw the calls (${sawCalls})`);
});

test('source scan: neuter-verified — dropping the last argument of a real store call is caught', () => {
  const store = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'vault', 'vault-store.js'), 'utf8');
  const drops = [
    [/(vc\.decryptItems\(doc\.items, vaultKey, doc\.version), vaultId\)/, '$1)'],
    [/(vc\.encryptItems\(kept, vaultKey, doc\.version), vaultId\)/, '$1)'],
    [/(vc\.mrkEnvelopeAad\(doc\.version), vaultId\)/, '$1)']
  ];
  for (const [re, rep] of drops) {
    const mutated = store.replace(re, rep);
    assertMutated(store, mutated);
    assert.ok(shortCalls(mutated).length >= 1, String(re));
  }
  // serializeVault's options bag removed entirely
  const mut = store.replace(/\},\s*\{ version: parts\.version, readable: this\._readableVersions \}\s*\)/, '})');
  assertMutated(store, mut);
  assert.ok(shortCalls(mut).some((c) => c.fn === 'serializeVault'));
});

test('_writeVault requires the document version (no default)', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    const doc = store._readVault('global');
    assert.throws(
      () => store._writeVault('global', { kdf: doc.kdf, envelopes: doc.envelopes, items: doc.items }),
      vc.VaultFormatError
    );
    store._writeVault('global', { version: doc.version, kdf: doc.kdf, envelopes: doc.envelopes, items: doc.items });
  } finally {
    rm(dir);
  }
});
