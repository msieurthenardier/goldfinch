'use strict';

// Unit tests for jars.js's `verifyPersisted(id)` (M18 F3 Leg 2 / flight DD3
// ruling 4): an INDEPENDENT read-back confirmation that a jar id actually
// landed on disk, added because `add()`'s save() is deliberately fail-soft
// (swallow-all) and pushes the container in-memory BEFORE persisting —
// `restoreProfile`'s 'new' directive needs to distinguish "added" from
// "added but the write silently failed" before it writes a vault under that
// jar's id. Additive: `save()`'s fail-soft contract and every existing
// caller's behavior are unchanged (pinned here by re-running one of
// jars.test.js's own fail-soft assertions unmodified).
//
// Electron-free, following jars.test.js's own idiom exactly: real temp dirs,
// app-db opened per test, a module-cache-busted fresh store per test (module-
// scoped singleton).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDb = require('../../src/main/app-db');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-jars-verify-'));
}
function removeTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
function freshStore() {
  const resolved = require.resolve('../../src/main/jars');
  delete require.cache[resolved];
  return require('../../src/main/jars');
}

test('verifyPersisted: PRESENT — a jar just added via add() reads back true; an unrelated/never-added id reads back false', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    const created = store.add('Verify Me', '#abcdef');
    assert.equal(store.verifyPersisted(created.id), true, 'a durably-saved jar verifies present');
    assert.equal(store.verifyPersisted('never-added-id'), false, 'an id that was never added verifies absent');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test('verifyPersisted: ABSENT — before load() (docStore unset), verifyPersisted returns false and never throws', () => {
  const store = freshStore();
  assert.equal(store.verifyPersisted('anything'), false);
});

test('verifyPersisted: UNWRITABLE-STORE — once the underlying db is closed, verifyPersisted returns false rather than throwing (the store IS the failure mode `restoreProfile` must survive)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  const store = freshStore();
  store.load(dir);
  const created = store.add('Before Close', '#abcdef');
  assert.equal(store.verifyPersisted(created.id), true, 'sanity: present while the db is open');
  appDb.close();
  try {
    assert.equal(store.verifyPersisted(created.id), false, 'reads as not-verified once the store is unwritable/closed');
  } finally {
    removeTempDir(dir);
  }
});

test('verifyPersisted: a FAILED fail-soft save() leaves the row UNCHANGED, so a read-back correctly reports the PRE-ADD state (design-review-verified feasibility)', () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    // Establish a normal row first (the fresh-seed migration writes it).
    const seedStore = freshStore();
    seedStore.load(dir);
    const before = seedStore.list().map((c) => c.id);

    // Reload with a THROWING serialize — add()'s save() swallows the throw (fail-soft,
    // unchanged contract), so the row on disk stays exactly what it was.
    const store = freshStore();
    store.load(dir, {
      serialize: () => {
        throw new Error('injected serialize failure');
      },
      deserialize: (s) => JSON.parse(s)
    });
    const created = store.add('Will Not Persist', '#abcdef');

    // save()'s fail-soft contract is UNCHANGED: add() still returns the container and
    // the IN-MEMORY list still carries it (list() reads live state, not the row).
    assert.ok(
      store.list().some((c) => c.id === created.id),
      'in-memory push is unaffected by the swallowed save failure'
    );

    // But the durable row never changed — verifyPersisted reports the PRE-ADD state.
    assert.equal(store.verifyPersisted(created.id), false, 'a failed persist reads back as NOT verified');

    // Cross-check against the row directly: still exactly the pre-add container set.
    const freshRead = freshStore();
    freshRead.load(dir);
    assert.deepEqual(
      freshRead.list().map((c) => c.id),
      before,
      'the row on disk is byte-for-byte the pre-add state — the swallowed write never landed'
    );
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});

test("verifyPersisted: does not change any existing caller's behavior — add()/rename()/remove()/setDefault()/setRetention() all unaffected", () => {
  const dir = makeTempDir();
  appDb.open(dir);
  try {
    const store = freshStore();
    store.load(dir);
    const created = store.add('Untouched', '#123456');
    assert.equal(created.name, 'Untouched');
    const renamed = store.rename(created.id, { name: 'Renamed' });
    assert.equal(renamed.name, 'Renamed');
    assert.equal(store.setRetention(created.id, 45).retentionDays, 45);
    assert.equal(store.setDefault(created.id), true);
    assert.equal(store.getDefault().id, created.id);
    const removed = store.remove(created.id);
    assert.equal(removed.id, created.id);
    assert.equal(store.verifyPersisted(created.id), false, 'a removed jar verifies absent, as expected');
  } finally {
    appDb.close();
    removeTempDir(dir);
  }
});
