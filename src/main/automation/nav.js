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
// ELECTRON-FREE: no require('electron') at the top. Electron handles are
// injected via deps ({ fromId, chromeContents }) so the module is unit-testable
// under plain node --test with fake webContents.
//
// DD8: no webContents.debugger usage. Navigation uses loadURL/goBack/goForward/
// reload only.

const { isSafeTabUrl } = require('../../shared/url-safety');
const { resolveContents } = require('./resolve');

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
 * @param {number} wcId   the webContentsId to navigate
 * @param {string} url    the URL to load
 * @param {{ fromId: (id: number) => any, chromeContents: any }} deps
 * @returns {Promise<void>}
 */
async function navigate(wcId, url, { fromId, chromeContents }) {
  if (!isSafeTabUrl(url)) {
    throw new Error('automation: bad-url — refusing to navigate to an unsafe URL: ' + String(url));
  }
  const wc = resolveContents(wcId, { fromId, chromeContents }); // throws on internal/bad/dead
  return wc.loadURL(url);
}

/**
 * Navigate the webContents back in history.
 *
 * Electron treats goBack() as a no-op when there is no back history — this is
 * acceptable for v1. If a "nothing to go back to" signal is needed later, add
 * a canGoBack() guard.
 *
 * @param {number} wcId
 * @param {{ fromId: (id: number) => any, chromeContents: any }} deps
 * @returns {void}
 */
function goBack(wcId, { fromId, chromeContents }) {
  const wc = resolveContents(wcId, { fromId, chromeContents });
  return wc.goBack();
}

/**
 * Navigate the webContents forward in history.
 *
 * Same no-history no-op note as goBack.
 *
 * @param {number} wcId
 * @param {{ fromId: (id: number) => any, chromeContents: any }} deps
 * @returns {void}
 */
function goForward(wcId, { fromId, chromeContents }) {
  const wc = resolveContents(wcId, { fromId, chromeContents });
  return wc.goForward();
}

/**
 * Reload the webContents.
 *
 * @param {number} wcId
 * @param {{ fromId: (id: number) => any, chromeContents: any }} deps
 * @returns {void}
 */
function reload(wcId, { fromId, chromeContents }) {
  const wc = resolveContents(wcId, { fromId, chromeContents });
  return wc.reload();
}

module.exports = { navigate, goBack, goForward, reload };
