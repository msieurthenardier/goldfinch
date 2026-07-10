// @ts-check
'use strict';

// Profile isolation + store load, ordered so the dev userData redirect lands BEFORE
// any getPath('userData') consumer (Flight 9, Leg 7 / DD8(b)).
//
// Extracted from main.js's whenReady so the ordering invariant is unit-testable with an
// instrumented fake `app` (the test pins source order with zero production cost — see
// test/unit/init-profile-order.test.js). This module is ELECTRON-FREE: the Electron `app`
// and the stores are INJECTED.
//
// THE INVARIANT: app.setPath('userData', …) (dev-profile isolation, app.isPackaged-keyed,
// DD1) MUST run before any consumer that resolves its store path via getPath('userData') —
// shields.load() reads it INTERNALLY; settings.load(path), jars.load(path), and
// downloads.load(path) take the path as an ARG (so the ordering signal for those is the
// getPath('userData') call made HERE to build each arg). Reordering any consumer ahead of
// setPath would silently read the wrong profile.

const { devUserDataPath } = require('../shared/dev-profile');

/**
 * Run the dev profile redirect (unpackaged only) then load the stores in order.
 * @param {{ isPackaged: boolean, setPath: (name: string, value: string) => void, getPath: (name: string) => string }} app
 * @param {{ shields: { load: () => void }, settings: { load: (path: string) => void }, jars: { load: (path: string) => void }, downloads: { load: (path: string) => void } }} stores
 */
function initProfileAndStores(app, { shields, settings, jars, downloads }) {
  // DD1: dev runs are profile-isolated from the installed binary. Keyed off
  // app.isPackaged alone — no flag to forget — so a dev launch can never read or
  // write ~/.config/goldfinch. Must run before ANY getPath('userData') consumer
  // (settings/shields/jars/downloads all resolve their store path at load();
  // shields internally, the rest from the path arg built here).
  if (!app.isPackaged) {
    app.setPath('userData', devUserDataPath(app.getPath('userData')));
  }
  shields.load();
  settings.load(app.getPath('userData'));
  // Jars store (M06 Flight 1, Leg 1): Electron-free — takes the userData path as an
  // arg like settings/downloads (the getPath call here is its ordering signal).
  jars.load(app.getPath('userData'));
  // Downloads store (Flight 5, Leg 1). Only hard ordering constraint is "after the
  // setPath('userData') redirect"; it takes the userData path as an arg like settings.
  downloads.load(app.getPath('userData'));
}

module.exports = { initProfileAndStores };
