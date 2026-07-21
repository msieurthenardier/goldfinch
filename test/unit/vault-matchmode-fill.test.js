'use strict';

// Integration tests for the per-credential registrable-domain fill opt-in at the THREE
// fill sites plus the capture-disposition invariant (M12 Flight 4, Leg 4 / DD5):
//   1. automation fill  (vault-context.fill)   — widen:true
//   2. human fill        (vault-human.fillHuman) — widen:true
//   3. picker            (vault-human.reachableItems → reachableLoginItems widen:true)
//   4. capture stays EXACT (vault-human.capture / captureSave) — a subdomain submit
//      NEVER dispositions as an update to an eTLD+1 item and NEVER rewrites its origin.
//
// A `matchMode:'registrable-domain'` credential stored at the apex `https://example.com`
// fills a hardened-matched subdomain but is refused across an unrelated registry sibling,
// a multi-tenant tenant, and a scheme mismatch. Electron-free (the vault-store FAST-scrypt
// + temp-dir pattern).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');
const { createVaultContext } = require('../../src/main/vault/vault-context');
const { createVaultHuman } = require('../../src/main/vault/vault-human');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';
const JARS = [{ id: 'work', partition: 'persist:container:work' }];
const APEX = 'https://example.com';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-mm-')); }
function rm(dir) { fs.rmSync(dir, { recursive: true, force: true }); }
function bytesOf(str) { return new TextEncoder().encode(str); }
function makeStore(dir) {
  return vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => JARS });
}

// A registrable-domain login stored at the apex in the 'work' jar.
function seedApex(store, over = {}) {
  return store.saveItem('work', {
    id: 'rd', type: 'login', title: 'Example', username: 'u@ex', password: 'pw',
    origin: APEX, matchMode: 'registrable-domain', ...over,
  });
}

/* ============================================================ 1. automation fill */

// A fake browser world: every tab lives in the work partition; only the URL varies.
function makeCtxWorld(urlByWcId) {
  const sessions = new Map();
  const sessionFor = (p) => {
    if (!sessions.has(p)) sessions.set(p, { __partition: p, __goldfinchInternal: p === 'goldfinch-internal' });
    return sessions.get(p);
  };
  const fromId = (wcId) => {
    const url = urlByWcId[wcId];
    if (url == null) return null;
    return { id: wcId, session: sessionFor('persist:container:work'), getURL: () => url, isDestroyed() { return false; } };
  };
  return {
    fromId, fromPartition: sessionFor,
    deps: { jars: { list: () => JARS }, fromId, fromPartition: sessionFor, getChromeContents: () => ({ id: 0 }) },
  };
}

test('automation fill (vault-context) honors matchMode: subdomain fills, sibling/scheme refused', async () => {
  const dir = tmpDir();
  try {
    const setup = makeStore(dir);
    await setup.setup({ masterPassword: MASTER });
    seedApex(setup);
    const work = await setup.mintAccessKey('work', { masterPassword: MASTER });
    setup.lockNow();

    const world = makeCtxWorld({
      10: 'https://accounts.example.com/login', // subdomain match → fill
      11: 'https://accounts.other.com/login',   // different registrable domain → refuse
      12: 'http://accounts.example.com/login',   // scheme mismatch → refuse
      13: 'https://example.com/login',           // exact apex → fill
    });
    const calls = [];
    const store = makeStore(dir);
    const ctx = createVaultContext({ vaultStore: store, fillDelegate: (a) => calls.push(a) });
    ctx.unlock('work', work.secret);

    assert.deepEqual(ctx.fill('work', { wcId: 10, itemId: 'rd' }, world.deps), { filled: true, id: 'rd', origin: 'https://accounts.example.com' });
    assert.deepEqual(ctx.fill('work', { wcId: 13, itemId: 'rd' }, world.deps), { filled: true, id: 'rd', origin: 'https://example.com' });
    assert.deepEqual(ctx.fill('work', { wcId: 11, itemId: 'rd' }, world.deps), { filled: false, reason: 'origin-mismatch' });
    assert.deepEqual(ctx.fill('work', { wcId: 12, itemId: 'rd' }, world.deps), { filled: false, reason: 'origin-mismatch' });

    assert.equal(calls.length, 2, 'delegate called only on the two accepted fills');
    for (const c of calls) assert.deepEqual(c.credential, { username: 'u@ex', password: 'pw' });
  } finally { rm(dir); }
});

test('automation fill: an EXACT-mode item does NOT widen to a subdomain', async () => {
  const dir = tmpDir();
  try {
    const setup = makeStore(dir);
    await setup.setup({ masterPassword: MASTER });
    seedApex(setup, { matchMode: 'exact' });
    const work = await setup.mintAccessKey('work', { masterPassword: MASTER });
    setup.lockNow();

    const world = makeCtxWorld({ 10: 'https://accounts.example.com/login' });
    const calls = [];
    const store = makeStore(dir);
    const ctx = createVaultContext({ vaultStore: store, fillDelegate: (a) => calls.push(a) });
    ctx.unlock('work', work.secret);

    assert.deepEqual(ctx.fill('work', { wcId: 10, itemId: 'rd' }, world.deps), { filled: false, reason: 'origin-mismatch' });
    assert.equal(calls.length, 0);
  } finally { rm(dir); }
});

/* =============================================== 2. human fill + 3. picker + 4. capture */

function makeHuman(store, { urls }) {
  const entries = new Map(Object.keys(urls).map((k) => [Number(k), { partition: 'persist:container:work', trusted: false }]));
  const fillCalls = [];
  const human = createVaultHuman({
    getVaultStore: () => store,
    fromId: (id) => (urls[id] != null ? { getURL: () => urls[id] } : null),
    getTabEntry: (id) => entries.get(id),
    listJars: () => JARS,
    fillDelegate: (arg) => fillCalls.push(arg),
    setTimeout: (_fn, _ms) => ({ id: 0, unref() {} }), // capture drop-timer: never fires in-test
    clearTimeout: () => {},
    now: () => 1000,
  });
  return { human, fillCalls };
}

test('human fill (vault-human) honors matchMode: subdomain fills, sibling/scheme refused', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    seedApex(store);
    const { human, fillCalls } = makeHuman(store, {
      urls: {
        10: 'https://accounts.example.com/login', // subdomain → fill
        11: 'https://accounts.other.com/login',   // sibling → refuse
        12: 'http://accounts.example.com/login',   // scheme mismatch → refuse
      },
    });

    assert.deepEqual(human.fillHuman({ wcId: 10, vaultId: 'work', itemId: 'rd' }), { filled: true });
    assert.deepEqual(human.fillHuman({ wcId: 11, vaultId: 'work', itemId: 'rd' }), { filled: false, reason: 'origin-mismatch' });
    assert.deepEqual(human.fillHuman({ wcId: 12, vaultId: 'work', itemId: 'rd' }), { filled: false, reason: 'origin-mismatch' });
    assert.equal(fillCalls.length, 1);
    assert.deepEqual(fillCalls[0].credential, { username: 'u@ex', password: 'pw' });
  } finally { rm(dir); }
});

test('picker (reachableItems) surfaces a widened offer on a matched subdomain, flagged widened', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    seedApex(store);
    const { human } = makeHuman(store, {
      urls: { 10: 'https://accounts.example.com/login', 11: 'https://bob.github.io/login' },
    });

    const rows = human.reachableItems(10);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'rd');
    assert.equal(rows[0].widened, true, 'a subdomain offer is flagged widened for the badge');

    // No row across an unrelated tenant.
    assert.deepEqual(human.reachableItems(11), []);
  } finally { rm(dir); }
});

test('CAPTURE STAYS EXACT: a subdomain submit does NOT update the eTLD+1 item nor rewrite its origin', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    seedApex(store); // registrable-domain apex item, username u@ex, origin https://example.com
    const { human } = makeHuman(store, { urls: { 10: 'https://accounts.example.com/login' } });

    // Submit the SAME username on a matched subdomain. Capture disposition reads
    // reachableLoginItems WITHOUT widen (exact), so the apex item does NOT match the
    // subdomain origin → the offer is a SAVE (new item), never an UPDATE.
    const offer = human.capture({ wcId: 10, username: 'u@ex', passwordBytes: bytesOf('fresh-pw') });
    assert.ok(offer, 'an offer was returned');
    assert.equal(offer.model.mode, 'save', 'a subdomain submit is a SAVE, never an update to the apex item');
    assert.equal(offer.model.origin, 'https://accounts.example.com');
    assert.deepEqual(offer.model.choices, ['work', 'global']);

    // Accept the save into work — it creates a NEW item at the subdomain origin.
    const saved = human.captureSave({ captureId: offer.captureId, vaultId: 'work' });
    assert.equal(saved.saved, true);

    // The original apex item is UNTOUCHED — its origin was never rewritten to the subdomain.
    const items = store.listItems('work');
    const apex = items.find((i) => i.id === 'rd');
    assert.equal(apex.origin, APEX, 'the eTLD+1 item origin is NOT rewritten by a subdomain capture');
    assert.equal(apex.matchMode, 'registrable-domain', 'the apex item keeps its opt-in');
    // A distinct new item now exists at the subdomain origin.
    const fresh = items.find((i) => i.origin === 'https://accounts.example.com');
    assert.ok(fresh && fresh.id !== 'rd', 'the subdomain submit created a separate item');
  } finally { rm(dir); }
});
