// @ts-check
'use strict';

// Store load, ordered so app-db opens before every store that reads/writes through
// it (flight 10-1 DD7/DD9, leg 2 — folded in here from main.js's leg-1 interim
// sibling call).
//
// Extracted from main.js's whenReady so the ordering invariant is unit-testable with an
// instrumented fake `app` (the test pins source order with zero production cost — see
// test/unit/init-profile-order.test.js). This module is ELECTRON-FREE: the Electron `app`
// and the stores are INJECTED.
//
// The dev-profile userData redirect (app.isPackaged-keyed, DD1) is NOT this module's
// concern — squawk 0017 (GitHub issue #121) moved it to main.js MODULE SCOPE, before
// app.whenReady(), so Electron resolves the browser process's (and every Chromium child
// process's) --user-data-dir from the -dev path rather than the real profile. By the time
// this function runs, app.getPath('userData') already reflects that redirect.
//
// THE INVARIANT THIS MODULE STILL OWNS: appDb.open(...) MUST run before any consumer that
// resolves its store path via getPath('userData') — shields.load(path) takes the path as
// an ARG (leg 2 dropped its internal getPath call); settings.load(path), jars.load(path),
// downloads.load(path), and bookmarks.load(path) (Flight 1 "Bookmarking Core and
// Surfaces" Leg 1 — jars.js's own collection-store template) also take the path as an ARG
// (so the ordering signal for those is the getPath('userData') call made HERE to build
// each arg). appDb.open(...) MUST run before shields/settings/jars/downloads/bookmarks'
// loads — they all read/write through its document-row seam. Reordering any store load
// ahead of appDb.open would silently throw "app db not open".

/**
 * Open app-db, then load the stores in order.
 * @param {{ getPath: (name: string) => string }} app
 * @param {{
 *   appDb: { open: (userDataPath: string) => void },
 *   shields: { load: (path: string) => void },
 *   settings: { load: (path: string) => void },
 *   jars: { load: (path: string) => void },
 *   downloads: { load: (path: string) => void },
 *   bookmarks: { load: (path: string) => void }
 * }} stores
 */
function initProfileAndStores(app, { appDb, shields, settings, jars, downloads, bookmarks }) {
  // App database open (flight 10-1 DD4/DD7/DD9, leg 2): MUST run before every
  // store load below — settings/downloads/session already read/write through
  // this handle (leg 1), and jars/shields (leg 2) now do too. Runs AFTER the
  // dev-profile userData redirect, which by squawk 0017 now happens upstream at
  // main.js module scope, before app.whenReady() ever calls this function.
  appDb.open(app.getPath('userData'));
  // Shields (M10 Flight 1, Leg 2 / DD8): Electron-free — takes the userData path
  // as an arg like settings/jars/downloads (the getPath call here is its
  // ordering signal), dropping its former internal app.getPath('userData') call.
  shields.load(app.getPath('userData'));
  settings.load(app.getPath('userData'));
  // Jars store (M06 Flight 1, Leg 1): Electron-free — takes the userData path as an
  // arg like settings/downloads (the getPath call here is its ordering signal).
  jars.load(app.getPath('userData'));
  // Downloads store (Flight 5, Leg 1). Only hard ordering constraint is "after
  // appDb.open"; it takes the userData path as an arg like settings.
  downloads.load(app.getPath('userData'));
  // Bookmarks store (Flight 1 "Bookmarking Core and Surfaces", Leg 1 / DD1): follows
  // the jars.js collection-store template — takes the userData path as an arg like
  // every sibling store above. Only hard ordering constraint is "after appDb.open".
  bookmarks.load(app.getPath('userData'));
}

module.exports = { initProfileAndStores };
