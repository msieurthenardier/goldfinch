// @ts-check

// bookmarkUrlsMatch(a, b) — the DD2 bookmark-identity predicate (Flight 1 /
// Bookmarking Core and Surfaces, Leg 1). One bookmark per EXACT
// committed-URL string match: no fragment stripping, no trailing-slash
// normalization beyond what the URL stack already applied before either
// string reached here. Star fill, re-star toggling, and the store's own
// add()/update() dedupe all share this ONE predicate (real ESM, like
// url-safety.js — pure module, no side effects) so no consumer can drift onto
// a looser or stricter comparison.
//
// Deliberately NOT `new URL(a).href === new URL(b).href` — that would
// normalize away meaningful differences (e.g. a trailing slash Chrome itself
// preserves) and throw on a malformed string. Plain string equality is the
// whole contract; a non-string input never throws, it just fails to match.

/**
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function bookmarkUrlsMatch(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a === b;
}
