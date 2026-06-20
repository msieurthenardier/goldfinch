'use strict';

// Unit tests for src/main/downloads-manager.js
//
// The manager is a FACTORY (createManager(store)), not a singleton — so we inject a
// PURE in-memory fake store (no fs, no electron) and assert deterministically. No
// require-cache dance needed.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createManager } = require('../../src/main/downloads-manager');

// A pure in-memory fake of the store's repo interface.
function makeFakeStore(startId = 1) {
  let nextId = startId;
  let records = [];
  return {
    getNextId: () => nextId++,
    list: () => records.slice(),
    append: (r) => { records.push(r); },
    remove: (id) => { records = records.filter((r) => r.id !== id); },
    clear: () => { records = []; },
    // test introspection
    _records: () => records,
    _peekNextId: () => nextId
  };
}

// ---------------------------------------------------------------------------
// register: assigns id via store.getNextId, holds an in-progress record
// ---------------------------------------------------------------------------
test('register assigns ids via store.getNextId and tracks in-progress', () => {
  const store = makeFakeStore(7);
  const mgr = createManager(store);

  const id1 = mgr.register({ url: 'https://e/1', filename: 'a.bin', savePath: '/dl/a.bin', startTime: 100 });
  const id2 = mgr.register({ url: 'https://e/2', filename: 'b.bin', savePath: '/dl/b.bin', startTime: 200 });

  assert.equal(id1, 7);
  assert.equal(id2, 8);

  // Both are in listAll (in-progress), none in the store yet.
  const all = mgr.listAll();
  assert.equal(all.length, 2);
  assert.equal(store._records().length, 0, 'register does NOT write to the store');
  const r1 = all.find((r) => r.id === id1);
  assert.equal(r1.state, 'progressing');
  assert.equal(r1.filename, 'a.bin');
});

// ---------------------------------------------------------------------------
// update: mutates the in-memory record, no disk write, no-op on unknown id
// ---------------------------------------------------------------------------
test('update mutates the in-progress record and no-ops on unknown id', () => {
  const store = makeFakeStore();
  const mgr = createManager(store);
  const id = mgr.register({ filename: 'a.bin' });

  mgr.update(id, { received: 50, total: 100, state: 'progressing', paused: true });
  const rec = mgr.listAll().find((r) => r.id === id);
  assert.equal(rec.received, 50);
  assert.equal(rec.total, 100);
  assert.equal(rec.paused, true);

  // Unknown id is a no-op (must not throw, must not create an entry).
  assert.doesNotThrow(() => mgr.update(9999, { received: 1 }));
  assert.equal(mgr.listAll().length, 1);
});

// ---------------------------------------------------------------------------
// finalize: appends terminal record to store, drops from memory; no-op if unknown
// ---------------------------------------------------------------------------
test('finalize appends a terminal record and drops it from memory', () => {
  const store = makeFakeStore();
  const mgr = createManager(store);
  const id = mgr.register({ url: 'https://e/x', filename: 'x.bin', savePath: '/tmp/x', startTime: 10, mime: 'application/octet-stream' });
  mgr.update(id, { received: 100, total: 100 });

  mgr.finalize(id, { state: 'completed', savePath: '/dl/x.bin', endTime: 999 });

  // Moved out of memory into the store.
  const stored = store._records();
  assert.equal(stored.length, 1);
  const t = stored[0];
  assert.equal(t.id, id);
  assert.equal(t.state, 'completed');
  assert.equal(t.savePath, '/dl/x.bin');
  assert.equal(t.endTime, 999);
  assert.equal(t.received, 100);
  assert.equal(t.mime, 'application/octet-stream');
  assert.equal(t.startTime, 10);

  // listAll merges store + memory; only the terminal record remains, once.
  const all = mgr.listAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].state, 'completed');
});

test('finalize on an unknown id is a no-op (already finalized)', () => {
  const store = makeFakeStore();
  const mgr = createManager(store);
  assert.doesNotThrow(() => mgr.finalize(123, { state: 'completed' }));
  assert.equal(store._records().length, 0);
});

test('finalize falls back to the in-progress savePath when none is given', () => {
  const store = makeFakeStore();
  const mgr = createManager(store);
  const id = mgr.register({ filename: 'a.bin', savePath: '/dl/a.bin' });
  mgr.finalize(id, { state: 'interrupted' });
  assert.equal(store._records()[0].savePath, '/dl/a.bin');
  assert.equal(store._records()[0].state, 'interrupted');
});

// ---------------------------------------------------------------------------
// listAll: merge + dedup by id, memory wins
// ---------------------------------------------------------------------------
test('listAll merges store terminal records with in-progress, deduped (memory wins)', () => {
  // Start id issuance at 2 so register() won't collide with the seeded id-1 record.
  const store = makeFakeStore(2);
  // Seed a terminal record directly in the store.
  store.append({ id: 1, filename: 'old.bin', state: 'completed', received: 10, total: 10 });
  const mgr = createManager(store);

  // An in-progress record with a distinct id.
  const id2 = mgr.register({ filename: 'new.bin' });

  const all = mgr.listAll();
  const ids = all.map((r) => r.id).sort((a, b) => a - b);
  assert.deepEqual(ids, [1, id2]);

  // Memory-wins dedup: if the store and memory both hold the same id, the memory
  // (in-progress) record is the one returned.
  store.append({ id: id2, filename: 'stale-terminal.bin', state: 'completed' });
  const merged = mgr.listAll();
  const dup = merged.filter((r) => r.id === id2);
  assert.equal(dup.length, 1, 'deduped by id');
  assert.equal(dup[0].state, 'progressing', 'in-progress memory record wins over the store copy');
});

// ---------------------------------------------------------------------------
// remove: drops from memory AND store
// ---------------------------------------------------------------------------
test('remove drops from both memory and the store', () => {
  const store = makeFakeStore();
  const mgr = createManager(store);
  const idInProgress = mgr.register({ filename: 'live.bin' });
  store.append({ id: 99, filename: 'hist.bin', state: 'completed' });

  mgr.remove(idInProgress);
  mgr.remove(99);

  assert.equal(mgr.listAll().length, 0);
  assert.equal(store._records().length, 0);
});

// ---------------------------------------------------------------------------
// clear: clears store history, in-progress memory stays
// ---------------------------------------------------------------------------
test('clear empties store history but keeps in-progress memory items', () => {
  const store = makeFakeStore();
  const mgr = createManager(store);
  const live = mgr.register({ filename: 'live.bin' });
  store.append({ id: 50, filename: 'hist.bin', state: 'completed' });

  mgr.clear();

  assert.equal(store._records().length, 0, 'store history cleared');
  const all = mgr.listAll();
  assert.equal(all.length, 1, 'in-progress item still present');
  assert.equal(all[0].id, live);
});

// ---------------------------------------------------------------------------
// flushInterrupted: appends each in-progress record as interrupted, tolerates throw
// ---------------------------------------------------------------------------
test('flushInterrupted appends each in-progress record as interrupted', () => {
  const store = makeFakeStore();
  const mgr = createManager(store);
  const a = mgr.register({ filename: 'a.bin', savePath: '/dl/a', startTime: 1 });
  const b = mgr.register({ filename: 'b.bin', savePath: '/dl/b', startTime: 2 });
  mgr.update(a, { received: 5, total: 10 });

  mgr.flushInterrupted();

  const stored = store._records();
  assert.equal(stored.length, 2);
  for (const r of stored) {
    assert.equal(r.state, 'interrupted');
    assert.equal(typeof r.endTime, 'number');
  }
  const ra = stored.find((r) => r.id === a);
  assert.equal(ra.received, 5);
  assert.equal(ra.savePath, '/dl/a');
  assert.ok(stored.find((r) => r.id === b));
});

test('flushInterrupted tolerates a store.append throw (best-effort)', () => {
  const store = makeFakeStore();
  store.append = () => { throw new Error('disk full'); };
  const mgr = createManager(store);
  mgr.register({ filename: 'a.bin' });
  assert.doesNotThrow(() => mgr.flushInterrupted(), 'a throwing append must not propagate');
});
