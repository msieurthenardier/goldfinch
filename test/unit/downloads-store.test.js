'use strict';

// Unit tests for src/main/downloads-store.js
//
// No Electron stub needed — the module is Electron-free (no require('electron'),
// no app.getPath at module scope). The userData path is injected via load().
//
// The store is a MODULE-SCOPED SINGLETON (like settings-store), so we re-require it
// fresh per test (cache-bust) to stop dir/nextId/records leaking across tests, and
// use a real temp dir. downloads-store now persists through app-db.js's document-row
// seam (flight 10-1 DD2-DD4): app-db is required ONCE for the whole file (never
// cache-busted — see settings-store.test.js header for the require-order-hazard
// rationale) and reset per test via appDb.open(dir).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const appDb = require('../../src/main/app-db');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-downloads-'));
}

function removeTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Read the raw 'downloads' document row payload directly off app.db, bypassing
// the store.
function readRow(dir) {
  const check = new DatabaseSync(path.join(dir, 'app.db'));
  try {
    const row = /** @type {any} */ (
      check.prepare('SELECT payload FROM documents WHERE store = ?1').get('downloads')
    );
    return row ? row.payload : null;
  } finally {
    check.close();
  }
}

function freshStore() {
  const resolved = require.resolve('../../src/main/downloads-store');
  delete require.cache[resolved];
  return require('../../src/main/downloads-store');
}

// A minimal valid terminal record factory.
function rec(id, over = {}) {
  return {
    id,
    url: `https://example.com/file-${id}`,
    filename: `file-${id}.bin`,
    savePath: `/dl/file-${id}.bin`,
    state: 'completed',
    received: 100,
    total: 100,
    startTime: 1000,
    endTime: 2000,
    ...over
  };
}

// ---------------------------------------------------------------------------
// Interface + empty defaults
// ---------------------------------------------------------------------------
test('exposes exactly the repo interface', () => {
  const store = freshStore();
  for (const m of ['load', 'list', 'append', 'remove', 'clear', 'getNextId']) {
    assert.equal(typeof store[m], 'function', `${m} should be a function`);
  }
});

test('first load (no downloads.json) → empty list, nextId starts at 1', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    assert.deepEqual(store.list(), []);
    assert.equal(store.getNextId(), 1);
    assert.equal(store.getNextId(), 2);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// append → persist → reload round-trip
// ---------------------------------------------------------------------------
test('append persists and reloads', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    let store = freshStore();
    store.load(dir);
    store.append(rec(1));
    store.append(rec(2, { state: 'cancelled' }));

    store = freshStore();
    store.load(dir);
    const all = store.list();
    assert.equal(all.length, 2);
    assert.equal(all[0].id, 1);
    assert.equal(all[1].id, 2);
    assert.equal(all[1].state, 'cancelled');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Atomic write produces valid JSON of the object shape { version, nextId, records }
// ---------------------------------------------------------------------------
test('writes produce a valid object-shaped JSON row (was: "...on disk" — downloads.json is no longer the write target)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    store.getNextId(); // bumps nextId → persists
    store.append(rec(1));

    const raw = readRow(dir);
    assert.ok(raw !== null, 'downloads row should exist');
    const parsed = JSON.parse(/** @type {string} */ (raw));
    assert.equal(parsed.version, 1);
    assert.equal(typeof parsed.nextId, 'number');
    assert.ok(Array.isArray(parsed.records), 'records should be an array');
    assert.equal(parsed.records.length, 1);
    assert.ok(!fs.existsSync(path.join(dir, 'downloads.json')), 'append()/getNextId() must not write downloads.json');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// getNextId monotonicity across prune + remove (the headline AC)
// ---------------------------------------------------------------------------
test('getNextId is monotonic and never lowered by prune or remove', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);

    // Issue ids 1..600 via getNextId, appending a record for each (pruning to 500).
    for (let i = 0; i < 600; i++) {
      const id = store.getNextId();
      store.append(rec(id));
    }
    // nextId should now be 601.
    const afterIssue = store.getNextId(); // returns 601, bumps to 602
    assert.equal(afterIssue, 601, 'nextId tracks issuance, not surviving records');

    // The store pruned to the newest 500: ids 101..600 survive.
    let all = store.list();
    assert.equal(all.length, 500);
    assert.equal(all[0].id, 101);
    assert.equal(all[all.length - 1].id, 600);

    // Remove the highest remaining id (600).
    store.remove(600);
    all = store.list();
    assert.equal(all.find((r) => r.id === 600), undefined, '600 removed');

    // getNextId is STILL greater than every id ever issued (600), unaffected by prune/remove.
    const next = store.getNextId();
    assert.ok(next > 600, `next (${next}) must exceed every id ever issued (600)`);
    assert.equal(next, 602, 'nextId continued from the last bump (602), not derived from records');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('nextId survives a reload (persisted independently of records)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    let store = freshStore();
    store.load(dir);
    store.getNextId(); // 1 → 2
    store.getNextId(); // 2 → 3
    store.getNextId(); // 3 → 4
    // No records appended at all.

    store = freshStore();
    store.load(dir);
    // Persisted nextId is the authority — not max(records)+1 (records is empty).
    assert.equal(store.getNextId(), 4);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// 500-cap prune on append (drop oldest by id)
// ---------------------------------------------------------------------------
test('append clamps to the newest 500 by id (drop-oldest)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    for (let id = 1; id <= 501; id++) {
      store.append(rec(id));
    }
    const all = store.list();
    assert.equal(all.length, 500, '501st append drops the oldest');
    assert.equal(all.find((r) => r.id === 1), undefined, 'oldest (id 1) dropped');
    assert.ok(all.find((r) => r.id === 501), 'newest (id 501) kept');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('load applies the same 500-cap clamp', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    // Hand-write a file with 600 records.
    const records = [];
    for (let id = 1; id <= 600; id++) records.push(rec(id));
    fs.writeFileSync(
      path.join(dir, 'downloads.json'),
      JSON.stringify({ version: 1, nextId: 601, records }),
      'utf8'
    );
    const store = freshStore();
    store.load(dir);
    const all = store.list();
    assert.equal(all.length, 500);
    assert.equal(all[0].id, 101, 'kept the newest 500 (101..600)');
    assert.equal(all[all.length - 1].id, 600);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Per-record validator drops malformed entries on load
// ---------------------------------------------------------------------------
test('per-record validator drops malformed entries on load', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const records = [
      rec(1), // valid
      { id: 0, filename: 'x', state: 'completed' }, // non-positive id → drop
      { id: 2.5, filename: 'x', state: 'completed' }, // non-integer id → drop
      { id: 3, filename: 123, state: 'completed' }, // non-string filename → drop
      { id: 4, filename: 'x', state: 'progressing' }, // non-terminal state → drop
      { id: 5, filename: 'x' }, // missing state → drop
      null, // not an object → drop
      rec(6, { state: 'interrupted' }) // valid
    ];
    fs.writeFileSync(
      path.join(dir, 'downloads.json'),
      JSON.stringify({ version: 1, nextId: 7, records }),
      'utf8'
    );
    const store = freshStore();
    store.load(dir);
    const ids = store.list().map((r) => r.id).sort((a, b) => a - b);
    assert.deepEqual(ids, [1, 6], 'only valid terminal records survive');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Corrupt / bad-shape file → empty list, nextId reset, no throw
// ---------------------------------------------------------------------------
test('corrupt JSON → empty list, no throw', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    fs.writeFileSync(path.join(dir, 'downloads.json'), '{{not valid json!!', 'utf8');
    const store = freshStore();
    assert.doesNotThrow(() => store.load(dir));
    assert.deepEqual(store.list(), []);
    assert.equal(store.getNextId(), 1, 'nextId reset to 1 on corrupt file');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('bare-array top-level shape → empty list (object shape required)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    fs.writeFileSync(path.join(dir, 'downloads.json'), JSON.stringify([rec(1)]), 'utf8');
    const store = freshStore();
    store.load(dir);
    assert.deepEqual(store.list(), []);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('load repairs missing nextId from maxRecordId+1 (file predating the field)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    // A file with records but NO nextId field.
    fs.writeFileSync(
      path.join(dir, 'downloads.json'),
      JSON.stringify({ version: 1, records: [rec(10), rec(42)] }),
      'utf8'
    );
    const store = freshStore();
    store.load(dir);
    // nextId repaired to max(records)+1 = 43, never re-issuing a live id.
    assert.equal(store.getNextId(), 43);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// remove / clear never lower nextId
// ---------------------------------------------------------------------------
test('remove filters out the record and persists; nextId untouched', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    let store = freshStore();
    store.load(dir);
    const a = store.getNextId();
    const b = store.getNextId();
    store.append(rec(a));
    store.append(rec(b));
    store.remove(a);

    store = freshStore();
    store.load(dir);
    assert.deepEqual(store.list().map((r) => r.id), [b]);
    assert.ok(store.getNextId() > b, 'nextId never lowered by remove');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('clear empties records but keeps nextId', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    let store = freshStore();
    store.load(dir);
    store.getNextId();
    store.getNextId();
    store.getNextId(); // nextId now 4
    store.append(rec(1));
    store.append(rec(2));
    store.clear();
    assert.deepEqual(store.list(), []);

    store = freshStore();
    store.load(dir);
    assert.deepEqual(store.list(), []);
    assert.equal(store.getNextId(), 4, 'clear keeps nextId');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Codec seam (injectable serialize/deserialize)
// ---------------------------------------------------------------------------
test('custom codec round-trip (serialize/deserialize seam)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const serializeLog = [];
    const deserializeLog = [];
    const serialize = (obj) => {
      const s = 'DLCODEC:' + JSON.stringify(obj);
      serializeLog.push(s);
      return s;
    };
    const deserialize = (s) => {
      deserializeLog.push(s);
      if (!s.startsWith('DLCODEC:')) throw new Error('unexpected format');
      return JSON.parse(s.slice('DLCODEC:'.length));
    };

    let store = freshStore();
    store.load(dir, { serialize, deserialize });
    store.append(rec(1));
    assert.ok(serializeLog.length > 0, 'custom serialize used');

    store = freshStore();
    store.load(dir, { serialize, deserialize });
    assert.ok(deserializeLog.length > 0, 'custom deserialize used');
    assert.equal(store.list().length, 1);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// list() returns a copy (mutating it does not corrupt store state)
// ---------------------------------------------------------------------------
test('list returns a copy of the records array', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    store.append(rec(1));
    const snapshot = store.list();
    snapshot.push(rec(999));
    assert.equal(store.list().length, 1, 'pushing onto the snapshot does not affect the store');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// app-db integration (flight 10-1, leg 1): app-db-not-open propagation +
// legacy-JSON migration semantics (DD5).
// ---------------------------------------------------------------------------

test('load() throws when app-db is not open (mis-ordered boot must propagate, not fall back to empty)', () => {
  const dir = makeTempDir();
  try {
    // Deliberately do NOT call appDb.open(dir) — app-db starts closed.
    const store = freshStore();
    assert.throws(() => store.load(dir), /app db not open/);
  } finally {
    removeTempDir(dir);
  }
});

test('migration: legacy downloads.json is imported once, records intact, then renamed .migrated', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const legacy = { version: 1, nextId: 3, records: [rec(1), rec(2)] };
    fs.writeFileSync(path.join(dir, 'downloads.json'), JSON.stringify(legacy), 'utf8');

    const store = freshStore();
    store.load(dir);
    assert.deepEqual(store.list().map((r) => r.id), [1, 2]);
    assert.equal(store.getNextId(), 3);

    const row = readRow(dir);
    assert.ok(row !== null);
    assert.equal(JSON.parse(/** @type {string} */ (row)).records.length, 2);

    assert.ok(!fs.existsSync(path.join(dir, 'downloads.json')), 'downloads.json should be renamed away');
    assert.ok(fs.existsSync(path.join(dir, 'downloads.json.migrated')), 'downloads.json.migrated should exist');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('migration: corrupt legacy downloads.json still migrates (repaired-to-empty row + rename)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    fs.writeFileSync(path.join(dir, 'downloads.json'), '{{not valid json!!', 'utf8');

    const store = freshStore();
    store.load(dir);
    assert.deepEqual(store.list(), []);

    const row = readRow(dir);
    assert.ok(row !== null, 'the repaired-to-empty result still migrates as the row');
    assert.deepEqual(JSON.parse(/** @type {string} */ (row)).records, []);

    assert.ok(!fs.existsSync(path.join(dir, 'downloads.json')));
    assert.ok(fs.existsSync(path.join(dir, 'downloads.json.migrated')), 'the corrupt original still renames .migrated');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('migration: a present row wins over a stray legacy downloads.json (no re-import)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    store.append(rec(1));

    // Now drop a stray legacy file with DIFFERENT records — this must be ignored.
    fs.writeFileSync(
      path.join(dir, 'downloads.json'),
      JSON.stringify({ version: 1, nextId: 99, records: [rec(2), rec(3)] }),
      'utf8'
    );

    const store2 = freshStore();
    store2.load(dir);
    assert.deepEqual(store2.list().map((r) => r.id), [1], 'row wins; stray JSON is not re-imported');

    assert.ok(fs.existsSync(path.join(dir, 'downloads.json')));
    assert.ok(!fs.existsSync(path.join(dir, 'downloads.json.migrated')));
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('migration: no row, no legacy file → empty defaults, no migration side effects', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    assert.deepEqual(store.list(), []);
    assert.equal(readRow(dir), null, 'a fresh profile seeds defaults in memory only, no row write');
    assert.ok(!fs.existsSync(path.join(dir, 'downloads.json.migrated')));
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});
