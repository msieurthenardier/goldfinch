'use strict';

// Unit tests for the CDP-based scroll implementation in src/main/automation/input.js.
//
// Electron-free: input.js does NOT require('electron') at the top, so these tests run
// under plain `node --test` with no Electron stub. A fake wc.debugger (attach/sendCommand/
// detach spies) stands in for the real Electron debugger — mirrors the readAxTree test
// pattern in automation-observe.test.js.
//
// The shared `attached` Set lives in cdp.js and is imported by BOTH input.js (scroll) and
// observe.js (readAxTree). Cross-module lock tests here verify that:
//   - a held scroll lock makes readAxTree return 'locked'
//   - a held readAxTree lock makes scroll return 'locked'
//
// Every test uses a DISTINCT wcId to keep the shared lock state isolated.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { scroll } = require('../../src/main/automation/input');
const { readAxTree } = require('../../src/main/automation/observe');

// ---------------------------------------------------------------------------
// Fake builders
// ---------------------------------------------------------------------------

function makeGuestWc(id) {
  return {
    id,
    session: { __goldfinchInternal: false },
    isDestroyed() { return false; },
    debugger: null,  // tests must attach a fake debugger before use
  };
}

function makeInternalWc(id) {
  return {
    id,
    session: { __goldfinchInternal: true },
    isDestroyed() { return false; },
  };
}

function makeDestroyedWc(id) {
  return {
    id,
    session: { __goldfinchInternal: false },
    isDestroyed() { return true; },
  };
}

/**
 * Build a fake fromId lookup backed by a map of id → fake wc.
 * @param {Record<number, object>} map
 */
function makeFakeFromId(map) {
  return (/** @type {number} */ id) => map[id] ?? null;
}

/**
 * Build a fake wc.debugger that records an ordered log of operations.
 * sendImpl: optional per-command override. Without it, all sendCommand calls resolve to {}.
 *
 * @param {{ attachThrows?: boolean, detachThrows?: boolean, sendImpl?: (method: string, params?: any) => Promise<any> }} [opts]
 */
function makeDebugger({ attachThrows = false, detachThrows = false, sendImpl } = {}) {
  const log = [];
  return {
    _log: log, _detached: 0, _attached: 0,
    attach(/** @type {string} */ v) {
      log.push(['attach', v]);
      if (attachThrows) throw new Error('already attached');
      this._attached++;
    },
    detach() {
      log.push(['detach']);
      this._detached++;
      if (detachThrows) throw new Error('already detached');
    },
    sendCommand(/** @type {string} */ method, /** @type {any} */ params) {
      log.push(['send', method, params]);
      if (sendImpl) return sendImpl(method, params);
      return Promise.resolve({});
    },
  };
}

// A controllable deferred promise (for concurrent-lock tests).
function makeDeferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Canned AX nodes for readAxTree cross-tests.
const CANNED_AX_NODES = [
  { nodeId: '1', role: { value: 'RootWebArea' } },
];

// ---------------------------------------------------------------------------
// scroll — happy path: CDP sequence
// ---------------------------------------------------------------------------

test('scroll: happy path — attach("1.3"), Input.dispatchMouseEvent with correct params, detach in finally, lock released', async () => {
  const dbg = makeDebugger();
  const guestWc = makeGuestWc(500);
  guestWc.debugger = dbg;

  const deps = {
    fromId: makeFakeFromId({ 500: guestWc }),
    chromeContents: null,
    activate: async () => {},
  };

  const result = await scroll(500, 10, 20, 30, 40, deps);

  // attach called with exactly '1.3'
  assert.deepEqual(dbg._log[0], ['attach', '1.3']);

  // Input.dispatchMouseEvent called with the correct params
  const sendEntry = dbg._log.find(
    (e) => e[0] === 'send' && e[1] === 'Input.dispatchMouseEvent'
  );
  assert.ok(sendEntry, 'Input.dispatchMouseEvent must be sent');
  assert.deepEqual(sendEntry[2], {
    type: 'mouseWheel',
    x: 10,
    y: 20,
    deltaX: 30,
    deltaY: 40,
  });

  // detach ran in the finally exactly once
  assert.equal(dbg._detached, 1, 'detach must run once in the finally');

  // result is void (engine serializes void ops to {"ok":true})
  assert.equal(result, undefined, 'scroll returns void on success');

  // lock released — a subsequent call on the same wcId succeeds
  const dbg2 = makeDebugger();
  guestWc.debugger = dbg2;
  const second = await scroll(500, 0, 0, 0, 0, deps);
  assert.equal(second, undefined, 'lock released — second call succeeds');
});

test('scroll: coordinates and deltas propagate to dispatchMouseEvent', async () => {
  let captured;
  const dbg = makeDebugger({
    sendImpl: (method, params) => { captured = { method, params }; return Promise.resolve({}); },
  });
  const guestWc = makeGuestWc(501);
  guestWc.debugger = dbg;

  const deps = { fromId: makeFakeFromId({ 501: guestWc }), chromeContents: null, activate: async () => {} };

  await scroll(501, 55, 77, -100, 200, deps);

  assert.equal(captured.method, 'Input.dispatchMouseEvent');
  assert.deepEqual(captured.params, { type: 'mouseWheel', x: 55, y: 77, deltaX: -100, deltaY: 200 });
});

test('scroll: zero deltas → dispatchMouseEvent still called (safe no-op)', async () => {
  const dbg = makeDebugger();
  const guestWc = makeGuestWc(502);
  guestWc.debugger = dbg;

  const deps = { fromId: makeFakeFromId({ 502: guestWc }), chromeContents: null, activate: async () => {} };

  const result = await scroll(502, 0, 0, 0, 0, deps);

  const sendEntry = dbg._log.find((e) => e[0] === 'send' && e[1] === 'Input.dispatchMouseEvent');
  assert.ok(sendEntry, 'must still dispatch even with zero deltas');
  assert.equal(result, undefined);
});

// ---------------------------------------------------------------------------
// scroll — refusal paths (mirrors readAxTree refusal contract)
// ---------------------------------------------------------------------------

test('scroll: attach-throw → returns { debugger-unavailable, attach-failed }, no detach, lock released', async () => {
  const dbg = makeDebugger({ attachThrows: true });
  const guestWc = makeGuestWc(503);
  guestWc.debugger = dbg;

  const deps = { fromId: makeFakeFromId({ 503: guestWc }), chromeContents: null, activate: async () => {} };

  const result = await scroll(503, 0, 0, 0, 0, deps);

  assert.deepEqual(result, { automation: 'debugger-unavailable', reason: 'attach-failed', wcId: 503 });
  assert.equal(dbg._detached, 0, 'never attached (attach threw) → never detached');

  // lock released — a subsequent call re-attempts attach (and throws again → refusal)
  const second = await scroll(503, 0, 0, 0, 0, deps);
  assert.deepEqual(second, { automation: 'debugger-unavailable', reason: 'attach-failed', wcId: 503 },
    'lock released even on the attach-throw path');
});

test('scroll: concurrent-lock refusal — second un-awaited call returns { locked }, attach called ONCE', async () => {
  const deferred = makeDeferred();
  const dbg = makeDebugger({
    sendImpl: (method) => {
      if (method === 'Input.dispatchMouseEvent') return deferred.promise;
      return Promise.resolve({});
    },
  });
  const guestWc = makeGuestWc(504);
  guestWc.debugger = dbg;

  const deps = { fromId: makeFakeFromId({ 504: guestWc }), chromeContents: null, activate: async () => {} };

  const firstP = scroll(504, 0, 0, 0, 120, deps);   // NOT awaited — parked on the deferred
  const second = await scroll(504, 0, 0, 0, 120, deps); // hits the synchronous lock

  assert.deepEqual(second, { automation: 'debugger-unavailable', reason: 'locked', wcId: 504 });
  const attachCount = dbg._log.filter((e) => e[0] === 'attach').length;
  assert.equal(attachCount, 1, 'attach must be called exactly ONCE (the locked call never attaches)');

  // resolve the deferred → the first call completes
  deferred.resolve({});
  const first = await firstP;
  assert.equal(first, undefined, 'first call resolves void on success');
  assert.equal(dbg._detached, 1, 'first call detaches once on completion');

  // lock released — a third call succeeds
  const dbg3 = makeDebugger();
  guestWc.debugger = dbg3;
  const third = await scroll(504, 0, 0, 0, 0, deps);
  assert.equal(third, undefined, 'lock released after the first completes — third call succeeds');
});

test('scroll: detach-in-finally on sendCommand throw — dispatchMouseEvent rejects → scroll REJECTS; detach ran; lock released', async () => {
  const boom = new Error('CDP dispatchMouseEvent failed');
  const dbg = makeDebugger({
    sendImpl: () => Promise.reject(boom),
  });
  const guestWc = makeGuestWc(505);
  guestWc.debugger = dbg;

  const deps = { fromId: makeFakeFromId({ 505: guestWc }), chromeContents: null, activate: async () => {} };

  // post-attach sendCommand failure PROPAGATES (not a refusal — the debugger WAS available)
  await assert.rejects(() => scroll(505, 0, 0, 0, 0, deps), (err) => err === boom);
  assert.equal(dbg._detached, 1, 'detach must run in the finally even when dispatchMouseEvent rejects');

  // lock released — a subsequent (healthy) call succeeds
  const healthy = makeDebugger();
  guestWc.debugger = healthy;
  const ok = await scroll(505, 0, 0, 0, 0, deps);
  assert.equal(ok, undefined, 'lock released after the rejecting call');
});

test('scroll: detach() throws on happy path — original void return is preserved, not masked', async () => {
  const dbg = makeDebugger({ detachThrows: true });
  const guestWc = makeGuestWc(506);
  guestWc.debugger = dbg;

  const result = await scroll(506, 0, 0, 0, 0, {
    fromId: makeFakeFromId({ 506: guestWc }),
    chromeContents: null,
    activate: async () => {},
  });

  assert.equal(result, undefined, 'a throwing detach() must not mask the void success value');
  assert.equal(dbg._detached, 1, 'detach was attempted (and threw, but was swallowed)');
});

test('scroll: detach() throws AND dispatchMouseEvent rejects — ORIGINAL rejection propagates (not the detach error)', async () => {
  const boom = new Error('CDP dispatchMouseEvent failed');
  const dbg = makeDebugger({
    detachThrows: true,
    sendImpl: () => Promise.reject(boom),
  });
  const guestWc = makeGuestWc(507);
  guestWc.debugger = dbg;

  await assert.rejects(
    () => scroll(507, 0, 0, 0, 0, { fromId: makeFakeFromId({ 507: guestWc }), chromeContents: null, activate: async () => {} }),
    (err) => err === boom,
  );
  assert.equal(dbg._detached, 1, 'detach was attempted in the finally');
});

// ---------------------------------------------------------------------------
// scroll — foreground-to-act discipline (guest/chrome/re-resolve)
// ---------------------------------------------------------------------------

test('scroll: guest — activate called BEFORE attach (ordering via shared callLog)', async () => {
  const callLog = [];
  const dbg = makeDebugger();
  const origAttach = dbg.attach.bind(dbg);
  dbg.attach = (v) => { callLog.push({ what: 'attach' }); origAttach(v); };
  const guestWc = makeGuestWc(508);
  guestWc.debugger = dbg;

  const deps = {
    fromId: makeFakeFromId({ 508: guestWc }),
    chromeContents: null,
    activate: async (/** @type {number} */ id) => { callLog.push({ what: 'activate', id }); },
  };

  await scroll(508, 0, 0, 0, 0, deps);

  const activateIdx = callLog.findIndex((e) => e.what === 'activate');
  const attachIdx = callLog.findIndex((e) => e.what === 'attach');
  assert.ok(activateIdx !== -1, 'activate must be called for a guest');
  assert.ok(attachIdx !== -1, 'attach must be called');
  assert.ok(activateIdx < attachIdx, 'activate must be called before attach');
});

test('scroll: guest — activate called exactly once with the wcId', async () => {
  const dbg = makeDebugger();
  const guestWc = makeGuestWc(509);
  guestWc.debugger = dbg;
  const activateCalls = [];

  const deps = {
    fromId: makeFakeFromId({ 509: guestWc }),
    chromeContents: null,
    activate: async (/** @type {number} */ id) => { activateCalls.push(id); },
  };

  await scroll(509, 0, 0, 0, 0, deps);

  assert.equal(activateCalls.length, 1, 'activate must be called exactly once');
  assert.equal(activateCalls[0], 509, 'activate must be called with the wcId');
});

test('scroll: chrome target — activate NOT called (chrome is always live)', async () => {
  const chromeWc = makeGuestWc(510);
  chromeWc.debugger = makeDebugger();
  const activateCalls = [];

  const deps = {
    fromId: makeFakeFromId({ 510: chromeWc }),
    chromeContents: chromeWc,  // classify as 'chrome'
    activate: async (id) => { activateCalls.push(id); },
  };

  const result = await scroll(510, 0, 0, 0, 0, deps);

  assert.equal(activateCalls.length, 0, 'activate must NOT be called for a chrome target');
  assert.equal(result, undefined, 'scroll must still succeed for chrome');
  assert.equal(chromeWc.debugger._attached, 1, 'attach must still run for the chrome target');
});

test('scroll: RE-RESOLVE proof — the SECOND (post-activate) handle\'s debugger is the one attached', async () => {
  const firstHandle = makeGuestWc(511);
  firstHandle.debugger = makeDebugger();
  const secondHandle = makeGuestWc(511);
  secondHandle.debugger = makeDebugger();

  let lookups = 0;
  const fromId = (/** @type {number} */ id) => {
    if (id !== 511) return null;
    lookups += 1;
    return lookups === 1 ? firstHandle : secondHandle;
  };

  await scroll(511, 0, 0, 0, 0, { fromId, chromeContents: null, activate: async () => {} });

  assert.equal(lookups, 2, 'fromId must be called twice (initial resolve + post-activate re-resolve)');
  assert.equal(firstHandle.debugger._attached, 0, 'the STALE pre-activate handle must NOT be attached');
  assert.equal(secondHandle.debugger._attached, 1, 'the FRESH post-activate handle must be the one attached');
  assert.equal(secondHandle.debugger._detached, 1, 'and the SAME (second) handle is the one detached');
});

// ---------------------------------------------------------------------------
// scroll — resolve-rejection passthrough (bad/dead/internal)
// ---------------------------------------------------------------------------

test('scroll: bad-handle (non-number wcId) → throws bad-handle BEFORE any lock/attach', async () => {
  await assert.rejects(
    // @ts-expect-error — intentionally passing wrong type
    () => scroll('500', 0, 0, 0, 0, { fromId: makeFakeFromId({}), chromeContents: null }),
    (err) => err instanceof Error && err.message.includes('automation: bad-handle')
  );
});

test('scroll: dead (isDestroyed) wcId → throws no-such-contents BEFORE any lock/attach', async () => {
  const destroyed = makeDestroyedWc(555);
  destroyed.debugger = makeDebugger();
  const deps = { fromId: makeFakeFromId({ 555: destroyed }), chromeContents: null };
  await assert.rejects(
    () => scroll(555, 0, 0, 0, 0, deps),
    (err) => err instanceof Error && err.message.includes('automation: no-such-contents')
  );
  assert.equal(destroyed.debugger._attached, 0, 'attach must not run on a dead handle');
});

test('scroll: internal-session wcId → throws, no lock acquired, no attach', async () => {
  const internalWc = makeInternalWc(577);
  const activateCalls = [];
  const deps = {
    fromId: makeFakeFromId({ 577: internalWc }),
    chromeContents: null,
    activate: async (id) => { activateCalls.push(id); },
  };

  await assert.rejects(
    () => scroll(577, 0, 0, 0, 0, deps),
    (err) => err instanceof Error && err.message.includes('automation: internal-session')
  );
  assert.equal(activateCalls.length, 0, 'activate must NOT be called on the internal-session path');
  // Verify lock untouched: a subsequent valid call on a different wcId succeeds
  const guestWc = makeGuestWc(578);
  guestWc.debugger = makeDebugger();
  const ok = await scroll(578, 0, 0, 0, 0, {
    fromId: makeFakeFromId({ 578: guestWc }),
    chromeContents: null,
    activate: async () => {},
  });
  assert.equal(ok, undefined, 'lock untouched — valid call after the internal-session reject succeeds');
});

// ---------------------------------------------------------------------------
// Shared lock — cross-module (scroll ↔ readAxTree)
// ---------------------------------------------------------------------------

test('shared lock: a held scroll lock makes readAxTree return "locked" for the same wcId', async () => {
  // Hold the scroll in the deferred, then fire readAxTree concurrently.
  // Both operations share wcId 600 and thus the same lock slot in cdp.js `attached`.
  // The debugger is NOT swapped mid-flight — the same fake debugger object is used throughout.
  const deferred = makeDeferred();
  const dbg = makeDebugger({
    sendImpl: () => deferred.promise,  // parks ALL sendCommand calls — scroll's dispatchMouseEvent
  });
  const guestWc = makeGuestWc(600);
  guestWc.debugger = dbg;

  const deps = {
    fromId: makeFakeFromId({ 600: guestWc }),
    chromeContents: null,
    activate: async () => {},
  };

  const scrollP = scroll(600, 0, 0, 0, 0, deps);  // NOT awaited — parks on deferred

  // readAxTree on the SAME wcId must hit the synchronous lock and return 'locked'
  const axResult = await readAxTree(600, deps);
  assert.deepEqual(axResult, { automation: 'debugger-unavailable', reason: 'locked', wcId: 600 },
    'readAxTree must return locked when scroll holds the cdp.js lock for the same wcId');

  // Resolve scroll → lock released
  deferred.resolve({});
  const scrollResult = await scrollP;
  assert.equal(scrollResult, undefined, 'scroll completes successfully');

  // After release, readAxTree can get the lock (use a fresh debugger since the old one is exhausted)
  const freshDbg = makeDebugger({ axNodes: [] });
  guestWc.debugger = freshDbg;
  const axAfter = await readAxTree(600, deps);
  assert.ok(Array.isArray(axAfter), 'readAxTree succeeds after the scroll lock is released');
});

test('shared lock: a held readAxTree lock makes scroll return "locked" for the same wcId', async () => {
  // Use a single deferred to park readAxTree on getFullAXTree, then fire scroll concurrently.
  // Both operations share wcId 601 and thus the same lock slot in cdp.js `attached`.
  // The debugger is NOT swapped mid-flight — the same fake debugger object is used throughout.
  const deferred = makeDeferred();
  const dbg = makeDebugger({
    sendImpl: (method) => {
      if (method === 'Accessibility.getFullAXTree') return deferred.promise;
      return Promise.resolve({});
    },
  });
  const guestWc = makeGuestWc(601);
  guestWc.debugger = dbg;

  const deps = {
    fromId: makeFakeFromId({ 601: guestWc }),
    chromeContents: null,
    activate: async () => {},
  };

  const axP = readAxTree(601, deps);  // NOT awaited — parks on deferred (getFullAXTree)

  // scroll on the SAME wcId must hit the synchronous lock and return 'locked'
  const scrollResult = await scroll(601, 0, 0, 0, 0, deps);
  assert.deepEqual(scrollResult, { automation: 'debugger-unavailable', reason: 'locked', wcId: 601 },
    'scroll must return locked when readAxTree holds the cdp.js lock for the same wcId');

  // Resolve readAxTree → lock released
  deferred.resolve({ nodes: CANNED_AX_NODES });
  const axResult = await axP;
  assert.deepEqual(axResult, CANNED_AX_NODES, 'readAxTree completes successfully');

  // After release, scroll can get the lock (use a fresh debugger since the old one is exhausted)
  const freshDbg = makeDebugger();
  guestWc.debugger = freshDbg;
  const scrollAfter = await scroll(601, 0, 0, 0, 0, deps);
  assert.equal(scrollAfter, undefined, 'scroll succeeds after the readAxTree lock is released');
});

test('shared lock: different wcIds can hold the lock concurrently (no cross-wcId interference)', async () => {
  const deferred603 = makeDeferred();
  const dbg602 = makeDebugger();
  const dbg603 = makeDebugger({
    sendImpl: () => deferred603.promise,
  });

  const wc602 = makeGuestWc(602);
  wc602.debugger = dbg602;
  const wc603 = makeGuestWc(603);
  wc603.debugger = dbg603;

  const fromId = (/** @type {number} */ id) => id === 602 ? wc602 : id === 603 ? wc603 : null;
  const deps = { fromId, chromeContents: null, activate: async () => {} };

  // Park wc603's scroll in the deferred
  const scroll603P = scroll(603, 0, 0, 0, 0, deps);  // NOT awaited

  // wc602's scroll should succeed independently (different wcId)
  const result602 = await scroll(602, 0, 0, 0, 0, deps);
  assert.equal(result602, undefined, 'scroll on wcId 602 succeeds even while wcId 603 holds the lock');
  assert.equal(dbg602._attached, 1, 'wc602 was attached');
  assert.equal(dbg602._detached, 1, 'wc602 was detached');

  // Unblock wc603
  deferred603.resolve({});
  const result603 = await scroll603P;
  assert.equal(result603, undefined, 'wc603 scroll also succeeds once unblocked');
});
