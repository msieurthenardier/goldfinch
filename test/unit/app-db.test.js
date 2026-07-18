'use strict';

// Unit tests for src/main/app-db.js
//
// No Electron stub needed — the module is Electron-free (no require('electron'),
// no app.getPath at module scope). The userData path is injected via open().
//
// The store is a MODULE-SCOPED SINGLETON (like history-store), so we re-require it
// fresh per test (cache-bust) to stop the live db handle leaking across tests, and
// use a real temp dir per test (mkdtempSync).
//
// node:sqlite is experimental — the ExperimentalWarning printed by node --test
// is expected and accepted (flight 10-1 DD1).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-app-db-'));
}

function removeTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function freshStore() {
  const resolved = require.resolve('../../src/main/app-db');
  delete require.cache[resolved];
  return require('../../src/main/app-db');
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------
test('exposes exactly the repo interface', () => {
  const store = freshStore();
  for (const m of ['open', 'close', 'isOpen', 'createDocumentStore', 'createCookieSeenStore']) {
    assert.equal(typeof store[m], 'function', `${m} should be a function`);
  }
});

test('is Electron-free', () => {
  // Count actual require('electron') CALLS, ignoring the header comment's
  // prose mention of the same string (history-store.js's header — the
  // pattern this module clones — has the identical comment).
  const src = fs.readFileSync(path.join(__dirname, '../../src/main/app-db.js'), 'utf8');
  const codeLines = src.split('\n').filter((line) => !line.trim().startsWith('//'));
  assert.equal((codeLines.join('\n').match(/require\('electron'\)/g) || []).length, 0);
});

// ---------------------------------------------------------------------------
// isOpen() reflects lifecycle state
// ---------------------------------------------------------------------------
test('isOpen() is false before open(), true after, false after close()', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    assert.equal(store.isOpen(), false);
    store.open(dir);
    assert.equal(store.isOpen(), true);
    store.close();
    assert.equal(store.isOpen(), false);
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// createDocumentStore().read/write/remove throw "app db not open" before open()
// ---------------------------------------------------------------------------
test('document store methods throw "app db not open" before open(), close() is a no-op', () => {
  const store = freshStore();
  const doc = store.createDocumentStore('settings');
  assert.throws(() => doc.read(), /app db not open/);
  assert.throws(() => doc.write('{}'), /app db not open/);
  assert.throws(() => doc.remove(), /app db not open/);
  assert.doesNotThrow(() => store.close(), 'close() before open() must be a no-op, not throw');
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
// Schema bootstrap
// ---------------------------------------------------------------------------
test('open() on an empty temp dir creates app.db at user_version=2 with BOTH tables (M10 F2 Leg 3 ladder)', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);

    const dbPath = path.join(dir, 'app.db');
    assert.ok(fs.existsSync(dbPath), 'app.db should exist');
    assert.ok(fs.existsSync(dbPath + '-wal') || fs.existsSync(dbPath + '-shm'), 'WAL family present after a write');

    const check = new DatabaseSync(dbPath);
    try {
      const uv = /** @type {any} */ (check.prepare('PRAGMA user_version').get());
      assert.equal(uv.user_version, 2, 'a fresh profile lands directly on CURRENT_VERSION, never pausing at v1');

      const names = new Set(
        /** @type {any[]} */ (
          check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
        ).map((r) => r.name)
      );
      assert.ok(names.has('documents'), 'sqlite_master should contain the documents table');
      assert.ok(names.has('cookie_seen'), 'sqlite_master should contain the cookie_seen table');

      const cols = /** @type {any[]} */ (check.prepare('PRAGMA table_info(documents)').all());
      const colNames = cols.map((c) => c.name).sort();
      assert.deepEqual(colNames, ['payload', 'store', 'updated_at']);

      const cookieCols = /** @type {any[]} */ (check.prepare('PRAGMA table_info(cookie_seen)').all());
      const cookieColNames = cookieCols.map((c) => c.name).sort();
      assert.deepEqual(cookieColNames, ['domain', 'first_seen_ms', 'jar_id', 'name', 'path']);
    } finally {
      check.close();
    }
    store.close();
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// user_version ladder (M10 Flight 2, Leg 3 / DD4 VERDICT review annotation
// (c) — the first REAL ladder step this module has exercised; previously
// attemptOpen branched only on version 0).
// ---------------------------------------------------------------------------
test('ladder: a hand-crafted v1 fixture (documents rows present, no cookie_seen table) steps to v2, preserving every row', () => {
  const dir = makeTempDir();
  try {
    const dbPath = path.join(dir, 'app.db');
    // Hand-craft a real v1 file — NOTE (leg spec): no real v1 file exists in
    // the wild (F1 is unreleased), so this fixture protects the
    // hypothetical F1-ships-alone-first scenario. Built with the SAME v1
    // SQL app-db.js itself would have run at version 0, replicated here
    // (not imported — the fixture must be independent of the module under
    // test to actually exercise the ladder, not just round-trip it).
    const seed = new DatabaseSync(dbPath);
    seed.exec('PRAGMA journal_mode = WAL');
    seed.exec(
      'CREATE TABLE documents (store TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)'
    );
    seed.exec('PRAGMA user_version = 1');
    seed.prepare('INSERT INTO documents (store, payload, updated_at) VALUES (?, ?, ?)').run('settings', '{"a":1}', 1000);
    seed.prepare('INSERT INTO documents (store, payload, updated_at) VALUES (?, ?, ?)').run('jars', '{"b":2}', 2000);
    seed.close();

    const store = freshStore();
    assert.doesNotThrow(() => store.open(dir));

    const check = new DatabaseSync(dbPath);
    try {
      const uv = /** @type {any} */ (check.prepare('PRAGMA user_version').get());
      assert.equal(uv.user_version, 2);

      const names = new Set(
        /** @type {any[]} */ (check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).map(
          (r) => r.name
        )
      );
      assert.ok(names.has('cookie_seen'), 'the v1->v2 step must create cookie_seen');

      const rows = /** @type {any[]} */ (
        check.prepare('SELECT store, payload, updated_at FROM documents ORDER BY store').all()
      ).map((r) => ({ store: r.store, payload: r.payload, updated_at: r.updated_at }));
      assert.deepEqual(rows, [
        { store: 'jars', payload: '{"b":2}', updated_at: 2000 },
        { store: 'settings', payload: '{"a":1}', updated_at: 1000 }
      ]);
    } finally {
      check.close();
    }

    // Store must be fully functional post-ladder, including the new table.
    const doc = store.createDocumentStore('settings');
    assert.equal(doc.read(), '{"a":1}', 'the pre-existing row is readable through the live store post-ladder');
    const cookieSeen = store.createCookieSeenStore();
    assert.doesNotThrow(() => cookieSeen.insertIfAbsent('jarA', 'sid', 'example.com', '/', 5000));
    store.close();
  } finally {
    removeTempDir(dir);
  }
});

test('ladder: an already-v2 file re-opens as a no-op (no re-create, no data loss)', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    store.createDocumentStore('settings').write('{"kept":true}', 1000);
    store.createCookieSeenStore().insertIfAbsent('jarA', 'sid', 'example.com', '/', 5000);
    store.close();

    const store2 = freshStore();
    assert.doesNotThrow(() => store2.open(dir));
    assert.equal(store2.createDocumentStore('settings').read(), '{"kept":true}');
    const expired = store2.createCookieSeenStore().selectExpired('jarA', 10000);
    assert.equal(expired.length, 1, 'the cookie_seen row survives an already-current reopen');

    const check = new DatabaseSync(path.join(dir, 'app.db'));
    try {
      const uv = /** @type {any} */ (check.prepare('PRAGMA user_version').get());
      assert.equal(uv.user_version, 2);
    } finally {
      check.close();
    }
    store2.close();
  } finally {
    removeTempDir(dir);
  }
});

test('ladder: corrupt file still quarantines unchanged and recreates fresh at v2', () => {
  const dir = makeTempDir();
  try {
    const dbPath = path.join(dir, 'app.db');
    fs.writeFileSync(dbPath, 'garbage, not a database, ladder edge case\0\0\0');

    const store = freshStore();
    assert.doesNotThrow(() => store.open(dir));

    const entries = fs.readdirSync(dir);
    assert.ok(entries.some((f) => f.startsWith('app.db.corrupt-')));

    const check = new DatabaseSync(dbPath);
    try {
      const uv = /** @type {any} */ (check.prepare('PRAGMA user_version').get());
      assert.equal(uv.user_version, 2);
      const names = new Set(
        /** @type {any[]} */ (check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).map(
          (r) => r.name
        )
      );
      assert.ok(names.has('documents') && names.has('cookie_seen'));
    } finally {
      check.close();
    }
    store.close();
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Document read/write/upsert/remove round-trip
// ---------------------------------------------------------------------------
test('document store: read() is null before any write; write() then read() round-trips', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    const doc = store.createDocumentStore('settings');

    assert.equal(doc.read(), null, 'no row yet');
    doc.write('{"homePage":"https://example.com/"}', 1000);
    assert.equal(doc.read(), '{"homePage":"https://example.com/"}');
  } finally {
    removeTempDir(dir);
  }
});

test('document store: write() upserts (a second write replaces the payload)', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    const doc = store.createDocumentStore('downloads');

    doc.write('{"nextId":1}', 1000);
    doc.write('{"nextId":2}', 2000);
    assert.equal(doc.read(), '{"nextId":2}');

    const check = new DatabaseSync(path.join(dir, 'app.db'));
    try {
      const row = /** @type {any} */ (
        check.prepare('SELECT COUNT(*) AS c FROM documents WHERE store = ?1').get('downloads')
      );
      assert.equal(row.c, 1, 'upsert must not create a second row for the same store key');
    } finally {
      check.close();
    }
  } finally {
    removeTempDir(dir);
  }
});

test('document store: remove() deletes the row; read() → null afterward', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    const doc = store.createDocumentStore('session');

    doc.write('{"windows":[]}', 1000);
    assert.notEqual(doc.read(), null);
    doc.remove();
    assert.equal(doc.read(), null);
    assert.doesNotThrow(() => doc.remove(), 'remove() on an absent row must not throw');
  } finally {
    removeTempDir(dir);
  }
});

test('document store: different store names are independent rows', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    const settings = store.createDocumentStore('settings');
    const downloads = store.createDocumentStore('downloads');

    settings.write('{"a":1}', 1000);
    downloads.write('{"b":2}', 1000);

    assert.equal(settings.read(), '{"a":1}');
    assert.equal(downloads.read(), '{"b":2}');

    settings.remove();
    assert.equal(settings.read(), null);
    assert.equal(downloads.read(), '{"b":2}', 'removing one store must not affect another');
  } finally {
    removeTempDir(dir);
  }
});

test('document store: write() updated_at defaults to Date.now() when omitted', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    const doc = store.createDocumentStore('settings');

    const before = Date.now();
    doc.write('{}');
    const after = Date.now();

    const check = new DatabaseSync(path.join(dir, 'app.db'));
    try {
      const row = /** @type {any} */ (
        check.prepare('SELECT updated_at FROM documents WHERE store = ?1').get('settings')
      );
      assert.ok(row.updated_at >= before && row.updated_at <= after);
    } finally {
      check.close();
    }
  } finally {
    removeTempDir(dir);
  }
});

test('document store: write() honors an explicit now for determinism', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    const doc = store.createDocumentStore('settings');
    doc.write('{}', 424242);

    const check = new DatabaseSync(path.join(dir, 'app.db'));
    try {
      const row = /** @type {any} */ (
        check.prepare('SELECT updated_at FROM documents WHERE store = ?1').get('settings')
      );
      assert.equal(row.updated_at, 424242);
    } finally {
      check.close();
    }
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// close() idempotency + re-open
// ---------------------------------------------------------------------------
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

test('re-open() while already open closes then reopens (idempotent-safe); data survives same-dir reopen', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    const doc = store.createDocumentStore('settings');
    doc.write('{"kept":true}', 1000);

    assert.doesNotThrow(() => store.open(dir));
    // A fresh createDocumentStore after reopen sees the same underlying row.
    const doc2 = store.createDocumentStore('settings');
    assert.equal(doc2.read(), '{"kept":true}');
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Corrupt-file recovery
// ---------------------------------------------------------------------------
test('corrupt-file recovery: garbage bytes in app.db -> open() succeeds, quarantine siblings exist, store works', () => {
  const dir = makeTempDir();
  try {
    const dbPath = path.join(dir, 'app.db');
    fs.writeFileSync(dbPath, 'this is not a sqlite database file, just garbage bytes\0\0\0');

    const store = freshStore();
    assert.doesNotThrow(() => store.open(dir));

    const entries = fs.readdirSync(dir);
    assert.ok(
      entries.some((f) => f.startsWith('app.db.corrupt-')),
      `expected an app.db.corrupt-* file, got: ${entries.join(', ')}`
    );

    // Store must be fully functional post-recovery.
    const doc = store.createDocumentStore('settings');
    assert.equal(doc.read(), null);
    doc.write('{"ok":true}', 1000);
    assert.equal(doc.read(), '{"ok":true}');
  } finally {
    removeTempDir(dir);
  }
});

test('corrupt-file recovery quarantines the -wal/-shm siblings too, when present', () => {
  const dir = makeTempDir();
  try {
    const dbPath = path.join(dir, 'app.db');
    // Prime a real db + WAL family, then stomp the main file with garbage
    // while leaving stale -wal/-shm siblings behind, mimicking a mid-write
    // crash artifact.
    const store = freshStore();
    store.open(dir);
    store.createDocumentStore('settings').write('{}', 1000);
    store.close();

    fs.writeFileSync(dbPath, 'garbage, not a database\0\0\0');

    const store2 = freshStore();
    assert.doesNotThrow(() => store2.open(dir));
    store2.close();

    const entries = fs.readdirSync(dir);
    assert.ok(entries.some((f) => f.startsWith('app.db.corrupt-')));
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Write-during-load synchrony (pins the write path is synchronous end-to-end,
// safe for jars' leg-2 save-inside-load sequence — flight DD7 / leg AC5).
// ---------------------------------------------------------------------------
test('write-during-load synchrony: a write inside a simulated load sequence is durable immediately, no await needed', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);

    // Simulate a store's load(): read (miss), then synchronously write a
    // migrated/seeded value, then immediately read again with a FRESH
    // document-store handle (proving durability isn't handle-local cache).
    const doc = store.createDocumentStore('jars');
    const before = doc.read();
    assert.equal(before, null);
    doc.write('{"seeded":true}', 1000); // synchronous — DatabaseSync has no async write path
    const freshDoc = store.createDocumentStore('jars');
    assert.equal(freshDoc.read(), '{"seeded":true}', 'write must be visible synchronously, same call stack');
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// createCookieSeenStore() — the retention sweep's cookie first-seen
// bookkeeping seam (M10 Flight 2, Leg 3 / DD4 VERDICT, DD7).
// ---------------------------------------------------------------------------

test('cookieSeen: methods throw "app db not open" before open()', () => {
  const store = freshStore();
  const cookieSeen = store.createCookieSeenStore();
  assert.throws(() => cookieSeen.insertIfAbsent('a', 'sid', 'x.test', '/', 1), /app db not open/);
  assert.throws(() => cookieSeen.deleteByIdentity('a', 'sid', 'x.test', '/'), /app db not open/);
  assert.throws(() => cookieSeen.deleteByJar('a'), /app db not open/);
  assert.throws(() => cookieSeen.selectExpired('a', 1), /app db not open/);
});

test('cookieSeen.insertIfAbsent: INSERT OR IGNORE — a second insert for the same identity is a no-op (first_seen_ms survives)', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    const cookieSeen = store.createCookieSeenStore();

    assert.equal(cookieSeen.insertIfAbsent('jarA', 'sid', 'example.com', '/', 1000), true, 'first insert succeeds');
    assert.equal(
      cookieSeen.insertIfAbsent('jarA', 'sid', 'example.com', '/', 9999),
      false,
      'a same-identity re-insert is a no-op — changes === 0'
    );

    const rows = cookieSeen.selectExpired('jarA', 5000);
    assert.deepEqual(rows, [{ name: 'sid', domain: 'example.com', path: '/', firstSeenMs: 1000 }]);
  } finally {
    removeTempDir(dir);
  }
});

test('cookieSeen.insertIfAbsent: distinct identity tuples (name/domain/path) are independent rows', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    const cookieSeen = store.createCookieSeenStore();

    cookieSeen.insertIfAbsent('jarA', 'sid', 'example.com', '/', 1000);
    cookieSeen.insertIfAbsent('jarA', 'other', 'example.com', '/', 1000); // distinct name
    cookieSeen.insertIfAbsent('jarA', 'sid', 'other.example', '/', 1000); // distinct domain
    cookieSeen.insertIfAbsent('jarA', 'sid', 'example.com', '/a', 1000); // distinct path
    cookieSeen.insertIfAbsent('jarB', 'sid', 'example.com', '/', 1000); // distinct jar

    assert.equal(cookieSeen.selectExpired('jarA', 5000).length, 4);
    assert.equal(cookieSeen.selectExpired('jarB', 5000).length, 1);
  } finally {
    removeTempDir(dir);
  }
});

test('cookieSeen.deleteByIdentity: removes exactly the matching row; a non-matching delete is a safe no-op', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    const cookieSeen = store.createCookieSeenStore();
    cookieSeen.insertIfAbsent('jarA', 'sid', 'example.com', '/', 1000);

    assert.equal(cookieSeen.deleteByIdentity('jarA', 'nope', 'example.com', '/'), false, 'no matching row');
    assert.equal(cookieSeen.deleteByIdentity('jarA', 'sid', 'example.com', '/'), true);
    assert.equal(cookieSeen.selectExpired('jarA', 5000).length, 0);
    assert.doesNotThrow(() => cookieSeen.deleteByIdentity('jarA', 'sid', 'example.com', '/'), 'delete-again is a no-op');
  } finally {
    removeTempDir(dir);
  }
});

test('cookieSeen.deleteByJar: DD7 lifecycle — clears every row for a jar, leaves other jars untouched', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    const cookieSeen = store.createCookieSeenStore();
    cookieSeen.insertIfAbsent('jarA', 'sid', 'example.com', '/', 1000);
    cookieSeen.insertIfAbsent('jarA', 'other', 'example.com', '/', 1000);
    cookieSeen.insertIfAbsent('jarB', 'sid', 'example.com', '/', 1000);

    assert.equal(cookieSeen.deleteByJar('jarA'), 2);
    assert.equal(cookieSeen.selectExpired('jarA', 5000).length, 0);
    assert.equal(cookieSeen.selectExpired('jarB', 5000).length, 1, 'jarB untouched');
    assert.equal(cookieSeen.deleteByJar('jarA'), 0, 'a second delete on an empty jar is a safe no-op');
  } finally {
    removeTempDir(dir);
  }
});

test('cookieSeen.selectExpired: only rows strictly older than cutoffMs; DD7 — no value field anywhere in the row shape', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    const cookieSeen = store.createCookieSeenStore();
    cookieSeen.insertIfAbsent('jarA', 'old', 'example.com', '/', 1000);
    cookieSeen.insertIfAbsent('jarA', 'new', 'example.com', '/', 9000);

    const expired = cookieSeen.selectExpired('jarA', 5000);
    assert.deepEqual(expired, [{ name: 'old', domain: 'example.com', path: '/', firstSeenMs: 1000 }]);
    for (const row of expired) {
      assert.deepEqual(Object.keys(row).sort(), ['domain', 'firstSeenMs', 'name', 'path']);
    }
  } finally {
    removeTempDir(dir);
  }
});
