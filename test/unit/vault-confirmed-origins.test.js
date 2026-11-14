'use strict';

// `confirmedOrigins` (Mission 23 Flight 1, leg `vault-picker-controls`, DD6): the small pure module (tolerant
// reader, cap 50 oldest dropped, append no-op on a listed origin) and every store write path against a REAL
// vault fixture file under a temp directory: the dedicated record operation (direct write, `updatedAt`
// untouched, no write on a no-op), the editor save carry-over (page cannot set it), cross-vault copy strip (both
// branches), bundle-merge equality, capture card update (number change clears), rotation / re-key / export /
// restore carrying whole items, the vault page's list payload (`metadataOf` unchanged), and the four-source
// rule (the field is outside the schema's field lists).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');
const {
  CONFIRMED_ORIGINS_CAP,
  readConfirmedOrigins,
  appendConfirmedOrigin,
  withoutConfirmedOrigins
} = require('../../src/main/vault/confirmed-origins');
const { metadataOf, SCHEMA } = require('../../src/shared/vault-item-schema');
const { isIdenticalItem } = require('../../src/main/vault/copy-plan');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';
const NEW_MASTER = 'a different master passphrase';
const JARS = [
  { id: 'work', name: 'Work', color: '#2196f3' },
  { id: 'personal', name: 'Personal', color: '#f5c518' }
];
const A = 'https://a.example';
const B = 'https://b.example';
const CARD = {
  type: 'card',
  title: 'Visa',
  cardholder: 'A L',
  brand: 'Visa',
  last4: '4242',
  number: '4242424242424242',
  cvv: '123',
  expiry: '12/28'
};
const IDENTITY = {
  type: 'identity',
  title: 'Home',
  fullName: 'Ada Lovelace',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'a@x.test'
};

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-confirmed-'));
}
function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
function makeStore(dir, overrides = {}) {
  let clock = 1_000_000;
  return vs.load(dir, {
    scryptParams: FAST_SCRYPT,
    getAutoLockMinutes: () => 10,
    listJars: () => JARS,
    now: () => (clock += 1000),
    ...overrides
  });
}
async function setUp(dir) {
  const store = makeStore(dir);
  await store.setup({ masterPassword: MASTER });
  return store;
}
const stored = (store, target, id) => store.listItems(target).find((i) => i.id === id);
const vaultBytes = (dir, id) => fs.readFileSync(path.join(dir, 'vaults', `${id}.gfvault`));

// ---- the pure module ----------------------------------------------------------------------------

test('reader: not an array -> empty; non-string and empty entries are filtered; never throws, never mutates', () => {
  for (const bad of [undefined, null, 'https://a.example', 5, {}, { 0: 'https://a.example', length: 1 }]) {
    assert.deepEqual(readConfirmedOrigins({ confirmedOrigins: bad }), []);
  }
  assert.deepEqual(readConfirmedOrigins(null), []);
  assert.deepEqual(readConfirmedOrigins(undefined), []);
  const raw = [A, 7, null, '', { o: 1 }, B, [A]];
  const item = { confirmedOrigins: raw };
  assert.deepEqual(readConfirmedOrigins(item), [A, B]);
  assert.equal(raw.length, 7, 'the input is untouched');
});

test('append: a listed origin is a no-op (same list, changed false); otherwise appended; cap 50 drops the OLDEST', () => {
  assert.equal(CONFIRMED_ORIGINS_CAP, 50);
  const first = appendConfirmedOrigin([], A);
  assert.deepEqual(first, { list: [A], changed: true });
  const again = appendConfirmedOrigin([A, B], A);
  assert.equal(again.changed, false);
  assert.deepEqual(again.list, [A, B], 'no duplicate and no reordering');
  assert.equal(appendConfirmedOrigin([A], '').changed, false);
  assert.equal(appendConfirmedOrigin([A], 5).changed, false);
  const full = Array.from({ length: 50 }, (_, i) => `https://s${i}.example`);
  const next = appendConfirmedOrigin(full, 'https://new.example');
  assert.equal(next.changed, true);
  assert.equal(next.list.length, 50);
  assert.equal(next.list[0], 'https://s1.example', 'the oldest was dropped');
  assert.equal(next.list.at(-1), 'https://new.example');
  assert.equal(full.length, 50, 'the input list is untouched');
});

test('withoutConfirmedOrigins returns a copy without the key and leaves other items as they are', () => {
  const item = { id: 'x', confirmedOrigins: [A] };
  const out = withoutConfirmedOrigins(item);
  assert.deepEqual(out, { id: 'x' });
  assert.deepEqual(item.confirmedOrigins, [A], 'the input keeps it');
  const plain = { id: 'y' };
  assert.equal(withoutConfirmedOrigins(plain), plain);
});

// ---- the dedicated store operation ----------------------------------------------------------------

test('recordConfirmedOrigin: appends in place, leaves updatedAt and every other field alone, and a listed origin writes nothing', async () => {
  const dir = tmpDir();
  try {
    const store = await setUp(dir);
    const card = store.saveItem('work', CARD);
    const before = stored(store, 'work', card.id);
    const bytesBefore = vaultBytes(dir, 'work');
    assert.deepEqual(store.recordConfirmedOrigin('work', card.id, A), { recorded: true });
    const after = stored(store, 'work', card.id);
    assert.deepEqual(after.confirmedOrigins, [A]);
    assert.equal(after.updatedAt, before.updatedAt, 'updatedAt untouched');
    assert.equal(after.createdAt, before.createdAt);
    assert.deepEqual(
      { ...after, confirmedOrigins: undefined },
      { ...before, confirmedOrigins: undefined },
      'nothing else changed'
    );
    assert.ok(!vaultBytes(dir, 'work').equals(bytesBefore), 'the file was written');

    const bytesMid = vaultBytes(dir, 'work');
    assert.deepEqual(store.recordConfirmedOrigin('work', card.id, A), { recorded: false });
    assert.ok(vaultBytes(dir, 'work').equals(bytesMid), 'a listed origin is a no-op: no write at all');

    // Two confirmations in quick succession (serialised by the synchronous op) are both kept.
    store.recordConfirmedOrigin('work', card.id, B);
    assert.deepEqual(stored(store, 'work', card.id).confirmedOrigins, [A, B]);
  } finally {
    rm(dir);
  }
});

test('recordConfirmedOrigin: identity too; a login, an unknown item, an uncreated vault and bad arguments record nothing; the cap holds', async () => {
  const dir = tmpDir();
  try {
    const store = await setUp(dir);
    const id = store.saveItem('global', IDENTITY);
    const login = store.saveItem('global', { type: 'login', title: 'L', username: 'u', password: 'p', origin: A });
    assert.deepEqual(store.recordConfirmedOrigin('global', id.id, A), { recorded: true });
    assert.deepEqual(
      store.recordConfirmedOrigin('global', login.id, A),
      { recorded: false },
      'a login never takes this step'
    );
    assert.equal(stored(store, 'global', login.id).confirmedOrigins, undefined);
    assert.deepEqual(store.recordConfirmedOrigin('global', 'nope', A), { recorded: false });
    assert.deepEqual(store.recordConfirmedOrigin('personal', 'x', A), { recorded: false }, 'uncreated vault');
    assert.deepEqual(store.recordConfirmedOrigin('global', id.id, ''), { recorded: false });
    assert.throws(() => store.recordConfirmedOrigin('burner:1', id.id, A), /vault-store/);
    for (let i = 0; i < 60; i++) store.recordConfirmedOrigin('global', id.id, `https://s${i}.example`);
    const list = stored(store, 'global', id.id).confirmedOrigins;
    assert.equal(list.length, 50);
    assert.equal(list[0], 'https://s10.example');
    assert.equal(list.at(-1), 'https://s59.example');
  } finally {
    rm(dir);
  }
});

test('recordConfirmedOrigin on a locked store throws the locked error (the caller traces it; the fill is not failed)', async () => {
  const dir = tmpDir();
  try {
    const store = await setUp(dir);
    const card = store.saveItem('work', CARD);
    store.lockNow();
    assert.throws(
      () => store.recordConfirmedOrigin('work', card.id, A),
      (e) => e instanceof vs.VaultLockedError
    );
  } finally {
    rm(dir);
  }
});

// ---- the editor save path ---------------------------------------------------------------------------

test('editor save: the stored list is carried over REGARDLESS of what the page sent; a page value on a new item is deleted', async () => {
  const dir = tmpDir();
  try {
    const store = await setUp(dir);
    const card = store.saveItem('work', CARD);
    store.recordConfirmedOrigin('work', card.id, A);
    // The page edits the title and (maliciously or by echoing a reveal) sends its own list.
    const sent = { ...stored(store, 'work', card.id), title: 'Visa 2', confirmedOrigins: ['https://evil.example'] };
    store.saveItemPreservingSecrets('work', sent, []);
    const after = stored(store, 'work', card.id);
    assert.equal(after.title, 'Visa 2');
    assert.deepEqual(after.confirmedOrigins, [A], 'the stored value wins');
    // The page omits it entirely: still carried.
    const noList = { ...stored(store, 'work', card.id) };
    delete noList.confirmedOrigins;
    store.saveItemPreservingSecrets('work', { ...noList, title: 'Visa 3' }, []);
    assert.deepEqual(stored(store, 'work', card.id).confirmedOrigins, [A]);
    // An item that never had one cannot be given one by the page.
    const other = store.saveItem('work', { ...CARD, title: 'Other', number: '5555555555554444' });
    store.saveItemPreservingSecrets('work', { ...stored(store, 'work', other.id), confirmedOrigins: [B] }, []);
    assert.equal(
      stored(store, 'work', other.id).confirmedOrigins,
      undefined,
      'a page-supplied value on an existing item without one is dropped'
    );
    // A NEW item (no id) with a page-supplied list: deleted.
    const created = store.saveItemPreservingSecrets(
      'work',
      { ...CARD, title: 'New', number: '4000056655665556', confirmedOrigins: [B] },
      []
    );
    assert.equal(stored(store, 'work', created.id).confirmedOrigins, undefined);
  } finally {
    rm(dir);
  }
});

// ---- cross-vault copy ---------------------------------------------------------------------------------

test('cross-vault copy strips it on the new-item branch AND on replace and keep-both; the source keeps its own', async () => {
  const dir = tmpDir();
  try {
    const store = await setUp(dir);
    const src = store.saveItem('global', CARD);
    store.recordConfirmedOrigin('global', src.id, A);
    // New (collision-free) branch.
    assert.equal(store.copyItem('global', src.id, 'work').outcome, 'copied');
    const copied = store.listItems('work').find((i) => i.type === 'card');
    assert.equal(copied.confirmedOrigins, undefined, 'a copy asks again');
    assert.deepEqual(stored(store, 'global', src.id).confirmedOrigins, [A], 'the source keeps its list');

    // Make the destination card differ so the plan is `match`; give the destination its own list first.
    store.saveItem('work', { ...copied, cardholder: 'Someone Else' });
    store.recordConfirmedOrigin('work', copied.id, B);
    const ask = store.copyItem('global', src.id, 'work');
    assert.equal(ask.outcome, 'needs-resolution');
    const replaced = store.copyItem('global', src.id, 'work', { resolution: 'replace', matchId: ask.match.id });
    assert.equal(replaced.outcome, 'replaced');
    assert.equal(stored(store, 'work', copied.id).confirmedOrigins, undefined, 'replace branch strips');

    store.saveItem('work', { ...stored(store, 'work', copied.id), cardholder: 'Third Person' });
    const ask2 = store.copyItem('global', src.id, 'work');
    const both = store.copyItem('global', src.id, 'work', { resolution: 'keep-both', matchId: ask2.match.id });
    assert.equal(both.outcome, 'kept-both');
    for (const it of store.listItems('work').filter((i) => i.type === 'card')) {
      assert.equal(it.confirmedOrigins, undefined, `${it.title}: keep-both strips`);
    }
  } finally {
    rm(dir);
  }
});

test('the copy-plan comparison already ignores it (the field is outside the schema lists)', () => {
  const a = { ...CARD, id: '1' };
  const b = { ...CARD, id: '2', confirmedOrigins: [A, B] };
  assert.equal(isIdenticalItem(a, b), true);
  assert.equal(isIdenticalItem(b, a), true);
});

// ---- bundle merge ------------------------------------------------------------------------------------

test('merge equality ignores it on both branches: an item that differs only there is identical (destination keeps its list)', () => {
  const base = { id: 'c1', ...CARD };
  const dest = [{ ...base, confirmedOrigins: [A] }];
  const incoming = [{ ...base, confirmedOrigins: [B] }];
  const r = vs.mergeVaultItems(dest, incoming);
  assert.deepEqual(r.mergeReport, { imported: 0, skippedIdentical: 1, conflictCopies: 0 });
  assert.equal(r.items.length, 1);
  assert.deepEqual(r.items[0].confirmedOrigins, [A], 'the destination keeps its own list');
  // Incoming without the field vs destination with it: still identical.
  assert.equal(vs.mergeVaultItems(dest, [{ ...base }]).mergeReport.skippedIdentical, 1);
  // A real difference still lands as a conflict copy.
  assert.equal(vs.mergeVaultItems(dest, [{ ...base, cvv: '999' }]).mergeReport.conflictCopies, 1);
  // The identity branch (its own equality check) ignores it too.
  const idBase = { id: 'i1', ...IDENTITY };
  const idMerge = vs.mergeVaultItems([{ ...idBase, confirmedOrigins: [A] }], [{ ...idBase, confirmedOrigins: [B] }]);
  assert.deepEqual(idMerge.mergeReport, { imported: 0, skippedIdentical: 1, conflictCopies: 0 });
  assert.equal(idMerge.identitySkipped, false, 'identical, not a second profile');
});

// ---- capture update -------------------------------------------------------------------------------------

test('capture update (card): an unchanged number keeps the list; a CHANGED number clears it', async () => {
  const dir = tmpDir();
  try {
    const store = await setUp(dir);
    const { createVaultHuman } = require('../../src/main/vault/vault-human');
    const urls = { 10: A + '/checkout' };
    const human = createVaultHuman({
      getVaultStore: () => store,
      fromId: (id) => (urls[id] ? { getURL: () => urls[id] } : null),
      getTabEntry: () => ({ partition: 'persist:container:work', trusted: false }),
      listJars: () => [{ id: 'work', partition: 'persist:container:work' }],
      fillDelegate() {},
      broadcast() {}
    });
    const card = store.saveItem('work', CARD);
    store.recordConfirmedOrigin('work', card.id, A);
    const update = (number) => {
      const rec = {
        captureId: 'cap-' + number,
        kind: 'card',
        mode: 'update',
        vaultId: 'work',
        itemId: card.id,
        choices: ['work', 'global'],
        number: Buffer.from(number),
        cvv: Buffer.from('123'),
        expiry: '12/28',
        cardholder: 'A L',
        brand: 'Visa',
        last4: number.slice(-4),
        wcId: 10,
        origin: A,
        timer: null
      };
      human._seedCaptureForTest(rec);
      return human.captureSave({ captureId: rec.captureId, vaultId: 'work' });
    };
    assert.deepEqual(await update('4242424242424242'), { saved: true });
    assert.deepEqual(stored(store, 'work', card.id).confirmedOrigins, [A], 'same number: kept');
    assert.deepEqual(await update('5555555555554444'), { saved: true });
    const after = stored(store, 'work', card.id);
    assert.equal(after.number, '5555555555554444');
    assert.equal(after.confirmedOrigins, undefined, 'a different card asks again');
  } finally {
    rm(dir);
  }
});

// ---- rotation, re-key, export, restore ------------------------------------------------------------------

test('rotation and master re-key carry the field (whole items are re-encrypted)', async () => {
  const dir = tmpDir();
  try {
    const store = await setUp(dir);
    const card = store.saveItem('work', CARD);
    store.recordConfirmedOrigin('work', card.id, A);
    await store.compromiseRotate({
      oldMasterPassword: Buffer.from(MASTER, 'utf8'),
      newMasterPassword: Buffer.from(NEW_MASTER, 'utf8')
    });
    assert.deepEqual(stored(store, 'work', card.id).confirmedOrigins, [A], 'compromise rotation');
    store.lockNow();
    await store.unlock(NEW_MASTER);
    assert.deepEqual(stored(store, 'work', card.id).confirmedOrigins, [A], 'after relock + unlock');
    await store.changeMasterPassword({ oldMasterPassword: NEW_MASTER, newMasterPassword: MASTER });
    assert.deepEqual(stored(store, 'work', card.id).confirmedOrigins, [A], 'master change');
  } finally {
    rm(dir);
  }
});

test('export then adopt on a fresh profile carries the field (a restored bundle keeps confirmed sites)', async () => {
  const dir = tmpDir();
  const freshDir = tmpDir();
  try {
    const store = await setUp(dir);
    const card = store.saveItem('work', CARD);
    store.recordConfirmedOrigin('work', card.id, A);
    const bundle = store.exportVault('work');
    const fresh = makeStore(freshDir, { listJars: () => [] });
    await fresh.importVault(bundle, { secret: Buffer.from(MASTER), secretKind: 'master' });
    assert.deepEqual(stored(fresh, 'global', card.id).confirmedOrigins, [A]);
  } finally {
    rm(dir);
    rm(freshDir);
  }
});

test('an older item with no field is simply "no confirmed sites"; nothing is rewritten on load', async () => {
  const dir = tmpDir();
  try {
    const store = await setUp(dir);
    store.saveItem('work', CARD);
    const bytes = vaultBytes(dir, 'work');
    store.lockNow();
    await store.unlock(MASTER);
    store.listItems('work');
    assert.ok(vaultBytes(dir, 'work').equals(bytes), 'load/list wrote nothing');
    assert.equal(store.listItems('work')[0].confirmedOrigins, undefined);
  } finally {
    rm(dir);
  }
});

// ---- the vault page and the four-source rule ---------------------------------------------------------------

test('the vault page list payload never carries it (metadataOf unchanged), and the field is outside every schema field list', async () => {
  const dir = tmpDir();
  try {
    const store = await setUp(dir);
    const card = store.saveItem('work', CARD);
    store.recordConfirmedOrigin('work', card.id, A);
    const full = stored(store, 'work', card.id);
    assert.ok('confirmedOrigins' in full);
    assert.equal('confirmedOrigins' in metadataOf(full), false);
    assert.equal('confirmedOrigins' in store.listItemsMeta('work')[0], false);
    assert.equal(JSON.stringify(store.listItemsMeta('work')).includes(A), false);
    // A reveal returns the stored item, so the page can SEE it after a reveal (it can never set it).
    assert.deepEqual(store.revealItem('work', card.id).confirmedOrigins, [A]);
    for (const [type, spec] of Object.entries(SCHEMA)) {
      assert.ok(
        ![...spec.nonSecret, ...spec.secret].includes('confirmedOrigins'),
        `${type} schema lists no confirmedOrigins`
      );
    }
  } finally {
    rm(dir);
  }
});
