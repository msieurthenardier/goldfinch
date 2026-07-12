'use strict';

// Unit tests for src/main/history-store.js
//
// No Electron stub needed — the module is Electron-free (no require('electron'),
// no app.getPath at module scope). The userData path is injected via open().
//
// The store is a MODULE-SCOPED SINGLETON (like settings-store / downloads-store),
// so we re-require it fresh per test (cache-bust) to stop the live db handle
// leaking across tests, and use a real temp dir per test (mkdtempSync).
//
// node:sqlite is experimental — the ExperimentalWarning printed by node --test
// is expected and accepted (flight DD1).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-history-'));
}

function removeTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function freshStore() {
  const resolved = require.resolve('../../src/main/history-store');
  delete require.cache[resolved];
  return require('../../src/main/history-store');
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------
test('exposes exactly the repo interface', () => {
  const store = freshStore();
  for (const m of [
    'open',
    'close',
    'recordVisit',
    'setTitle',
    'listRecent',
    'search',
    'deleteVisit',
    'clearJar',
    'countByJar',
    'pruneExpired',
    'pruneOneJar'
  ]) {
    assert.equal(typeof store[m], 'function', `${m} should be a function`);
  }
});

// ---------------------------------------------------------------------------
// Methods throw before open() (programmer error), except close() (idempotent)
// ---------------------------------------------------------------------------
test('every method throws "history store not open" before open(), except close()', () => {
  const store = freshStore();
  assert.throws(() => store.recordVisit({ jarId: 'a', url: 'https://x/', visitedAt: 1 }), /history store not open/);
  assert.throws(() => store.setTitle(1, 'x'), /history store not open/);
  assert.throws(() => store.listRecent('a'), /history store not open/);
  assert.throws(() => store.search('a', 'x'), /history store not open/);
  assert.throws(() => store.deleteVisit('a', 1), /history store not open/);
  assert.throws(() => store.clearJar('a'), /history store not open/);
  assert.throws(() => store.countByJar('a'), /history store not open/);
  assert.throws(() => store.pruneExpired({}, 1), /history store not open/);
  assert.throws(() => store.pruneOneJar('a', 30, 1), /history store not open/);
  assert.doesNotThrow(() => store.close(), 'close() before open() must be a no-op, not throw');
});

// ---------------------------------------------------------------------------
// Schema creation — assert PRESENCE of each named object individually, never
// a total row count (FTS5 external-content creates four shadow tables that a
// count assertion would trip over).
// ---------------------------------------------------------------------------
test('open() on an empty temp dir creates history.db with schema v1 objects', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);

    const dbPath = path.join(dir, 'history.db');
    assert.ok(fs.existsSync(dbPath), 'history.db should exist');

    const check = new DatabaseSync(dbPath);
    try {
      const uv = /** @type {any} */ (check.prepare('PRAGMA user_version').get());
      assert.equal(uv.user_version, 1);

      const names = new Set(
        /** @type {any[]} */ (
          check.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger')").all()
        ).map((r) => r.name)
      );
      for (const expected of [
        'visits',
        'visits_fts',
        'visits_ai',
        'visits_ad',
        'visits_au'
      ]) {
        assert.ok(names.has(expected), `sqlite_master should contain ${expected}`);
      }

      const indexNames = new Set(
        /** @type {any[]} */ (
          check.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all()
        ).map((r) => r.name)
      );
      assert.ok(indexNames.has('visits_jar_time'));
      assert.ok(indexNames.has('visits_jar_url'));
    } finally {
      check.close();
    }
    store.close();
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// require() alone must be side-effect-free — no file creation, no open.
// ---------------------------------------------------------------------------
test('requiring the module alone does not open or create anything', () => {
  const dir = makeTempDir();
  try {
    freshStore(); // require only, never call open()
    assert.equal(fs.readdirSync(dir).length, 0, 'require() must not touch the filesystem');
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Full API round-trip
// ---------------------------------------------------------------------------
test('full API round-trips: record -> listRecent -> setTitle -> search -> deleteVisit -> clearJar -> countByJar -> pruneExpired', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);

    const id1 = store.recordVisit({
      jarId: 'a',
      url: 'https://example.com/page1',
      title: 'Example Page',
      visitedAt: 1000
    });
    const id2 = store.recordVisit({
      jarId: 'a',
      url: 'https://example.com/page2',
      title: null,
      visitedAt: 2000
    });
    assert.equal(typeof id1, 'number');
    assert.equal(typeof id2, 'number');
    assert.notEqual(id1, id2);

    // listRecent: DESC order
    const recent = store.listRecent('a');
    assert.deepEqual(recent.map((r) => r.id), [id2, id1]);
    assert.equal(recent[1].title, 'Example Page');
    assert.equal(recent[0].title, null);

    // setTitle
    const updated = store.setTitle(id2, 'Second Page');
    assert.equal(updated, true);
    assert.equal(store.listRecent('a').find((r) => r.id === id2).title, 'Second Page');
    assert.equal(store.setTitle(999999, 'nope'), false, 'unknown visit id returns false');

    // search
    const found = store.search('a', 'exam');
    assert.deepEqual(
      found.map((r) => r.id).sort(),
      [id1, id2].sort()
    );

    // countByJar
    assert.equal(store.countByJar('a'), 2);

    // deleteVisit
    assert.equal(store.deleteVisit('a', id1), true);
    assert.equal(store.countByJar('a'), 1);
    assert.equal(store.deleteVisit('a', id1), false, 'deleting again returns false');

    // clearJar
    assert.equal(store.clearJar('a'), 1);
    assert.equal(store.countByJar('a'), 0);

    // pruneExpired
    const id3 = store.recordVisit({ jarId: 'a', url: 'https://old.example/', visitedAt: 0 });
    const now = 1000 * 86_400_000; // far in the future relative to visitedAt: 0
    const result = store.pruneExpired({ a: 30 }, now);
    assert.deepEqual(result, { a: 1 });
    assert.equal(store.countByJar('a'), 0);
    void id3;
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// recordVisit validation
// ---------------------------------------------------------------------------
test('recordVisit validates jarId/url/visitedAt and throws TypeError', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);

    assert.throws(
      () => store.recordVisit({ jarId: '', url: 'https://x/', visitedAt: 1 }),
      TypeError
    );
    assert.throws(
      () => store.recordVisit({ jarId: 'a', url: '', visitedAt: 1 }),
      TypeError
    );
    assert.throws(
      () => store.recordVisit({ jarId: 'a', url: 'https://x/', visitedAt: NaN }),
      TypeError
    );
    assert.throws(
      () => store.recordVisit({ jarId: 'a', url: 'https://x/', visitedAt: /** @type {any} */ ('x') }),
      TypeError
    );
    // title omitted (nullable/optional) must not throw.
    assert.doesNotThrow(() =>
      store.recordVisit({ jarId: 'a', url: 'https://x/', visitedAt: 1 })
    );
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Cross-jar isolation
// ---------------------------------------------------------------------------
test('cross-jar isolation: reads, deletes, clears, and cursors never cross jars', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);

    const aId1 = store.recordVisit({ jarId: 'a', url: 'https://a.example/1', title: 'A One', visitedAt: 1000 });
    const aId2 = store.recordVisit({ jarId: 'a', url: 'https://a.example/2', title: 'A Two', visitedAt: 2000 });
    const bId1 = store.recordVisit({ jarId: 'b', url: 'https://b.example/1', title: 'B One', visitedAt: 1500 });

    // listRecent(A) only returns A rows.
    const aRecent = store.listRecent('a');
    assert.deepEqual(
      aRecent.map((r) => r.id).sort(),
      [aId1, aId2].sort()
    );

    // search(A) only returns A rows, even for a token also present in jar B's title.
    const aSearch = store.search('a', 'One Two');
    assert.ok(aSearch.every((r) => [aId1, aId2].includes(r.id)));
    assert.ok(!aSearch.some((r) => r.id === bId1));

    // countByJar(A) excludes B.
    assert.equal(store.countByJar('a'), 2);
    assert.equal(store.countByJar('b'), 1);

    // deleteVisit(A, idOfBRow) returns false and deletes nothing.
    assert.equal(store.deleteVisit('a', bId1), false);
    assert.equal(store.countByJar('b'), 1);

    // clearJar(A) leaves B intact.
    assert.equal(store.clearJar('a'), 2);
    assert.equal(store.countByJar('a'), 0);
    assert.equal(store.countByJar('b'), 1);

    // A `before` cursor id from jar B yields [] for jar A.
    assert.deepEqual(store.listRecent('a', { before: bId1 }), []);
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Search sanitization
// ---------------------------------------------------------------------------
test('search sanitization: FTS5 operator characters never throw', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    store.recordVisit({ jarId: 'a', url: 'https://example.com/page1', title: 'Example', visitedAt: 1000 });

    for (const q of ['"', '*', '(', ')', '-word', 'NEAR', '"unterminated', 'a" OR "b', '(a OR b)']) {
      assert.doesNotThrow(() => store.search('a', q), `query ${JSON.stringify(q)} must not throw`);
    }
  } finally {
    removeTempDir(dir);
  }
});

test('search: prefix matching works ("exam" matches https://example.com/...)', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    const id = store.recordVisit({
      jarId: 'a',
      url: 'https://example.com/page1',
      title: 'Some Title',
      visitedAt: 1000
    });
    const results = store.search('a', 'exam');
    assert.deepEqual(results.map((r) => r.id), [id]);
  } finally {
    removeTempDir(dir);
  }
});

test('search: empty/whitespace query returns [] without touching FTS', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    store.recordVisit({ jarId: 'a', url: 'https://example.com/', title: 'x', visitedAt: 1000 });
    assert.deepEqual(store.search('a', ''), []);
    assert.deepEqual(store.search('a', '   '), []);
    assert.deepEqual(store.search('a', '""'), [], 'a lone-quote-only token strips to empty');
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Title backfill
// ---------------------------------------------------------------------------
test('title backfill: setTitle updates the row AND the FTS shadow', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    const id = store.recordVisit({
      jarId: 'a',
      url: 'https://example.com/',
      title: 'Distinctive Old Title',
      visitedAt: 1000
    });

    assert.deepEqual(store.search('a', 'Distinctive').map((r) => r.id), [id]);

    store.setTitle(id, 'Brand New Title');

    assert.deepEqual(store.search('a', 'Brand').map((r) => r.id), [id]);
    assert.deepEqual(store.search('a', 'Distinctive'), [], 'old title no longer indexed');
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------
test('pruneExpired: deletes only rows older than the jar retention; orphan GC removes unregistered jar ids', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);

    const dayMs = 86_400_000;
    const now = 1000 * dayMs;

    // Jar 'a': one visit older than 30 days, one within.
    const oldId = store.recordVisit({ jarId: 'a', url: 'https://old/', visitedAt: now - 31 * dayMs });
    const freshId = store.recordVisit({ jarId: 'a', url: 'https://fresh/', visitedAt: now - 1 * dayMs });

    // Jar 'orphan': not present in the retention map at all — pure orphan GC target.
    store.recordVisit({ jarId: 'orphan', url: 'https://orphan/', visitedAt: now - 1 * dayMs });

    const result = store.pruneExpired({ a: 30 }, now);
    assert.deepEqual(result, { a: 1, orphan: 1 });

    const aRemaining = store.listRecent('a').map((r) => r.id);
    assert.deepEqual(aRemaining, [freshId]);
    assert.equal(store.countByJar('orphan'), 0);
    void oldId;
  } finally {
    removeTempDir(dir);
  }
});

test('pruneExpired with an empty retention map is pure orphan GC (deletes everything)', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    store.recordVisit({ jarId: 'a', url: 'https://a/', visitedAt: 1000 });
    store.recordVisit({ jarId: 'b', url: 'https://b/', visitedAt: 2000 });

    const result = store.pruneExpired({}, 999_999_999);
    assert.deepEqual(result, { a: 1, b: 1 });
    assert.equal(store.countByJar('a'), 0);
    assert.equal(store.countByJar('b'), 0);
  } finally {
    removeTempDir(dir);
  }
});

test('pruneExpired return value maps only nonzero deletion counts', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    store.recordVisit({ jarId: 'a', url: 'https://a/', visitedAt: 1000 });

    // Jar 'b' is registered with a retention but has no rows at all.
    const result = store.pruneExpired({ a: 9999, b: 30 }, 2000);
    assert.deepEqual(result, {}, 'no deletions occurred (a within retention, b has no rows)');
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// pruneOneJar (history flight M08 F3 / DD4) — single-jar cutoff delete, NO
// orphan sweep. Safe by construction for a single-jar caller (the retention
// EDIT path): a naive pruneExpired({[id]:days}, now) call would delete every
// OTHER jar's history (absent from the map = orphaned).
// ---------------------------------------------------------------------------
test('pruneOneJar deletes only rows older than the cutoff for the given jar and returns the deleted count', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);

    const dayMs = 86_400_000;
    const now = 1000 * dayMs;

    const oldId = store.recordVisit({ jarId: 'a', url: 'https://old/', visitedAt: now - 31 * dayMs });
    const freshId = store.recordVisit({ jarId: 'a', url: 'https://fresh/', visitedAt: now - 1 * dayMs });

    const deleted = store.pruneOneJar('a', 30, now);
    assert.equal(deleted, 1);
    assert.deepEqual(store.listRecent('a').map((r) => r.id), [freshId]);
    void oldId;
  } finally {
    removeTempDir(dir);
  }
});

test('pruneOneJar: no-collateral pin — other jars are untouched, including an "orphan" id absent from any call', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);

    const dayMs = 86_400_000;
    const now = 1000 * dayMs;

    store.recordVisit({ jarId: 'a', url: 'https://old-a/', visitedAt: now - 31 * dayMs });
    store.recordVisit({ jarId: 'b', url: 'https://old-b/', visitedAt: now - 31 * dayMs });
    store.recordVisit({ jarId: 'orphan', url: 'https://old-orphan/', visitedAt: now - 31 * dayMs });

    const deleted = store.pruneOneJar('a', 30, now);
    assert.equal(deleted, 1);
    assert.equal(store.countByJar('a'), 0);
    // Unlike pruneExpired, jars NOT named in this call are never touched — no
    // orphan sweep.
    assert.equal(store.countByJar('b'), 1, 'jar b must survive untouched');
    assert.equal(store.countByJar('orphan'), 1, 'an unregistered jar id must survive untouched (no orphan GC here)');
  } finally {
    removeTempDir(dir);
  }
});

test('pruneOneJar returns 0 when nothing is old enough to prune', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    store.recordVisit({ jarId: 'a', url: 'https://fresh/', visitedAt: 1000 });
    assert.equal(store.pruneOneJar('a', 9999, 2000), 0);
  } finally {
    removeTempDir(dir);
  }
});

test('pruneOneJar validates jarId/days/now and throws TypeError', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    assert.throws(() => store.pruneOneJar('', 30, 1000), TypeError);
    assert.throws(() => store.pruneOneJar(/** @type {any} */ (42), 30, 1000), TypeError);
    assert.throws(() => store.pruneOneJar('a', /** @type {any} */ ('30'), 1000), TypeError);
    assert.throws(() => store.pruneOneJar('a', NaN, 1000), TypeError);
    assert.throws(() => store.pruneOneJar('a', 30, /** @type {any} */ (null)), TypeError);
    assert.throws(() => store.pruneOneJar('a', 30, NaN), TypeError);
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Persistence across close/reopen
// ---------------------------------------------------------------------------
test('persistence: close -> reopen on the same dir -> rows still there', () => {
  const dir = makeTempDir();
  try {
    let store = freshStore();
    store.open(dir);
    const id = store.recordVisit({ jarId: 'a', url: 'https://example.com/', title: 'x', visitedAt: 1000 });
    store.close();

    store = freshStore();
    store.open(dir);
    const rows = store.listRecent('a');
    assert.deepEqual(rows.map((r) => r.id), [id]);
  } finally {
    removeTempDir(dir);
  }
});

test('close() is idempotent (safe to call twice)', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    store.close();
    assert.doesNotThrow(() => store.close());
  } finally {
    removeTempDir(dir);
  }
});

test('re-open() while already open closes then reopens (idempotent-safe)', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    store.recordVisit({ jarId: 'a', url: 'https://example.com/', visitedAt: 1000 });
    assert.doesNotThrow(() => store.open(dir));
    // Data survives the re-open since it's the same dir/file.
    assert.equal(store.countByJar('a'), 1);
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Corrupt-file recovery
// ---------------------------------------------------------------------------
test('corrupt-file recovery: garbage bytes in history.db -> open() succeeds, quarantine file exists, store works', () => {
  const dir = makeTempDir();
  try {
    const dbPath = path.join(dir, 'history.db');
    fs.writeFileSync(dbPath, 'this is not a sqlite database file, just garbage bytes\0\0\0');

    const store = freshStore();
    assert.doesNotThrow(() => store.open(dir));

    const entries = fs.readdirSync(dir);
    assert.ok(
      entries.some((f) => f.startsWith('history.db.corrupt-')),
      `expected a history.db.corrupt-* file, got: ${entries.join(', ')}`
    );

    // Store must be fully functional post-recovery.
    const id = store.recordVisit({ jarId: 'a', url: 'https://example.com/', visitedAt: 1000 });
    assert.deepEqual(store.listRecent('a').map((r) => r.id), [id]);
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------
test('paging: listRecent pages via `before` with no duplicates/gaps, incl. same-timestamp id tiebreak', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);

    // 5 rows: three share visited_at=1000 (id tiebreak), two more at 2000/3000.
    const ids = [];
    ids.push(store.recordVisit({ jarId: 'a', url: 'https://x/1', visitedAt: 1000 }));
    ids.push(store.recordVisit({ jarId: 'a', url: 'https://x/2', visitedAt: 1000 }));
    ids.push(store.recordVisit({ jarId: 'a', url: 'https://x/3', visitedAt: 1000 }));
    ids.push(store.recordVisit({ jarId: 'a', url: 'https://x/4', visitedAt: 2000 }));
    ids.push(store.recordVisit({ jarId: 'a', url: 'https://x/5', visitedAt: 3000 }));

    // Expected full order: visited_at DESC, id DESC.
    const expectedOrder = [ids[4], ids[3], ids[2], ids[1], ids[0]];

    const collected = [];
    let cursor = null;
    for (let i = 0; i < 10; i++) {
      // safety cap against an infinite loop bug
      const page = store.listRecent('a', { limit: 2, before: cursor });
      if (page.length === 0) break;
      collected.push(...page.map((r) => r.id));
      cursor = page[page.length - 1].id;
    }

    assert.deepEqual(collected, expectedOrder, 'paged collection matches the full DESC order with no dupes/gaps');
  } finally {
    removeTempDir(dir);
  }
});

test('listRecent: limit is clamped to 1-500', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    for (let i = 0; i < 5; i++) {
      store.recordVisit({ jarId: 'a', url: `https://x/${i}`, visitedAt: 1000 + i });
    }
    assert.equal(store.listRecent('a', { limit: 0 }).length, 1, 'limit clamped up to 1');
    assert.equal(store.listRecent('a', { limit: 5000 }).length, 5, 'limit clamped down to 500, but only 5 rows exist');
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
test('unicode in query/title is handled by the default tokenizer', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    const id = store.recordVisit({
      jarId: 'a',
      url: 'https://example.com/café',
      title: 'Café Menu',
      visitedAt: 1000
    });
    const results = store.search('a', 'Café');
    assert.deepEqual(results.map((r) => r.id), [id]);
  } finally {
    removeTempDir(dir);
  }
});

test('null title is accepted; FTS treats it as empty until setTitle backfills', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    const id = store.recordVisit({ jarId: 'a', url: 'https://example.com/notitle', visitedAt: 1000 });
    assert.equal(store.listRecent('a')[0].title, null);
    store.setTitle(id, 'Filled In');
    assert.deepEqual(store.search('a', 'Filled').map((r) => r.id), [id]);
  } finally {
    removeTempDir(dir);
  }
});
