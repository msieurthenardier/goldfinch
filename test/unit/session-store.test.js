'use strict';

// Unit tests for src/main/session-store.js (M09 Flight 9, Leg 2, DD1 / AC1-AC2) —
// the Electron-free, disk-durable session snapshot store.
//
// No Electron stub needed — the module is Electron-free (no require of the electron
// module, no app.getPath at module scope). The userData path is injected via load().
//
// The store is a MODULE-SCOPED SINGLETON (like downloads-store / settings-store), so
// we re-require it fresh per test (cache-bust) to stop dir/snapshot leaking across
// tests, and use a real temp dir (never the operator's userData path).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-session-'));
}

function removeTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
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
  try {
    let store = freshStore();
    store.load(dir);
    store.write(snap());

    store = freshStore();
    store.load(dir);
    assert.deepEqual(store.read(), snap());
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Missing / corrupt / bad-shape / zero-window → read() → null (never throws)
// ---------------------------------------------------------------------------
test('missing file → read() → null', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.load(dir);
    assert.equal(store.read(), null);
  } finally {
    removeTempDir(dir);
  }
});

test('corrupt file → load() does not throw and read() → null', () => {
  const dir = makeTempDir();
  try {
    fs.writeFileSync(path.join(dir, FILE), '{{not valid json!!', 'utf8');
    const store = freshStore();
    assert.doesNotThrow(() => store.load(dir));
    assert.equal(store.read(), null);
  } finally {
    removeTempDir(dir);
  }
});

test('bad top-level shape (bare array) → read() → null', () => {
  const dir = makeTempDir();
  try {
    fs.writeFileSync(path.join(dir, FILE), JSON.stringify([{ tabs: [] }]), 'utf8');
    const store = freshStore();
    store.load(dir);
    assert.equal(store.read(), null);
  } finally {
    removeTempDir(dir);
  }
});

test('bad top-level shape (non-object) → read() → null', () => {
  const dir = makeTempDir();
  try {
    fs.writeFileSync(path.join(dir, FILE), JSON.stringify(42), 'utf8');
    const store = freshStore();
    store.load(dir);
    assert.equal(store.read(), null);
  } finally {
    removeTempDir(dir);
  }
});

test('a zero-window snapshot on disk → read() → null (the boot-safety rule)', () => {
  const dir = makeTempDir();
  try {
    fs.writeFileSync(path.join(dir, FILE), JSON.stringify({ version: 1, windows: [] }), 'utf8');
    const store = freshStore();
    store.load(dir);
    assert.equal(store.read(), null);
  } finally {
    removeTempDir(dir);
  }
});

test('a snapshot whose every window drops to zero tabs → read() → null', () => {
  const dir = makeTempDir();
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
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Member validation: malformed members dropped, valid siblings kept (both directions)
// ---------------------------------------------------------------------------
test('malformed members dropped while valid siblings kept, in both tabs and windows', () => {
  const dir = makeTempDir();
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
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Codec seam honored (custom serialize/deserialize used)
// ---------------------------------------------------------------------------
test('custom codec seam is honored on write and load', () => {
  const dir = makeTempDir();
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
    // The on-disk bytes carry the custom prefix (proof the seam wrote them).
    assert.ok(fs.readFileSync(path.join(dir, FILE), 'utf8').startsWith('SESSCODEC:'));

    store = freshStore();
    store.load(dir, { serialize, deserialize });
    assert.ok(deserializeLog.length > 0, 'custom deserialize used on load');
    assert.deepEqual(store.read(), snap());
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Atomic write: no leftover .tmp file after write
// ---------------------------------------------------------------------------
test('atomic write leaves no .tmp file behind and produces the object-shaped file', () => {
  const dir = makeTempDir();
  try {
    const store = freshStore();
    store.load(dir);
    store.write(snap());

    assert.ok(fs.existsSync(path.join(dir, FILE)), 'session.json should exist');
    assert.ok(!fs.existsSync(path.join(dir, FILE + '.tmp')), 'no session.json.tmp left behind');
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8'));
    assert.equal(parsed.version, 1);
    assert.ok(Array.isArray(parsed.windows), 'windows should be an array');
  } finally {
    removeTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// clear() removes the file and empties the in-memory snapshot
// ---------------------------------------------------------------------------
test('clear() removes the persisted session and read() → null afterward', () => {
  const dir = makeTempDir();
  try {
    let store = freshStore();
    store.load(dir);
    store.write(snap());
    store.clear();
    assert.equal(store.read(), null);
    assert.ok(!fs.existsSync(path.join(dir, FILE)), 'session.json removed by clear()');

    store = freshStore();
    store.load(dir);
    assert.equal(store.read(), null, 'a fresh load after clear() has no session');
  } finally {
    removeTempDir(dir);
  }
});
