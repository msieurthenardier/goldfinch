'use strict';

// Unit tests for the userData setPath-before-consumers ordering invariant
// (Flight 9, Leg 7 / DD8(b)).
//
// initProfileAndStores(app, { shields, settings, jars }) MUST run
// app.setPath('userData', …) (dev-profile isolation, unpackaged only) BEFORE any
// getPath('userData') consumer — else a dev launch reads the WRONG profile.
//
// The seam: shields.load() reads getPath('userData') INTERNALLY, but settings.load(path),
// jars.load(path), and downloads.load(path) take the path as an ARG, so the ordering
// signal for those is the getPath('userData') call initProfileAndStores makes to build
// each arg. The fake app's getPath records every call, and the fake stores' load()
// record theirs (arg-taking stores record the path they received — a forgotten arg
// would silently degrade jars to its never-persisting seed, so the tests assert it),
// into ONE shared call-order array. We assert the setPath index precedes every
// consumer index.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { initProfileAndStores } = require('../../src/main/init-profile');

// A fake Electron app + fake stores sharing one call-order array. NOT the shared
// electron-stub (this test needs a per-call recorder, not a static getPath).
function makeWorld({ isPackaged }) {
  const order = [];
  let userData = '/home/x/.config/goldfinch';
  const app = {
    isPackaged,
    setPath: (name, value) => {
      assert.equal(name, 'userData', 'only userData is redirected');
      userData = value;
      order.push('setPath');
    },
    getPath: (name) => {
      assert.equal(name, 'userData', 'consumers resolve the userData dir');
      order.push('getPath'); // the signal that fuels settings.load(path)
      return userData;
    },
  };
  const stores = {
    shields: { load: () => order.push('shields.load') },
    settings: { load: (p) => { order.push('settings.load'); order.push(`settings.load:${p}`); } },
    jars: { load: (p) => { order.push('jars.load'); order.push(`jars.load:${p}`); } },
    downloads: { load: (p) => { order.push('downloads.load'); order.push(`downloads.load:${p}`); } },
  };
  return { app, stores, order, getUserData: () => userData };
}

// Index of the FIRST occurrence of a marker (consumers run once each).
function idx(order, marker) {
  const i = order.indexOf(marker);
  assert.notEqual(i, -1, `expected ${marker} to have run`);
  return i;
}

test('unpackaged — setPath runs before every getPath(userData) consumer', () => {
  const w = makeWorld({ isPackaged: false });
  initProfileAndStores(w.app, w.stores);

  const setPathIdx = idx(w.order, 'setPath');
  // settings/jars/downloads ordering signal: the getPath calls made to build their load
  // args. When unpackaged the FIRST getPath feeds setPath's redirect arg (correctly
  // BEFORE setPath); the remaining getPath calls feed settings.load, jars.load, then
  // downloads.load (all must be AFTER setPath). indexOf of the first POST-setPath
  // getPath isolates them.
  const firstConsumerGetPathIdx = w.order.indexOf('getPath', setPathIdx);
  assert.notEqual(firstConsumerGetPathIdx, -1, 'expected a getPath feeding settings/jars/downloads.load');
  assert.ok(setPathIdx < firstConsumerGetPathIdx, 'setPath before the getPath that feeds settings.load');
  assert.ok(setPathIdx < idx(w.order, 'shields.load'), 'setPath before shields.load');
  assert.ok(setPathIdx < idx(w.order, 'settings.load'), 'setPath before settings.load');
  assert.ok(setPathIdx < idx(w.order, 'jars.load'), 'setPath before jars.load');
  assert.ok(setPathIdx < idx(w.order, 'downloads.load'), 'setPath before downloads.load');

  // And the redirect actually took effect: settings.load, jars.load AND downloads.load
  // got the -dev path.
  assert.ok(
    w.order.includes(`settings.load:/home/x/.config/goldfinch-dev`),
    'settings.load got the dev-redirected userData path'
  );
  assert.ok(
    w.order.includes(`jars.load:/home/x/.config/goldfinch-dev`),
    'jars.load got the dev-redirected userData path'
  );
  assert.ok(
    w.order.includes(`downloads.load:/home/x/.config/goldfinch-dev`),
    'downloads.load got the dev-redirected userData path'
  );
});

test('packaged — setPath is NOT called; consumers still run (invariant vacuously holds)', () => {
  const w = makeWorld({ isPackaged: true });
  initProfileAndStores(w.app, w.stores);

  assert.equal(w.order.includes('setPath'), false, 'packaged build must not redirect userData');
  // Consumers still run, reading the real (un-redirected) userData.
  assert.ok(w.order.includes('shields.load'), 'shields.load still runs when packaged');
  assert.ok(w.order.includes('settings.load'), 'settings.load still runs when packaged');
  assert.ok(w.order.includes('jars.load'), 'jars.load still runs when packaged');
  assert.ok(w.order.includes('downloads.load'), 'downloads.load still runs when packaged');
  assert.ok(
    w.order.includes(`settings.load:/home/x/.config/goldfinch`),
    'settings.load got the un-redirected userData path when packaged'
  );
  assert.ok(
    w.order.includes(`jars.load:/home/x/.config/goldfinch`),
    'jars.load got the un-redirected userData path when packaged'
  );
  assert.ok(
    w.order.includes(`downloads.load:/home/x/.config/goldfinch`),
    'downloads.load got the un-redirected userData path when packaged'
  );
});

test('invariant is meaningful — a consumer reordered before setPath would be caught', () => {
  // Sanity guard: prove the assertion has teeth by simulating a broken order and
  // confirming the same comparison the real test uses would fail on it.
  const brokenOrder = ['shields.load', 'setPath', 'getPath', 'settings.load', 'jars.load'];
  const setPathIdx = brokenOrder.indexOf('setPath');
  const shieldsIdx = brokenOrder.indexOf('shields.load');
  assert.ok(
    setPathIdx > shieldsIdx,
    'in the broken order setPath comes AFTER shields.load — the real test would fail this'
  );
});
