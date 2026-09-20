// @ts-check
'use strict';

// Family-agnostic field-name / autocomplete tokenizing primitives (Mission 21,
// Flight 2, Leg 1 — squawks 0090/0091). Extracted from vault-card-fields.js so a
// second detector family (identity, Leg 2) can consume the SAME two mechanisms
// without duplicating them or reaching into the card module, which owns none of
// this — DD6 named both halves explicitly. Carries NO family's vocabulary: no
// card pattern, no card autocomplete-token map, nothing identity-shaped. A
// caller supplies its own patterns / token map and calls in.

/**
 * Normalize a field-identifying haystack (name/id/placeholder/aria-label text,
 * already joined by the caller) for `\b`-anchored pattern matching, closing two
 * independent JS regex gaps a family's own fallback patterns cannot close by
 * themselves:
 *   - `\b` never fires between two adjacent letters regardless of case, so a
 *     role word buried mid-camelCase (`ccExpMonth`'s `Exp`) has no boundary to
 *     match against — fixed by inserting a space at every lowercase/digit →
 *     uppercase hump (squawk 0087's fix, generalized here).
 *   - `_` is a `\w` character (and so, for this purpose, is `-`), so `\b` never
 *     fires between an underscore/hyphen and an adjacent letter either — fixed
 *     by mapping `_` and `-` to a space, the same character family patterns
 *     already treat as an optional separator (squawk 0091).
 * Both transforms happen HERE, on the haystack, rather than by loosening any
 * family's own patterns: a pattern keeps matching exactly the words/spellings
 * it always matched: only the boundaries a word can be reached across shift, so
 * normalization can create NEW matches (a new word boundary appearing where
 * there was none) but never removes an old one.
 * @param {string} str
 * @returns {string}
 */
function normalizeFieldHaystack(str) {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ');
}

/**
 * Resolve an `autocomplete`-shaped attribute VALUE to a role, generically: split
 * the value on whitespace and resolve each token against a caller-supplied
 * token→role map, first matching token wins. This is the mechanism every
 * WHATWG autofill-detail token family shares (`cc-number`, `given-name`, …a
 * section/billing/shipping prefix chain is legal and real checkouts use it) —
 * independent of which family's token vocabulary is being resolved. That
 * vocabulary stays with its own family's module (e.g. card's
 * `AUTOCOMPLETE_ROLES`); this function owns only the split-and-lookup shape.
 * @param {string | null | undefined} value
 * @param {Map<string, string>} roleMap
 * @returns {string | null}
 */
function resolveAutocompleteToken(value, roleMap) {
  if (value == null || value === '') return null;
  for (const token of String(value).toLowerCase().split(/\s+/)) {
    const role = roleMap.get(token);
    if (role) return role;
  }
  return null;
}

/**
 * The raw haystack a field is matched against for NAME/ID-fallback detection:
 * name / id / placeholder / aria-label, joined with a space. Extracted here
 * (Mission 21, Flight 2, Leg 2 — identity-boundary) from its prior private,
 * card-only home in `vault-card-fields.js` so a second family (identity) reads
 * the exact same four attributes the card family already keys detection on —
 * without this extraction, the two families could silently drift on WHICH
 * attributes feed detection (e.g. one family gaining a fifth attribute the
 * other never sees), which would be a much harder defect to notice than a
 * vocabulary gap.
 * @param {any} field
 * @returns {string}
 */
function fieldHaystack(field) {
  return [field.name, field.id, field.placeholder, field.getAttribute?.('aria-label')]
    .filter((v) => v != null && v !== '')
    .join(' ');
}

module.exports = { normalizeFieldHaystack, resolveAutocompleteToken, fieldHaystack };
