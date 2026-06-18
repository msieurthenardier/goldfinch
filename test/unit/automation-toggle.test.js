'use strict';

// Unit tests for the serialized automation toggle (Flight 9, Leg 7 / DD8(a)).
//
// makeAutomationToggle returns { applyEnabledChange, rebind } that share ONE inFlight
// chain. These tests pin the race fix from the F8 debrief:
//   - two overlapping flip-ONs → exactly ONE start (no double-bind / EADDRINUSE)
//   - a flip-ON then flip-OFF overlap → correct, single final state (no lost no-op)
//   - a prior op whose stop() REJECTS does not wedge the chain (next op still runs)
//   - a dev-override flip-OFF keeps the surface bound (no teardown — DD3/DD4)
//
// Determinism: the slow `start` resolves on a MANUALLY-controlled deferred (not a
// timer), so the test controls exactly when overlap is released.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { makeAutomationToggle } = require('../../src/main/automation/toggle');

// A manually-resolved deferred — the test resolves it to release a pending `start`.
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Build a toggle over a tiny fake "world": a server slot, a dev-override flag, a
// status slot, and instrumented start/stop. `start` installs a fresh fake server
// (with its own stop()) into the slot.
function makeHarness({ initialServer = null, devOverride = false, startBlocker = null } = {}) {
  const calls = { start: 0, stop: 0, statusWrites: [] };
  let server = initialServer;
  let dev = devOverride;

  const start = async () => {
    calls.start += 1;
    if (startBlocker) await startBlocker.promise; // gate overlap deterministically
    // Mirror startMcpServerInstance: install a fresh server into the slot.
    server = { stop: async () => { calls.stop += 1; } };
  };
  // stop() mediates the current server, matching main.js's `() => mcpServer.stop()`.
  const stop = async () => { if (server) await server.stop(); };

  const toggle = makeAutomationToggle({
    start,
    stop,
    getServer: () => server,
    setServer: (s) => { server = s; },
    isDevOverride: () => dev,
    setStatus: (s) => { calls.statusWrites.push(s); },
  });

  return {
    toggle,
    calls,
    getServer: () => server,
    setDevOverride: (v) => { dev = v; },
  };
}

test('two overlapping flip-ONs → exactly ONE start (no double-bind)', async () => {
  const blocker = deferred();
  const h = makeHarness({ initialServer: null, startBlocker: blocker });

  // Fire both flip-ONs before releasing start. Without serialization both would see
  // server===null and both would call start (the F8 EADDRINUSE race).
  const p1 = h.toggle.applyEnabledChange(true);
  const p2 = h.toggle.applyEnabledChange(true);

  // Let microtasks settle so the second op has had a chance to (wrongly) start.
  await Promise.resolve();
  await Promise.resolve();

  blocker.resolve();
  await Promise.all([p1, p2]);

  assert.equal(h.calls.start, 1, 'exactly one start across two overlapping flip-ONs');
  assert.ok(h.getServer(), 'surface is bound after the flips');
});

test('flip-ON then flip-OFF overlap → final state is OFF (no lost no-op)', async () => {
  const blocker = deferred();
  const h = makeHarness({ initialServer: null, startBlocker: blocker });

  const pOn = h.toggle.applyEnabledChange(true);   // starts, blocked
  const pOff = h.toggle.applyEnabledChange(false);  // queued AFTER the start

  await Promise.resolve();
  blocker.resolve();
  await Promise.all([pOn, pOff]);

  assert.equal(h.calls.start, 1, 'one start (the flip-ON)');
  assert.equal(h.calls.stop, 1, 'the flip-OFF tore the started server down');
  assert.equal(h.getServer(), null, 'final state is OFF');
  const last = h.calls.statusWrites[h.calls.statusWrites.length - 1];
  assert.equal(last.enabled, false, 'status reset to disabled on flip-OFF teardown');
});

test('flip-OFF then flip-ON overlap → final state is ON', async () => {
  // Start bound, so flip-OFF tears down; the queued flip-ON then re-starts.
  const initial = { stop: async () => {} };
  const blocker = deferred();
  const h = makeHarness({ initialServer: initial, startBlocker: blocker });

  const pOff = h.toggle.applyEnabledChange(false);
  const pOn = h.toggle.applyEnabledChange(true);

  await Promise.resolve();
  blocker.resolve();
  await Promise.all([pOff, pOn]);

  assert.equal(h.calls.start, 1, 'the queued flip-ON re-started the surface');
  assert.ok(h.getServer(), 'final state is ON');
});

test('rejection isolation — a prior op whose stop() rejects does not wedge the chain', async () => {
  // Count stop attempts directly so we can prove the NEXT op's body ran even though the
  // server stays present after the failing teardown (stop() threw before setServer(null)).
  let stopAttempts = 0;
  const badServer = { stop: async () => { stopAttempts += 1; throw new Error('stop failed'); } };
  const h = makeHarness({ initialServer: badServer });

  const pOff = h.toggle.applyEnabledChange(false);
  // The failing op surfaces ITS OWN error to its own caller (the .catch on the
  // SERIALIZATION await does not swallow an op's own error).
  await assert.rejects(pOff, /stop failed/, 'the failing op rejects to its own caller');
  assert.equal(stopAttempts, 1, 'the failing op attempted its teardown');

  // The next op must EXECUTE (chain not wedged). rebind's body runs because the server is
  // still present (the failed teardown left it) — proven by a second stop attempt. If the
  // chain were poisoned by the prior rejection, this op would never run.
  await assert.rejects(h.toggle.rebind(), /stop failed/, 'the next op ran (and saw the same bad stop)');
  assert.equal(stopAttempts, 2, 'the next op executed its body after the prior rejection (no wedge)');
});

test('dev-override flip-OFF → no teardown (surface stays bound, DD3/DD4)', async () => {
  const initial = { stop: async () => {} };
  const h = makeHarness({ initialServer: initial, devOverride: true });

  await h.toggle.applyEnabledChange(false);

  assert.equal(h.calls.stop, 0, 'dev-override flip-OFF does NOT stop the server');
  assert.equal(h.getServer(), initial, 'surface stays bound under dev-override');
  assert.equal(h.calls.statusWrites.length, 0, 'no status reset under dev-override');
});

test('rebind — serialized stop()+start(); no-op when surface inactive', async () => {
  // Inactive: rebind is a no-op.
  const inactive = makeHarness({ initialServer: null });
  await inactive.toggle.rebind();
  assert.equal(inactive.calls.start, 0, 'rebind is a no-op when the surface is inactive');

  // Active: rebind stops the old server and starts a fresh one.
  const active = makeHarness({ initialServer: { stop: async () => {} } });
  await active.toggle.rebind();
  assert.equal(active.calls.start, 1, 'rebind started a fresh server');
  assert.ok(active.getServer(), 'surface bound after rebind');
});

test('rebind concurrent with flip-ON is serialized (no stop()-on-null)', async () => {
  // A rebind (stop+start, blocked at start) overlapped with a flip-ON. If they
  // interleaved, the flip-ON could observe the transient null and double-start, or the
  // rebind could stop a server the flip-ON just removed. Serialization prevents both.
  const blocker = deferred();
  const h = makeHarness({ initialServer: { stop: async () => {} }, startBlocker: blocker });

  const pRebind = h.toggle.rebind();           // stop old, then blocked start
  const pFlipOn = h.toggle.applyEnabledChange(true); // queued; server present → no start

  await Promise.resolve();
  blocker.resolve();
  await Promise.all([pRebind, pFlipOn]);

  // rebind started once; the flip-ON saw a bound server and did NOT start again.
  assert.equal(h.calls.start, 1, 'exactly one start across rebind + flip-ON');
  assert.ok(h.getServer(), 'surface bound');
});
