'use strict';

// Integration tests for the CARD half of the human fill orchestration (issue #152),
// driven against a REAL vault store with fake webContents/registry/fill-delegate
// handles — the vault-human.test.js harness, extended with card items.
//
// The load-bearing claim under test is the deliberate ASYMMETRY between the two
// families: a login fill is origin-gated, a card fill is not, and everything else
// (unlocked → persistent jar → jar scope) applies identically to both. The tests
// below pin BOTH halves of that: cards fill at an arbitrary merchant origin, AND
// they still refuse on a locked vault, a burner tab, and a cross-jar vaultId.
//
// Electron-free (the vault-store.test.js FAST-scrypt + temp-dir pattern).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');
const { createVaultHuman } = require('../../src/main/vault/vault-human');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';
const JARS = [
  { id: 'work', partition: 'persist:container:work' },
  { id: 'personal', partition: 'persist:container:personal' }
];
const A = 'https://a.example';
const SHOP = 'https://shop.unrelated.test';

const CARD = {
  type: 'card',
  title: 'Personal Visa',
  cardholder: 'A Lovelace',
  brand: 'Visa',
  last4: '4242',
  number: '4242424242424242',
  cvv: '123',
  expiry: '12/28'
};

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-card-'));
}
function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// wcId map:
//   10 → work-jar tab @ A     12 → work-jar tab @ an UNRELATED merchant
//   20 → burner tab @ SHOP    30 → closed tab (fromId null)
async function makeHarness(dir) {
  const store = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => JARS });
  await store.setup({ masterPassword: MASTER });
  const workCard = store.saveItem('work', CARD);
  const globalCard = store.saveItem('global', { ...CARD, title: 'Shared Amex', brand: 'Amex', last4: '0005' });
  const personalCard = store.saveItem('personal', { ...CARD, title: 'Other jar card' });
  const workLogin = store.saveItem('work', {
    type: 'login',
    title: 'Work',
    username: 'w@a',
    password: 'work-pass',
    origin: A
  });

  const urls = { 10: A + '/login', 12: SHOP + '/checkout', 20: SHOP + '/checkout' };
  const entries = new Map([
    [10, { partition: 'persist:container:work', trusted: false }],
    [12, { partition: 'persist:container:work', trusted: false }],
    [20, { partition: 'burner:1', trusted: false }]
  ]);

  const fillCalls = [];
  const cardCalls = [];
  const human = createVaultHuman({
    getVaultStore: () => store,
    fromId: (id) => (urls[id] != null ? { getURL: () => urls[id] } : null),
    getTabEntry: (id) => entries.get(id),
    listJars: () => JARS,
    fillDelegate: (arg) => fillCalls.push(arg),
    fillCardDelegate: (arg) => cardCalls.push(arg)
  });
  return { store, human, fillCalls, cardCalls, workCard, globalCard, personalCard, workLogin };
}

// --- the core claim: cards fill anywhere ----------------------------------

test('a card fills at an UNRELATED merchant origin — the no-origin-gate decision', async () => {
  const dir = tmpDir();
  try {
    const { human, cardCalls, workCard } = await makeHarness(dir);
    const res = human.fillHuman({ wcId: 12, vaultId: 'work', itemId: workCard.id });

    assert.deepEqual(res, { filled: true });
    assert.equal(cardCalls.length, 1);
    assert.deepEqual(cardCalls[0], {
      wcId: 12,
      card: { number: '4242424242424242', cardholder: 'A Lovelace', expiry: '12/28', cvv: '123' }
    });
  } finally {
    rm(dir);
  }
});

test('a global card fills on a jar tab at an unrelated origin', async () => {
  const dir = tmpDir();
  try {
    const { human, cardCalls, globalCard } = await makeHarness(dir);
    assert.deepEqual(human.fillHuman({ wcId: 12, vaultId: 'global', itemId: globalCard.id }), { filled: true });
    assert.equal(cardCalls.length, 1);
  } finally {
    rm(dir);
  }
});

test('the card fill result carries NO card data', async () => {
  const dir = tmpDir();
  try {
    const { human, workCard } = await makeHarness(dir);
    const res = human.fillHuman({ wcId: 12, vaultId: 'work', itemId: workCard.id });
    const json = JSON.stringify(res);
    assert.ok(!json.includes('4242424242424242'), 'no PAN in the fill result');
    assert.ok(!json.includes('123'), 'no CVV in the fill result');
    assert.deepEqual(Object.keys(res), ['filled']);
  } finally {
    rm(dir);
  }
});

test('the card rides the CARD channel, never the login credential channel', async () => {
  const dir = tmpDir();
  try {
    const { human, fillCalls, cardCalls, workCard } = await makeHarness(dir);
    human.fillHuman({ wcId: 12, vaultId: 'work', itemId: workCard.id });
    assert.equal(fillCalls.length, 0, 'the login fill delegate is never called for a card');
    assert.equal(cardCalls.length, 1);
  } finally {
    rm(dir);
  }
});

// --- every OTHER gate still applies ---------------------------------------

test('a LOCKED vault refuses a card fill', async () => {
  const dir = tmpDir();
  try {
    const { store, human, cardCalls, workCard } = await makeHarness(dir);
    store.lockNow();
    assert.deepEqual(human.fillHuman({ wcId: 12, vaultId: 'work', itemId: workCard.id }), {
      filled: false,
      reason: 'locked'
    });
    assert.equal(cardCalls.length, 0);
  } finally {
    rm(dir);
  }
});

test('a BURNER tab refuses a card fill, global vaultId included', async () => {
  const dir = tmpDir();
  try {
    const { human, cardCalls, globalCard, workCard } = await makeHarness(dir);
    assert.deepEqual(human.fillHuman({ wcId: 20, vaultId: 'global', itemId: globalCard.id }), {
      filled: false,
      reason: 'ineligible'
    });
    assert.deepEqual(human.fillHuman({ wcId: 20, vaultId: 'work', itemId: workCard.id }), {
      filled: false,
      reason: 'ineligible'
    });
    assert.equal(cardCalls.length, 0);
  } finally {
    rm(dir);
  }
});

test('a CROSS-JAR vaultId refuses a card fill (jar scope survives the dropped origin gate)', async () => {
  const dir = tmpDir();
  try {
    const { human, cardCalls, personalCard } = await makeHarness(dir);
    // wcId 12 is a WORK tab; the card lives in the PERSONAL vault.
    assert.deepEqual(human.fillHuman({ wcId: 12, vaultId: 'personal', itemId: personalCard.id }), {
      filled: false,
      reason: 'out-of-scope'
    });
    assert.equal(cardCalls.length, 0);
  } finally {
    rm(dir);
  }
});

test('a closed tab refuses a card fill', async () => {
  const dir = tmpDir();
  try {
    const { human, cardCalls, workCard } = await makeHarness(dir);
    assert.deepEqual(human.fillHuman({ wcId: 30, vaultId: 'work', itemId: workCard.id }), {
      filled: false,
      reason: 'ineligible'
    });
    assert.equal(cardCalls.length, 0);
  } finally {
    rm(dir);
  }
});

test('an omitted fillCardDelegate refuses rather than silently dropping the fill', async () => {
  const dir = tmpDir();
  try {
    const store = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => JARS });
    await store.setup({ masterPassword: MASTER });
    const card = store.saveItem('work', CARD);
    const human = createVaultHuman({
      getVaultStore: () => store,
      fromId: () => ({ getURL: () => SHOP + '/checkout' }),
      getTabEntry: () => ({ partition: 'persist:container:work', trusted: false }),
      listJars: () => JARS,
      fillDelegate: () => {}
      // fillCardDelegate deliberately omitted
    });
    assert.deepEqual(human.fillHuman({ wcId: 12, vaultId: 'work', itemId: card.id }), {
      filled: false,
      reason: 'ineligible'
    });
  } finally {
    rm(dir);
  }
});

// --- the login path is untouched by the card branch -----------------------

test('a LOGIN still refuses on an origin mismatch (the card branch did not widen it)', async () => {
  const dir = tmpDir();
  try {
    const { human, fillCalls, workLogin } = await makeHarness(dir);
    // wcId 12 is at SHOP; the login is stored for A.
    assert.deepEqual(human.fillHuman({ wcId: 12, vaultId: 'work', itemId: workLogin.id }), {
      filled: false,
      reason: 'origin-mismatch'
    });
    assert.equal(fillCalls.length, 0);
  } finally {
    rm(dir);
  }
});

test('a login still fills normally at its own origin', async () => {
  const dir = tmpDir();
  try {
    const { human, fillCalls, cardCalls, workLogin } = await makeHarness(dir);
    assert.deepEqual(human.fillHuman({ wcId: 10, vaultId: 'work', itemId: workLogin.id }), { filled: true });
    assert.deepEqual(fillCalls[0].credential, { username: 'w@a', password: 'work-pass' });
    assert.equal(cardCalls.length, 0);
  } finally {
    rm(dir);
  }
});

// --- the picker model ------------------------------------------------------

test('reachableItems merges origin-matched logins with jar-scoped cards, each type-stamped', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const rows = human.reachableItems(10); // work tab at A — the login's own origin

    const logins = rows.filter((r) => r.type === 'login');
    const cards = rows.filter((r) => r.type === 'card');
    assert.equal(logins.length, 1, 'the origin-matched login');
    assert.equal(cards.length, 2, 'the work card + the global card — never the personal-jar one');
    assert.deepEqual(cards.map((c) => c.vaultId).sort(), ['global', 'work']);
    // Logins are listed before cards.
    assert.equal(rows[0].type, 'login');
  } finally {
    rm(dir);
  }
});

test('cards surface at an unrelated merchant where NO login matches', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const rows = human.reachableItems(12); // work tab at SHOP

    assert.deepEqual(
      rows.filter((r) => r.type === 'login'),
      [],
      'no login matches this origin'
    );
    assert.equal(rows.filter((r) => r.type === 'card').length, 2, 'both reachable cards still offered');
  } finally {
    rm(dir);
  }
});

test('the picker model is METADATA ONLY — no PAN, CVV or expiry anywhere', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const rows = human.reachableItems(12);
    const cards = rows.filter((r) => r.type === 'card');
    assert.ok(cards.length > 0);

    for (const row of cards) {
      assert.deepEqual(Object.keys(row).sort(), ['brand', 'cardholder', 'id', 'last4', 'title', 'type', 'vaultId']);
      for (const secret of ['number', 'cvv', 'expiry']) {
        assert.ok(!(secret in row), `no ${secret} key on a picker row`);
      }
    }
    const json = JSON.stringify(rows);
    assert.ok(!json.includes('4242424242424242'), 'no PAN in the picker model');
    assert.ok(!json.includes('"123"'), 'no CVV in the picker model');
    assert.ok(!json.includes('12/28'), 'no expiry in the picker model');
  } finally {
    rm(dir);
  }
});

test('a BURNER tab reaches no cards (no metadata leak to a non-persistent tab)', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    assert.deepEqual(human.reachableItems(20), []);
  } finally {
    rm(dir);
  }
});

test('a LOCKED vault reaches no cards', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    store.lockNow();
    assert.deepEqual(human.reachableItems(12), []);
  } finally {
    rm(dir);
  }
});
