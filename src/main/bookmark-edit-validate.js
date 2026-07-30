// @ts-check
'use strict';

// Pure, Electron-free per-field validator for the bookmark-edit sheet's Done
// submission (M15 F1 Leg 2, flight DD4/AC "two rejection paths, two UXes").
// This is rejection path (a) — the PRE-FORWARD validation the invoke handler
// (register-overlay-ipc.js) runs BEFORE it ever forwards to the chrome:
// malformed/unsafe/internal URL or an empty field. A failure here means the
// sheet stays open with a generic inline error (close-only-on-success).
//
// Rejection path (b) — a cross-entry `duplicate-url` collision — is
// STRUCTURALLY INVISIBLE here (this validator never sees the other entries;
// only the main-side store does). That surfaces only AFTER close, via the
// chrome's own bookmarkUpdate call — see register-overlay-ipc.js's handler
// comment and the leg's Edge Cases. A `reason:'invalid-url'` response from the
// store POST-close should therefore be unreachable given this validator running
// first — asserted in that handler's comment, not re-asserted here.
//
// Mirrors bookmarks-store.js's own `validUrl` predicate exactly (not imported —
// that module is stateful/store-scoped; this is the menu-overlay-value.js
// testability pattern: a small, pure, Electron-free, unit-tested sibling).

const { isSafeTabUrl } = require('../shared/url-safety');

/**
 * @param {unknown} v
 * @returns {v is string}
 */
function validUrl(v) {
  return typeof v === 'string' && isSafeTabUrl(v) && v.trim().toLowerCase() !== 'about:blank';
}

/**
 * Validate the bookmark-edit sheet's Done fields. Both fields are required and
 * trimmed; the url must pass the same safety predicate the store itself
 * enforces (never NEEDLESSLY widened — `isSafeTabUrl` already rejects
 * `goldfinch://` and every other non-http(s) scheme).
 * @param {{ name?: unknown, url?: unknown }} [fields]
 * @returns {{ ok: true, name: string, url: string } | { ok: false }}
 */
function validateBookmarkEditFields({ name, url } = {}) {
  if (typeof name !== 'string' || !name.trim()) return { ok: false };
  if (!validUrl(url)) return { ok: false };
  return { ok: true, name: name.trim(), url: /** @type {string} */ (url).trim() };
}

module.exports = { validateBookmarkEditFields };
