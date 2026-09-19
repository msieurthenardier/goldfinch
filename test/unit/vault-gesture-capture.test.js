'use strict';

// Integration tests for the GESTURE-TIME hold + SETTLE release machinery
// (Mission 21, Flight 1, Leg 5 — broadened-capture, DD3f/DD3c/DD4/DD5) added to
// createVaultHuman: holdGestureLogin / holdGestureCard / captureRelease, plus
// the DD3c post-dispose username downgrade threaded through both the direct
// `capture()`/`captureCard()` path and `captureFinalize`'s unlock-to-save
// continuation. Driven against a REAL vault store (the vault-capture.test.js /
// vault-human.test.js FAST-scrypt pattern) with a fake webContents whose URL is
// MUTABLE per wcId, so a test can change a tab's origin BETWEEN hold and
// release and assert the frozen-at-gesture-time origin is what disposition
// actually used (the Edge Case this leg's spec calls out explicitly).

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

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-gesture-capture-'));
}
function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
function bytesOf(str) {
  return new TextEncoder().encode(str);
}
function allZero(buf) {
  return buf.length > 0 && [...buf].every((b) => b === 0);
}

function makeTimer() {
  let seq = 0;
  const pending = new Map();
  return {
    pending,
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

/**
 * wcId 10 lives in the 'work' jar. Its URL is MUTABLE (`urls.set(10, ...)`),
 * so a test can navigate it between a gesture hold and a settle release.
 */
async function makeHarness(dir, { setup = true } = {}) {
  const timer = makeTimer();
  const store = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => JARS });
  if (setup) await store.setup({ masterPassword: MASTER });

  const urls = new Map([[10, A + '/login']]);
  const entries = new Map([[10, { partition: 'persist:container:work', trusted: false }]]);

  const human = createVaultHuman({
    getVaultStore: () => store,
    fromId: (id) => (urls.has(id) ? { getURL: () => urls.get(id) } : null),
    getTabEntry: (id) => entries.get(id),
    listJars: () => JARS,
    fillDelegate: () => {},
    fillCardDelegate: () => {},
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout,
    now: () => 1000
  });
  return { store, human, timer, urls };
}

/* ---------------------------------------------------------- holdGestureLogin */

test('holdGestureLogin: the GATE (set up + persistent jar + origin) drops silently and wipes the incoming bytes', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir, { setup: false }); // not set up
    const bytes = bytesOf('hunter2');
    const held = human.holdGestureLogin({ wcId: 10, username: 'me', usernameDetected: true, passwordBytes: bytes });
    assert.equal(held, null);
    assert.ok(allZero(bytes), 'the incoming password bytes are wiped even on a gate drop');
  } finally {
    rm(dir);
  }
});

test('holdGestureLogin: creates a held record with NO offer/model — nothing is disposed at hold time', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const held = human.holdGestureLogin({
      wcId: 10,
      username: 'me@a',
      usernameDetected: true,
      passwordBytes: bytesOf('hunter2')
    });
    assert.ok(held && typeof held.captureId === 'string');
    assert.deepEqual(Object.keys(held), ['captureId'], 'a hold returns ONLY a captureId — never a model to offer');
  } finally {
    rm(dir);
  }
});

test('holdGestureLogin: last-wins-per-tab supersession — a second gesture on the same tab drops the first held record', async () => {
  const dir = tmpDir();
  try {
    const { human, timer } = await makeHarness(dir);
    human.holdGestureLogin({ wcId: 10, username: 'a', usernameDetected: true, passwordBytes: bytesOf('p1') });
    assert.equal(timer.pending.size, 1);
    human.holdGestureLogin({ wcId: 10, username: 'b', usernameDetected: true, passwordBytes: bytesOf('p2') });
    assert.equal(
      timer.pending.size,
      1,
      "the first pending record's timer was cleared, not left armed alongside a second"
    );

    const released = human.captureRelease(10);
    assert.equal(released.model.username, 'b', 'the SECOND (superseding) gesture is what survives to settle');
  } finally {
    rm(dir);
  }
});

/* ----------------------------------------------------------- captureRelease */

test('captureRelease: nothing pending for the tab returns null (the ordinary case — most gestures/settles have no held record)', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    assert.equal(human.captureRelease(10), null);
  } finally {
    rm(dir);
  }
});

test('captureRelease: releases a held gesture into a real SAVE offer, with the actual typed password intact (no aliasing/zeroing bug)', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    human.holdGestureLogin({
      wcId: 10,
      username: 'me@a',
      usernameDetected: true,
      passwordBytes: bytesOf('hunter2')
    });
    const released = human.captureRelease(10);
    assert.ok(released);
    assert.equal(released.model.mode, 'save');
    assert.equal(released.model.username, 'me@a');

    // Prove the password itself survived the hold→release hop correctly
    // (the pending record's Buffer is COPIED before it is dropped, never
    // handed straight to `capture()` — the aliasing hazard the leg's own
    // implementation note calls out) by actually saving it and reading it
    // back from the store.
    const saved = human.captureSave({ captureId: released.captureId, vaultId: 'work' });
    assert.deepEqual(saved, { saved: true });
    const [item] = store.listItems('work');
    assert.equal(item.username, 'me@a');
    assert.equal(item.password, 'hunter2', 'the ACTUAL typed password reached the vault, not a zeroed/garbled copy');
  } finally {
    rm(dir);
  }
});

test('captureRelease: origin is FROZEN at gesture (hold) time — a tab navigated to a DIFFERENT origin before release still disposes against the ORIGINAL origin', async () => {
  const dir = tmpDir();
  try {
    const { store, human, urls } = await makeHarness(dir);
    // Pre-seed a stored login at ORIGIN A so a release there would UPDATE it.
    await store.saveItem('work', { type: 'login', title: 'a', origin: A, username: 'me@a', password: 'old' });

    human.holdGestureLogin({
      wcId: 10,
      username: 'me@a',
      usernameDetected: true,
      passwordBytes: bytesOf('new-real-password')
    });

    // Navigate the tab to a DIFFERENT origin BEFORE settle — simulates
    // did-navigate firing after the gesture's own navigation committed.
    urls.set(10, B + '/somewhere');

    const released = human.captureRelease(10);
    assert.ok(released);
    assert.equal(
      released.model.origin,
      A,
      'disposition used the ORIGIN CAPTURED AT GESTURE TIME, never re-derived at settle'
    );
    assert.equal(
      released.model.mode,
      'update',
      'matched the stored item at the frozen origin A, not a fresh lookup at B'
    );
  } finally {
    rm(dir);
  }
});

test('captureRelease: a LOCKED vault at settle holds mode "locked" — captureFinalize completes the deferred disposition afterward', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    human.holdGestureLogin({
      wcId: 10,
      username: 'me@a',
      usernameDetected: true,
      passwordBytes: bytesOf('hunter2')
    });
    store.lockNow();

    const released = human.captureRelease(10);
    assert.ok(released);
    assert.equal(released.model.mode, 'locked');

    await store.unlock(MASTER);
    const finalized = human.captureFinalize(released.captureId);
    assert.ok(finalized.captureId, 'captureFinalize completed the deferred disposition');
    assert.equal(finalized.model.mode, 'save');
  } finally {
    rm(dir);
  }
});

/* --------------------------------------------------------------- DD3c ------ */

test('DD3c: username DETECTED but UNPROVENANCED (usernameDetected:true, username:null) never takes the update branch — downgrades to save', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    // A stored NULL-username item at origin A (a genuine password-only login).
    await store.saveItem('work', { type: 'login', title: 'a', origin: A, username: null, password: 'stored-pw' });

    human.holdGestureLogin({
      wcId: 10,
      username: null,
      usernameDetected: true, // a username FIELD was detected on the page, but NOT provenanced
      passwordBytes: bytesOf('attacker-or-real-new-password')
    });
    const released = human.captureRelease(10);
    assert.ok(released);
    assert.equal(
      released.model.mode,
      'save',
      'DD3c: detected-but-unprovenanced username must NEVER reach the update branch, even though null matches the stored null-username item'
    );
    assert.equal(released.model.defaultVaultId, 'work');
  } finally {
    rm(dir);
  }
});

test('DD3c: NO username field detected at all (usernameDetected:false, username:null) preserves EXISTING null-username matching behaviour (update)', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    await store.saveItem('work', { type: 'login', title: 'a', origin: A, username: null, password: 'stored-pw' });

    human.holdGestureLogin({
      wcId: 10,
      username: null,
      usernameDetected: false, // no username field existed at all — the ordinary password-only case
      passwordBytes: bytesOf('a-real-new-password')
    });
    const released = human.captureRelease(10);
    assert.ok(released);
    assert.equal(
      released.model.mode,
      'update',
      'a genuine password-only submit still matches the stored null-username item'
    );
  } finally {
    rm(dir);
  }
});

test("DD3c downgrade also applies through captureFinalize's unlock-to-save continuation (locked at settle)", async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    await store.saveItem('work', { type: 'login', title: 'a', origin: A, username: null, password: 'stored-pw' });
    store.lockNow();

    human.holdGestureLogin({
      wcId: 10,
      username: null,
      usernameDetected: true, // detected-but-unprovenanced
      passwordBytes: bytesOf('new-password')
    });
    const released = human.captureRelease(10);
    assert.equal(released.model.mode, 'locked');

    await store.unlock(MASTER);
    const finalized = human.captureFinalize(released.captureId);
    assert.equal(
      finalized.model.mode,
      'save',
      'the downgrade fires on the deferred (unlock-to-save) path too, not only the immediate one'
    );
  } finally {
    rm(dir);
  }
});

/* ------------------------------------------------------------ card gesture -- */

test('holdGestureCard + captureRelease: a held card gesture releases into a real save offer (Luhn re-checked at release, not at hold)', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const held = human.holdGestureCard({
      wcId: 10,
      numberBytes: bytesOf('4111111111111111'),
      cvvBytes: bytesOf('123'),
      cardholder: 'Ada Lovelace',
      expiry: '12/28'
    });
    assert.ok(held);
    const released = human.captureRelease(10);
    assert.ok(released);
    assert.equal(released.model.kind, 'card');
    assert.equal(released.model.mode, 'save');
  } finally {
    rm(dir);
  }
});

test('holdGestureCard: an implausible number (fails Luhn) still HOLDS at gesture time — the plausibility gate is re-applied at RELEASE, which drops it', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const held = human.holdGestureCard({
      wcId: 10,
      numberBytes: bytesOf('1234567890123456'), // fails Luhn
      cvvBytes: bytesOf('123'),
      cardholder: 'Ada',
      expiry: '12/28'
    });
    assert.ok(held, 'held regardless — the plausibility gate lives in captureCard(), run at release');
    const released = human.captureRelease(10);
    assert.equal(released, null, 'release drops an implausible number — never offered');
  } finally {
    rm(dir);
  }
});

/* --------------------------------------------------- new held state: drop rules */

test('the new "pending-settle" held state is covered by dropCapturesForTab, exactly like every other mode', async () => {
  const dir = tmpDir();
  try {
    const { human, timer } = await makeHarness(dir);
    human.holdGestureLogin({ wcId: 10, username: 'a', usernameDetected: true, passwordBytes: bytesOf('pw') });
    const dropped = human.dropCapturesForTab(10);
    assert.equal(dropped.length, 1);
    assert.equal(dropped[0].mode, 'pending-settle');
    assert.ok(allZero(dropped[0].password));
    assert.equal(timer.pending.size, 0);
    assert.equal(human.captureRelease(10), null, 'nothing left to release after the drop');
  } finally {
    rm(dir);
  }
});

test('the new "pending-settle" held state is covered by dropAllCaptures (vault lock)', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    human.holdGestureLogin({ wcId: 10, username: 'a', usernameDetected: true, passwordBytes: bytesOf('pw') });
    const dropped = human.dropAllCaptures();
    assert.equal(dropped.length, 1);
    assert.equal(dropped[0].mode, 'pending-settle');
    assert.ok(allZero(dropped[0].password));
  } finally {
    rm(dir);
  }
});

test('the new "pending-settle" held state is covered by dropCapturesForWindow', async () => {
  const dir = tmpDir();
  try {
    const timer = makeTimer();
    const store = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => JARS });
    await store.setup({ masterPassword: MASTER });
    const human = createVaultHuman({
      getVaultStore: () => store,
      fromId: (id) => (id === 10 ? { getURL: () => A + '/login' } : null),
      getTabEntry: (id) => (id === 10 ? { partition: 'persist:container:work', trusted: false } : null),
      listJars: () => JARS,
      fillDelegate: () => {},
      setTimeout: timer.setTimeout,
      clearTimeout: timer.clearTimeout,
      tabWcIdsForChrome: (chromeId) => (chromeId === 1 ? [10] : [])
    });
    human.holdGestureLogin({ wcId: 10, username: 'a', usernameDetected: true, passwordBytes: bytesOf('pw') });
    const dropped = human.dropCapturesForWindow(1);
    assert.equal(dropped.length, 1);
    assert.equal(dropped[0].mode, 'pending-settle');
  } finally {
    rm(dir);
  }
});

test('the new "pending-settle" held state is STILL a DROP (never an offer) on TTL expiry (DD4)', async () => {
  const dir = tmpDir();
  try {
    const { human, timer } = await makeHarness(dir);
    human.holdGestureLogin({ wcId: 10, username: 'a', usernameDetected: true, passwordBytes: bytesOf('pw') });
    assert.equal(timer.pending.size, 1);
    timer.fireAll();
    assert.equal(timer.pending.size, 0);
    assert.equal(human.captureRelease(10), null, 'the TTL drop leaves nothing to release — never an offer');
  } finally {
    rm(dir);
  }
});
