'use strict';

// Unit tests for src/shared/bookmark-suggest.js (M15 F1 "Bookmarking Core
// and Surfaces" Leg 4 / flight DD11).
//
// This file requires the real ESM module via Node ≥22 synchronous
// require(esm) — the bookmark-url.test.js precedent — so the suite runs the
// exact code the app ships.
//
// The FTS5-PARITY TEST (DD11's mirror-drift note) is the load-bearing part:
// it builds a live in-memory node:sqlite FTS5 table with the SAME tokenizer
// (default unicode61, no tokenchars override) and the SAME `prefix='2 3 4'`
// config as history-store.js's `visits_fts`, and asserts the JS matcher
// AGREES with FTS5 over a fixed edge-case corpus. A divergence must fail
// this test — the corpus is the pinned contract (leg AC2).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const {
  tokenize,
  queryWordTokens,
  phraseMatches,
  matchBookmarks
} = require('../../src/shared/bookmark-suggest.js');

// ---------------------------------------------------------------------------
// Unit-level coverage of the pure helpers
// ---------------------------------------------------------------------------

test('tokenize: alphanumeric runs, case-folded, non-throwing on any input', () => {
  assert.deepEqual(tokenize('Hello World'), ['hello', 'world']);
  assert.deepEqual(tokenize('https://example.com/page1'), ['https', 'example', 'com', 'page1']);
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize(null), []);
  assert.deepEqual(tokenize(undefined), []);
  assert.deepEqual(tokenize(42), []);
  assert.deepEqual(tokenize('---'), []);
});

test('tokenize: diacritic folding (NFKD + strip combining marks)', () => {
  assert.deepEqual(tokenize('café'), ['cafe']);
  assert.deepEqual(tokenize('İstanbul'), ['istanbul']);
});

test('tokenize: ligature/stroke letters are NOT folded (their COMBINING-MARK diacritics still are)', () => {
  assert.deepEqual(tokenize('øre'), ['øre']);
  assert.deepEqual(tokenize('œuvre'), ['œuvre']);
  // ł itself has no decomposition (unfolded), but ó/ź DO (canonical decomposition
  // to a base letter + a combining mark, which the diacritic-folding rule strips) —
  // verified consistent with live FTS5 by the parity corpus below.
  assert.deepEqual(tokenize('łódź'), ['łodz']);
  assert.deepEqual(tokenize('straße'), ['straße']);
});

test('queryWordTokens: whitespace-split, quote-stripped, empties dropped, non-throwing', () => {
  assert.deepEqual(queryWordTokens('exa-mple foo'), [['exa', 'mple'], ['foo']]);
  assert.deepEqual(queryWordTokens('  '), []);
  assert.deepEqual(queryWordTokens(''), []);
  assert.deepEqual(queryWordTokens(null), []);
  assert.deepEqual(queryWordTokens('"quoted"'), [['quoted']]);
  assert.deepEqual(queryWordTokens('---'), []); // all-punctuation word tokenizes to nothing, dropped
});

test('phraseMatches: adjacency-positive vs adjacency-negative', () => {
  assert.equal(phraseMatches(['exa', 'mple'], ['exa', 'mplecase']), true);
  assert.equal(phraseMatches(['exa', 'mple'], ['exa', 'foo', 'mplecase']), false);
});

test('matchBookmarks: non-throwing on malformed input', () => {
  assert.deepEqual(matchBookmarks(null, 'foo'), []);
  assert.deepEqual(matchBookmarks(undefined, 'foo'), []);
  assert.deepEqual(matchBookmarks([null, 42, { title: 'ok match' }], 'match'), [{ title: 'ok match' }]);
});

test('matchBookmarks: empty/whitespace query returns empty (shouldQuery already gates upstream)', () => {
  const entries = [{ title: 'Example', url: 'https://example.com/' }];
  assert.deepEqual(matchBookmarks(entries, ''), []);
  assert.deepEqual(matchBookmarks(entries, '   '), []);
});

test('matchBookmarks: stored order preserved, limit default 3', () => {
  const entries = [
    { title: 'Example One', url: 'https://a.example.com/' },
    { title: 'Example Two', url: 'https://b.example.com/' },
    { title: 'Example Three', url: 'https://c.example.com/' },
    { title: 'Example Four', url: 'https://d.example.com/' }
  ];
  assert.deepEqual(matchBookmarks(entries, 'example').map((e) => e.title), [
    'Example One',
    'Example Two',
    'Example Three'
  ]);
  assert.deepEqual(matchBookmarks(entries, 'example', { limit: 4 }).map((e) => e.title), [
    'Example One',
    'Example Two',
    'Example Three',
    'Example Four'
  ]);
});

test('matchBookmarks: URL-only match still surfaces (matcher covers both fields)', () => {
  const entries = [{ title: 'My Homepage', url: 'https://distinctivehost.example/' }];
  assert.deepEqual(matchBookmarks(entries, 'distinctive'), entries);
});

// ---------------------------------------------------------------------------
// FTS5-parity corpus (DD11 mirror-drift note, leg AC2) — LOAD-BEARING
// ---------------------------------------------------------------------------
//
// Mirrors visits_fts's exact config: default unicode61 tokenizer (no
// tokenchars override), prefix='2 3 4'. history-store.js's own
// sanitizeSearchQuery is re-derived here inline (whitespace-split, strip
// `"`, wrap each surviving word as a quoted-phrase-prefix, join with
// spaces = implicit AND) rather than imported, since it is not exported —
// this is the SAME 5-line transform, reproduced only so this test can build
// the MATCH expression FTS5 itself will parse into sub-token phrases.

/** @param {string} query */
function ftsQueryFor(query) {
  const tokens = query
    .split(/\s+/)
    .map((t) => t.replace(/"/g, ''))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(' ');
}

const CORPUS = [
  // Adjacency-positive / adjacency-negative (the punctuation-in-query-word class)
  { id: 1, title: 'exa mplecase', url: 'https://example.com/adjacency-positive' },
  { id: 2, title: 'exa foo mplecase', url: 'https://example.com/adjacency-negative' },
  { id: 3, title: 'exampletext single token', url: 'https://example.com/single-token' },
  // Diacritics (folded class)
  { id: 4, title: 'Café Shop', url: 'https://example.com/cafe-shop' },
  { id: 5, title: 'İstanbul Guide', url: 'https://example.com/istanbul-guide' },
  // Ligature/stroke letters (unfolded class)
  { id: 6, title: 'Øre trading post', url: 'https://example.com/nord' },
  { id: 7, title: 'Ore trading desk', url: 'https://example.com/ore-desk' },
  { id: 8, title: 'Straße map', url: 'https://example.com/strasse-map' },
  { id: 9, title: 'Strasse map alt', url: 'https://example.com/strasse-alt' },
  { id: 10, title: 'Łódź travel', url: 'https://example.com/lodz' },
  { id: 11, title: 'Œuvre catalog', url: 'https://example.com/oeuvre' },
  // Digits
  { id: 12, title: 'Report 2024 Q3', url: 'https://example.com/report-2024' },
  { id: 13, title: 'Report 2025 Q1', url: 'https://example.com/report-2025' },
  // Mixed case
  { id: 14, title: 'HELLO World', url: 'https://example.com/hello-world' },
  // Multi-token, cross-field (word 1 in title, word 2 in url — not same field)
  { id: 15, title: 'Multi Token Example', url: 'https://foo.example.com/bar' },
  { id: 16, title: 'Unrelated Title', url: 'https://foo.example.com/baz' },
  // Punctuation-in-query-word beyond hyphen (three-way split)
  { id: 17, title: 'foo bar baz qux', url: 'https://example.com/three-way' },
  // 1-char prefix (the UNCOVERED prefix path — prefix='2 3 4' doesn't index it,
  // but matching semantics must still agree)
  { id: 18, title: 'Ore alone', url: 'https://example.com/o' },
  { id: 19, title: 'Zebra alone', url: 'https://example.com/z' }
];

const QUERIES = [
  'exa-mple', // adjacency positive/negative pin
  'exa-mplecase', // longer punctuation-split query word
  'cafe', // diacritic-folded: query WITHOUT accent should still hit accented content
  'café', // diacritic-folded: query WITH accent should hit unaccented content
  'istanbul',
  'İstanbul',
  'ore', // ligature boundary: must NOT hit øre content
  'øre', // must NOT hit plain "ore" content
  'strasse', // must NOT hit straße content
  'straße', // must NOT hit strasse content
  'lodz', // plain "l" must not fold to "ł"
  'łódź',
  'oeuvre',
  'œuvre',
  '2024',
  '202', // digit prefix
  'hello',
  'HELLO', // mixed-case query
  'multi foo', // multi-token, cross-field AND
  'multi bar', // multi-token, cross-field AND, different second word
  'multi baz', // multi-token where second word does NOT appear in entry 15 — must fail
  'foo-bar-baz', // three-way punctuation split, adjacency-positive against entry 17
  'foo-baz-bar', // same tokens, wrong order — adjacency-negative
  'o', // 1-char prefix, uncovered index path
  'z' // 1-char prefix, uncovered index path
];

test('FTS5 parity: JS matcher agrees with live unicode61 FTS5 over the pinned edge-case corpus', () => {
  const db = new DatabaseSync(':memory:');
  try {
    // Same tokenizer + prefix config as visits_fts (history-store.js schema
    // comment, verified same-day by the design reviewer) — no external-
    // content wiring needed here, direct inserts suffice for a MATCH parity
    // check.
    db.exec(`
      CREATE VIRTUAL TABLE bm_fts USING fts5(
        url, title, tokenize='unicode61', prefix='2 3 4'
      );
    `);
    const insert = db.prepare('INSERT INTO bm_fts(rowid, url, title) VALUES (?, ?, ?)');
    for (const entry of CORPUS) insert.run(entry.id, entry.url, entry.title);

    const matchStmt = db.prepare('SELECT rowid FROM bm_fts WHERE bm_fts MATCH ? ORDER BY rowid');

    const divergences = [];
    for (const query of QUERIES) {
      const ftsExpr = ftsQueryFor(query);
      const ftsMatchedIds = ftsExpr === null ? [] : matchStmt.all(ftsExpr).map((r) => r.rowid);
      const ftsMatchedSet = new Set(ftsMatchedIds);

      const jsMatchedIds = matchBookmarks(CORPUS, query, { limit: CORPUS.length }).map((e) => e.id);
      const jsMatchedSet = new Set(jsMatchedIds);

      for (const entry of CORPUS) {
        const ftsSays = ftsMatchedSet.has(entry.id);
        const jsSays = jsMatchedSet.has(entry.id);
        if (ftsSays !== jsSays) {
          divergences.push(
            `query=${JSON.stringify(query)} entry=${entry.id} (${JSON.stringify(entry)}): ` +
              `FTS5=${ftsSays} JS=${jsSays}`
          );
        }
      }
    }

    assert.deepEqual(divergences, [], `JS matcher diverged from live FTS5:\n${divergences.join('\n')}`);
  } finally {
    db.close();
  }
});

// Targeted single-assertion pins for the two headline findings (fast to read
// in isolation, redundant with the corpus sweep above by design — a future
// corpus edit that accidentally weakens coverage still trips these).
test('FTS5 parity pin: adjacency is REQUIRED, not AND-of-independent-prefixes', () => {
  assert.deepEqual(matchBookmarks(CORPUS, 'exa-mple', { limit: CORPUS.length }).map((e) => e.id), [1]);
});

test('FTS5 parity pin: ligature/stroke letters are never cross-matched', () => {
  const oreMatches = matchBookmarks(CORPUS, 'ore', { limit: CORPUS.length }).map((e) => e.id);
  assert.ok(!oreMatches.includes(6), '"ore" must not match "Øre" content');
  const orePrefixMatches = matchBookmarks(CORPUS, 'øre', { limit: CORPUS.length }).map((e) => e.id);
  assert.ok(!orePrefixMatches.includes(7), '"øre" must not match "Ore" content');
});
