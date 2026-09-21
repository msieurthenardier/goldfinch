// @ts-check
'use strict';

const { normalizeFieldHaystack, resolveAutocompleteToken, fieldHaystack } = require('./field-tokenizer');
// LD1 (M21 F3 Leg 3): setFieldValue/setChoiceValue moved OUT to field-setters.js,
// shared with identity (country/region are routinely <select>s too) — see that
// module's header. Moved verbatim; behavior is byte-identical.
const { setFieldValue, setChoiceValue } = require('./field-setters');

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
//
// EXPIRY-FAMILY GATE (squawk 0090, Mission 21 Flight 2 Leg 1): the expiry roles
// (`expiry`/`expMonth`/`expYear`) carry no `card`/`cc` anchor of their own in
// their patterns — `expirationMonth` is a real, currently-detected spelling with
// no such token — so once `_`/camelCase normalization widens what those patterns
// reach, an unrelated expiration-ish field (a session token, a coupon, a
// membership) in the SAME scope as a real card number starts mis-resolving as
// the card's own expiry. Fixed PIPELINE-level, in `rolesIn`, not by tightening
// the patterns themselves (that would cost `expirationMonth` a false negative —
// see `qualifiesForRole` below) and not by a denylist of disqualifying
// words (unbounded, and fragile in exactly the way these patterns have already
// failed twice). A disqualifier denylist was considered and rejected for this
// reason. Full trade-off and the two design-review rounds: squawk 0090 and this
// flight's flight-log.

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
// The `number` group's leading `\b` (squawk 0090 turnaround finding, folded in
// here since it is the same class in the same patterns this leg already edits)
// stops `cc` substring-matching inside `acc` — `accNumber`/`acctNumber` no
// longer resolve as a card number; `payment.cardNumber`, `card_cardNumber`,
// `cc_number`, `ccNumber`, `cardNumber` and the rest are unaffected because each
// already carries a genuine word boundary before its `card`/`cc` token.
const FALLBACK_PATTERNS = [
  ['number', /\b(card|cc|creditcard|pan)[-_ ]?(number|num|no)\b|^ccnumber$|^cardnumber$/i],
  ['csc', /\b(cvv|cvc|csc|cvv2|securitycode|security[-_ ]?code|card[-_ ]?code)\b/i],
  ['expMonth', /\b(exp|expiry|expiration)[-_ ]?(month|mm)\b|^ccmonth$|^expmonth$/i],
  ['expYear', /\b(exp|expiry|expiration)[-_ ]?(year|yy|yyyy)\b|^ccyear$|^expyear$/i],
  ['expiry', /\b(exp|expiry|expiration)([-_ ]?date)?\b|^ccexp$/i],
  ['cardholder', /\b(card[-_ ]?holder|name[-_ ]?on[-_ ]?card|cc[-_ ]?name)\b/i]
];

/** The expiry-family fallback roles — the only roles the anchor gate applies to
 * (see `qualifiesForRole`). Every other role stays plain first-match-wins. */
const EXPIRY_ROLES = new Set(['expiry', 'expMonth', 'expYear']);

// A field's OWN haystack carrying one of these (case-insensitive, word-bounded,
// post-normalization) is condition (a) of the expiry gate — the field names
// itself as card-related, independent of where it sits in the scope. Mirrors
// the vocabulary the `number` pattern already anchors on, plus `payment` (a
// spelling real card forms use — e.g. `payment_exp_month` — that `number`'s own
// group does not need, since `payment` alone is never a plausible PAN name).
const CARD_CONTEXT_RE = /\b(card|cc|credit|payment)\b/i;

// Condition (b) of the expiry gate: how many CANDIDATE-FIELD positions (i.e.
// positions within `candidateFields(scope)`, not raw DOM node distance) an
// expiry-family field may sit from the detected card-number anchor, in EITHER
// direction, and still qualify. Derived from one card entry's own field count —
// number, name, month, year, csc ≈ 5 — not chosen by taste: design-review
// distance probes showed the anchor → its-own-expiry distance stays at 2-3 even
// with 16 preceding billing fields (which sit BEFORE the anchor, not between it
// and the candidate) and reaches 3 with two unrelated card-capable selects
// interleaved. 4-6 is the defensible range; this picks the middle.
const EXPIRY_ANCHOR_WINDOW = 5;

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
  return resolveAutocompleteToken(value, AUTOCOMPLETE_ROLES);
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
 * Normalizes via the family-agnostic tokenizer (`field-tokenizer.js`) before
 * matching — camelCase humps and `_`/`-` separators both become real string
 * boundaries `\b` can fire against (squawks 0087/0091) — the patterns
 * themselves are untouched, so anything they didn't already match as a
 * contiguous/boundary-anchored word still doesn't match: `tenderNumber`
 * (normalized `tender Number`) still has no `card|cc|creditcard|pan` prefix to
 * anchor on, so it stays undetected.
 * @param {any} field
 * @returns {string | null}
 */
function fallbackRoleOf(field) {
  if (!isCardCapableField(field)) return null;
  const hay = fieldHaystack(field);
  if (!hay) return null;
  const normalized = normalizeFieldHaystack(hay);
  for (const [role, re] of FALLBACK_PATTERNS) {
    if (/** @type {RegExp} */ (re).test(normalized)) return /** @type {string} */ (role);
  }
  return null;
}

/**
 * True when a field's OWN haystack names it as card-related — condition (a) of
 * the expiry-family gate. See `qualifiesForRole`.
 * @param {any} field
 * @returns {boolean}
 */
function hasCardContextToken(field) {
  const hay = fieldHaystack(field);
  if (!hay) return false;
  return CARD_CONTEXT_RE.test(normalizeFieldHaystack(hay));
}

/**
 * The two-condition expiry-family gate (squawk 0090). Applies ONLY to
 * `expiry`/`expMonth`/`expYear` — every other fallback role is plain
 * first-match-wins, ungated (`qualifiesForRole` below routes non-expiry roles
 * straight through). A candidate for an expiry role qualifies iff EITHER:
 *   (a) its own haystack carries a card-context token (`card`/`cc`/`credit`/
 *       `payment`) — admits `expirationMonth`, `cc-exp-month`-ish names, etc.
 *       regardless of where they sit; OR
 *   (b) it sits within `EXPIRY_ANCHOR_WINDOW` candidate-field positions of the
 *       detected card-number anchor, in EITHER direction — admits a genuinely
 *       adjacent, unhinted expiry field (a real card form's own month/year
 *       pair) even when it carries no card-context word.
 * Each half alone fails: (a) alone rejects `expirationMonth` (a false
 * negative); (b) alone is largely cosmetic (proven at design review — most of
 * squawk 0090's evidence is a SINGLE-candidate scope, where proximity has
 * nothing to select between). Together they admit a card form's adjacent
 * `expirationMonth` and reject a `sessionExpiry` sitting elsewhere in the same
 * form.
 *
 * NAMED ACCEPTED RESIDUAL: an unrelated expiry-shaped field laid out ADJACENT
 * to the card number — e.g. a `couponExpirationDate` beside the payment
 * section, one of squawk 0090's own five evidence lines — still resolves via
 * condition (b). Narrower than before this fix, and honest, not silently
 * papered over.
 *
 * ALSO NOTE (accepted non-goal, not new): `giftCardExpiryDate` /
 * `loyaltyCardExpMonth` pass condition (a) purely because they contain the
 * literal token `card`. This mirrors an ambiguity the `number` pattern's own
 * `(card|cc|creditcard|pan)` group already has — not addressed here.
 * @param {string} role
 * @param {any} field
 * @param {number} index  the field's position within `candidateFields(scope)`.
 * @param {number} anchorIndex  the anchor's position, or -1 when there is none.
 * @returns {boolean}
 */
function qualifiesForRole(role, field, index, anchorIndex) {
  if (!EXPIRY_ROLES.has(role)) return true;
  if (hasCardContextToken(field)) return true;
  if (anchorIndex >= 0 && Math.abs(index - anchorIndex) <= EXPIRY_ANCHOR_WINDOW) return true;
  return false;
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
 * Resolve each field in `scope` to a card role. Returns a role→field map.
 *
 * Two-pass by design: the autocomplete pass is authoritative, and the name/id
 * fallback runs ONLY when the scope produced no autocomplete role at all. A form
 * that hints even once is trusted to hint completely, so a `cc-number`-hinted
 * form never picks up a fallback-matched "expiry" from an unrelated field. The
 * autocomplete pass stays a SINGLE linear scan, first-match-wins per role,
 * UNGATED — a checkout with a hidden duplicate keeps the first live one, the
 * same first-wins discipline the login path uses.
 *
 * The FALLBACK pass is two-phase, not a single scan, because the expiry gate
 * needs the anchor's own index before any other role can be resolved against
 * it: (1) resolve the `number` anchor and its position, first-match-wins, exactly
 * as before; (2) collect every OTHER role's candidates in document order and
 * pick the first one that satisfies `qualifiesForRole` — gate-then-first-match,
 * not nearest-to-anchor. `candidateFields(scope)`'s array index is document
 * order, which is what the gate's window is measured in.
 * @param {any} scope
 * @returns {Map<string, any>}
 */
function rolesIn(scope) {
  const fields = candidateFields(scope);

  /** @type {Map<string, any>} */
  const acRoles = new Map();
  for (const field of fields) {
    const role = autocompleteRoleOf(field);
    if (role && !acRoles.has(role)) acRoles.set(role, field);
  }
  if (acRoles.size > 0) return acRoles;

  // Phase 1: resolve the anchor (`number`) and its position, first-match-wins.
  const resolved = fields.map((field, index) => ({ field, index, role: fallbackRoleOf(field) }));
  let numberField = null;
  let numberIndex = -1;
  for (const r of resolved) {
    if (r.role === 'number') {
      numberField = r.field;
      numberIndex = r.index;
      break;
    }
  }

  // Phase 2: every other role's candidates, gate-then-first-match. The anchor
  // itself never competes for another role (it already has one, `number`).
  /** @type {Map<string, any>} */
  const roles = new Map();
  if (numberField) roles.set('number', numberField);
  for (const r of resolved) {
    if (r.index === numberIndex || !r.role || r.role === 'number' || roles.has(r.role)) continue;
    if (qualifiesForRole(r.role, r.field, r.index, numberIndex)) roles.set(r.role, r.field);
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
 * Parse a stored expiry string into `{ month: 'MM', year: 'YYYY' }`, or null when
 * it does not parse. Accepts the shapes operators actually type: `MM/YY`,
 * `MM/YYYY`, `MM-YY`, `MM YY`, `MMYY`, `MMYYYY` — PLUS a single-digit month with
 * any of those separators (`M/YY`, `M/YYYY`, `M-YY`, `M YY`; squawk 0086: a
 * hand-typed `2/27` must round-trip). A 2-digit year resolves into the 2000s — a
 * payment card expiring in the 1900s is not a case worth modeling.
 *
 * Two branches, and the separator is what makes a single-digit month safe:
 *   - WITH a recognized separator (`/`, `-`, or whitespace), the separator marks
 *     exactly where the month ends, so a 1- or 2-digit month is unambiguous and
 *     gets zero-padded.
 *   - WITHOUT one, only the two lengths that were always unambiguous (4 digits =
 *     `MMYY`, 6 = `MMYYYY`, both fixed 2-digit month) are accepted, exactly as
 *     before. A separator-less single-digit month is deliberately NOT supported:
 *     a 3-digit run like `227` is genuinely ambiguous (`2/27` vs `22/7`) with no
 *     separator to disambiguate it, so it is rejected rather than guessed — the
 *     reported defect's input always carries a separator (`2/27`), so this is not
 *     a gap against the actual symptom.
 * @param {any} raw
 * @returns {{ month: string, year: string } | null}
 */
function parseExpiry(raw) {
  if (raw == null) return null;
  const str = String(raw).trim();

  const sep = str.match(/^(\d{1,2})[/\- ]+(\d{2}|\d{4})$/);
  if (sep) {
    const month = sep[1].padStart(2, '0');
    const monthNum = Number(month);
    if (!(monthNum >= 1 && monthNum <= 12)) return null;
    const yearPart = sep[2];
    const year = yearPart.length === 2 ? `20${yearPart}` : yearPart;
    return { month, year };
  }

  const digits = str.replace(/\D/g, '');
  if (digits.length !== 4 && digits.length !== 6) return null;
  const month = digits.slice(0, 2);
  const monthNum = Number(month);
  if (!(monthNum >= 1 && monthNum <= 12)) return null;
  const rest = digits.slice(2);
  const year = rest.length === 2 ? `20${rest}` : rest;
  return { month, year };
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
 * `ordinal` (M21 F3 Leg 3, DD9 — the card twin of fillLoginForm's ordinal): an
 * INTEGER index into `findAllCardFields(doc)`, resolved by the caller from the
 * gesture-bound card-number field via `resolveOrdinalInFamily` — never a node
 * reference. A valid in-range ordinal fills THAT specific entry; a `null` /
 * non-integer / out-of-range ordinal falls back to the first detected entry.
 * @param {any} doc
 * @param {{ number?: string|null, cardholder?: string|null, expiry?: string|null, cvv?: string|null } | null | undefined} card
 * @param {number | null} [ordinal]  an index into `findAllCardFields(doc)`.
 * @returns {{ filled: boolean, fields: Array<{ field: any, value: string }> }}
 *   `fields` carries the exact string WRITTEN to each field that was actually
 *   filled, keyed by the field's own node reference (M21 F1 Leg 3, DD3h) — the
 *   card twin of fillLoginForm's same contract. A `<select>` expiry field's entry
 *   carries whatever `setChoiceValue` actually wrote, which can differ from the
 *   requested candidate; a select with no matching option contributes no entry.
 */
function fillCardForm(doc, card, ordinal) {
  // `typeof window` is 'undefined' under the headless unit test (which drives this
  // pure helper directly); in the guest main world it is the page window.
  if (typeof window !== 'undefined' && window.top !== window) return { filled: false, fields: [] };
  if (!card) return { filled: false, fields: [] };

  const all = findAllCardFields(doc);
  const entry =
    typeof ordinal === 'number' && Number.isInteger(ordinal) && ordinal >= 0 && ordinal < all.length
      ? all[ordinal]
      : findCardFields(doc);
  if (!entry || !entry.number) return { filled: false, fields: [] };

  const written = [];
  if (card.number != null) {
    // Strip formatting: a stored "4242 4242 4242 4242" must land as digits, which
    // is what every payment input accepts (and what its maxlength is sized for).
    const value = String(card.number).replace(/\D/g, '');
    setFieldValue(entry.number, value);
    written.push({ field: entry.number, value });
  }
  if (entry.cardholder && card.cardholder != null) {
    const value = String(card.cardholder);
    setFieldValue(entry.cardholder, value);
    written.push({ field: entry.cardholder, value });
  }
  if (entry.csc && card.cvv != null) {
    const value = String(card.cvv);
    setFieldValue(entry.csc, value);
    written.push({ field: entry.csc, value });
  }

  const exp = parseExpiry(card.expiry);
  if (exp) {
    if (entry.expiry) {
      const value = formatCombinedExpiry(entry.expiry, exp);
      setFieldValue(entry.expiry, value);
      written.push({ field: entry.expiry, value });
    }
    if (entry.expMonth) {
      // `MM` first, then the unpadded month — select options use both spellings.
      const value = setChoiceValue(entry.expMonth, [exp.month, String(Number(exp.month))]);
      if (value != null) written.push({ field: entry.expMonth, value });
    }
    if (entry.expYear) {
      // `YYYY` first, then `YY` — a 2-char input/select takes the short form.
      const value = setChoiceValue(entry.expYear, [exp.year, exp.year.slice(-2)]);
      if (value != null) written.push({ field: entry.expYear, value });
    }
  }

  return { filled: true, fields: written };
}

module.exports = {
  AUTOCOMPLETE_ROLES,
  EXPIRY_ANCHOR_WINDOW,
  autocompleteRoleOf,
  fallbackRoleOf,
  findCardFields,
  findAllCardFields,
  parseExpiry,
  fillCardForm
};
