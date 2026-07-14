'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTabSessionStore } = require('../../src/main/tab-session-store');

const record = {
  url: 'https://example.com/', title: 'Example', favicon: null, trusted: false,
  container: { id: 'default', name: 'Default', color: '#123456', partition: 'persist:default' },
};

test('tab session store persists normalized state atomically', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldfinch-tabs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createTabSessionStore();
  assert.deepEqual(store.load(dir), { version: 1, windows: [], closedTabs: [] });
  store.save({ windows: [{ tabs: [record], activeIndex: 0 }], closedTabs: [record] });
  const reloaded = createTabSessionStore();
  assert.deepEqual(reloaded.load(dir), { version: 1, windows: [{ tabs: [record], activeIndex: 0 }], closedTabs: [record] });
  assert.equal(fs.existsSync(path.join(dir, 'tab-session.json.tmp')), false);
});

test('tab session store repairs corrupt files to an empty session', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldfinch-tabs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'tab-session.json'), '{broken');
  assert.deepEqual(createTabSessionStore().load(dir), { version: 1, windows: [], closedTabs: [] });
});
