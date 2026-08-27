// @ts-check

// bookmark-suggest.js — pure ESM tokenizer + matcher (M15 F1 "Bookmarking
// Core and Surfaces", Leg 4 / flight DD11). This hand-mirrors what
// history-store.js's search actually does — sanitizeSearchQuery's
// whitespace-split + quoted-phrase-prefix wrapping, fed through the SAME
// default `unicode61` FTS5 tokenizer (no tokenchars override,
// history-store.js:50-53) — NOT a generic AND-of-independent-prefixes
// tokenizer. Every rule below is pinned by test/unit/bookmark-suggest.test.js's
// live-FTS5 parity corpus (built with an in-memory node:sqlite FTS5 table,
// same tokenizer + `prefix='2 3 4'` config as `visits_fts`), and was verified
// empirically (Node 22 / SQLite 3.50.4) during design review:
//
//   - A query word with internal punctuation splits into SUB-TOKENS that
//     must appear ADJACENT and IN ORDER in the matched field, with only the
//     LAST sub-token prefix-matched: `"exa-mple"*` matches `exa mplecase`
//     (tokens ["exa","mplecase"], "mplecase".startsWith("mple")) but NOT
//     `exa foo mplecase` (the sub-tokens are not adjacent). An
//     AND-of-independent-prefixes implementation over-matches the second
//     case and is wrong.
//   - Content tokenization mirrors unicode61 defaults: runs of Unicode
//     letters/digits, case-folded AND diacritic-folded (NFKD-decompose +
//     strip combining marks) — café≡cafe, İstanbul≡istanbul.
//   - Ligature/stroke letters (ø œ ł ß) have NO compatibility decomposition
//     under NFKD and are NOT folded by either side — øre≠ore, straße≠strasse
//     — matching FTS5's own behavior exactly (verified, not assumed).
//   - A multi-word query AND-combines PER WORD, but each word may satisfy
//     its phrase in EITHER the title or the url field independently — FTS5's
//     unqualified multi-column MATCH is not a same-column requirement
//     (verified against a two-column in-memory table).

/**
 * Tokenize into unicode61-equivalent runs: NFKD-decompose, strip Unicode
 * combining marks (general category M), lowercase, then split on everything
 * that is not a Unicode letter or digit. Mirrors FTS5's default tokenizer
 * with no tokenchars override. Never throws.
 * @param {unknown} text
 * @returns {string[]}
 */
function tokenize(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  let folded;
  try {
    folded = text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  } catch {
    return [];
  }
  const matches = folded.match(/[\p{L}\p{N}]+/gu);
  return matches ? matches : [];
}

/**
 * Mirrors history-store.js's `sanitizeSearchQuery` word-splitting
 * (whitespace-split, strip embedded `"`, drop empties) — WITHOUT the FTS
 * phrase-wrapping (this module IS the phrase-matching engine, not a MATCH
 * string builder). Each surviving word is tokenized by the SAME `tokenize`
 * above, since FTS5 parses quoted phrase content with the identical
 * tokenizer it indexes with.
 * @param {unknown} query
 * @returns {string[][]} one sub-token array per surviving query word. A word
 *   that tokenizes to nothing (e.g. all punctuation) is DROPPED — an empty
 *   phrase term carries no independently-testable constraint.
 */
function queryWordTokens(query) {
  const raw = typeof query === 'string' ? query : '';
  return raw
    .split(/\s+/)
    .map((t) => t.replace(/"/g, ''))
    .filter((t) => t.length > 0)
    .map(tokenize)
    .filter((toks) => toks.length > 0);
}

/**
 * Does `subtokens` (one query word's tokenized form) appear as an adjacent,
 * in-order run inside `contentTokens`, with every sub-token but the LAST
 * matched exactly and the LAST matched by prefix (`startsWith`)?
 * @param {string[]} subtokens
 * @param {string[]} contentTokens
 * @returns {boolean}
 */
function phraseMatches(subtokens, contentTokens) {
  const n = subtokens.length;
  if (n === 0) return true; // no constraint — see queryWordTokens
  const lastIndex = n - 1;
  for (let start = 0; start + n <= contentTokens.length; start++) {
    let ok = true;
    for (let k = 0; k < lastIndex; k++) {
      if (contentTokens[start + k] !== subtokens[k]) {
        ok = false;
        break;
      }
    }
    if (ok && !contentTokens[start + lastIndex].startsWith(subtokens[lastIndex])) ok = false;
    if (ok) return true;
  }
  return false;
}

/**
 * Does one entry's title+url satisfy the FULL query — every query word's
 * phrase found (via phraseMatches) in EITHER the title tokens or the url
 * tokens, independently per word (verified cross-column AND, not a
 * same-field requirement)?
 * @param {{ title?: unknown, url?: unknown }} entry
 * @param {string[][]} wordTokenSets
 * @returns {boolean}
 */
function entryMatches(entry, wordTokenSets) {
  if (wordTokenSets.length === 0) return false;
  const titleTokens = tokenize(entry && entry.title);
  const urlTokens = tokenize(entry && entry.url);
  return wordTokenSets.every(
    (subtokens) => phraseMatches(subtokens, titleTokens) || phraseMatches(subtokens, urlTokens)
  );
}

/**
 * Matches bookmark-shaped entries against `query`, mirroring history
 * search's ACTUAL FTS5 semantics (DD11 / AC1) rather than a generic
 * tokenizer. Matches over title and URL tokens; non-throwing on any input;
 * returns entries in STORED ORDER (no ranking — DD11: bookmarks are a flat
 * first-ranked block), capped at `limit` (default 3).
 * @param {Array<{ title?: unknown, url?: unknown }>} entries
 * @param {unknown} query
 * @param {{ limit?: number }} [opts]
 * @returns {Array<any>}
 */
function matchBookmarks(entries, query, { limit = 3 } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const wordTokenSets = queryWordTokens(query);
  if (wordTokenSets.length === 0) return [];
  const cap = Number.isInteger(limit) && limit > 0 ? limit : 3;
  const out = [];
  for (const entry of list) {
    if (out.length >= cap) break;
    if (entry !== null && typeof entry === 'object' && entryMatches(entry, wordTokenSets)) out.push(entry);
  }
  return out;
}

export { tokenize, queryWordTokens, phraseMatches, entryMatches, matchBookmarks };
