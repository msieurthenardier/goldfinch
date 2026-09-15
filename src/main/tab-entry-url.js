// @ts-check
'use strict';

// Mission 20 Flight 1 (DD4): the single substitution point for "what URL does
// this tab entry actually show." Chromium commits a failed navigation to a
// `chrome-error://chromewebdata/` document; `effectiveUrl` hides that from
// every consumer (the `did-navigate` push, the session snapshot, the
// closed-tab-stack capture) so none of them special-cases the scheme itself.
//
// Order-independent by design (leg-1 DD4 refinement): substitutes whenever the
// LIVE URL is a chrome-error: URL and `lastRequestedUrl` is non-null — not
// only while `entry.loadFailure` is set. The error document's own
// `did-navigate` may fire BEFORE `did-fail-load` records the failure, so a
// predicate gated on `loadFailure` would miss that ordering; reading the live
// URL directly is safe either way.
//
// Electron-free (the settings-store.js / bookmarks-store.js precedent): a CJS
// `require` of the ESM shared model, the established main-side pattern.

const { isChromeErrorUrl } = require('../shared/load-failure');

/**
 * @param {{ view: { webContents: { getURL: () => string } }, lastRequestedUrl?: string | null }} entry
 * @returns {string}
 */
function effectiveUrl(entry) {
  const url = entry.view.webContents.getURL();
  if (isChromeErrorUrl(url) && entry.lastRequestedUrl) return entry.lastRequestedUrl;
  return url;
}

module.exports = { effectiveUrl };
