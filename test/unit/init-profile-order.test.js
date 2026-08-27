'use strict';

// Unit tests for the appDb.open-before-store-loads ordering invariant, re-pinned
// twice: first for the flight 10-1 DD9 reshape (leg 2, appDb.open folded into
// initProfileAndStores as its first internal step), then for squawk 0017
// (GitHub issue #121), which moved the dev-profile userData redirect OUT of this
// module and into main.js module scope, before app.whenReady() — see
// test/unit/dev-profile-redirect-order.test.js for that placement's own
// source-order pin. This module no longer performs or knows about the redirect;
// it only owns appDb.open(...) running before every store load.
//
// initProfileAndStores(app, { appDb, shields, settings, jars, downloads, bookmarks })
// MUST run appDb.open(...) BEFORE any consumer that resolves its store path via
// getPath('userData') — else a store load races app-db's open.
//
// The seam: shields.load(path) takes the path as an ARG (leg 2 dropped its
// former internal getPath call), like settings.load(path), jars.load(path),
// downloads.load(path), and bookmarks.load(path) (Flight 1 "Bookmarking Core and
// Surfaces" Leg 1) — so the ordering signal for all five is the
// getPath('userData') call initProfileAndStores makes to build each arg.
// appDb.open(...) records its own call directly (it takes the resolved path,
// not a store-recorded one). The fake app's getPath records every call, and the
// fake stores' load()/open() record theirs, into ONE shared call-order array.
// We assert appDb.open's index precedes every consumer index.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { initProfileAndStores } = require('../../src/main/init-profile');

// A fake Electron app + fake app-db + fake stores sharing one call-order array.
// getPath returns a FIXED userData path — this module no longer redirects it
// (main.js does, upstream, before this function ever runs); simulating a
// pre-redirected -dev path here would only be testing pass-through, not an
// ordering invariant this module owns.
function makeWorld() {
  const order = [];
  const userData = '/home/x/.config/goldfinch-dev';
  const app = {
    getPath: (name) => {
      assert.equal(name, 'userData', 'consumers resolve the userData dir');
      order.push('getPath');
      return userData;
    }
  };
  const appDb = {
    open: (p) => {
      order.push('appDb.open');
      order.push(`appDb.open:${p}`);
    }
  };
  const stores = {
    shields: {
      load: (p) => {
        order.push('shields.load');
        order.push(`shields.load:${p}`);
      }
    },
    settings: {
      load: (p) => {
        order.push('settings.load');
        order.push(`settings.load:${p}`);
      }
    },
    jars: {
      load: (p) => {
        order.push('jars.load');
        order.push(`jars.load:${p}`);
      }
    },
    downloads: {
      load: (p) => {
        order.push('downloads.load');
        order.push(`downloads.load:${p}`);
      }
    },
    bookmarks: {
      load: (p) => {
        order.push('bookmarks.load');
        order.push(`bookmarks.load:${p}`);
      }
    }
  };
  return { app, appDb, stores, order };
}

// Index of the FIRST occurrence of a marker (consumers run once each).
function idx(order, marker) {
  const i = order.indexOf(marker);
  assert.notEqual(i, -1, `expected ${marker} to have run`);
  return i;
}

test('appDb.open runs before every getPath(userData) store-load consumer', () => {
  const w = makeWorld();
  initProfileAndStores(w.app, { appDb: w.appDb, ...w.stores });

  const appDbOpenIdx = idx(w.order, 'appDb.open');
  assert.ok(appDbOpenIdx < idx(w.order, 'shields.load'), 'appDb.open before shields.load');
  assert.ok(appDbOpenIdx < idx(w.order, 'settings.load'), 'appDb.open before settings.load');
  assert.ok(appDbOpenIdx < idx(w.order, 'jars.load'), 'appDb.open before jars.load');
  assert.ok(appDbOpenIdx < idx(w.order, 'downloads.load'), 'appDb.open before downloads.load');
  assert.ok(appDbOpenIdx < idx(w.order, 'bookmarks.load'), 'appDb.open before bookmarks.load');

  // And every store received the SAME userData path this function was given
  // (this module trusts app.getPath('userData') verbatim — the redirect, if
  // any, already happened upstream in main.js before this function ran).
  assert.ok(w.order.includes('appDb.open:/home/x/.config/goldfinch-dev'), 'appDb.open got the userData path as given');
  assert.ok(
    w.order.includes('shields.load:/home/x/.config/goldfinch-dev'),
    'shields.load got the userData path as given'
  );
  assert.ok(
    w.order.includes('settings.load:/home/x/.config/goldfinch-dev'),
    'settings.load got the userData path as given'
  );
  assert.ok(w.order.includes('jars.load:/home/x/.config/goldfinch-dev'), 'jars.load got the userData path as given');
  assert.ok(
    w.order.includes('downloads.load:/home/x/.config/goldfinch-dev'),
    'downloads.load got the userData path as given'
  );
  assert.ok(
    w.order.includes('bookmarks.load:/home/x/.config/goldfinch-dev'),
    'bookmarks.load got the userData path as given'
  );
});

test('appDb.open ordered before the four store loads — a reordering would be caught', () => {
  // Sanity guard: prove the assertion has teeth by simulating a broken order
  // and confirming the same comparison the real test uses would fail on it.
  const brokenOrder = ['shields.load', 'appDb.open', 'settings.load', 'jars.load'];
  const appDbOpenIdx = brokenOrder.indexOf('appDb.open');
  const shieldsIdx = brokenOrder.indexOf('shields.load');
  assert.ok(
    appDbOpenIdx > shieldsIdx,
    'in the broken order appDb.open comes AFTER shields.load — the real test would fail this'
  );
});
