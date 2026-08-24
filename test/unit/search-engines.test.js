'use strict';

// Unit tests for src/shared/search-engines.js (M16 Flight 1 "Search Engine as a
// Preference" / Leg 1, DD1).
//
// Pure, dependency-free ES module — exercised via require(esm) below
// (destructuring the module namespace, same as jar-data-classes.test.js).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  SEARCH_ENGINES,
  SEARCH_ENGINE_IDS,
  getSearchEngine,
  buildSearchUrl
} = require('../../src/shared/search-engines');

// The mission's resolved eight-engine table (mission.md Open Questions,
// "Which engines are on the list?", resolved 2026-08-09) — order matters
// (privacy-first engines before Google/Bing, per the ruling).
const EXPECTED_IDS = ['duckduckgo', 'brave', 'startpage', 'mojeek', 'qwant', 'ecosia', 'google', 'bing'];

// ---------------------------------------------------------------------------
// Shape / frozen-ness
// ---------------------------------------------------------------------------
test('SEARCH_ENGINES is frozen and every descriptor is frozen', () => {
  assert.ok(Object.isFrozen(SEARCH_ENGINES));
  for (const e of SEARCH_ENGINES) assert.ok(Object.isFrozen(e), `descriptor "${e.id}" should be frozen`);
});

test('exactly the mission\'s eight engines, in the mission\'s order', () => {
  assert.deepEqual(SEARCH_ENGINES.map((e) => e.id), EXPECTED_IDS);
  assert.equal(new Set(SEARCH_ENGINES.map((e) => e.id)).size, EXPECTED_IDS.length, 'ids are unique');
});

test('every engine has a non-empty label, template, and description', () => {
  for (const e of SEARCH_ENGINES) {
    assert.equal(typeof e.label, 'string');
    assert.ok(e.label.length > 0, `"${e.id}" should have a non-empty label`);
    assert.equal(typeof e.template, 'string');
    assert.ok(e.template.length > 0, `"${e.id}" should have a non-empty template`);
    assert.equal(typeof e.description, 'string');
    assert.ok(e.description.length > 0, `"${e.id}" should have a non-empty description`);
  }
});

test('every template contains exactly one %s substitution point', () => {
  for (const e of SEARCH_ENGINES) {
    const matches = e.template.match(/%s/g) || [];
    assert.equal(matches.length, 1, `"${e.id}".template should contain exactly one %s, got ${matches.length}`);
  }
});

test('every template is an https:// URL', () => {
  for (const e of SEARCH_ENGINES) {
    assert.ok(e.template.startsWith('https://'), `"${e.id}".template should be https://`);
  }
});

test('Startpage uses the query= parameter, not q= (mission ruling — a concrete proof point for full-template storage)', () => {
  const startpage = getSearchEngine('startpage');
  assert.equal(startpage.template, 'https://www.startpage.com/sp/search?query=%s');
  assert.ok(!startpage.template.includes('q=%s'), 'Startpage must not use the q= parameter');
});

test('Kagi and SearXNG are not in the table (deliberately excluded per mission ruling)', () => {
  const ids = SEARCH_ENGINES.map((e) => e.id);
  assert.ok(!ids.includes('kagi'));
  assert.ok(!ids.includes('searxng'));
});

// ---------------------------------------------------------------------------
// SEARCH_ENGINE_IDS
// ---------------------------------------------------------------------------
test('SEARCH_ENGINE_IDS is a frozen Set containing exactly the eight curated ids', () => {
  assert.ok(Object.isFrozen(SEARCH_ENGINE_IDS));
  assert.ok(SEARCH_ENGINE_IDS instanceof Set);
  assert.deepEqual([...SEARCH_ENGINE_IDS].sort(), [...EXPECTED_IDS].sort());
});

test('SEARCH_ENGINE_IDS rejects non-curated / hostile values', () => {
  assert.ok(!SEARCH_ENGINE_IDS.has('kagi'));
  assert.ok(!SEARCH_ENGINE_IDS.has('searxng'));
  assert.ok(!SEARCH_ENGINE_IDS.has('https://evil.example/?q=%s'));
  assert.ok(!SEARCH_ENGINE_IDS.has(''));
  assert.ok(!SEARCH_ENGINE_IDS.has('GOOGLE')); // case-sensitive
});

// ---------------------------------------------------------------------------
// getSearchEngine
// ---------------------------------------------------------------------------
test('getSearchEngine round-trips every id in SEARCH_ENGINES', () => {
  for (const e of SEARCH_ENGINES) {
    assert.equal(getSearchEngine(e.id), e);
  }
});

test('getSearchEngine returns null for an unknown id', () => {
  assert.equal(getSearchEngine('kagi'), null);
  assert.equal(getSearchEngine(''), null);
  assert.equal(getSearchEngine('GOOGLE'), null); // case-sensitive
});

// ---------------------------------------------------------------------------
// buildSearchUrl — substitution, per engine (including Startpage's query=)
// ---------------------------------------------------------------------------
test('buildSearchUrl substitutes a plain query into every engine\'s template', () => {
  const expected = {
    duckduckgo: 'https://duckduckgo.com/?q=hello',
    brave: 'https://search.brave.com/search?q=hello',
    startpage: 'https://www.startpage.com/sp/search?query=hello',
    mojeek: 'https://www.mojeek.com/search?q=hello',
    qwant: 'https://www.qwant.com/?q=hello',
    ecosia: 'https://www.ecosia.org/search?q=hello',
    google: 'https://www.google.com/search?q=hello',
    bing: 'https://www.bing.com/search?q=hello'
  };
  for (const [id, url] of Object.entries(expected)) {
    assert.equal(buildSearchUrl(id, 'hello'), url);
  }
});

test('buildSearchUrl returns null for an unknown engine id (never throws)', () => {
  assert.equal(buildSearchUrl('kagi', 'hello'), null);
  assert.equal(buildSearchUrl('', 'hello'), null);
  assert.doesNotThrow(() => buildSearchUrl('kagi', 'hello'));
});

// ---------------------------------------------------------------------------
// buildSearchUrl — query escaping (spaces, &, #, +, non-ASCII)
// ---------------------------------------------------------------------------
test('buildSearchUrl escapes spaces as %20 (encodeURIComponent, not +)', () => {
  assert.equal(buildSearchUrl('google', 'hello world'), 'https://www.google.com/search?q=hello%20world');
});

test('buildSearchUrl escapes & so it cannot inject a second query parameter', () => {
  assert.equal(
    buildSearchUrl('google', 'a&b=evil'),
    'https://www.google.com/search?q=a%26b%3Devil'
  );
});

test('buildSearchUrl escapes # so it cannot inject a URL fragment', () => {
  assert.equal(buildSearchUrl('google', 'a#b'), 'https://www.google.com/search?q=a%23b');
});

test('buildSearchUrl escapes literal + (encodeURIComponent does not treat + as space)', () => {
  assert.equal(buildSearchUrl('google', 'a+b'), 'https://www.google.com/search?q=a%2Bb');
});

test('buildSearchUrl escapes non-ASCII query text', () => {
  assert.equal(buildSearchUrl('google', 'héllo wörld'), `https://www.google.com/search?q=${encodeURIComponent('héllo wörld')}`);
  assert.equal(buildSearchUrl('google', '日本語'), `https://www.google.com/search?q=${encodeURIComponent('日本語')}`);
});

test('buildSearchUrl on Startpage still substitutes into query= (not q=) with an escaped query', () => {
  assert.equal(
    buildSearchUrl('startpage', 'a b&c'),
    'https://www.startpage.com/sp/search?query=a%20b%26c'
  );
});

test('buildSearchUrl treats a literal %s in the query as ordinary text, not a second substitution point', () => {
  // encodeURIComponent escapes the input query wholesale before it is spliced
  // into the template — a query containing the literal string "%s" must not
  // create a second substitution or otherwise corrupt the template.
  assert.equal(buildSearchUrl('google', '%s'), 'https://www.google.com/search?q=%25s');
});

test('buildSearchUrl on an empty query still produces a well-formed URL', () => {
  assert.equal(buildSearchUrl('google', ''), 'https://www.google.com/search?q=');
});

// ---------------------------------------------------------------------------
// Electron-free
// ---------------------------------------------------------------------------
test('search-engines.js does not require("electron")', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/shared/search-engines.js'), 'utf8');
  // Strip comment-only lines first — the module's own header comment discusses
  // the "no require('electron')" convention in prose, which would otherwise
  // false-positive against a naive whole-file regex.
  const code = src
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  assert.ok(!/require\(\s*['"]electron['"]\s*\)/.test(code));
});
