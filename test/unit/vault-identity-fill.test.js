'use strict';

// Integration tests for the IDENTITY half of the human fill orchestration
// (Mission 21, Flight 3, Leg 3 — identity-fill, DD7), driven against a REAL
// vault store with fake webContents/registry/fill-delegate handles — the
// vault-card-fill.test.js harness (itself modeled on vault-human.test.js),
// extended with an identity item.
//
// The load-bearing claim under test is the SAME asymmetry the card precedent
// pins: an identity fill is NOT origin-gated (a person's own name and address
// belong to the operator, not to a site), and everything else (unlocked →
// persistent jar → jar scope) applies identically. AC16-AC19.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-identity-'));
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
  const workIdentity = store.saveItem('work', IDENTITY);
  const globalIdentity = store.saveItem('global', { ...IDENTITY, title: 'Global profile', fullName: 'Grace Hopper' });
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
  const identityCalls = [];
  const human = createVaultHuman({
    getVaultStore: () => store,
    fromId: (id) => (urls[id] != null ? { getURL: () => urls[id] } : null),
    getTabEntry: (id) => entries.get(id),
    listJars: () => JARS,
    fillDelegate: (arg) => fillCalls.push(arg),
    fillIdentityDelegate: (arg) => identityCalls.push(arg)
  });
  return { store, human, fillCalls, identityCalls, workIdentity, globalIdentity, workLogin };
}

// --- the core claim: identity fills anywhere (DD7) -------------------------

test('AC18: an identity fills at an UNRELATED merchant origin — the no-origin-gate decision', async () => {
  const dir = tmpDir();
  try {
    const { human, identityCalls, workIdentity } = await makeHarness(dir);
    const res = human.fillHuman({ wcId: 12, vaultId: 'work', itemId: workIdentity.id });

    assert.deepEqual(res, { filled: true });
    assert.equal(identityCalls.length, 1);
    assert.deepEqual(identityCalls[0], {
      wcId: 12,
      identity: {
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
      }
    });
  } finally {
    rm(dir);
  }
});

test('a global identity fills on a jar tab at an unrelated origin', async () => {
  const dir = tmpDir();
  try {
    const { human, identityCalls, globalIdentity } = await makeHarness(dir);
    assert.deepEqual(human.fillHuman({ wcId: 12, vaultId: 'global', itemId: globalIdentity.id }), { filled: true });
    assert.equal(identityCalls.length, 1);
    assert.equal(identityCalls[0].identity.fullName, 'Grace Hopper');
  } finally {
    rm(dir);
  }
});

test('the identity fill result carries NO identity data', async () => {
  const dir = tmpDir();
  try {
    const { human, workIdentity } = await makeHarness(dir);
    const res = human.fillHuman({ wcId: 12, vaultId: 'work', itemId: workIdentity.id });
    const json = JSON.stringify(res);
    assert.ok(!json.includes('Analytical Engine'), 'no street value in the fill result');
    assert.ok(!json.includes('ada@example.com'), 'no email in the fill result');
    assert.deepEqual(Object.keys(res), ['filled']);
  } finally {
    rm(dir);
  }
});

test('the identity rides its OWN channel, never the login credential channel', async () => {
  const dir = tmpDir();
  try {
    const { human, fillCalls, identityCalls, workIdentity } = await makeHarness(dir);
    human.fillHuman({ wcId: 12, vaultId: 'work', itemId: workIdentity.id });
    assert.equal(fillCalls.length, 0, 'the login fill delegate is never called for an identity');
    assert.equal(identityCalls.length, 1);
  } finally {
    rm(dir);
  }
});

// --- every OTHER gate still applies -----------------------------------------

test('a LOCKED vault refuses an identity fill', async () => {
  const dir = tmpDir();
  try {
    const { store, human, identityCalls, workIdentity } = await makeHarness(dir);
    store.lockNow();
    assert.deepEqual(human.fillHuman({ wcId: 12, vaultId: 'work', itemId: workIdentity.id }), {
      filled: false,
      reason: 'locked'
    });
    assert.equal(identityCalls.length, 0);
  } finally {
    rm(dir);
  }
});

test('a BURNER tab refuses an identity fill, global vaultId included', async () => {
  const dir = tmpDir();
  try {
    const { human, identityCalls, globalIdentity, workIdentity } = await makeHarness(dir);
    assert.deepEqual(human.fillHuman({ wcId: 20, vaultId: 'global', itemId: globalIdentity.id }), {
      filled: false,
      reason: 'ineligible'
    });
    assert.deepEqual(human.fillHuman({ wcId: 20, vaultId: 'work', itemId: workIdentity.id }), {
      filled: false,
      reason: 'ineligible'
    });
    assert.equal(identityCalls.length, 0);
  } finally {
    rm(dir);
  }
});

test('a CROSS-JAR vaultId refuses an identity fill (jar scope survives the dropped origin gate)', async () => {
  const dir = tmpDir();
  try {
    const { store, human, identityCalls } = await makeHarness(dir);
    const personalIdentity = store.saveItem('personal', { ...IDENTITY, title: 'Other jar identity' });
    // wcId 12 is a WORK tab; the identity lives in the PERSONAL vault.
    assert.deepEqual(human.fillHuman({ wcId: 12, vaultId: 'personal', itemId: personalIdentity.id }), {
      filled: false,
      reason: 'out-of-scope'
    });
    assert.equal(identityCalls.length, 0);
  } finally {
    rm(dir);
  }
});

test('a closed tab refuses an identity fill', async () => {
  const dir = tmpDir();
  try {
    const { human, identityCalls, workIdentity } = await makeHarness(dir);
    assert.deepEqual(human.fillHuman({ wcId: 30, vaultId: 'work', itemId: workIdentity.id }), {
      filled: false,
      reason: 'ineligible'
    });
    assert.equal(identityCalls.length, 0);
  } finally {
    rm(dir);
  }
});

test('AC18: an omitted fillIdentityDelegate refuses rather than silently dropping the fill', async () => {
  const dir = tmpDir();
  try {
    const store = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => JARS });
    await store.setup({ masterPassword: MASTER });
    const identity = store.saveItem('work', IDENTITY);
    const human = createVaultHuman({
      getVaultStore: () => store,
      fromId: () => ({ getURL: () => SHOP + '/checkout' }),
      getTabEntry: () => ({ partition: 'persist:container:work', trusted: false }),
      listJars: () => JARS,
      fillDelegate: () => {}
      // fillIdentityDelegate deliberately omitted
    });
    assert.deepEqual(human.fillHuman({ wcId: 12, vaultId: 'work', itemId: identity.id }), {
      filled: false,
      reason: 'ineligible'
    });
  } finally {
    rm(dir);
  }
});

// --- the login path is untouched by the identity branch ---------------------

test('a LOGIN still refuses on an origin mismatch (the identity branch did not widen it)', async () => {
  const dir = tmpDir();
  try {
    const { human, fillCalls, workLogin } = await makeHarness(dir);
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
    const { human, fillCalls, identityCalls, workLogin } = await makeHarness(dir);
    assert.deepEqual(human.fillHuman({ wcId: 10, vaultId: 'work', itemId: workLogin.id }), { filled: true });
    assert.deepEqual(fillCalls[0].credential, { username: 'w@a', password: 'work-pass' });
    assert.equal(identityCalls.length, 0);
  } finally {
    rm(dir);
  }
});

// --- the picker model (AC16/AC17) -------------------------------------------

test('reachableItems merges logins, cards (none here) and identity, each type-stamped, identity LAST', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const rows = human.reachableItems(10); // work tab at A — the login's own origin

    assert.deepEqual(
      rows.map((r) => r.type),
      ['login', 'identity', 'identity']
    );
  } finally {
    rm(dir);
  }
});

test('an identity surfaces at an unrelated merchant where NO login matches', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const rows = human.reachableItems(12); // work tab at SHOP

    assert.deepEqual(
      rows.filter((r) => r.type === 'login'),
      [],
      'no login matches this origin'
    );
    assert.equal(rows.filter((r) => r.type === 'identity').length, 2, 'both reachable identities still offered');
  } finally {
    rm(dir);
  }
});

test('AC16: the picker model is METADATA ONLY — no secret identity field anywhere', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const rows = human.reachableItems(12);
    const identities = rows.filter((r) => r.type === 'identity');
    assert.ok(identities.length > 0);

    for (const row of identities) {
      assert.deepEqual(Object.keys(row).sort(), ['fullName', 'id', 'title', 'type', 'vaultId']);
      for (const secret of [
        'firstName',
        'lastName',
        'email',
        'phone',
        'street',
        'street2',
        'city',
        'region',
        'country',
        'postalCode'
      ]) {
        assert.ok(!(secret in row), `no ${secret} key on a picker row`);
      }
    }
    const json = JSON.stringify(rows);
    assert.ok(!json.includes('Analytical Engine'), 'no street in the picker model');
    assert.ok(!json.includes('ada@example.com'), 'no email in the picker model');
    assert.ok(!json.includes('555-1234'), 'no phone in the picker model');
  } finally {
    rm(dir);
  }
});

test('a BURNER tab reaches no identity (no metadata leak to a non-persistent tab)', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    assert.deepEqual(human.reachableItems(20), []);
  } finally {
    rm(dir);
  }
});

test('a LOCKED vault reaches no identity', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    store.lockNow();
    assert.deepEqual(human.reachableItems(12), []);
  } finally {
    rm(dir);
  }
});

// --- reachableIdentityItems directly (AC16) ---------------------------------

test('reachableIdentityItems reads through identityProfileOf, never items.find', async () => {
  const dir = tmpDir();
  try {
    const store = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => JARS });
    await store.setup({ masterPassword: MASTER });
    const item = store.saveItem('work', IDENTITY);
    const rows = store.reachableIdentityItems('work');
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], { vaultId: 'work', id: item.id, title: 'Home', fullName: 'Ada Lovelace' });
  } finally {
    rm(dir);
  }
});

test('reachableIdentityItems: [] when locked, [] for a null jarId (burner)', async () => {
  const dir = tmpDir();
  try {
    const store = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => JARS });
    await store.setup({ masterPassword: MASTER });
    store.saveItem('work', IDENTITY);
    assert.deepEqual(store.reachableIdentityItems(null), []);
    store.lockNow();
    assert.deepEqual(store.reachableIdentityItems('work'), []);
  } finally {
    rm(dir);
  }
});
