'use strict';

// Unit tests for the userData setPath-before-consumers ordering invariant
// (Flight 9, Leg 7 / DD8(b)).
//
// initProfileAndStores(app, { shields, settings, jars }) MUST run
// app.setPath('userData', …) (dev-profile isolation, unpackaged only) BEFORE any
// getPath('userData') consumer — else a dev launch reads the WRONG profile.
//
// The seam: shields.load()/jars.load() read getPath('userData') INTERNALLY, but
// settings.load(path) takes the path as an ARG, so the ordering signal for settings is
// the getPath('userData') call initProfileAndStores makes to build that arg. The fake
// app's getPath records every call, and the fake stores' load() record theirs, into ONE
// shared call-order array. We assert the setPath index precedes every consumer index.

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
    jars: { load: () => order.push('jars.load') },
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
  // settings ordering signal: the getPath call made to build settings.load's arg. When
  // unpackaged there are TWO getPath calls — the FIRST feeds setPath's redirect arg
  // (correctly BEFORE setPath), the LAST feeds settings.load (must be AFTER setPath).
  // lastIndexOf isolates the settings-feeding read.
  const settingsGetPathIdx = w.order.lastIndexOf('getPath');
  assert.notEqual(settingsGetPathIdx, -1, 'expected a getPath feeding settings.load');
  assert.ok(setPathIdx < settingsGetPathIdx, 'setPath before the getPath that feeds settings.load');
  assert.ok(setPathIdx < idx(w.order, 'shields.load'), 'setPath before shields.load');
  assert.ok(setPathIdx < idx(w.order, 'settings.load'), 'setPath before settings.load');
  assert.ok(setPathIdx < idx(w.order, 'jars.load'), 'setPath before jars.load');

  // And the redirect actually took effect: settings.load received the -dev path.
  assert.ok(
    w.order.includes(`settings.load:/home/x/.config/goldfinch-dev`),
    'settings.load got the dev-redirected userData path'
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
  assert.ok(
    w.order.includes(`settings.load:/home/x/.config/goldfinch`),
    'settings.load got the un-redirected userData path when packaged'
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
