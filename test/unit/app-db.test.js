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
test('open(userDataPath, { memory: true }) creates a current in-memory schema without filesystem artifacts', () => {
  const parent = makeTempDir();
  const absentUserData = path.join(parent, 'must-not-be-created');
  try {
    const store = freshStore();
    store.open(absentUserData, { memory: true });
    assert.equal(store.isOpen(), true);
    assert.equal(fs.existsSync(absentUserData), false, 'memory mode must skip userData directory creation');

    const doc = store.createDocumentStore('jars');
    doc.write('{"version":2}', 1000);
    assert.equal(doc.read(), '{"version":2}', 'the v2 documents table is available in memory');

    const cookieSeen = store.createCookieSeenStore();
    assert.equal(cookieSeen.insertIfAbsent('personal', 'sid', 'example.com', '/', 2000), true);
    assert.deepEqual(cookieSeen.selectExpired('personal', 3000), [
      { name: 'sid', domain: 'example.com', path: '/', firstSeenMs: 2000 }
    ]);

    // Existing reopen semantics still apply: open() closes the current handle
    // before opening a fresh one, and close() remains idempotent.
    store.open(absentUserData, { memory: true });
    assert.equal(store.createDocumentStore('jars').read(), null, 'reopen receives a fresh in-memory database');
    assert.doesNotThrow(() => store.close());
    assert.doesNotThrow(() => store.close());
    assert.equal(store.isOpen(), false);
    assert.equal(fs.existsSync(absentUserData), false, 'memory mode must leave no database family behind');
  } finally {
    removeTempDir(parent);
  }
});

test('open() on an empty temp dir creates app.db at user_version=3 with ALL THREE tables (M15 F2 Leg 2 ladder)', () => {
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
      assert.equal(uv.user_version, 3, 'a fresh profile lands directly on CURRENT_VERSION, never pausing mid-ladder');

      const names = new Set(
        /** @type {any[]} */ (check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).map(
          (r) => r.name
        )
      );
      assert.ok(names.has('documents'), 'sqlite_master should contain the documents table');
      assert.ok(names.has('cookie_seen'), 'sqlite_master should contain the cookie_seen table');
      assert.ok(names.has('bookmarks'), 'sqlite_master should contain the bookmarks table');

      const cols = /** @type {any[]} */ (check.prepare('PRAGMA table_info(documents)').all());
      const colNames = cols.map((c) => c.name).sort();
      assert.deepEqual(colNames, ['payload', 'store', 'updated_at']);

      const cookieCols = /** @type {any[]} */ (check.prepare('PRAGMA table_info(cookie_seen)').all());
      const cookieColNames = cookieCols.map((c) => c.name).sort();
      assert.deepEqual(cookieColNames, ['domain', 'first_seen_ms', 'jar_id', 'name', 'path']);

      const bookmarkCols = /** @type {any[]} */ (check.prepare('PRAGMA table_info(bookmarks)').all());
      const bookmarkColNames = bookmarkCols.map((c) => c.name).sort();
      assert.deepEqual(bookmarkColNames, ['added_at', 'icon', 'id', 'jar_id', 'position', 'title', 'url']);

      const indexes = new Set(
        /** @type {any[]} */ (check.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all()).map(
          (r) => r.name
        )
      );
      assert.ok(indexes.has('bookmarks_jar_pos'), 'bookmarks_jar_pos index should exist');
      assert.ok(indexes.has('bookmarks_jar_url'), 'bookmarks_jar_url unique index should exist');
    } finally {
      check.close();
    }
    store.close();
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// user_version ladder (M10 Flight 2, Leg 3 / DD4 VERDICT; extended M15 F2 Leg
// 2 / L2-DD-A/B2 to v3 and to per-step transactions).
// ---------------------------------------------------------------------------
test('ladder: a hand-crafted v1 fixture (documents rows present, no cookie_seen/bookmarks tables) steps to v3, preserving every row', () => {
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
    seed.exec('CREATE TABLE documents (store TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)');
    seed.exec('PRAGMA user_version = 1');
    seed
      .prepare('INSERT INTO documents (store, payload, updated_at) VALUES (?, ?, ?)')
      .run('settings', '{"a":1}', 1000);
    seed.prepare('INSERT INTO documents (store, payload, updated_at) VALUES (?, ?, ?)').run('jars', '{"b":2}', 2000);
    seed.close();

    const store = freshStore();
    assert.doesNotThrow(() => store.open(dir));

    const check = new DatabaseSync(dbPath);
    try {
      const uv = /** @type {any} */ (check.prepare('PRAGMA user_version').get());
      assert.equal(uv.user_version, 3);

      const names = new Set(
        /** @type {any[]} */ (check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).map(
          (r) => r.name
        )
      );
      assert.ok(names.has('cookie_seen'), 'the v1->v2 step must create cookie_seen');
      assert.ok(names.has('bookmarks'), 'the v2->v3 step must create bookmarks');

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

    // Store must be fully functional post-ladder, including the new tables.
    const doc = store.createDocumentStore('settings');
    assert.equal(doc.read(), '{"a":1}', 'the pre-existing row is readable through the live store post-ladder');
    const cookieSeen = store.createCookieSeenStore();
    assert.doesNotThrow(() => cookieSeen.insertIfAbsent('jarA', 'sid', 'example.com', '/', 5000));
    const bookmarks = store.createBookmarksStore();
    assert.doesNotThrow(() =>
      bookmarks.insert({
        id: 'bm-1',
        jarId: 'jarA',
        url: 'https://example.com/',
        title: 'T',
        icon: null,
        position: 0,
        addedAt: 1
      })
    );
    store.close();
  } finally {
    removeTempDir(dir);
  }
});

test('ladder: a hand-crafted v2 fixture (cookie_seen present, no bookmarks table) steps to v3 alone, deleting any legacy bookmarks documents row', () => {
  const dir = makeTempDir();
  try {
    const dbPath = path.join(dir, 'app.db');
    const seed = new DatabaseSync(dbPath);
    seed.exec('CREATE TABLE documents (store TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)');
    seed.exec(
      'CREATE TABLE cookie_seen (jar_id TEXT NOT NULL, name TEXT NOT NULL, domain TEXT NOT NULL, path TEXT NOT NULL, first_seen_ms INTEGER NOT NULL, PRIMARY KEY (jar_id, name, domain, path))'
    );
    seed
      .prepare('INSERT INTO documents (store, payload, updated_at) VALUES (?, ?, ?)')
      .run('bookmarks', '{"version":1,"bookmarks":[{"id":"legacy","url":"https://legacy.example/"}]}', 1000);
    seed.prepare('INSERT INTO documents (store, payload, updated_at) VALUES (?, ?, ?)').run('settings', '{}', 1000);
    seed.exec('PRAGMA user_version = 2');
    seed.close();

    const store = freshStore();
    assert.doesNotThrow(() => store.open(dir));

    const check = new DatabaseSync(dbPath);
    try {
      const uv = /** @type {any} */ (check.prepare('PRAGMA user_version').get());
      assert.equal(uv.user_version, 3);
      const legacyRow = check.prepare("SELECT * FROM documents WHERE store = 'bookmarks'").get();
      assert.equal(legacyRow, undefined, 'DD10 clean-slate migration: the legacy bookmarks documents row is gone');
      const settingsRow = check.prepare("SELECT * FROM documents WHERE store = 'settings'").get();
      assert.notEqual(settingsRow, undefined, 'a sibling documents row must survive the v3 step untouched');
    } finally {
      check.close();
    }
    store.close();
  } finally {
    removeTempDir(dir);
  }
});

test('ladder: an already-v3 file re-opens as a no-op (no re-create, no data loss)', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    store.createDocumentStore('settings').write('{"kept":true}', 1000);
    store.createCookieSeenStore().insertIfAbsent('jarA', 'sid', 'example.com', '/', 5000);
    store.createBookmarksStore().insert({
      id: 'bm-1',
      jarId: 'jarA',
      url: 'https://example.com/',
      title: 'T',
      icon: null,
      position: 0,
      addedAt: 1
    });
    store.close();

    const store2 = freshStore();
    assert.doesNotThrow(() => store2.open(dir));
    assert.equal(store2.createDocumentStore('settings').read(), '{"kept":true}');
    const expired = store2.createCookieSeenStore().selectExpired('jarA', 10000);
    assert.equal(expired.length, 1, 'the cookie_seen row survives an already-current reopen');
    assert.equal(store2.createBookmarksStore().listByJar('jarA').length, 1, 'the bookmarks row survives too');

    const check = new DatabaseSync(path.join(dir, 'app.db'));
    try {
      const uv = /** @type {any} */ (check.prepare('PRAGMA user_version').get());
      assert.equal(uv.user_version, 3);
    } finally {
      check.close();
    }
    store2.close();
  } finally {
    removeTempDir(dir);
  }
});

test('ladder: corrupt file still quarantines unchanged and recreates fresh at v3', () => {
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
      assert.equal(uv.user_version, 3);
      const names = new Set(
        /** @type {any[]} */ (check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).map(
          (r) => r.name
        )
      );
      assert.ok(names.has('documents') && names.has('cookie_seen') && names.has('bookmarks'));
    } finally {
      check.close();
    }
    store.close();
  } finally {
    removeTempDir(dir);
  }
});

test('ladder: in-memory mode ({ memory: true }) also runs the ladder from 0 straight to v3', () => {
  const store = freshStore();
  store.open('', { memory: true });
  store.createDocumentStore('settings').write('{}', 1); // exercise the doc store post-ladder
  // Bookmarks factory must be fully live in memory mode too (leg Edge Case).
  const bookmarks = store.createBookmarksStore();
  bookmarks.insert({
    id: 'bm-1',
    jarId: 'jarA',
    url: 'https://example.com/',
    title: 'T',
    icon: null,
    position: 0,
    addedAt: 1
  });
  assert.equal(bookmarks.listByJar('jarA').length, 1);
  store.close();
});

// ---------------------------------------------------------------------------
// L2-DD-B2: each ladder step commits its OWN user_version bump, atomically
// with its DDL — a step-N failure must leave the file durably at N-1 (never
// a stuck-at-old-version-with-partial-DDL brick), and the NEXT open must
// resume from N-1, retrying only the failed step.
// ---------------------------------------------------------------------------
test('ladder step-failure resume: a v2 file whose v3 step fails (pre-seeded conflicting bookmarks table) stays at v2 and is NOT quarantined; a later open with the collision removed resumes and completes to v3', () => {
  const dir = makeTempDir();
  try {
    const dbPath = path.join(dir, 'app.db');
    const seed = new DatabaseSync(dbPath);
    seed.exec('CREATE TABLE documents (store TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)');
    seed.exec(
      'CREATE TABLE cookie_seen (jar_id TEXT NOT NULL, name TEXT NOT NULL, domain TEXT NOT NULL, path TEXT NOT NULL, first_seen_ms INTEGER NOT NULL, PRIMARY KEY (jar_id, name, domain, path))'
    );
    // A pre-existing, non-corrupt, incompatible `bookmarks` table — the v3
    // step's CREATE TABLE collides (errcode 1, SQLITE_ERROR — not 11/26).
    seed.exec('CREATE TABLE bookmarks (nope TEXT)');
    seed
      .prepare('INSERT INTO documents (store, payload, updated_at) VALUES (?, ?, ?)')
      .run('settings', '{"kept":true}', 1000);
    seed.exec('PRAGMA user_version = 2');
    seed.close();

    const store = freshStore();
    assert.throws(
      () => store.open(dir),
      (err) => {
        assert.equal(
          /** @type {any} */ (err).appDbMigrationFailure,
          true,
          'a non-corruption ladder throw must be tagged'
        );
        return true;
      }
    );
    assert.equal(store.isOpen(), false, 'a propagated migration failure must leave the store closed');

    const entries = fs.readdirSync(dir);
    assert.ok(
      entries.every((f) => !f.startsWith('app.db.corrupt-')),
      'a migration-step bug must NOT quarantine a healthy file'
    );

    const check = new DatabaseSync(dbPath);
    try {
      const uv = /** @type {any} */ (check.prepare('PRAGMA user_version').get());
      assert.equal(uv.user_version, 2, 'the file stays durably at its last committed version');
      const settingsRow = /** @type {any} */ (
        check.prepare("SELECT payload FROM documents WHERE store = 'settings'").get()
      );
      assert.equal(settingsRow.payload, '{"kept":true}', 'sibling data is untouched by the rolled-back step');
    } finally {
      check.close();
    }

    // Remove the collision (simulating an operator/patch fix) and re-open —
    // the NEXT open must resume from v2 and complete the v3 step, not
    // re-run v1/v2 into their own "already exists" errors.
    const fix = new DatabaseSync(dbPath);
    fix.exec('DROP TABLE bookmarks');
    fix.close();

    assert.doesNotThrow(() => store.open(dir));
    const check2 = new DatabaseSync(dbPath);
    try {
      const uv2 = /** @type {any} */ (check2.prepare('PRAGMA user_version').get());
      assert.equal(uv2.user_version, 3, 'the retried step completes and the ladder resumes to CURRENT_VERSION');
    } finally {
      check2.close();
    }
    store.close();
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// L2-DD-B: migration-failure distinguishability — classification is by
// err.errcode (11 SQLITE_CORRUPT / 26 SQLITE_NOTADB), never err.code, which
// is the literal string 'ERR_SQLITE_ERROR' for EVERY SQLite-thrown error.
// ---------------------------------------------------------------------------
test('errcode pin: a garbage-bytes ("not a database") file throws errcode 26 and IS quarantined', () => {
  const dir = makeTempDir();
  try {
    const dbPath = path.join(dir, 'app.db');
    fs.writeFileSync(dbPath, 'this is not a sqlite database file, just garbage bytes\0\0\0');

    // Probe the raw error node:sqlite currently throws for this exact byte
    // shape, independent of app-db.js's own catch/quarantine (a fresh
    // DatabaseSync against the same bytes) — the literal pin.
    const probe = new DatabaseSync(dbPath);
    assert.throws(
      () => probe.exec('PRAGMA journal_mode = WAL'),
      (err) => {
        assert.equal(/** @type {any} */ (err).errcode, 26);
        assert.equal(/** @type {any} */ (err).code, 'ERR_SQLITE_ERROR', 'err.code is useless for classification');
        return true;
      }
    );

    const store = freshStore();
    assert.doesNotThrow(() => store.open(dir));
    const entries = fs.readdirSync(dir);
    assert.ok(
      entries.some((f) => f.startsWith('app.db.corrupt-')),
      'errcode 26 is corruption-class — quarantines'
    );
    store.close();
  } finally {
    removeTempDir(dir);
  }
});

test('errcode pin: an inflated header page-count ("disk image is malformed") file throws errcode 11 and IS quarantined', () => {
  const dir = makeTempDir();
  try {
    const dbPath = path.join(dir, 'app.db');
    const seed = new DatabaseSync(dbPath);
    seed.exec('CREATE TABLE documents (store TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)');
    seed.close();
    // Header offset 28 (big-endian uint32) is "size of the database file in
    // pages" — inflating it past the real file size deterministically
    // produces SQLITE_CORRUPT (empirically probed this session; flipping
    // interior data-page bytes did not reproduce errcode 11 reliably —
    // Implementation Guidance #9's accepted fallback was not needed).
    const buf = fs.readFileSync(dbPath);
    buf.writeUInt32BE(999999, 28);
    fs.writeFileSync(dbPath, buf);

    const probe = new DatabaseSync(dbPath);
    assert.throws(
      () => probe.exec('PRAGMA journal_mode = WAL'),
      (err) => {
        assert.equal(/** @type {any} */ (err).errcode, 11);
        assert.equal(/** @type {any} */ (err).code, 'ERR_SQLITE_ERROR');
        return true;
      }
    );

    const store = freshStore();
    assert.doesNotThrow(() => store.open(dir));
    const entries = fs.readdirSync(dir);
    assert.ok(
      entries.some((f) => f.startsWith('app.db.corrupt-')),
      'errcode 11 is corruption-class — quarantines'
    );
    store.close();
  } finally {
    removeTempDir(dir);
  }
});

test('classification predicate: a table-collision-shaped error (errcode 1) is tagged, not treated as corruption', () => {
  const inner = new DatabaseSync(':memory:');
  inner.exec('CREATE TABLE bookmarks (x TEXT)');
  let caught;
  try {
    inner.exec('CREATE TABLE bookmarks (x TEXT)');
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'the collision must throw');
  assert.equal(
    /** @type {any} */ (caught).errcode,
    1,
    'errcode 1 (SQLITE_ERROR) is not in the corruption set {11, 26}'
  );
  inner.close();
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
    assert.doesNotThrow(
      () => cookieSeen.deleteByIdentity('jarA', 'sid', 'example.com', '/'),
      'delete-again is a no-op'
    );
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

// ---------------------------------------------------------------------------
// createBookmarksStore() — the SQL-level seam for the jar-keyed `bookmarks`
// table (M15 F2 Leg 2 / flight DD1-DD3, leg L2-DD-A/C).
// ---------------------------------------------------------------------------

function makeRow(overrides = {}) {
  return {
    id: 'bm-1',
    jarId: 'jarA',
    url: 'https://example.com/',
    title: 'Example',
    icon: null,
    position: 0,
    addedAt: 1000,
    ...overrides
  };
}

test('bookmarks: methods throw "app db not open" before open()', () => {
  const store = freshStore();
  const bookmarks = store.createBookmarksStore();
  assert.throws(() => bookmarks.listByJar('jarA'), /app db not open/);
  assert.throws(() => bookmarks.findById('jarA', 'bm-1'), /app db not open/);
  assert.throws(() => bookmarks.findByUrl('jarA', 'https://x/'), /app db not open/);
  assert.throws(() => bookmarks.countByJar('jarA'), /app db not open/);
  assert.throws(() => bookmarks.insert(makeRow()), /app db not open/);
  assert.throws(
    () => bookmarks.update('jarA', 'bm-1', { url: 'https://x/', title: null, icon: null }),
    /app db not open/
  );
  assert.throws(() => bookmarks.remove('jarA', 'bm-1'), /app db not open/);
  assert.throws(() => bookmarks.reorderPositions('jarA', ['bm-1']), /app db not open/);
  assert.throws(() => bookmarks.clearJar('jarA'), /app db not open/);
});

test('bookmarks.listByJar: position-ordered (DD2), independent per jar', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    const b = store.createBookmarksStore();
    b.insert(makeRow({ id: 'a', url: 'https://a.example/', position: 1 }));
    b.insert(makeRow({ id: 'b', url: 'https://b.example/', position: 0 }));
    b.insert(makeRow({ id: 'other-jar', jarId: 'jarB', url: 'https://a.example/', position: 0 }));

    assert.deepEqual(
      b.listByJar('jarA').map((r) => r.id),
      ['b', 'a'],
      'ORDER BY position ASC'
    );
    assert.deepEqual(
      b.listByJar('jarB').map((r) => r.id),
      ['other-jar']
    );
    assert.deepEqual(b.listByJar('unknown-jar'), []);
    store.close();
  } finally {
    removeTempDir(dir);
  }
});

test('bookmarks: the (jar_id, url) unique index permits the SAME url in DIFFERENT jars but rejects it twice in ONE jar', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    const b = store.createBookmarksStore();
    b.insert(makeRow({ id: 'a', jarId: 'jarA', url: 'https://same.example/' }));
    assert.doesNotThrow(
      () => b.insert(makeRow({ id: 'b', jarId: 'jarB', url: 'https://same.example/' })),
      "same url, different jar is legal — the feature's core claim"
    );
    assert.throws(
      () => b.insert(makeRow({ id: 'c', jarId: 'jarA', url: 'https://same.example/', position: 1 })),
      'same url, same jar violates the unique index'
    );
    store.close();
  } finally {
    removeTempDir(dir);
  }
});

test('bookmarks.findById / findByUrl: jar-scoped — the id/url alone never authorizes a cross-jar read', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    const b = store.createBookmarksStore();
    b.insert(makeRow({ id: 'a', jarId: 'jarA', url: 'https://a.example/' }));
    assert.equal(b.findById('jarA', 'a').id, 'a');
    assert.equal(b.findById('jarB', 'a'), null, 'wrong jar — not found even though the id exists');
    assert.equal(b.findByUrl('jarA', 'https://a.example/').id, 'a');
    assert.equal(b.findByUrl('jarB', 'https://a.example/'), null);
    store.close();
  } finally {
    removeTempDir(dir);
  }
});

test("bookmarks.countByJar counts only that jar's rows", () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    const b = store.createBookmarksStore();
    b.insert(makeRow({ id: 'a', jarId: 'jarA', url: 'https://a.example/' }));
    b.insert(makeRow({ id: 'b', jarId: 'jarA', url: 'https://b.example/', position: 1 }));
    b.insert(makeRow({ id: 'c', jarId: 'jarB', url: 'https://c.example/' }));
    assert.equal(b.countByJar('jarA'), 2);
    assert.equal(b.countByJar('jarB'), 1);
    assert.equal(b.countByJar('jarC'), 0);
    store.close();
  } finally {
    removeTempDir(dir);
  }
});

test('bookmarks.update: rewrites url/title/icon for the jar-scoped row; a wrong-jar update is a no-op (changes:false)', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    const b = store.createBookmarksStore();
    b.insert(makeRow({ id: 'a', jarId: 'jarA', url: 'https://a.example/', title: 'Old', icon: null }));
    assert.equal(
      b.update('jarA', 'a', { url: 'https://a.example/', title: 'New', icon: 'data:image/png;base64,X' }),
      true
    );
    const row = b.findById('jarA', 'a');
    assert.equal(row.title, 'New');
    assert.equal(row.icon, 'data:image/png;base64,X');
    assert.equal(
      b.update('jarB', 'a', { url: 'https://a.example/', title: 'Nope', icon: null }),
      false,
      'wrong jar — no row matched'
    );
  } finally {
    removeTempDir(dir);
  }
});

test('bookmarks.remove: deletes the jar-scoped row; a wrong-jar remove is a no-op (changes:false)', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    const b = store.createBookmarksStore();
    b.insert(makeRow({ id: 'a', jarId: 'jarA' }));
    assert.equal(b.remove('jarB', 'a'), false, 'wrong jar — not removed');
    assert.equal(b.findById('jarA', 'a').id, 'a', 'still present');
    assert.equal(b.remove('jarA', 'a'), true);
    assert.equal(b.findById('jarA', 'a'), null);
  } finally {
    removeTempDir(dir);
  }
});

test('bookmarks.reorderPositions: rewrites positions in ONE transaction (L2-DD-A) — position 0..n-1 for the given order', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    const b = store.createBookmarksStore();
    b.insert(makeRow({ id: 'a', jarId: 'jarA', url: 'https://a.example/', position: 0 }));
    b.insert(makeRow({ id: 'b', jarId: 'jarA', url: 'https://b.example/', position: 1 }));
    b.insert(makeRow({ id: 'c', jarId: 'jarA', url: 'https://c.example/', position: 2 }));
    b.reorderPositions('jarA', ['c', 'a', 'b']);
    const rows = b.listByJar('jarA');
    assert.deepEqual(
      rows.map((r) => r.id),
      ['c', 'a', 'b']
    );
    assert.deepEqual(
      rows.map((r) => r.position),
      [0, 1, 2],
      'gap-free 0..n-1'
    );
    store.close();
  } finally {
    removeTempDir(dir);
  }
});

test('bookmarks.reorderPositions: a mid-rewrite throw rolls back — no partial rewrite survives, and the handle stays usable afterward', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    const b = store.createBookmarksStore();
    b.insert(makeRow({ id: 'a', jarId: 'jarA', url: 'https://a.example/', position: 0 }));
    b.insert(makeRow({ id: 'b', jarId: 'jarA', url: 'https://b.example/', position: 1 }));
    b.insert(makeRow({ id: 'c', jarId: 'jarA', url: 'https://c.example/', position: 2 }));

    // The THIRD id is a non-bindable value (an object) — node:sqlite throws
    // binding it, mid-loop, after 'b' has already been rewritten to
    // position 0 inside the transaction. L2-DD-A: the whole rewrite must
    // roll back, so 'b' must NOT be left at position 0.
    assert.throws(() => b.reorderPositions('jarA', ['b', 'a', /** @type {any} */ ({ not: 'a valid id' })]));

    const rows = b.listByJar('jarA');
    assert.deepEqual(
      rows.map((r) => ({ id: r.id, position: r.position })),
      [
        { id: 'a', position: 0 },
        { id: 'b', position: 1 },
        { id: 'c', position: 2 }
      ],
      'ROLLBACK must undo the partial rewrite entirely — original positions survive'
    );
    // The handle must remain usable after the rollback (the ROLLBACK
    // itself must not throw and mask/wedge anything — round-2 review note).
    assert.doesNotThrow(() => b.clearJar('jarA'));
    store.close();
  } finally {
    removeTempDir(dir);
  }
});

test('bookmarks.clearJar: DD9 lifecycle — clears every row for a jar, leaves other jars untouched, returns the deleted count', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.open(dir);
    const b = store.createBookmarksStore();
    b.insert(makeRow({ id: 'a', jarId: 'jarA', url: 'https://a.example/' }));
    b.insert(makeRow({ id: 'b', jarId: 'jarA', url: 'https://b.example/', position: 1 }));
    b.insert(makeRow({ id: 'c', jarId: 'jarB', url: 'https://c.example/' }));

    assert.equal(b.clearJar('jarA'), 2);
    assert.deepEqual(b.listByJar('jarA'), []);
    assert.equal(b.listByJar('jarB').length, 1, 'jarB untouched');
    assert.equal(b.clearJar('jarA'), 0, 'a second clear on an empty jar is a safe no-op');
    store.close();
  } finally {
    removeTempDir(dir);
  }
});
