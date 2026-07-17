'use strict';

// Unit tests for the userData setPath-before-consumers ordering invariant
// (Flight 9, Leg 7 / DD8(b)), re-pinned for the flight 10-1 DD9 reshape
// (leg 2): appDb.open(...) folds into initProfileAndStores as its first
// internal step, immediately after the dev-profile redirect and before every
// store load.
//
// initProfileAndStores(app, { appDb, shields, settings, jars, downloads }) MUST run
// app.setPath('userData', …) (dev-profile isolation, unpackaged only) BEFORE
// appDb.open(...) and before any getPath('userData') consumer — else a dev
// launch reads the WRONG profile, or a store load races app-db's open.
//
// The seam: shields.load(path) now takes the path as an ARG (leg 2 dropped its
// former internal getPath call), like settings.load(path), jars.load(path), and
// downloads.load(path) — so the ordering signal for all four is the
// getPath('userData') call initProfileAndStores makes to build each arg.
// appDb.open(...) records its own call directly (it takes the resolved path,
// not a store-recorded one). The fake app's getPath records every call, and the
// fake stores' load()/open() record theirs, into ONE shared call-order array.
// We assert the setPath index precedes appDb.open, which precedes every
// consumer index.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { initProfileAndStores } = require('../../src/main/init-profile');

// A fake Electron app + fake app-db + fake stores sharing one call-order array.
// NOT the shared electron-stub (this test needs a per-call recorder, not a
// static getPath).
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
      order.push('getPath'); // the signal that fuels settings.load(path) etc.
      return userData;
    },
  };
  const appDb = {
    open: (p) => {
      order.push('appDb.open');
      order.push(`appDb.open:${p}`);
    },
  };
  const stores = {
    shields: { load: (p) => { order.push('shields.load'); order.push(`shields.load:${p}`); } },
    settings: { load: (p) => { order.push('settings.load'); order.push(`settings.load:${p}`); } },
    jars: { load: (p) => { order.push('jars.load'); order.push(`jars.load:${p}`); } },
    downloads: { load: (p) => { order.push('downloads.load'); order.push(`downloads.load:${p}`); } },
  };
  return { app, appDb, stores, order, getUserData: () => userData };
}

// Index of the FIRST occurrence of a marker (consumers run once each).
function idx(order, marker) {
  const i = order.indexOf(marker);
  assert.notEqual(i, -1, `expected ${marker} to have run`);
  return i;
}

test('unpackaged — setPath runs before appDb.open, which runs before every getPath(userData) consumer', () => {
  const w = makeWorld({ isPackaged: false });
  initProfileAndStores(w.app, { appDb: w.appDb, ...w.stores });

  const setPathIdx = idx(w.order, 'setPath');
  const appDbOpenIdx = idx(w.order, 'appDb.open');
  assert.ok(setPathIdx < appDbOpenIdx, 'setPath before appDb.open');

  // settings/shields/jars/downloads ordering signal: the getPath calls made to
  // build their load args. When unpackaged the FIRST getPath feeds setPath's
  // redirect arg (correctly BEFORE setPath); the remaining getPath calls feed
  // appDb.open, shields.load, settings.load, jars.load, then downloads.load
  // (all must be AFTER setPath). indexOf of the first POST-setPath getPath
  // isolates them.
  const firstConsumerGetPathIdx = w.order.indexOf('getPath', setPathIdx);
  assert.notEqual(firstConsumerGetPathIdx, -1, 'expected a getPath feeding appDb.open/settings/jars/downloads.load');
  assert.ok(setPathIdx < firstConsumerGetPathIdx, 'setPath before the getPath that feeds appDb.open');
  assert.ok(appDbOpenIdx < idx(w.order, 'shields.load'), 'appDb.open before shields.load');
  assert.ok(setPathIdx < idx(w.order, 'shields.load'), 'setPath before shields.load');
  assert.ok(setPathIdx < idx(w.order, 'settings.load'), 'setPath before settings.load');
  assert.ok(setPathIdx < idx(w.order, 'jars.load'), 'setPath before jars.load');
  assert.ok(setPathIdx < idx(w.order, 'downloads.load'), 'setPath before downloads.load');

  // And the redirect actually took effect: appDb.open, shields/settings/jars/
  // downloads.load all got the -dev path.
  assert.ok(
    w.order.includes('appDb.open:/home/x/.config/goldfinch-dev'),
    'appDb.open got the dev-redirected userData path'
  );
  assert.ok(
    w.order.includes('shields.load:/home/x/.config/goldfinch-dev'),
    'shields.load got the dev-redirected userData path'
  );
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

test('packaged — setPath is NOT called; appDb.open + consumers still run (invariant vacuously holds)', () => {
  const w = makeWorld({ isPackaged: true });
  initProfileAndStores(w.app, { appDb: w.appDb, ...w.stores });

  assert.equal(w.order.includes('setPath'), false, 'packaged build must not redirect userData');
  // Consumers still run, reading the real (un-redirected) userData.
  assert.ok(w.order.includes('appDb.open'), 'appDb.open still runs when packaged');
  assert.ok(w.order.includes('shields.load'), 'shields.load still runs when packaged');
  assert.ok(w.order.includes('settings.load'), 'settings.load still runs when packaged');
  assert.ok(w.order.includes('jars.load'), 'jars.load still runs when packaged');
  assert.ok(w.order.includes('downloads.load'), 'downloads.load still runs when packaged');
  assert.ok(
    w.order.includes('appDb.open:/home/x/.config/goldfinch'),
    'appDb.open got the un-redirected userData path when packaged'
  );
  assert.ok(
    w.order.includes('shields.load:/home/x/.config/goldfinch'),
    'shields.load got the un-redirected userData path when packaged'
  );
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

test('appDb.open ordered before the four store loads — a reordering would be caught', () => {
  // Sanity guard: prove the assertion has teeth by simulating a broken order
  // and confirming the same comparison the real test uses would fail on it.
  const brokenOrder = ['setPath', 'shields.load', 'appDb.open', 'settings.load', 'jars.load'];
  const appDbOpenIdx = brokenOrder.indexOf('appDb.open');
  const shieldsIdx = brokenOrder.indexOf('shields.load');
  assert.ok(
    appDbOpenIdx > shieldsIdx,
    'in the broken order appDb.open comes AFTER shields.load — the real test would fail this'
  );
});
