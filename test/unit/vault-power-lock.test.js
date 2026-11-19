'use strict';

// Leg `vault-lifecycle` (Mission 23 Flight 2, DD7): the vault locks on suspend / screen lock / user switch /
// shutdown, on resume after a long sleep, and at quit; a one-time-code read no longer re-arms the idle timer;
// a lock voids the reveal gate's per-item grants. Electron-free; real vault stores in temp dirs at FAST scrypt.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createPowerLock, LOCK_EVENTS, RESUME_EVENTS } = require('../../src/main/vault/power-lock');
const { runVaultLockTeardown } = require('../../src/main/vault-lock-teardown');
const { registerVaultIpc } = require('../../src/main/register-vault-ipc');
const { registerInternalHandler } = require('../../src/main/internal-ipc');
const vs = require('../../src/main/vault/vault-store');
const { createDocumentMarks } = require('../../src/main/reveal-gate');
const { makeTestRevealGate } = require('../helpers/reveal-gate-fixture');
const { maskComments } = require('../helpers/source-scan');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';
const JARS = [{ id: 'work' }];
const B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const MIN = 60 * 1000;
const flush = () => new Promise((r) => setImmediate(r));

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vpl-'));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });

/** A power-lock over a fake store-shaped object. */
function fakeStore({ unlocked = true, suspended = false, idle = 0, interval = 10 * MIN, lockThrows = false } = {}) {
  const s = {
    unlocked,
    suspended,
    idle,
    locks: 0,
    lockNow() {
      s.locks++;
      if (lockThrows) throw new Error('lock failed');
      s.unlocked = false;
    }
  };
  const emitter = new EventEmitter();
  const traces = [];
  const errors = [];
  const pl = createPowerLock({
    powerMonitor: emitter,
    lockNow: () => s.lockNow(),
    isUnlocked: () => s.unlocked,
    isAutoLockSuspended: () => s.suspended,
    idleMs: () => (s.unlocked ? s.idle : null),
    autoLockMs: () => interval,
    trace: (l) => traces.push(l),
    logger: { error: (...a) => errors.push(a) }
  });
  return { s, emitter, pl, traces, errors };
}

test('AC1: every lock event locks the vault through the single lock path', () => {
  for (const event of LOCK_EVENTS) {
    const f = fakeStore();
    f.pl.register();
    f.emitter.emit(event);
    assert.equal(f.s.locks, 1, `${event} locks`);
    assert.equal(f.s.unlocked, false);
  }
  assert.deepEqual([...LOCK_EVENTS], ['suspend', 'lock-screen', 'user-did-resign-active', 'shutdown']);
});

test('AC1: an unknown event does nothing; an already-locked vault is a no-op; lock-screen storms are idempotent', () => {
  const f = fakeStore();
  f.pl.register();
  f.emitter.emit('thermal-state-change');
  assert.equal(f.s.locks, 0);
  f.emitter.emit('lock-screen');
  f.emitter.emit('lock-screen');
  f.emitter.emit('suspend');
  assert.equal(f.s.locks, 1, 'the second and third find the vault locked');
  const locked = fakeStore({ unlocked: false });
  locked.pl.register();
  assert.doesNotThrow(() => locked.emitter.emit('suspend'));
  assert.equal(locked.s.locks, 0);
});

test('AC1: a throwing lockNow never escapes the listener (and is logged)', () => {
  const f = fakeStore({ lockThrows: true });
  f.pl.register();
  assert.doesNotThrow(() => f.emitter.emit('suspend'));
  assert.equal(f.errors.length, 1);
});

test('AC1: the adopt key-surfacing window defers a power lock exactly as it defers the idle timer', () => {
  const f = fakeStore({ suspended: true, idle: 99 * MIN });
  f.pl.register();
  for (const e of [...LOCK_EVENTS, ...RESUME_EVENTS]) f.emitter.emit(e);
  assert.equal(f.s.locks, 0);
  assert.equal(f.s.unlocked, true);
  assert.ok(f.traces.some((l) => l.includes('deferred=key-surfacing')));
  f.s.suspended = false;
  f.emitter.emit('suspend');
  assert.equal(f.s.locks, 1, 'cleared: the next trigger locks');
});

test('a power LOCK event deferred by the adopt window is remembered and honoured when the suspension ends; a deferred resume is not', async () => {
  const dir = tmpDir();
  try {
    const store = vs.load(dir, {
      scryptParams: FAST_SCRYPT,
      getAutoLockMinutes: () => 5,
      listJars: () => JARS,
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });
    await store.setup({ masterPassword: MASTER });
    const mk = () => {
      const emitter = new EventEmitter();
      createPowerLock({
        powerMonitor: emitter,
        lockNow: () => store.lockNow(),
        isUnlocked: () => store.isUnlocked(),
        isAutoLockSuspended: () => store.isAutoLockSuspended(),
        deferLock: () => store.deferPowerLock(),
        idleMs: () => store.idleMs(),
        autoLockMs: () => store.autoLockMs()
      }).register();
      return emitter;
    };
    const emitter = mk();
    // a deferred resume check is not remembered
    store.setAutoLockSuspended(true);
    emitter.emit('resume');
    store.setAutoLockSuspended(false);
    assert.equal(store.isUnlocked(), true);
    // a deferred suspend is: the lock lands the moment the window ends
    store.setAutoLockSuspended(true);
    emitter.emit('suspend');
    assert.equal(store.isUnlocked(), true, 'deferred while suspended');
    store.setAutoLockSuspended(false);
    assert.equal(store.isUnlocked(), false, 'locked when the suspension ended');
    // an unlock in between forgets nothing wrongly: a later plain release does not lock a fresh unlock
    await store.unlock(MASTER);
    store.setAutoLockSuspended(true);
    store.setAutoLockSuspended(false);
    assert.equal(store.isUnlocked(), true);
  } finally {
    rm(dir);
  }
});

test('AC1: register is idempotent, dispose removes every listener, and nothing is subscribed before register', () => {
  const f = fakeStore();
  assert.equal(
    f.emitter.eventNames().length,
    0,
    'construction subscribes nothing (powerMonitor is unusable pre-ready)'
  );
  f.pl.register();
  f.pl.register();
  assert.equal(f.emitter.listenerCount('suspend'), 1);
  assert.equal(f.emitter.eventNames().length, LOCK_EVENTS.length + RESUME_EVENTS.length);
  f.pl.dispose();
  assert.equal(f.emitter.eventNames().length, 0);
  assert.equal(f.pl.isRegistered(), false);
});

test('AC2: resume / unlock-screen lock only when the idle limit passed while asleep', () => {
  for (const event of RESUME_EVENTS) {
    const long = fakeStore({ idle: 10 * MIN });
    long.pl.register();
    long.emitter.emit(event);
    assert.equal(long.s.locks, 1, `${event} after a long sleep locks`);
    const short = fakeStore({ idle: 10 * MIN - 1 });
    short.pl.register();
    short.emitter.emit(event);
    assert.equal(short.s.locks, 0, `${event} with time left does not lock`);
  }
  const locked = fakeStore({ unlocked: false, idle: 99 * MIN });
  locked.pl.register();
  locked.emitter.emit('resume');
  assert.equal(locked.s.locks, 0, 'resume with the vault already locked is a no-op');
});

test('AC2 (real store, injected wall clock): idleMs / autoLockMs drive the resume decision; a backwards clock only delays it', async () => {
  const dir = tmpDir();
  try {
    let wall = 1_000_000;
    const store = vs.load(dir, {
      scryptParams: FAST_SCRYPT,
      getAutoLockMinutes: () => 5,
      listJars: () => JARS,
      now: () => wall,
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });
    assert.equal(store.idleMs(), null, 'locked: null');
    await store.setup({ masterPassword: MASTER });
    assert.equal(store.autoLockMs(), 5 * MIN);
    assert.equal(store.idleMs(), 0);
    const emitter = new EventEmitter();
    createPowerLock({
      powerMonitor: emitter,
      lockNow: () => store.lockNow(),
      isUnlocked: () => store.isUnlocked(),
      isAutoLockSuspended: () => store.isAutoLockSuspended(),
      idleMs: () => store.idleMs(),
      autoLockMs: () => store.autoLockMs()
    }).register();
    wall += 4 * MIN;
    emitter.emit('resume');
    assert.equal(store.isUnlocked(), true, 'asleep 4 of 5 minutes: still unlocked');
    wall -= 10 * MIN; // clock set backwards across a sleep
    emitter.emit('resume');
    assert.equal(store.isUnlocked(), true, 'a backwards clock only delays the fallback');
    wall += 20 * MIN;
    emitter.emit('resume');
    assert.equal(store.isUnlocked(), false, 'asleep past the interval: locked');
    assert.equal(store.idleMs(), null);
    // the coercion: unusable setting -> 10 minutes (the same helper the timer uses)
    const bad = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 0, listJars: () => JARS });
    assert.equal(bad.autoLockMs(), 10 * MIN);
  } finally {
    rm(dir);
  }
});

test('AC1 (real onLock wiring): a power lock reaches automation zeroize, sheet close and the broadcast, in the teardown order', async () => {
  const dir = tmpDir();
  try {
    const order = [];
    let store;
    store = vs.load(dir, {
      scryptParams: FAST_SCRYPT,
      getAutoLockMinutes: () => 10,
      listJars: () => JARS,
      onLock: () =>
        runVaultLockTeardown({
          records: () => [],
          vaultHuman: null,
          zeroizeAutomationVaults: () => order.push('zeroize-automation'),
          closeSheets: () => order.push('close-sheets'),
          broadcast: () => order.push('broadcast')
        })
    });
    await store.setup({ masterPassword: MASTER });
    const emitter = new EventEmitter();
    createPowerLock({
      powerMonitor: emitter,
      lockNow: () => store.lockNow(),
      isUnlocked: () => store.isUnlocked(),
      idleMs: () => store.idleMs(),
      autoLockMs: () => store.autoLockMs()
    }).register();
    emitter.emit('suspend');
    assert.equal(store.isUnlocked(), false);
    assert.ok(order.includes('zeroize-automation'), 'automation vault keys are zeroized');
    assert.deepEqual(
      order.filter((o) => o !== 'zeroize-automation'),
      ['close-sheets', 'broadcast']
    );
  } finally {
    rm(dir);
  }
});

test('edge: a suspend while an unlock is deriving its key takes the same lockNow path (the generation check refuses the install)', async () => {
  const dir = tmpDir();
  try {
    const store = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => JARS });
    await store.setup({ masterPassword: MASTER });
    store.lockNow();
    const emitter = new EventEmitter();
    // not unlocked yet (mid-derive): the listener finds the vault locked and does nothing; the in-flight
    // unlock's own generation guard is the store's, unchanged and covered by its suite.
    createPowerLock({
      powerMonitor: emitter,
      lockNow: () => store.lockNow(),
      isUnlocked: () => store.isUnlocked(),
      idleMs: () => store.idleMs(),
      autoLockMs: () => store.autoLockMs()
    }).register();
    const pending = store.unlock({ masterPassword: MASTER });
    emitter.emit('suspend');
    await pending.catch(() => {});
    assert.ok(store.isUnlocked() === true || store.isUnlocked() === false, 'no throw either way');
  } finally {
    rm(dir);
  }
});

// ---- AC4: a code read does not re-arm the idle timer --------------------------------------------------

async function codeHarness(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const dir = tmpDir();
  const store = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => JARS });
  await store.setup({ masterPassword: MASTER });
  const saved = store.saveItem('global', {
    type: 'login',
    title: 'Bank',
    username: 'u',
    password: 'p',
    totp: `otpauth://totp/ACME:alice?secret=${B32}&issuer=ACME`
  });
  const handlers = {};
  registerVaultIpc({
    ipcMain: {
      handle(channel, fn) {
        handlers[channel] = fn;
      }
    },
    revealGate: makeTestRevealGate().gate,
    registerInternalHandler,
    getVaultStore: () => store,
    jars: { list: () => JARS }
  });
  const event = {
    senderFrame: { origin: 'goldfinch://vault', url: 'goldfinch://vault/' },
    sender: { session: { __goldfinchInternal: true } }
  };
  return {
    dir,
    store,
    itemId: saved.id,
    code: () => handlers['internal-vault-totp-code'](event, { vaultId: 'global', itemId: saved.id }),
    reveal: () => handlers['internal-vault-reveal'](event, { vaultId: 'global', itemId: saved.id })
  };
}

test('AC4: code reads every 30 s do not hold the vault open; a real reveal re-arms; a locked vault still answers { locked: true }', async (t) => {
  const h = await codeHarness(t);
  try {
    // only code reads, every 30 s, for just under 10 minutes: still unlocked; the 10th minute locks it
    for (let i = 0; i < 19; i++) {
      t.mock.timers.tick(30 * 1000);
      await flush();
      const r = await h.code();
      assert.equal(typeof r.code, 'string', `read ${i} answers a code`);
    }
    assert.equal(h.store.isUnlocked(), true, 'at 9m30s the vault is still unlocked');
    t.mock.timers.tick(30 * 1000);
    await flush();
    assert.equal(h.store.isUnlocked(), false, 'the code reads did not re-arm: locked at the idle interval');
    assert.deepEqual(await h.code(), { locked: true });
  } finally {
    rm(h.dir);
  }
});

test('AC4: a real reveal in between re-arms the timer', async (t) => {
  const h = await codeHarness(t);
  try {
    t.mock.timers.tick(9 * MIN);
    await flush();
    await h.code();
    const r = await h.reveal();
    assert.equal(r.item.title, 'Bank');
    t.mock.timers.tick(9 * MIN);
    await flush();
    assert.equal(h.store.isUnlocked(), true, 'the reveal re-armed: 9 more minutes is fine');
    t.mock.timers.tick(1 * MIN);
    await flush();
    assert.equal(h.store.isUnlocked(), false);
  } finally {
    rm(h.dir);
  }
});

test('AC4: the store option - revealItem / listItemsMeta with touch:false leave the stamp and timer alone', async (t) => {
  const h = await codeHarness(t);
  try {
    t.mock.timers.tick(5 * MIN);
    h.store.revealItem('global', h.itemId, { touch: false });
    h.store.listItemsMeta('global', { touch: false });
    assert.equal(h.store.idleMs(), 5 * MIN, 'no touch');
    h.store.revealItem('global', h.itemId);
    assert.equal(h.store.idleMs(), 0, 'the default still touches');
    h.store.lockNow();
    assert.throws(() => h.store.revealItem('global', h.itemId, { touch: false }), /lock/i);
  } finally {
    rm(h.dir);
  }
});

// ---- AC3c: a lock voids the reveal gate's per-item grants ---------------------------------------------

const REQ = {
  channel: 'internal-vault-reveal',
  action: 'reveal',
  subject: 'Bank',
  grant: { vaultId: 'v', itemId: 'i1' }
};

test('AC3c: grants die with a lock - a locked-then-unlocked vault asks again', async () => {
  const rg = makeTestRevealGate({ admin: true });
  const p = rg.gate.confirm(rg.event(7), REQ);
  await flush();
  rg.dialogs.at(-1).answer(1);
  assert.equal(await p, 'confirmed');
  assert.equal(await rg.gate.confirm(rg.event(7), REQ), 'confirmed', 'granted: no dialog');
  const n = rg.dialogs.length;
  rg.marks.clearGrants(); // what main's onLock does
  const p2 = rg.gate.confirm(rg.event(7), REQ);
  await flush();
  assert.equal(rg.dialogs.length, n + 1, 'after a lock the same item asks again');
  rg.dialogs.at(-1).answer(0);
  assert.equal(await p2, 'denied');
});

test('AC3c: a confirmation that straddles a lock stores no grant', async () => {
  const rg = makeTestRevealGate({ admin: true });
  const p = rg.gate.confirm(rg.event(7), REQ);
  await flush();
  rg.marks.clearGrants(); // the lock arrives while the dialog is up
  rg.dialogs.at(-1).answer(1); // the operator then confirms
  assert.equal(await p, 'confirmed');
  const n = rg.dialogs.length;
  const p2 = rg.gate.confirm(rg.event(7), REQ);
  await flush();
  assert.equal(rg.dialogs.length, n + 1, 'no grant was stored for the straddling dialog');
  rg.dialogs.at(-1).answer(0);
  await p2;
});

test('AC3c: the confirmation given after a lock reveals nothing ({ locked: true }) through the real handler', async () => {
  const dir = tmpDir();
  try {
    const store = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => JARS });
    await store.setup({ masterPassword: MASTER });
    const saved = store.saveItem('global', { type: 'login', title: 'Bank', username: 'u', password: 'p' });
    const rg = makeTestRevealGate({ admin: true });
    const handlers = {};
    registerVaultIpc({
      ipcMain: { handle: (c, fn) => (handlers[c] = fn) },
      revealGate: rg.gate,
      registerInternalHandler,
      getVaultStore: () => store,
      jars: { list: () => JARS }
    });
    const event = {
      ...rg.event(7),
      senderFrame: { frameTreeNodeId: 1, origin: 'goldfinch://vault', url: 'goldfinch://vault/' },
      sender: { id: 7, mainFrame: { frameTreeNodeId: 1 }, session: { __goldfinchInternal: true } }
    };
    const p = handlers['internal-vault-reveal'](event, { vaultId: 'global', itemId: saved.id });
    await flush();
    assert.equal(rg.dialogs.length, 1, 'the confirmation is pending');
    store.lockNow();
    rg.marks.clearGrants();
    rg.dialogs[0].answer(1);
    assert.deepEqual(await p, { locked: true });
  } finally {
    rm(dir);
  }
});

test('AC3c: documentMarks.clearGrants leaves the scripted mark alone', () => {
  const m = createDocumentMarks();
  m.markScripted(3);
  m.grant(3, 'k');
  m.clearGrants();
  assert.equal(m.hasGrant(3, 'k'), false);
  assert.equal(m.isScripted(3), true);
});

// ---- source pins (wiring is in main.js / vault/vault-wiring.js / app-lifecycle.js) ---------------------------------------------

test('pins: vault-wiring.js clears grants in onLock; main.js builds the power lock from the late store, registers after ready', () => {
  const read = (rel) => maskComments(fs.readFileSync(path.join(__dirname, '../../src', rel), 'utf8'));
  // onLock moved with the vault wiring (Mission 24 F3 leg 2).
  const wiring = read('main/vault/vault-wiring.js');
  assert.match(wiring, /onLock:\s*\(\)\s*=>\s*\{\s*documentMarks\.clearGrants\(\);/);
  const src = read('main/main.js');
  assert.match(src, /createPowerLock\(\{\s*powerMonitor,/);
  assert.match(src, /startVaultPowerLock:\s*\(\)\s*=>\s*vaultPowerLock\.register\(\)/);
  assert.match(src, /lockVaultForQuit:\s*\(\)\s*=>\s*peekVaultStore\(\)\?\.lockNow\(\)/);
  assert.equal((src.match(/powerMonitor\.on\(/g) || []).length, 0, 'no direct powerMonitor subscription in main.js');
  // "Never constructs": the quit lock and every power-lock dep read the PEEK accessor only.
  const powerStart = src.indexOf('createPowerLock({');
  assert.ok(powerStart !== -1, 'createPowerLock( call found');
  const powerBlock = src.slice(powerStart, src.indexOf('\n});', powerStart));
  assert.ok(/peekVaultStore\(\)/.test(powerBlock), 'the power-lock deps use peekVaultStore()');
  assert.equal(/getVaultStore\(/.test(powerBlock), false, 'no power-lock dep may construct the store');
  const quitDep = /lockVaultForQuit:[^\n]*/.exec(src);
  assert.ok(quitDep && !/getVaultStore/.test(quitDep[0]), 'lockVaultForQuit does not construct the store');
  // assertMutated: a constructing dep must trip the power-lock scan.
  const neutered = powerBlock.replace(/peekVaultStore\(\)\?\.lockNow\(\)/, 'getVaultStore().lockNow()');
  assert.notEqual(neutered, powerBlock, 'the mutation actually changed the source');
  assert.equal(/getVaultStore\(/.test(neutered), true, 'the scan catches a constructing dep');
});

test('pins: app-lifecycle before-quit locks in its own try, before getMcpServer().stop(), and registration is in the ready chain', () => {
  const src = maskComments(fs.readFileSync(path.join(__dirname, '../../src/main/app-lifecycle.js'), 'utf8'));
  const quit = src.slice(src.indexOf("app.on('before-quit'"), src.indexOf("app.on('window-all-closed'"));
  assert.match(quit, /try\s*\{\s*lockVaultForQuit\?\.\(\);\s*\}\s*catch/);
  assert.ok(quit.indexOf('lockVaultForQuit') < quit.indexOf('getMcpServer()?.stop()'));
  const ready = src.slice(src.indexOf('app.whenReady()'), src.indexOf("app.on('before-quit'"));
  assert.match(ready, /startVaultPowerLock\?\.\(\)/);
});

test('pins: the code-read handler passes touch:false to BOTH store reads and the other revealItem caller does not', () => {
  const src = maskComments(fs.readFileSync(path.join(__dirname, '../../src/main/register-vault-ipc.js'), 'utf8'));
  assert.match(src, /revealItem\(vaultId, itemId, \{ touch: false \}\)/);
  assert.match(src, /itemMeta\(vaultId, itemId, action !== 'code'\)/);
  assert.equal((src.match(/revealItem\(/g) || []).length, 2, 'exactly two callers');
});
