'use strict';

// Unit tests for the bookmarks cache client's extractable pure/async logic
// (M15 F1 Leg 2): boot/applyState/subscribe against a fake bridge, the DD2
// findByUrl lookup, the shared star-activation decision (activateStar), and
// the bookmark-edit-submit forward handler. Real ESM (Node ≥22
// synchronous require(esm) — the src/shared/ pattern extended to a
// src/renderer/chrome/ controller module, same as jars-client.js's own
// untested-by-suite precedent, now actually exercised).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createBookmarksClient } = require('../../src/renderer/chrome/bookmarks-client.js');

function makeBridge(initialList = []) {
  const calls = [];
  let bookmarksChangedCb = null;
  return {
    calls,
    fireBookmarksChanged() { bookmarksChangedCb && bookmarksChangedCb(); },
    bookmarksGet: async () => initialList,
    onBookmarksChanged: (cb) => { bookmarksChangedCb = cb; },
    bookmarkAdd: async (payload) => {
      calls.push(['add', payload]);
      return { ok: true, bookmark: { id: 'bm-new', url: payload.url, title: payload.title, icon: payload.icon ?? null, addedAt: 1 }, created: true };
    },
    bookmarkUpdate: async (payload) => { calls.push(['update', payload]); return { ok: true }; },
    bookmarkRemove: async (payload) => { calls.push(['remove', payload]); return { ok: true }; },
  };
}

test('boot populates the cache from bookmarksGet()', async () => {
  const bridge = makeBridge([{ id: 'a', url: 'https://x/', title: 'X', icon: null, addedAt: 1 }]);
  const client = createBookmarksClient({ bridge, isInternalTab: () => false });
  await client.boot;
  assert.equal(client.list.length, 1);
  assert.equal(client.findByUrl('https://x/').id, 'a');
  assert.equal(client.findByUrl('https://nope/'), null);
});

test('bookmarks-changed re-queries and replaces the cache (invalidation-not-snapshot)', async () => {
  const bridge = makeBridge([{ id: 'a', url: 'https://x/', title: 'X', icon: null, addedAt: 1 }]);
  const client = createBookmarksClient({ bridge, isInternalTab: () => false });
  await client.boot;
  bridge.bookmarksGet = async () => [{ id: 'b', url: 'https://y/', title: 'Y', icon: null, addedAt: 2 }];
  bridge.fireBookmarksChanged();
  // The re-query is async — wait a microtask turn.
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(client.findByUrl('https://x/'), null);
  assert.equal(client.findByUrl('https://y/').id, 'b');
});

test('a non-array bookmarksGet response degrades to an empty cache, never throws', async () => {
  const bridge = makeBridge();
  bridge.bookmarksGet = async () => null;
  const client = createBookmarksClient({ bridge, isInternalTab: () => false });
  await client.boot;
  assert.deepEqual(client.list, []);
});

test('a rejected bookmarksGet is swallowed (boot never rejects)', async () => {
  const bridge = makeBridge();
  bridge.bookmarksGet = async () => { throw new Error('boom'); };
  const client = createBookmarksClient({ bridge, isInternalTab: () => false });
  await assert.doesNotReject(client.boot);
});

// ---------------------------------------------------------------------------
// activateStar — the shared star click / Ctrl+D / page-context decision
// ---------------------------------------------------------------------------

test('activateStar: unbookmarked page adds (title falls back when the tab still carries the literal "New tab" seed) then resolves the CREATED entry', async () => {
  const bridge = makeBridge([]);
  const client = createBookmarksClient({ bridge, isInternalTab: () => false });
  await client.boot;
  const tab = { url: 'https://example.com/', title: 'New tab', favicon: null, wcId: 7 };
  const bookmark = await client.activateStar(tab);
  assert.deepEqual(bridge.calls, [['add', { url: 'https://example.com/', title: 'https://example.com/', icon: undefined }]]);
  assert.equal(bookmark.url, 'https://example.com/');
});

test('activateStar: unbookmarked page with a REAL title uses it, never the literal seed', async () => {
  const bridge = makeBridge([]);
  const client = createBookmarksClient({ bridge, isInternalTab: () => false });
  await client.boot;
  const tab = { url: 'https://example.com/', title: 'Example Domain', favicon: 'data:image/png;base64,x', wcId: 7 };
  await client.activateStar(tab);
  assert.deepEqual(bridge.calls, [['add', { url: 'https://example.com/', title: 'Example Domain', icon: 'data:image/png;base64,x' }]]);
});

test('activateStar: bookmarked page resolves the EXISTING entry directly — no add call', async () => {
  const bridge = makeBridge([{ id: 'a', url: 'https://x/', title: 'X', icon: null, addedAt: 1 }]);
  const client = createBookmarksClient({ bridge, isInternalTab: () => false });
  await client.boot;
  const tab = { url: 'https://x/', title: 'X', favicon: null, wcId: 7 };
  const bookmark = await client.activateStar(tab);
  assert.equal(bridge.calls.length, 0);
  assert.equal(bookmark.id, 'a');
});

test('activateStar: inert (resolves null, no add call) on internal tabs / a tab with no live wcId / no tab', async () => {
  const bridge = makeBridge([]);
  const client = createBookmarksClient({ bridge, isInternalTab: (tab) => tab.internal === true });
  await client.boot;
  assert.equal(await client.activateStar(null), null);
  assert.equal(await client.activateStar({ url: 'https://x/', wcId: null }), null);
  assert.equal(await client.activateStar({ url: 'https://x/', wcId: 7, internal: true }), null);
  assert.equal(bridge.calls.length, 0);
});

// ---------------------------------------------------------------------------
// handleEditSubmit — the forwarded bookmark-edit-submit subscriber body
// ---------------------------------------------------------------------------

test('handleEditSubmit: action "remove" calls bookmarkRemove with the id only', () => {
  const bridge = makeBridge([]);
  const client = createBookmarksClient({ bridge, isInternalTab: () => false });
  client.handleEditSubmit({ id: 'a', action: 'remove' });
  assert.deepEqual(bridge.calls, [['remove', { id: 'a' }]]);
});

test('handleEditSubmit: action "save" (or any non-remove) calls bookmarkUpdate with title/url', () => {
  const bridge = makeBridge([]);
  const client = createBookmarksClient({ bridge, isInternalTab: () => false });
  client.handleEditSubmit({ id: 'a', action: 'save', name: 'New Name', url: 'https://new/' });
  assert.deepEqual(bridge.calls, [['update', { id: 'a', title: 'New Name', url: 'https://new/' }]]);
});

test('handleEditSubmit: a malformed payload (no string id) is a silent no-op', () => {
  const bridge = makeBridge([]);
  const client = createBookmarksClient({ bridge, isInternalTab: () => false });
  client.handleEditSubmit(null);
  client.handleEditSubmit({});
  client.handleEditSubmit({ id: 42 });
  assert.deepEqual(bridge.calls, []);
});
