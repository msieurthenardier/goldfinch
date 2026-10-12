'use strict';

// Unit tests for VaultStore.copyItem / _copyItem (Sortie 04 Leg 1 / DD1-DD6, DD9):
// every DD3 outcome-table cell, the stale-commit rule, field carry + fresh ids,
// lazy destination + stale vaultKeys, refusals with zero writes, and the
// identity singleton. Real store, real temp dirs, FAST scrypt, injected clock.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');
const { SCHEMA, secretFieldsFor } = require('../../src/shared/vault-item-schema');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';
const JARS = [{ id: 'work' }, { id: 'personal' }, { id: 'lazy' }];

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vault-copy-'));
}
function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
function vaultPath(dir, id) {
  return path.join(dir, 'vaults', `${id}.gfvault`);
}
function bytes(dir, id) {
  return fs.existsSync(vaultPath(dir, id)) ? fs.readFileSync(vaultPath(dir, id)) : null;
}

/** Fresh set-up store with an injectable clock (`clock.t`). */
async function mk() {
  const dir = tmpDir();
  const clock = { t: 1000 };
  const store = vs.load(dir, {
    scryptParams: FAST_SCRYPT,
    listJars: () => JARS,
    now: () => clock.t,
    getAutoLockMinutes: () => 10
  });
  await store.setup({ masterPassword: MASTER });
  return { dir, store, clock };
}

const login = (o = {}) => ({
  id: 'src1',
  type: 'login',
  title: 'Site',
  origin: 'https://example.com',
  username: 'alice',
  password: 'pw-SRC',
  totp: 'otpauth://totp/x?secret=ABC',
  notes: 'n-SRC',
  matchMode: 'registrable-domain',
  ...o
});
const dLogin = (id, o = {}) => login({ id, title: `Dest ${id}`, password: `pw-${id}`, totp: undefined, ...o });

/** Seed items via saveItem (ids preserved). */
function seed(store, target, items) {
  for (const it of items) store.saveItem(target, it);
}

/** Run one copy against a destination seeded to `destSeed`; report outcome + zero-write evidence. */
async function scenario({ source = login(), destSeed = [], resolution, matchId }) {
  const { dir, store } = await mk();
  try {
    seed(store, 'work', [source]);
    if (destSeed.length > 0) seed(store, 'personal', destSeed);
    const before = bytes(dir, 'personal');
    const srcBefore = bytes(dir, 'work');
    const opts = resolution ? { resolution, matchId } : {};
    const reply = store.copyItem('work', source.id, 'personal', opts);
    const after = bytes(dir, 'personal');
    assert.deepEqual(bytes(dir, 'work'), srcBefore, 'source vault byte-identical');
    return {
      reply,
      wrote: !before || !after ? before !== after : !before.equals(after),
      items: store.listItems('personal')
    };
  } finally {
    rm(dir);
  }
}

// ---------------------------------------------------------------------------
// DD3 outcome table — one assertion per cell
// ---------------------------------------------------------------------------

const UNRELATED = { id: 'u1', type: 'note', title: 'unrelated', body: 'x' };
const IDENTICAL = () => login({ id: 'dI' });

test('table: any -> identical x {none, skip, replace, keep-both} -> already-present, no write', async () => {
  for (const resolution of [undefined, 'skip', 'replace', 'keep-both']) {
    const r = await scenario({ destSeed: [IDENTICAL()], resolution, matchId: 'dI' });
    assert.equal(r.reply.outcome, 'already-present', String(resolution));
    assert.equal(r.wrote, false, String(resolution));
    assert.equal(r.items.length, 1);
  }
});

/** [name, destSeed, matchId, {skip, replace, keep-both}] with `w` = expect a write. */
const CELLS = [
  ['M1(A)->new', [UNRELATED], 'dA', { skip: 'skipped', replace: 'copied', 'keep-both': 'copied' }],
  ['M1(A)->M1(A)', [dLogin('dA')], 'dA', { skip: 'skipped', replace: 'replaced', 'keep-both': 'kept-both' }],
  [
    'M1(A)->M1(B)',
    [dLogin('dB')],
    'dA',
    { skip: 'skipped', replace: 'needs-resolution', 'keep-both': 'needs-resolution' }
  ],
  [
    'M1(A)->Mn(first A)',
    [dLogin('dA'), dLogin('dB')],
    'dA',
    { skip: 'skipped', replace: 'needs-resolution', 'keep-both': 'kept-both' }
  ],
  [
    'M1(A)->Mn(first B)',
    [dLogin('dB'), dLogin('dA')],
    'dA',
    { skip: 'skipped', replace: 'needs-resolution', 'keep-both': 'needs-resolution' }
  ],
  ['Mn(A)->M1(A) keep-both', [dLogin('dA')], 'dA', { skip: 'skipped', 'keep-both': 'kept-both' }],
  ['Mn(A)->new keep-both', [UNRELATED], 'dA', { skip: 'skipped', 'keep-both': 'copied' }]
];
const WRITES = new Set(['copied', 'replaced', 'kept-both']);

for (const [name, destSeed, matchId, expected] of CELLS) {
  for (const [resolution, outcome] of Object.entries(expected)) {
    test(`table: ${name} x ${resolution} -> ${outcome}`, async () => {
      const r = await scenario({ destSeed, resolution, matchId });
      assert.equal(r.reply.outcome, outcome);
      assert.equal(r.wrote, WRITES.has(outcome), 'write iff the outcome landed something');
      if (outcome === 'needs-resolution') {
        assert.equal(r.reply.match.id, destSeed[0].id, 'fresh answer names the CURRENT first match');
        assert.ok(Array.isArray(r.reply.allowed));
      }
    });
  }
}

const IDENT_SRC = () => ({
  id: 'isrc',
  type: 'identity',
  title: 'Me',
  fullName: 'A B',
  email: 'a-SRC@x.y',
  city: 'Oslo'
});
const dIdent = (id, o = {}) => ({ id, type: 'identity', title: 'Dest', fullName: 'Z', email: `${id}@x.y`, ...o });

test('table: ID(A) -> new x replace -> copied', async () => {
  const r = await scenario({ source: IDENT_SRC(), destSeed: [UNRELATED], resolution: 'replace', matchId: 'dA' });
  assert.equal(r.reply.outcome, 'copied');
  assert.equal(r.items.filter((i) => i.type === 'identity').length, 1);
});
test('table: ID(A) -> ID(A) x replace -> replaced', async () => {
  const r = await scenario({ source: IDENT_SRC(), destSeed: [dIdent('dA')], resolution: 'replace', matchId: 'dA' });
  assert.equal(r.reply.outcome, 'replaced');
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].id, 'dA');
  assert.equal(r.items[0].email, 'a-SRC@x.y');
});
test('table: ID(A) -> ID(B) x replace -> needs-resolution, no write', async () => {
  const r = await scenario({ source: IDENT_SRC(), destSeed: [dIdent('dB')], resolution: 'replace', matchId: 'dA' });
  assert.equal(r.reply.outcome, 'needs-resolution');
  assert.deepEqual(r.reply.allowed, ['replace']);
  assert.equal(r.wrote, false);
});
test('identity + keep-both from a hostile caller -> needs-resolution (keep-both not allowed), no write', async () => {
  const r = await scenario({ source: IDENT_SRC(), destSeed: [dIdent('dA')], resolution: 'keep-both', matchId: 'dA' });
  assert.equal(r.reply.outcome, 'needs-resolution');
  assert.equal(r.wrote, false);
});

test('no resolution: new -> copied (write); match -> needs-resolution with match + allowed (no write)', async () => {
  const a = await scenario({ destSeed: [UNRELATED] });
  assert.equal(a.reply.outcome, 'copied');
  assert.equal(a.wrote, true);
  const b = await scenario({ destSeed: [dLogin('dA')] });
  assert.equal(b.reply.outcome, 'needs-resolution');
  assert.deepEqual(b.reply.allowed, ['skip', 'replace', 'keep-both']);
  assert.equal(b.wrote, false);
  const c = await scenario({ destSeed: [dLogin('dA'), dLogin('dB')] });
  assert.deepEqual(c.reply.allowed, ['skip', 'keep-both']);
  assert.equal(c.reply.match.id, 'dA');
  const d = await scenario({ source: IDENT_SRC(), destSeed: [dIdent('dA')] });
  assert.deepEqual(d.reply.allowed, ['replace']);
});

test('stale commit via real mutation: dest match deleted + another added between ask and commit', async () => {
  const { dir, store } = await mk();
  try {
    seed(store, 'work', [login()]);
    seed(store, 'personal', [dLogin('dA')]);
    const ask = store.copyItem('work', 'src1', 'personal', {});
    assert.equal(ask.match.id, 'dA');
    store.deleteItem('personal', 'dA');
    seed(store, 'personal', [dLogin('dB')]);
    const before = bytes(dir, 'personal');
    const r = store.copyItem('work', 'src1', 'personal', { resolution: 'replace', matchId: 'dA' });
    assert.equal(r.outcome, 'needs-resolution');
    assert.equal(r.match.id, 'dB');
    assert.ok(bytes(dir, 'personal').equals(before), 'no write');
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// needs-resolution reply carries only non-secret metadata
// ---------------------------------------------------------------------------

function deepKeys(v, out = []) {
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      deepKeys(x, out);
    }
  }
  return out;
}

test('needs-resolution: match is metadataOf-only (+username for login); no secret key or marker', async () => {
  const types = [
    [login({ password: 'cq9-pw' }), dLogin('dA', { password: 'cq9-dest-pw', notes: 'cq9-dest-notes' })],
    [
      { id: 'cs', type: 'card', title: 'V', number: '4242424242424242', cvv: 'cq9-cvv' },
      { id: 'dA', type: 'card', title: 'D', number: '4242 4242 4242 4242', cvv: 'cq9-dcvv', expiry: 'cq9-exp' }
    ],
    [
      { id: 'ns', type: 'note', title: 'T', body: 'cq9-body' },
      { id: 'dA', type: 'note', title: 'T', body: 'cq9-dbody' }
    ],
    [IDENT_SRC(), dIdent('dA', { street: 'cq9-street' })]
  ];
  for (const [src, dest] of types) {
    const r = await scenario({ source: src, destSeed: [dest] });
    assert.equal(r.reply.outcome, 'needs-resolution');
    const m = r.reply.match;
    const allowedKeys = ['id', 'type', 'title', ...(src.type === 'login' ? ['username'] : [])];
    assert.deepEqual(Object.keys(m).sort(), allowedKeys.sort(), src.type);
    const secrets = new Set(secretFieldsFor(src.type));
    for (const k of deepKeys(r.reply)) assert.ok(!secrets.has(k), `${src.type}: ${k} is a secret field name`);
    assert.ok(!JSON.stringify(r.reply).includes('cq9'), `${src.type}: no secret marker in reply`);
  }
  // title may be null
  const t = await scenario({
    source: { id: 'ns', type: 'note', title: '', body: 'b' },
    destSeed: [{ id: 'dA', type: 'note', title: '', body: 'c' }]
  });
  assert.equal(t.reply.outcome, 'needs-resolution');
});

test('landed replies carry no item fields beyond { outcome } (+ new title for kept-both)', async () => {
  const c = await scenario({ destSeed: [UNRELATED] });
  assert.deepEqual(c.reply, { outcome: 'copied' });
  const r = await scenario({ destSeed: [dLogin('dA')], resolution: 'replace', matchId: 'dA' });
  assert.deepEqual(r.reply, { outcome: 'replaced' });
  const k = await scenario({ destSeed: [dLogin('dA')], resolution: 'keep-both', matchId: 'dA' });
  assert.deepEqual(k.reply, { outcome: 'kept-both', title: 'Site (copy)' });
});

// ---------------------------------------------------------------------------
// Field carry + ids + timestamps
// ---------------------------------------------------------------------------

const FULL = {
  login: () => login({ extraField: 'kept' }),
  card: () => ({
    id: 'cs',
    type: 'card',
    title: 'Visa',
    cardholder: 'A B',
    brand: 'visa',
    last4: '4242',
    number: '4242424242424242',
    cvv: '123',
    expiry: '12/30',
    notes: 'cn',
    extraField: 'kept'
  }),
  note: () => ({ id: 'ns', type: 'note', title: 'N', body: 'body!', extraField: 'kept' }),
  identity: () => ({
    id: 'is',
    type: 'identity',
    title: 'Me',
    fullName: 'A B',
    firstName: 'A',
    lastName: 'B',
    email: 'e@x.y',
    phone: '1',
    street: 's',
    street2: 's2',
    city: 'c',
    region: 'r',
    country: 'no',
    postalCode: 'p',
    extraField: 'kept'
  })
};

test('copied item carries every field, fresh id/createdAt, updatedAt = now, extras survive; source untouched', async () => {
  for (const type of Object.keys(FULL)) {
    const { dir, store, clock } = await mk();
    try {
      const src = FULL[type]();
      clock.t = 1000;
      seed(store, 'work', [src]);
      const srcSaved = store.listItems('work')[0];
      clock.t = 5000;
      const srcBytes = bytes(dir, 'work');
      const r = store.copyItem('work', src.id, 'personal', {});
      assert.equal(r.outcome, 'copied');
      const [copy] = store.listItems('personal');
      assert.notEqual(copy.id, src.id, type);
      assert.ok(copy.id.length > 0);
      assert.equal(copy.createdAt, 5000);
      assert.notEqual(copy.createdAt, srcSaved.createdAt);
      assert.equal(copy.updatedAt, 5000);
      for (const f of [...SCHEMA[type].nonSecret, ...SCHEMA[type].secret, 'extraField']) {
        assert.equal(copy[f], src[f], `${type}.${f}`);
      }
      if (type === 'login') assert.equal(copy.matchMode, 'registrable-domain');
      assert.ok(bytes(dir, 'work').equals(srcBytes), 'source byte-identical');
      assert.deepEqual(store.listItems('work')[0], srcSaved);
    } finally {
      rm(dir);
    }
  }
});

test('kept-both: title "<title> (copy)" (untitled fallback), fresh id, new item added alongside', async () => {
  const { dir, store } = await mk();
  try {
    seed(store, 'work', [login({ title: undefined })]);
    seed(store, 'personal', [dLogin('dA')]);
    const r = store.copyItem('work', 'src1', 'personal', { resolution: 'keep-both', matchId: 'dA' });
    assert.deepEqual(r, { outcome: 'kept-both', title: '(untitled) (copy)' });
    const items = store.listItems('personal');
    assert.equal(items.length, 2);
    assert.equal(items[0].id, 'dA');
    assert.notEqual(items[1].id, 'src1');
    assert.equal(items[1].title, '(untitled) (copy)');
    assert.equal(items[1].password, 'pw-SRC');
  } finally {
    rm(dir);
  }
});

test('replaced: keeps destination id + createdAt + array index; full replace drops dest-only fields', async () => {
  const { dir, store, clock } = await mk();
  try {
    seed(store, 'work', [login({ notes: undefined })]);
    clock.t = 2000;
    seed(store, 'personal', [
      dLogin('first', { username: 'zed' }),
      dLogin('dA', { notes: 'dest-only-notes', extra2: 'x' })
    ]);
    clock.t = 9000;
    const r = store.copyItem('work', 'src1', 'personal', { resolution: 'replace', matchId: 'dA' });
    assert.deepEqual(r, { outcome: 'replaced' });
    const items = store.listItems('personal');
    assert.equal(items.length, 2);
    assert.equal(items[0].id, 'first');
    const rep = items[1];
    assert.equal(rep.id, 'dA');
    assert.equal(rep.createdAt, 2000);
    assert.equal(rep.updatedAt, 9000);
    assert.equal(rep.password, 'pw-SRC');
    assert.equal(rep.title, 'Site');
    assert.equal(rep.matchMode, 'registrable-domain');
    assert.equal(rep.notes, undefined, 'dest-only notes gone (source has none)');
    assert.equal(rep.extra2, undefined, 'dest-only extra gone');
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// Lazy destination + vaultKeys
// ---------------------------------------------------------------------------

test('lazy destination: copy creates the vault, replaces a stale vaultKeys entry, decrypts', async () => {
  const { dir, store } = await mk();
  try {
    seed(store, 'work', [login()]);
    assert.equal(store.hasVault('lazy'), false);
    const bogus = Buffer.alloc(32, 7);
    store.vaultKeys.set('lazy', bogus);
    const r = store.copyItem('work', 'src1', 'lazy', {});
    assert.equal(r.outcome, 'copied');
    assert.equal(store.hasVault('lazy'), true);
    assert.notEqual(store.vaultKeys.get('lazy'), bogus);
    assert.equal(bogus.equals(Buffer.alloc(32, 7)), true, 'cached key never zeroized');
    const items = store.listItems('lazy');
    assert.equal(items.length, 1);
    assert.equal(items[0].password, 'pw-SRC');
  } finally {
    rm(dir);
  }
});

test('lazy destination: skipped / needs-resolution cannot arise; skip into a jar with no vault creates no file', async () => {
  const { dir, store } = await mk();
  try {
    seed(store, 'work', [login()]);
    const r = store.copyItem('work', 'src1', 'lazy', { resolution: 'skip', matchId: 'whatever' });
    assert.equal(r.outcome, 'skipped');
    assert.equal(fs.existsSync(vaultPath(dir, 'lazy')), false);
  } finally {
    rm(dir);
  }
});

test('destination exists but is empty: not lazy, behaves as new', async () => {
  const { dir, store } = await mk();
  try {
    seed(store, 'work', [login()]);
    seed(store, 'personal', [UNRELATED]);
    store.deleteItem('personal', 'u1');
    assert.equal(store.listItems('personal').length, 0);
    assert.equal(store.copyItem('work', 'src1', 'personal', {}).outcome, 'copied');
    assert.equal(store.listItems('personal').length, 1);
  } finally {
    rm(dir);
  }
});

test('copy into Global works; Global as source works', async () => {
  const { store } = await mk();
  seed(store, 'work', [login()]);
  assert.equal(store.copyItem('work', 'src1', 'global', {}).outcome, 'copied');
  const g = store.listItems('global')[0];
  assert.equal(store.copyItem('global', g.id, 'personal', {}).outcome, 'copied');
});

// ---------------------------------------------------------------------------
// Refusals with zero writes
// ---------------------------------------------------------------------------

const isState = (e) => e instanceof vs.VaultStateError;

test('refusals: locked, burner/unknown, same vault, missing item, bad shape — all zero writes', async () => {
  const { dir, store } = await mk();
  try {
    seed(store, 'work', [login()]);
    const destBefore = bytes(dir, 'personal');
    assert.throws(() => store.copyItem('work', 'src1', 'burner-xyz', {}), isState);
    assert.throws(() => store.copyItem('burner-xyz', 'src1', 'personal', {}), isState);
    assert.equal(fs.existsSync(vaultPath(dir, 'burner-xyz')), false);
    assert.throws(() => store.copyItem('work', 'src1', 'work', {}), isState, 'same vault');
    assert.throws(() => store.copyItem('work', 'nope', 'personal', {}), isState, 'missing item');
    assert.throws(() => store.copyItem('personal', 'src1', 'work', {}), isState, 'source with no file');
    assert.throws(() => store.copyItem('work', 'src1', 'personal', { resolution: 'overwrite', matchId: 'x' }), isState);
    assert.throws(() => store.copyItem('work', 'src1', 'personal', { resolution: 'replace' }), isState, 'no matchId');
    assert.throws(() => store.copyItem('work', 'src1', 'personal', { resolution: 'replace', matchId: '' }), isState);
    assert.throws(
      () => store.copyItem('work', 'src1', 'personal', { resolution: 'skip' }),
      isState,
      'skip w/o matchId'
    );
    assert.throws(() => store.copyItem('work', 5, 'personal', {}), isState);
    assert.throws(() => store.copyItem(undefined, 'src1', 'personal', {}), isState);
    assert.equal(bytes(dir, 'personal'), destBefore);
    assert.equal(fs.existsSync(vaultPath(dir, 'personal')), false);

    store.lockNow();
    assert.throws(
      () => store.copyItem('work', 'src1', 'personal', {}),
      (e) => e instanceof vs.VaultLockedError
    );
    assert.equal(fs.existsSync(vaultPath(dir, 'personal')), false);
  } finally {
    rm(dir);
  }
});

test('shape check beats a `new` plan: resolution without matchId refuses even into an empty destination', async () => {
  const { store } = await mk();
  seed(store, 'work', [login()]);
  assert.throws(() => store.copyItem('work', 'src1', 'lazy', { resolution: 'keep-both' }), isState);
  assert.equal(store.hasVault('lazy'), false);
});

test('unknown item type in the source is refused', async () => {
  const { dir, store } = await mk();
  try {
    seed(store, 'work', [login()]);
    const orig = store._normalizeItem.bind(store);
    // Plant an unknown-type item through the write path (bypass normalize's type check).
    store._normalizeItem = (item, c) =>
      item.type === 'weird' ? { ...item, createdAt: 1, updatedAt: 1 } : orig(item, c);
    store.saveItem('work', { id: 'w1', type: 'weird', title: 'x' });
    store._normalizeItem = orig;
    assert.throws(() => store.copyItem('work', 'w1', 'personal', {}), isState);
    assert.equal(fs.existsSync(vaultPath(dir, 'personal')), false);
  } finally {
    rm(dir);
  }
});

test('gate raised -> VaultBusyError, zero writes', async () => {
  const { dir, store } = await mk();
  try {
    seed(store, 'work', [login()]);
    const release = await store._acquireRekeyGate();
    assert.throws(
      () => store.copyItem('work', 'src1', 'personal', {}),
      (e) => e instanceof vs.VaultBusyError
    );
    assert.equal(fs.existsSync(vaultPath(dir, 'personal')), false);
    release();
    assert.equal(store.copyItem('work', 'src1', 'personal', {}).outcome, 'copied');
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// Identity singleton
// ---------------------------------------------------------------------------

test('identity: replace leaves exactly one identity; with two dest identities the first is replaced and the extra untouched', async () => {
  const { dir, store } = await mk();
  try {
    seed(store, 'work', [IDENT_SRC()]);
    seed(store, 'personal', [dIdent('first')]);
    assert.equal(
      store.copyItem('work', 'isrc', 'personal', { resolution: 'replace', matchId: 'first' }).outcome,
      'replaced'
    );
    assert.equal(store.listItems('personal').filter((i) => i.type === 'identity').length, 1);
  } finally {
    rm(dir);
  }
  const m = await mk();
  try {
    seed(m.store, 'work', [IDENT_SRC()]);
    // Two identities in one vault are only reachable by hand-edit: write them via a normalize bypass.
    m.store.saveItem('personal', dIdent('first'));
    const doc = m.store._readVault('personal');
    const key = m.store._vaultKeyFromDoc('personal', doc);
    const vc = require('../../src/main/vault/vault-crypto');
    const items = vc.decryptItems(doc.items, key);
    items.push(dIdent('extra', { fullName: 'Extra' }));
    m.store._writeVault('personal', { kdf: doc.kdf, envelopes: doc.envelopes, items: vc.encryptItems(items, key) });
    const extraBefore = m.store.listItems('personal').find((i) => i.id === 'extra');
    const r = m.store.copyItem('work', 'isrc', 'personal', { resolution: 'replace', matchId: 'first' });
    assert.equal(r.outcome, 'replaced');
    const after = m.store.listItems('personal');
    assert.equal(after.length, 2);
    assert.equal(after[0].id, 'first');
    assert.equal(after[0].email, 'a-SRC@x.y');
    assert.deepEqual(
      after.find((i) => i.id === 'extra'),
      extraBefore
    );
  } finally {
    rm(m.dir);
  }
});

test('identity singleton guard is pinned: a normalize that returns a different id throws with zero write', async () => {
  const { dir, store } = await mk();
  try {
    seed(store, 'work', [IDENT_SRC()]);
    seed(store, 'personal', [dIdent('first')]);
    const before = bytes(dir, 'personal');
    const orig = store._normalizeItem.bind(store);
    store._normalizeItem = (item, c) => ({ ...orig(item, c), id: 'different' });
    assert.throws(
      () => store.copyItem('work', 'isrc', 'personal', { resolution: 'replace', matchId: 'first' }),
      isState
    );
    store._normalizeItem = orig;
    assert.ok(bytes(dir, 'personal').equals(before), 'destination bytes unchanged');
  } finally {
    rm(dir);
  }
});

test('copyItem with an identity into a destination without one lands it (singleton holds)', async () => {
  const r = await scenario({ source: IDENT_SRC(), destSeed: [UNRELATED] });
  assert.equal(r.reply.outcome, 'copied');
  assert.equal(r.items.filter((i) => i.type === 'identity').length, 1);
});
