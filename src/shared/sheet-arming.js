// @ts-check

// The sheet's ARMING axis (Mission 23 Flight 1, leg `vault-picker-controls`, DD7 as amended at design
// review): a menu type listed here ignores activation for a short delay after every open, so a stray Enter,
// a double-click or a click the operator never meant to give cannot pick a row the instant the card rises.
//
// The delay is derived IN THE SHEET from its own menu type and this one table - no chrome-set flag and no
// main-side re-derivation (the sheet already takes its menu type from main's init). Applied as a TIMESTAMP
// GATE inside the sheet's shared one-shot activation sender (`createSheetReport.begin(token, delayMs)` in
// `modal-card-controller.js`), never a timer: a timestamp cannot be starved by timer throttling in a hidden
// document, and a swallowed activation leaves the one-shot latch unset so a later one still works.
//
// Listed: `vault-picker` (leg `vault-picker-controls`) and `cert-picker` (leg `prompts-and-bounds`, operator
// ruling: the sign-in card and the certificate-error Proceed deliberately do NOT opt in). Every menu type
// not listed opens with a zero delay and behaves exactly as before.
// Dismissals (Escape, the header close control, the backdrop, the vault picker's confirmation-view Cancel and
// the certificate picker's Cancel row) never pass through the activation sender, so they are never delayed.
// The gate reads the wall clock on purpose: a clock step can only lengthen or shorten one open's delay by
// its own size.
//
// Drift guard: `test/unit/sheet-arming.test.js` asserts every listed type is one of the sheet's templates
// (the template table is private to `menu-overlay.js`, so that guard is a source scan).

/** Milliseconds an opted-in menu type ignores activation after an open. */
export const VAULT_PICKER_ARMING_MS = 500;

/** Milliseconds the client-certificate picker ignores activation after an open. */
export const CERT_PICKER_ARMING_MS = 500;

/** @type {Readonly<Record<string, number>>} */
export const ARMING_DELAY_MS = Object.freeze({
  'vault-picker': VAULT_PICKER_ARMING_MS,
  'cert-picker': CERT_PICKER_ARMING_MS
});

/**
 * The arming delay for a menu type (0 for every type not listed).
 * @param {unknown} menuType
 * @returns {number}
 */
export function armingDelayFor(menuType) {
  return typeof menuType === 'string' && Object.prototype.hasOwnProperty.call(ARMING_DELAY_MS, menuType)
    ? ARMING_DELAY_MS[menuType]
    : 0;
}
