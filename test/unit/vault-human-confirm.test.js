'use strict';

// Main-side protocol of leg `vault-picker-controls` (Mission 23 Flight 1), against a REAL vault fixture file:
//   - card / identity on a site not among the item's confirmed origins: nothing fills, `{ vault, item }` becomes
//     pending on the context, answer `confirm-needed`, context not consumed;
//   - the confirm is an EXPLICIT call (`confirm: true`) that fills only when the pending record matches the
//     item; any other call asks again (so "confirmation view up -> lock -> unlock -> picker -> same card
//     picked" asks again, never fills); a different item, a missing context, a changed origin fill nothing and
//     record nothing; a login never takes the step; the origin is recorded after a confirmed fill and the next
//     fill there does not ask; a store failure is traced without item data and does not fail the fill;
//   - the certificate gate in `requireContext`: a flagged, unacknowledged context is refused (trace reason
//     `certificate`) by all three operations; the acknowledge lookup lifts it (and only for that context).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');
const { createVaultHuman } = require('../../src/main/vault/vault-human');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';
const JARS = [{ id: 'work', partition: 'persist:container:work' }];
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
const CARD2 = { ...CARD, title: 'Amex', last4: '0005', number: '378282246310005' };
const IDENTITY = {
  type: 'identity',
  title: 'Home',
  fullName: 'Ada Lovelace',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'a@x.test'
};

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-confirm-'));
}
function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

async function makeHarness(dir, { storeWrap } = {}) {
  const realStore = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => JARS });
  await realStore.setup({ masterPassword: MASTER });
  const store = storeWrap ? storeWrap(realStore) : realStore;
  const login = realStore.saveItem('work', { type: 'login', title: 'W', username: 'w@a', password: 'pw', origin: A });
  const card = realStore.saveItem('work', CARD);
  const card2 = realStore.saveItem('work', CARD2);
  const identity = realStore.saveItem('work', IDENTITY);
  const urls = { 10: A + '/checkout' };
  const calls = { login: [], card: [], identity: [], generated: [] };
  const lines = [];
  const traces = [];
  let ids = 0;
  const human = createVaultHuman({
    getVaultStore: () => store,
    fromId: (id) => (urls[id] != null ? { getURL: () => urls[id] } : null),
    getTabEntry: () => ({ partition: 'persist:container:work', trusted: false }),
    listJars: () => JARS,
    fillDelegate: (a) => calls.login.push(a),
    fillCardDelegate: (a) => calls.card.push(a),
    fillIdentityDelegate: (a) => calls.identity.push(a),
    fillGeneratedDelegate: (a) => calls.generated.push(a),
    gestureTrace: (l) => lines.push(l),
    trace: (name, detail) => traces.push({ name, detail }),
    randomContextId: () => `ctx-${++ids}`
  });
  const mint = (wcId = 10, origin = A, certOverride = false) => human.mintContext({ wcId, origin, certOverride }).id;
  const fill = (item, contextId, extra = {}) =>
    human.fillHuman({ wcId: 10, vaultId: 'work', itemId: item.id, contextId, ...extra });
  const confirmedOf = (item) => realStore.listItems('work').find((i) => i.id === item.id).confirmedOrigins;
  return { realStore, human, urls, calls, lines, traces, login, card, card2, identity, mint, fill, confirmedOf };
}

test('a card on a new site asks first: nothing fills, the context is NOT consumed, the explicit confirm fills and records the origin', async () => {
  const dir = tmpDir();
  try {
    const h = await makeHarness(dir);
    const id = h.mint();
    assert.deepEqual(h.fill(h.card, id), { filled: false, reason: 'confirm-needed' });
    assert.equal(h.calls.card.length, 0, 'nothing sent to the guest');
    assert.equal(h.confirmedOf(h.card), undefined, 'nothing recorded by the question');
    // The context is alive: the explicit confirm uses it.
    assert.deepEqual(h.fill(h.card, id, { confirm: true }), { filled: true });
    assert.equal(h.calls.card.length, 1);
    assert.equal(h.calls.card[0].card.number, CARD.number);
    assert.deepEqual(h.confirmedOf(h.card), [A], 'the origin is recorded after the confirmed fill');
    assert.deepEqual(h.fill(h.card, id), { filled: false, reason: 'no-context' }, 'a fill consumes the context');
    // The second fill on the same site does not ask.
    assert.deepEqual(h.fill(h.card, h.mint()), { filled: true });
    assert.equal(h.calls.card.length, 2);
    // A different site asks again.
    h.urls[10] = B + '/pay';
    assert.deepEqual(h.fill(h.card, h.mint(10, B)), { filled: false, reason: 'confirm-needed' });
  } finally {
    rm(dir);
  }
});

test('an identity follows the same rule', async () => {
  const dir = tmpDir();
  try {
    const h = await makeHarness(dir);
    const id = h.mint();
    assert.deepEqual(h.fill(h.identity, id), { filled: false, reason: 'confirm-needed' });
    assert.equal(h.calls.identity.length, 0);
    assert.deepEqual(h.fill(h.identity, id, { confirm: true }), { filled: true });
    assert.equal(h.calls.identity.length, 1);
    assert.deepEqual(h.confirmedOf(h.identity), [A]);
    assert.deepEqual(h.fill(h.identity, h.mint()), { filled: true }, 'second fill on that site: no question');
  } finally {
    rm(dir);
  }
});

test('a login never takes the step, even when sent confirm:true', async () => {
  const dir = tmpDir();
  try {
    const h = await makeHarness(dir);
    assert.deepEqual(h.fill(h.login, h.mint()), { filled: true });
    assert.equal(h.calls.login.length, 1);
    assert.equal(h.confirmedOf(h.login), undefined);
    assert.deepEqual(h.fill(h.login, h.mint(), { confirm: true }), { filled: true });
  } finally {
    rm(dir);
  }
});

test('confirm is explicit: confirm:true WITHOUT a pending record, or with another item pending, fills nothing and asks again', async () => {
  const dir = tmpDir();
  try {
    const h = await makeHarness(dir);
    // No pending at all.
    const id1 = h.mint();
    assert.deepEqual(h.fill(h.card, id1, { confirm: true }), { filled: false, reason: 'confirm-needed' });
    assert.equal(h.calls.card.length, 0);
    // That call recorded card as pending; a confirm for ANOTHER item must not ride it.
    assert.deepEqual(h.fill(h.card2, id1, { confirm: true }), { filled: false, reason: 'confirm-needed' });
    assert.equal(h.calls.card.length, 0, 'a confirm for a different item fills nothing');
    // Pending was overwritten to card2: a confirm for the FIRST card no longer matches.
    assert.deepEqual(h.fill(h.card, id1, { confirm: true }), { filled: false, reason: 'confirm-needed' });
    assert.deepEqual(h.confirmedOf(h.card), undefined);
    assert.deepEqual(h.confirmedOf(h.card2), undefined, 'nothing recorded by any of those');
    // A truthy non-true value is not the explicit confirm.
    h.fill(h.card, id1);
    assert.deepEqual(h.fill(h.card, id1, { confirm: 'yes' }), { filled: false, reason: 'confirm-needed' });
    assert.deepEqual(h.fill(h.card, id1, { confirm: true }), { filled: true });
  } finally {
    rm(dir);
  }
});

test('confirmation view up -> vault locks -> unlock -> the picker reopens -> the same card is picked: it asks AGAIN, never fills', async () => {
  const dir = tmpDir();
  try {
    const h = await makeHarness(dir);
    const id = h.mint();
    assert.deepEqual(h.fill(h.card, id), { filled: false, reason: 'confirm-needed' }, 'the question is up');
    h.realStore.lockNow();
    // The confirmation view's Fill reaches a locked vault: `locked`; the context survives and nothing fills.
    assert.deepEqual(h.fill(h.card, id, { confirm: true }), { filled: false, reason: 'locked' });
    await h.realStore.unlock(MASTER);
    // The picker that reopens after the unlock is the PLAIN picker; its pick carries no confirm.
    assert.deepEqual(h.fill(h.card, id), { filled: false, reason: 'confirm-needed' });
    assert.equal(h.calls.card.length, 0, 'never filled');
    assert.equal(h.confirmedOf(h.card), undefined);
  } finally {
    rm(dir);
  }
});

test('a changed origin, a missing context and a deleted item fill nothing and record nothing', async () => {
  const dir = tmpDir();
  try {
    const h = await makeHarness(dir);
    const id = h.mint();
    h.fill(h.card, id);
    h.urls[10] = B + '/other';
    assert.deepEqual(h.fill(h.card, id, { confirm: true }), { filled: false, reason: 'origin-changed' });
    h.urls[10] = A + '/checkout';
    assert.deepEqual(h.fill(h.card, 'ctx-unknown', { confirm: true }), { filled: false, reason: 'no-context' });
    // The item vanishes between pick and confirm.
    h.realStore.deleteItem('work', h.card.id);
    assert.deepEqual(h.fill(h.card, id, { confirm: true }), { filled: false, reason: 'origin-mismatch' });
    assert.equal(h.calls.card.length, 0);
    assert.deepEqual(
      h.realStore.listItems('work').filter((i) => i.confirmedOrigins),
      []
    );
  } finally {
    rm(dir);
  }
});

test('a store failure while recording is traced WITHOUT item data and does not fail the (already sent) fill', async () => {
  const dir = tmpDir();
  try {
    const h = await makeHarness(dir, {
      storeWrap: (real) =>
        new Proxy(real, {
          get(target, prop) {
            if (prop === 'recordConfirmedOrigin') {
              return () => {
                throw new vs.VaultBusyError('vault-store: a security rotation is in progress');
              };
            }
            const v = target[prop];
            return typeof v === 'function' ? v.bind(target) : v;
          }
        })
    });
    const id = h.mint();
    h.fill(h.card, id);
    assert.deepEqual(h.fill(h.card, id, { confirm: true }), { filled: true }, 'the fill is not failed');
    assert.equal(h.calls.card.length, 1);
    assert.equal(h.traces.length, 1);
    assert.equal(h.traces[0].name, 'confirmed-origin-record-failed');
    assert.deepEqual(h.traces[0].detail, { name: 'VaultBusyError' });
    assert.ok(!JSON.stringify(h.traces).includes(CARD.number));
  } finally {
    rm(dir);
  }
});

test('integration: confirm-needed through to the recorded origin and the real file (second fill skips the question; a copied card asks again)', async () => {
  const dir = tmpDir();
  try {
    const h = await makeHarness(dir);
    const bytes0 = fs.readFileSync(path.join(dir, 'vaults', 'work.gfvault'));
    const id = h.mint();
    h.fill(h.card, id);
    h.fill(h.card, id, { confirm: true });
    assert.ok(!fs.readFileSync(path.join(dir, 'vaults', 'work.gfvault')).equals(bytes0), 'the origin reached the file');
    // A fresh store over the same directory reads it back.
    h.realStore.lockNow();
    const reopened = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => JARS });
    await reopened.unlock(MASTER);
    assert.deepEqual(reopened.listItems('work').find((i) => i.id === h.card.id).confirmedOrigins, [A]);
    // Copy it to the global vault: the copy has no confirmed sites, so a fill of it asks again.
    await h.realStore.unlock(MASTER);
    h.realStore.copyItem('work', h.card.id, 'global');
    const copy = h.realStore.listItems('global').find((i) => i.type === 'card');
    assert.equal(copy.confirmedOrigins, undefined);
    assert.deepEqual(
      h.human.fillHuman({ wcId: 10, vaultId: 'global', itemId: copy.id, contextId: h.mint() }),
      { filled: false, reason: 'confirm-needed' },
      'a copied card asks again'
    );
  } finally {
    rm(dir);
  }
});

// ---- certificate gate ----------------------------------------------------------------------------------

test('certificate: a flagged, unacknowledged context is refused by all three operations (trace reason certificate); acknowledging lifts it', async () => {
  const dir = tmpDir();
  try {
    const h = await makeHarness(dir);
    const id = h.mint(10, A, true);
    assert.deepEqual(h.human.reachableItems(10, id), [], 'reachableItems: refused');
    assert.deepEqual(h.fill(h.login, id), { filled: false, reason: 'certificate' }, 'fillHuman');
    assert.deepEqual(
      h.human.fillGenerated({ wcId: 10, candidates: ['x'], contextId: id }),
      { filled: false, reason: 'certificate' },
      'fillGenerated'
    );
    assert.equal(h.calls.login.length + h.calls.generated.length, 0);
    assert.equal(h.lines.filter((l) => l === '[vault-gesture] context-refused reason=certificate').length, 3);
    // A refusal does not consume the context: acknowledge, then it works.
    assert.deepEqual(h.human.acknowledgeCertificate(10, id), { ok: true });
    assert.equal(h.human.reachableItems(10, id).length > 0, true);
    assert.deepEqual(h.fill(h.login, id), { filled: true });
  } finally {
    rm(dir);
  }
});

test('certificate: acknowledge is per context and per tab; a stale id, a wrong tab and a changed origin do not acknowledge', async () => {
  const dir = tmpDir();
  try {
    const h = await makeHarness(dir);
    const first = h.mint(10, A, true);
    assert.deepEqual(h.human.acknowledgeCertificate(10, 'ctx-nope'), { ok: false });
    assert.deepEqual(h.human.acknowledgeCertificate(99, first), { ok: false });
    h.urls[10] = B + '/x';
    assert.deepEqual(h.human.acknowledgeCertificate(10, first), { ok: false }, 'the origin changed');
    h.urls[10] = A + '/checkout';
    assert.deepEqual(h.human.acknowledgeCertificate(10, first), { ok: true });
    // A NEW gesture mints a NEW context which is unacknowledged again (the warning comes again).
    const second = h.mint(10, A, true);
    assert.deepEqual(h.fill(h.login, second), { filled: false, reason: 'certificate' });
    // An unflagged context is never refused on this ground.
    assert.deepEqual(h.fill(h.login, h.mint(10, A, false)), { filled: true });
  } finally {
    rm(dir);
  }
});

test('certificate: the clause sits in requireContext - the one place all operations share - and only acknowledge lifts it', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/main/vault/vault-human.js'), 'utf8');
  assert.equal((src.match(/allowUnacknowledged/g) || []).length >= 3, true);
  assert.match(src, /reason=certificate/);
  const callers = [...src.matchAll(/requireContext\(([^)]*)\)/g)].map((m) => m[1]);
  const lifting = callers.filter((c) => c.includes('allowUnacknowledged: true'));
  assert.equal(lifting.length, 1, 'exactly one call site lifts the clause (acknowledgeCertificate)');
});
