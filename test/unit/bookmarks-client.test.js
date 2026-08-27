'use strict';

// Unit tests for the bookmarks cache client's extractable pure/async logic
// (M15 F1 Leg 2; rewritten jar-aware M15 F2 "Jar-Scoped Bookmarks" Leg 3):
// the per-jar Map (L3-DD-A), ensureJar's once-per-jar de-dup and
// evicted-mid-flight drop (L3-DD-A2), the jars-changed eviction subscription,
// the default-jar boot prefetch (L3-DD-B), the DD2 findByUrl lookup scoped
// per jar, the shared star-activation decision (activateStar, now also
// burner-inert), and the bookmark-edit-submit forward handler (jar-threaded,
// L3-DD-E; L3-DD-F's resolved-rejection toast REMOVED in M15 F3 Leg 2, DD9 —
// the residual race is unhandled by design). Real ESM (Node ≥22 synchronous
// require(esm)).

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
    fireBookmarksChanged(payload) {
      bookmarksChangedCb && bookmarksChangedCb(payload);
    },
    fireJarsChanged(payload) {
      jarsChangedCb && jarsChangedCb(payload);
    },
    onBookmarksChanged: (cb) => {
      bookmarksChangedCb = cb;
    },
    onJarsChanged: (cb) => {
      jarsChangedCb = cb;
    },
    // Default: resolves immediately from the seeded byJar map. Tests that
    // need to control timing (in-flight de-dup, late-resolve-after-eviction)
    // overwrite this per-call via `pending`.
    bookmarksGet: (payload) => {
      calls.push(['get', payload]);
      const jarId = payload && payload.jarId;
      if (pending[jarId]) {
        return new Promise((resolve, reject) => {
          pending[jarId] = { resolve, reject };
        });
      }
      return Promise.resolve(byJar[jarId] || []);
    },
    /** Arm jarId to return a controllable promise on its NEXT bookmarksGet call. */
    armPending(jarId) {
      pending[jarId] = true;
    },
    resolvePending(jarId, value) {
      pending[jarId].resolve(value);
    },
    bookmarkAdd: async (payload) => {
      calls.push(['add', payload]);
      return {
        ok: true,
        bookmark: {
          id: 'bm-new',
          jarId: payload.jarId,
          url: payload.url,
          title: payload.title,
          icon: payload.icon ?? null,
          addedAt: 1
        },
        created: true
      };
    },
    bookmarkUpdate: async (payload) => {
      calls.push(['update', payload]);
      return { ok: true };
    },
    bookmarkRemove: async (payload) => {
      calls.push(['remove', payload]);
      return { ok: true };
    }
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
  const jarsBoot = new Promise((resolve) => {
    resolveJarsBoot = resolve;
  });
  const bridge = makeBridge({
    personal: [{ id: 'a', jarId: 'personal', url: 'https://x/', title: 'X', icon: null, addedAt: 1 }]
  });
  const client = createBookmarksClient({
    bridge,
    isInternalTab: () => false,
    jarsBoot,
    getDefaultJarId: () => 'personal'
  });
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
  await Promise.resolve();
  await Promise.resolve();
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
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    client.findByUrl('work', 'https://w/'),
    null,
    'the resolved list must never be stored for an evicted jar'
  );
  // The in-flight marker was cleared on drop — a FUTURE ensureJar (recycled id) refetches fresh.
  client.ensureJar('work');
  assert.deepEqual(bridge.calls, [
    ['get', { jarId: 'work' }],
    ['get', { jarId: 'work' }]
  ]);
});

test('L3-DD-A2 cold start: before the FIRST jars-changed broadcast ever arrives, a resolve is never dropped (fails open)', async () => {
  const bridge = makeBridge({
    personal: [{ id: 'a', jarId: 'personal', url: 'https://x/', title: 'X', icon: null, addedAt: 1 }]
  });
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
    work: [{ id: 'b', jarId: 'work', url: 'https://y/', title: 'Y', icon: null, addedAt: 1 }]
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

test("recycled-id case: delete a jar, recreate the id, ensureJar re-fetches fresh (never the dead jar's rows)", async () => {
  const bridge = makeBridge({
    work: [{ id: 'old', jarId: 'work', url: 'https://old/', title: 'Old', icon: null, addedAt: 1 }]
  });
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
  assert.equal(
    client.findByUrl('work', 'https://old/'),
    null,
    "the old jar's bookmark never resurfaces under the recycled id"
  );
});

// ---------------------------------------------------------------------------
// onBookmarksChanged (DD6): re-query only if that jar is already cached.
// ---------------------------------------------------------------------------

test('bookmarks-changed re-queries and replaces the cache ONLY for an already-cached jar (invalidation-not-snapshot)', async () => {
  const bridge = makeBridge({
    personal: [{ id: 'a', jarId: 'personal', url: 'https://x/', title: 'X', icon: null, addedAt: 1 }]
  });
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  await client.boot;
  await client.ensureJar('personal');
  bridge.calls.length = 0;

  // Uncached jar: no re-query at all (DD6 "nothing cached, nothing stale").
  bridge.fireBookmarksChanged({ jarId: 'work' });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(bridge.calls, []);

  bridge.bookmarksGet = async () => [
    { id: 'b', jarId: 'personal', url: 'https://y/', title: 'Y', icon: null, addedAt: 2 }
  ];
  bridge.fireBookmarksChanged({ jarId: 'personal' });
  await Promise.resolve();
  await Promise.resolve();
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
  assert.deepEqual(bridge.calls, [
    ['add', { jarId: 'personal', url: 'https://example.com/', title: 'https://example.com/', icon: undefined }]
  ]);
  assert.equal(bookmark.url, 'https://example.com/');
});

test('activateStar: unbookmarked page with a REAL title uses it, never the literal seed', async () => {
  const bridge = makeBridge({ personal: [] });
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  await client.boot;
  const tab = {
    url: 'https://example.com/',
    title: 'Example Domain',
    favicon: 'data:image/png;base64,x',
    wcId: 7,
    container: { id: 'personal' }
  };
  await client.activateStar(tab);
  assert.deepEqual(bridge.calls, [
    [
      'add',
      { jarId: 'personal', url: 'https://example.com/', title: 'Example Domain', icon: 'data:image/png;base64,x' }
    ]
  ]);
});

test('activateStar: bookmarked page resolves the EXISTING entry directly — no add call', async () => {
  const bridge = makeBridge({
    personal: [{ id: 'a', jarId: 'personal', url: 'https://x/', title: 'X', icon: null, addedAt: 1 }]
  });
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
  assert.equal(
    await client.activateStar({ url: 'https://x/', wcId: 7, internal: true, container: { id: 'personal' } }),
    null
  );
  assert.equal(
    await client.activateStar({ url: 'https://x/', wcId: 7, container: { id: 'burner-1', burner: true } }),
    null,
    'L3-DD-D: burner-inert'
  );
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

// M15 F3 Leg 2, DD9: L3-DD-F's `surfaceRejection`/`toast` path is REMOVED.
// Both call sites are bare `.catch(() => {})` — a resolved { ok:false } is the
// unhandled residual race (main closes the sheet before forwarding, so the
// inline-error path is structurally unavailable), and a genuine IPC rejection
// is swallowed. Neither may throw, and the client takes no `toast` dependency.
test('DD9: a resolved { ok:false } is an unhandled no-op — no toast dependency, no throw', async () => {
  const bridge = makeBridge();
  bridge.bookmarkUpdate = async (p) => {
    bridge.calls.push(['update', p]);
    return { ok: false, reason: 'duplicate-url' };
  };
  bridge.bookmarkRemove = async (p) => {
    bridge.calls.push(['remove', p]);
    return { ok: false, reason: 'unknown-jar' };
  };
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  client.captureEditJar('personal');
  client.handleEditSubmit({ id: 'a', action: 'save', name: 'N', url: 'https://x/' });
  client.handleEditSubmit({ id: 'a', action: 'remove' });
  await Promise.resolve();
  await Promise.resolve(); // must not throw
  assert.deepEqual(bridge.calls, [
    ['update', { id: 'a', title: 'N', url: 'https://x/', jarId: 'personal' }],
    ['remove', { id: 'a', jarId: 'personal' }]
  ]);
});

test('DD9: a genuine IPC rejection stays swallowed by .catch(() => {})', async () => {
  const bridge = makeBridge();
  bridge.bookmarkRemove = async () => {
    throw new Error('ipc down');
  };
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  client.captureEditJar('personal');
  client.handleEditSubmit({ id: 'a', action: 'remove' });
  await Promise.resolve();
  await Promise.resolve(); // must not reject
});

test('DD9: surfaceRejection is gone from the module source', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/chrome/bookmarks-client.js'), 'utf8');
  assert.equal(
    /surfaceRejection/.test(src),
    false,
    'surfaceRejection must not survive anywhere in bookmarks-client.js'
  );
});

// ---------------------------------------------------------------------------
// bookmarkEntryToEditModel — the HAT-fix (Leg 5) store→sheet translation
// choke point: every open path (star/Ctrl+D/page-context via activateStar's
// resolution; bar right-click; overflow right-click) must route a
// store-shaped entry through this before it reaches the bookmark-edit sheet,
// which reads model.name/model.url.
// ---------------------------------------------------------------------------

test("bookmarkEntryToEditModel: translates a store entry's title to the sheet model's name", () => {
  const entry = { id: 'a', jarId: 'personal', url: 'https://x/', title: 'X Site', icon: null, addedAt: 1 };
  assert.deepEqual(bookmarkEntryToEditModel(entry), { id: 'a', name: 'X Site', url: 'https://x/' });
});

test('bookmarkEntryToEditModel: a missing/empty/non-string title falls back to the url (never blank)', () => {
  assert.deepEqual(bookmarkEntryToEditModel({ id: 'a', url: 'https://x/', title: '' }), {
    id: 'a',
    name: 'https://x/',
    url: 'https://x/'
  });
  assert.deepEqual(bookmarkEntryToEditModel({ id: 'a', url: 'https://x/' }), {
    id: 'a',
    name: 'https://x/',
    url: 'https://x/'
  });
  assert.deepEqual(bookmarkEntryToEditModel({ id: 'a', url: 'https://x/', title: 42 }), {
    id: 'a',
    name: 'https://x/',
    url: 'https://x/'
  });
});

test('bookmarkEntryToEditModel: a null/undefined entry degrades to an all-blank model, never throws', () => {
  assert.deepEqual(bookmarkEntryToEditModel(null), { id: null, name: '', url: null });
  assert.deepEqual(bookmarkEntryToEditModel(undefined), { id: undefined, name: '', url: undefined });
});

// ---------------------------------------------------------------------------
// commitReorder — the drag commit's fresh read (M15 F3 Leg 3, DD6b/DD7, AC6).
// ---------------------------------------------------------------------------

/** A bridge whose bookmarksGet answers from a MUTABLE store, so a test can
 * simulate another window's write landing between the cache's last refresh and
 * the commit's own read. Records every reorder payload. */
function reorderBridge(initial) {
  const base = makeBridge();
  let rows = initial.slice();
  const reorders = [];
  return {
    ...base,
    reorders,
    setRows(next) {
      rows = next.slice();
    },
    bookmarksGet: (payload) => {
      base.calls.push(['get', payload]);
      return Promise.resolve(rows.slice());
    },
    bookmarkReorder: async (payload) => {
      reorders.push(payload);
      base.calls.push(['reorder', payload]);
      return { ok: true };
    }
  };
}

const B = (id) => ({ id, url: `https://${id}.test/`, title: id });

test('commitReorder: builds its id list from a FRESH bookmarksGet, not from the cache (DD6b)', async () => {
  const bridge = reorderBridge([B('a'), B('b'), B('c')]);
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  // Prime the cache with a DIFFERENT (stale) list — commitReorder must ignore it.
  bridge.fireBookmarksChanged({ jarId: 'work' });
  await client.ensureJar('work');
  bridge.setRows([B('a'), B('b'), B('c')]);

  const issued = await client.commitReorder('work', 'a', 2);
  assert.equal(issued, true);
  assert.deepEqual(bridge.reorders, [{ jarId: 'work', ids: ['b', 'c', 'a'] }]);
});

test('commitReorder: THE DD6b DEFECT — a bookmark added by another window and not yet broadcast is NOT dropped from the payload', async () => {
  // The cache holds three; another window has just added a fourth, and this
  // window has not processed the broadcast yet. A cache-derived payload would
  // omit 'd' — and the store's forgiving rule would then append it silently at
  // the END, relocating another window's bookmark and returning { ok: true }.
  const bridge = reorderBridge([B('a'), B('b'), B('c')]);
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  await client.ensureJar('work');
  assert.deepEqual(
    client.listFor('work').map((b) => b.id),
    ['a', 'b', 'c'],
    'the cache is one round trip stale'
  );

  bridge.setRows([B('a'), B('b'), B('c'), B('d')]); // the un-broadcast write
  await client.commitReorder('work', 'a', 2);

  assert.deepEqual(
    bridge.reorders[0].ids,
    ['b', 'c', 'a', 'd'],
    "'d' rides along in its own position — it is neither omitted nor relocated"
  );
  assert.equal(bridge.reorders[0].ids.includes('d'), true);
  assert.equal(
    client
      .listFor('work')
      .map((b) => b.id)
      .includes('d'),
    false,
    'and the commit demonstrably did NOT read through the cache, which still lacks it'
  );
});

test('commitReorder: a drop back into the original position issues NO call and no broadcast (AC4)', async () => {
  const bridge = reorderBridge([B('a'), B('b'), B('c')]);
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  const issued = await client.commitReorder('work', 'b', 1); // 'b' is already at index 1
  assert.equal(issued, false);
  assert.deepEqual(bridge.reorders, [], 'moveIndex returned the SAME reference — nothing to write');
});

test('commitReorder: the dragged bookmark vanished mid-drag -> skipped, never an unknown id in the payload (Edge Case)', async () => {
  const bridge = reorderBridge([B('a'), B('b'), B('c')]);
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  bridge.setRows([B('a'), B('c')]); // another window removed 'b' before this read
  const issued = await client.commitReorder('work', 'b', 0);
  assert.equal(issued, false, 'indexOf misses -> moveIndex returns the same reference -> no call');
  assert.deepEqual(bridge.reorders, []);
});

test('commitReorder: forward and backward moves are exact (moveIndex is imported, not hand-rolled)', async () => {
  const bridge = reorderBridge([B('a'), B('b'), B('c'), B('d')]);
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  await client.commitReorder('work', 'a', 2); // forward — the classic off-by-one
  assert.deepEqual(bridge.reorders.at(-1).ids, ['b', 'c', 'a', 'd']);
  await client.commitReorder('work', 'd', 1); // backward
  assert.deepEqual(bridge.reorders.at(-1).ids, ['a', 'd', 'b', 'c']);
  await client.commitReorder('work', 'a', 3); // to the very end
  assert.deepEqual(bridge.reorders.at(-1).ids, ['b', 'c', 'd', 'a']);
});

test('commitReorder: degenerate arguments never reach the bridge', async () => {
  const bridge = reorderBridge([B('a'), B('b')]);
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  assert.equal(await client.commitReorder(null, 'a', 1), false, 'no captured jar (a jar-less/burner surface)');
  assert.equal(await client.commitReorder('work', undefined, 1), false);
  assert.equal(await client.commitReorder('work', 'a', -1), false, 'moveIndex no-ops on an out-of-range target');
  assert.equal(await client.commitReorder('work', 'a', 9), false);
  assert.deepEqual(bridge.reorders, []);
  assert.equal(
    bridge.calls.some((c) => c[0] === 'get'),
    true,
    'the fresh read still happened for the in-range-arg cases'
  );
});

test('commitReorder: a rejected read or write is swallowed — the cache re-derives to truth independently', async () => {
  const rejecting = { ...makeBridge(), bookmarksGet: () => Promise.reject(new Error('ipc down')) };
  const c1 = createBookmarksClient({ bridge: rejecting, isInternalTab: () => false, ...bootDeps() });
  assert.equal(await c1.commitReorder('work', 'a', 1), false);

  const bridge = reorderBridge([B('a'), B('b')]);
  bridge.bookmarkReorder = () => Promise.reject(new Error('ipc down'));
  const c2 = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  assert.equal(await c2.commitReorder('work', 'a', 1), false);
});

test('commitReorder: a resolved { ok:false, unknown-jar } (jar deleted mid-drag) is a SILENT no-op', async () => {
  const bridge = reorderBridge([B('a'), B('b')]);
  bridge.bookmarkReorder = async (payload) => {
    bridge.reorders.push(payload);
    return { ok: false, reason: 'unknown-jar' };
  };
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  // Consistent with DD9's disposition of the residual-race feedback: no throw,
  // no operator surface, no unhandled rejection.
  await client.commitReorder('gone', 'a', 1);
  assert.deepEqual(bridge.reorders, [{ jarId: 'gone', ids: ['b', 'a'] }]);
});

test('commitReorder: a non-array read (a malformed response) never becomes a payload', async () => {
  const bridge = reorderBridge([]);
  bridge.bookmarksGet = () => Promise.resolve(/** @type {any} */ (null));
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  assert.equal(await client.commitReorder('work', 'a', 0), false);
  assert.deepEqual(bridge.reorders, []);
});

// ---------------------------------------------------------------------------
// commitOverflowDrop — the bar → overflow commit (M15 F3 Leg 5a, AC4/AC10).
//
// ⚠ THE INDEX RULE WAS RULED BY THE OPERATOR ON 2026-08-05, after two design-
// review cycles each proposed a different wrong alternative. Every case below
// asserts the LITERAL expected full-list order from that ruling. Nothing here
// re-derives `min(visibleCount + k, n - 1)` — a test that recomputes the formula
// under test can only prove the formula equals itself, which is exactly how the
// first two cycles' answers would have gone green.
//
// Fixture: order A..L (12), visibleCount 8, so the sheet renders FOUR overflow
// rows (I,J,K,L) — ≥3, as the AC requires, so k=last and the clamp are both
// genuinely exercised. The item dragged in from the bar is A.
// ---------------------------------------------------------------------------

const ORDER_AL = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

async function overflowClient() {
  const bridge = reorderBridge(ORDER_AL.map(B));
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  return { bridge, client };
}

test('Leg 5a AC4: k=0 — the item lands at the TOP of the overflow run, and I is promoted onto the bar', async () => {
  const { bridge, client } = await overflowClient();
  assert.equal(await client.commitOverflowDrop('work', 'A', 8, 0), true);
  assert.deepEqual(bridge.reorders, [
    {
      jarId: 'work',
      ids: ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'A', 'J', 'K', 'L']
    }
  ]);
  // Read back the way the operator sees it: positions 8.. are the overflow run.
  assert.deepEqual(bridge.reorders[0].ids.slice(8), ['A', 'J', 'K', 'L']);
});

test('Leg 5a AC4: k=1', async () => {
  const { bridge, client } = await overflowClient();
  assert.equal(await client.commitOverflowDrop('work', 'A', 8, 1), true);
  assert.deepEqual(bridge.reorders[0].ids, ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'A', 'K', 'L']);
  assert.deepEqual(bridge.reorders[0].ids.slice(8), ['J', 'A', 'K', 'L']);
});

test('Leg 5a AC4: k=2', async () => {
  const { bridge, client } = await overflowClient();
  assert.equal(await client.commitOverflowDrop('work', 'A', 8, 2), true);
  assert.deepEqual(bridge.reorders[0].ids, ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'A', 'L']);
  assert.deepEqual(bridge.reorders[0].ids.slice(8), ['J', 'K', 'A', 'L']);
});

test('Leg 5a AC4: k=last (3) — the bottom of the rendered rows', async () => {
  const { bridge, client } = await overflowClient();
  assert.equal(await client.commitOverflowDrop('work', 'A', 8, 3), true);
  assert.deepEqual(bridge.reorders[0].ids, ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'A']);
  assert.deepEqual(bridge.reorders[0].ids.slice(8), ['J', 'K', 'L', 'A']);
});

test('Leg 5a AC4: k PAST the last row — the CLAMP, which is what stops a SILENT NO-OP', async () => {
  const { bridge, client } = await overflowClient();
  // Unclamped this is toIndex 12 === order.length, moveIndex returns the same
  // array reference, and this function reads that as "nothing moved" — a
  // deliberate gesture doing nothing at all, which the Edge Cases forbid.
  assert.equal(await client.commitOverflowDrop('work', 'A', 8, 4), true, 'it must NOT no-op');
  assert.deepEqual(bridge.reorders[0].ids, ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'A']);
  assert.deepEqual(bridge.reorders[0].ids.slice(8), ['J', 'K', 'L', 'A'], 'A last, same as k=last');
});

test('Leg 5a AC4/DD6b: the clamp is evaluated against the FRESH order length, not a cached one', async () => {
  const { bridge, client } = await overflowClient();
  // Another window removed two entries between the snapshot and this commit. A
  // clamp against the stale 12 would compute toIndex 11 on a 10-row list — out
  // of range for moveIndex, so the drop would silently do nothing.
  bridge.setRows(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].map(B));
  assert.equal(await client.commitOverflowDrop('work', 'A', 8, 4), true);
  assert.deepEqual(bridge.reorders[0].ids, ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'A']);
});

test('Leg 5a AC10/DD6b: the commit re-reads through bookmarksGet for the CAPTURED jar', async () => {
  const { bridge, client } = await overflowClient();
  await client.commitOverflowDrop('work', 'A', 8, 0);
  assert.deepEqual(
    bridge.calls.filter((c) => c[0] === 'get'),
    [['get', { jarId: 'work' }]]
  );
});

test('Leg 5a AC4: degenerate arguments never reach the store', async () => {
  const { bridge, client } = await overflowClient();
  assert.equal(await client.commitOverflowDrop(null, 'A', 8, 0), false, 'no captured jar');
  assert.equal(await client.commitOverflowDrop('work', undefined, 8, 0), false);
  assert.equal(await client.commitOverflowDrop('work', 'A', -1, 0), false, 'nonsense visibleCount');
  assert.equal(await client.commitOverflowDrop('work', 'A', 8, -1), false);
  assert.equal(await client.commitOverflowDrop('work', 'A', 8.5, 0), false);
  assert.equal(await client.commitOverflowDrop('work', 'ZZZ', 8, 0), false, 'a bookmark deleted mid-drag');
  assert.deepEqual(bridge.reorders, []);
});

test('Leg 5a AC4: commitReorder is UNCHANGED by the shared body — the bar-internal path still works', async () => {
  const bridge = reorderBridge([B('a'), B('b'), B('c')]);
  const client = createBookmarksClient({ bridge, isInternalTab: () => false, ...bootDeps() });
  assert.equal(await client.commitReorder('work', 'a', 2), true);
  assert.deepEqual(bridge.reorders, [{ jarId: 'work', ids: ['b', 'c', 'a'] }]);
});
