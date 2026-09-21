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
    assert.equal(released.length, 1, 'exactly one login offer released — the array-of-one contract (M21 F3 L2, AC2)');
    assert.equal(released[0].model.username, 'b', 'the SECOND (superseding) gesture is what survives to settle');
  } finally {
    rm(dir);
  }
});

/* ----------------------------------------------------------- captureRelease */

test('captureRelease: nothing pending for the tab returns an EMPTY ARRAY (the ordinary case — most gestures/settles have no held record) — M21 F3 L2 AC2 contract update', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    assert.deepEqual(human.captureRelease(10), []);
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
    assert.equal(released.length, 1, 'M21 F3 L2 AC2: an array of one');
    assert.equal(released[0].model.mode, 'save');
    assert.equal(released[0].model.username, 'me@a');

    // Prove the password itself survived the hold→release hop correctly
    // (the pending record's Buffer is COPIED before it is dropped, never
    // handed straight to `capture()` — the aliasing hazard the leg's own
    // implementation note calls out) by actually saving it and reading it
    // back from the store.
    const saved = human.captureSave({ captureId: released[0].captureId, vaultId: 'work' });
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
    assert.equal(released.length, 1, 'M21 F3 L2 AC2: an array of one');
    assert.equal(
      released[0].model.origin,
      A,
      'disposition used the ORIGIN CAPTURED AT GESTURE TIME, never re-derived at settle'
    );
    assert.equal(
      released[0].model.mode,
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
    assert.equal(released.length, 1, 'M21 F3 L2 AC2: an array of one');
    assert.equal(released[0].model.mode, 'locked');

    await store.unlock(MASTER);
    const finalized = human.captureFinalize(released[0].captureId);
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
    assert.equal(released.length, 1, 'M21 F3 L2 AC2: an array of one');
    assert.equal(
      released[0].model.mode,
      'save',
      'DD3c: detected-but-unprovenanced username must NEVER reach the update branch, even though null matches the stored null-username item'
    );
    assert.equal(released[0].model.defaultVaultId, 'work');
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
    assert.equal(released.length, 1, 'M21 F3 L2 AC2: an array of one');
    assert.equal(
      released[0].model.mode,
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
    assert.equal(released.length, 1, 'M21 F3 L2 AC2: an array of one');
    assert.equal(released[0].model.mode, 'locked');

    await store.unlock(MASTER);
    const finalized = human.captureFinalize(released[0].captureId);
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
    assert.equal(released.length, 1, 'M21 F3 L2 AC2: an array of one');
    assert.equal(released[0].model.kind, 'card');
    assert.equal(released[0].model.mode, 'save');
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
    assert.deepEqual(released, [], 'release drops an implausible number — never offered (M21 F3 L2 AC2: empty array)');
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
    assert.deepEqual(human.captureRelease(10), [], 'nothing left to release after the drop');
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
    assert.deepEqual(human.captureRelease(10), [], 'the TTL drop leaves nothing to release — never an offer');
  } finally {
    rm(dir);
  }
});

/* --------------------------------- multi-hold (M21 F3 L2, DD1's amendment) --- */

test('AC1: supersession is family-scoped — a login hold and a card hold coexist on one tab; a SECOND login gesture evicts only the login record and leaves the card record intact', async () => {
  const dir = tmpDir();
  try {
    const { human, timer } = await makeHarness(dir);
    human.holdGestureLogin({ wcId: 10, username: 'a', usernameDetected: true, passwordBytes: bytesOf('p1') });
    human.holdGestureCard({
      wcId: 10,
      numberBytes: bytesOf('4111111111111111'),
      cvvBytes: bytesOf('123'),
      cardholder: 'Ada Lovelace',
      expiry: '12/28'
    });
    assert.equal(timer.pending.size, 2, 'both families hold independently — two live drop timers');

    // A SECOND login gesture must evict only the FIRST login hold, never the card.
    human.holdGestureLogin({ wcId: 10, username: 'b', usernameDetected: true, passwordBytes: bytesOf('p2') });
    assert.equal(
      timer.pending.size,
      2,
      "the superseded login's timer was cleared and a new one armed — the card's is untouched"
    );

    const released = human.captureRelease(10);
    assert.equal(released.length, 2, 'AC1: BOTH the surviving login offer and the untouched card offer release');
    const cardOffer = released.find((o) => o.model.kind === 'card');
    const loginOffer = released.find((o) => o.model.kind !== 'card');
    assert.ok(cardOffer, 'the card offer survived the second login gesture');
    assert.ok(loginOffer, 'the login offer released too');
    assert.equal(
      loginOffer.model.username,
      'b',
      'the SECOND (superseding) login gesture is what survives — same-family last-wins is unchanged'
    );
  } finally {
    rm(dir);
  }
});

// AC1b's two tests below deliberately go further than merely reading the RETURNED
// offer models (which are plain data captured synchronously — they would look intact
// even if the underlying held record had ALREADY been zeroized+dropped by a
// family-blind sibling loop moments later). Each test SAVES both offers and reads
// the persisted items back, so it actually bites the specific `captureCard` bug
// (`:765-767`'s loop variable is `prior`, not `rec`) that a bare `released.length`
// check does not: proven live — reverting captureCard's family scope back to
// `if (prior.wcId === wcId) dropCapture(id)` leaves `released.length` at 2 in BOTH
// orders (the returned models are unaffected), but the LOGIN-then-CARD order's
// login save then fails (`{ saved: false }`, the record was zeroized by the card's
// own re-entrant supersession loop moments after being created) — exactly the class
// of defect a shallow assertion would miss.

test("AC1b: releasing a LOGIN-then-CARD pair — both offers actually SAVE (captureCard's own family-scoped loop must not zeroize the login record capture() just created in the same synchronous captureRelease pass)", async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    human.holdGestureLogin({
      wcId: 10,
      username: 'me@a',
      usernameDetected: true,
      passwordBytes: bytesOf('hunter2')
    });
    human.holdGestureCard({
      wcId: 10,
      numberBytes: bytesOf('4111111111111111'),
      cvvBytes: bytesOf('123'),
      cardholder: 'Ada Lovelace',
      expiry: '12/28'
    });

    const released = human.captureRelease(10);
    assert.equal(released.length, 2, "AC1b: login-then-card order — both offers survive captureRelease's own re-entry");
    const cardOffer = released.find((o) => o.model.kind === 'card');
    const loginOffer = released.find((o) => o.model.kind !== 'card');

    // The bite: SAVE both, not just read the returned model — a zeroized-and-dropped
    // held record fails to save even though the earlier-returned model still "looks" fine.
    assert.deepEqual(
      human.captureSave({ captureId: loginOffer.captureId, vaultId: 'work' }),
      { saved: true },
      'the login record must still exist to save — NOT zeroized by the card release that followed it'
    );
    assert.deepEqual(human.captureSave({ captureId: cardOffer.captureId, vaultId: 'work' }), { saved: true });
    const items = store.listItems('work');
    assert.equal(items.find((it) => it.type === 'login')?.password, 'hunter2');
    assert.equal(items.find((it) => it.type === 'card')?.number, '4111111111111111');
  } finally {
    rm(dir);
  }
});

test('AC1b: releasing a CARD-then-LOGIN pair — both offers actually SAVE (the reverse gesture order)', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    human.holdGestureCard({
      wcId: 10,
      numberBytes: bytesOf('4111111111111111'),
      cvvBytes: bytesOf('123'),
      cardholder: 'Ada Lovelace',
      expiry: '12/28'
    });
    human.holdGestureLogin({
      wcId: 10,
      username: 'me@a',
      usernameDetected: true,
      passwordBytes: bytesOf('hunter2')
    });

    const released = human.captureRelease(10);
    assert.equal(released.length, 2, 'AC1b: card-then-login order — both offers survive');
    const cardOffer = released.find((o) => o.model.kind === 'card');
    const loginOffer = released.find((o) => o.model.kind !== 'card');

    assert.deepEqual(human.captureSave({ captureId: cardOffer.captureId, vaultId: 'work' }), { saved: true });
    assert.deepEqual(
      human.captureSave({ captureId: loginOffer.captureId, vaultId: 'work' }),
      { saved: true },
      'the login record must still exist to save — never evicted even earlier by the card path'
    );
    const items = store.listItems('work');
    assert.equal(items.find((it) => it.type === 'login')?.password, 'hunter2');
    assert.equal(items.find((it) => it.type === 'card')?.number, '4111111111111111');
  } finally {
    rm(dir);
  }
});

test("AC3: captureRelease's own re-entry cannot evict its sibling — releasing two families in one call returns BOTH offers with the actual typed secrets intact", async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    human.holdGestureLogin({
      wcId: 10,
      username: 'me@a',
      usernameDetected: true,
      passwordBytes: bytesOf('hunter2')
    });
    human.holdGestureCard({
      wcId: 10,
      numberBytes: bytesOf('4111111111111111'),
      cvvBytes: bytesOf('123'),
      cardholder: 'Ada Lovelace',
      expiry: '12/28'
    });

    const released = human.captureRelease(10);
    assert.equal(released.length, 2, 'AC3: one call, two families, two offers');
    const cardOffer = released.find((o) => o.model.kind === 'card');
    const loginOffer = released.find((o) => o.model.kind !== 'card');

    const savedLogin = human.captureSave({ captureId: loginOffer.captureId, vaultId: 'work' });
    assert.deepEqual(savedLogin, { saved: true });
    const savedCard = human.captureSave({ captureId: cardOffer.captureId, vaultId: 'work' });
    assert.deepEqual(savedCard, { saved: true });

    const items = store.listItems('work');
    const login = items.find((it) => it.type === 'login');
    const card = items.find((it) => it.type === 'card');
    assert.equal(login.username, 'me@a');
    assert.equal(login.password, 'hunter2', 'the login password was never zeroized by the sibling card release');
    assert.equal(card.number, '4111111111111111', 'the card number was never zeroized by the sibling login release');
  } finally {
    rm(dir);
  }
});

test("AC11: the three bulk drops (tab close / window close / vault lock) already cover BOTH families for one tab, and each record's own CAPTURE_DROP_MS timer still fires independently", async () => {
  const dir = tmpDir();
  try {
    const { human, timer } = await makeHarness(dir);
    human.holdGestureLogin({ wcId: 10, username: 'a', usernameDetected: true, passwordBytes: bytesOf('pw') });
    human.holdGestureCard({
      wcId: 10,
      numberBytes: bytesOf('4111111111111111'),
      cvvBytes: bytesOf('123'),
      cardholder: 'Ada',
      expiry: '12/28'
    });
    assert.equal(timer.pending.size, 2, 'two independent per-record drop timers');

    const dropped = human.dropCapturesForTab(10);
    assert.equal(dropped.length, 2, 'AC11: dropCapturesForTab drops BOTH families for the tab, family-blind by design');
    assert.ok(dropped.every((r) => r.mode === 'pending-settle'));
    assert.ok(
      dropped.every((r) => allZero(r.kind === 'card' ? r.number : r.password)),
      'every dropped record is zeroized'
    );
    assert.equal(timer.pending.size, 0, 'both timers cleared');
    assert.deepEqual(human.captureRelease(10), [], 'nothing left to release for either family after the bulk drop');
  } finally {
    rm(dir);
  }
});

test('AC11: dropAllCaptures (vault lock) also covers both families for one tab', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    human.holdGestureLogin({ wcId: 10, username: 'a', usernameDetected: true, passwordBytes: bytesOf('pw') });
    human.holdGestureCard({
      wcId: 10,
      numberBytes: bytesOf('4111111111111111'),
      cvvBytes: bytesOf('123'),
      cardholder: 'Ada',
      expiry: '12/28'
    });
    const dropped = human.dropAllCaptures();
    assert.equal(dropped.length, 2, 'AC11: dropAllCaptures drops BOTH families');
  } finally {
    rm(dir);
  }
});
