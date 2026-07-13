'use strict';

// Unit tests for src/main/automation/engine.js's getHistory op (Mission 08 Flight
// 5, Leg 1 — the branch matrix cited in the leg contract). engine.js is normally
// "Integration-verified in Leg 6 live smoke — not unit-tested offline (requires
// Electron runtime)" per its own file header, because it `require('electron')`s at
// module scope and every op builds `deps()` fresh, which unconditionally reads
// `session.fromPartition`. getHistory is a pure-computation op (validates jarId /
// dispatches to the injected getHistoryReads accessors) that never touches
// deps()/fromId/fromPartition/chromeContents, so it CAN be exercised offline once a
// minimal local electron double is installed just to satisfy the module-scope
// `require('electron')` — mirroring test/helpers/electron-stub.js's Module._cache
// technique, but scoped to this file only (node --test isolates each test file in
// its own process, so this cache write cannot leak into other test files).

const Module = require('module');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const electronResolved = require.resolve('electron');
Module._cache[electronResolved] = {
  id: electronResolved,
  filename: electronResolved,
  loaded: true,
  exports: {
    webContents: { fromId: () => null },
    session: { fromPartition: () => null },
  },
  parent: null,
  children: [],
  paths: [],
};

const { createEngine } = require('../../src/main/automation/engine');

// ---------------------------------------------------------------------------
// Fakes: getHistoryReads (listRecent/search call recorders) + isKnownJar.
// ---------------------------------------------------------------------------

function makeAccessors({ known = ['personal', 'work'] } = {}) {
  const calls = { listRecent: [], search: [] };
  const getHistoryReads = {
    listRecent: (jarId, opts) => {
      calls.listRecent.push([jarId, opts]);
      return [{ id: 1, jarId, url: 'https://recent' }];
    },
    search: (jarId, query, opts) => {
      calls.search.push([jarId, query, opts]);
      return [{ id: 2, jarId, url: 'https://match', query }];
    },
  };
  const isKnownJar = (jarId) => known.includes(jarId);
  return { getHistoryReads, isKnownJar, calls };
}

function makeEngine(accessors) {
  return createEngine(() => null, {
    getHistoryReads: accessors.getHistoryReads,
    isKnownJar: accessors.isKnownJar,
  });
}

// ---------------------------------------------------------------------------
// Branch matrix (leg contract item 1 / item 5): missing jarId, unknown jar,
// query+before, query path, recent path incl. before passthrough, result shape.
// ---------------------------------------------------------------------------

test('getHistory: missing/empty jarId throws bad-args (static message, zero accessor calls)', () => {
  const accessors = makeAccessors();
  const engine = makeEngine(accessors);
  const isBadArgs = (err) => err instanceof Error && err.message === 'automation: bad-args — jarId required';
  assert.throws(() => engine.getHistory(undefined), isBadArgs);
  assert.throws(() => engine.getHistory(''), isBadArgs);
  assert.throws(() => engine.getHistory(null), isBadArgs);
  assert.throws(() => engine.getHistory(42), isBadArgs, 'a non-string jarId must also be refused');
  assert.equal(accessors.calls.listRecent.length, 0);
  assert.equal(accessors.calls.search.length, 0);
});

test('getHistory: unknown jarId throws unknown-jar (static message, zero accessor calls)', () => {
  const accessors = makeAccessors({ known: ['personal'] });
  const engine = makeEngine(accessors);
  assert.throws(
    () => engine.getHistory('ghost'),
    (err) => err instanceof Error && err.message === 'automation: unknown-jar'
  );
  assert.equal(accessors.calls.listRecent.length, 0);
  assert.equal(accessors.calls.search.length, 0);
});

test('getHistory: query AND before together throws bad-args (checked AFTER jar validation, zero accessor calls)', () => {
  const accessors = makeAccessors();
  const engine = makeEngine(accessors);
  assert.throws(
    () => engine.getHistory('personal', { query: 'x', before: 5 }),
    (err) => err instanceof Error && err.message === 'automation: bad-args — query does not page'
  );
  assert.equal(accessors.calls.listRecent.length, 0);
  assert.equal(accessors.calls.search.length, 0);
});

test('getHistory: query present routes to search(jarId, query, { limit }) — before is NOT forwarded to search', () => {
  const accessors = makeAccessors();
  const engine = makeEngine(accessors);
  const res = engine.getHistory('personal', { query: 'hello', limit: 25 });
  assert.deepEqual(accessors.calls.search, [['personal', 'hello', { limit: 25 }]]);
  assert.equal(accessors.calls.listRecent.length, 0);
  assert.deepEqual(res, { jarId: 'personal', visits: [{ id: 2, jarId: 'personal', url: 'https://match', query: 'hello' }] });
});

test('getHistory: absent query routes to listRecent(jarId, { limit, before }) — before passthrough', () => {
  const accessors = makeAccessors();
  const engine = makeEngine(accessors);
  const res = engine.getHistory('work', { limit: 50, before: 12345 });
  assert.deepEqual(accessors.calls.listRecent, [['work', { limit: 50, before: 12345 }]]);
  assert.equal(accessors.calls.search.length, 0);
  assert.deepEqual(res, { jarId: 'work', visits: [{ id: 1, jarId: 'work', url: 'https://recent' }] });
});

test('getHistory: empty-string query is treated as absent — routes to listRecent, not search', () => {
  const accessors = makeAccessors();
  const engine = makeEngine(accessors);
  engine.getHistory('personal', { query: '' });
  assert.equal(accessors.calls.search.length, 0);
  assert.equal(accessors.calls.listRecent.length, 1);
});

test('getHistory: no opts arg at all defaults to a recent listing with limit/before undefined', () => {
  const accessors = makeAccessors();
  const engine = makeEngine(accessors);
  engine.getHistory('personal');
  assert.deepEqual(accessors.calls.listRecent, [['personal', { limit: undefined, before: undefined }]]);
});

test('getHistory: result shape is always exactly { jarId, visits }, visits is the store\'s return verbatim', () => {
  const accessors = makeAccessors();
  const engine = makeEngine(accessors);
  const res = engine.getHistory('personal', {});
  assert.deepEqual(Object.keys(res).sort(), ['jarId', 'visits']);
  assert.equal(res.jarId, 'personal');
  assert.ok(Array.isArray(res.visits));
});
