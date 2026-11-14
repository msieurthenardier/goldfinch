'use strict';

// The picker-context gate on the vault-human ops (Mission 23 Flight 1, leg `vault-fill-trust`): the three
// chrome-facing ops refuse without a live context for the tab and id; a fill of EVERY item type and a
// generated fill need the tab's committed origin to equal the context's (card and identity fills are not
// origin-MATCHED to a site, but they still go only to the page the operator was looking at); a fill that
// succeeds consumes the context; a refused one (including `locked`) leaves it; a vault lock keeps it; the
// tab-lifecycle drops (tab, window, dismissal) remove it; every refusal writes one trace line.

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
const EVIL = 'https://evil.example';

const CARD = {
  type: 'card',
  title: 'Visa',
  cardholder: 'A Lovelace',
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
  email: 'ada@example.com',
  phone: '555-1234',
  street: '12 Analytical Engine Way',
  street2: '',
  city: 'London',
  region: '',
  country: 'UK',
  postalCode: 'SW1A 1AA'
};

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-ctx-'));
}
function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// wcId map: 10 → work-jar tab @ A; 11 → another work-jar tab @ A; 20 → burner tab @ A.
async function makeHarness(dir, { ttlMs, now } = {}) {
  const store = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => JARS });
  await store.setup({ masterPassword: MASTER });
  const login = store.saveItem('work', { type: 'login', title: 'W', username: 'w@a', password: 'pw', origin: A });
  const card = store.saveItem('work', CARD);
  const identity = store.saveItem('work', IDENTITY);
  const urls = { 10: A + '/login', 11: A + '/login', 20: A + '/login' };
  const entries = new Map([
    [10, { partition: 'persist:container:work', trusted: false }],
    [11, { partition: 'persist:container:work', trusted: false }],
    [20, { partition: 'burner:1', trusted: false }]
  ]);
  const calls = { login: [], card: [], identity: [], generated: [] };
  const lines = [];
  let ids = 0;
  const human = createVaultHuman({
    getVaultStore: () => store,
    fromId: (id) => (urls[id] != null ? { getURL: () => urls[id] } : null),
    getTabEntry: (id) => entries.get(id),
    listJars: () => JARS,
    fillDelegate: (a) => calls.login.push(a),
    fillCardDelegate: (a) => calls.card.push(a),
    fillIdentityDelegate: (a) => calls.identity.push(a),
    fillGeneratedDelegate: (a) => calls.generated.push(a),
    gestureTrace: (l) => lines.push(l),
    randomContextId: () => `ctx-${++ids}`,
    ...(ttlMs ? { pickerTtlMs: ttlMs } : {}),
    ...(now ? { now } : {}),
    tabWcIdsForChrome: (chromeId) => (chromeId === 1 ? [10, 11] : [20])
  });
  const mint = (wcId, origin = A) => human.mintContext({ wcId, origin, certOverride: false }).id;
  return { store, human, urls, calls, lines, login, card, identity, mint };
}

const sel = (item, wcId, contextId, vaultId = 'work') => ({ wcId, vaultId, itemId: item.id, contextId });

test('reachableItems: a live context for the tab and id is required; a missing, stale or other-tab id reads as []', async () => {
  const dir = tmpDir();
  try {
    const { human, mint, lines } = await makeHarness(dir);
    assert.deepEqual(human.reachableItems(10, 'ctx-nope'), [], 'no context minted yet');
    const id = mint(10);
    assert.equal(human.reachableItems(10, id).length, 3, 'the live id works (and does not consume it)');
    assert.equal(human.reachableItems(10, id).length, 3);
    assert.deepEqual(human.reachableItems(10, 'wrong'), []);
    assert.deepEqual(human.reachableItems(11, id), [], "another tab cannot use this tab's id");
    assert.deepEqual(human.reachableItems(10, undefined), []);
    assert.deepEqual(
      lines.filter((l) => l.startsWith('[vault-gesture] context-refused')),
      [
        '[vault-gesture] context-refused reason=missing',
        '[vault-gesture] context-refused reason=stale',
        '[vault-gesture] context-refused reason=missing',
        '[vault-gesture] context-refused reason=stale'
      ]
    );
  } finally {
    rm(dir);
  }
});

test('every item type fills only with a live context at the SAME committed origin; a changed origin refuses it, per type', async () => {
  const dir = tmpDir();
  try {
    const h = await makeHarness(dir);
    for (const [type, item, calls] of [
      ['login', h.login, h.calls.login],
      ['card', h.card, h.calls.card],
      ['identity', h.identity, h.calls.identity]
    ]) {
      // Same origin: fills, and consumes the context.
      const ok = h.mint(10);
      if (type !== 'login') {
        // Leg `vault-picker-controls`: a card / identity on a first-seen site asks once; the explicit confirm fills.
        assert.deepEqual(h.human.fillHuman(sel(item, 10, ok)), { filled: false, reason: 'confirm-needed' }, type);
        assert.equal(calls.length, 0, `${type}: nothing sent before the confirmation`);
        assert.deepEqual(h.human.fillHuman({ ...sel(item, 10, ok), confirm: true }), { filled: true }, type);
      } else {
        assert.deepEqual(h.human.fillHuman(sel(item, 10, ok)), { filled: true }, type);
      }
      assert.equal(calls.length, 1, type);
      assert.deepEqual(
        h.human.fillHuman(sel(item, 10, ok)),
        { filled: false, reason: 'no-context' },
        `${type}: used once`
      );
      assert.equal(calls.length, 1);
      // The tab navigated to another origin after the picker rose: nothing is sent to the guest.
      const stale = h.mint(10);
      h.urls[10] = EVIL + '/login';
      assert.deepEqual(h.human.fillHuman(sel(item, 10, stale)), { filled: false, reason: 'origin-changed' }, type);
      assert.equal(calls.length, 1, `${type}: no delegate call after the origin changed`);
      h.urls[10] = A + '/login';
    }
    assert.equal(h.lines.filter((l) => l.endsWith('reason=origin')).length, 3, 'each origin refusal traced');
  } finally {
    rm(dir);
  }
});

test('the origin check compares the COMMITTED origin: an error page, a scheme change or a port change refuses', async () => {
  const dir = tmpDir();
  try {
    const h = await makeHarness(dir);
    for (const url of [
      'chrome-error://chromewebdata/',
      'about:blank',
      'file:///etc/hosts',
      'http://a.example/login', // scheme change
      'https://a.example:8443/login' // port change
    ]) {
      h.urls[10] = A + '/login';
      const id = h.mint(10);
      h.urls[10] = url;
      assert.deepEqual(h.human.fillHuman(sel(h.card, 10, id)), { filled: false, reason: 'origin-changed' }, url);
    }
    assert.equal(h.calls.card.length, 0);
    // A different PATH on the same origin is the same page for this purpose.
    h.urls[10] = A + '/other/page?x=1#y';
    const sameOrigin = h.mint(10);
    assert.deepEqual(h.human.fillHuman(sel(h.card, 10, sameOrigin)), { filled: false, reason: 'confirm-needed' });
    assert.deepEqual(h.human.fillHuman({ ...sel(h.card, 10, sameOrigin), confirm: true }), { filled: true });
  } finally {
    rm(dir);
  }
});

test('a generated fill needs the context and the same origin, and consumes it', async () => {
  const dir = tmpDir();
  try {
    const h = await makeHarness(dir);
    h.store.lockNow(); // generate does not require unlocked
    assert.deepEqual(h.human.fillGenerated({ wcId: 10, candidates: ['Abc123!!'], contextId: 'nope' }), {
      filled: false,
      reason: 'no-context'
    });
    const id = h.mint(10);
    assert.deepEqual(h.human.fillGenerated({ wcId: 10, candidates: ['Abc123!!'], contextId: id }), { filled: true });
    assert.equal(h.calls.generated.length, 1);
    assert.deepEqual(h.human.fillGenerated({ wcId: 10, candidates: ['Abc123!!'], contextId: id }), {
      filled: false,
      reason: 'no-context'
    });
    const stale = h.mint(10);
    h.urls[10] = EVIL + '/';
    assert.deepEqual(h.human.fillGenerated({ wcId: 10, candidates: ['Abc123!!'], contextId: stale }), {
      filled: false,
      reason: 'origin-changed'
    });
    assert.equal(h.calls.generated.length, 1);
  } finally {
    rm(dir);
  }
});

test("a fill with no / a stale / another tab's context id sends nothing", async () => {
  const dir = tmpDir();
  try {
    const h = await makeHarness(dir);
    const id10 = h.mint(10);
    assert.deepEqual(h.human.fillHuman({ wcId: 10, vaultId: 'work', itemId: h.login.id }), {
      filled: false,
      reason: 'no-context'
    });
    assert.deepEqual(h.human.fillHuman(sel(h.login, 10, 'guess')), { filled: false, reason: 'no-context' });
    assert.deepEqual(h.human.fillHuman(sel(h.login, 11, id10)), { filled: false, reason: 'no-context' });
    assert.equal(h.calls.login.length, 0);
    // The one-context-per-tab rule: a second gesture replaces the first, whose id is then stale.
    const id10b = h.mint(10);
    assert.deepEqual(h.human.fillHuman(sel(h.login, 10, id10)), { filled: false, reason: 'no-context' });
    assert.deepEqual(h.human.fillHuman(sel(h.login, 10, id10b)), { filled: true });
  } finally {
    rm(dir);
  }
});

test('a refused fill keeps the context (locked, wrong item, burner); only a fill that used it consumes it', async () => {
  const dir = tmpDir();
  try {
    const h = await makeHarness(dir);
    const id = h.mint(10);
    h.store.lockNow();
    assert.deepEqual(h.human.fillHuman(sel(h.login, 10, id)), { filled: false, reason: 'locked' });
    assert.equal(h.human.requireContext(10, id).ok, true, 'a vault lock keeps the context');
    await h.store.unlock(MASTER);
    assert.deepEqual(h.human.fillHuman({ wcId: 10, vaultId: 'work', itemId: 'nope', contextId: id }), {
      filled: false,
      reason: 'origin-mismatch'
    });
    assert.equal(h.human.requireContext(10, id).ok, true, 'a refused fill keeps it');
    assert.deepEqual(h.human.fillHuman(sel(h.login, 10, id)), { filled: true });
    assert.equal(h.human.requireContext(10, id).ok, false, 'consumed by the fill that used it');
  } finally {
    rm(dir);
  }
});

test('a vault LOCK keeps contexts (dropAllCaptures leaves them): the re-raised unlock sheet continues the same open', async () => {
  const dir = tmpDir();
  try {
    const h = await makeHarness(dir);
    const id = h.mint(10);
    h.human.dropAllCaptures();
    assert.equal(h.human.requireContext(10, id).ok, true);
  } finally {
    rm(dir);
  }
});

test('the lifecycle drops: a tab drop (the closeSavePromptAndDrop path), a window drop, a dismissed-sheet drop', async () => {
  const dir = tmpDir();
  try {
    const h = await makeHarness(dir);
    // Tab lifecycle (switch / hide / close / move / fullscreen all call dropCapturesForTab).
    let a = h.mint(10);
    let b = h.mint(11);
    h.human.dropCapturesForTab(10);
    assert.equal(h.human.requireContext(10, a).ok, false);
    assert.equal(h.human.requireContext(11, b).ok, true, 'another tab is untouched');
    // Window close: every tab of that window.
    a = h.mint(10);
    b = h.mint(11);
    const c = h.mint(20);
    h.human.dropCapturesForWindow(1);
    assert.equal(h.human.requireContext(10, a).ok, false);
    assert.equal(h.human.requireContext(11, b).ok, false);
    assert.equal(h.human.requireContext(20, c).ok, true, "another window's tab is untouched");
    // A dismissed picker / unlock sheet: the window's tabs, by wcId list.
    a = h.mint(10);
    b = h.mint(11);
    assert.equal(h.human.dropContextsForTabs([10, 11]), 2);
    assert.equal(h.human.requireContext(10, a).ok, false);
    assert.equal(h.human.requireContext(11, b).ok, false);
    // A cross-document navigation drops one tab's context.
    a = h.mint(10);
    assert.equal(h.human.dropContext(10), true);
    assert.equal(h.human.requireContext(10, a).ok, false);
  } finally {
    rm(dir);
  }
});

test('the time limit: a context outlives a 60 s unlock but not the shared 120 s limit; a recovered chrome (new ids, no old id) cannot use it', async () => {
  const dir = tmpDir();
  try {
    let t = 1000;
    const h = await makeHarness(dir, { now: () => t });
    const id = h.mint(10);
    t += 60 * 1000;
    assert.equal(h.human.requireContext(10, id).ok, true, '60 s (a slow unlock) is inside the limit');
    // Chrome recovery: the reloaded chrome has lost the id; whatever it sends is not the live id.
    assert.deepEqual(h.human.fillHuman(sel(h.login, 10, 'recovered-chrome-has-no-id')), {
      filled: false,
      reason: 'no-context'
    });
    t += 60 * 1000;
    assert.deepEqual(
      h.human.fillHuman(sel(h.login, 10, id)),
      { filled: false, reason: 'no-context' },
      'aged out at 120 s'
    );
    assert.equal(h.calls.login.length, 0);
  } finally {
    rm(dir);
  }
});

test('the trace lines carry a reason only: no id, origin, url or item data', async () => {
  const dir = tmpDir();
  try {
    const h = await makeHarness(dir);
    const id = h.mint(10);
    h.human.fillHuman(sel(h.login, 10, 'bad'));
    h.human.fillHuman(sel(h.login, 11, id));
    h.urls[10] = EVIL + '/';
    h.human.fillHuman(sel(h.login, 10, id));
    assert.equal(h.lines.length, 3);
    for (const line of h.lines) {
      assert.match(line, /^\[vault-gesture\] context-refused reason=(missing|stale|origin)$/);
    }
  } finally {
    rm(dir);
  }
});
