'use strict';

// Unit tests for the held plaintext-payload store for a browser CSV import
// (M19 F1 Leg 1 / DD6, leg ruling 8). Modeled on
// vault-pending-imports.test.js's fake-timer idiom, but this store's
// contract diverges deliberately from the restore hold store: the safety-
// drop timer arms AT `hold` (not at a later secret step — there is none),
// `take` is HANDLE-GUARDED (restore's is not), and `peekSummary` is the only
// page-facing projection (never the payload).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createPendingBrowserImportStore, HOLD_DROP_MS } = require('../../src/main/vault/pending-browser-imports');
const { MAX_PAYLOAD_BYTES } = require('../../src/main/vault/browser-import');

function seqHandles() {
  let n = 0;
  return () => `h${++n}`;
}

// A controllable fake timer pair (the vault-pending-imports.test.js idiom):
// captures every scheduled callback + its delay so a test can fire or cancel
// it deterministically, with no real wall-clock wait.
function fakeTimers() {
  let nextId = 1;
  /** @type {Map<number, { fn: () => void, ms: number }>} */
  const scheduled = new Map();
  return {
    setTimeout: (fn, ms) => {
      const id = nextId++;
      scheduled.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => {
      scheduled.delete(id);
    },
    fire: (id) => {
      const entry = scheduled.get(id);
      if (!entry) throw new Error(`no scheduled timer ${id}`);
      scheduled.delete(id);
      entry.fn();
    },
    scheduledCount: () => scheduled.size
  };
}

function makeStore(timers = fakeTimers()) {
  return { store: createPendingBrowserImportStore({ mintHandle: seqHandles(), ...timers }), timers };
}

function summary(overrides = {}) {
  return { candidateCount: 3, skipped: [{ line: 5, reason: 'malformed' }], ...overrides };
}

// ---------------------------------------------------------------------------
// AC18 — hold refusals, timer-at-hold, re-hold, window independence
// ---------------------------------------------------------------------------

test('AC18: hold refuses a non-Buffer payload — throws, nothing held', () => {
  const { store } = makeStore();
  assert.throws(
    () => store.hold(100, { payload: 'not a buffer', summary: summary() }),
    (e) => e instanceof TypeError
  );
  assert.equal(store.peekSummary(100), null, 'nothing held after a refused hold');
});

test('AC18: hold refuses a payload exceeding MAX_PAYLOAD_BYTES — throws, nothing held', () => {
  const { store } = makeStore();
  const oversized = Buffer.alloc(MAX_PAYLOAD_BYTES + 1);
  assert.throws(
    () => store.hold(100, { payload: oversized, summary: summary() }),
    (e) => e instanceof TypeError
  );
  assert.equal(store.peekSummary(100), null);
});

test('AC18: a refused hold leaves a PRIOR record for this window untouched', () => {
  const { store } = makeStore();
  const goodPayload = Buffer.from('first payload');
  const h1 = store.hold(100, { payload: goodPayload, summary: summary() });
  assert.throws(() => store.hold(100, { payload: 'nope', summary: summary() }));
  assert.deepEqual(store.peekSummary(100), { handle: h1, summary: summary() });
});

test('AC18: hold arms the safety-drop timer at HOLD_DROP_MS (injected setTimeout observed)', () => {
  const { store, timers } = makeStore();
  assert.equal(HOLD_DROP_MS, 5 * 60 * 1000);
  store.hold(100, { payload: Buffer.from('x'), summary: summary() });
  assert.equal(timers.scheduledCount(), 1, 'the safety-drop timer is armed immediately at hold');
});

test('AC18: a same-window re-hold zeroizes + replaces the prior record', () => {
  const { store, timers } = makeStore();
  const first = Buffer.from('first payload bytes');
  store.hold(100, { payload: first, summary: summary() });
  assert.equal(timers.scheduledCount(), 1);

  const second = Buffer.from('second payload bytes');
  const h2 = store.hold(100, { payload: second, summary: summary({ candidateCount: 9 }) });
  assert.equal(timers.scheduledCount(), 1, 'the prior timer was cancelled and a fresh one armed');
  assert.ok(
    first.every((b) => b === 0),
    're-hold zeroizes the prior payload'
  );
  assert.deepEqual(store.peekSummary(100), { handle: h2, summary: summary({ candidateCount: 9 }) });
});

test('AC18: a second window holds an independent record', () => {
  const { store } = makeStore();
  const hA = store.hold(100, { payload: Buffer.from('A'), summary: summary({ candidateCount: 1 }) });
  const hB = store.hold(200, { payload: Buffer.from('B'), summary: summary({ candidateCount: 2 }) });
  assert.notEqual(hA, hB);
  assert.deepEqual(store.peekSummary(100), { handle: hA, summary: summary({ candidateCount: 1 }) });
  assert.deepEqual(store.peekSummary(200), { handle: hB, summary: summary({ candidateCount: 2 }) });
});

// ---------------------------------------------------------------------------
// AC19 — every exit zeroizes except take(); handle-guarded take/clear
// ---------------------------------------------------------------------------

test('AC19: clear() zeroizes the payload and cancels the timer', () => {
  const { store, timers } = makeStore();
  const payload = Buffer.from('secret payload bytes');
  const h = store.hold(100, { payload, summary: summary() });
  store.clear(100, h);
  assert.equal(store.peekSummary(100), null);
  assert.equal(timers.scheduledCount(), 0);
  assert.ok(
    payload.every((b) => b === 0),
    'clear() zeroizes'
  );
});

test('AC19: dropAll() zeroizes every held payload and cancels every timer', () => {
  const { store, timers } = makeStore();
  const pA = Buffer.from('payload A bytes');
  const pB = Buffer.from('payload B bytes');
  store.hold(100, { payload: pA, summary: summary() });
  store.hold(200, { payload: pB, summary: summary() });
  assert.equal(timers.scheduledCount(), 2);

  store.dropAll();
  assert.equal(store.peekSummary(100), null);
  assert.equal(store.peekSummary(200), null);
  assert.equal(timers.scheduledCount(), 0);
  assert.ok(pA.every((b) => b === 0));
  assert.ok(pB.every((b) => b === 0));
});

test('AC19: timer expiry zeroizes + drops the record', () => {
  const timers = fakeTimers();
  const { store } = makeStore(timers);
  const payload = Buffer.from('expiring payload bytes');
  store.hold(100, { payload, summary: summary() });
  assert.equal(timers.scheduledCount(), 1);

  timers.fire(1);
  assert.equal(store.peekSummary(100), null, 'expiry drops the record');
  assert.ok(
    payload.every((b) => b === 0),
    'expiry zeroizes'
  );
});

test('AC19: a same-window re-hold (drop-via-re-hold) leaves the prior payload all-zero (covered again explicitly)', () => {
  const { store } = makeStore();
  const first = Buffer.from('to be replaced bytes');
  store.hold(100, { payload: first, summary: summary() });
  store.hold(100, { payload: Buffer.from('replacement bytes'), summary: summary() });
  assert.ok(first.every((b) => b === 0));
});

test('AC19: take() with the correct handle cancels the timer WITHOUT zeroizing, and removes the record', () => {
  const { store, timers } = makeStore();
  const payload = Buffer.from('commit payload bytes');
  const h = store.hold(100, { payload, summary: summary() });
  assert.equal(timers.scheduledCount(), 1);

  const taken = store.take(100, h);
  assert.equal(taken.payload, payload);
  assert.ok(
    payload.every((b) => b !== 0),
    'take() must NOT zeroize — the consumer needs the live buffer'
  );
  assert.equal(timers.scheduledCount(), 0, 'take() cancels the timer as part of consuming the record');
  assert.equal(store.peekSummary(100), null, 'the record is removed');
});

test('AC19: take() with a WRONG handle returns null and leaves the record (and its timer) fully intact', () => {
  const { store, timers } = makeStore();
  const payload = Buffer.from('untouched payload bytes');
  const h = store.hold(100, { payload, summary: summary() });
  assert.equal(timers.scheduledCount(), 1);

  const result = store.take(100, 'wrong-handle');
  assert.equal(result, null);
  assert.equal(timers.scheduledCount(), 1, 'the timer is untouched');
  assert.deepEqual(store.peekSummary(100), { handle: h, summary: summary() }, 'the record is untouched');
  assert.ok(
    payload.every((b) => b !== 0),
    'a mismatched-handle take never zeroizes'
  );
});

test('take()/clear() are safe no-ops on an unheld window', () => {
  const { store } = makeStore();
  assert.equal(store.take(999, 'whatever'), null);
  assert.doesNotThrow(() => store.clear(999, 'whatever'));
  assert.equal(store.peekSummary(999), null);
});

test('a stale handle cannot clear the live record (the opaque-handle guard, mirrors take)', () => {
  const { store } = makeStore();
  const h1 = store.hold(100, { payload: Buffer.from('first'), summary: summary() });
  const h2 = store.hold(100, { payload: Buffer.from('second'), summary: summary() });
  assert.notEqual(h1, h2);
  store.clear(100, h1); // stale — no-op.
  assert.deepEqual(store.peekSummary(100), { handle: h2, summary: summary() });
  store.clear(100, h2);
  assert.equal(store.peekSummary(100), null);
});

// ---------------------------------------------------------------------------
// AC20 — peekSummary carries no payload, ever
// ---------------------------------------------------------------------------

test('AC20: peekSummary returns { handle, summary } only — no payload key, and no field content in a JSON.stringify', () => {
  const { store } = makeStore();
  const SECRET = 'super-secret-plaintext-password-value';
  const payload = Buffer.from(SECRET, 'utf8');
  const h = store.hold(100, { payload, summary: summary({ candidateCount: 4 }) });

  const projection = store.peekSummary(100);
  assert.deepEqual(Object.keys(projection).sort(), ['handle', 'summary']);
  assert.equal('payload' in projection, false, 'no payload key on the returned object');

  const serialized = JSON.stringify(projection);
  assert.equal(serialized.includes(SECRET), false, 'no secret content leaks through the projection');
  assert.equal(projection.handle, h);
});

test('AC20: peekSummary is null before anything is held for a window', () => {
  const { store } = makeStore();
  assert.equal(store.peekSummary(999), null);
});

// ---------------------------------------------------------------------------
// chromeIds() enumeration (the bulk-drop precedent)
// ---------------------------------------------------------------------------

test('chromeIds() lists every window with a held record', () => {
  const { store } = makeStore();
  store.hold(100, { payload: Buffer.from('a'), summary: summary() });
  store.hold(200, { payload: Buffer.from('b'), summary: summary() });
  assert.deepEqual(store.chromeIds().sort(), [100, 200]);
  store.dropAll();
  assert.deepEqual(store.chromeIds(), []);
});

test('dropAll on an empty store is a safe no-op', () => {
  const { store } = makeStore();
  assert.doesNotThrow(() => store.dropAll());
});

// ---------------------------------------------------------------------------
// No autolock-suppression holder — structural (DD5/DD6 reasoning)
// ---------------------------------------------------------------------------

test('module never references an autolock-suppression holder — no held browser import can ever suppress autolock', () => {
  const src = require('fs').readFileSync(require.resolve('../../src/main/vault/pending-browser-imports'), 'utf8');
  assert.ok(!/suppress|holder|autolock/i.test(src), 'pending-browser-imports.js is structurally holder-free');
});
