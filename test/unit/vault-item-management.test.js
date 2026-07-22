'use strict';

// Unit tests for the M12 Flight 3 Leg 2 vault-store item-management ops:
// listItemsMeta / revealItem / deleteItem / saveItemPreservingSecrets — driven
// against a REAL, set-up, unlocked store (the vault-store.test.js FAST-scrypt
// pattern). Verifies the metadata projection carries no secret (all three types),
// lossless round-trip of preserved secrets, the create-defense, and the
// unchanged ⊆ secret guard. Electron-free.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');
const { secretFieldsFor } = require('../../src/shared/vault-item-schema');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';
const JARS = [{ id: 'work' }, { id: 'personal' }];

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vaultitem-')); }
function rm(dir) { fs.rmSync(dir, { recursive: true, force: true }); }
async function makeStore(dir) {
  const store = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => JARS });
  await store.setup({ masterPassword: MASTER });
  return store;
}

/* ------------------------------------------------------------------ listItemsMeta */

test('listItemsMeta returns metadata for all three types with NO secret field/value', async () => {
  const dir = tmpDir();
  try {
    const store = await makeStore(dir);
    store.saveItem('global', { type: 'login', title: 'Bank', username: 'me', origin: 'https://bank.example', password: 'PW', totp: 'SEED', notes: 'reco' });
    store.saveItem('global', { type: 'card', title: 'Visa', cardholder: 'Me', brand: 'visa', last4: '4242', number: '4111111111111111', cvv: '123', expiry: '12/30', notes: 'cardnote' });
    store.saveItem('global', { type: 'note', title: 'Wifi', body: 'hunter2-wifi', notes: 'extra' });

    const meta = store.listItemsMeta('global');
    assert.equal(meta.length, 3);
    const json = JSON.stringify(meta);
    for (const needle of ['PW', 'SEED', 'reco', '4111111111111111', '123', 'hunter2-wifi', 'extra', 'cardnote']) {
      assert.equal(json.includes(needle), false, `metadata leaked secret value "${needle}"`);
    }
    // No secret KEY appears for any row.
    for (const row of meta) {
      assert.equal(row.vaultId, 'global');
      for (const s of secretFieldsFor(row.type)) {
        assert.equal(s in row, false, `row leaked secret key "${s}"`);
      }
    }
    // The login row still carries its non-secret metadata + hasTotp flag.
    const login = meta.find((m) => m.type === 'login');
    assert.equal(login.title, 'Bank');
    assert.equal(login.username, 'me');
    assert.equal(login.origin, 'https://bank.example');
    assert.equal(login.hasTotp, true);
  } finally { rm(dir); }
});

test('listItemsMeta on an uncreated vault is empty; a locked store throws VaultLockedError', async () => {
  const dir = tmpDir();
  try {
    const store = await makeStore(dir);
    assert.deepEqual(store.listItemsMeta('work'), []);
    store.lockNow();
    assert.throws(() => store.listItemsMeta('global'), (e) => e instanceof vs.VaultLockedError);
  } finally { rm(dir); }
});

/* -------------------------------------------------------------------- revealItem */

test('revealItem returns the FULL item for the requested id ONLY (exact scope)', async () => {
  const dir = tmpDir();
  try {
    const store = await makeStore(dir);
    const a = store.saveItem('global', { type: 'login', title: 'A', username: 'a', origin: 'https://a', password: 'pwA', totp: 'seedA' });
    const b = store.saveItem('global', { type: 'login', title: 'B', username: 'b', origin: 'https://b', password: 'pwB' });

    const revealed = store.revealItem('global', a.id);
    assert.equal(revealed.id, a.id);
    assert.equal(revealed.password, 'pwA');
    assert.equal(revealed.totp, 'seedA');
    // It returns ONE item, not the vault — b's secret is not in the result.
    assert.equal(JSON.stringify(revealed).includes('pwB'), false);
    assert.equal(store.revealItem('global', b.id).password, 'pwB');
    assert.equal(store.revealItem('global', 'no-such-id'), null);
  } finally { rm(dir); }
});

/* -------------------------------------------------------------------- deleteItem */

test('deleteItem removes the item and returns true; a missing id returns false (no throw)', async () => {
  const dir = tmpDir();
  try {
    const store = await makeStore(dir);
    const a = store.saveItem('global', { type: 'login', title: 'A', username: 'a', origin: 'https://a', password: 'pw' });
    store.saveItem('global', { type: 'note', title: 'keep', body: 'x' });

    assert.equal(store.deleteItem('global', a.id), true);
    assert.equal(store.listItemsMeta('global').length, 1);
    assert.equal(store.listItemsMeta('global')[0].type, 'note');
    assert.equal(store.deleteItem('global', a.id), false, 'already gone');
    assert.equal(store.deleteItem('work', 'anything'), false, 'uncreated vault, missing id');
  } finally { rm(dir); }
});

/* ---------------------------------------------------- saveItemPreservingSecrets */

test('preserving save: LOGIN — editing title with password+totp+notes unchanged preserves all three', async () => {
  const dir = tmpDir();
  try {
    const store = await makeStore(dir);
    const orig = store.saveItem('global', {
      type: 'login', title: 'Old', username: 'me', origin: 'https://x',
      password: 'secretPW', totp: 'SEEDXYZ', notes: 'recovery codes',
    });
    const saved = store.saveItemPreservingSecrets('global', {
      id: orig.id, type: 'login', title: 'New Title', username: 'me', origin: 'https://x',
      password: '', totp: '', notes: '',
    }, ['password', 'totp', 'notes']);

    assert.equal(saved.title, 'New Title');
    assert.equal(saved.createdAt, orig.createdAt, 'createdAt preserved (full-replace keeps it)');
    const full = store.revealItem('global', orig.id);
    assert.equal(full.title, 'New Title');
    assert.equal(full.password, 'secretPW', 'password preserved');
    assert.equal(full.totp, 'SEEDXYZ', 'totp preserved');
    assert.equal(full.notes, 'recovery codes', 'notes preserved');
  } finally { rm(dir); }
});

test('preserving save: NOTE body preserved; CARD number/cvv preserved when unchanged', async () => {
  const dir = tmpDir();
  try {
    const store = await makeStore(dir);
    // A note has ONLY title + body (no redundant generic `notes` field).
    const note = store.saveItem('global', { type: 'note', title: 'N', body: 'the body' });
    store.saveItemPreservingSecrets('global', { id: note.id, type: 'note', title: 'N2', body: '' }, ['body']);
    const nf = store.revealItem('global', note.id);
    assert.equal(nf.title, 'N2');
    assert.equal(nf.body, 'the body', 'note body preserved');

    const card = store.saveItem('global', { type: 'card', title: 'C', cardholder: 'Me', brand: 'visa', last4: '4242', number: '4111111111111111', cvv: '321', expiry: '01/29', notes: '' });
    store.saveItemPreservingSecrets('global', { id: card.id, type: 'card', title: 'C2', cardholder: 'Me', brand: 'visa', last4: '4242', number: '', cvv: '', expiry: '', notes: '' }, ['number', 'cvv', 'expiry', 'notes']);
    const cf = store.revealItem('global', card.id);
    assert.equal(cf.title, 'C2');
    assert.equal(cf.number, '4111111111111111', 'card number preserved');
    assert.equal(cf.cvv, '321', 'card cvv preserved');
    assert.equal(cf.expiry, '01/29', 'card expiry preserved');
  } finally { rm(dir); }
});

test('preserving save: an EXPLICIT clear (field not in unchangedSecrets) actually removes the value', async () => {
  const dir = tmpDir();
  try {
    const store = await makeStore(dir);
    const orig = store.saveItem('global', { type: 'login', title: 'T', username: 'u', origin: 'https://x', password: 'pw', totp: 'SEED', notes: 'keep' });
    // Clear totp explicitly (empty, NOT in unchangedSecrets); keep password + notes.
    store.saveItemPreservingSecrets('global', {
      id: orig.id, type: 'login', title: 'T', username: 'u', origin: 'https://x', password: '', totp: '', notes: '',
    }, ['password', 'notes']);
    const full = store.revealItem('global', orig.id);
    assert.equal(full.password, 'pw', 'password preserved');
    assert.equal(full.notes, 'keep', 'notes preserved');
    assert.equal(full.totp, '', 'totp explicitly cleared');
  } finally { rm(dir); }
});

test('preserving save: CREATE-DEFENSE — a new-id save naming unchanged fields THROWS (no placeholder persisted)', async () => {
  const dir = tmpDir();
  try {
    const store = await makeStore(dir);
    assert.throws(
      () => store.saveItemPreservingSecrets('global', { id: 'brand-new', type: 'login', title: 'T', password: '' }, ['password']),
      (e) => e instanceof vs.VaultStateError && /create-defense/.test(e.message)
    );
    // Nothing was persisted.
    assert.equal(store.listItemsMeta('global').length, 0);
  } finally { rm(dir); }
});

test('preserving save: a genuine CREATE (no id, empty unchangedSecrets) works and mints an id', async () => {
  const dir = tmpDir();
  try {
    const store = await makeStore(dir);
    const saved = store.saveItemPreservingSecrets('global', { type: 'login', title: 'Fresh', username: 'u', origin: 'https://x', password: 'newpw', totp: '', notes: '' }, []);
    assert.ok(saved.id, 'id minted');
    assert.equal(store.revealItem('global', saved.id).password, 'newpw');
  } finally { rm(dir); }
});

test('preserving save: unchangedSecrets ⊄ secret is rejected (non-secret or unknown field)', async () => {
  const dir = tmpDir();
  try {
    const store = await makeStore(dir);
    const orig = store.saveItem('global', { type: 'login', title: 'T', username: 'u', origin: 'https://x', password: 'pw' });
    // `title` is a non-secret field; `bogus` is unknown — both must be refused.
    assert.throws(
      () => store.saveItemPreservingSecrets('global', { id: orig.id, type: 'login', title: 'T' }, ['title']),
      (e) => e instanceof vs.VaultStateError && /not a secret field/.test(e.message)
    );
    assert.throws(
      () => store.saveItemPreservingSecrets('global', { id: orig.id, type: 'login', title: 'T' }, ['bogus']),
      (e) => e instanceof vs.VaultStateError && /not a secret field/.test(e.message)
    );
  } finally { rm(dir); }
});

test('preserving save: a locked store throws VaultLockedError', async () => {
  const dir = tmpDir();
  try {
    const store = await makeStore(dir);
    store.lockNow();
    assert.throws(
      () => store.saveItemPreservingSecrets('global', { type: 'login', title: 'T', password: 'x' }, []),
      (e) => e instanceof vs.VaultLockedError
    );
  } finally { rm(dir); }
});
