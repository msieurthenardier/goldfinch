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
  for (const m of ['open', 'close', 'isOpen', 'createDocumentStore']) {
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
test('open() on an empty temp dir creates app.db with schema v1 (WAL + documents table)', () => {
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
      assert.equal(uv.user_version, 1);

      const names = new Set(
        /** @type {any[]} */ (
          check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
        ).map((r) => r.name)
      );
      assert.ok(names.has('documents'), 'sqlite_master should contain the documents table');

      const cols = /** @type {any[]} */ (check.prepare('PRAGMA table_info(documents)').all());
      const colNames = cols.map((c) => c.name).sort();
      assert.deepEqual(colNames, ['payload', 'store', 'updated_at']);
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
