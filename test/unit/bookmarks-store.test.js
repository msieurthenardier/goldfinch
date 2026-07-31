'use strict';

// Unit tests for src/main/bookmarks-store.js — rewritten M15 Flight 2
// "Jar-Scoped Bookmarks" Leg 2 / flight DD1-DD4, leg L2-DD-A/C/D against the
// jarId-first, table-backed API. Flight 1's per-field validation contract
// (drop/repair split) is preserved verbatim, moved from load-time array
// validation to READ-TIME per-row validation (L2-DD-D).
//
// No electron-stub needed — bookmarks-store.js is Electron-free. Persists
// through app-db.js's `bookmarks` table (schema v3) — appDb.open(dir,
// { memory: true })/close() bracket every test (fast, no filesystem), and
// the module is re-required fresh per test (module-scoped singleton) so no
// state leaks between tests.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const appDb = require('../../src/main/app-db');

function freshStore() {
  const resolved = require.resolve('../../src/main/bookmarks-store');
  delete require.cache[resolved];
  return require('../../src/main/bookmarks-store');
}

/** Read the raw bookmarks table rows directly, bypassing the store. */
function rawRows(jarId) {
  return appDb.createBookmarksStore().listByJar(jarId);
}

/** Run `fn(store)` with a fresh in-memory app-db, tearing it down after. */
function withStore(fn) {
  appDb.open('', { memory: true });
  try {
    const store = freshStore();
    store.load('/unused/userdata/path');
    fn(store);
  } finally {
    appDb.close();
  }
}

const GOOD_ICON = 'data:image/png;base64,AAAA';

// ---------------------------------------------------------------------------
// load(): no rows yet -> empty per jar, never throws
// ---------------------------------------------------------------------------

test('list(jarId) with no existing rows starts empty', () => {
  withStore((store) => {
    assert.deepEqual(store.list('personal'), []);
  });
});

test('load() reads nothing into memory (stateless) — a mutation via a second fresh require is visible to the first', () => {
  withStore((store) => {
    store.add('personal', { url: 'https://example.com/' });
    const reloaded = freshStore();
    reloaded.load('/unused/userdata/path');
    assert.equal(reloaded.list('personal').length, 1, 'truth lives in the table, not an in-memory array');
  });
});

// ---------------------------------------------------------------------------
// Round-trip: add -> reload -> same data
// ---------------------------------------------------------------------------

test('round-trip: an added bookmark survives a fresh load()', () => {
  withStore((store) => {
    const result = store.add('personal', { url: 'https://example.com/', title: 'Example', icon: GOOD_ICON });
    assert.equal(result.ok, true);
    assert.equal(result.created, true);

    const reloaded = freshStore();
    reloaded.load('/unused/userdata/path');
    assert.equal(reloaded.list('personal').length, 1);
    const [entry] = reloaded.list('personal');
    assert.equal(entry.url, 'https://example.com/');
    assert.equal(entry.title, 'Example');
    assert.equal(entry.icon, GOOD_ICON);
    assert.equal(entry.jarId, 'personal');
    assert.equal(typeof entry.addedAt, 'number');
    assert.equal(typeof entry.id, 'string');
    assert.equal(entry.position, 0);
  });
});

// ---------------------------------------------------------------------------
// Per-jar isolation (DD3) — the feature's core claim
// ---------------------------------------------------------------------------

test('per-jar isolation: the SAME url in TWO jars is legal and independent (different titles, both survive)', () => {
  withStore((store) => {
    const a = store.add('personal', { url: 'https://shared.example/', title: 'Personal title' });
    const b = store.add('work', { url: 'https://shared.example/', title: 'Work title' });
    assert.equal(a.created, true);
    assert.equal(b.created, true);
    assert.notEqual(a.bookmark.id, b.bookmark.id);
    assert.equal(store.list('personal')[0].title, 'Personal title');
    assert.equal(store.list('work')[0].title, 'Work title');
  });
});

test('a mutation in jar A leaves jar B\'s stored rows byte-identical', () => {
  withStore((store) => {
    store.add('work', { url: 'https://untouched.example/', title: 'Untouched' });
    const before = rawRows('work');
    store.add('personal', { url: 'https://a.example/' });
    store.update('personal', store.list('personal')[0].id, { title: 'Renamed' });
    const after = rawRows('work');
    assert.deepEqual(after, before);
  });
});

test('list(jarId) for an unknown/empty jar returns []', () => {
  withStore((store) => {
    store.add('personal', { url: 'https://example.com/' });
    assert.deepEqual(store.list('nonexistent-jar'), []);
  });
});

// ---------------------------------------------------------------------------
// Read-time per-row validation (L2-DD-D) — drop/repair split, scoped per jar
// ---------------------------------------------------------------------------

test('list(): a single bad row (invalid url) is dropped; valid siblings in the SAME jar are kept', () => {
  withStore((store) => {
    const b = appDb.createBookmarksStore();
    b.insert({ id: 'a', jarId: 'personal', url: 'https://good.example/', title: 'Good', icon: null, position: 0, addedAt: 1 });
    b.insert({ id: 'b', jarId: 'personal', url: 'about:blank', title: 'Bad about:blank', icon: null, position: 1, addedAt: 2 });
    b.insert({ id: 'c', jarId: 'personal', url: 'https://also-good.example/', title: 'Also good', icon: null, position: 2, addedAt: 3 });
    const result = store.list('personal');
    assert.deepEqual(result.map((r) => r.id), ['a', 'c']);
  });
});

test('list(): an empty-string icon normalizes to null; the entry is kept', () => {
  withStore((store) => {
    appDb.createBookmarksStore().insert({ id: 'a', jarId: 'personal', url: 'https://example.com/', title: 'T', icon: '', position: 0, addedAt: 1 });
    const [entry] = store.list('personal');
    assert.equal(entry.icon, null);
  });
});

test('list(): a non-image data: icon normalizes to null; the entry is kept', () => {
  withStore((store) => {
    appDb.createBookmarksStore().insert({ id: 'a', jarId: 'personal', url: 'https://example.com/', title: 'T', icon: 'data:text/html,x', position: 0, addedAt: 1 });
    const [entry] = store.list('personal');
    assert.equal(entry.icon, null);
  });
});

test('list(): a missing/empty title falls back to the url', () => {
  withStore((store) => {
    const b = appDb.createBookmarksStore();
    b.insert({ id: 'a', jarId: 'personal', url: 'https://example.com/', title: '', icon: null, position: 0, addedAt: 1 });
    b.insert({ id: 'b', jarId: 'personal', url: 'https://example.org/', title: null, icon: null, position: 1, addedAt: 2 });
    const [a, bRow] = store.list('personal');
    assert.equal(a.title, 'https://example.com/');
    assert.equal(bRow.title, 'https://example.org/');
  });
});

test('list(): read-time validation never writes back or deletes — the raw row survives a read untouched', () => {
  withStore((store) => {
    const b = appDb.createBookmarksStore();
    b.insert({ id: 'a', jarId: 'personal', url: 'about:blank', title: '', icon: 'data:text/html,x', position: 0, addedAt: 1 });
    assert.deepEqual(store.list('personal'), [], 'the invalid row is dropped from the READ');
    const raw = b.findById('personal', 'a');
    assert.notEqual(raw, null, 'but the row itself is untouched in the table — a read never mutates');
    assert.equal(raw.url, 'about:blank');
  });
});

// ---------------------------------------------------------------------------
// add() — validation, idempotent-by-DD2, per-jar
// ---------------------------------------------------------------------------

test('add() rejects an unsafe url', () => {
  withStore((store) => {
    assert.deepEqual(store.add('personal', { url: 'javascript:alert(1)' }), { ok: false, reason: 'invalid-url' });
    assert.deepEqual(store.add('personal', { url: 'about:blank' }), { ok: false, reason: 'invalid-url' });
    assert.deepEqual(store.list('personal'), []);
  });
});

test('add() is idempotent by the DD2 exact-url predicate WITHIN a jar: re-adding returns the existing entry, created:false', () => {
  withStore((store) => {
    const first = store.add('personal', { url: 'https://example.com/', title: 'First title' });
    assert.equal(first.created, true);
    const second = store.add('personal', { url: 'https://example.com/', title: 'Ignored second title' });
    assert.equal(second.ok, true);
    assert.equal(second.created, false);
    assert.equal(second.bookmark.id, first.bookmark.id);
    assert.equal(second.bookmark.title, 'First title', 're-add does not overwrite the existing entry');
    assert.equal(store.list('personal').length, 1, 'no duplicate row');
  });
});

test('add() treats a fragment-different url as a DIFFERENT bookmark (DD2 exact match)', () => {
  withStore((store) => {
    store.add('personal', { url: 'https://example.com/page' });
    const second = store.add('personal', { url: 'https://example.com/page#section' });
    assert.equal(second.created, true);
    assert.equal(store.list('personal').length, 2);
  });
});

test('add() defaults title to the url and icon to null when omitted', () => {
  withStore((store) => {
    const result = store.add('personal', { url: 'https://example.com/' });
    assert.equal(result.bookmark.title, 'https://example.com/');
    assert.equal(result.bookmark.icon, null);
  });
});

test('add() appends at position n (gap-free, DD2)', () => {
  withStore((store) => {
    const a = store.add('personal', { url: 'https://a.example/' }).bookmark;
    const b = store.add('personal', { url: 'https://b.example/' }).bookmark;
    const c = store.add('personal', { url: 'https://c.example/' }).bookmark;
    assert.deepEqual([a.position, b.position, c.position], [0, 1, 2]);
  });
});

test('list() returns copies, not internal references', () => {
  withStore((store) => {
    store.add('personal', { url: 'https://example.com/' });
    const list1 = store.list('personal');
    list1[0].title = 'mutated locally';
    const list2 = store.list('personal');
    assert.notEqual(list2[0].title, 'mutated locally');
  });
});

// ---------------------------------------------------------------------------
// update() — including the per-jar URL-collision no-op ruling
// ---------------------------------------------------------------------------

test('update(): unknown id in the given jar returns not-found', () => {
  withStore((store) => {
    assert.deepEqual(store.update('personal', 'nope', { title: 'x' }), { ok: false, reason: 'not-found' });
  });
});

test('update(): a valid id in a DIFFERENT jar returns not-found (the id alone never authorizes a mutation, DD3)', () => {
  withStore((store) => {
    const { bookmark } = store.add('personal', { url: 'https://example.com/' });
    assert.deepEqual(store.update('work', bookmark.id, { title: 'x' }), { ok: false, reason: 'not-found' });
    assert.equal(store.list('personal')[0].title, 'https://example.com/', 'unaffected');
  });
});

test('update(): renames title/icon and persists', () => {
  withStore((store) => {
    const { bookmark } = store.add('personal', { url: 'https://example.com/' });
    const result = store.update('personal', bookmark.id, { title: 'New title', icon: GOOD_ICON });
    assert.equal(result.ok, true);
    assert.equal(result.bookmark.title, 'New title');
    assert.equal(result.bookmark.icon, GOOD_ICON);

    const reloaded = freshStore();
    reloaded.load('/unused/userdata/path');
    assert.equal(reloaded.list('personal')[0].title, 'New title');
  });
});

test('update(): rejects an invalid new url without mutating the entry', () => {
  withStore((store) => {
    const { bookmark } = store.add('personal', { url: 'https://example.com/', title: 'Original' });
    const result = store.update('personal', bookmark.id, { url: 'javascript:evil()' });
    assert.deepEqual(result, { ok: false, reason: 'invalid-url' });
    assert.equal(store.list('personal')[0].url, 'https://example.com/');
    assert.equal(store.list('personal')[0].title, 'Original');
  });
});

test('update(): a new URL matching a DIFFERENT existing bookmark in the SAME jar is rejected as a no-op ({ok:false, reason:"duplicate-url"})', () => {
  withStore((store) => {
    const a = store.add('personal', { url: 'https://a.example/', title: 'A' });
    const b = store.add('personal', { url: 'https://b.example/', title: 'B' });
    const result = store.update('personal', b.bookmark.id, { url: 'https://a.example/' });
    assert.deepEqual(result, { ok: false, reason: 'duplicate-url' });
    assert.equal(store.list('personal').find((x) => x.id === a.bookmark.id).url, 'https://a.example/');
    assert.equal(store.list('personal').find((x) => x.id === b.bookmark.id).url, 'https://b.example/');
  });
});

test('update(): a new URL matching an existing bookmark in a DIFFERENT jar is NOT a collision (per-jar uniqueness, DD1)', () => {
  withStore((store) => {
    store.add('work', { url: 'https://a.example/', title: 'Work A' });
    const b = store.add('personal', { url: 'https://b.example/', title: 'Personal B' });
    const result = store.update('personal', b.bookmark.id, { url: 'https://a.example/' });
    assert.equal(result.ok, true);
    assert.equal(result.bookmark.url, 'https://a.example/');
  });
});

test('update(): setting a bookmark\'s url to its OWN current url is not a collision', () => {
  withStore((store) => {
    const { bookmark } = store.add('personal', { url: 'https://example.com/', title: 'Original' });
    const result = store.update('personal', bookmark.id, { url: 'https://example.com/', title: 'Renamed' });
    assert.equal(result.ok, true);
    assert.equal(result.bookmark.title, 'Renamed');
  });
});

// ---------------------------------------------------------------------------
// remove() — including position renormalization (position invariant)
// ---------------------------------------------------------------------------

test('remove(): unknown id returns not-found', () => {
  withStore((store) => {
    assert.deepEqual(store.remove('personal', 'nope'), { ok: false, reason: 'not-found' });
  });
});

test('remove(): a valid id in a DIFFERENT jar returns not-found', () => {
  withStore((store) => {
    const { bookmark } = store.add('personal', { url: 'https://example.com/' });
    assert.deepEqual(store.remove('work', bookmark.id), { ok: false, reason: 'not-found' });
    assert.equal(store.list('personal').length, 1, 'unaffected');
  });
});

test('remove(): deletes the entry and persists', () => {
  withStore((store) => {
    const { bookmark } = store.add('personal', { url: 'https://example.com/' });
    const result = store.remove('personal', bookmark.id);
    assert.equal(result.ok, true);
    assert.equal(result.bookmark.id, bookmark.id);
    assert.deepEqual(store.list('personal'), []);

    const reloaded = freshStore();
    reloaded.load('/unused/userdata/path');
    assert.deepEqual(reloaded.list('personal'), []);
  });
});

test('remove(): position invariant — remaining rows renormalize to a gap-free 0..n-1, preserving relative order', () => {
  withStore((store) => {
    const a = store.add('personal', { url: 'https://a.example/' }).bookmark;
    const b = store.add('personal', { url: 'https://b.example/' }).bookmark;
    const c = store.add('personal', { url: 'https://c.example/' }).bookmark;
    store.remove('personal', b.id);
    const rows = store.list('personal');
    assert.deepEqual(rows.map((r) => r.id), [a.id, c.id]);
    assert.deepEqual(rows.map((r) => r.position), [0, 1], 'gap-free after removing the middle entry');
  });
});

test('remove(): removing from jar A does not renormalize jar B\'s positions', () => {
  withStore((store) => {
    store.add('work', { url: 'https://w1.example/' });
    store.add('work', { url: 'https://w2.example/' });
    const workBefore = store.list('work');
    const a = store.add('personal', { url: 'https://a.example/' }).bookmark;
    store.add('personal', { url: 'https://b.example/' });
    store.remove('personal', a.id);
    assert.deepEqual(store.list('work'), workBefore);
  });
});

// ---------------------------------------------------------------------------
// reorder() — per jar; Edge Cases: unknown/missing ids ignored, omitted
// entries preserved, cross-jar ids ignored (never mutate another jar's row)
// ---------------------------------------------------------------------------

test('reorder(): applies the given order within one jar', () => {
  withStore((store) => {
    const a = store.add('personal', { url: 'https://a.example/' }).bookmark;
    const b = store.add('personal', { url: 'https://b.example/' }).bookmark;
    const c = store.add('personal', { url: 'https://c.example/' }).bookmark;
    const result = store.reorder('personal', [c.id, a.id, b.id]);
    assert.deepEqual(result.bookmarks.map((x) => x.id), [c.id, a.id, b.id]);
    assert.deepEqual(store.list('personal').map((x) => x.id), [c.id, a.id, b.id]);
    assert.deepEqual(store.list('personal').map((x) => x.position), [0, 1, 2]);
  });
});

test('reorder(): unknown ids in the list are ignored', () => {
  withStore((store) => {
    const a = store.add('personal', { url: 'https://a.example/' }).bookmark;
    const b = store.add('personal', { url: 'https://b.example/' }).bookmark;
    const result = store.reorder('personal', [b.id, 'not-a-real-id', a.id]);
    assert.deepEqual(result.bookmarks.map((x) => x.id), [b.id, a.id]);
  });
});

test('reorder(): an id belonging to a DIFFERENT jar is ignored (never mutates another jar\'s row)', () => {
  withStore((store) => {
    const workEntry = store.add('work', { url: 'https://work.example/' }).bookmark;
    const a = store.add('personal', { url: 'https://a.example/' }).bookmark;
    const b = store.add('personal', { url: 'https://b.example/' }).bookmark;
    const result = store.reorder('personal', [b.id, workEntry.id, a.id]);
    assert.deepEqual(result.bookmarks.map((x) => x.id), [b.id, a.id], 'the cross-jar id is dropped, not treated as unknown-and-appended');
    assert.equal(store.list('work')[0].id, workEntry.id, 'the other jar entry is untouched');
    assert.equal(store.list('work')[0].position, 0);
  });
});

test('reorder(): entries OMITTED from the id list are preserved, appended in PRIOR order — never dropped', () => {
  withStore((store) => {
    const a = store.add('personal', { url: 'https://a.example/' }).bookmark;
    const b = store.add('personal', { url: 'https://b.example/' }).bookmark;
    const c = store.add('personal', { url: 'https://c.example/' }).bookmark;
    // Only mention 'c' — a and b are omitted and must survive, in their prior order.
    const result = store.reorder('personal', [c.id]);
    assert.deepEqual(result.bookmarks.map((x) => x.id), [c.id, a.id, b.id]);
  });
});

test('reorder(): a malformed (non-array) payload is a no-op over the current order', () => {
  withStore((store) => {
    const a = store.add('personal', { url: 'https://a.example/' }).bookmark;
    const b = store.add('personal', { url: 'https://b.example/' }).bookmark;
    const result = store.reorder('personal', null);
    assert.equal(result.ok, true);
    assert.deepEqual(result.bookmarks.map((x) => x.id), [a.id, b.id]);
  });
});

test('reorder(): a duplicate id within the payload is applied once, at its first position', () => {
  withStore((store) => {
    const a = store.add('personal', { url: 'https://a.example/' }).bookmark;
    const b = store.add('personal', { url: 'https://b.example/' }).bookmark;
    const result = store.reorder('personal', [b.id, b.id, a.id]);
    assert.deepEqual(result.bookmarks.map((x) => x.id), [b.id, a.id]);
  });
});

// ---------------------------------------------------------------------------
// clearJar() — DD9 lifecycle primitive (handleRemove / Bookmarks clear-data
// class consume this; the wipe-vs-remove distinction itself is pinned in
// test/unit/bookmarks-jar-lifecycle.test.js against the full IPC composition)
// ---------------------------------------------------------------------------

test('clearJar(): drops every bookmark for a jar, leaves other jars untouched, returns the deleted count', () => {
  withStore((store) => {
    store.add('personal', { url: 'https://a.example/' });
    store.add('personal', { url: 'https://b.example/' });
    store.add('work', { url: 'https://c.example/' });
    assert.equal(store.clearJar('personal'), 2);
    assert.deepEqual(store.list('personal'), []);
    assert.equal(store.list('work').length, 1, 'work jar untouched');
    assert.equal(store.clearJar('personal'), 0, 'a second clear on an empty jar is a safe no-op');
  });
});

// ---------------------------------------------------------------------------
// DATA_IMAGE_RE export (Implementation Guidance #7 — preserved, not load-bearing)
// ---------------------------------------------------------------------------

test('DATA_IMAGE_RE is exported and matches data:image/... only', () => {
  const store = freshStore();
  assert.ok(store.DATA_IMAGE_RE.test('data:image/png;base64,AAAA'));
  assert.ok(!store.DATA_IMAGE_RE.test('data:text/html,x'));
});
