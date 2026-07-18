'use strict';

// Unit tests for src/main/session-store.js (M09 Flight 9, Leg 2, DD1 / AC1-AC2) —
// the Electron-free, disk-durable session snapshot store.
//
// No Electron stub needed — the module is Electron-free (no require of the electron
// module, no app.getPath at module scope). The userData path is injected via load().
//
// The store is a MODULE-SCOPED SINGLETON (like downloads-store / settings-store), so
// we re-require it fresh per test (cache-bust) to stop dir/snapshot leaking across
// tests, and use a real temp dir (never the operator's userData path). session-store
// now persists through app-db.js's document-row seam (flight 10-1 DD2-DD4): app-db is
// required ONCE for the whole file (never cache-busted — see settings-store.test.js
// header for the require-order-hazard rationale) and reset per test via appDb.open(dir).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const appDb = require('../../src/main/app-db');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-session-'));
}

function removeTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Read the raw 'session' document row payload directly off app.db, bypassing
// the store.
function readRow(dir) {
  const check = new DatabaseSync(path.join(dir, 'app.db'));
  try {
    const row = /** @type {any} */ (
      check.prepare('SELECT payload FROM documents WHERE store = ?1').get('session')
    );
    return row ? row.payload : null;
  } finally {
    check.close();
  }
}

function freshStore() {
  const resolved = require.resolve('../../src/main/session-store');
  delete require.cache[resolved];
  return require('../../src/main/session-store');
}

const FILE = 'session.json';

// A minimal valid snapshot factory.
function snap() {
  return {
    version: 1,
    windows: [
      { tabs: [{ url: 'https://a.example/', jarId: 'work', active: true }] },
      {
        tabs: [
          { url: 'https://b.example/', jarId: 'play', active: false },
          { url: 'https://c.example/', jarId: 'work', active: true },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------
test('exposes exactly the store interface', () => {
  const store = freshStore();
  for (const m of ['load', 'read', 'write', 'clear']) {
    assert.equal(typeof store[m], 'function', `${m} should be a function`);
  }
});

// ---------------------------------------------------------------------------
// Round-trip: write → fresh load → read returns an equal snapshot
// ---------------------------------------------------------------------------
test('round-trip: write then a fresh load + read returns an equal snapshot', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    let store = freshStore();
    store.load(dir);
    store.write(snap());

    store = freshStore();
    store.load(dir);
    assert.deepEqual(store.read(), snap());
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Missing / corrupt / bad-shape / zero-window → read() → null (never throws)
// ---------------------------------------------------------------------------
test('missing file → read() → null', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    assert.equal(store.read(), null);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('corrupt file → load() does not throw and read() → null', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    fs.writeFileSync(path.join(dir, FILE), '{{not valid json!!', 'utf8');
    const store = freshStore();
    assert.doesNotThrow(() => store.load(dir));
    assert.equal(store.read(), null);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('bad top-level shape (bare array) → read() → null', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    fs.writeFileSync(path.join(dir, FILE), JSON.stringify([{ tabs: [] }]), 'utf8');
    const store = freshStore();
    store.load(dir);
    assert.equal(store.read(), null);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('bad top-level shape (non-object) → read() → null', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    fs.writeFileSync(path.join(dir, FILE), JSON.stringify(42), 'utf8');
    const store = freshStore();
    store.load(dir);
    assert.equal(store.read(), null);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('a zero-window snapshot on disk → read() → null (the boot-safety rule)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    fs.writeFileSync(path.join(dir, FILE), JSON.stringify({ version: 1, windows: [] }), 'utf8');
    const store = freshStore();
    store.load(dir);
    assert.equal(store.read(), null);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('a snapshot whose every window drops to zero tabs → read() → null', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    // Two windows, each with only invalid tabs → both drop → zero surviving windows.
    fs.writeFileSync(
      path.join(dir, FILE),
      JSON.stringify({
        version: 1,
        windows: [{ tabs: [{ url: '', jarId: 'work' }] }, { tabs: [] }],
      }),
      'utf8'
    );
    const store = freshStore();
    store.load(dir);
    assert.equal(store.read(), null);
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Member validation: malformed members dropped, valid siblings kept (both directions)
// ---------------------------------------------------------------------------
test('malformed members dropped while valid siblings kept, in both tabs and windows', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const onDisk = {
      version: 1,
      windows: [
        // Window 0: a bad-url tab dropped, a valid sibling kept.
        {
          tabs: [
            { url: 123, jarId: 'work', active: true }, // non-string url → drop
            { url: 'https://kept.example/', jarId: 'work', active: false }, // kept
            { url: 'https://nojar.example/', active: true }, // missing jarId → drop
          ],
        },
        // Window 1: tabs is not an array → whole window dropped.
        { tabs: {} },
        // Window 2: zero-tab window → dropped.
        { tabs: [] },
        // Window 3: fully valid, active coerces to !! → kept.
        { tabs: [{ url: 'https://also.example/', jarId: 'play', active: 1 }] },
      ],
    };
    fs.writeFileSync(path.join(dir, FILE), JSON.stringify(onDisk), 'utf8');
    const store = freshStore();
    store.load(dir);
    assert.deepEqual(store.read(), {
      version: 1,
      windows: [
        { tabs: [{ url: 'https://kept.example/', jarId: 'work', active: false }] },
        { tabs: [{ url: 'https://also.example/', jarId: 'play', active: true }] },
      ],
    });
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Codec seam honored (custom serialize/deserialize used)
// ---------------------------------------------------------------------------
test('custom codec seam is honored on write and load', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const serializeLog = [];
    const deserializeLog = [];
    const serialize = (obj) => {
      const s = 'SESSCODEC:' + JSON.stringify(obj);
      serializeLog.push(s);
      return s;
    };
    const deserialize = (s) => {
      deserializeLog.push(s);
      if (!s.startsWith('SESSCODEC:')) throw new Error('unexpected format');
      return JSON.parse(s.slice('SESSCODEC:'.length));
    };

    let store = freshStore();
    store.load(dir, { serialize, deserialize });
    store.write(snap());
    assert.ok(serializeLog.length > 0, 'custom serialize used on write');
    // The row bytes carry the custom prefix (proof the seam wrote them).
    assert.ok(/** @type {string} */ (readRow(dir)).startsWith('SESSCODEC:'));

    store = freshStore();
    store.load(dir, { serialize, deserialize });
    assert.ok(deserializeLog.length > 0, 'custom deserialize used on load');
    assert.deepEqual(store.read(), snap());
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// write() produces a valid object-shaped row, and never touches session.json
// (was: "atomic write leaves no .tmp file behind..." — session.json is no
// longer the write target; the document row is, per the flight 10-1 migration).
// ---------------------------------------------------------------------------
test('write() persists a valid object-shaped row and never touches session.json', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    store.write(snap());

    const raw = readRow(dir);
    assert.ok(raw !== null, 'session row should exist');
    const parsed = JSON.parse(/** @type {string} */ (raw));
    assert.equal(parsed.version, 1);
    assert.ok(Array.isArray(parsed.windows), 'windows should be an array');
    assert.ok(!fs.existsSync(path.join(dir, FILE)), 'write() must not write session.json');
    assert.ok(!fs.existsSync(path.join(dir, FILE + '.tmp')), 'no session.json.tmp left behind');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// clear() removes the row (+ any lingering legacy file) and empties the
// in-memory snapshot
// ---------------------------------------------------------------------------
test('clear() removes the persisted session row and read() → null afterward', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    let store = freshStore();
    store.load(dir);
    store.write(snap());
    store.clear();
    assert.equal(store.read(), null);
    assert.equal(readRow(dir), null, 'session row removed by clear()');

    store = freshStore();
    store.load(dir);
    assert.equal(store.read(), null, 'a fresh load after clear() has no session');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('clear() also removes a lingering legacy session.json, but never a .migrated sibling', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir); // fresh dir, no row, no legacy file — a normal boot, no migration triggered

    // Simulate a lingering bare legacy file AND a pre-existing .migrated
    // sibling written AFTER this boot's load() — clear() must remove the
    // bare file only, never the .migrated rollback artifact.
    fs.writeFileSync(path.join(dir, FILE), JSON.stringify(snap()), 'utf8');
    fs.writeFileSync(path.join(dir, FILE + '.migrated'), JSON.stringify(snap()), 'utf8');

    store.clear();
    assert.ok(!fs.existsSync(path.join(dir, FILE)), 'clear() removes a lingering bare session.json');
    assert.ok(
      fs.existsSync(path.join(dir, FILE + '.migrated')),
      'clear() must never touch a .migrated sibling (deliberate history, DD5/DD6)'
    );
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('clear() before load() never throws (docStore unresolved)', () => {
  const store = freshStore();
  assert.doesNotThrow(() => store.clear());
  assert.equal(store.read(), null);
});

// ---------------------------------------------------------------------------
// app-db integration (flight 10-1, leg 1): app-db-not-open propagation +
// legacy-JSON migration semantics (DD5).
// ---------------------------------------------------------------------------

test('load() throws when app-db is not open (mis-ordered boot must propagate, not fall back to no session)', () => {
  const dir = makeTempDir();
  try {
    // Deliberately do NOT call appDb.open(dir) — app-db starts closed.
    const store = freshStore();
    assert.throws(() => store.load(dir), /app db not open/);
  } finally {
    removeTempDir(dir);
  }
});

test('migration: legacy session.json is imported once, snapshot intact, then renamed .migrated', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    fs.writeFileSync(path.join(dir, FILE), JSON.stringify(snap()), 'utf8');

    const store = freshStore();
    store.load(dir);
    assert.deepEqual(store.read(), snap());

    const row = readRow(dir);
    assert.ok(row !== null);
    assert.deepEqual(JSON.parse(/** @type {string} */ (row)), snap());

    assert.ok(!fs.existsSync(path.join(dir, FILE)), 'session.json should be renamed away');
    assert.ok(fs.existsSync(path.join(dir, FILE + '.migrated')), 'session.json.migrated should exist');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('migration: corrupt legacy session.json still migrates (repaired-to-empty row + rename)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    fs.writeFileSync(path.join(dir, FILE), '{{not valid json!!', 'utf8');

    const store = freshStore();
    store.load(dir);
    assert.equal(store.read(), null, 'corrupt legacy JSON repairs to no usable session');

    const row = readRow(dir);
    assert.ok(row !== null, 'the repaired-to-empty result still migrates as the row');
    assert.deepEqual(JSON.parse(/** @type {string} */ (row)).windows, []);

    assert.ok(!fs.existsSync(path.join(dir, FILE)));
    assert.ok(fs.existsSync(path.join(dir, FILE + '.migrated')), 'the corrupt original still renames .migrated');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('migration: a present row wins over a stray legacy session.json (no re-import)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    store.write(snap());

    // Now drop a stray legacy file with a DIFFERENT snapshot — this must be ignored.
    const other = { version: 1, windows: [{ tabs: [{ url: 'https://other.example/', jarId: 'x', active: true }] }] };
    fs.writeFileSync(path.join(dir, FILE), JSON.stringify(other), 'utf8');

    const store2 = freshStore();
    store2.load(dir);
    assert.deepEqual(store2.read(), snap(), 'row wins; stray JSON is not re-imported');

    assert.ok(fs.existsSync(path.join(dir, FILE)));
    assert.ok(!fs.existsSync(path.join(dir, FILE + '.migrated')));
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('migration: no row, no legacy file → no usable session, no migration side effects', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    assert.equal(store.read(), null);
    assert.equal(readRow(dir), null, 'a fresh profile has no row until write()');
    assert.ok(!fs.existsSync(path.join(dir, FILE + '.migrated')));
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});
