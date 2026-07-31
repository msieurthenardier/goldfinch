// @ts-check
'use strict';

// Pure, Electron-free per-field validator for the bookmark-edit sheet's Done
// submission (M15 F1 Leg 2, flight DD4; folded into ONE rejection path by HAT
// FIX 1, M15 F2 Leg 4 HAT fixes — see register-overlay-ipc.js's handler
// comment). This is the PRE-FORWARD field validation the invoke handler
// (register-overlay-ipc.js) runs BEFORE it ever forwards to the chrome:
// malformed/unsafe/internal URL or an empty field. A failure here means the
// sheet stays open with a generic inline error (close-only-on-success).
//
// The cross-entry `duplicate-url` collision (and a since-vanished `not-found`
// target) used to be STRUCTURALLY INVISIBLE here and surfaced only AFTER
// close, via a chrome-side toast — Flight 1's original "two rejection paths,
// two UXes" contract. H5 found that second UX architecturally invisible (the
// guest view covers the chrome's #toasts), so HAT FIX 1 gives the invoke
// handler its own read-only consult of the bookmarks store, run AFTER this
// validator passes but still BEFORE the sheet closes — both classes of
// rejection now share this validator's inline-error UX. This module itself
// is unchanged; it still only ever sees the one entry being edited.
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
