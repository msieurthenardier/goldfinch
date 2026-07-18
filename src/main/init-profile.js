// @ts-check
'use strict';

// Profile isolation + store load, ordered so the dev userData redirect lands BEFORE
// any getPath('userData') consumer (Flight 9, Leg 7 / DD8(b)), and so app-db opens
// immediately after the redirect and before every store that reads/writes through
// it (flight 10-1 DD7/DD9, leg 2 — folded in here from main.js's leg-1 interim
// sibling call).
//
// Extracted from main.js's whenReady so the ordering invariant is unit-testable with an
// instrumented fake `app` (the test pins source order with zero production cost — see
// test/unit/init-profile-order.test.js). This module is ELECTRON-FREE: the Electron `app`
// and the stores are INJECTED.
//
// THE INVARIANT: app.setPath('userData', …) (dev-profile isolation, app.isPackaged-keyed,
// DD1) MUST run before appDb.open(...) and before any consumer that resolves its store
// path via getPath('userData') — shields.load(path) now takes the path as an ARG (leg 2
// dropped its internal getPath call); settings.load(path), jars.load(path), and
// downloads.load(path) also take the path as an ARG (so the ordering signal for those is
// the getPath('userData') call made HERE to build each arg). appDb.open(...) MUST also run
// before shields/settings/jars/downloads' loads — they all read/write through its
// document-row seam. Reordering any consumer ahead of setPath, or any store load ahead of
// appDb.open, would silently read the wrong profile or throw "app db not open".

const { devUserDataPath } = require('../shared/dev-profile');

/**
 * Run the dev profile redirect (unpackaged only), open app-db, then load the
 * stores in order.
 * @param {{ isPackaged: boolean, setPath: (name: string, value: string) => void, getPath: (name: string) => string }} app
 * @param {{
 *   appDb: { open: (userDataPath: string) => void },
 *   shields: { load: (path: string) => void },
 *   settings: { load: (path: string) => void },
 *   jars: { load: (path: string) => void },
 *   downloads: { load: (path: string) => void }
 * }} stores
 */
function initProfileAndStores(app, { appDb, shields, settings, jars, downloads }) {
  // DD1: dev runs are profile-isolated from the installed binary. Keyed off
  // app.isPackaged alone — no flag to forget — so a dev launch can never read or
  // write ~/.config/goldfinch. Must run before ANY getPath('userData') consumer
  // (appDb, then settings/shields/jars/downloads, all resolve their store path
  // at load()/open() — shields and appDb internally, the rest from the path arg
  // built here).
  if (!app.isPackaged) {
    app.setPath('userData', devUserDataPath(app.getPath('userData')));
  }
  // App database open (flight 10-1 DD4/DD7/DD9, leg 2): MUST run before every
  // store load below — settings/downloads/session already read/write through
  // this handle (leg 1), and jars/shields (leg 2) now do too. This is the
  // permanent fix for the leg-1 sibling call's flagged dev-mode ordering nuance
  // (main.js's interim appDb.open ran BEFORE this redirect; here it runs after).
  appDb.open(app.getPath('userData'));
  // Shields (M10 Flight 1, Leg 2 / DD8): Electron-free — takes the userData path
  // as an arg like settings/jars/downloads (the getPath call here is its
  // ordering signal), dropping its former internal app.getPath('userData') call.
  shields.load(app.getPath('userData'));
  settings.load(app.getPath('userData'));
  // Jars store (M06 Flight 1, Leg 1): Electron-free — takes the userData path as an
  // arg like settings/downloads (the getPath call here is its ordering signal).
  jars.load(app.getPath('userData'));
  // Downloads store (Flight 5, Leg 1). Only hard ordering constraint is "after the
  // setPath('userData') redirect"; it takes the userData path as an arg like settings.
  downloads.load(app.getPath('userData'));
}

module.exports = { initProfileAndStores };
