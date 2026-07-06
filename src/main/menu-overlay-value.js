// @ts-check
'use strict';

// Channel-4 `value` hardening (M05 Flight 8, Leg 3 / AC5). The menu-overlay
// sheet's `menu-overlay:activated` payload may carry an optional `value` string
// (the input-dialog's text — e.g. the new-container name). Main validates the
// shape here BEFORE forwarding on channel 6; the chrome treats it as data (the
// existing new-container-create path validates the name again).
//
// Pure and Electron-free so it is `node --test`-able — the ipcMain handler in
// main.js is the (untestable) consumer; this helper is the unit-test target.
// The manager (menu-overlay-manager.js) never touches channel 4 — no manager
// involvement by design.

// Matches the dialog input's maxlength (menu-overlay sheet input-dialog template;
// parity with the chrome dialog's #new-container-name maxlength=24).
const MAX_ACTIVATED_VALUE_LENGTH = 24;

/**
 * Sanitize a sheet-reported activation `value`: a string of length ≤ 24 passes
 * through unchanged; anything else (non-string, oversize) is DROPPED — the
 * channel-6 payload is forwarded without `value`.
 * @param {any} value
 * @returns {string | undefined}
 */
function sanitizeActivatedValue(value) {
  return typeof value === 'string' && value.length <= MAX_ACTIVATED_VALUE_LENGTH ? value : undefined;
}

module.exports = { sanitizeActivatedValue, MAX_ACTIVATED_VALUE_LENGTH };
