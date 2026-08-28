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
 * Length cap for a pending search query (M16 Flight 2 "The Welcome Surface" /
 * DD3, mission constraint: "length-capped and never evaluated"). Applied at
 * both capture sites (navigation-controller.js's handoffSearch,
 * renderer.js's sel:search dispatch) via capPendingQuery below, AND here in
 * buildSearchUrl as a second, independent enforcement point — a query can
 * only reach buildSearchUrl through one of those two capture sites today, but
 * the cap belongs to the builder's own contract, not to the caller's
 * discipline. Pre-encode: nothing downstream checks URL length, and
 * encodeURIComponent can expand a non-ASCII query several-fold — this cap
 * bounds the INPUT text, not the resulting URL's length.
 */
export const PENDING_QUERY_MAX = 2048;

/**
 * Trim and truncate a query to PENDING_QUERY_MAX characters. Used at every
 * pending-query capture site so the record never holds more than the cap,
 * and by buildSearchUrl below as a second enforcement point.
 * @param {string} text
 * @returns {string}
 */
export function capPendingQuery(text) {
  return text.trim().slice(0, PENDING_QUERY_MAX);
}

/**
 * Build a search URL for the given engine id and query, substituting the
 * template's ONE `%s` placeholder with an `encodeURIComponent`-escaped query.
 * The query is truncated to PENDING_QUERY_MAX before encoding (DD3) — a
 * second enforcement point beside the capture-site truncation, never trusting
 * the caller to have already capped it. Never throws: an unknown engine id
 * returns null (mirrors jarDataClassById's lookup-miss shape) rather than
 * surfacing a stored-data problem as a thrown error from a pure builder.
 * @param {string} id
 * @param {string} query
 * @returns {string | null}
 */
export function buildSearchUrl(id, query) {
  const engine = getSearchEngine(id);
  if (!engine) return null;
  const capped = query.slice(0, PENDING_QUERY_MAX);
  return engine.template.replace('%s', () => encodeURIComponent(capped));
}

/**
 * A bare loopback literal, matched ONLY to pick a default *scheme* (never to
 * validate or authorize a host — see `url-safety.js`'s `isSafeTabUrl`, the
 * actual gate, and `automation/origin-guard.js`'s `isLoopbackHostname` for
 * that unrelated allow-list concern). Squawk 0046: a bare `127.0.0.1:8001/x`
 * "looks like a domain" (has dots) and was getting `https://` forced onto
 * it, which fails the TLS handshake against a plain-http loopback dev server
 * and lands on a blank `chrome-error://` page.
 *
 * Deliberately narrow — three forms, scheme only, no other policy change:
 *   - `127.0.0.0/8`  (e.g. `127.0.0.1`), bare or with `:port` and/or `/path`
 *   - `::1` bare (unambiguous by itself), or bracketed `[::1]` with
 *     `:port` and/or `/path` (an unbracketed `::1:port` is NOT matched — it
 *     is a different, non-loopback IPv6 address, not "loopback plus port")
 *   - `localhost` — ONLY when a `:port` or `/path` follows. A bare
 *     `localhost` with nothing after it is deliberately EXCLUDED: that
 *     no-dot case is normalizeHomePageInput's pre-existing, intentionally
 *     tested gap (M16 F3 Leg 2, HAT item 5) and is out of this squawk's
 *     contained scope — widening it would change the Settings/welcome
 *     home-page write sites' already-agreed contract for that exact input,
 *     which is a design decision, not a defect fix.
 * Not handled (by design, per squawk 0046's qualification note): non-
 * loopback IP literals, public hosts, and any TLS-failure retry — those are
 * scheme-policy decisions beyond loopback and stay out of this rule.
 */
const LOOPBACK_LITERAL_RE =
  /^(?:127(?:\.\d{1,3}){3}(?::\d+)?(?:\/.*)?|\[::1\](?::\d+)?(?:\/.*)?|::1|localhost(?=[:/])(?::\d+)?(?:\/.*)?)$/i;

/**
 * Normalize a home-page-field input by prepending a scheme to a bare
 * domain or loopback literal (M16 F3 Leg 2 HAT item 5; loopback carve-out
 * squawk 0046): a bare `example.com` typed into the welcome surface's
 * home-page field or Settings' home-page field "looks like a domain" but
 * carries no scheme, so the store validator (`isSafeTabUrl`, which requires
 * one) rejects it — even though the address bar already accepts the same
 * bare domain via its own domain rule. This function is that same rule,
 * applied at the two home-page write sites so they agree with the address
 * bar; the store validator is unchanged and stays the actual gate.
 *
 * Lives here, not in navigation-controller.js, to reuse this module's
 * existing internal-page route (served to Settings at `/search-engines.js`)
 * and the chrome's existing import of this module — not a topical fit (the
 * rule has nothing to do with search engines), just the module that was
 * already reachable from both write sites. `navigation-controller.js`'s
 * `toUrl` calls this for its own domain branch too, so the rule has exactly
 * one source instead of two copies of the regex.
 *
 * Trims first, then: an empty string, or a value that already carries a
 * `scheme://` prefix, is returned unchanged (trimmed) — an explicit scheme,
 * including an explicit `http://` on a loopback host, is always respected;
 * a bare loopback literal (see LOOPBACK_LITERAL_RE) gets `http://`
 * prepended, preserving any port/path; a bare-domain-looking value (has a
 * dot, no whitespace) gets `https://` prepended; anything else — a bare
 * word, a bare `localhost` with nothing following (no dot — a documented
 * gap shared with the address bar's own rule), or free text with spaces —
 * is returned unchanged.
 * @param {unknown} input
 * @returns {string}
 */
export function normalizeHomePageInput(input) {
  const s = String(input ?? '').trim();
  if (s === '' || /^[a-z]+:\/\//i.test(s)) return s;
  if (LOOPBACK_LITERAL_RE.test(s)) return 'http://' + s;
  if (/^[^\s]+\.[^\s]{2,}(\/.*)?$/.test(s)) return 'https://' + s;
  return s;
}
