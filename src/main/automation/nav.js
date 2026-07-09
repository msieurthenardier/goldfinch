// @ts-check
'use strict';

// Automation engine — native navigation.
//
// Provides navigate/goBack/goForward/reload over a resolved webContents.
//
// SECURITY (DD6): main-process wc.loadURL() bypasses the renderer-side
// will-navigate guard. navigate() re-applies isSafeTabUrl() BEFORE loadURL
// so the engine cannot be used as a hostile-URL bypass path.
//
// SECURITY (DD5): every call resolves through resolveContents, which rejects
// internal-session / bad-handle / dead contents.
//
// SECURITY (DD6, Leg 2): the admin engine builds deps with { allowInternal: true },
// which is resolveContents's SOLE relaxation of the internal-session exclusion — so
// resolveContents alone would let admin drive goldfinch://settings via any nav op.
// Each op therefore carries its OWN op-local isInternalContents guard (mirroring
// zoom.js / print.js / observe.js), placed AFTER resolveContents, so internal pages
// are refused EVEN under the admin key.
//
// ELECTRON-FREE: no require('electron') at the top. Electron handles are
// injected via deps ({ fromId, chromeContents }) so the module is unit-testable
// under plain node --test with fake webContents.
//
// DD8: no webContents.debugger usage. Navigation uses loadURL/goBack/goForward/
// reload only.

const { isSafeTabUrl } = require('../../shared/url-safety');
const { resolveContents, isInternalContents } = require('./resolve');

/**
 * Navigate a webContents to the given URL.
 *
 * Security invariant (DD6): isSafeTabUrl is checked BEFORE resolveContents and
 * BEFORE loadURL — a hostile URL is rejected even if the wcId is also invalid.
 * This closes the main-process loadURL bypass that will-navigate does not cover.
 *
 * goldfinch:// URLs are rejected by isSafeTabUrl (it allows only http/https/
 * about:blank). Non-strings are also rejected (isSafeTabUrl returns false for
 * non-strings — no separate typeof guard needed).
 *
 * Op-local internal-session guard (DD6): runs AFTER resolveContents so it fires
 * even when deps carries allowInternal:true (admin) — admin cannot drive the
 * internal goldfinch://settings partition either.
 *
 * @param {number} wcId   the webContentsId to navigate
 * @param {string} url    the URL to load
 * @param {{ fromId: (id: number) => any, chromeContents?: any, allowInternal?: boolean }} deps
 * @returns {Promise<void>}
 */
async function navigate(wcId, url, deps) {
  if (!isSafeTabUrl(url)) {
    throw new Error('automation: bad-url — refusing to navigate to an unsafe URL: ' + String(url));
  }
  const wc = resolveContents(wcId, deps); // throws on internal/bad/dead (allowInternal forwarded)
  if (isInternalContents(wc)) {
    throw new Error('automation: navigate — internal-session excluded');
  }
  return wc.loadURL(url);
}

/**
 * Navigate the webContents back in history.
 *
 * Electron treats goBack() as a no-op when there is no back history — this is
 * acceptable for v1. If a "nothing to go back to" signal is needed later, add
 * a canGoBack() guard.
 *
 * Op-local internal-session guard (DD6): runs AFTER resolveContents so it fires
 * even under admin's allowInternal:true.
 *
 * @param {number} wcId
 * @param {{ fromId: (id: number) => any, chromeContents?: any, allowInternal?: boolean }} deps
 * @returns {void}
 */
function goBack(wcId, deps) {
  const wc = resolveContents(wcId, deps);
  if (isInternalContents(wc)) {
    throw new Error('automation: goBack — internal-session excluded');
  }
  return wc.goBack();
}

/**
 * Navigate the webContents forward in history.
 *
 * Same no-history no-op note as goBack.
 *
 * Op-local internal-session guard (DD6): runs AFTER resolveContents so it fires
 * even under admin's allowInternal:true.
 *
 * @param {number} wcId
 * @param {{ fromId: (id: number) => any, chromeContents?: any, allowInternal?: boolean }} deps
 * @returns {void}
 */
function goForward(wcId, deps) {
  const wc = resolveContents(wcId, deps);
  if (isInternalContents(wc)) {
    throw new Error('automation: goForward — internal-session excluded');
  }
  return wc.goForward();
}

/**
 * Reload the webContents.
 *
 * Op-local internal-session guard (DD6): runs AFTER resolveContents so it fires
 * even under admin's allowInternal:true.
 *
 * @param {number} wcId
 * @param {{ fromId: (id: number) => any, chromeContents?: any, allowInternal?: boolean }} deps
 * @returns {void}
 */
function reload(wcId, deps) {
  const wc = resolveContents(wcId, deps);
  if (isInternalContents(wc)) {
    throw new Error('automation: reload — internal-session excluded');
  }
  return wc.reload();
}

module.exports = { navigate, goBack, goForward, reload };
