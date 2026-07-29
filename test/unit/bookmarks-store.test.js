'use strict';

// Unit tests for src/main/bookmarks-store.js (M15 Flight 1 "Bookmarking Core
// and Surfaces", Leg 1 / DD1, DD2).
//
// No electron-stub needed — bookmarks-store.js is Electron-free (no
// require('electron')); the userData path is injected via load(userDataPath).
// Persists through app-db.js's document-row seam (keyed 'bookmarks'), the
// jars.js/settings-store.js precedent — appDb.open(dir)/close() bracket every
// test that touches the store (the jars.test.js pattern), and the module is
// re-required fresh per test (module-scoped singleton — the downloads-store.test.js
// cache-bust pattern) so no state leaks between tests.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const appDb = require('../../src/main/app-db');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-bookmarks-'));
}

function removeTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function freshStore() {
  const resolved = require.resolve('../../src/main/bookmarks-store');
  delete require.cache[resolved];
  return require('../../src/main/bookmarks-store');
}

// Read the raw 'bookmarks' document row payload directly off app.db, bypassing
// the store — the jars.test.js readRow() precedent.
function readRow(dir) {
  const check = new DatabaseSync(path.join(dir, 'app.db'));
  try {
    const row = /** @type {any} */ (
      check.prepare('SELECT payload FROM documents WHERE store = ?1').get('bookmarks')
    );
    return row ? JSON.parse(row.payload) : null;
  } finally {
    check.close();
  }
}

function writeRow(dir, payload) {
  appDb.createDocumentStore('bookmarks').write(JSON.stringify(payload));
}

/** Run `fn(store)` with a fresh temp dir + open app-db, tearing both down after. */
function withStore(fn) {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    fn(store, dir);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
}

const GOOD_ICON = 'data:image/png;base64,AAAA';

// ---------------------------------------------------------------------------
// load(): no row yet -> empty, never throws
// ---------------------------------------------------------------------------

test('load() with no existing row starts empty', () => {
  withStore((store) => {
    const result = store.load(process.cwd());
    assert.deepEqual(result, []);
    assert.deepEqual(store.list(), []);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: add -> reload -> same data
// ---------------------------------------------------------------------------

test('round-trip: an added bookmark survives a fresh load()', () => {
  withStore((store, dir) => {
    store.load(dir);
    const result = store.add({ url: 'https://example.com/', title: 'Example', icon: GOOD_ICON });
    assert.equal(result.ok, true);
    assert.equal(result.created, true);

    const reloaded = freshStore();
    reloaded.load(dir);
    assert.equal(reloaded.list().length, 1);
    const [entry] = reloaded.list();
    assert.equal(entry.url, 'https://example.com/');
    assert.equal(entry.title, 'Example');
    assert.equal(entry.icon, GOOD_ICON);
    assert.equal(typeof entry.addedAt, 'number');
    assert.equal(typeof entry.id, 'string');
  });
});

// ---------------------------------------------------------------------------
// Corrupt envelope -> whole store repairs to empty
// ---------------------------------------------------------------------------

test('corrupt envelope (wrong shape) repairs the WHOLE store to empty', () => {
  withStore((store, dir) => {
    writeRow(dir, { not: 'a bookmarks envelope' });
    const result = store.load(dir);
    assert.deepEqual(result, []);
  });
});

test('corrupt envelope (unparseable JSON row) repairs to empty, never throws', () => {
  withStore((store, dir) => {
    appDb.createDocumentStore('bookmarks').write('{ not json');
    assert.doesNotThrow(() => store.load(dir));
    assert.deepEqual(store.list(), []);
  });
});

// ---------------------------------------------------------------------------
// Bad-entry drop: valid siblings survive
// ---------------------------------------------------------------------------

test('a single bad entry (invalid url) is dropped; valid siblings are kept', () => {
  withStore((store, dir) => {
    writeRow(dir, {
      version: 1,
      bookmarks: [
        { id: 'a', url: 'https://good.example/', title: 'Good', icon: null, addedAt: 1 },
        { id: 'b', url: 'javascript:alert(1)', title: 'Bad scheme', icon: null, addedAt: 2 },
        { id: 'c', url: 'about:blank', title: 'Bad about:blank', icon: null, addedAt: 3 },
        { id: 'd', url: 'not a url at all', title: 'Malformed', icon: null, addedAt: 4 },
        { id: 'e', url: 'https://also-good.example/', title: 'Also good', icon: null, addedAt: 5 }
      ]
    });
    const result = store.load(dir);
    assert.deepEqual(result.map((b) => b.id), ['a', 'e']);
  });
});

test('a non-object / null entry in the array is dropped, siblings kept', () => {
  withStore((store, dir) => {
    writeRow(dir, {
      version: 1,
      bookmarks: [
        { id: 'a', url: 'https://good.example/', title: 'Good', icon: null, addedAt: 1 },
        null,
        'string',
        42,
        [],
        { id: 'b', url: 'https://also.example/', title: 'Also', icon: null, addedAt: 2 }
      ]
    });
    const result = store.load(dir);
    assert.deepEqual(result.map((b) => b.id), ['a', 'b']);
  });
});

test('an entry with a missing/non-string id is dropped', () => {
  withStore((store, dir) => {
    writeRow(dir, {
      version: 1,
      bookmarks: [
        { url: 'https://no-id.example/', title: 'No id', icon: null, addedAt: 1 },
        { id: 42, url: 'https://numeric-id.example/', title: 'Numeric id', icon: null, addedAt: 2 },
        { id: 'ok', url: 'https://ok.example/', title: 'Ok', icon: null, addedAt: 3 }
      ]
    });
    const result = store.load(dir);
    assert.deepEqual(result.map((b) => b.id), ['ok']);
  });
});

test('duplicate ids / duplicate urls on load: first occurrence wins', () => {
  withStore((store, dir) => {
    writeRow(dir, {
      version: 1,
      bookmarks: [
        { id: 'dup', url: 'https://a.example/', title: 'First', icon: null, addedAt: 1 },
        { id: 'dup', url: 'https://b.example/', title: 'Second (dup id)', icon: null, addedAt: 2 },
        { id: 'other', url: 'https://a.example/', title: 'Dup url', icon: null, addedAt: 3 }
      ]
    });
    const result = store.load(dir);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'dup');
    assert.equal(result[0].title, 'First');
  });
});

// ---------------------------------------------------------------------------
// Entry validation (AC2) — icon normalization, title fallback
// ---------------------------------------------------------------------------

test('load: an empty-string icon normalizes to null; the entry is kept', () => {
  withStore((store, dir) => {
    writeRow(dir, {
      version: 1,
      bookmarks: [{ id: 'a', url: 'https://example.com/', title: 'T', icon: '', addedAt: 1 }]
    });
    const [entry] = store.load(dir);
    assert.equal(entry.icon, null);
  });
});

test('load: a non-image data: icon normalizes to null; the entry is kept', () => {
  withStore((store, dir) => {
    writeRow(dir, {
      version: 1,
      bookmarks: [{ id: 'a', url: 'https://example.com/', title: 'T', icon: 'data:text/html,x', addedAt: 1 }]
    });
    const [entry] = store.load(dir);
    assert.equal(entry.icon, null);
  });
});

test('load: a missing/empty title falls back to the url', () => {
  withStore((store, dir) => {
    writeRow(dir, {
      version: 1,
      bookmarks: [
        { id: 'a', url: 'https://example.com/', title: '', icon: null, addedAt: 1 },
        { id: 'b', url: 'https://example.org/', icon: null, addedAt: 2 }
      ]
    });
    const [a, b] = store.load(dir);
    assert.equal(a.title, 'https://example.com/');
    assert.equal(b.title, 'https://example.org/');
  });
});

// ---------------------------------------------------------------------------
// add() — validation, idempotent-by-DD2
// ---------------------------------------------------------------------------

test('add() rejects an unsafe url', () => {
  withStore((store, dir) => {
    store.load(dir);
    assert.deepEqual(store.add({ url: 'javascript:alert(1)' }), { ok: false, reason: 'invalid-url' });
    assert.deepEqual(store.add({ url: 'about:blank' }), { ok: false, reason: 'invalid-url' });
    assert.deepEqual(store.list(), []);
  });
});

test('add() is idempotent by the DD2 exact-url predicate: re-adding returns the existing entry, created:false', () => {
  withStore((store, dir) => {
    store.load(dir);
    const first = store.add({ url: 'https://example.com/', title: 'First title' });
    assert.equal(first.created, true);
    const second = store.add({ url: 'https://example.com/', title: 'Ignored second title' });
    assert.equal(second.ok, true);
    assert.equal(second.created, false);
    assert.equal(second.bookmark.id, first.bookmark.id);
    assert.equal(second.bookmark.title, 'First title', 're-add does not overwrite the existing entry');
    assert.equal(store.list().length, 1, 'no duplicate row');
  });
});

test('add() treats a fragment-different url as a DIFFERENT bookmark (DD2 exact match)', () => {
  withStore((store, dir) => {
    store.load(dir);
    store.add({ url: 'https://example.com/page' });
    const second = store.add({ url: 'https://example.com/page#section' });
    assert.equal(second.created, true);
    assert.equal(store.list().length, 2);
  });
});

test('add() defaults title to the url and icon to null when omitted', () => {
  withStore((store, dir) => {
    store.load(dir);
    const result = store.add({ url: 'https://example.com/' });
    assert.equal(result.bookmark.title, 'https://example.com/');
    assert.equal(result.bookmark.icon, null);
  });
});

test('list() returns copies, not internal references', () => {
  withStore((store, dir) => {
    store.load(dir);
    store.add({ url: 'https://example.com/' });
    const list1 = store.list();
    list1[0].title = 'mutated locally';
    const list2 = store.list();
    assert.notEqual(list2[0].title, 'mutated locally');
  });
});

// ---------------------------------------------------------------------------
// update() — including the URL-collision no-op ruling
// ---------------------------------------------------------------------------

test('update(): unknown id returns not-found', () => {
  withStore((store, dir) => {
    store.load(dir);
    assert.deepEqual(store.update('nope', { title: 'x' }), { ok: false, reason: 'not-found' });
  });
});

test('update(): renames title/icon and persists', () => {
  withStore((store, dir) => {
    store.load(dir);
    const { bookmark } = store.add({ url: 'https://example.com/' });
    const result = store.update(bookmark.id, { title: 'New title', icon: GOOD_ICON });
    assert.equal(result.ok, true);
    assert.equal(result.bookmark.title, 'New title');
    assert.equal(result.bookmark.icon, GOOD_ICON);

    const reloaded = freshStore();
    reloaded.load(dir);
    assert.equal(reloaded.list()[0].title, 'New title');
  });
});

test('update(): rejects an invalid new url without mutating the entry', () => {
  withStore((store, dir) => {
    store.load(dir);
    const { bookmark } = store.add({ url: 'https://example.com/', title: 'Original' });
    const result = store.update(bookmark.id, { url: 'javascript:evil()' });
    assert.deepEqual(result, { ok: false, reason: 'invalid-url' });
    assert.equal(store.list()[0].url, 'https://example.com/');
    assert.equal(store.list()[0].title, 'Original');
  });
});

test('update(): a new URL matching a DIFFERENT existing bookmark is rejected as a no-op ({ok:false, reason:"duplicate-url"})', () => {
  withStore((store, dir) => {
    store.load(dir);
    const a = store.add({ url: 'https://a.example/', title: 'A' });
    const b = store.add({ url: 'https://b.example/', title: 'B' });
    const result = store.update(b.bookmark.id, { url: 'https://a.example/' });
    assert.deepEqual(result, { ok: false, reason: 'duplicate-url' });
    // Neither entry mutated.
    assert.equal(store.list().find((x) => x.id === a.bookmark.id).url, 'https://a.example/');
    assert.equal(store.list().find((x) => x.id === b.bookmark.id).url, 'https://b.example/');
  });
});

test('update(): setting a bookmark\'s url to its OWN current url is not a collision', () => {
  withStore((store, dir) => {
    store.load(dir);
    const { bookmark } = store.add({ url: 'https://example.com/', title: 'Original' });
    const result = store.update(bookmark.id, { url: 'https://example.com/', title: 'Renamed' });
    assert.equal(result.ok, true);
    assert.equal(result.bookmark.title, 'Renamed');
  });
});

// ---------------------------------------------------------------------------
// remove()
// ---------------------------------------------------------------------------

test('remove(): unknown id returns not-found', () => {
  withStore((store, dir) => {
    store.load(dir);
    assert.deepEqual(store.remove('nope'), { ok: false, reason: 'not-found' });
  });
});

test('remove(): deletes the entry and persists', () => {
  withStore((store, dir) => {
    store.load(dir);
    const { bookmark } = store.add({ url: 'https://example.com/' });
    const result = store.remove(bookmark.id);
    assert.equal(result.ok, true);
    assert.equal(result.bookmark.id, bookmark.id);
    assert.deepEqual(store.list(), []);

    const reloaded = freshStore();
    reloaded.load(dir);
    assert.deepEqual(reloaded.list(), []);
  });
});

// ---------------------------------------------------------------------------
// reorder() — Edge Case: unknown/missing ids ignored, omitted entries preserved
// ---------------------------------------------------------------------------

test('reorder(): applies the given order', () => {
  withStore((store, dir) => {
    store.load(dir);
    const a = store.add({ url: 'https://a.example/' }).bookmark;
    const b = store.add({ url: 'https://b.example/' }).bookmark;
    const c = store.add({ url: 'https://c.example/' }).bookmark;
    const result = store.reorder([c.id, a.id, b.id]);
    assert.deepEqual(result.bookmarks.map((x) => x.id), [c.id, a.id, b.id]);
    assert.deepEqual(store.list().map((x) => x.id), [c.id, a.id, b.id]);
  });
});

test('reorder(): unknown ids in the list are ignored', () => {
  withStore((store, dir) => {
    store.load(dir);
    const a = store.add({ url: 'https://a.example/' }).bookmark;
    const b = store.add({ url: 'https://b.example/' }).bookmark;
    const result = store.reorder([b.id, 'not-a-real-id', a.id]);
    assert.deepEqual(result.bookmarks.map((x) => x.id), [b.id, a.id]);
  });
});

test('reorder(): entries OMITTED from the id list are preserved, appended in PRIOR order — never dropped', () => {
  withStore((store, dir) => {
    store.load(dir);
    const a = store.add({ url: 'https://a.example/' }).bookmark;
    const b = store.add({ url: 'https://b.example/' }).bookmark;
    const c = store.add({ url: 'https://c.example/' }).bookmark;
    // Only mention 'c' — a and b are omitted and must survive, in their prior order.
    const result = store.reorder([c.id]);
    assert.deepEqual(result.bookmarks.map((x) => x.id), [c.id, a.id, b.id]);
  });
});

test('reorder(): a malformed (non-array) payload is a no-op over the current order', () => {
  withStore((store, dir) => {
    store.load(dir);
    const a = store.add({ url: 'https://a.example/' }).bookmark;
    const b = store.add({ url: 'https://b.example/' }).bookmark;
    const result = store.reorder(null);
    assert.equal(result.ok, true);
    assert.deepEqual(result.bookmarks.map((x) => x.id), [a.id, b.id]);
  });
});

test('reorder(): a duplicate id within the payload is applied once, at its first position', () => {
  withStore((store, dir) => {
    store.load(dir);
    const a = store.add({ url: 'https://a.example/' }).bookmark;
    const b = store.add({ url: 'https://b.example/' }).bookmark;
    const result = store.reorder([b.id, b.id, a.id]);
    assert.deepEqual(result.bookmarks.map((x) => x.id), [b.id, a.id]);
  });
});

// ---------------------------------------------------------------------------
// Envelope shape on disk
// ---------------------------------------------------------------------------

test('the persisted row is the { version: 1, bookmarks: [...] } envelope, in display order', () => {
  withStore((store, dir) => {
    store.load(dir);
    store.add({ url: 'https://a.example/' });
    store.add({ url: 'https://b.example/' });
    const row = readRow(dir);
    assert.equal(row.version, 1);
    assert.equal(row.bookmarks.length, 2);
    assert.deepEqual(row.bookmarks.map((b) => b.url), ['https://a.example/', 'https://b.example/']);
  });
});
