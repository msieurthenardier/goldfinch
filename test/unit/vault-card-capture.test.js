'use strict';

// Integration tests for CARD capture (issue #152) — createVaultHuman's captureCard /
// captureFinalize / captureSave against a REAL vault store, the vault-capture.test.js
// harness extended with payment cards.
//
// The two claims that carry the most risk:
//   1. the PLAUSIBILITY GATE — a mis-detected field must never become a save offer,
//      because a false positive writes an arbitrary submitted value into the vault;
//   2. IDENTITY IS THE PAN, not the last4 — two cards can share a last4, and
//      dispositioning on last4 would silently overwrite a different card.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');
const { createVaultHuman } = require('../../src/main/vault/vault-human');
const { brandForNumber, last4Of, isPlausibleCardNumber, titleForNumber } = require('../../src/main/vault/card-identity');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';
const JARS = [{ id: 'work', partition: 'persist:container:work' }];
const SHOP = 'https://shop.example';

// Real Luhn-valid test PANs.
const VISA = '4242424242424242';
const VISA_2 = '4000056655665556';
const AMEX = '378282246310005';

const enc = (s) => new TextEncoder().encode(s);

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-cardcap-')); }
function rm(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

async function makeHarness(dir) {
  const store = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => JARS });
  await store.setup({ masterPassword: MASTER });

  const entries = new Map([
    [10, { partition: 'persist:container:work', trusted: false }],
    [20, { partition: 'burner:1', trusted: false }],
  ]);
  const urls = { 10: SHOP + '/checkout', 20: SHOP + '/checkout' };

  const human = createVaultHuman({
    getVaultStore: () => store,
    fromId: (id) => (urls[id] != null ? { getURL: () => urls[id] } : null),
    getTabEntry: (id) => entries.get(id),
    listJars: () => JARS,
    fillDelegate: () => {},
    fillCardDelegate: () => {},
  });
  return { store, human };
}

function submit(human, { wcId = 10, number = VISA, cvv = '123', cardholder = 'A Lovelace', expiry = '12/28' } = {}) {
  return human.captureCard({
    wcId,
    numberBytes: enc(number),
    cvvBytes: enc(cvv),
    cardholder,
    expiry,
  });
}

// --- card-identity ---------------------------------------------------------

test('card-identity: brand detection over the common networks', () => {
  assert.equal(brandForNumber(VISA), 'Visa');
  assert.equal(brandForNumber(AMEX), 'Amex');
  assert.equal(brandForNumber('5555555555554444'), 'Mastercard');
  assert.equal(brandForNumber('6011111111111117'), 'Discover');
  assert.equal(brandForNumber('9999999999999995'), null, 'an unknown IIN stores a null brand, never a guess');
});

test('card-identity: last4 and the synthesized title', () => {
  assert.equal(last4Of(VISA), '4242');
  assert.equal(last4Of('4242 4242 4242 4242'), '4242', 'formatting stripped');
  assert.equal(titleForNumber(VISA), 'Visa •••• 4242');
  assert.equal(titleForNumber('9999999999999995'), '•••• 9995', 'unknown brand degrades to masked digits');
});

test('card-identity: the plausibility gate is Luhn + length', () => {
  assert.equal(isPlausibleCardNumber(VISA), true);
  assert.equal(isPlausibleCardNumber(AMEX), true);
  assert.equal(isPlausibleCardNumber('4242424242424241'), false, 'fails Luhn');
  assert.equal(isPlausibleCardNumber('42424242424'), false, 'too short (11 digits)');
  assert.equal(isPlausibleCardNumber('4'.repeat(20)), false, 'too long');
  assert.equal(isPlausibleCardNumber(''), false);
});

// --- the plausibility gate, end to end ------------------------------------

test('a submitted value that is not a plausible card raises NO offer', () => {
  const dir = tmpDir();
  try {
    return makeHarness(dir).then(({ human, store }) => {
      assert.equal(submit(human, { number: '4242424242424241' }), null, 'Luhn failure → no offer');
      assert.equal(submit(human, { number: '12345' }), null, 'too short → no offer');
      assert.equal(submit(human, { number: 'not a card' }), null);
      assert.deepEqual(store.listItems('work'), [], 'nothing written to the vault');
    });
  } finally { rm(dir); }
});

test('a burner tab raises no card offer', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    assert.equal(submit(human, { wcId: 20 }), null);
  } finally { rm(dir); }
});

// --- save ------------------------------------------------------------------

test('a fresh card offers a SAVE with both vault choices and no card data in the model', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const offer = submit(human);

    assert.ok(offer);
    assert.equal(offer.model.kind, 'card');
    assert.equal(offer.model.mode, 'save');
    assert.equal(offer.model.origin, SHOP);
    assert.equal(offer.model.brand, 'Visa');
    assert.equal(offer.model.last4, '4242');
    assert.deepEqual(offer.model.choices, ['work', 'global']);
    // NO card secret anywhere in the model.
    const json = JSON.stringify(offer.model);
    assert.ok(!json.includes(VISA), 'no PAN in the offer model');
    assert.ok(!json.includes('123'), 'no CVV in the offer model');
  } finally { rm(dir); }
});

test('saving writes a card item with a synthesized title and the derived descriptors', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    const offer = submit(human);
    assert.deepEqual(human.captureSave({ captureId: offer.captureId, vaultId: 'work' }), { saved: true });

    const items = store.listItems('work');
    assert.equal(items.length, 1);
    assert.equal(items[0].type, 'card');
    assert.equal(items[0].title, 'Visa •••• 4242');
    assert.equal(items[0].number, VISA);
    assert.equal(items[0].cvv, '123');
    assert.equal(items[0].expiry, '12/28');
    assert.equal(items[0].cardholder, 'A Lovelace');
    assert.equal(items[0].brand, 'Visa');
    assert.equal(items[0].last4, '4242');
  } finally { rm(dir); }
});

test('saving into the global vault is offered and honored', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    const offer = submit(human);
    assert.deepEqual(human.captureSave({ captureId: offer.captureId, vaultId: 'global' }), { saved: true });
    assert.equal(store.listItems('global').length, 1);
    assert.deepEqual(store.listItems('work'), []);
  } finally { rm(dir); }
});

test('a vaultId outside the offered choices is refused', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const offer = submit(human);
    assert.deepEqual(
      human.captureSave({ captureId: offer.captureId, vaultId: 'somewhere-else' }),
      { saved: false, reason: 'invalid-vault' }
    );
  } finally { rm(dir); }
});

// --- update / no-op, keyed on the PAN -------------------------------------

test('re-submitting an UNCHANGED card raises no offer', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const first = submit(human);
    human.captureSave({ captureId: first.captureId, vaultId: 'work' });

    assert.equal(submit(human), null, 'same PAN, CVV, expiry and cardholder → nothing to update');
  } finally { rm(dir); }
});

test('a changed expiry on the SAME PAN offers an update against that item', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    const first = submit(human);
    human.captureSave({ captureId: first.captureId, vaultId: 'work' });
    const stored = store.listItems('work')[0];

    const offer = submit(human, { expiry: '01/30' });
    assert.ok(offer);
    assert.equal(offer.model.mode, 'update');
    assert.deepEqual(offer.model.choices, [], 'an update fixes the vault — no choice offered');

    assert.deepEqual(human.captureSave({ captureId: offer.captureId, vaultId: 'work' }), { saved: true });
    const after = store.listItems('work');
    assert.equal(after.length, 1, 'updated in place, not duplicated');
    assert.equal(after[0].id, stored.id);
    assert.equal(after[0].expiry, '01/30');
  } finally { rm(dir); }
});

test('a DIFFERENT card sharing nothing is a fresh save, not an update', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    const first = submit(human);
    human.captureSave({ captureId: first.captureId, vaultId: 'work' });

    const offer = submit(human, { number: VISA_2 });
    assert.equal(offer.model.mode, 'save');
    human.captureSave({ captureId: offer.captureId, vaultId: 'work' });
    assert.equal(store.listItems('work').length, 2, 'two distinct cards coexist');
  } finally { rm(dir); }
});

test('identity is the PAN, not the last4 — two cards ending 5556 stay distinct', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    // Two DIFFERENT Luhn-valid PANs that share their last four digits.
    const a = '4000056655665556';
    const b = '5555000000055556';
    assert.equal(last4Of(a), last4Of(b), 'precondition: the last4 collide');
    assert.ok(isPlausibleCardNumber(a) && isPlausibleCardNumber(b));

    const first = submit(human, { number: a });
    human.captureSave({ captureId: first.captureId, vaultId: 'work' });

    const second = submit(human, { number: b });
    assert.ok(second, 'a colliding last4 must still be a NEW card');
    assert.equal(second.model.mode, 'save', 'never an update against the other card');
    human.captureSave({ captureId: second.captureId, vaultId: 'work' });

    const items = store.listItems('work');
    assert.equal(items.length, 2);
    assert.deepEqual(items.map((i) => i.number).sort(), [a, b].sort());
  } finally { rm(dir); }
});

test('a stored PAN with formatting still matches an unformatted submit', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    store.saveItem('work', {
      type: 'card', title: 'Hand-entered', number: '4242 4242 4242 4242',
      cvv: '123', expiry: '12/28', cardholder: 'A Lovelace', brand: 'Visa', last4: '4242',
    });
    assert.equal(submit(human), null, 'digits-compared identity → recognized as unchanged');
  } finally { rm(dir); }
});

test('an update MERGES, preserving the operator custom title and notes', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    store.saveItem('work', {
      type: 'card', title: 'My travel card', notes: 'billing address is the office',
      number: VISA, cvv: '123', expiry: '12/28', cardholder: 'A Lovelace', brand: 'Visa', last4: '4242',
    });

    const offer = submit(human, { cvv: '999' });
    assert.equal(offer.model.mode, 'update');
    human.captureSave({ captureId: offer.captureId, vaultId: 'work' });

    const after = store.listItems('work')[0];
    assert.equal(after.cvv, '999', 'the changed secret is written');
    assert.equal(after.title, 'My travel card', 'the custom title survives');
    assert.equal(after.notes, 'billing address is the office', 'notes survive');
  } finally { rm(dir); }
});

// --- locked-vault hold + finalize -----------------------------------------

test('a LOCKED vault holds the card and defers the disposition to finalize', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    store.lockNow();

    const offer = submit(human);
    assert.ok(offer);
    assert.equal(offer.model.mode, 'locked');
    assert.equal(offer.model.kind, 'card');
    assert.equal(offer.model.last4, '4242', 'the non-secret descriptor is available while locked');

    await store.unlock(MASTER);
    const finalized = human.captureFinalize(offer.captureId);
    assert.ok(finalized);
    assert.equal(finalized.model.mode, 'save');
    assert.deepEqual(human.captureSave({ captureId: offer.captureId, vaultId: 'work' }), { saved: true });
    assert.equal(store.listItems('work')[0].number, VISA);
  } finally { rm(dir); }
});

// --- record hygiene --------------------------------------------------------

test('dismiss drops the held record so a later save cannot resurrect it', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    const offer = submit(human);
    human.captureDismiss(offer.captureId);

    assert.deepEqual(human.captureSave({ captureId: offer.captureId, vaultId: 'work' }), { saved: false });
    assert.deepEqual(store.listItems('work'), []);
  } finally { rm(dir); }
});

test('a re-submit on the same tab supersedes the prior held record', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    const first = submit(human);
    const second = submit(human, { number: VISA_2 });

    assert.notEqual(first.captureId, second.captureId);
    assert.deepEqual(
      human.captureSave({ captureId: first.captureId, vaultId: 'work' }),
      { saved: false },
      'the superseded record is gone'
    );
    assert.deepEqual(human.captureSave({ captureId: second.captureId, vaultId: 'work' }), { saved: true });
    assert.equal(store.listItems('work').length, 1);
  } finally { rm(dir); }
});

test('an idle lock between the offer and the save refuses rather than writing', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    const offer = submit(human);
    store.lockNow();
    assert.deepEqual(
      human.captureSave({ captureId: offer.captureId, vaultId: 'work' }),
      { saved: false, reason: 'locked' }
    );
  } finally { rm(dir); }
});

test('the incoming Uint8Arrays are zeroized by capture', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const numberBytes = enc(VISA);
    const cvvBytes = enc('123');
    human.captureCard({ wcId: 10, numberBytes, cvvBytes, cardholder: 'A', expiry: '12/28' });

    assert.ok(numberBytes.every((b) => b === 0), 'the PAN array is wiped');
    assert.ok(cvvBytes.every((b) => b === 0), 'the CVV array is wiped');
  } finally { rm(dir); }
});

test('the incoming arrays are zeroized even when the offer is REFUSED', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const numberBytes = enc('4242424242424241'); // fails Luhn
    const cvvBytes = enc('123');
    assert.equal(human.captureCard({ wcId: 10, numberBytes, cvvBytes }), null);

    assert.ok(numberBytes.every((b) => b === 0), 'a refused capture still wipes the PAN array');
    assert.ok(cvvBytes.every((b) => b === 0));
  } finally { rm(dir); }
});
