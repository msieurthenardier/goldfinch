// @ts-check
'use strict';

// Pure payment-card field-selection + fill helpers for the guest main-world
// preload (issue #152). The CARD twin of vault-fill-fields.js, factored out for
// the same reason: the preload itself cannot be required under `node --test` (its
// top-level `window` / MutationObserver / ipcRenderer side-effects throw in plain
// Node), so the testable core lives here and the preload requires it.
//
// WHY THIS IS NOT AN EXTENSION OF vault-fill-fields.js: a login form has ONE
// structural anchor (`input[type=password]`) that the browser itself identifies.
// A card form has no such type — every card field is `text` / `tel` / a `<select>`
// — so detection is ROLE-based off the `autocomplete` token (the WHATWG
// autofill-detail tokens: `cc-number`, `cc-name`, `cc-exp`, `cc-exp-month`,
// `cc-exp-year`, `cc-csc`), with a deliberately narrow name/id fallback for the
// many checkouts that ship no hints at all.
//
// DOM SURFACE (pinned by the unit suite so the fake document models it exactly):
//   - a card entry is anchored on a detected `cc-number` field;
//   - its scope is `number.form` (fallback `number.closest('form')`, fallback the
//     whole document for a form-less field);
//   - the remaining roles are resolved WITHIN that scope, first match wins;
//   - filling sets `.value` and dispatches bubbling `input` + `change` events —
//     the same contract as the login path, which live frameworks depend on;
//   - no `cc-number` field → nothing is detected and nothing is filled.
//
// FALSE POSITIVES ARE THE RISK TO MANAGE, not false negatives: a spurious card
// entry puts a lock icon on an unrelated field (cosmetic) and, worse, lets a
// capture offer read an unrelated value as a PAN. The fallback below is therefore
// anchored on `number`-ish names only and is skipped entirely whenever the field
// carries ANY `cc-*` autocomplete token elsewhere in the form (a form that hints
// at all is trusted to hint completely).

/** Field types that can carry a card value. A `password`-typed field is NEVER a
 * card field — that would collide with the login anchor. */
const CARD_INPUT_TYPES = new Set(['', 'text', 'tel', 'number']);

/** WHATWG autofill-detail tokens → our internal role names. */
const AUTOCOMPLETE_ROLES = new Map([
  ['cc-number', 'number'],
  ['cc-name', 'cardholder'],
  ['cc-given-name', 'cardholderGiven'],
  ['cc-family-name', 'cardholderFamily'],
  ['cc-exp', 'expiry'],
  ['cc-exp-month', 'expMonth'],
  ['cc-exp-year', 'expYear'],
  ['cc-csc', 'csc']
]);

// Narrow name/id/placeholder fallbacks, used ONLY on forms that carry no `cc-*`
// autocomplete token at all. Ordered most- to least-specific; `number` is
// deliberately strict (a bare /number/ would match quantity, phone, house number).
const FALLBACK_PATTERNS = [
  ['number', /(card|cc|creditcard|pan)[-_ ]?(number|num|no)\b|^ccnumber$|^cardnumber$/i],
  ['csc', /\b(cvv|cvc|csc|cvv2|securitycode|security[-_ ]?code|card[-_ ]?code)\b/i],
  ['expMonth', /\b(exp|expiry|expiration)[-_ ]?(month|mm)\b|^ccmonth$|^expmonth$/i],
  ['expYear', /\b(exp|expiry|expiration)[-_ ]?(year|yy|yyyy)\b|^ccyear$|^expyear$/i],
  ['expiry', /\b(exp|expiry|expiration)([-_ ]?date)?\b|^ccexp$/i],
  ['cardholder', /\b(card[-_ ]?holder|name[-_ ]?on[-_ ]?card|cc[-_ ]?name)\b/i]
];

/**
 * The `autocomplete` role token of a field, or null. Tokenizes the full attribute
 * so section/billing/shipping prefixes (`section-x billing cc-number`) resolve to
 * the same role as a bare `cc-number` — the spec allows an arbitrary prefix chain
 * and real checkouts use it.
 * @param {any} field
 * @returns {string | null}
 */
function autocompleteRoleOf(field) {
  if (!field) return null;
  const raw = typeof field.getAttribute === 'function' ? field.getAttribute('autocomplete') : null;
  const value = raw != null ? raw : field.autocomplete;
  if (value == null || value === '') return null;
  for (const token of String(value).toLowerCase().split(/\s+/)) {
    const role = AUTOCOMPLETE_ROLES.get(token);
    if (role) return role;
  }
  return null;
}

/**
 * True when a field can structurally hold a card value: an `<input>` of a card-
 * compatible type, or a `<select>` (month/year pickers are routinely selects).
 * A `password` input is excluded by construction.
 * @param {any} field
 * @returns {boolean}
 */
function isCardCapableField(field) {
  if (!field) return false;
  const tag = String(field.tagName == null ? '' : field.tagName).toLowerCase();
  if (tag === 'select') return true;
  if (tag !== 'input' && tag !== '') return false;
  const type = String(field.type == null ? '' : field.type).toLowerCase();
  return CARD_INPUT_TYPES.has(type);
}

/**
 * The fallback role of a field from its name / id / placeholder, or null. Only
 * consulted for scopes with NO `cc-*` autocomplete token anywhere (see header).
 * @param {any} field
 * @returns {string | null}
 */
function fallbackRoleOf(field) {
  if (!isCardCapableField(field)) return null;
  const hay = [field.name, field.id, field.placeholder, field.getAttribute?.('aria-label')]
    .filter((v) => v != null && v !== '')
    .join(' ');
  if (!hay) return null;
  for (const [role, re] of FALLBACK_PATTERNS) {
    if (/** @type {RegExp} */ (re).test(hay)) return /** @type {string} */ (role);
  }
  return null;
}

/**
 * Every field in `scope` that can hold a card value, in document order.
 * @param {any} scope  a form-like or document-like object exposing querySelectorAll.
 * @returns {any[]}
 */
function candidateFields(scope) {
  if (!scope || typeof scope.querySelectorAll !== 'function') return [];
  return Array.from(scope.querySelectorAll('input, select')).filter(isCardCapableField);
}

/**
 * Resolve each field in `scope` to a card role. Returns a role→field map (first
 * match per role wins — a checkout with a hidden duplicate keeps the first live
 * one, which is the same first-wins discipline the login path uses).
 *
 * Two-pass by design: the autocomplete pass is authoritative, and the name/id
 * fallback runs ONLY when the scope produced no autocomplete role at all. A form
 * that hints even once is trusted to hint completely, so a `cc-number`-hinted
 * form never picks up a fallback-matched "expiry" from an unrelated field.
 * @param {any} scope
 * @returns {Map<string, any>}
 */
function rolesIn(scope) {
  const fields = candidateFields(scope);
  /** @type {Map<string, any>} */
  const roles = new Map();
  for (const field of fields) {
    const role = autocompleteRoleOf(field);
    if (role && !roles.has(role)) roles.set(role, field);
  }
  if (roles.size > 0) return roles;
  for (const field of fields) {
    const role = fallbackRoleOf(field);
    if (role && !roles.has(role)) roles.set(role, field);
  }
  return roles;
}

/**
 * Build one card entry from a role map. `number` is required by the caller.
 * @param {Map<string, any>} roles
 * @param {any} scope
 * @returns {{ number: any, cardholder: any, expiry: any, expMonth: any, expYear: any, csc: any, form: any }}
 */
function entryFromRoles(roles, scope) {
  return {
    number: roles.get('number') || null,
    // A split given/family name pair has no single fill target; prefer the whole-name
    // field and fall back to the given-name field (filling the full name there beats
    // filling nothing, and the operator can correct it).
    cardholder: roles.get('cardholder') || roles.get('cardholderGiven') || null,
    expiry: roles.get('expiry') || null,
    expMonth: roles.get('expMonth') || null,
    expYear: roles.get('expYear') || null,
    csc: roles.get('csc') || null,
    form: scope && scope.tagName ? scope : null
  };
}

/**
 * Enumerate every detected card entry in the document (document order by anchor),
 * one per `cc-number` field. A field inside a `<form>` scopes to that form; a
 * form-less field scopes to the whole document (so a form-less checkout still
 * resolves its expiry/csc siblings). Returns `[]` when no card number field is
 * detected. Pure: reads only the passed `doc`.
 * @param {any} doc  a `document`-like object exposing querySelectorAll.
 * @returns {Array<{ number: any, cardholder: any, expiry: any, expMonth: any, expYear: any, csc: any, form: any }>}
 */
function findAllCardFields(doc) {
  if (!doc || typeof doc.querySelectorAll !== 'function') return [];

  // Resolve roles per FORM first (the common case), then handle form-less numbers
  // against the document scope. A form is visited once even if it holds several
  // card-number-ish fields — the first is the anchor.
  const seenScopes = new Set();
  const out = [];
  for (const field of candidateFields(doc)) {
    const form = field.form || (typeof field.closest === 'function' ? field.closest('form') : null);
    const scope = form || doc;
    if (seenScopes.has(scope)) continue;
    const roles = rolesIn(scope);
    const number = roles.get('number');
    if (!number) {
      // Mark a FORM scope resolved even on a miss so we don't re-walk it per field;
      // the document scope stays unmarked so a later form-less number can still match.
      if (form) seenScopes.add(scope);
      continue;
    }
    seenScopes.add(scope);
    out.push(entryFromRoles(roles, scope));
  }
  return out;
}

/**
 * The first detected card entry, or null. The card twin of `findLoginFields`.
 * @param {any} doc
 * @returns {{ number: any, cardholder: any, expiry: any, expMonth: any, expYear: any, csc: any, form: any } | null}
 */
function findCardFields(doc) {
  const all = findAllCardFields(doc);
  return all.length ? all[0] : null;
}

/**
 * Is `field` one of the card-number inputs CURRENTLY present in `doc`? The card
 * twin of `isLivePasswordField` — a gesture target is validated against the live
 * document immediately before filling, so a stale / detached / spoofed node can
 * never be filled.
 * @param {any} doc
 * @param {any} field
 * @returns {boolean}
 */
function isLiveCardNumberField(doc, field) {
  if (!field || !doc) return false;
  return findAllCardFields(doc).some((entry) => entry.number === field);
}

/**
 * Parse a stored expiry string into `{ month: 'MM', year: 'YYYY' }`, or null when
 * it does not parse. Accepts the shapes operators actually type: `MM/YY`,
 * `MM/YYYY`, `MM-YY`, `MM YY`, `MMYY`, `MMYYYY`. A 2-digit year resolves into the
 * 2000s — a payment card expiring in the 1900s is not a case worth modeling.
 * @param {any} raw
 * @returns {{ month: string, year: string } | null}
 */
function parseExpiry(raw) {
  if (raw == null) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length !== 4 && digits.length !== 6) return null;
  const month = digits.slice(0, 2);
  const monthNum = Number(month);
  if (!(monthNum >= 1 && monthNum <= 12)) return null;
  const rest = digits.slice(2);
  const year = rest.length === 2 ? `20${rest}` : rest;
  return { month, year };
}

/**
 * Set a field's value and dispatch the bubbling input + change events a live
 * page's framework listeners expect. Identical contract to the login path's
 * setFieldValue (duplicated rather than shared: the two modules are independently
 * requirable and this is three lines).
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
 * a non-select, set the first candidate directly. Month/year pickers are selects
 * often enough that a blind `.value = '2028'` would silently no-op against options
 * valued `28`.
 * @param {any} field
 * @param {string[]} candidates  preferred value spellings, most preferred first.
 */
function setChoiceValue(field, candidates) {
  const tag = String(field.tagName == null ? '' : field.tagName).toLowerCase();
  if (tag !== 'select') {
    setFieldValue(field, candidates[0]);
    return;
  }
  const options = Array.from(field.options || []);
  for (const candidate of candidates) {
    const hit = options.find((/** @type {any} */ o) => {
      const value = o.value == null ? '' : String(o.value);
      const text = o.textContent == null ? '' : String(o.textContent).trim();
      return value === candidate || text === candidate;
    });
    if (hit) {
      setFieldValue(field, /** @type {any} */ (hit).value);
      return;
    }
  }
  // No option matched — leave the select untouched rather than forcing an invalid
  // value that the page would reject on submit.
}

/**
 * The value to write into a COMBINED `cc-exp` field. Honors the field's own
 * `maxLength` when it is set: a 7-char field wants `MM/YYYY`, anything shorter
 * (or unset) gets the near-universal `MM/YY`.
 * @param {any} field
 * @param {{ month: string, year: string }} exp
 * @returns {string}
 */
function formatCombinedExpiry(field, exp) {
  const max = Number(field && field.maxLength);
  const wantsFullYear = Number.isFinite(max) && max >= 7;
  return wantsFullYear ? `${exp.month}/${exp.year}` : `${exp.month}/${exp.year.slice(-2)}`;
}

/**
 * Fill the TOP-FRAME card form on `doc` with `card`. Top-frame only: never fills
 * inside an iframe (defense in depth atop the main-frame-only `webContents.send`).
 * No card-number field → no-op. Returns a small status object — NEVER the card.
 *
 * `targetNumber` is the gesture-bound anchor (the card-number field the clicked
 * lock icon decorated), validated live here exactly as the login path validates
 * its password target: a stale / detached / foreign node falls back to the first
 * detected entry.
 * @param {any} doc
 * @param {{ number?: string|null, cardholder?: string|null, expiry?: string|null, cvv?: string|null } | null | undefined} card
 * @param {any} [targetNumber]  the gesture-bound card-number field.
 * @returns {{ filled: boolean }}
 */
function fillCardForm(doc, card, targetNumber) {
  // `typeof window` is 'undefined' under the headless unit test (which drives this
  // pure helper directly); in the guest main world it is the page window.
  if (typeof window !== 'undefined' && window.top !== window) return { filled: false };
  if (!card) return { filled: false };

  let entry = null;
  if (isLiveCardNumberField(doc, targetNumber)) {
    entry = findAllCardFields(doc).find((e) => e.number === targetNumber) || null;
  }
  if (!entry) entry = findCardFields(doc);
  if (!entry || !entry.number) return { filled: false };

  if (card.number != null) {
    // Strip formatting: a stored "4242 4242 4242 4242" must land as digits, which
    // is what every payment input accepts (and what its maxlength is sized for).
    setFieldValue(entry.number, String(card.number).replace(/\D/g, ''));
  }
  if (entry.cardholder && card.cardholder != null) {
    setFieldValue(entry.cardholder, String(card.cardholder));
  }
  if (entry.csc && card.cvv != null) {
    setFieldValue(entry.csc, String(card.cvv));
  }

  const exp = parseExpiry(card.expiry);
  if (exp) {
    if (entry.expiry) {
      setFieldValue(entry.expiry, formatCombinedExpiry(entry.expiry, exp));
    }
    if (entry.expMonth) {
      // `MM` first, then the unpadded month — select options use both spellings.
      setChoiceValue(entry.expMonth, [exp.month, String(Number(exp.month))]);
    }
    if (entry.expYear) {
      // `YYYY` first, then `YY` — a 2-char input/select takes the short form.
      setChoiceValue(entry.expYear, [exp.year, exp.year.slice(-2)]);
    }
  }

  return { filled: true };
}

module.exports = {
  AUTOCOMPLETE_ROLES,
  autocompleteRoleOf,
  fallbackRoleOf,
  findCardFields,
  findAllCardFields,
  isLiveCardNumberField,
  parseExpiry,
  fillCardForm
};
