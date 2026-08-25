'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
// M16 F1 Leg 2: the real shared table/builder (require(esm), same synchronous
// pattern settings-store.test.js and search-engines.test.js already use) —
// toUrl's search fallback is exercised against the actual buildSearchUrl, not
// a hand-rolled stand-in.
const { buildSearchUrl } = require('../../src/shared/search-engines');

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

test('URL conversion and navigation preserve internal-tab refusal and web-tab capture', async () => {
  const h = harness();
  const controller = await create(h);
  assert.equal(controller.toUrl('example.com/path'), 'https://example.com/path');
  // Default (no engine set): the coalescing site (`currentSearchEngine() || 'google'`)
  // falls back to Google — byte-identical to the pre-Leg-2 hardcoded assertion.
  assert.equal(controller.toUrl('hello world'), 'https://www.google.com/search?q=hello%20world');

  h.state.active = { id: 'internal', internal: true, wcId: 1 };
  controller.navigate('example.com');
  assert.deepEqual(h.state.calls.pop(), ['create', 'https://example.com']);
  h.state.active = { id: 'web', internal: false, wcId: 9 };
  controller.navigate('https://example.test/');
  assert.deepEqual(h.state.calls.pop(), ['navigate', { wcId: 9, verb: 'loadURL', args: ['https://example.test/'] }]);
});

// M16 F1 Leg 2 (DD4): toUrl's search fallback now builds from the live
// searchEngineCache (currentSearchEngine()) via the shared buildSearchUrl,
// replacing the old hardcoded Google line — covers both a non-default engine
// and the default explicitly (the AC's "both entry points prove out through
// the one change" — this is the one change; sel:search shares toUrl via
// renderer.js, which has no seam in this harness — see the flight log).
test('toUrl builds the search URL from the current search engine, non-default and default', async () => {
  const h = harness();
  const controller = await create(h);

  h.state.searchEngine = 'duckduckgo';
  assert.equal(controller.toUrl('hello world'), 'https://duckduckgo.com/?q=hello%20world');

  h.state.searchEngine = 'google';
  assert.equal(controller.toUrl('hello world'), 'https://www.google.com/search?q=hello%20world');

  // Unset (null) coalesces to Google at the toUrl call site, not by mutating
  // the cache — the edge case the leg spec calls out (structurally unreachable
  // once searchEngine is always a validated stored value, but toUrl must not
  // depend on that invariant holding).
  h.state.searchEngine = null;
  assert.equal(controller.toUrl('hello world'), 'https://www.google.com/search?q=hello%20world');
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
