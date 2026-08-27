// @ts-check
'use strict';

// Payment-card identity helpers (issue #152) — pure, main-only CJS.
//
// Used by the capture path to derive the NON-SECRET descriptors of a card from its
// PAN: the network brand and the last four digits, which together are what the
// picker row, the capture offer, and the synthesized item title display. Per
// `vault-item-schema.js`, `brand` and `last4` are declared non-secret; the PAN
// itself never leaves main.
//
// Main-only (not `src/shared/`) because nothing renderer-side needs it: the sheet
// and the picker read the already-stored `brand`/`last4` metadata fields rather
// than re-deriving them from a number they never receive.

// IIN (issuer identification number) prefix ranges, most specific first. This is a
// DISPLAY LABEL ONLY — it never gates a save, and an unrecognized card is stored
// with a null brand rather than refused.
const BRAND_RULES = [
  ['Visa', /^4/],
  ['Mastercard', /^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/],
  ['Amex', /^3[47]/],
  ['Discover', /^(6011|65|64[4-9]|622(12[6-9]|1[3-9]\d|[2-8]\d\d|9[01]\d|92[0-5]))/],
  ['Diners Club', /^3(0[0-5]|[68])/],
  ['JCB', /^35(2[89]|[3-8]\d)/],
  ['UnionPay', /^62/]
];

/**
 * The digits of a card number, with all formatting stripped.
 * @param {any} raw
 * @returns {string}
 */
function digitsOf(raw) {
  return raw == null ? '' : String(raw).replace(/\D/g, '');
}

/**
 * The Luhn check digit test. Used ONLY to decide whether a captured value is
 * plausibly a card number at all — a submitted field that fails Luhn is almost
 * certainly not a PAN, and offering to "save" it would both annoy the operator and
 * write an arbitrary form value into the vault. Never used to reject a card the
 * operator typed by hand into the vault editor.
 * @param {string} digits
 * @returns {boolean}
 */
function luhnValid(digits) {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * True when `raw` is plausibly a payment card number: 12–19 digits (the ISO/IEC
 * 7812 range) that pass Luhn. The capture gate, NOT a validity judgement on
 * operator-entered data.
 * @param {any} raw
 * @returns {boolean}
 */
function isPlausibleCardNumber(raw) {
  const digits = digitsOf(raw);
  if (digits.length < 12 || digits.length > 19) return false;
  return luhnValid(digits);
}

/**
 * The display brand for a card number, or null when no rule matches (stored as
 * null rather than a guess — the operator can set it in the vault editor).
 * @param {any} raw
 * @returns {string | null}
 */
function brandForNumber(raw) {
  const digits = digitsOf(raw);
  if (!digits) return null;
  for (const [brand, re] of BRAND_RULES) {
    if (/** @type {RegExp} */ (re).test(digits)) return /** @type {string} */ (brand);
  }
  return null;
}

/**
 * The last four digits of a card number, or null when there are fewer than four.
 * @param {any} raw
 * @returns {string | null}
 */
function last4Of(raw) {
  const digits = digitsOf(raw);
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/**
 * A self-describing title for a captured card: "Visa •••• 4242", degrading to just
 * the masked digits when the brand is unknown, and to a generic label when even the
 * digits are unusable. Mirrors the login capture path's hostname-title synthesis —
 * SAVE only; an update keeps the operator's own title.
 * @param {any} raw  the card number.
 * @returns {string}
 */
function titleForNumber(raw) {
  const brand = brandForNumber(raw);
  const last4 = last4Of(raw);
  if (brand && last4) return `${brand} •••• ${last4}`;
  if (last4) return `•••• ${last4}`;
  return 'Card';
}

module.exports = { digitsOf, luhnValid, isPlausibleCardNumber, brandForNumber, last4Of, titleForNumber };
