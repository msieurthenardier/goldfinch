'use strict';

// Leg 1 (capture-hold-safety, flight "The Save Moment" / DD5) — a held capture
// record must not outlive the three conditions that should invalidate it: a
// vault lock (manual OR idle autolock), the owning window's close, or the
// owning tab's close. Today a capture becomes an offer within milliseconds, so
// these gaps are latent; Leg 4 widens the hold window to up to two minutes,
// which is why this leg fixes the safety valve first.
//
// Covers:
//   - vault-human.js's three bulk-drop functions (dropCapturesForTab /
//     dropCapturesForWindow / dropAllCaptures), all delegating to the single
//     dropCapture zeroizing choke point, each scoped correctly and each
//     returning the records it dropped — the ONLY way a test can reach a
//     record's secret buffer, since capture()/captureCard() copy the caller's
//     bytes and wipe the caller's own array immediately.
//   - Zeroization verified by READING the returned Buffer after the drop and
//     asserting all-zero bytes, for password, number, and cvv.
//   - Both vault-lock routes (manual lockNow() and the idle autolock timer,
//     vault-close-on-lock.test.js idiom) actually reach dropAllCaptures.
//   - The captureSave reorder (locked-check BEFORE the record lookup): a
//     record already dropped by a lock, with the vault still locked, reports
//     the actionable {reason:'locked'} — not the generic {saved:false}.
//   - The tab-close wiring in register-tab-ipc.js, including the ONE finding
//     that would otherwise ship a dead safety path with no failing test: the
//     vaultHuman dep MUST be a getter closure resolved lazily at call time,
//     not a value captured once at registerTabIpc(deps) construction.
//
// Electron-free (the vault-capture.test.js / vault-close-on-lock.test.js
// FAST-scrypt + temp-dir pattern).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const vs = require('../../src/main/vault/vault-store');
const { createVaultHuman } = require('../../src/main/vault/vault-human');
const { registerTabIpc } = require('../../src/main/register-tab-ipc');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';
const JARS = [
  { id: 'work', partition: 'persist:container:work' },
  { id: 'personal', partition: 'persist:container:personal' }
];
const A = 'https://a.example';
const VISA = '4242424242424242';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-capture-drop-safety-'));
}
function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
function bytesOf(str) {
  return new TextEncoder().encode(str);
}
function enc(str) {
  return new TextEncoder().encode(str);
}
function allZero(buf) {
  return buf.length > 0 && [...buf].every((b) => b === 0);
}

// A controllable injected timer (vault-capture.test.js idiom): setTimeout
// records the callback (no wall clock); fireAll runs every pending callback.
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

// A real, set-up, unlocked store + a createVaultHuman wired to fakes, spanning
// TWO windows so per-window scoping is provable: window 1 owns wcIds [10, 11],
// window 2 owns wcId [20]. wcId 30 has no tabWcIdsForChrome membership (dead /
// unresolved) for the "unresolved chrome id" case.
async function makeHarness(dir, { setup = true } = {}) {
  const timer = makeTimer();
  const store = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => JARS });
  if (setup) await store.setup({ masterPassword: MASTER });

  const urls = { 10: A + '/login', 11: A + '/login', 20: A + '/login' };
  const entries = new Map([
    [10, { partition: 'persist:container:work', trusted: false }],
    [11, { partition: 'persist:container:work', trusted: false }],
    [20, { partition: 'persist:container:work', trusted: false }]
  ]);
  const windowTabs = { 1: [10, 11], 2: [20] };

  const human = createVaultHuman({
    getVaultStore: () => store,
    fromId: (id) => (urls[id] != null ? { getURL: () => urls[id] } : null),
    getTabEntry: (id) => entries.get(id),
    listJars: () => JARS,
    fillDelegate: () => {},
    fillCardDelegate: () => {},
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout,
    now: () => 1000,
    tabWcIdsForChrome: (chromeId) => windowTabs[chromeId] || []
  });
  return { store, human, timer };
}

/* ---------------------------------------------------------- dropCapturesForTab */

test('dropCapturesForTab: drops only the named tab’s capture; a sibling tab in the SAME window survives', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const offerA = human.capture({ wcId: 10, username: 'a@a', passwordBytes: bytesOf('secret-a') });
    const offerB = human.capture({ wcId: 11, username: 'b@a', passwordBytes: bytesOf('secret-b') });
    assert.ok(offerA && offerB, 'both tabs captured an offer');

    const dropped = human.dropCapturesForTab(10);
    assert.equal(dropped.length, 1);
    assert.equal(dropped[0].wcId, 10);
    assert.ok(allZero(dropped[0].password), 'dropped record’s password buffer reads all-zero');

    // Tab 10's record is gone: a save now reports the generic no-record outcome.
    assert.deepEqual(human.captureSave({ captureId: offerA.captureId, vaultId: 'work' }), { saved: false });
    // Tab 11's sibling record is untouched: it can still be saved.
    assert.deepEqual(human.captureSave({ captureId: offerB.captureId, vaultId: 'work' }), { saved: true });
  } finally {
    rm(dir);
  }
});

test('dropCapturesForTab: idempotent — dropping an already-empty tab returns []', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    assert.deepEqual(human.dropCapturesForTab(10), []);
  } finally {
    rm(dir);
  }
});

test('dropCapturesForTab: a CARD capture zeroizes number AND cvv, not just password', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const offer = human.captureCard({
      wcId: 10,
      numberBytes: enc(VISA),
      cvvBytes: enc('123'),
      cardholder: 'Ada Lovelace',
      expiry: '12/28'
    });
    assert.ok(offer, 'card captured an offer');

    const [dropped] = human.dropCapturesForTab(10);
    assert.ok(dropped, 'the card record was dropped');
    assert.ok(allZero(dropped.number), 'PAN buffer reads all-zero after drop');
    assert.ok(allZero(dropped.cvv), 'CVV buffer reads all-zero after drop');
  } finally {
    rm(dir);
  }
});

/* ------------------------------------------------------- dropCapturesForWindow */

test('dropCapturesForWindow: drops only that window’s captures; a second window survives', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const offerWin1a = human.capture({ wcId: 10, username: 'a1@a', passwordBytes: bytesOf('pw1') });
    const offerWin1b = human.capture({ wcId: 11, username: 'a2@a', passwordBytes: bytesOf('pw2') });
    const offerWin2 = human.capture({ wcId: 20, username: 'b@a', passwordBytes: bytesOf('pw3') });
    assert.ok(offerWin1a && offerWin1b && offerWin2);

    const dropped = human.dropCapturesForWindow(1);
    assert.equal(dropped.length, 2);
    assert.deepEqual(dropped.map((r) => r.wcId).sort(), [10, 11]);
    for (const rec of dropped) assert.ok(allZero(rec.password), `wcId ${rec.wcId} password buffer reads all-zero`);

    // Window 1's records are gone.
    assert.deepEqual(human.captureSave({ captureId: offerWin1a.captureId, vaultId: 'work' }), { saved: false });
    assert.deepEqual(human.captureSave({ captureId: offerWin1b.captureId, vaultId: 'work' }), { saved: false });
    // Window 2's record survives, proven by successfully saving it.
    assert.deepEqual(human.captureSave({ captureId: offerWin2.captureId, vaultId: 'work' }), { saved: true });
  } finally {
    rm(dir);
  }
});

test('dropCapturesForWindow: an unresolved / dead chrome id drops nothing and never throws', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const offer = human.capture({ wcId: 10, username: 'a@a', passwordBytes: bytesOf('pw') });
    assert.ok(offer);

    let dropped;
    assert.doesNotThrow(() => {
      dropped = human.dropCapturesForWindow(999);
    });
    assert.deepEqual(dropped, []);
    // The real record is unaffected.
    assert.deepEqual(human.captureSave({ captureId: offer.captureId, vaultId: 'work' }), { saved: true });
  } finally {
    rm(dir);
  }
});

test('dropCapturesForWindow: an OMITTED tabWcIdsForChrome dep resolves no tabs, never throws (no force-construct hazard)', async () => {
  const dir = tmpDir();
  try {
    const store = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => JARS });
    await store.setup({ masterPassword: MASTER });
    const human = createVaultHuman({
      getVaultStore: () => store,
      fromId: (id) => (id === 10 ? { getURL: () => A + '/login' } : null),
      getTabEntry: (id) => (id === 10 ? { partition: 'persist:container:work', trusted: false } : null),
      listJars: () => JARS,
      fillDelegate: () => {}
      // tabWcIdsForChrome deliberately omitted.
    });
    human.capture({ wcId: 10, username: 'a@a', passwordBytes: bytesOf('pw') });
    assert.deepEqual(human.dropCapturesForWindow(1), []);
  } finally {
    rm(dir);
  }
});

/* -------------------------------------------------------------- dropAllCaptures */

test('dropAllCaptures: drops every held capture across every tab and window', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    human.capture({ wcId: 10, username: 'a@a', passwordBytes: bytesOf('pw1') });
    human.capture({ wcId: 11, username: 'b@a', passwordBytes: bytesOf('pw2') });
    human.capture({ wcId: 20, username: 'c@a', passwordBytes: bytesOf('pw3') });

    const dropped = human.dropAllCaptures();
    assert.equal(dropped.length, 3);
    for (const rec of dropped) assert.ok(allZero(rec.password));
  } finally {
    rm(dir);
  }
});

test('dropAllCaptures: an empty captures map is a safe no-op ([], never throws)', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    assert.deepEqual(human.dropAllCaptures(), []);
  } finally {
    rm(dir);
  }
});

/* ------------------------------------------------------------------ TTL still drops */

test('TTL remains a DROP, never an offer — firing the injected timer with the bulk-drop API present still just evicts', async () => {
  const dir = tmpDir();
  try {
    const { human, timer } = await makeHarness(dir);
    const offer = human.capture({ wcId: 10, username: 'a@a', passwordBytes: bytesOf('pw') });
    assert.ok(offer);
    assert.equal(timer.pending.size, 1);

    timer.fireAll();

    assert.equal(timer.pending.size, 0);
    // The record is gone — no offer resurfaces; a save degrades to the generic outcome.
    assert.deepEqual(human.captureSave({ captureId: offer.captureId, vaultId: 'work' }), { saved: false });
  } finally {
    rm(dir);
  }
});

/* ------------------------------------------------------ vault-lock wiring (both routes) */

test('a vault lock (manual lockNow()) reaches dropAllCaptures and zeroizes the held record', async () => {
  const dir = tmpDir();
  try {
    let human;
    let droppedByLock = null;
    const store = vs.load(dir, {
      scryptParams: FAST_SCRYPT,
      getAutoLockMinutes: () => 10,
      listJars: () => JARS,
      // Faithful transcription of main.js's onLock addition (Leg 1): the
      // surrounding _pendingVaultImports/_pendingBrowserImports/sheet-close
      // calls are main.js composition, pinned separately by
      // vault-close-on-lock.test.js; this suite's job is only to prove the
      // vault-human half of that same wiring.
      onLock: () => {
        droppedByLock = human.dropAllCaptures();
      }
    });
    await store.setup({ masterPassword: MASTER });

    human = createVaultHuman({
      getVaultStore: () => store,
      fromId: (id) => (id === 10 ? { getURL: () => A + '/login' } : null),
      getTabEntry: (id) => (id === 10 ? { partition: 'persist:container:work', trusted: false } : null),
      listJars: () => JARS,
      fillDelegate: () => {}
    });

    const offer = human.capture({ wcId: 10, username: 'a@a', passwordBytes: bytesOf('pw') });
    assert.ok(offer, 'captured while unlocked');

    store.lockNow(); // main.js's vaultLockNow() calls exactly this

    assert.equal(store.isUnlocked(), false);
    assert.equal(droppedByLock?.length, 1, 'onLock actually called dropAllCaptures');
    assert.ok(allZero(droppedByLock[0].password), 'the held password reads all-zero after the lock');
  } finally {
    rm(dir);
  }
});

test('a vault lock via the IDLE AUTOLOCK TIMER (never through the manual lockNow() wrapper) ALSO drops every held capture', async () => {
  const dir = tmpDir();
  try {
    let human;
    let droppedByLock = null;
    let armed = null;
    const store = vs.load(dir, {
      scryptParams: FAST_SCRYPT,
      getAutoLockMinutes: () => 5,
      listJars: () => JARS,
      setTimeout: (fn, ms) => {
        armed = { fn, ms };
        return 'token';
      },
      clearTimeout: () => {},
      onLock: () => {
        droppedByLock = human.dropAllCaptures();
      }
    });
    await store.setup({ masterPassword: MASTER });

    human = createVaultHuman({
      getVaultStore: () => store,
      fromId: (id) => (id === 10 ? { getURL: () => A + '/login' } : null),
      getTabEntry: (id) => (id === 10 ? { partition: 'persist:container:work', trusted: false } : null),
      listJars: () => JARS,
      fillDelegate: () => {}
    });

    const offer = human.capture({ wcId: 10, username: 'a@a', passwordBytes: bytesOf('pw') });
    assert.ok(offer);
    assert.ok(armed, 'setup arms the idle timer');

    // Fire the idle timer directly — vault-store.js's OWN internal path
    // (vault-store.js's lockNow() call from inside the module), never touching
    // main.js's manual vaultLockNow() wrapper / store.lockNow() at all.
    armed.fn();

    assert.equal(store.isUnlocked(), false, 'the idle timer actually locked the store');
    assert.equal(droppedByLock?.length, 1, 'the idle-timer lock ALSO reached dropAllCaptures');
    assert.ok(allZero(droppedByLock[0].password));
  } finally {
    rm(dir);
  }
});

/* ---------------------------------------------------- captureSave reorder (Guidance 6) */

test("captureSave: a record already dropped by a LOCK, with the vault still locked, reports {reason:'locked'} — not the generic failure", async () => {
  const dir = tmpDir();
  try {
    let human;
    const store = vs.load(dir, {
      scryptParams: FAST_SCRYPT,
      getAutoLockMinutes: () => 10,
      listJars: () => JARS,
      onLock: () => {
        human.dropAllCaptures();
      }
    });
    await store.setup({ masterPassword: MASTER });

    human = createVaultHuman({
      getVaultStore: () => store,
      fromId: (id) => (id === 10 ? { getURL: () => A + '/login' } : null),
      getTabEntry: (id) => (id === 10 ? { partition: 'persist:container:work', trusted: false } : null),
      listJars: () => JARS,
      fillDelegate: () => {}
    });

    const offer = human.capture({ wcId: 10, username: 'a@a', passwordBytes: bytesOf('pw') });
    assert.ok(offer, 'captured while unlocked');

    store.lockNow(); // drops the held record via onLock, above
    assert.equal(store.isUnlocked(), false);

    // This is the case existing coverage (vault-capture.test.js's idle-lock-race
    // test) does NOT exercise: there, the record is still PRESENT when the lock
    // is checked. Here the record is ALREADY GONE — without the Guidance 6
    // reorder, a bare `!rec` check would win first and degrade to the generic
    // `{ saved: false }`, silently dropping the actionable "locked" copy the
    // chrome shows on the still-open vault-capture sheet (vault-capture is
    // deliberately outside the close-on-lock allowlist, so the sheet survives
    // the lock and a Save click can still land here).
    const result = human.captureSave({ captureId: offer.captureId, vaultId: 'work' });
    assert.deepEqual(result, { saved: false, reason: 'locked' });
  } finally {
    rm(dir);
  }
});

test('captureSave: unlocked-and-missing record is STILL the plain generic failure (the reorder does not change this case)', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    // Never captured anything — the vault stays unlocked.
    assert.deepEqual(human.captureSave({ captureId: 'never-existed', vaultId: 'work' }), { saved: false });
  } finally {
    rm(dir);
  }
});

/* --------------------------------------------------- tab-close wiring (register-tab-ipc) */

// A minimal register-tab-ipc harness, trimmed to what the tab-close path
// touches (the register-tab-ipc.test.js precedent). `opts.skipCapture: true`
// on every tab-close call sidesteps the closed-tab-stack capture block
// entirely, so this harness needs no jars/captureClosedTabEntry/closedTabStack
// fakes — the vaultHuman wiring is this suite's only concern here (the
// stack-capture call POINT itself is pinned by register-tab-ipc.test.js).
class FakeIpc {
  constructor() {
    this.handles = new Map();
    this.listeners = new Map();
  }
  handle(channel, fn) {
    this.handles.set(channel, fn);
  }
  on(channel, fn) {
    this.listeners.set(channel, fn);
  }
  send(channel, sender, ...args) {
    return this.listeners.get(channel)({ sender }, ...args);
  }
}

class FakeContents extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.destroyed = false;
  }
  isDestroyed() {
    return this.destroyed;
  }
  destroy() {
    this.destroyed = true;
  }
  getURL() {
    return `https://tab-${this.id}.test/`;
  }
  getTitle() {
    return `Tab ${this.id}`;
  }
}

function setupTabCloseHarness({ vaultHuman } = {}) {
  const ipcMain = new FakeIpc();
  const records = [];
  const registry = {
    records: () => records,
    getWindowForChrome: (sender) => records.find((r) => r.chromeView.webContents === sender) || null,
    getWindowForGuest: (wcId) => records.find((r) => r.tabViews.has(wcId)) || null
  };
  function makeRecord(id) {
    const chrome = new FakeContents(id * 10);
    const record = {
      win: { id, isDestroyed: () => false, contentView: { removeChildView: () => {} } },
      chromeView: { webContents: chrome },
      tabViews: new Map(),
      activeTabWcId: null,
      htmlFullscreen: null
    };
    records.push(record);
    return record;
  }
  function addTab(record, wcId) {
    const view = { webContents: new FakeContents(wcId) };
    record.tabViews.set(wcId, { view, partition: 'persist:jar-a', trusted: false, active: false });
    return view;
  }
  const deps = {
    ipcMain,
    registry,
    getHistoryRecorder: () => null,
    schedule: setTimeout,
    cancelScheduled: clearTimeout,
    logger: { warn() {}, error() {} },
    vaultHuman
  };
  registerTabIpc(deps);
  return { ipcMain, registry, makeRecord, addTab };
}

test('tab-close: calls vaultHuman().dropCapturesForTab(wcId) when the getter resolves a real instance', () => {
  const calls = [];
  const fakeHuman = { dropCapturesForTab: (wcId) => calls.push(wcId) };
  const h = setupTabCloseHarness({ vaultHuman: () => fakeHuman });
  const record = h.makeRecord(1);
  h.addTab(record, 100);

  h.ipcMain.send('tab-close', record.chromeView.webContents, 100, -1, { skipCapture: true });

  assert.deepEqual(calls, [100]);
});

test('tab-close: an OMITTED vaultHuman dep is a silent no-op, never throws (no force-construct hazard)', () => {
  const h = setupTabCloseHarness({ vaultHuman: undefined });
  const record = h.makeRecord(1);
  h.addTab(record, 100);

  assert.doesNotThrow(() => {
    h.ipcMain.send('tab-close', record.chromeView.webContents, 100, -1, { skipCapture: true });
  });
});

test('tab-close: a getter that currently resolves null is a silent no-op, never throws', () => {
  const h = setupTabCloseHarness({ vaultHuman: () => null });
  const record = h.makeRecord(1);
  h.addTab(record, 100);

  assert.doesNotThrow(() => {
    h.ipcMain.send('tab-close', record.chromeView.webContents, 100, -1, { skipCapture: true });
  });
});

test('tab-close: closing tab B does NOT drop tab A’s capture (scoped by wcId, single-arg call)', () => {
  const calls = [];
  const fakeHuman = { dropCapturesForTab: (wcId) => calls.push(wcId) };
  const h = setupTabCloseHarness({ vaultHuman: () => fakeHuman });
  const record = h.makeRecord(1);
  h.addTab(record, 100);
  h.addTab(record, 101);

  h.ipcMain.send('tab-close', record.chromeView.webContents, 101, -1, { skipCapture: true });

  assert.deepEqual(calls, [101], 'only the closed tab’s wcId was passed to the drop');
});

// THE regression this leg's design review specifically caught (round 2, HIGH):
// registerTabIpc(deps) is called ONCE at boot with a deps OBJECT LITERAL, while
// main.js's `_vaultHuman` is lazily memoized and still null at that moment. A
// VALUE-style dep (`vaultHuman: _vaultHuman`) would snapshot null PERMANENTLY,
// so a capture held in a tab closed later in the session — after vault-human
// was finally constructed by some other flow — would silently never be
// dropped. The fix is a GETTER CLOSURE resolved at CALL TIME. This test proves
// the lazy-resolution contract directly: the dep starts out resolving null (as
// it would at boot), is "constructed" afterward by reassigning the closed-over
// variable, and a LATER tab-close must observe the new value.
test('tab-close: the vaultHuman dep is resolved LAZILY at call time — a session where vault-human is constructed AFTER registerTabIpc still drops on later closes', () => {
  let liveHuman = null; // mirrors _vaultHuman === null at boot
  const calls = [];
  const h = setupTabCloseHarness({ vaultHuman: () => liveHuman });
  const record = h.makeRecord(1);
  h.addTab(record, 100);
  h.addTab(record, 101);

  // Close tab 100 BEFORE vault-human is ever constructed — must be a silent no-op.
  assert.doesNotThrow(() => {
    h.ipcMain.send('tab-close', record.chromeView.webContents, 100, -1, { skipCapture: true });
  });
  assert.deepEqual(calls, [], 'no drop call while vault-human was never constructed');

  // Now "construct" vault-human, exactly as getVaultHuman() would later in the
  // session (a fill, a pick, anything that force-constructs it).
  liveHuman = { dropCapturesForTab: (wcId) => calls.push(wcId) };

  // Close tab 101 AFTER — the getter closure must observe the live reference,
  // not a snapshot taken at registerTabIpc(deps) construction time.
  h.ipcMain.send('tab-close', record.chromeView.webContents, 101, -1, { skipCapture: true });
  assert.deepEqual(calls, [101], 'the drop reached vault-human once it existed — lazy resolution confirmed');
});
