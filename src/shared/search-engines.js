// @ts-check

// Curated search-engine table (M16 Flight 1 "Search Engine as a Preference" /
// DD1). `searchEngine` (settings-store.js) stores an ENGINE ID, never a URL
// template — the templates live here, in one shared table, so a stored value
// can never smuggle an arbitrary URL and an upstream engine-URL change is a
// table edit, not a schema migration. Consumed by the main-process validator
// (settings-store.js's VALIDATORS.searchEngine, built off SEARCH_ENGINE_IDS
// below) and, from leg 2, the renderer's URL construction — the same
// src/shared/ import precedent settings-store.js already follows for
// `url-safety.js` (settings-store.js:24).
//
// Table content and order are the mission's resolved ruling (mission.md Open
// Questions, "Which engines are on the list?", resolved 2026-08-09, operator
// after market research): privacy-first engines first, Google/Bing last.
// DuckDuckGo and Startpage are privacy LAYERS over Bing and Google respectively
// (no independent index of their own); Brave, Mojeek, and Qwant/Ecosia (which
// jointly build a shared, independently crawled European index) run
// independent crawlers. Google and Bing stay on the list deliberately — the
// mission's outcome is choice, not house-picking a replacement default, and
// removing them would substitute the project's preference for the user's.
//
// Deliberately excluded (same ruling, not a bug/oversight — first candidates
// if custom engines are ever revisited): Kagi (requires a paid, logged-in
// account — offering it to a signed-out user produces a broken search) and
// SearXNG (instance-specific — supporting it means accepting a user-supplied
// URL, which the mission's curated-allowlist-only constraint rules out; an
// attacker-controlled template is an injection vector needing its own
// security review, out of scope).
//
// Startpage's substitution parameter is `query`, not `q` — concrete proof the
// stored shape must be a full template with a substitution point, not a base
// URL the code appends `?q=` to (mission.md, same ruling).
//
// Real ES module (src/shared/ convention, M07 Flight 2 end-state) — pure data
// + pure functions, no imports, Electron-free (does not reach into any
// Electron module). Loaded via
// `<script type="module">` by the chrome (leg 2) and via Node's synchronous
// `require(esm)` by the unit tests and settings-store.js, same as every other
// src/shared/ pure decision module.

/**
 * @typedef {{ id: string, label: string, template: string, description: string }} SearchEngine
 */

/** @type {ReadonlyArray<SearchEngine>} */
export const SEARCH_ENGINES = Object.freeze([
  Object.freeze({
    id: 'duckduckgo',
    label: 'DuckDuckGo',
    template: 'https://duckduckgo.com/?q=%s',
    description: 'A privacy layer over Bing search results — no tracking, no search history.'
  }),
  Object.freeze({
    id: 'brave',
    label: 'Brave Search',
    template: 'https://search.brave.com/search?q=%s',
    description: 'An independent-index search engine built by Brave.'
  }),
  Object.freeze({
    id: 'startpage',
    label: 'Startpage',
    template: 'https://www.startpage.com/sp/search?query=%s',
    description: 'A privacy layer over Google search results — no tracking, no search history.'
  }),
  Object.freeze({
    id: 'mojeek',
    label: 'Mojeek',
    template: 'https://www.mojeek.com/search?q=%s',
    description: 'An independent-crawler search engine with its own index.'
  }),
  Object.freeze({
    id: 'qwant',
    label: 'Qwant',
    template: 'https://www.qwant.com/?q=%s',
    description: 'A European search engine sharing an independent index with Ecosia.'
  }),
  Object.freeze({
    id: 'ecosia',
    label: 'Ecosia',
    template: 'https://www.ecosia.org/search?q=%s',
    description: 'A European search engine sharing an independent index with Qwant.'
  }),
  Object.freeze({
    id: 'google',
    label: 'Google',
    template: 'https://www.google.com/search?q=%s',
    // No mission copy for Google/Bing (mission gives descriptions for the
    // privacy-first six only) — neutral-factual placeholder per leg-1 design
    // guidance; copy refinement is an accepted leg-2 variation.
    description: 'The most widely used search engine.'
  }),
  Object.freeze({
    id: 'bing',
    label: 'Bing',
    template: 'https://www.bing.com/search?q=%s',
    description: "Microsoft's search engine."
  })
]);

// O(1) membership check for the settings-store validator (DD8: the validator
// must reject every non-curated id, including a removed/renamed one — this
// Set is the single membership source, never re-derived by string comparison
// at the call site).
/** @type {ReadonlySet<string>} */
export const SEARCH_ENGINE_IDS = Object.freeze(new Set(SEARCH_ENGINES.map((e) => e.id)));

/**
 * Look up an engine descriptor by id.
 * @param {string} id
 * @returns {SearchEngine | null}
 */
export function getSearchEngine(id) {
  for (const engine of SEARCH_ENGINES) {
    if (engine.id === id) return engine;
  }
  return null;
}

/**
 * Build a search URL for the given engine id and query, substituting the
 * template's ONE `%s` placeholder with an `encodeURIComponent`-escaped query.
 * Never throws: an unknown engine id returns null (mirrors jarDataClassById's
 * lookup-miss shape) rather than surfacing a stored-data problem as a thrown
 * error from a pure builder.
 * @param {string} id
 * @param {string} query
 * @returns {string | null}
 */
export function buildSearchUrl(id, query) {
  const engine = getSearchEngine(id);
  if (!engine) return null;
  return engine.template.replace('%s', () => encodeURIComponent(query));
}
