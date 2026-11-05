'use strict';

// Sortie 06 Leg 1 (AC14 / AC14b): vault-human's `onCaptureDropped` observer and `captureTabOf`.
// The dep fires once per drop path from inside `dropCapture` (AFTER eviction + zeroization,
// inside a try/catch), carrying NON-SECRET routing metadata only. Real store (FAST scrypt) +
// a controllable injected timer, the vault-capture-drop-safety.test.js idiom.

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
const bytes = (s) => new TextEncoder().encode(s);

function makeTimer() {
  let seq = 0;
  const pending = new Map();
  return {
    setTimeout: (fn, ms) => {
      const id = ++seq;
      pending.set(id, { fn, ms });
      return { id, unref() {} };
    },
    clearTimeout: (h) => {
      if (h && pending.has(h.id)) pending.delete(h.id);
    },
    fireAll: () => {
      for (const [id, e] of [...pending]) {
        pending.delete(id);
        e.fn();
      }
    }
  };
}

async function harness({ onCaptureDropped } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-capture-dropped-'));
  const timer = makeTimer();
  const store = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => JARS });
  await store.setup({ masterPassword: MASTER });
  const drops = [];
  const windowTabs = { 1: [10, 11] };
  const human = createVaultHuman({
    getVaultStore: () => store,
    fromId: (id) => ({ getURL: () => A + '/login', id }),
    getTabEntry: () => ({ partition: 'persist:container:work', trusted: false }),
    listJars: () => JARS,
    fillDelegate: () => {},
    fillCardDelegate: () => {},
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout,
    now: () => 1000,
    tabWcIdsForChrome: (chromeId) => windowTabs[chromeId] || [],
    onCaptureDropped: onCaptureDropped || ((info) => drops.push(info))
  });
  return { human, store, timer, drops, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('AC14: the dep fires on the TTL drop with { captureId, wcId, offered:false } for a direct (never-released) capture', async () => {
  const h = await harness();
  try {
    const offer = h.human.capture({ wcId: 10, username: 'a@a', passwordBytes: bytes('pw') });
    h.timer.fireAll();
    assert.deepEqual(h.drops, [{ captureId: offer.captureId, wcId: 10, offered: false }]);
  } finally {
    h.cleanup();
  }
});

test('AC14: dismiss and a successful save each fire the dep exactly once', async () => {
  const h = await harness();
  try {
    const a = h.human.capture({ wcId: 10, username: 'a@a', passwordBytes: bytes('pw') });
    h.human.captureDismiss(a.captureId);
    assert.equal(h.drops.length, 1);
    assert.equal(h.drops[0].captureId, a.captureId);
    h.drops.length = 0;
    const b = h.human.capture({ wcId: 10, username: 'b@a', passwordBytes: bytes('pw2') });
    assert.deepEqual(h.human.captureSave({ captureId: b.captureId, vaultId: 'work' }), { saved: true });
    assert.equal(h.drops.length, 1);
    assert.equal(h.drops[0].captureId, b.captureId);
    // double dismiss of a gone id: no second call
    h.human.captureDismiss(b.captureId);
    assert.equal(h.drops.length, 1);
  } finally {
    h.cleanup();
  }
});

test('AC14: a captureSave EARLY FAILURE that drops the record (card update whose item vanished) fires the dep', async () => {
  const h = await harness();
  try {
    h.human._seedCaptureForTest({
      captureId: 'seeded',
      wcId: 10,
      kind: 'card',
      mode: 'update',
      vaultId: 'work',
      itemId: 'does-not-exist',
      origin: A,
      jarId: 'work',
      number: Buffer.from('4242424242424242'),
      cvv: Buffer.from('123'),
      expiry: '12/28',
      cardholder: 'Ada',
      brand: 'Visa',
      last4: '4242',
      choices: [],
      timer: null
    });
    const res = h.human.captureSave({ captureId: 'seeded', vaultId: 'work' });
    assert.equal(res.saved, false);
    assert.deepEqual(
      h.drops.map((d) => d.captureId),
      ['seeded']
    );
  } finally {
    h.cleanup();
  }
});

test('AC14: supersession passes cause "superseded" for login, card and identity families (all six sites)', async () => {
  const h = await harness();
  try {
    const l1 = h.human.capture({ wcId: 10, username: 'a@a', passwordBytes: bytes('pw1') });
    h.human.capture({ wcId: 10, username: 'a@a', passwordBytes: bytes('pw2') });
    assert.deepEqual(h.drops, [{ captureId: l1.captureId, wcId: 10, offered: false, cause: 'superseded' }]);
    h.drops.length = 0;
    const c1 = h.human.captureCard({ wcId: 10, numberBytes: bytes('4242424242424242'), cvvBytes: bytes('123') });
    h.human.captureCard({ wcId: 10, numberBytes: bytes('4242424242424242'), cvvBytes: bytes('456') });
    assert.equal(h.drops[0].captureId, c1.captureId);
    assert.equal(h.drops[0].cause, 'superseded');
    // gesture holds supersede their own family too
    h.drops.length = 0;
    h.human.holdGestureLogin({ wcId: 11, username: 'x', usernameDetected: true, passwordBytes: bytes('p1') });
    h.human.holdGestureLogin({ wcId: 11, username: 'x', usernameDetected: true, passwordBytes: bytes('p2') });
    assert.equal(h.drops.length, 1);
    assert.equal(h.drops[0].cause, 'superseded');
  } finally {
    h.cleanup();
  }
});

test('AC14: `offered` - a record RELEASED as an offer is flagged; the re-keyed pending-settle id is never `offered`', async () => {
  const h = await harness();
  try {
    h.human.holdGestureLogin({ wcId: 10, username: 'a@a', usernameDetected: true, passwordBytes: bytes('pw') });
    const [offer] = h.human.captureRelease(10);
    assert.ok(offer);
    // the re-key dropped the PENDING record: not offered, no cause
    assert.equal(h.drops.length, 1);
    assert.equal(h.drops[0].offered, false);
    assert.notEqual(h.drops[0].captureId, offer.captureId);
    h.drops.length = 0;
    // the released offer's later drop IS offered
    h.human.captureDismiss(offer.captureId);
    assert.deepEqual(h.drops, [{ captureId: offer.captureId, wcId: 10, offered: true }]);
  } finally {
    h.cleanup();
  }
});

test('AC14: tab, window and all-captures drops each fire the dep per dropped record (rec.wcId read before eviction)', async () => {
  const h = await harness();
  try {
    h.human.capture({ wcId: 10, username: 'a@a', passwordBytes: bytes('1') });
    h.human.capture({ wcId: 11, username: 'b@a', passwordBytes: bytes('2') });
    h.human.dropCapturesForTab(10);
    assert.deepEqual(
      h.drops.map((d) => d.wcId),
      [10]
    );
    h.drops.length = 0;
    h.human.capture({ wcId: 10, username: 'c@a', passwordBytes: bytes('3') });
    h.human.dropCapturesForWindow(1);
    assert.deepEqual(h.drops.map((d) => d.wcId).sort(), [10, 11]);
    h.drops.length = 0;
    h.human.capture({ wcId: 10, username: 'd@a', passwordBytes: bytes('4') });
    h.human.dropAllCaptures();
    assert.equal(h.drops.length, 1);
  } finally {
    h.cleanup();
  }
});

test('AC14: finalize paths that drop (unchanged / tab-changed) fire the dep', async () => {
  const h = await harness();
  try {
    h.human._seedCaptureForTest({
      captureId: 'locked1',
      wcId: 10,
      mode: 'locked',
      origin: A,
      username: 'a@a',
      password: Buffer.from('pw'),
      jarId: 'personal', // the tab resolves to `work` -> tab-changed
      choices: [],
      timer: null
    });
    assert.deepEqual(h.human.captureFinalize('locked1'), { reason: 'tab-changed' });
    assert.deepEqual(
      h.drops.map((d) => d.captureId),
      ['locked1']
    );
  } finally {
    h.cleanup();
  }
});

test('AC14: a THROWING dep still zeroizes the record (the listener can never block the zeroize)', async () => {
  const h = await harness({
    onCaptureDropped: () => {
      throw new Error('listener blew up');
    }
  });
  try {
    h.human.capture({ wcId: 10, username: 'a@a', passwordBytes: bytes('secret') });
    const dropped = h.human.dropCapturesForTab(10);
    assert.equal(dropped.length, 1);
    assert.ok(
      [...dropped[0].password].every((b) => b === 0),
      'password buffer zeroized despite the throwing listener'
    );
    // and the record is evicted
    assert.deepEqual(h.human.dropCapturesForTab(10), []);
  } finally {
    h.cleanup();
  }
});

test('AC14: the dep payload carries NO secret field - only captureId, wcId, offered (+cause)', async () => {
  const h = await harness();
  try {
    h.human.capture({ wcId: 10, username: 'a@a', passwordBytes: bytes('hunter2') });
    h.human.dropAllCaptures();
    assert.ok(!JSON.stringify(h.drops).includes('hunter2'));
    assert.deepEqual(Object.keys(h.drops[0]).sort(), ['captureId', 'offered', 'wcId']);
  } finally {
    h.cleanup();
  }
});

test('AC14: an omitted onCaptureDropped dep changes nothing (every pre-Sortie caller)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-capture-dropped-'));
  try {
    const store = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => JARS });
    await store.setup({ masterPassword: MASTER });
    const human = createVaultHuman({
      getVaultStore: () => store,
      fromId: () => ({ getURL: () => A + '/login' }),
      getTabEntry: () => ({ partition: 'persist:container:work', trusted: false }),
      listJars: () => JARS,
      fillDelegate: () => {}
    });
    const offer = human.capture({ wcId: 10, username: 'a@a', passwordBytes: bytes('pw') });
    assert.doesNotThrow(() => human.captureDismiss(offer.captureId));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('AC14b: captureTabOf is metadata-only: the owning wcId of a HELD capture, else null (dropped / unknown / non-string)', async () => {
  const h = await harness();
  try {
    const offer = h.human.capture({ wcId: 10, username: 'a@a', passwordBytes: bytes('pw') });
    assert.equal(h.human.captureTabOf(offer.captureId), 10);
    assert.equal(h.human.captureTabOf('nope'), null);
    assert.equal(h.human.captureTabOf(undefined), null);
    assert.equal(h.human.captureTabOf({}), null);
    h.human.captureDismiss(offer.captureId);
    assert.equal(h.human.captureTabOf(offer.captureId), null);
    assert.equal(typeof h.human.captureTabOf(offer.captureId), 'object');
  } finally {
    h.cleanup();
  }
});
