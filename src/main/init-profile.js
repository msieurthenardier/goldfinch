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
// shields.load() and jars.load() read it INTERNALLY; settings.load(path) takes the path as
// an ARG (so the ordering signal for settings is the getPath('userData') call made HERE to
// build that arg). Reordering any consumer ahead of setPath would silently read the wrong
// profile.

const { devUserDataPath } = require('../shared/dev-profile');

/**
 * Run the dev profile redirect (unpackaged only) then load the stores in order.
 * @param {{ isPackaged: boolean, setPath: (name: string, value: string) => void, getPath: (name: string) => string }} app
 * @param {{ shields: { load: () => void }, settings: { load: (path: string) => void }, jars: { load: () => void }, downloads: { load: (path: string) => void } }} stores
 */
function initProfileAndStores(app, { shields, settings, jars, downloads }) {
  // DD1: dev runs are profile-isolated from the installed binary. Keyed off
  // app.isPackaged alone — no flag to forget — so a dev launch can never read or
  // write ~/.config/goldfinch. Must run before ANY getPath('userData') consumer
  // (settings/shields/jars/downloads all resolve their store path at load()).
  if (!app.isPackaged) {
    app.setPath('userData', devUserDataPath(app.getPath('userData')));
  }
  shields.load();
  settings.load(app.getPath('userData'));
  jars.load();
  // Downloads store (Flight 5, Leg 1). Only hard ordering constraint is "after the
  // setPath('userData') redirect"; it takes the userData path as an arg like settings.
  downloads.load(app.getPath('userData'));
}

module.exports = { initProfileAndStores };
