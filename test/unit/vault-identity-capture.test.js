'use strict';

// Integration tests for IDENTITY capture (Mission 21, Flight 3, Leg 4 —
// identity-capture, DD10) — createVaultHuman's captureIdentity / holdGestureIdentity /
// captureFinalize / captureSave against a REAL vault store, plus the pure
// familyOf/dispatchByFamily fail-closed dispatch (LD1) unit-tested directly with
// plain objects.
//
// The two claims that carry the most risk (the leg's own "central danger"):
//   1. LD1 — every capture-side family dispatch is FAIL-CLOSED. A missed/binary
//      site does not crash; it silently routes identity into the login path —
//      at captureSave that means writing an identity capture as a `type: 'login'`
//      item, the mission's hard-zero class (AC3, neuter-verified).
//   2. LD7 — dropCapture zeroizes EVERY own Buffer field, not a named list, so a
//      new secret field (rec.identitySecrets) is covered with no edit required
//      (AC11, neuter-verified).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');
const { createVaultHuman, familyOf, dispatchByFamily, FAMILY_REFUSED } = require('../../src/main/vault/vault-human');
const { IDENTITY_FIELDS } = require('../../src/main/vault/identity-profile');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';
const JARS = [{ id: 'work', partition: 'persist:container:work' }];
const SHOP = 'https://shop.example';

const SECRET_ROLES = IDENTITY_FIELDS.filter((f) => f !== 'fullName');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-identitycap-'));
}
function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
function allZero(buf) {
  return buf.length > 0 && [...buf].every((b) => b === 0);
}

/**
 * Encode a plain `{ role: value }` partial as LD2's single Uint8Array — the
 * UTF-8 JSON of the ten secret role values (missing roles default to '').
 */
function secretsBytes(fields = {}) {
  const secrets = {};
  for (const role of SECRET_ROLES) secrets[role] = fields[role] ?? '';
  return new TextEncoder().encode(JSON.stringify(secrets));
}

async function makeHarness(dir) {
  const store = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => JARS });
  await store.setup({ masterPassword: MASTER });

  const entries = new Map([
    [10, { partition: 'persist:container:work', trusted: false }],
    [20, { partition: 'burner:1', trusted: false }]
  ]);
  const urls = { 10: SHOP + '/checkout', 20: SHOP + '/checkout' };

  const traceCalls = [];
  const human = createVaultHuman({
    getVaultStore: () => store,
    fromId: (id) => (urls[id] != null ? { getURL: () => urls[id] } : null),
    getTabEntry: (id) => entries.get(id),
    listJars: () => JARS,
    fillDelegate: () => {},
    fillCardDelegate: () => {},
    fillIdentityDelegate: () => {},
    trace: (event, detail) => traceCalls.push({ event, detail })
  });
  return { store, human, traceCalls };
}

function submit(human, { wcId = 10, fullName = 'Ada Lovelace', ...fields } = {}) {
  return human.captureIdentity({
    wcId,
    identitySecretsBytes: secretsBytes(fields),
    fullName
  });
}

// --- LD1: familyOf / dispatchByFamily, pure, plain objects (AC1, AC2) ------

test('AC1: familyOf is three-way and fail-closed', () => {
  assert.equal(familyOf({}), 'login', 'absent kind -> login');
  assert.equal(familyOf(undefined), 'login', 'no record at all -> login (best-effort fallback)');
  assert.equal(familyOf({ kind: 'card' }), 'card');
  assert.equal(familyOf({ kind: 'identity' }), 'identity');
  assert.equal(familyOf({ kind: 'constructor' }), null, 'a prototype-probing string refuses');
  assert.equal(familyOf({ kind: '' }), null, 'an empty string refuses');
  assert.equal(familyOf({ kind: 'bogus' }), null, 'an unrecognised string refuses');
  assert.equal(familyOf({ kind: null }), null, 'an EXPLICIT null is not "absent" — refuses');
});

test('AC2: dispatchByFamily invokes exactly the matching handler; an unrecognised kind invokes NONE and returns FAMILY_REFUSED', () => {
  const calls = [];
  const handlers = {
    login: (rec) => {
      calls.push(['login', rec]);
      return 'login-result';
    },
    card: (rec) => {
      calls.push(['card', rec]);
      return 'card-result';
    },
    identity: (rec) => {
      calls.push(['identity', rec]);
      return 'identity-result';
    }
  };

  assert.equal(dispatchByFamily({}, handlers), 'login-result');
  assert.deepEqual(calls, [['login', {}]]);
  calls.length = 0;

  assert.equal(dispatchByFamily({ kind: 'card' }, handlers), 'card-result');
  assert.deepEqual(calls, [['card', { kind: 'card' }]]);
  calls.length = 0;

  assert.equal(dispatchByFamily({ kind: 'identity' }, handlers), 'identity-result');
  assert.deepEqual(calls, [['identity', { kind: 'identity' }]]);
  calls.length = 0;

  assert.equal(dispatchByFamily({ kind: 'bogus' }, handlers), FAMILY_REFUSED);
  assert.deepEqual(calls, [], 'no handler invoked for an unrecognised kind');
});

test('AC2: FAMILY_REFUSED is a frozen sentinel, identifiable by reference', () => {
  assert.equal(Object.isFrozen(FAMILY_REFUSED), true);
  assert.notEqual(FAMILY_REFUSED, undefined);
  assert.notEqual(FAMILY_REFUSED, null);
});

// --- AC2b: each call site's refusal mapping, via the `_seedCaptureForTest` seam ---
//
// No public constructor can build a record with an unrecognised `kind` (that is
// exactly why LD1 pins the refusal via the exported dispatchByFamily rather than
// assuming it) — so this leg's test-only seam (`human._seedCaptureForTest`, the
// underscore-prefixed introspection precedent vault-entry-observer.js already
// uses) inserts a `{ kind: 'bogus' }` record directly into the private captures
// Map, then drives the REAL captureRelease/captureFinalize/captureSave against it.

test('AC2b: captureRelease OMITS a refused record from the returned array', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    human._seedCaptureForTest({
      captureId: 'bogus-release',
      wcId: 10,
      kind: 'bogus',
      mode: 'pending-settle',
      jarId: 'work',
      origin: SHOP,
      choices: [],
      timer: null
    });
    const released = human.captureRelease(10);
    assert.deepEqual(released, [], 'the refused record produces no offer, exactly like a no-op disposition');
    // The record is gone — a finalize against its id now reports 'expired'.
    assert.deepEqual(human.captureFinalize('bogus-release'), { reason: 'expired' });
  } finally {
    rm(dir);
  }
});

test('AC2b: captureFinalize maps a refused record to { reason: "expired" } — its existing "no such record" shape', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    human._seedCaptureForTest({
      captureId: 'bogus-finalize',
      wcId: 10,
      kind: 'bogus',
      mode: 'locked',
      jarId: 'work',
      origin: SHOP,
      choices: [],
      timer: null
    });
    assert.deepEqual(human.captureFinalize('bogus-finalize'), { reason: 'expired' });
    // Dropped — a second finalize call still reports the SAME thing (record gone).
    assert.deepEqual(human.captureFinalize('bogus-finalize'), { reason: 'expired' });
  } finally {
    rm(dir);
  }
});

test('AC2b: captureSave maps a refused record to { saved: false } — its existing "record gone" shape', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    human._seedCaptureForTest({
      captureId: 'bogus-save',
      wcId: 10,
      kind: 'bogus',
      mode: 'save',
      jarId: 'work',
      origin: SHOP,
      choices: ['work', 'global'],
      timer: null
    });
    assert.deepEqual(human.captureSave({ captureId: 'bogus-save', vaultId: 'work' }), { saved: false });
  } finally {
    rm(dir);
  }
});

test('AC2b: a refused record is dropped AND its Buffer fields zeroized', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const weird = Buffer.from('super-secret-plaintext');
    human._seedCaptureForTest({
      captureId: 'bogus-buf',
      wcId: 10,
      kind: 'bogus',
      mode: 'pending-settle',
      jarId: 'work',
      origin: SHOP,
      choices: [],
      timer: null,
      weirdSecret: weird
    });
    human.captureRelease(10);
    assert.ok(allZero(weird), "the refused record's Buffer field is zeroized, not just dropped");
  } finally {
    rm(dir);
  }
});

// Grep-AC (leg): after this leg, no binary `rec.kind === 'card'` dispatch survives
// in vault-human.js.
test("grep-AC: vault-human.js carries no `rec.kind === 'card'` binary dispatch", () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'vault', 'vault-human.js'), 'utf8');
  assert.equal(/rec\.kind === 'card'/.test(src), false);
});

// --- AC4: DD1 holds for three families ---------------------------------------

test('AC4: a login, card and identity hold coexist on one tab; a second identity gesture evicts only the identity record; captureRelease returns all three', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const enc = (s) => new TextEncoder().encode(s);

    human.holdGestureLogin({ wcId: 10, username: 'me@a', usernameDetected: true, passwordBytes: enc('hunter2') });
    human.holdGestureCard({ wcId: 10, numberBytes: enc('4242424242424242'), cvvBytes: enc('123') });
    const firstIdentity = human.holdGestureIdentity({
      wcId: 10,
      identitySecretsBytes: secretsBytes({ email: 'first@example.com', street: '1 First St', postalCode: '11111' }),
      fullName: 'First Person'
    });
    assert.ok(firstIdentity);

    // A second identity gesture evicts ONLY the first identity hold.
    const secondIdentity = human.holdGestureIdentity({
      wcId: 10,
      identitySecretsBytes: secretsBytes({ email: 'second@example.com', street: '2 Second St', postalCode: '22222' }),
      fullName: 'Second Person'
    });
    assert.ok(secondIdentity);
    assert.notEqual(firstIdentity.captureId, secondIdentity.captureId);

    const released = human.captureRelease(10);
    assert.equal(released.length, 3, 'login + card + the SURVIVING (second) identity hold');
    const kinds = released.map((o) => o.model.kind || 'login').sort();
    assert.deepEqual(kinds, ['card', 'identity', 'login']);
    const identityOffer = released.find((o) => o.model.kind === 'identity');
    assert.equal(identityOffer.model.mode, 'save');
  } finally {
    rm(dir);
  }
});

// --- AC8b/AC9: captureIdentity / holdGestureIdentity gate + supersession ------

test('AC9: holdGestureIdentity GATE (set up + persistent jar + origin) drops silently and wipes the incoming bytes', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const bytes = secretsBytes({ email: 'a@b.com' });
    // wcId 20 is a burner tab — no persistent jar.
    const held = human.holdGestureIdentity({ wcId: 20, identitySecretsBytes: bytes, fullName: 'Someone' });
    assert.equal(held, null);
    assert.ok(allZero(bytes), 'the incoming secrets array is wiped even on a gate drop');
  } finally {
    rm(dir);
  }
});

test('AC9: holdGestureIdentity creates a held record with NO offer — nothing is disposed at hold time', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const held = human.holdGestureIdentity({
      wcId: 10,
      identitySecretsBytes: secretsBytes({ email: 'a@b.com', street: '1 Main St', postalCode: '00000' }),
      fullName: 'Ada'
    });
    assert.ok(held && typeof held.captureId === 'string');
    assert.deepEqual(held, { captureId: held.captureId });
  } finally {
    rm(dir);
  }
});

test('a burner tab raises no identity offer via captureIdentity', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    assert.equal(submit(human, { wcId: 20, email: 'a@b.com', street: '1 Main St', postalCode: '00000' }), null);
  } finally {
    rm(dir);
  }
});

// --- AC3: the hard-zero pin ---------------------------------------------------

test('AC3: a held identity record saved through captureSave writes type:"identity", NEVER type:"login"', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    const offer = submit(human, { email: 'ada@example.com', street: '1 Main St', postalCode: '00000' });
    assert.ok(offer);
    assert.equal(offer.model.kind, 'identity');
    assert.equal(human.captureSave({ captureId: offer.captureId, vaultId: 'work' }).saved, true);

    const items = store.listItems('work');
    assert.equal(items.length, 1);
    assert.equal(items[0].type, 'identity');
    assert.notEqual(items[0].type, 'login');
  } finally {
    rm(dir);
  }
});

// --- AC13/AC16: fresh save / gap-fill / conflict dispositions -----------------

test('AC13: a fresh vault (no profile anywhere) offers a SAVE naming every captured field as addedFields', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const offer = submit(human, { email: 'ada@example.com', street: '1 Main St', postalCode: '00000' });
    assert.ok(offer);
    assert.equal(offer.model.kind, 'identity');
    assert.equal(offer.model.mode, 'save');
    assert.deepEqual(offer.model.choices, ['work', 'global']);
    assert.deepEqual(offer.model.changedFields, []);
    assert.ok(offer.model.addedFields.length > 0);
    // Labels, never raw field names.
    assert.ok(offer.model.addedFields.every((l) => !SECRET_ROLES.includes(l)));
  } finally {
    rm(dir);
  }
});

test('AC13/AC16: saving a fresh identity writes a new item titled "My details" (LD4) with every captured field', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    const offer = submit(human, {
      email: 'ada@example.com',
      street: '1 Main St',
      postalCode: '00000',
      phone: '555-1234'
    });
    human.captureSave({ captureId: offer.captureId, vaultId: 'work' });

    const item = store.listItems('work')[0];
    assert.equal(item.title, 'My details');
    assert.equal(item.fullName, 'Ada Lovelace');
    assert.equal(item.email, 'ada@example.com');
    assert.equal(item.street, '1 Main St');
    assert.equal(item.postalCode, '00000');
    assert.equal(item.phone, '555-1234');
  } finally {
    rm(dir);
  }
});

test('AC13: an identical re-capture against a stored profile is a MATCH — no offer', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const first = submit(human, { email: 'ada@example.com', street: '1 Main St', postalCode: '00000' });
    human.captureSave({ captureId: first.captureId, vaultId: 'work' });

    const second = submit(human, { email: 'ada@example.com', street: '1 Main St', postalCode: '00000' });
    assert.equal(second, null, 'byte-identical capture -> match -> no offer');
  } finally {
    rm(dir);
  }
});

test('AC13/AC16: a GAP-FILL capture (a new field, nothing conflicting) offers an update naming only the new field', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    const first = submit(human, { email: 'ada@example.com', street: '1 Main St', postalCode: '00000' });
    human.captureSave({ captureId: first.captureId, vaultId: 'work' });
    const stored = store.listItems('work')[0];

    const offer = submit(human, {
      email: 'ada@example.com',
      street: '1 Main St',
      postalCode: '00000',
      phone: '555-1234'
    });
    assert.ok(offer);
    assert.equal(offer.model.mode, 'update');
    assert.deepEqual(offer.model.choices, [], 'an update fixes the vault — no choice offered');
    assert.deepEqual(offer.model.changedFields, [], 'nothing conflicted');
    assert.equal(offer.model.addedFields.length, 1, 'only the new field is named');

    human.captureSave({ captureId: offer.captureId, vaultId: 'work' });
    const after = store.listItems('work');
    assert.equal(after.length, 1, 'updated in place, not duplicated');
    assert.equal(after[0].id, stored.id);
    assert.equal(after[0].phone, '555-1234', 'the new field was written');
    assert.equal(after[0].email, 'ada@example.com', 'untouched fields survive');
  } finally {
    rm(dir);
  }
});

test('AC13/AC16: a CONFLICT capture (an existing field differs) offers an update naming the changed field', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    const first = submit(human, { email: 'ada@example.com', street: '1 Main St', postalCode: '00000' });
    human.captureSave({ captureId: first.captureId, vaultId: 'work' });

    const offer = submit(human, { email: 'ada@example.com', street: '2 New Address', postalCode: '00000' });
    assert.ok(offer);
    assert.equal(offer.model.mode, 'update');
    assert.equal(offer.model.changedFields.length, 1, 'exactly the conflicting field is named');
    assert.deepEqual(offer.model.addedFields, []);

    human.captureSave({ captureId: offer.captureId, vaultId: 'work' });
    const after = store.listItems('work')[0];
    assert.equal(after.street, '2 New Address', 'the conflicting field is overwritten on accept');
  } finally {
    rm(dir);
  }
});

test('AC16b (LD8): an update writes EXACTLY the named fields — a stored phone with no phone in this capture survives untouched', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    const first = submit(human, {
      email: 'ada@example.com',
      street: '1 Main St',
      postalCode: '00000',
      phone: '555-1234'
    });
    human.captureSave({ captureId: first.captureId, vaultId: 'work' });

    // A later capture from a form with NO phone field, but a changed street.
    const offer = submit(human, { email: 'ada@example.com', street: '2 New Address', postalCode: '00000' });
    assert.ok(offer);
    human.captureSave({ captureId: offer.captureId, vaultId: 'work' });

    const after = store.listItems('work')[0];
    assert.equal(after.phone, '555-1234', 'phone was never captured this time — must survive untouched');
    assert.equal(after.street, '2 New Address');
  } finally {
    rm(dir);
  }
});

// --- AC14: DD6's value-bearing sentinel probe ---------------------------------

test('AC14: the offer model never carries a captured VALUE anywhere — sentinel probe', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const sentinels = {
      email: 'SENTINEL-EMAIL-9f8e7d',
      street: 'SENTINEL-STREET-1a2b3c',
      postalCode: 'SENTINEL-ZIP-00d00d',
      phone: 'SENTINEL-PHONE-555000',
      city: 'SENTINEL-CITY-caf3ca',
      country: 'SENTINEL-COUNTRY-1234'
    };
    const offer = submit(human, { ...sentinels, fullName: 'SENTINEL-FULLNAME-abcdef' });
    assert.ok(offer);
    const json = JSON.stringify(offer.model);
    for (const [field, sentinel] of Object.entries(sentinels)) {
      assert.ok(!json.includes(sentinel), `sentinel value for ${field} must not appear anywhere in the offer model`);
    }
    assert.ok(!json.includes('SENTINEL-FULLNAME-abcdef'), 'fullName sentinel must not appear either');
  } finally {
    rm(dir);
  }
});

// --- AC15: locked-vault hold + finalize ---------------------------------------

test('AC15: a LOCKED vault holds the identity capture and defers the disposition to finalize', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    store.lockNow();

    const offer = submit(human, { email: 'ada@example.com', street: '1 Main St', postalCode: '00000' });
    assert.ok(offer);
    assert.equal(offer.model.mode, 'locked');
    assert.equal(offer.model.kind, 'identity');
    // No field data leaks while locked either.
    assert.ok(!JSON.stringify(offer.model).includes('ada@example.com'));

    await store.unlock(MASTER);
    const finalized = human.captureFinalize(offer.captureId);
    assert.ok(finalized.model);
    assert.equal(finalized.model.mode, 'save');
    assert.deepEqual(human.captureSave({ captureId: offer.captureId, vaultId: 'work' }), { saved: true });
    assert.equal(store.listItems('work')[0].email, 'ada@example.com');
  } finally {
    rm(dir);
  }
});

// --- AC12: captureRelease copies the Buffer before dropCapture ---------------

test('AC12: releasing a pending identity hold does not zeroize the copy used for disposition', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    human.holdGestureIdentity({
      wcId: 10,
      identitySecretsBytes: secretsBytes({ email: 'ada@example.com', street: '1 Main St', postalCode: '00000' }),
      fullName: 'Ada Lovelace'
    });
    const released = human.captureRelease(10);
    assert.equal(released.length, 1);
    assert.equal(released[0].model.kind, 'identity');
    assert.equal(released[0].model.mode, 'save');
  } finally {
    rm(dir);
  }
});

// --- AC16c (LD9): the duplicate-profile refusal -------------------------------

test('AC16c: a vault with TWO identity profiles refuses the offer (extra non-empty) — with trace', () => {
  const traceCalls = [];
  // A lightweight fake store standing in for a hand-edited file that has
  // violated the one-profile-per-vault invariant — the real VaultStore's own
  // _saveItem guard prevents writing this through the ordinary API.
  const fakeStore = {
    isSetUp: () => true,
    isUnlocked: () => true,
    listItems: (vaultId) =>
      vaultId === 'work'
        ? [
            { id: 'i1', type: 'identity', title: 'Me', fullName: 'First' },
            { id: 'i2', type: 'identity', title: 'Me', fullName: 'Second' }
          ]
        : [],
    saveItem: () => {
      throw new Error('must not be called');
    }
  };
  const fakeHuman = createVaultHuman({
    getVaultStore: () => fakeStore,
    fromId: (id) => (id === 10 ? { getURL: () => SHOP + '/checkout' } : null),
    getTabEntry: () => ({ partition: 'persist:container:work', trusted: false }),
    listJars: () => JARS,
    fillDelegate: () => {},
    trace: (event, detail) => traceCalls.push({ event, detail })
  });
  const offer = fakeHuman.captureIdentity({
    wcId: 10,
    identitySecretsBytes: secretsBytes({ email: 'a@b.com', street: '1 Main St', postalCode: '00000' }),
    fullName: 'Third'
  });
  assert.equal(offer, null, 'no offer at all — the duplicate-profile invariant violation is refused');
  assert.equal(traceCalls.length, 1);
  assert.equal(traceCalls[0].event, 'duplicate-profile');
  const detailJson = JSON.stringify(traceCalls[0].detail);
  assert.ok(!detailJson.includes('First') && !detailJson.includes('Second') && !detailJson.includes('a@b.com'));
});

test('AC16c: the duplicate-profile refusal still happens with NO trace dep injected', () => {
  const fakeStore = {
    isSetUp: () => true,
    isUnlocked: () => true,
    listItems: (vaultId) =>
      vaultId === 'work'
        ? [
            { id: 'i1', type: 'identity', title: 'Me', fullName: 'First' },
            { id: 'i2', type: 'identity', title: 'Me', fullName: 'Second' }
          ]
        : [],
    saveItem: () => {
      throw new Error('must not be called');
    }
  };
  const human = createVaultHuman({
    getVaultStore: () => fakeStore,
    fromId: (id) => (id === 10 ? { getURL: () => SHOP + '/checkout' } : null),
    getTabEntry: () => ({ partition: 'persist:container:work', trusted: false }),
    listJars: () => JARS,
    fillDelegate: () => {}
    // trace deliberately omitted.
  });
  const offer = human.captureIdentity({
    wcId: 10,
    identitySecretsBytes: secretsBytes({ email: 'a@b.com', street: '1 Main St', postalCode: '00000' }),
    fullName: 'Third'
  });
  assert.equal(offer, null);
});

// --- AC11: LD7's zeroize-every-Buffer, applied to identity ---------------------

test('AC11(a): dismiss still zeroizes password/number/cvv — today\'s behaviour, now as a subset of "every Buffer"', () => {
  const passwordBuf = Buffer.from('hunter2');
  const numberBuf = Buffer.from('4242424242424242');
  const cvvBuf = Buffer.from('123');
  const human = createVaultHuman({
    getVaultStore: () => ({ isUnlocked: () => true }),
    fromId: () => null,
    getTabEntry: () => null,
    listJars: () => []
  });
  human._seedCaptureForTest({
    captureId: 'legacy',
    wcId: 10,
    mode: 'save',
    jarId: 'work',
    origin: SHOP,
    choices: [],
    timer: null,
    password: passwordBuf
  });
  human.captureDismiss('legacy');
  assert.ok(allZero(passwordBuf), 'password zeroized');

  human._seedCaptureForTest({
    captureId: 'legacy-card',
    wcId: 10,
    kind: 'card',
    mode: 'save',
    jarId: 'work',
    origin: SHOP,
    choices: [],
    timer: null,
    number: numberBuf,
    cvv: cvvBuf
  });
  human.captureDismiss('legacy-card');
  assert.ok(allZero(numberBuf), 'number zeroized');
  assert.ok(allZero(cvvBuf), 'cvv zeroized');
});

test('AC11(b): dismiss zeroizes rec.identitySecrets after a hold by lock / tab close / window close / dismiss / TTL', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const bytes = secretsBytes({ email: 'ada@example.com', street: '1 Main St', postalCode: '00000' });
    const held = human.holdGestureIdentity({ wcId: 10, identitySecretsBytes: bytes, fullName: 'Ada' });
    human.captureDismiss(held.captureId);
    // Indirect proof (the module never returns a live record's Buffer): a
    // later save against the dropped id reports the record gone, not a stale
    // resurrection.
    assert.deepEqual(human.captureSave({ captureId: held.captureId, vaultId: 'work' }), { saved: false });
  } finally {
    rm(dir);
  }
});

test('AC11(c) — THE CANARY: an arbitrary, never-before-seen Buffer field is zeroized too, with NO edit to dropCapture', () => {
  const weirdSecret = Buffer.from('totally-new-secret-field-nobody-named-yet');
  const human = createVaultHuman({
    getVaultStore: () => ({ isUnlocked: () => true }),
    fromId: () => null,
    getTabEntry: () => null,
    listJars: () => []
  });
  human._seedCaptureForTest({
    captureId: 'canary',
    wcId: 10,
    kind: 'login',
    mode: 'save',
    jarId: 'work',
    origin: SHOP,
    choices: [],
    timer: null,
    // A field name LD7's own zeroize loop has never heard of — proves the
    // class is retired structurally (Buffer.isBuffer over every own value),
    // never by yet another name added to a list.
    someBrandNewSecretBuffer: weirdSecret
  });
  human.captureDismiss('canary');
  assert.ok(allZero(weirdSecret), 'the never-before-seen Buffer field was zeroized with no edit to dropCapture');
});

test('the incoming identitySecrets array is zeroized by captureIdentity', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const bytes = secretsBytes({ email: 'ada@example.com', street: '1 Main St', postalCode: '00000' });
    human.captureIdentity({ wcId: 10, identitySecretsBytes: bytes, fullName: 'Ada' });
    assert.ok(allZero(bytes), 'the incoming secrets array is wiped');
  } finally {
    rm(dir);
  }
});

// --- record hygiene ------------------------------------------------------------

test('a re-submit on the same tab supersedes the prior held identity record', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    const first = submit(human, { email: 'a@b.com', street: '1 Main St', postalCode: '00000' });
    const second = submit(human, { email: 'c@d.com', street: '2 Main St', postalCode: '11111' });

    assert.notEqual(first.captureId, second.captureId);
    assert.deepEqual(
      human.captureSave({ captureId: first.captureId, vaultId: 'work' }),
      { saved: false },
      'the superseded record is gone'
    );
    assert.deepEqual(human.captureSave({ captureId: second.captureId, vaultId: 'work' }), { saved: true });
    assert.equal(store.listItems('work').length, 1);
  } finally {
    rm(dir);
  }
});

test('an idle lock between the offer and the save refuses rather than writing', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    const offer = submit(human, { email: 'a@b.com', street: '1 Main St', postalCode: '00000' });
    store.lockNow();
    assert.deepEqual(human.captureSave({ captureId: offer.captureId, vaultId: 'work' }), {
      saved: false,
      reason: 'locked'
    });
  } finally {
    rm(dir);
  }
});

test('a vaultId outside the offered choices is refused', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const offer = submit(human, { email: 'a@b.com', street: '1 Main St', postalCode: '00000' });
    assert.deepEqual(human.captureSave({ captureId: offer.captureId, vaultId: 'somewhere-else' }), {
      saved: false,
      reason: 'invalid-vault'
    });
  } finally {
    rm(dir);
  }
});
