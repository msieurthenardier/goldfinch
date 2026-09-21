'use strict';

// Shared field-value setters for the guest main-world preload (Mission 21,
// Flight 3, Leg 3 — identity-fill, LD1). Extracted VERBATIM from
// vault-card-fields.js's private `setFieldValue`/`setChoiceValue` — the same
// "pull a shared primitive into its own module" shape Flight 2 Leg 1 used for
// field-tokenizer.js (also extracted out of vault-card-fields.js).
//
// WHY THIS MOVE, NOT A THIRD COPY: identity needs both setters too (country and
// region are routinely `<select>`s, just like card's expiry month/year). A
// second private `setFieldValue` copy already existed in `vault-fill-fields.js`
// at this leg's time (the one that used to live here, plus that one); creating
// a THIRD private copy for identity would be the exact drift risk this leg's
// other extractions (LD1's own precedent, AC3b's IDENTITY_ROLES) are written to
// avoid. The login copy was deliberately left alone at this leg (see squawk
// 0097) and consolidated onto this module afterward, at squawk-completion time
// (confirmed byte-identical first) — login, card, and identity all `require()`
// this module now.

/**
 * Set a field's value and dispatch the bubbling input + change events a live
 * page's framework listeners expect.
 * @param {any} field
 * @param {string} value
 */
function setFieldValue(field, value) {
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Set a `<select>` to the first candidate matching an option's value or text; for
 * a non-select, set the first candidate directly. Month/year pickers (and
 * country/region pickers) are selects often enough that a blind
 * `.value = '2028'` would silently no-op against options valued `28`.
 * @param {any} field
 * @param {string[]} candidates  preferred value spellings, most preferred first.
 * @returns {string | null}  the string ACTUALLY written, or null when nothing
 *   matched and the select was left untouched (M21 F1 Leg 3, DD3h) — a `<select>`
 *   match can diverge from the requested candidate (option value vs. text, short
 *   vs. full year), so the caller must bind provenance to what was really written.
 */
function setChoiceValue(field, candidates) {
  const tag = String(field.tagName == null ? '' : field.tagName).toLowerCase();
  if (tag !== 'select') {
    setFieldValue(field, candidates[0]);
    return candidates[0];
  }
  const options = Array.from(field.options || []);
  for (const candidate of candidates) {
    const hit = options.find((/** @type {any} */ o) => {
      const value = o.value == null ? '' : String(o.value);
      const text = o.textContent == null ? '' : String(o.textContent).trim();
      return value === candidate || text === candidate;
    });
    if (hit) {
      const written = /** @type {any} */ (hit).value;
      setFieldValue(field, written);
      return written;
    }
  }
  // No option matched — leave the select untouched rather than forcing an invalid
  // value that the page would reject on submit.
  return null;
}

module.exports = { setFieldValue, setChoiceValue };
