'use strict';

// Unit tests for vault-store's WRITE-EXCLUSIVITY machinery (Mission 18,
// Flight 2, Leg 2 / flight DD3): the re-key gate (`_rekeyInProgress`), the
// in-flight counter + drain (`_acquireRekeyGate`), the entry-check
// `VaultBusyError` on all eight gated ops, and the SECOND WALL inside the
// write sinks (`_writeVault` / `_writeManager`) that stops a mutator which
// awaited past its entry check from persisting a pre-rotation document.
//
// RACE PINS (leg spec): op entered before the gate → the drain blocks the
// acquire until it settles; op arriving after the gate → VaultBusyError at
// entry; the MID-AWAIT interleaving (a mintAccessKey past its entry check,
// parked on its scrypt await, when the gate rises → the drain waits for it and
// its write is refused at the second wall); a gated op that fails mid-flight
// (auth error) releases the counter in `finally` so a subsequent acquire still
// drains to zero (deadlock pin); after release, a re-raised gate refuses a new
// straddling op's second-wall re-check identically.
//
// The mid-await park is made deterministic by monkeypatching the SHARED
// vault-crypto module singleton's `unwrapMaster` (the same module object
// vault-store holds — the vault-atomic-write.test.js shared-singleton idiom)
// with a manually-resolved deferred. Every await on a drain/acquire is wrapped
// in a hard timeout so a machinery regression fails fast instead of hanging.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');
const vc = require('../../src/main/vault/vault-crypto');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';
const JARS = [{ id: 'work' }, { id: 'personal' }];

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-rekey-gate-'));
}
function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
function makeStore(dir, overrides = {}) {
  return vs.load(dir, {
    scryptParams: FAST_SCRYPT,
    getAutoLockMinutes: () => 10,
    listJars: () => JARS,
    ...overrides
  });
}
function loginItem(overrides = {}) {
  return { type: 'login', title: 'Example', username: 'u', password: 'hunter2', ...overrides };
}
function workVaultBytes(dir) {
  return fs.readFileSync(path.join(dir, 'vaults', 'work.gfvault'));
}

/** Fail fast instead of hanging when a drain/acquire regresses into a deadlock. */
function withTimeout(promise, label, ms = 2000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function setUpStore(dir) {
  const store = makeStore(dir);
  await store.setup({ masterPassword: MASTER });
  store.saveItem('work', loginItem({ id: 'seed', title: 'Seed' }));
  return store;
}

// ---------------------------------------------------------------------------
// Entry wall — all eight gated ops refuse while the gate is up (AC3)
// ---------------------------------------------------------------------------

test('all eight gated ops throw VaultBusyError at entry while the gate is up, and work again after release', async () => {
  const dir = tmpDir();
  try {
    const store = await setUpStore(dir);
    const release = await withTimeout(store._acquireRekeyGate(), 'acquire on an idle store');

    const busy = (e) => e instanceof vs.VaultBusyError;
    // The five synchronous mutating/read ops...
    assert.throws(() => store.saveItem('work', loginItem()), busy, 'saveItem');
    assert.throws(() => store.deleteItem('work', 'seed'), busy, 'deleteItem');
    assert.throws(
      () => store.saveItemPreservingSecrets('work', loginItem({ id: 'seed' }), []),
      busy,
      'saveItemPreservingSecrets'
    );
    assert.throws(() => store.revokeAccessKey('work', 'no-such-key'), busy, 'revokeAccessKey');
    assert.throws(() => store.exportVault('work'), busy, 'exportVault (gated for its reads)');
    assert.throws(() => store.deleteVault('work'), busy, 'deleteVault');
    // ...and the two async ones reject before any await/validation.
    await assert.rejects(store.mintAccessKey('work', { masterPassword: MASTER }), busy, 'mintAccessKey');
    await assert.rejects(store.importVault({}, { secret: Buffer.from('x') }), busy, 'importVault');

    // Nothing was written or removed while the wall held.
    assert.deepEqual(
      store.listItems('work').map((i) => i.title),
      ['Seed'],
      'reads stay un-gated and the data is untouched'
    );

    // Only one rotation at a time: a second acquire while raised is busy too.
    await assert.rejects(store._acquireRekeyGate(), busy, 'acquire while already raised');

    release();
    release(); // idempotent
    const saved = store.saveItem('work', loginItem({ title: 'After' }));
    assert.equal(saved.title, 'After', 'gated ops work again after release');
    assert.deepEqual(store.exportVault('work').sourceVaultId, 'work');
  } finally {
    rm(dir);
  }
});

test('SECOND WALL: the write sinks themselves refuse while the gate is up (covers _writeVaultForKey and every future caller)', async () => {
  const dir = tmpDir();
  try {
    const store = await setUpStore(dir);
    const before = workVaultBytes(dir);
    const release = await withTimeout(store._acquireRekeyGate(), 'acquire');
    assert.throws(
      () => store._writeVault('work', { envelopes: [], items: {} }),
      (e) => e instanceof vs.VaultBusyError
    );
    assert.throws(
      () => store._writeManager({}),
      (e) => e instanceof vs.VaultBusyError
    );
    assert.ok(workVaultBytes(dir).equals(before), 'the sink refused before touching the file');
    release();
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// Drain + the mid-await interleaving (AC3's central race pin)
// ---------------------------------------------------------------------------

test('mid-scrypt interleaving: an in-flight mint blocks the drain; a late op is refused at entry; the resumed mint hits the second wall; the acquire then completes', async () => {
  const dir = tmpDir();
  const originalUnwrapMaster = vc.unwrapMaster;
  try {
    const store = await setUpStore(dir);
    const before = workVaultBytes(dir);

    // Park mintAccessKey on its step-up derive: a manually-released deferred in
    // place of the scrypt unwrap (the shared vault-crypto module singleton).
    let releaseDerive;
    const derive = new Promise((resolve) => {
      releaseDerive = resolve;
    });
    vc.unwrapMaster = async () => {
      await derive;
      return Buffer.alloc(32);
    };

    const mint = store.mintAccessKey('work', { masterPassword: MASTER });
    await tick(); // let mint pass its entry check and reach the parked await
    assert.equal(store._inFlightOps, 1, 'the mint holds the in-flight counter across its await');

    // Raise the gate: the drain must NOT resolve while the mint is in flight.
    let acquired = false;
    const acquire = store._acquireRekeyGate().then((release) => {
      acquired = true;
      return release;
    });
    await tick();
    await tick();
    assert.equal(acquired, false, 'the drain waits for the op that entered before the gate');

    // An op arriving AFTER the gate is refused at entry immediately.
    assert.throws(
      () => store.saveItem('work', loginItem()),
      (e) => e instanceof vs.VaultBusyError
    );

    // Resume the parked mint: it re-checks the gate at the SINK and is refused —
    // it can never persist a pre-rotation document — and its finally releases
    // the counter, letting the drain complete.
    releaseDerive();
    await assert.rejects(mint, (e) => e instanceof vs.VaultBusyError, 'the resumed mint fails on the second wall');
    const release = await withTimeout(acquire, 'the drain after the straddling op settled');
    assert.equal(acquired, true);
    assert.equal(store._inFlightOps, 0, 'the counter drained to zero');
    assert.ok(workVaultBytes(dir).equals(before), 'no access envelope was persisted by the refused mint');

    release();
    vc.unwrapMaster = originalUnwrapMaster;
    const minted = await store.mintAccessKey('work', { masterPassword: MASTER });
    assert.equal(typeof minted.secret, 'string', 'mint succeeds again once the rotation released');
  } finally {
    vc.unwrapMaster = originalUnwrapMaster;
    rm(dir);
  }
});

test('re-raise: after a full gate cycle, a NEW straddling op is refused by the re-raised gate identically', async () => {
  const dir = tmpDir();
  const originalUnwrapMaster = vc.unwrapMaster;
  try {
    const store = await setUpStore(dir);

    // Cycle 1: raise + release with nothing in flight.
    const release1 = await withTimeout(store._acquireRekeyGate(), 'first acquire');
    release1();
    assert.equal(store.saveItem('work', loginItem({ title: 'Between' })).title, 'Between', 'gate fully lowered');

    // Cycle 2: a mint straddles the re-raised gate → second wall refuses it.
    let releaseDerive;
    const derive = new Promise((resolve) => {
      releaseDerive = resolve;
    });
    vc.unwrapMaster = async () => {
      await derive;
      return Buffer.alloc(32);
    };
    const mint = store.mintAccessKey('work', { masterPassword: MASTER });
    await tick();
    const acquire2 = store._acquireRekeyGate();
    releaseDerive();
    await assert.rejects(mint, (e) => e instanceof vs.VaultBusyError, 'the re-raised gate refuses the new straddler');
    const release2 = await withTimeout(acquire2, 'second drain');
    release2();
  } finally {
    vc.unwrapMaster = originalUnwrapMaster;
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// Deadlock pin — a mid-flight failure releases the counter in `finally`
// ---------------------------------------------------------------------------

test('DEADLOCK PIN: a gated op failing mid-flight (auth error) releases the counter, and a subsequent acquire still drains to zero', async () => {
  const dir = tmpDir();
  try {
    const store = await setUpStore(dir);

    // A wrong-password mint fails INSIDE the op, after entry, while holding the
    // counter — the finally must release it.
    await assert.rejects(
      store.mintAccessKey('work', { masterPassword: 'wrong password' }),
      (e) => e instanceof vs.VaultAuthError
    );
    assert.equal(store._inFlightOps, 0, 'the failed op released its hold');

    // ...and so must an importVault that throws during validation.
    await assert.rejects(store.importVault({ format: 'nonsense' }, { secret: Buffer.from('x') }));
    assert.equal(store._inFlightOps, 0);

    // The acquire drains immediately — a leaked hold would hang here (timeout).
    const release = await withTimeout(store._acquireRekeyGate(), 'acquire after mid-flight failures');
    release();
  } finally {
    rm(dir);
  }
});

test('a fully synchronous op entered before the gate simply completes; the acquire then resolves with nothing to drain', async () => {
  const dir = tmpDir();
  try {
    const store = await setUpStore(dir);
    // Synchronous ops can never straddle the gate (no await window on a
    // single-threaded loop — the DD3 coherence argument for exportVault and
    // deleteVault): by the time acquire runs, the counter is already back to 0.
    store.saveItem('work', loginItem({ title: 'Sync' }));
    assert.equal(store._inFlightOps, 0);
    const release = await withTimeout(store._acquireRekeyGate(), 'acquire after a sync op');
    release();
  } finally {
    rm(dir);
  }
});
