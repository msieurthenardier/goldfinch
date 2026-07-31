'use strict';

// Unit tests for the bookmarks cache client's extractable pure/async logic
// (M15 F1 Leg 2; rewritten jar-aware M15 F2 "Jar-Scoped Bookmarks" Leg 3):
// the per-jar Map (L3-DD-A), ensureJar's once-per-jar de-dup and
// evicted-mid-flight drop (L3-DD-A2), the jars-changed eviction subscription,
// the default-jar boot prefetch (L3-DD-B), the DD2 findByUrl lookup scoped
// per jar, the shared star-activation decision (activateStar, now also
// burner-inert), and the bookmark-edit-submit forward handler (now jar-
// threaded with resolved-rejection feedback, L3-DD-E/F). Real ESM (Node ≥22
// synchronous require(esm)).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createBookmarksClient, bookmarkEntryToEditModel } = require('../../src/renderer/chrome/bookmarks-client.js');

/** @param {{ [jarId: string]: any[] }} [byJar] */
function makeBridge(byJar = {}) {
  const calls = [];
  let bookmarksChangedCb = null;
  let jarsChangedCb = null;
  /** @type {{ [jarId: string]: { resolve: Function, reject: Function } }} */
  const pending = {};
  return {
    calls,
    fireBookmarksChanged(payload) { bookmarksChangedCb && bookmarksChangedCb(payload); },
    fireJarsChanged(payload) { jarsChangedCb && jarsChangedCb(payload); },
    onBookmarksChanged: (cb) => { bookmarksChangedCb = cb; },
    onJarsChanged: (cb) => { jarsChangedCb = cb; },
    // Default: resolves immediately from the seeded byJar map. Tests that
    // need to control timing (in-flight de-dup, late-resolve-after-eviction)
    // overwrite this per-call via `pending`.
    bookmarksGet: (payload) => {
      calls.push(['get', payload]);
      const jarId = payload && payload.jarId;
      if (pending[jarId]) {
        return new Promise((resolve, reject) => { pending[jarId] = { resolve, reject }; });
      }
      return Promise.resolve(byJar[jarId] || []);
    },
    /** Arm jarId to return a controllable promise on its NEXT bookmarksGet call. */
    armPending(jarId) { pending[jarId] = true; },
    resolvePending(jarId, value) { pending[jarId].resolve(value); },
    bookmarkAdd: async (payload) => {
      calls.push(['add', payload]);
      return { ok: true, bookmark: { id: 'bm-new', jarId: payload.jarId, url: payload.url, title: payload.title, icon: payload.icon ?? null, addedAt: 1 }, created: true };
    },
    bookmarkUpdate: async (payload) => { calls.push(['update', payload]); return { ok: true }; },
    bookmarkRemove: async (payload) => { calls.push(['remove', payload]); return { ok: true }; },
  };
}

/** A resolved jarsBoot + a fixed default jar id — the common non-boot-testing case. */
function bootDeps(defaultJarId = null) {
  return { jarsBoot: Promise.resolve(), getDefaultJarId: () => defaultJarId };
}

// ---------------------------------------------------------------------------
// Boot (L3-DD-B): default-jar prefetch, sequenced behind jarsBoot.
// ---------------------------------------------------------------------------

test('boot is a no-op when the default jar id is null (Burner holds the flag)', async () => {
  const bridge = makeBridge();
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps(null) });
  await client.boot;
  assert.deepEqual(bridge.calls, []);
});

test('boot is a no-op when the default jar id is undefined (no getDefaultJarId injected)', async () => {
  const bridge = makeBridge();
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, jarsBoot: Promise.resolve() });
  await client.boot;
  assert.deepEqual(bridge.calls, []);
});

test('boot prefetches the default jar once jarsBoot resolves, and it is then synchronously cached', async () => {
  let resolveJarsBoot;
  const jarsBoot = new Promise((resolve) => { resolveJarsBoot = resolve; });
  const bridge = makeBridge({ personal: [{ id: 'a', jarId: 'personal', url: 'https://x/', title: 'X', icon: null, addedAt: 1 }] });
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, jarsBoot, getDefaultJarId: () => 'personal' });
  assert.deepEqual(bridge.calls, [], 'must not fetch before jarsBoot resolves');
  resolveJarsBoot();
  await client.boot;
  assert.deepEqual(bridge.calls, [['get', { jarId: 'personal' }]]);
  assert.equal(client.findByUrl('personal', 'https://x/').id, 'a');
});

// ---------------------------------------------------------------------------
// ensureJar (L3-DD-A/A2): once-per-jar, in-flight de-dup, evicted-mid-flight drop.
// ---------------------------------------------------------------------------

test('ensureJar fetches once per unseen jar; a second call before resolution de-dupes (in-flight)', async () => {
  const bridge = makeBridge();
  bridge.armPending('work');
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  await client.boot;
  client.ensureJar('work');
  client.ensureJar('work'); // in-flight de-dup — no second bookmarksGet call
  assert.deepEqual(bridge.calls, [['get', { jarId: 'work' }]]);
  bridge.resolvePending('work', [{ id: 'w', jarId: 'work', url: 'https://w/', title: 'W', icon: null, addedAt: 1 }]);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(client.findByUrl('work', 'https://w/').id, 'w');
  client.ensureJar('work'); // already cached — no further fetch
  assert.equal(bridge.calls.length, 1);
});

test('ensureJar is a no-op read (returns [] / null) for a jar never fetched — never blocks a synchronous read', async () => {
  const bridge = makeBridge();
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  await client.boot;
  assert.equal(client.findByUrl('nope', 'https://x/'), null);
  assert.deepEqual(client.listFor('nope'), []);
});

test('L3-DD-A2: a late-resolving ensureJar fetch for a jar evicted meanwhile is DROPPED, not stored', async () => {
  const bridge = makeBridge();
  bridge.armPending('work');
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  await client.boot;
  client.ensureJar('work');
  // The jar is deleted (evicted) WHILE the fetch is still in flight.
  bridge.fireJarsChanged({ containers: [{ id: 'personal' }] });
  bridge.resolvePending('work', [{ id: 'w', jarId: 'work', url: 'https://w/', title: 'W', icon: null, addedAt: 1 }]);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(client.findByUrl('work', 'https://w/'), null, 'the resolved list must never be stored for an evicted jar');
  // The in-flight marker was cleared on drop — a FUTURE ensureJar (recycled id) refetches fresh.
  client.ensureJar('work');
  assert.deepEqual(bridge.calls, [['get', { jarId: 'work' }], ['get', { jarId: 'work' }]]);
});

test('L3-DD-A2 cold start: before the FIRST jars-changed broadcast ever arrives, a resolve is never dropped (fails open)', async () => {
  const bridge = makeBridge({ personal: [{ id: 'a', jarId: 'personal', url: 'https://x/', title: 'X', icon: null, addedAt: 1 }] });
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps('personal') });
  await client.boot; // the boot prefetch itself resolves before any jars-changed ever fired
  assert.equal(client.findByUrl('personal', 'https://x/').id, 'a');
});

// ---------------------------------------------------------------------------
// jars-changed eviction (L3-DD-A, DD6 recyclable-id defense).
// ---------------------------------------------------------------------------

test('a jars-changed broadcast evicts cached jars absent from its OWN containers array', async () => {
  const bridge = makeBridge({
    personal: [{ id: 'a', jarId: 'personal', url: 'https://x/', title: 'X', icon: null, addedAt: 1 }],
    work: [{ id: 'b', jarId: 'work', url: 'https://y/', title: 'Y', icon: null, addedAt: 1 }],
  });
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  await client.boot;
  await client.ensureJar('personal');
  await client.ensureJar('work');
  assert.equal(client.findByUrl('personal', 'https://x/').id, 'a');
  assert.equal(client.findByUrl('work', 'https://y/').id, 'b');

  bridge.fireJarsChanged({ containers: [{ id: 'personal' }] }); // 'work' no longer live
  assert.equal(client.findByUrl('work', 'https://y/'), null, 'evicted — the recyclable-id defense');
  assert.equal(client.findByUrl('personal', 'https://x/').id, 'a', 'a still-live jar is untouched');
});

test('recycled-id case: delete a jar, recreate the id, ensureJar re-fetches fresh (never the dead jar\'s rows)', async () => {
  const bridge = makeBridge({ work: [{ id: 'old', jarId: 'work', url: 'https://old/', title: 'Old', icon: null, addedAt: 1 }] });
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  await client.boot;
  await client.ensureJar('work');
  assert.equal(client.findByUrl('work', 'https://old/').id, 'old');

  bridge.fireJarsChanged({ containers: [] }); // 'work' deleted — evicted
  assert.deepEqual(client.listFor('work'), [], 'evicted — nothing cached for the dead id');
  bridge.fireJarsChanged({ containers: [{ id: 'work' }] }); // 'work' recreated — recycled id, still nothing cached
  assert.deepEqual(client.listFor('work'), []);

  // The recreated jar's store rows are FRESH (empty) — the live in-session
  // variant of the flight checkpoint: a re-fetch must serve the NEW jar's
  // data, never resurrect the deleted jar's cached rows.
  bridge.bookmarksGet = async () => [];
  await client.ensureJar('work');
  assert.deepEqual(client.listFor('work'), []);
  assert.equal(client.findByUrl('work', 'https://old/'), null, 'the old jar\'s bookmark never resurfaces under the recycled id');
});

// ---------------------------------------------------------------------------
// onBookmarksChanged (DD6): re-query only if that jar is already cached.
// ---------------------------------------------------------------------------

test('bookmarks-changed re-queries and replaces the cache ONLY for an already-cached jar (invalidation-not-snapshot)', async () => {
  const bridge = makeBridge({ personal: [{ id: 'a', jarId: 'personal', url: 'https://x/', title: 'X', icon: null, addedAt: 1 }] });
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  await client.boot;
  await client.ensureJar('personal');
  bridge.calls.length = 0;

  // Uncached jar: no re-query at all (DD6 "nothing cached, nothing stale").
  bridge.fireBookmarksChanged({ jarId: 'work' });
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(bridge.calls, []);

  bridge.bookmarksGet = async () => [{ id: 'b', jarId: 'personal', url: 'https://y/', title: 'Y', icon: null, addedAt: 2 }];
  bridge.fireBookmarksChanged({ jarId: 'personal' });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(client.findByUrl('personal', 'https://x/'), null);
  assert.equal(client.findByUrl('personal', 'https://y/').id, 'b');
});

// ---------------------------------------------------------------------------
// activateStar — the shared star click / Ctrl+D / page-context decision
// ---------------------------------------------------------------------------

test('activateStar: unbookmarked page adds (title falls back when the tab still carries the literal "New tab" seed) then resolves the CREATED entry', async () => {
  const bridge = makeBridge({ personal: [] });
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  await client.boot;
  const tab = { url: 'https://example.com/', title: 'New tab', favicon: null, wcId: 7, container: { id: 'personal' } };
  const bookmark = await client.activateStar(tab);
  assert.deepEqual(bridge.calls, [['add', { jarId: 'personal', url: 'https://example.com/', title: 'https://example.com/', icon: undefined }]]);
  assert.equal(bookmark.url, 'https://example.com/');
});

test('activateStar: unbookmarked page with a REAL title uses it, never the literal seed', async () => {
  const bridge = makeBridge({ personal: [] });
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  await client.boot;
  const tab = { url: 'https://example.com/', title: 'Example Domain', favicon: 'data:image/png;base64,x', wcId: 7, container: { id: 'personal' } };
  await client.activateStar(tab);
  assert.deepEqual(bridge.calls, [['add', { jarId: 'personal', url: 'https://example.com/', title: 'Example Domain', icon: 'data:image/png;base64,x' }]]);
});

test('activateStar: bookmarked page resolves the EXISTING entry directly — no add call', async () => {
  const bridge = makeBridge({ personal: [{ id: 'a', jarId: 'personal', url: 'https://x/', title: 'X', icon: null, addedAt: 1 }] });
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  await client.boot;
  await client.ensureJar('personal');
  bridge.calls.length = 0;
  const tab = { url: 'https://x/', title: 'X', favicon: null, wcId: 7, container: { id: 'personal' } };
  const bookmark = await client.activateStar(tab);
  assert.equal(bridge.calls.length, 0);
  assert.equal(bookmark.id, 'a');
});

test('activateStar: inert (resolves null, no add call) on internal tabs / burner tabs / a tab with no live wcId / no tab / no container', async () => {
  const bridge = makeBridge();
  const client = createBookmarksClient({ bridge, isInternalTab: (tab) => tab.internal === true, ...bootDeps() });
  await client.boot;
  assert.equal(await client.activateStar(null), null);
  assert.equal(await client.activateStar({ url: 'https://x/', wcId: null, container: { id: 'personal' } }), null);
  assert.equal(await client.activateStar({ url: 'https://x/', wcId: 7, internal: true, container: { id: 'personal' } }), null);
  assert.equal(await client.activateStar({ url: 'https://x/', wcId: 7, container: { id: 'burner-1', burner: true } }), null, 'L3-DD-D: burner-inert');
  assert.equal(await client.activateStar({ url: 'https://x/', wcId: 7 }), null, 'no container at all');
  assert.equal(bridge.calls.length, 0);
});

// ---------------------------------------------------------------------------
// handleEditSubmit — the forwarded bookmark-edit-submit subscriber body
// ---------------------------------------------------------------------------

test('captureEditJar + handleEditSubmit: action "remove" calls bookmarkRemove with the CAPTURED jarId', () => {
  const bridge = makeBridge();
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  client.captureEditJar('personal');
  client.handleEditSubmit({ id: 'a', action: 'remove' });
  assert.deepEqual(bridge.calls, [['remove', { id: 'a', jarId: 'personal' }]]);
});

test('captureEditJar + handleEditSubmit: action "save" (or any non-remove) calls bookmarkUpdate with title/url/jarId', () => {
  const bridge = makeBridge();
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  client.captureEditJar('work');
  client.handleEditSubmit({ id: 'a', action: 'save', name: 'New Name', url: 'https://new/' });
  assert.deepEqual(bridge.calls, [['update', { id: 'a', title: 'New Name', url: 'https://new/', jarId: 'work' }]]);
});

test('handleEditSubmit: a malformed payload (no string id) is a silent no-op', () => {
  const bridge = makeBridge();
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  client.captureEditJar('personal');
  client.handleEditSubmit(null);
  client.handleEditSubmit({});
  client.handleEditSubmit({ id: 42 });
  assert.deepEqual(bridge.calls, []);
});

test('handleEditSubmit: captureEditJar(null) (no jar captured) still forwards — jarId rides through as null', () => {
  const bridge = makeBridge();
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  client.handleEditSubmit({ id: 'a', action: 'remove' }); // never captured
  assert.deepEqual(bridge.calls, [['remove', { id: 'a', jarId: null }]]);
});

// L3-DD-F: resolved { ok:false } surfaces via the injected toast; genuine IPC
// failures still go through the untouched .catch(() => {}).
test('L3-DD-F: a resolved { ok:false, reason: "duplicate-url" } surfaces distinct toast copy', async () => {
  const bridge = makeBridge();
  bridge.bookmarkUpdate = async () => ({ ok: false, reason: 'duplicate-url' });
  const toastCalls = [];
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, toast: (title, body) => toastCalls.push([title, body]), ...bootDeps() });
  client.captureEditJar('personal');
  client.handleEditSubmit({ id: 'a', action: 'save', name: 'N', url: 'https://x/' });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(toastCalls.length, 1);
  assert.match(toastCalls[0][1], /already exists/);
});

test('L3-DD-F: a resolved { ok:false, reason: "not-found"|"unknown-jar" } surfaces DISTINCT (non-duplicate) copy', async () => {
  const bridge = makeBridge();
  bridge.bookmarkRemove = async () => ({ ok: false, reason: 'unknown-jar' });
  const toastCalls = [];
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, toast: (title, body) => toastCalls.push([title, body]), ...bootDeps() });
  client.captureEditJar('personal');
  client.handleEditSubmit({ id: 'a', action: 'remove' });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(toastCalls.length, 1);
  assert.doesNotMatch(toastCalls[0][1], /already exists/);
});

test('L3-DD-F: a resolved { ok:true } never toasts; a genuine IPC rejection is swallowed by .catch, never toasts either', async () => {
  const bridge = makeBridge();
  const toastCalls = [];
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, toast: (title, body) => toastCalls.push([title, body]), ...bootDeps() });
  client.captureEditJar('personal');
  client.handleEditSubmit({ id: 'a', action: 'save', name: 'N', url: 'https://x/' }); // default bridge resolves { ok: true }
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(toastCalls, []);

  bridge.bookmarkRemove = async () => { throw new Error('ipc down'); };
  client.handleEditSubmit({ id: 'a', action: 'remove' });
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(toastCalls, [], 'a genuine IPC failure stays on .catch(() => {}), never surfaces a toast');
});

test('handleEditSubmit tolerates a missing toast dependency (no throw)', async () => {
  const bridge = makeBridge();
  bridge.bookmarkUpdate = async () => ({ ok: false, reason: 'duplicate-url' });
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() }); // no toast injected
  client.captureEditJar('personal');
  client.handleEditSubmit({ id: 'a', action: 'save', name: 'N', url: 'https://x/' });
  await Promise.resolve(); await Promise.resolve(); // must not throw
});

// ---------------------------------------------------------------------------
// bookmarkEntryToEditModel — the HAT-fix (Leg 5) store→sheet translation
// choke point: every open path (star/Ctrl+D/page-context via activateStar's
// resolution; bar right-click; overflow right-click) must route a
// store-shaped entry through this before it reaches the bookmark-edit sheet,
// which reads model.name/model.url.
// ---------------------------------------------------------------------------

test('bookmarkEntryToEditModel: translates a store entry\'s title to the sheet model\'s name', () => {
  const entry = { id: 'a', jarId: 'personal', url: 'https://x/', title: 'X Site', icon: null, addedAt: 1 };
  assert.deepEqual(bookmarkEntryToEditModel(entry), { id: 'a', name: 'X Site', url: 'https://x/' });
});

test('bookmarkEntryToEditModel: a missing/empty/non-string title falls back to the url (never blank)', () => {
  assert.deepEqual(
    bookmarkEntryToEditModel({ id: 'a', url: 'https://x/', title: '' }),
    { id: 'a', name: 'https://x/', url: 'https://x/' }
  );
  assert.deepEqual(
    bookmarkEntryToEditModel({ id: 'a', url: 'https://x/' }),
    { id: 'a', name: 'https://x/', url: 'https://x/' }
  );
  assert.deepEqual(
    bookmarkEntryToEditModel({ id: 'a', url: 'https://x/', title: 42 }),
    { id: 'a', name: 'https://x/', url: 'https://x/' }
  );
});

test('bookmarkEntryToEditModel: a null/undefined entry degrades to an all-blank model, never throws', () => {
  assert.deepEqual(bookmarkEntryToEditModel(null), { id: null, name: '', url: null });
  assert.deepEqual(bookmarkEntryToEditModel(undefined), { id: undefined, name: '', url: undefined });
});
