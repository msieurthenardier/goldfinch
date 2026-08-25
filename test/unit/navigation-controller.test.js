'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
// M16 F1 Leg 2 / F2 Leg 2: the real shared table/builder (require(esm), same
// synchronous pattern settings-store.test.js and search-engines.test.js
// already use) — toUrl's search fallback and the pending-query cap are
// exercised against the actual functions, not hand-rolled stand-ins.
const { buildSearchUrl, capPendingQuery } = require('../../src/shared/search-engines');

const moduleUrl = pathToFileURL(path.join(__dirname, '../../src/renderer/chrome/navigation-controller.js')).href;

class El {
  constructor() {
    this.listeners = new Map(); this.attributes = new Map(); this.value = ''; this.textContent = '';
    this.disabled = false; this.readOnly = false; this.blurred = false;
    this.classList = {
      values: new Set(),
      add: (x) => this.classList.values.add(x),
      remove: (x) => this.classList.values.delete(x),
      contains: (x) => this.classList.values.has(x),
      toggle: (x, force) => {
        const on = force === undefined ? !this.classList.values.has(x) : !!force;
        if (on) this.classList.values.add(x); else this.classList.values.delete(x);
        return on;
      }
    };
  }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  blur() { this.blurred = true; }
}

function harness() {
  const names = ['address', 'addressChip', 'star', 'back', 'forward', 'reload', 'newTab', 'zoomControl', 'zoomPercent', 'zoomOut', 'zoomIn', 'zoomReset', 'lightbox'];
  const els = Object.fromEntries(names.map((name) => [name, new El()]));
  els.lightbox.classList.add('hidden');
  // M16 F1 Leg 2: searchEngine defaults to null (unset) here — the harness
  // exercises toUrl's `currentSearchEngine() || 'google'` coalescing site
  // directly; individual tests set h.state.searchEngine to pin a chosen engine.
  const state = { active: null, suggestions: { open: false, token: 0 }, openedModels: [], calls: [], searchEngine: null };
  const callbacks = {};
  let suggestResolve;
  let suggestReject;
  let bookmarksSuggestResolve;
  let bookmarksSuggestReject;
  let zoomResolve;
  const window = { goldfinch: {
    tabNavigate: (payload) => state.calls.push(['navigate', payload]),
    historySuggest: (payload) => {
      state.calls.push(['historySuggest', payload]);
      return new Promise((resolve, reject) => { suggestResolve = resolve; suggestReject = reject; });
    },
    // M15 F1 Leg 4 (DD11): queried alongside historySuggest via Promise.allSettled.
    bookmarksSuggest: (payload) => {
      state.calls.push(['bookmarksSuggest', payload]);
      return new Promise((resolve, reject) => { bookmarksSuggestResolve = resolve; bookmarksSuggestReject = reject; });
    },
    getZoom: () => new Promise((resolve) => { zoomResolve = resolve; }),
    zoomApply: (payload) => state.calls.push(['zoom', payload]),
    findOverlayOpen: (payload) => state.calls.push(['find', payload]),
    onZoomChanged: (fn) => { callbacks.zoomChanged = fn; },
    onOpenFind: (fn) => { callbacks.openFind = fn; },
    onOpenDownloads: (fn) => { callbacks.openDownloads = fn; }
  } };
  const document = { activeElement: els.address };
  const ctx = { activeTabId: null };
  const bookmarks = new Set();
  const deps = {
    window, document, ctx, els,
    activeTab: () => state.active,
    isInternalTab: (tab) => !!tab?.internal,
    isWebTab: (tab) => !!tab && !tab.internal,
    createTab: (url) => state.calls.push(['create', url]),
    // M16 F2 Leg 1: the `+` pill (DD4) / navigate() on a welcome tab (DD2).
    openNewTab: () => state.calls.push(['openNewTab']),
    attachView: (tab, url) => state.calls.push(['attachView', tab && tab.id, url]),
    // M16 F2 Leg 2 (DD3): the search handoff's two outcomes — a new welcome
    // tab beside the page, or an in-place re-render of the active one.
    openWelcomeTab: (opts) => state.calls.push(['openWelcomeTab', opts]),
    refreshWelcome: (tab) => state.calls.push(['refreshWelcome', tab && tab.id]),
    capPendingQuery,
    openDownloads: () => state.calls.push(['downloads']),
    // M15 F2 Leg 3: jar-scoped — findByUrl/ensureJar both take jarId first.
    // The fixture ignores jarId for findByUrl (single shared `bookmarks` set
    // is enough for these star tests); ensureJar calls are tracked so
    // refreshStar's "prime the cache" behavior is pinned.
    bookmarksClient: {
      findByUrl: (jarId, url) => bookmarks.has(url) ? { id: 'bm', url } : null,
      ensureJar: (jarId) => state.calls.push(['ensureJar', jarId])
    },
    // M16 F1 Leg 2: the real buildSearchUrl (imported above) + a live read of
    // h.state.searchEngine — matches the renderer.js call-site shape exactly
    // (buildSearchUrl imported, currentSearchEngine() a thin cache accessor).
    buildSearchUrl,
    currentSearchEngine: () => state.searchEngine,
    isInternalPageUrl: (url) => url.startsWith('goldfinch://'),
    shouldQuery: ({ focused, isInternal, isBurner, value }) => focused && !isInternal && !isBurner && !!value.trim(),
    buildSuggestionModel: (items, selectedIndex) => ({ items, selectedIndex }),
    // Minimal stand-in (bookmark rows first, then history — full dedupe/cap
    // semantics are unit-pinned separately in omnibox-suggest-model.test.js;
    // this harness only needs to observe that the controller calls through
    // with both sources in the right positions).
    mergeSuggestionSources: (bookmarkRows, historyRows) => [
      ...bookmarkRows.map((r) => ({ ...r, kind: 'bookmark' })),
      ...historyRows.map((r) => ({ ...r, kind: 'history' }))
    ],
    moveSelection: (index, delta, length) => length ? Math.max(0, Math.min(length - 1, index + delta)) : -1,
    acceptSuggestResponse: ({ requestSeq, currentSeq, gateNow }) => requestSeq === currentSeq && gateNow,
    suggestionsState: () => state.suggestions,
    closeOverlayMenu: () => { state.suggestions.open = false; },
    openOverlayMenu: (_type, model) => { state.suggestions.open = true; state.openedModels.push(model); },
    leftAnchorOf: () => ({ x: 0, y: 0 })
  };
  return {
    deps, state, els, ctx, callbacks, bookmarks,
    resolveSuggest: (value) => suggestResolve(value),
    rejectSuggest: (err) => suggestReject(err),
    resolveBookmarksSuggest: (value) => bookmarksSuggestResolve(value),
    rejectBookmarksSuggest: (err) => bookmarksSuggestReject(err),
    resolveZoom: (value) => zoomResolve(value)
  };
}

async function create(h) {
  const { createNavigationController } = await import(moduleUrl);
  return createNavigationController(h.deps);
}

// NARROWED (M16 F2 L2 / DD3 — not a rename, the name/meaning are unchanged):
// this test used to also pin `toUrl('hello world')` falling back to Google
// via the removed engine fallback — that assertion moved to the actually-
// renamed 'toUrl builds the search URL...' test below; internal/web
// navigation coverage here is untouched.
test('URL conversion and navigation preserve internal-tab refusal and web-tab capture', async () => {
  const h = harness();
  const controller = await create(h);
  assert.equal(controller.toUrl('example.com/path'), 'https://example.com/path');

  h.state.active = { id: 'internal', internal: true, wcId: 1 };
  controller.navigate('example.com');
  assert.deepEqual(h.state.calls.pop(), ['create', 'https://example.com']);
  h.state.active = { id: 'web', internal: false, wcId: 9 };
  controller.navigate('https://example.test/');
  assert.deepEqual(h.state.calls.pop(), ['navigate', { wcId: 9, verb: 'loadURL', args: ['https://example.test/'] }]);
});

// M16 F2 Leg 1 (DD2): a viewless welcome record's first navigation attaches a
// view via attachView, whatever the entry point — never the ordinary
// tabNavigate IPC (there is no wcId to send it to).
test('navigate on a welcome record calls attachView, not tabNavigate', async () => {
  const h = harness();
  const controller = await create(h);
  h.state.active = { id: 'w', wcId: null, welcome: { reasons: new Set(['home']), pendingQuery: null } };
  controller.navigate('example.com');
  assert.deepEqual(h.state.calls.pop(), ['attachView', 'w', 'https://example.com']);
});

// M16 F2 Leg 1 (DD4): the `+` pill routes through the resolver, not a bare createTab().
test('the + pill calls openNewTab, not createTab', async () => {
  const h = harness();
  await create(h);
  h.els.newTab.listeners.get('click')();
  assert.deepEqual(h.state.calls.pop(), ['openNewTab']);
});

// M16 F2 Leg 1 (DD7): both nav buttons disable on a viewless (welcome) tab,
// exactly as they already do on an internal tab.
test('updateNavButtons disables Back/Forward when the active tab has no wcId (welcome record)', async () => {
  const h = harness();
  const controller = await create(h);
  h.state.active = { id: 'w', internal: false, wcId: null };
  h.els.back.disabled = false;
  h.els.forward.disabled = false;
  controller.updateNavButtons();
  assert.equal(h.els.back.disabled, true);
  assert.equal(h.els.forward.disabled, true);
});

// RENAMED (M16 F2 L2 / DD3 — was 'toUrl builds the search URL from the
// current search engine, non-default and default', whose third case pinned
// `currentSearchEngine() === null` coalescing to Google): toUrl now returns
// null for a search with no engine chosen — the removed engine fallback is
// gone, and a null return routes through navigate()'s handoffSearch instead
// (covered by the dedicated handoffSearch tests below). The non-null cases
// (a chosen non-default engine, and the curated 'google' id chosen
// explicitly) are unchanged — they are ordinary curated-id lookups, not the
// coalescing site this DD removes.
test('toUrl builds the search URL from the current search engine when one is chosen; returns null when none is', async () => {
  const h = harness();
  const controller = await create(h);

  h.state.searchEngine = 'duckduckgo';
  assert.equal(controller.toUrl('hello world'), 'https://duckduckgo.com/?q=hello%20world');

  h.state.searchEngine = 'google';
  assert.equal(controller.toUrl('hello world'), 'https://www.google.com/search?q=hello%20world');

  // M16 F2 Leg 2 (DD3): unset (null) now returns null from toUrl itself —
  // never a coalesced URL — so navigate() can route it to the welcome
  // handoff instead of ever resolving a query into a provider nobody chose.
  h.state.searchEngine = null;
  assert.equal(controller.toUrl('hello world'), null);
});

// ---------------------------------------------------------------------------
// M16 F2 Leg 2 (DD3): navigate()'s merged body — the empty-input guard, the
// null-before-attach ordering, and handoffSearch's two outcomes.
// ---------------------------------------------------------------------------

test('navigate ignores empty or whitespace-only input — no handoff, no navigation, no welcome tab', async () => {
  const h = harness();
  const controller = await create(h);
  h.state.active = { id: 'a', internal: false, wcId: 9 };
  controller.navigate('');
  controller.navigate('   ');
  assert.deepEqual(h.state.calls, []);
});

test('a search with no engine on a WEB tab opens a new welcome record beside it, with the capped query, and leaves the original tab untouched', async () => {
  const h = harness();
  const controller = await create(h);
  h.state.searchEngine = null;
  const tab = { id: 'web', internal: false, wcId: 9, container: { id: 'jar-a' } };
  h.state.active = tab;
  controller.navigate('hello world');
  assert.deepEqual(h.state.calls.pop(), [
    'openWelcomeTab',
    { container: tab.container, reasons: ['search'], pendingQuery: 'hello world' }
  ]);
  // The original tab is untouched — no tabNavigate, no attachView against it.
  assert.equal(h.state.calls.some(([name]) => name === 'navigate' || name === 'attachView'), false);
});

// M16 F2 Leg 2 (DD3): the null-before-attach ordering — attachView(tab, null)
// would silently drop the query, so a search on an ALREADY-welcome record
// must add the reason/query in place, never reach attachView.
test('a search with no engine on an ACTIVE welcome record adds the reason and query in place — never reaches attachView', async () => {
  const h = harness();
  const controller = await create(h);
  h.state.searchEngine = null;
  const tab = { id: 'w', wcId: null, welcome: { reasons: new Set(['home']), pendingQuery: null } };
  h.state.active = tab;
  controller.navigate('hello world');
  assert.ok(tab.welcome.reasons.has('search'));
  assert.equal(tab.welcome.pendingQuery, 'hello world');
  assert.deepEqual(h.state.calls.pop(), ['refreshWelcome', 'w']);
  assert.equal(h.state.calls.some(([name]) => name === 'attachView' || name === 'openWelcomeTab'), false);
});

// A URL typed on a welcome record still attaches (DD3's stated invariant —
// the null-before-attach ordering only diverts a SEARCH, never a real URL).
test('a real URL typed on a welcome record still attaches (unaffected by the search-handoff ordering)', async () => {
  const h = harness();
  const controller = await create(h);
  const tab = { id: 'w', wcId: null, welcome: { reasons: new Set(['home']), pendingQuery: null } };
  h.state.active = tab;
  controller.navigate('example.com');
  assert.deepEqual(h.state.calls.pop(), ['attachView', 'w', 'https://example.com']);
});

test('suggestion responses are rejected after the tab controller invalidates on switch', async () => {
  const h = harness();
  const controller = await create(h);
  h.state.active = { id: 'a', container: { id: 'jar-a' } };
  h.ctx.activeTabId = 'a';
  h.els.address.value = 'gold';
  h.els.address.listeners.get('input')();
  await new Promise((resolve) => setTimeout(resolve, 110));
  h.state.active = { id: 'b', container: { id: 'jar-b' } };
  h.ctx.activeTabId = 'b';
  h.els.address.value = 'changed';
  controller.resetSuggestionsForActivation();
  h.resolveSuggest({ ok: true, suggestions: [{ url: 'https://stale.test/' }] });
  h.resolveBookmarksSuggest({ ok: true, suggestions: [] });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(h.state.openedModels, []);
});

// ---------------------------------------------------------------------------
// DD11 (M15 F1 Leg 4): historySuggest + bookmarksSuggest queried together via
// Promise.allSettled, merged, and painted.
// ---------------------------------------------------------------------------

test('DD11: both historySuggest and bookmarksSuggest are queried on input, merged bookmark-first', async () => {
  const h = harness();
  await create(h);
  h.state.active = { id: 'a', container: { id: 'jar-a' } };
  h.ctx.activeTabId = 'a';
  h.els.address.value = 'exa';
  h.els.address.listeners.get('input')();
  await new Promise((resolve) => setTimeout(resolve, 110));

  assert.ok(h.state.calls.some(([name, payload]) => name === 'historySuggest' && payload.query === 'exa' && payload.jarId === 'jar-a'));
  // M15 F2 Leg 3: bookmarksSuggest is jar-addressed too, beside historySuggest's own.
  assert.ok(h.state.calls.some(([name, payload]) => name === 'bookmarksSuggest' && payload.query === 'exa' && payload.jarId === 'jar-a'));

  h.resolveSuggest({ ok: true, suggestions: [{ url: 'https://history.example/', title: 'History Row' }] });
  h.resolveBookmarksSuggest({ ok: true, suggestions: [{ url: 'https://bm.example/', title: 'Bookmark Row' }] });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(h.state.suggestions.open, true);
  const model = h.state.openedModels.at(-1);
  assert.deepEqual(model.items.map((i) => i.kind), ['bookmark', 'history']);
  assert.deepEqual(model.items.map((i) => i.url), ['https://bm.example/', 'https://history.example/']);
});

test('DD11: a bookmarksSuggest rejection degrades that source to [] — history results still paint', async () => {
  const h = harness();
  await create(h);
  h.state.active = { id: 'a', container: { id: 'jar-a' } };
  h.ctx.activeTabId = 'a';
  h.els.address.value = 'exa';
  h.els.address.listeners.get('input')();
  await new Promise((resolve) => setTimeout(resolve, 110));

  h.resolveSuggest({ ok: true, suggestions: [{ url: 'https://history.example/', title: 'History Row' }] });
  h.rejectBookmarksSuggest(new Error('bookmarks-suggest failed'));
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(h.state.suggestions.open, true);
  const model = h.state.openedModels.at(-1);
  assert.deepEqual(model.items.map((i) => i.url), ['https://history.example/']);
});

test('DD11: a historySuggest rejection degrades that source to [] — bookmark results still paint', async () => {
  const h = harness();
  await create(h);
  h.state.active = { id: 'a', container: { id: 'jar-a' } };
  h.ctx.activeTabId = 'a';
  h.els.address.value = 'exa';
  h.els.address.listeners.get('input')();
  await new Promise((resolve) => setTimeout(resolve, 110));

  h.rejectSuggest(new Error('history-suggest failed'));
  h.resolveBookmarksSuggest({ ok: true, suggestions: [{ url: 'https://bm.example/', title: 'Bookmark Row' }] });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(h.state.suggestions.open, true);
  const model = h.state.openedModels.at(-1);
  assert.deepEqual(model.items.map((i) => i.url), ['https://bm.example/']);
});

test('DD11: an {ok:false} bookmarksSuggest response also degrades to [] (not just a rejection)', async () => {
  const h = harness();
  await create(h);
  h.state.active = { id: 'a', container: { id: 'jar-a' } };
  h.ctx.activeTabId = 'a';
  h.els.address.value = 'exa';
  h.els.address.listeners.get('input')();
  await new Promise((resolve) => setTimeout(resolve, 110));

  h.resolveSuggest({ ok: true, suggestions: [{ url: 'https://history.example/', title: 'History Row' }] });
  h.resolveBookmarksSuggest({ ok: false, suggestions: [] });
  await Promise.resolve();
  await Promise.resolve();

  const model = h.state.openedModels.at(-1);
  assert.deepEqual(model.items.map((i) => i.url), ['https://history.example/']);
});

test('zoom readback drops a result after TOCTOU tab switch and find restores saved text', async () => {
  const h = harness();
  const controller = await create(h);
  const a = { id: 'a', wcId: 10, internal: false, findText: 'needle', findOpen: false };
  const b = { id: 'b', wcId: 11, internal: false };
  h.state.active = a; h.ctx.activeTabId = a.id;
  const pending = controller.refreshZoomControl(a);
  h.state.active = b; h.ctx.activeTabId = b.id;
  h.resolveZoom(1.5);
  await pending;
  assert.equal(h.els.zoomPercent.textContent, '');

  h.state.active = a; h.ctx.activeTabId = a.id;
  controller.openFind(a);
  assert.equal(a.findOpen, true);
  assert.deepEqual(h.state.calls.pop(), ['find', { wcId: 10, findText: 'needle' }]);
  controller.openFind({ id: 'internal', wcId: 12, internal: true });
  assert.equal(h.state.calls.some(([name, payload]) => name === 'find' && payload.wcId === 12), false);
});

test('refreshStar: hidden on internal tabs / burner tabs / no live wcId; synchronous jar-scoped cache-driven aria-pressed + .starred otherwise (M15 F1 Leg 2; jar-aware + burner M15 F2 Leg 3)', async () => {
  const h = harness();
  const controller = await create(h);

  controller.refreshStar(null);
  assert.equal(h.els.star.classList.contains('hidden'), true);

  controller.refreshStar({ id: 'internal', internal: true, wcId: 1, url: 'goldfinch://settings', container: { id: 'internal' } });
  assert.equal(h.els.star.classList.contains('hidden'), true);

  controller.refreshStar({ id: 'no-wc', internal: false, wcId: null, url: 'https://x/', container: { id: 'jar-a' } });
  assert.equal(h.els.star.classList.contains('hidden'), true);

  // L3-DD-C/D: burner tabs also hide the star, alongside internal.
  controller.refreshStar({ id: 'burner', internal: false, wcId: 2, url: 'https://x/', container: { id: 'burner-1', burner: true } });
  assert.equal(h.els.star.classList.contains('hidden'), true);

  const unbookmarked = { id: 'a', internal: false, wcId: 5, url: 'https://unbookmarked.test/', container: { id: 'jar-a' } };
  controller.refreshStar(unbookmarked);
  assert.equal(h.els.star.classList.contains('hidden'), false);
  assert.equal(h.els.star.attributes.get('aria-pressed'), 'false');
  assert.equal(h.els.star.classList.contains('starred'), false);
  // L3-DD-A: a visible, non-suppressed tab primes its jar's cache.
  assert.ok(h.state.calls.some(([name, jarId]) => name === 'ensureJar' && jarId === 'jar-a'));

  h.bookmarks.add('https://bookmarked.test/');
  const bookmarked = { id: 'b', internal: false, wcId: 6, url: 'https://bookmarked.test/', container: { id: 'jar-a' } };
  controller.refreshStar(bookmarked);
  assert.equal(h.els.star.classList.contains('hidden'), false);
  assert.equal(h.els.star.attributes.get('aria-pressed'), 'true');
  assert.equal(h.els.star.classList.contains('starred'), true);
});
