'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('createChromeContext performs one DOM lookup pass and owns shared mutable state', async () => {
  const { createChromeContext } = await import('../../src/renderer/chrome/context.js');
  const counts = new Map();
  const platformClasses = [];
  const document = {
    getElementById(id) { counts.set(id, (counts.get(id) || 0) + 1); return { id }; },
    querySelectorAll(selector) { assert.equal(selector, '.filter'); return [{ id: 'filter' }]; },
    documentElement: { classList: { add: (name) => platformClasses.push(name) } },
  };
  const ctx = createChromeContext({ document, goldfinch: { platform: 'darwin' } });
  assert.equal([...counts.values()].every((count) => count === 1), true);
  assert.equal(counts.size > 50, true);
  assert.deepEqual(platformClasses, ['platform-darwin']);
  assert.equal(ctx.els.address.id, 'address');
  assert.equal(ctx.tabs instanceof Map, true);
  assert.deepEqual(
    [ctx.activeTabId, ctx.activeFilter, ctx.tabSeq, ctx.activeViewWcId, ctx.rafGeometryPending],
    [null, 'all', 0, null, false]
  );
  ctx.activeTabId = 'tab-1';
  ctx.tabs.set('tab-1', { id: 'tab-1' });
  assert.equal(ctx.activeTabId, 'tab-1');
  assert.equal(ctx.tabs.get('tab-1').id, 'tab-1');
});
