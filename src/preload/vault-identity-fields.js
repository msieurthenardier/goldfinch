// @ts-check
'use strict';

const { normalizeFieldHaystack, resolveAutocompleteToken, fieldHaystack } = require('./field-tokenizer');
const { findAllLoginFields } = require('./vault-fill-fields');

// Pure identity-field detection for the guest main-world preload (Mission 21,
// Flight 2, Leg 2 — identity-boundary). The IDENTITY twin of vault-card-fields.js
// — same shape (`findAllIdentityFields(doc)` -> entries), same "pure, `require`-
// able, no page/store coupling" discipline. DETECTION ONLY: no fill, no capture,
// no store, no schema. Those are Flight 3 / Leg 3.
//
// WHY THIS IS THE HARDEST OF THE THREE FAMILIES: login has a structural anchor
// (`input[type=password]`, a real HTML semantic). Card has no structural anchor
// but a narrow, well-known vocabulary and a low false-positive tolerance (a
// mis-detected card field is cosmetic at worst, in the card family's own design).
// Identity has NEITHER a structural anchor NOR a narrow vocabulary — "name",
// "email", "phone", "address" are among the most common words on the web — so
// admissibility IS the whole security story (flight DD1). The fix is a SCOPE
// ANCHOR: a scope (a `<form>`, or the whole document for a form-less field)
// only offers identity fields at all when it contains real postal-address
// evidence AND a non-postal identity role (name/email/phone) alongside it. A
// postal address is the structural signal identity otherwise lacks; requiring
// BOTH closes the two failure modes DD1's own design review found — a bare
// standalone email field (no address: refused) and a postal-only shipping-cost
// estimator (no name/email/phone: refused).
//
// ---------------------------------------------------------------------------
// LD1 — MATCHING IS ALTERNATIVES, NOT A FLAT TOKEN SET.
// ---------------------------------------------------------------------------
// A role is a list of ALTERNATIVES, each an all-tokens-required SET. Matching
// is conjunctive WITHIN an alternative, disjunctive ACROSS alternatives (and
// across roles), and the alternative matching the MOST tokens wins overall.
// This is NOT a flat OR-set of tokens — verified necessary by running Leg 1's
// real tokenizer, not reasoned about: `billingAddress1` tokenizes to
// ["billing","address1"] with NO "address" token at all (a flat set needs an
// explicit "address1" entry to reach it — the leg's own first draft named the
// abbreviation `addr1` but not the digit-suffixed literal motivating spelling,
// which would have silently dropped the Jostens fixture's own street field).
// `billingFirstName` -> ["billing","first","name"] and `billingLastName` ->
// ["billing","last","name"] both carry "name" — a flat set cannot tell first
// from last from full name; the alternatives model resolves this because
// `{first,name}` (2 tokens) beats `{name}` (1 token) on `billingFirstName`.
//
// ---------------------------------------------------------------------------
// `address` IS NEVER BARE-ADMISSIBLE.
// ---------------------------------------------------------------------------
// Neither at the anchor NOR as a field. Every `street`/`street2` alternative
// below requires a digit suffix (`address1`), an abbreviation (`addr1`), or a
// compound form (`street address`, `address line1`, `billing address`, …). A
// bare `{address}` alternative would create a reachable TIE: `emailAddress`
// tokenizes to ["email","address"], which would match email's `{email}` and a
// hypothetical bare `{address}` street alternative at EQUAL length (1 token
// each), with the winner decided by iteration order — exactly the ambiguity
// the alternatives model exists to remove. This is flight DD1's round-2
// amendment 1; `emailAddress` resolves to `email` ONLY because no street
// alternative can ever match it.
//
// ---------------------------------------------------------------------------
// THE VOCABULARY IS WRITTEN TWICE — do not "consolidate" it.
// ---------------------------------------------------------------------------
// Autocomplete VALUES go through `resolveAutocompleteToken` (splits on
// whitespace only — a hyphen survives, `postal-code` stays ONE token, matched
// verbatim in AUTOCOMPLETE_ROLES below). Name/id FALLBACK haystacks go through
// `normalizeFieldHaystack` (hyphens AND underscores become spaces first —
// `postal-code` becomes the TWO tokens `["postal","code"]`). A literal
// `"postal-code"` pasted into ROLE_ALTERNATIVES below would be a DEAD ENTRY
// that can never fire — the fallback token set never contains a hyphenated
// string. Every ROLE_ALTERNATIVES entry is therefore written as an array of
// already-split, lowercase, hyphen-free tokens; AUTOCOMPLETE_ROLES entries are
// written as the literal (possibly hyphenated) WHATWG token strings. Do not
// move an entry from one table to the other without re-deriving its shape.
//
// ---------------------------------------------------------------------------
// LD2 — THE SCOPE ANCHOR.
// ---------------------------------------------------------------------------
// A scope (see `identityEntryForScope`) qualifies as an identity context only
// when BOTH hold, independent of each other:
//   (1) at least one candidate field is ANCHOR-ELIGIBLE for a postal role
//       (`street`, `street2`, `postalCode`, or a PREFIX-QUALIFIED `city` /
//       `region` / `country` — never bare `city`/`region`/`country`, and never
//       bare `address`, which does not exist as an alternative at all); and
//   (2) at least one candidate field resolves a NON-postal role (`fullName`,
//       `firstName`, `lastName`, `email`, `phone`) — LD4's round-2 amendment 2:
//       a postal anchor alone is not a person (closes the shipping-cost-
//       estimator shape: zip + country, nothing else).
// If either is absent, the detector returns NOTHING for that scope — no field
// in it is admitted, not even ones that would otherwise resolve a role.
//
// Anchor-qualification is a SEPARATE, UNGATED predicate (`isAnchorEligible`,
// folded into `resolveField` below via each alternative's own `anchor` flag) —
// it NEVER consults "is this scope already anchored". Doing so would be
// circular: field admissibility would depend on the scope being anchored, and
// the anchor would be computed from admissible fields. Prefix-qualification
// is evaluated on a SINGLE FIELD's own haystack, never aggregated across the
// scope — a stray `billing_department` field plus an unrelated bare `city`
// field must NOT jointly satisfy the anchor by both existing somewhere in the
// same form.
//
// Once a scope IS anchored, generic/bare postal roles (`city`, `region`,
// `country` without a prefix) become ADMISSIBLE AS FIELDS even though they are
// not themselves anchor-eligible — the anchor is what replaces the missing
// structural signal; a field's own `anchor` flag is consulted ONLY while
// deciding whether the scope itself anchors, never again afterward. Field
// admission, once the scope has anchored, is simply "did this field resolve
// SOME role at all" (`resolveField(field).role != null`).
//
// ---------------------------------------------------------------------------
// LD3 — LOGIN WINS A CONTESTED FIELD.
// ---------------------------------------------------------------------------
// `resolveLoginEntry` (`vault-fill-fields.js`) picks a login username as the
// LAST text/email/tel input PRECEDING a password field, by DOCUMENT POSITION
// ONLY — it never reads name/id/autocomplete. So any identity-admissible field
// sitting before a password is claimed by login regardless of spelling: the
// contest is structural, not name-based. Login wins because its claim is
// anchored on `input[type=password]`, a structural fact; identity's is a
// vocabulary judgement. `isClaimedByLogin` is the CALLABLE artifact this
// enacts (built from the already-exported `findAllLoginFields` — never a
// reimplementation, and `vault-fill-fields.js` is not touched); every
// candidate field is filtered through it BEFORE role resolution, so a
// login-claimed field is invisible to identity detection — including as an
// anchor candidate ("the anchor itself can be contested": a scope whose ONLY
// street-shaped field sits immediately before a password loses its anchor
// entirely, not just that one field's role).
//
// ---------------------------------------------------------------------------
// PREFIX VOCABULARY — named, not left to the implementer.
// ---------------------------------------------------------------------------
// `billing`, `shipping`, `delivery`, `mailing`, `contact`, `home`, `work`.
// Used for `city`/`region`/`country` qualification (LD2's anchor-eligibility)
// AND, by the same choice, for `street`'s compound alternatives (settles
// `billingAddress` — DD1's own named example) — a stated choice, not an
// omission: keeping ONE prefix list for every prefix-qualified postal role
// means there is only one vocabulary to keep in sync with DD1's prose, rather
// than a second, driftable one for `street` alone.

/** @type {string[]} */
const PREFIXES = ['billing', 'shipping', 'delivery', 'mailing', 'contact', 'home', 'work'];

/**
 * One alternative: an all-tokens-required set, and whether a field resolving
 * via THIS alternative is strong enough to anchor its scope on its own
 * (LD2). Every token here is already lowercase and hyphen-free — this table
 * is matched against `normalizeFieldHaystack`'s output, never raw text.
 * @param {string[]} tokens
 * @param {boolean} anchor
 * @returns {{ tokens: string[], anchor: boolean }}
 */
function alt(tokens, anchor) {
  return { tokens, anchor };
}

/**
 * @param {string} word
 * @param {boolean} anchor
 * @returns {Array<{ tokens: string[], anchor: boolean }>}
 */
function prefixedAlts(word, anchor) {
  return PREFIXES.map((prefix) => alt([prefix, word], anchor));
}

// Postal roles first, non-postal roles after — a purely organizational split;
// `POSTAL_ROLES`/`NON_POSTAL_ROLES` below are the actual predicates code reads.
const ROLE_ALTERNATIVES = {
  // `street` — NEVER a bare `{address}` alternative (see header). Every
  // alternative here is anchor-eligible: none of these spellings are
  // plausible outside a real postal-address context.
  street: [
    alt(['address1'], true), // the literal motivating spelling (billingAddress1)
    alt(['addr1'], true), // the glued abbreviation
    alt(['street', 'address'], true), // streetAddress / "street address"
    alt(['address', 'line1'], true), // addressLine1 / address-line1
    ...prefixedAlts('address', true) // billingAddress, shippingAddress, ...
  ],
  // `street2` — the secondary address line. Deliberately NO prefixed
  // alternatives (`address2` on its own is already specific enough; a real
  // form pairs it with a `street`-anchored `address1` sibling in the same
  // scope in every fixture this leg models).
  street2: [alt(['address2'], true), alt(['addr2'], true), alt(['address', 'line2'], true)],
  // `postalCode` — every alternative anchor-eligible; no prefix needed (a
  // postal code is unambiguous on its own). `zipcode` and `postcode` are
  // GLUED lowercase tokens after normalization (no camelCase hump, no
  // separator) — reachable ONLY by their own literal entry, never by a
  // `zip`/`post` prefix match.
  postalCode: [
    alt(['zip'], true),
    alt(['zipcode'], true), // glued — own literal entry, not reached via `zip`
    alt(['postcode'], true), // glued — own literal entry, not reached via `zip`/`zipcode`
    alt(['postal', 'code'], true), // postalCode / postal-code / postal_code
    alt(['zip', 'code'], true) // zipCode / zip code
  ],
  // `city` — bare `{city}`/`{town}` are NOT anchor-eligible (a bare "city" is
  // too common a word to prove a postal context by itself — the job-
  // application fixture's whole point). Prefix-qualified forms ARE
  // anchor-eligible, per DD1's explicit "prefix-qualified city/country".
  city: [alt(['city'], false), alt(['town'], false), ...prefixedAlts('city', true), ...prefixedAlts('town', true)],
  // `region` (state/province) — same shape as city: DD1 lists it among the
  // generic tokens that need the scope anchor; bare is admissible once
  // anchored, never anchor-eligible itself.
  region: [
    alt(['state'], false),
    alt(['province'], false),
    alt(['region'], false),
    ...prefixedAlts('state', true),
    ...prefixedAlts('province', true),
    ...prefixedAlts('region', true)
  ],
  // `country` — same shape again.
  country: [alt(['country'], false), ...prefixedAlts('country', true)],

  // --- non-postal roles — `anchor` is always false; these can never anchor a
  // scope on their own (LD4 amendment 2), so the flag is irrelevant for them
  // and is set to `false` purely for shape consistency. ------------------
  firstName: [
    alt(['first', 'name'], false),
    alt(['fname'], false),
    alt(['firstname'], false), // glued
    alt(['given', 'name'], false)
  ],
  lastName: [
    alt(['last', 'name'], false),
    alt(['lname'], false),
    alt(['lastname'], false), // glued
    alt(['family', 'name'], false),
    alt(['surname'], false)
  ],
  // `fullName` — bare `{name}` only. This is what a single-field "Full Name"
  // checkout resolves to, but ONLY inside an already-anchored scope: with no
  // postal field anywhere in the same scope, LD2's anchor gate refuses the
  // whole scope before this alternative is ever consulted (see the module
  // header and the "bare single-field Name checkout" pin in the test suite).
  fullName: [alt(['name'], false)],
  email: [alt(['email'], false)],
  phone: [alt(['tel'], false), alt(['phone'], false), alt(['mobile'], false)]
};

const POSTAL_ROLES = new Set(['street', 'street2', 'postalCode', 'city', 'region', 'country']);
const NON_POSTAL_ROLES = new Set(['fullName', 'firstName', 'lastName', 'email', 'phone']);

// WHATWG autofill-detail tokens -> our internal role names. Written
// SEPARATELY from ROLE_ALTERNATIVES per the module header's "written twice"
// rule — these are the literal (possibly hyphenated) autocomplete VALUE
// tokens, matched by `resolveAutocompleteToken`, never by the fallback
// token-set matcher. Every one of these is, by WHATWG's own definition,
// unambiguous — so unlike the fallback vocabulary's bare `city`/`region`/
// `country`, an autocomplete-resolved postal role is ALWAYS anchor-eligible
// (see `autocompleteResolution` below); no prefix needed, no bare/qualified
// distinction to make. `address` is not a WHATWG token at all, so the "never
// bare-admissible" rule has nothing to enforce here.
const AUTOCOMPLETE_ROLES = new Map([
  ['name', 'fullName'],
  ['given-name', 'firstName'],
  ['family-name', 'lastName'],
  ['street-address', 'street'],
  ['address-line1', 'street'],
  ['address-line2', 'street2'],
  ['address-level2', 'city'],
  ['address-level1', 'region'],
  ['country', 'country'],
  ['country-name', 'country'],
  ['postal-code', 'postalCode'],
  ['tel', 'phone'],
  ['tel-national', 'phone'],
  ['email', 'email']
]);

/** Field types that can carry an identity value. `password` is never one —
 * that would collide with the login anchor. */
const IDENTITY_INPUT_TYPES = new Set(['', 'text', 'email', 'tel']);

/**
 * True when a field can structurally hold an identity value: an `<input>` of
 * an identity-compatible type, or a `<select>` (country/region pickers are
 * routinely selects).
 * @param {any} field
 * @returns {boolean}
 */
function isIdentityCapableField(field) {
  if (!field) return false;
  const tag = String(field.tagName == null ? '' : field.tagName).toLowerCase();
  if (tag === 'select') return true;
  if (tag !== 'input' && tag !== '') return false;
  const type = String(field.type == null ? '' : field.type).toLowerCase();
  return IDENTITY_INPUT_TYPES.has(type);
}

/**
 * The `autocomplete` role token of a field, or null. Tokenizes the full
 * attribute so section/billing/shipping prefixes resolve to the same role as
 * a bare token, matching real checkout markup and the card family's own
 * `autocompleteRoleOf`.
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
 * The best (longest-match-wins) fallback role for a field's own haystack, or
 * null. Conjunctive within an alternative, disjunctive across all
 * alternatives of every role (LD1) — every token in the winning alternative
 * must be present in the field's own token set; ties across roles at the same
 * length are resolved by ROLE_ALTERNATIVES's own declaration order (defensive
 * only — the vocabulary above is built so no two DIFFERENT roles can validly
 * tie; see the "address is never bare-admissible" note).
 * @param {any} field
 * @returns {{ role: string | null, anchorEligible: boolean }}
 */
function fallbackResolution(field) {
  const hay = fieldHaystack(field);
  if (!hay) return { role: null, anchorEligible: false };
  const tokens = new Set(normalizeFieldHaystack(hay).toLowerCase().split(/\s+/).filter(Boolean));
  if (tokens.size === 0) return { role: null, anchorEligible: false };

  /** @type {{ role: string, anchorEligible: boolean, length: number } | null} */
  let best = null;
  for (const [role, alternatives] of Object.entries(ROLE_ALTERNATIVES)) {
    for (const a of alternatives) {
      if (a.tokens.length === 0) continue;
      if (!a.tokens.every((t) => tokens.has(t))) continue;
      if (!best || a.tokens.length > best.length) {
        best = { role, anchorEligible: a.anchor, length: a.tokens.length };
      }
    }
  }
  return best ? { role: best.role, anchorEligible: best.anchorEligible } : { role: null, anchorEligible: false };
}

/**
 * The fallback role of a field, field-level, with NO anchor/scope context —
 * the identity twin of card's `fallbackRoleOf`. Does not gate on
 * `isIdentityCapableField` being true for any particular caller's purpose
 * beyond field-type; does not know whether the field's scope will ultimately
 * anchor. Exported for direct, per-spelling pinning (see the test suite).
 * @param {any} field
 * @returns {string | null}
 */
function fallbackRoleOf(field) {
  if (!isIdentityCapableField(field)) return null;
  return fallbackResolution(field).role;
}

/**
 * Resolve one field to `{ role, anchorEligible }` via autocomplete if
 * possible, else the fallback vocabulary. Null role when neither resolves
 * anything.
 * @param {any} field
 * @returns {{ role: string | null, anchorEligible: boolean, viaAutocomplete: boolean }}
 */
function resolveField(field) {
  const acRole = autocompleteRoleOf(field);
  if (acRole) return { role: acRole, anchorEligible: POSTAL_ROLES.has(acRole), viaAutocomplete: true };
  const fb = fallbackResolution(field);
  return { role: fb.role, anchorEligible: fb.anchorEligible, viaAutocomplete: false };
}

/**
 * Is `field` claimed by the LOGIN detector — LD3's callable artifact. Built
 * from the already-exported `findAllLoginFields` (`vault-fill-fields.js` is
 * NOT touched, per the leg's constraint): checks `field === entry.username`
 * across every detected login entry. `resolveLoginEntry`'s username pick is
 * positional only (the LAST text/email/tel input preceding a password field,
 * document order — it never reads name/id/autocomplete), so this predicate is
 * structural, not a name-based guess.
 * @param {any} field
 * @param {any} doc
 * @returns {boolean}
 */
function isClaimedByLogin(field, doc) {
  if (!field || !doc) return false;
  return findAllLoginFields(doc).some((entry) => entry.username === field);
}

/**
 * Every identity-capable field in `scope`, in document order, EXCLUDING any
 * field login has claimed (LD3) — applied before any role resolution, so a
 * login-claimed field cannot serve as this scope's postal anchor either (the
 * "anchor itself can be contested" edge case).
 * @param {any} scope
 * @param {any} doc
 * @returns {any[]}
 */
function candidateFields(scope, doc) {
  if (!scope || typeof scope.querySelectorAll !== 'function') return [];
  return Array.from(scope.querySelectorAll('input, select'))
    .filter(isIdentityCapableField)
    .filter((field) => !isClaimedByLogin(field, doc));
}

/**
 * Resolve every candidate field in `scope`, autocomplete-authoritative: if ANY
 * field resolves a role via autocomplete, the scope uses ONLY autocomplete
 * results (ignoring fallback matches on other fields in the same scope) — the
 * card family's own "a form that hints even once is trusted to hint
 * completely" discipline (LD2's rationale explicitly cites it). Otherwise
 * every candidate field is resolved via the fallback vocabulary. Returns a
 * document-order array of `{ field, role, anchorEligible }` for fields that
 * resolved SOME role (unresolved fields are dropped).
 * @param {any} scope
 * @param {any} doc
 * @returns {Array<{ field: any, role: string, anchorEligible: boolean }>}
 */
function resolveScope(scope, doc) {
  const fields = candidateFields(scope, doc);

  /** @type {Array<{ field: any, role: string, anchorEligible: boolean }>} */
  const viaAutocomplete = [];
  for (const field of fields) {
    const r = resolveField(field);
    if (r.role && r.viaAutocomplete) viaAutocomplete.push({ field, role: r.role, anchorEligible: r.anchorEligible });
  }
  if (viaAutocomplete.length > 0) return viaAutocomplete;

  /** @type {Array<{ field: any, role: string, anchorEligible: boolean }>} */
  const viaFallback = [];
  for (const field of fields) {
    const r = resolveField(field);
    if (r.role) viaFallback.push({ field, role: r.role, anchorEligible: r.anchorEligible });
  }
  return viaFallback;
}

/**
 * Build one identity entry from a resolved-role array, first-field-per-role
 * wins (document order — `resolved` is already document order).
 * @param {Array<{ field: any, role: string, anchorEligible: boolean }>} resolved
 * @param {any} anchorField  the field that qualified LD2's scope anchor.
 * @param {any} scope
 * @returns {any}
 */
function entryFromResolved(resolved, anchorField, scope) {
  /** @type {Map<string, any>} */
  const roleMap = new Map();
  for (const r of resolved) if (!roleMap.has(r.role)) roleMap.set(r.role, r.field);
  return {
    anchor: anchorField,
    fullName: roleMap.get('fullName') || null,
    firstName: roleMap.get('firstName') || null,
    lastName: roleMap.get('lastName') || null,
    email: roleMap.get('email') || null,
    phone: roleMap.get('phone') || null,
    street: roleMap.get('street') || null,
    street2: roleMap.get('street2') || null,
    city: roleMap.get('city') || null,
    region: roleMap.get('region') || null,
    country: roleMap.get('country') || null,
    postalCode: roleMap.get('postalCode') || null,
    form: scope && scope.tagName ? scope : null
  };
}

/**
 * LD2's scope anchor, evaluated over one scope's already-resolved fields, and
 * the resulting entry (or null when the scope does not qualify — "no field is
 * inspected further" past this gate). `resolved` already excludes
 * login-claimed fields (`candidateFields`), so a contested anchor field is
 * simply absent from `resolved` — not specially cased here.
 * @param {any} scope
 * @param {any} doc
 * @returns {any | null}
 */
function identityEntryForScope(scope, doc) {
  const resolved = resolveScope(scope, doc);
  if (resolved.length === 0) return null;

  const anchorCandidate = resolved.find((r) => POSTAL_ROLES.has(r.role) && r.anchorEligible);
  if (!anchorCandidate) return null;

  const nonPostalCandidate = resolved.find((r) => NON_POSTAL_ROLES.has(r.role));
  if (!nonPostalCandidate) return null;

  return entryFromResolved(resolved, anchorCandidate.field, scope);
}

/**
 * Enumerate every detected identity entry in the document (document order),
 * one per anchored scope. A field inside a `<form>` scopes to that form; a
 * form-less field scopes to the whole document. Returns `[]` when no scope in
 * the document anchors (LD2) — the identity twin of `findAllCardFields`, same
 * per-scope-visited-once discipline (a form scope is marked visited even on a
 * miss so it is not re-walked once per field; the document scope is left open
 * on a miss so a later form-less field can still be tried, matching the card
 * family's own accepted, harmless re-walk).
 * @param {any} doc  a `document`-like object exposing querySelectorAll.
 * @returns {any[]}
 */
function findAllIdentityFields(doc) {
  if (!doc || typeof doc.querySelectorAll !== 'function') return [];

  const seenScopes = new Set();
  const out = [];
  for (const field of candidateFields(doc, doc)) {
    const form = field.form || (typeof field.closest === 'function' ? field.closest('form') : null);
    const scope = form || doc;
    if (seenScopes.has(scope)) continue;
    const entry = identityEntryForScope(scope, doc);
    if (!entry) {
      if (form) seenScopes.add(scope);
      continue;
    }
    seenScopes.add(scope);
    out.push(entry);
  }
  return out;
}

/**
 * The first detected identity entry, or null. The identity twin of
 * `findCardFields`.
 * @param {any} doc
 * @returns {any | null}
 */
function findIdentityFields(doc) {
  const all = findAllIdentityFields(doc);
  return all.length ? all[0] : null;
}

module.exports = {
  PREFIXES,
  AUTOCOMPLETE_ROLES,
  POSTAL_ROLES,
  NON_POSTAL_ROLES,
  autocompleteRoleOf,
  fallbackRoleOf,
  isClaimedByLogin,
  findIdentityFields,
  findAllIdentityFields
};
