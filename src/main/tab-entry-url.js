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
const { displayUrl } = require('../shared/display-url');

/**
 * @param {{ view: { webContents: { getURL: () => string } }, lastRequestedUrl?: string | null }} entry
 * @returns {string}
 */
function effectiveUrl(entry) {
  const url = entry.view.webContents.getURL();
  if (isChromeErrorUrl(url) && entry.lastRequestedUrl) return entry.lastRequestedUrl;
  return url;
}

/**
 * The address to load when the chrome asks to navigate a tab. The chrome only ever holds the
 * credential-free DISPLAY form of an address (leg `prompts-and-bounds`), so a Retry from the
 * load-failure panel arrives without the `user:pass@` the failed load carried. ONLY a tab that is
 * currently in the load-failure state qualifies, and only against that failure's own recorded
 * address: when the requested address is EXACTLY the display form of it and it carries credentials,
 * return the recorded one. Anything else - no failure record, a different address, an address
 * without credentials - comes back unchanged. The last-requested address is deliberately NOT a
 * candidate (it is written on every main-frame navigation, page-initiated ones included).
 * @param {{ loadFailure?: { url?: unknown } | null } | null | undefined} entry
 * @param {string} requested
 * @returns {string}
 */
function restoreRecordedCredentials(entry, requested) {
  if (!entry || typeof requested !== 'string') return requested;
  const { loadFailure } = entry;
  const failed = loadFailure && loadFailure.url;
  if (typeof failed === 'string' && failed !== requested && displayUrl(failed) === requested) return failed;
  return requested;
}

module.exports = { effectiveUrl, restoreRecordedCredentials };
