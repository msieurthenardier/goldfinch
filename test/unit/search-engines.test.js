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
  buildSearchUrl,
  PENDING_QUERY_MAX,
  capPendingQuery,
  normalizeHomePageInput
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

test("exactly the mission's eight engines, in the mission's order", () => {
  assert.deepEqual(
    SEARCH_ENGINES.map((e) => e.id),
    EXPECTED_IDS
  );
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
test("buildSearchUrl substitutes a plain query into every engine's template", () => {
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
  assert.equal(buildSearchUrl('google', 'a&b=evil'), 'https://www.google.com/search?q=a%26b%3Devil');
});

test('buildSearchUrl escapes # so it cannot inject a URL fragment', () => {
  assert.equal(buildSearchUrl('google', 'a#b'), 'https://www.google.com/search?q=a%23b');
});

test('buildSearchUrl escapes literal + (encodeURIComponent does not treat + as space)', () => {
  assert.equal(buildSearchUrl('google', 'a+b'), 'https://www.google.com/search?q=a%2Bb');
});

test('buildSearchUrl escapes non-ASCII query text', () => {
  assert.equal(
    buildSearchUrl('google', 'héllo wörld'),
    `https://www.google.com/search?q=${encodeURIComponent('héllo wörld')}`
  );
  assert.equal(buildSearchUrl('google', '日本語'), `https://www.google.com/search?q=${encodeURIComponent('日本語')}`);
});

test('buildSearchUrl on Startpage still substitutes into query= (not q=) with an escaped query', () => {
  assert.equal(buildSearchUrl('startpage', 'a b&c'), 'https://www.startpage.com/sp/search?query=a%20b%26c');
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
// PENDING_QUERY_MAX / capPendingQuery (M16 F2 Leg 2, DD3 — mission constraint:
// "length-capped and never evaluated"). Positive control: an over-length
// input is truncated to EXACTLY the cap, not merely "shorter".
// ---------------------------------------------------------------------------
test('PENDING_QUERY_MAX is 2048', () => {
  assert.equal(PENDING_QUERY_MAX, 2048);
});

test('capPendingQuery trims surrounding whitespace and passes a short query through unchanged', () => {
  assert.equal(capPendingQuery('hello world'), 'hello world');
  assert.equal(capPendingQuery('  hello world  '), 'hello world');
});

test('capPendingQuery truncates an over-length query to exactly PENDING_QUERY_MAX characters (positive control)', () => {
  const long = 'x'.repeat(PENDING_QUERY_MAX + 500);
  const capped = capPendingQuery(long);
  assert.equal(capped.length, PENDING_QUERY_MAX);
  assert.equal(capped, 'x'.repeat(PENDING_QUERY_MAX));
});

test('capPendingQuery on an exactly-cap-length query returns it unchanged', () => {
  const exact = 'y'.repeat(PENDING_QUERY_MAX);
  assert.equal(capPendingQuery(exact), exact);
});

test('a <script>-shaped query is capPendingQuery-safe as plain text (no markup interpretation at this layer)', () => {
  const hostile = '<script>alert(1)</script>';
  assert.equal(
    capPendingQuery(hostile),
    hostile,
    'capPendingQuery is a plain trim+truncate — never sanitizes markup, because it is only ever rendered via textContent and encoded via buildSearchUrl, never assigned to innerHTML'
  );
});

test('buildSearchUrl truncates an over-length query to PENDING_QUERY_MAX before encoding (second enforcement point)', () => {
  const long = 'z'.repeat(PENDING_QUERY_MAX + 100);
  const url = buildSearchUrl('google', long);
  const expected = 'https://www.google.com/search?q=' + encodeURIComponent('z'.repeat(PENDING_QUERY_MAX));
  assert.equal(url, expected);
});

test('buildSearchUrl encodes a <script>-shaped query as data, never as markup', () => {
  const hostile = '<script>alert(1)</script>';
  const url = buildSearchUrl('google', hostile);
  assert.equal(url, 'https://www.google.com/search?q=' + encodeURIComponent(hostile));
  assert.ok(!url.includes('<script>'), 'the raw tag must never survive unescaped into the URL');
});

// ---------------------------------------------------------------------------
// M16 F2 Leg 2 (DD7): no engine id/label/description is duplicated in
// welcome-controller.js's engine block — the F1 no-duplication pattern
// (settings-page-shared-scripts.test.js's identical check for settings.html /
// settings.js), extended to the welcome surface's own consumer. Also pins
// that settings.html carries the engine-clear affordance (DD6).
// ---------------------------------------------------------------------------
test('no engine label/description is duplicated in welcome-controller.js (DD7: single source is search-engines.js)', () => {
  const fs = require('fs');
  const path = require('path');
  const welcomeSrc = fs.readFileSync(path.join(__dirname, '../../src/renderer/chrome/welcome-controller.js'), 'utf8');
  assert.ok(SEARCH_ENGINES.length > 0, 'sanity: the curated table must be non-empty for this check to mean anything');
  for (const engine of SEARCH_ENGINES) {
    assert.ok(
      !welcomeSrc.includes(engine.label) && !welcomeSrc.includes(engine.description),
      `welcome-controller.js contains a literal engine label/description for "${engine.id}" — it must render from ` +
        'the imported SEARCH_ENGINES table, never a hand-typed copy'
    );
  }
});

// ---------------------------------------------------------------------------
// M16 F3 Leg 1 (DD2): the welcome surface's DOM contract is frozen — every id,
// class hook, and `.hidden` toggle the Flight 2 behavior specs and this file's
// own tests read must survive the restyle. Grep-shape per the house
// convention (no DOM harness for the chrome). This test must go RED if any one
// id assignment is removed from welcome-controller.js (hand-neuter check
// recorded in the flight log).
// ---------------------------------------------------------------------------
test('welcome-controller.js: the DOM contract (ids, radio prefix, row class, radiogroup role) survives the restyle (M16 F3 Leg 1, DD2)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/chrome/welcome-controller.js'), 'utf8');

  const CONTRACT_IDS = [
    'welcome-heading',
    'welcome-home-block',
    'welcome-home-input',
    'welcome-home-set',
    'welcome-home-status',
    'welcome-burner-note',
    'welcome-engine-block',
    'welcome-engine-heading',
    'welcome-engine-options',
    'welcome-engine-status'
  ];
  for (const id of CONTRACT_IDS) {
    const re = new RegExp("\\.id = '" + id + "'");
    assert.ok(re.test(src), `welcome-controller.js must still assign the DOM-contract id "${id}" (M16 F3 Leg 1, DD2)`);
  }

  assert.ok(
    /radio\.id = 'welcome-engine-' \+/.test(src),
    'the per-engine radio id prefix ("welcome-engine-" + engine.id) must be unchanged'
  );
  assert.ok(
    /row\.className = 'welcome-engine-row'/.test(src),
    'the per-engine row must still carry the "welcome-engine-row" class the specs and CSS key off'
  );
  assert.ok(
    /'role', 'radiogroup'/.test(src) && /'aria-labelledby', 'welcome-engine-heading'/.test(src),
    '#welcome-engine-options must carry role="radiogroup" and aria-labelledby="welcome-engine-heading"'
  );

  const renderMatch = src.match(/function render\(tab[^)]*\)\s*{([\s\S]*?)\n {2}}/);
  assert.ok(renderMatch, 'welcome-controller.js must export a function render(tab, ...) { ... }');
  const toggles = renderMatch[1].match(/classList\.toggle\('hidden'/g) || [];
  assert.ok(
    toggles.length >= 3,
    'render(tab) must toggle `hidden` on at least the home block, the burner note, and the engine block ' +
      `(found ${toggles.length})`
  );
});

// ---------------------------------------------------------------------------
// M16 F2 Leg 2 acceptance-gate fix (settle()'s attach behavior narrowed at
// M16 F3 Leg 2, HAT item 6, DD7 pivot — the assertions below still hold):
// welcome-controller.js's show(tab) must settle a record whose reasons are
// now all set (a background welcome record can have its last preference
// filled in from elsewhere while it is not the active tab — see settle()'s
// doc comment) rather than re-rendering unconditionally. There is no DOM
// harness for the chrome welcome controller, so this is pinned structurally:
// show() must delegate through settle() rather than drawing the panel
// directly, and settle() must never call back into show() (that would
// recurse).
// ---------------------------------------------------------------------------
test('welcome-controller.js: show(tab) delegates to settle(tab) rather than rendering unconditionally (M16 F2 Leg 2 gate fix)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/chrome/welcome-controller.js'), 'utf8');

  const showMatch = src.match(/function show\(tab\)\s*{([\s\S]*?)\n {2}}/);
  assert.ok(showMatch, 'welcome-controller.js must export a function show(tab) { ... }');
  assert.ok(
    /settle\(tab\)/.test(showMatch[1]),
    'show(tab) must call settle(tab) — a background welcome record whose last unset ' +
      'reason was filled in elsewhere only gets a chance to catch up on its NEXT show(), ' +
      'so show() cannot just render the panel unconditionally (the gate finding: it ' +
      'rendered an empty, unattached panel instead)'
  );

  const settleMatch = src.match(/function settle\(tab[^)]*\)\s*{([\s\S]*?)\n {2}}/);
  assert.ok(settleMatch, 'welcome-controller.js must export a function settle(tab, ...) { ... }');
  assert.ok(
    !/\bshow\(tab\)/.test(settleMatch[1]),
    'settle(tab) must never call back into show(tab) — since show(tab) now delegates ' +
      'to settle(tab), a call the other way would recurse'
  );
  assert.ok(
    /render\(tab/.test(settleMatch[1]),
    'settle(tab) should still render(tab, ...) for the ordinary case — a pending search ' +
      'with a resolved engine is the only case that skips it (M16 F3 Leg 2, HAT item 6, DD7 pivot)'
  );
});

// ---------------------------------------------------------------------------
// M16 F3 Leg 2 (HAT item 3 design review): selecting a search engine no
// longer hides the engine block — it stays, showing the selection, with a
// state-derived confirmation line. Grep-shape, same convention as the DD2
// contract test above (no DOM harness for the chrome).
// ---------------------------------------------------------------------------
test("welcome-controller.js: render(tab) gates the engine block on reasons.has('search'), not the live unset state (M16 F3 Leg 2, HAT item 3)", () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/chrome/welcome-controller.js'), 'utf8');

  const renderMatch = src.match(/function render\(tab[^)]*\)\s*{([\s\S]*?)\n {2}}/);
  assert.ok(renderMatch, 'welcome-controller.js must export a function render(tab, ...) { ... }');

  const engineToggleLine = (renderMatch[1].match(/engineBlock\.classList\.toggle\('hidden'[^\n]*/) || [''])[0];
  assert.ok(
    /reasons\.has\('search'\)/.test(renderMatch[1]),
    "render(tab) must gate the engine block's visibility on tab.welcome.reasons.has('search') " +
      "(why the tab was opened), not on unsetReasons(...).has('search')"
  );
  assert.ok(
    !/unset\.has\('search'\)/.test(engineToggleLine),
    "the engine block's hidden toggle must not read the unset-state Set — choosing an engine must not hide it"
  );
});

test("welcome-controller.js: submitEngine no longer deletes 'search' from reasons and settles with a search: override (M16 F3 Leg 2, HAT item 3)", () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/chrome/welcome-controller.js'), 'utf8');

  const submitEngineMatch = src.match(/async function submitEngine\(id\)\s*{([\s\S]*?)\n {2}}/);
  assert.ok(submitEngineMatch, 'welcome-controller.js must export an async function submitEngine(id) { ... }');
  assert.ok(
    !/reasons\.delete\('search'\)/.test(submitEngineMatch[1]),
    "submitEngine must no longer mutate reasons — deleting 'search' would (once render keys off " +
      "reasons.has('search')) hide the block instead of keeping it visible with the selection"
  );
  assert.ok(
    /settle\(tab,\s*{\s*search:\s*id\s*}\)/.test(submitEngineMatch[1]),
    'submitEngine must call settle(tab, { search: id }) so the just-chosen engine overrides the live ' +
      '(possibly-stale) searchEngineCache read'
  );
});

test('welcome-controller.js: the engine radio sync assigns .checked directly and the file never calls .click() on a radio (M16 F3 Leg 2, HAT item 3)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/chrome/welcome-controller.js'), 'utf8');

  assert.ok(
    /radio\.checked = \(?radio\.value === engine\)?/.test(src),
    "render(tab) must sync each radio's .checked by direct assignment against the resolved engine"
  );

  // Strip comment-only lines first — the fix comment above the sync
  // discusses ".click()" in prose, which would otherwise false-positive
  // against a naive whole-file regex (same convention as the "Electron-free"
  // check below).
  const code = src
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  assert.ok(
    !/\.click\(/.test(code),
    'welcome-controller.js must never call .click() on a radio — programmatic .checked does not fire ' +
      '`change`, and .click() would re-fire it and re-submit'
  );
});

test('welcome-controller.js: render(tab) sets the state-derived "Saved" confirmation when the engine block is shown and an engine is resolved (M16 F3 Leg 2, HAT item 3)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/chrome/welcome-controller.js'), 'utf8');

  const renderMatch = src.match(/function render\(tab[^)]*\)\s*{([\s\S]*?)\n {2}}/);
  assert.ok(renderMatch, 'welcome-controller.js must export a function render(tab, ...) { ... }');
  assert.ok(
    renderMatch[1].includes('Saved — you can always change this in Settings.'),
    'render(tab) must set #welcome-engine-status to the confirmation text when the engine block is ' +
      'shown and the resolved engine is non-null'
  );
});

// ---------------------------------------------------------------------------
// M16 F3 Leg 2 (HAT state D): the tagline becomes dynamic, chosen in
// render(tab, opts) from the same showHome/showEngine booleans it already
// computes for the two block classList.toggle('hidden', ...) calls — a
// single-card record (search-only or home-only) no longer reads the
// two-card "Set up the two things…" copy. Grep-shape, same convention as
// the other structural tests in this file (no DOM harness for the chrome).
// ---------------------------------------------------------------------------
test('welcome-controller.js: render(tab) assigns tagline.textContent from the block-visibility booleans (M16 F3 Leg 2, HAT state D)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/chrome/welcome-controller.js'), 'utf8');

  const renderMatch = src.match(/function render\(tab[^)]*\)\s*{([\s\S]*?)\n {2}}/);
  assert.ok(renderMatch, 'welcome-controller.js must export a function render(tab, ...) { ... }');
  assert.ok(
    /tagline\.textContent = /.test(renderMatch[1]),
    'render(tab) must assign tagline.textContent — the tagline copy is dynamic, chosen per render, ' +
      'not fixed at build time'
  );
});

test('welcome-controller.js: all three tagline copy strings are present in the controller source (M16 F3 Leg 2, HAT state D)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/chrome/welcome-controller.js'), 'utf8');

  assert.ok(
    src.includes("Set up the two things Goldfinch won't guess for you. You can always change these in Settings."),
    'the "both blocks shown" (and defensive-fallback) tagline copy must be present'
  );
  assert.ok(
    src.includes('Choose where new tabs open. You can always change this in Settings.'),
    'the "home block only" tagline copy must be present'
  );
  assert.ok(
    src.includes('Choose where your searches go. You can always change this in Settings.'),
    'the "engine block only" tagline copy must be present'
  );
});

// ---------------------------------------------------------------------------
// M16 F3 Leg 2 (HAT item 6 design review, DD7 pivot): the welcome surface
// never navigates on its own except to run a pending search once an engine
// is chosen. Clicking Set on the home card saves and stays — the home page
// applies to the next new tab, not this one. Grep-shape, same convention as
// the other structural tests in this file (no DOM harness for the chrome).
// ---------------------------------------------------------------------------
test("welcome-controller.js: render(tab) gates the home block on reasons.has('home'), symmetric with the engine block (M16 F3 Leg 2, HAT item 6)", () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/chrome/welcome-controller.js'), 'utf8');

  const renderMatch = src.match(/function render\(tab[^)]*\)\s*{([\s\S]*?)\n {2}}/);
  assert.ok(renderMatch, 'welcome-controller.js must export a function render(tab, ...) { ... }');
  assert.ok(
    /reasons\.has\('home'\)/.test(renderMatch[1]),
    "render(tab) must gate the home block's visibility on tab.welcome.reasons.has('home') " +
      "(why the tab was opened), symmetric with the engine block's reasons.has('search') check"
  );
});

test('welcome-controller.js: submitHome calls settle(tab, { home: ... }) and never attachView (M16 F3 Leg 2, HAT item 6, DD7 pivot)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/chrome/welcome-controller.js'), 'utf8');

  const submitHomeMatch = src.match(/async function submitHome\(\)\s*{([\s\S]*?)\n {2}}/);
  assert.ok(submitHomeMatch, 'welcome-controller.js must export an async function submitHome() { ... }');
  assert.ok(
    /settle\(tab,\s*{\s*home:\s*value\s*}\)/.test(submitHomeMatch[1]),
    'submitHome must call settle(tab, { home: value }) so the just-written home page overrides ' +
      'the live (possibly-stale) homePageCache read, instead of attaching the tab to it'
  );
  assert.ok(
    !/attachView\(/.test(submitHomeMatch[1]),
    'submitHome must never call attachView — clicking Set saves and stays; the welcome surface ' +
      'does not navigate itself away on a successful home-page submit'
  );
});

test('welcome-controller.js: render(tab) sets the state-derived "Saved — new tabs will open here." confirmation when the home block is shown and a home page is resolved (M16 F3 Leg 2, HAT item 6)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/chrome/welcome-controller.js'), 'utf8');

  const renderMatch = src.match(/function render\(tab[^)]*\)\s*{([\s\S]*?)\n {2}}/);
  assert.ok(renderMatch, 'welcome-controller.js must export a function render(tab, ...) { ... }');
  assert.ok(
    renderMatch[1].includes('Saved — new tabs will open here.'),
    'render(tab) must set #welcome-home-status to the confirmation text when the home block is ' +
      'shown and the resolved home page is non-null'
  );
});

test('welcome-controller.js: settle(tab) never attaches to the resolved home page — attachView appears exactly once, in the pending-search branch (M16 F3 Leg 2, HAT item 6, DD7 pivot)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/chrome/welcome-controller.js'), 'utf8');

  const settleMatch = src.match(/function settle\(tab[^)]*\)\s*{([\s\S]*?)\n {2}}/);
  assert.ok(settleMatch, 'welcome-controller.js must export a function settle(tab, ...) { ... }');
  assert.ok(
    !/currentHomePage\(\)/.test(settleMatch[1]),
    'settle(tab) must not read currentHomePage() at all — the DD7 pivot removes the ' +
      'attach-to-home-page-once-nothing-is-missing branch entirely'
  );
  const attachCalls = settleMatch[1].match(/attachView\(/g) || [];
  assert.equal(
    attachCalls.length,
    1,
    'settle(tab) must call attachView exactly once — the pending-search branch — with no ' +
      'other auto-navigation left'
  );
  assert.ok(
    /if \(query != null && engine != null\)/.test(settleMatch[1]),
    'settle(tab) must gate its one attachView call on a pending query AND a resolved engine'
  );
});

test('welcome-controller.js: unsetReasons no longer exists (M16 F3 Leg 2, HAT item 6, DD7 pivot — no callers remain)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/chrome/welcome-controller.js'), 'utf8');
  assert.ok(!/unsetReasons/.test(src), 'unsetReasons must be fully removed from welcome-controller.js');
});

test('settings.html carries the search-engine Clear affordance (M16 F2 Leg 2, DD6)', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '../../src/renderer/pages/settings.html'), 'utf8');
  assert.ok(html.includes('id="search-engine-clear"'), 'settings.html should have a #search-engine-clear button');
});

// ---------------------------------------------------------------------------
// normalizeHomePageInput (M16 F3 Leg 2, HAT item 5): a bare domain typed into
// a home-page field is accepted the same way the address bar already accepts
// one, on both the welcome surface and Settings — the store validator
// (isSafeTabUrl) stays the actual gate.
// ---------------------------------------------------------------------------
test('normalizeHomePageInput prepends https:// to a bare domain', () => {
  assert.equal(normalizeHomePageInput('example.com'), 'https://example.com');
});

test('normalizeHomePageInput prepends https:// to a bare domain with a path', () => {
  assert.equal(normalizeHomePageInput('example.com/path'), 'https://example.com/path');
});

test('normalizeHomePageInput trims surrounding whitespace before normalizing', () => {
  assert.equal(normalizeHomePageInput('  example.com  '), 'https://example.com');
});

test('normalizeHomePageInput leaves an already-schemed URL unchanged', () => {
  assert.equal(normalizeHomePageInput('https://example.com'), 'https://example.com');
});

test('normalizeHomePageInput leaves a non-https scheme unchanged', () => {
  assert.equal(normalizeHomePageInput('http://x'), 'http://x');
});

test("normalizeHomePageInput leaves about:blank unchanged (the scheme/about: shape is not the domain rule's concern)", () => {
  assert.equal(normalizeHomePageInput('about:blank'), 'about:blank');
});

test('normalizeHomePageInput leaves "localhost" unchanged (documented gap: the domain rule requires a dot)', () => {
  assert.equal(normalizeHomePageInput('localhost'), 'localhost');
});

test('normalizeHomePageInput leaves free text with spaces unchanged', () => {
  assert.equal(normalizeHomePageInput('foo bar'), 'foo bar');
});

test('normalizeHomePageInput returns an empty string for an empty/whitespace-only input', () => {
  assert.equal(normalizeHomePageInput(''), '');
  assert.equal(normalizeHomePageInput('   '), '');
});

test('normalizeHomePageInput returns an empty string for null/undefined', () => {
  assert.equal(normalizeHomePageInput(null), '');
  assert.equal(normalizeHomePageInput(undefined), '');
});

// ---------------------------------------------------------------------------
// M16 F3 Leg 2 (HAT item 5): structural pins (grep-shape, house convention —
// no DOM harness for the chrome / the internal Settings page) that the
// domain-normalize fix actually reaches both write sites, and that toUrl's
// pre-existing about: guard survives the reuse (design review [high]).
// ---------------------------------------------------------------------------
test('welcome-controller.js: submitHome normalizes the input through normalizeHomePageInput before writing (M16 F3 Leg 2, HAT item 5)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/chrome/welcome-controller.js'), 'utf8');
  const submitHomeMatch = src.match(/async function submitHome\(\)\s*{([\s\S]*?)\n {2}}/);
  assert.ok(submitHomeMatch, 'welcome-controller.js must export an async function submitHome() { ... }');
  assert.ok(
    /normalizeHomePageInput\(/.test(submitHomeMatch[1]),
    'submitHome must normalize homeInput.value through normalizeHomePageInput before it is written'
  );
});

test('settings.js: the home-page Save handler normalizes the input through normalizeHomePageInput before writing (M16 F3 Leg 2, HAT item 5)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/pages/settings.js'), 'utf8');
  const saveMatch = src.match(/saveBtn\.addEventListener\('click', \(\) => {([\s\S]*?)\n {2}}\);/);
  assert.ok(saveMatch, 'settings.js must register a home-page saveBtn click handler');
  assert.ok(
    /normalizeHomePageInput\(/.test(saveMatch[1]),
    'the home-page Save handler must normalize input.value through normalizeHomePageInput before ' +
      "settingsSet('homePage', ...)"
  );
});

test('navigation-controller.js: toUrl keeps its about: guard and reuses normalizeHomePageInput for the domain rule (M16 F3 Leg 2, HAT item 5)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/chrome/navigation-controller.js'), 'utf8');
  const toUrlMatch = src.match(/function toUrl\(input\)\s*{([\s\S]*?)\n {2}}/);
  assert.ok(toUrlMatch, 'navigation-controller.js must export a function toUrl(input) { ... }');
  assert.ok(
    /s\.startsWith\('about:'\)/.test(toUrlMatch[1]),
    'toUrl must keep its own about: guard — a typed about:blank must never fall through to the ' +
      'reused domain-normalize rule or the search branch beyond it (design review [high])'
  );
  assert.ok(
    /normalizeHomePageInput\(/.test(toUrlMatch[1]),
    'toUrl must reuse normalizeHomePageInput for its domain branch rather than keeping a second copy ' +
      'of the domain regex'
  );
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
