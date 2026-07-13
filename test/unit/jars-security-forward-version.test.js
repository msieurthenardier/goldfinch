'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-jars-fixes-'));
}

function freshStore() {
  const resolved = require.resolve('../../src/main/jars');
  delete require.cache[resolved];
  return require('../../src/main/jars');
}

function storeFile(dir) {
  return path.join(dir, 'containers.json');
}

function writeStore(dir, payload) {
  fs.writeFileSync(storeFile(dir), JSON.stringify(payload));
}

test('user-minted privileged identity names are remapped by slug/add', () => {
  const dir = makeTempDir();
  try {
    writeStore(dir, { version: 2, defaultId: null, containers: [] });
    const store = freshStore();
    store.load(dir);

    const minted = ['Admin', 'Internal', 'Default'].map((name) => store.add(name));
    assert.deepEqual(
      minted.map((jar) => jar.id),
      ['jar-admin', 'jar-internal', 'jar-default']
    );
    assert.deepEqual(
      minted.map((jar) => jar.name),
      ['Admin', 'Internal', 'Default'],
      'display names are untouched'
    );
    assert.equal(store.list().some((jar) => jar.id === 'admin' || jar.id === 'internal'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('load remaps privileged identity claims but preserves the built-in legacy default', () => {
  const dir = makeTempDir();
  try {
    writeStore(dir, {
      version: 2,
      defaultId: 'admin',
      containers: [
        { id: 'admin', name: 'Admin', color: '#111111', partition: 'persist:container:admin' },
        { id: 'internal', name: 'Internal', color: '#222222', partition: 'persist:container:internal' },
        { id: 'default', name: 'User Default', color: '#333333', partition: 'persist:container:default' },
        { id: 'default', name: 'Default', color: '#9aa0ac', partition: 'persist:goldfinch' }
      ]
    });
    const store = freshStore();
    store.load(dir);

    assert.deepEqual(store.list().map((jar) => jar.id), ['jar-admin', 'jar-internal', 'jar-default', 'default']);
    assert.equal(store.list().some((jar) => jar.id === 'admin' || jar.id === 'internal'), false);
    assert.deepEqual(
      store.list().find((jar) => jar.id === 'default'),
      { id: 'default', name: 'Default', color: '#9aa0ac', partition: 'persist:goldfinch', retentionDays: 30 }
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('unknown-version envelope survives load without being overwritten', () => {
  const dir = makeTempDir();
  try {
    const envelope = {
      version: 3,
      defaultId: 'research',
      containers: [
        {
          id: 'research',
          name: 'Research',
          color: '#abcdef',
          partition: 'persist:container:research'
        }
      ]
    };
    writeStore(dir, envelope);
    const bytes = fs.readFileSync(storeFile(dir), 'utf8');
    const store = freshStore();

    assert.doesNotThrow(() => store.load(dir));
    // In-memory records gain the retentionDays default; the on-disk envelope must not.
    assert.deepEqual(store.list(), envelope.containers.map((c) => ({ ...c, retentionDays: 30 })));
    assert.equal(store.getDefault().id, 'research');
    assert.equal(fs.readFileSync(storeFile(dir), 'utf8'), bytes, 'load must leave the envelope bytes untouched');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
