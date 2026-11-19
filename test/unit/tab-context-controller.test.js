'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTabContextController } = require('../../src/renderer/chrome/tab-context-controller');
const { createPushCache } = require('../../src/shared/push-cache');

function setup(opts = {}) {
  const handlers = {};
  const order = [];
  const seeds = {};
  const goldfinch = {
    onClosedTabStackChanged: (cb) => {
      order.push('sub:stack');
      handlers.stack = cb;
    },
    onMoveTargetsChanged: (cb) => {
      order.push('sub:targets');
      handlers.targets = cb;
    },
    closedTabStackSize: () => {
      order.push('seed:stack');
      return opts.stackSeed || Promise.resolve(0);
    },
    moveTargets: () => {
      order.push('seed:targets');
      return opts.targetsSeed || Promise.resolve([]);
    }
  };
  const opens = [];
  const models = [];
  const activeEl = { id: 'active' };
  const tabs = new Map(opts.tabs || [['a', { wcId: 1 }]]);
  const ctl = createTabContextController({
    goldfinch,
    document: { activeElement: activeEl },
    createPushCache,
    tabContextModel: (m) => {
      models.push(m);
      return { model: m };
    },
    tabs,
    orderedTabIds: () => opts.ids || ['a'],
    isInternalTab: (t) => !!(t && t.internal),
    openOverlayMenu: (...a) => opens.push(a),
    chromePointToSheet: (x, y) => ({ x, y })
  });
  const anchor = { getBoundingClientRect: () => ({ left: 5, bottom: 9 }) };
  return { ctl, handlers, opens, models, activeEl, anchor, order, seeds };
}

test('subscription is registered before the seed call', () => {
  const { order } = setup();
  assert.deepEqual(order, ['sub:stack', 'seed:stack', 'sub:targets', 'seed:targets']);
});

test('vanished tab id is a no-op', () => {
  const { ctl, opens, anchor } = setup();
  ctl.openTabContextMenu('gone', anchor);
  assert.equal(opens.length, 0);
  assert.equal(ctl.tabCtx.tabId, null);
});

test('opens tab-context with model derived from tab entry and caches', async () => {
  const { ctl, opens, models, anchor, activeEl, handlers } = setup({
    ids: ['x', 'a', 'b'],
    tabs: [
      ['x', {}],
      ['a', { wcId: 7, internal: true }],
      ['b', { wcId: 8 }]
    ]
  });
  handlers.stack({ size: 3 });
  handlers.targets({ targets: [{ windowId: 2, label: 'W' }] });
  ctl.openTabContextMenu('a', anchor);
  assert.deepEqual(models[0], {
    tabId: 'a',
    isLastTab: false,
    tabsToRight: 1,
    stackSize: 3,
    isInternal: true,
    hasView: true,
    moveTargets: [{ windowId: 2, label: 'W' }]
  });
  assert.equal(opens.length, 1);
  assert.equal(opens[0][0], 'tab-context');
  assert.deepEqual(opens[0][2], { x: 5, y: 9 });
  assert.equal(opens[0][3], 0);
  assert.equal(ctl.tabCtx.returnFocus, activeEl);
  ctl.openTabContextMenu('x', anchor);
  assert.equal(models[1].hasView, false);
  assert.equal(models[1].isInternal, false);
});

test('tabCtx is the object openTabContextMenu mutates (identity)', () => {
  const { ctl, anchor } = setup();
  const same = ctl.tabCtx;
  ctl.openTabContextMenu('a', anchor);
  assert.equal(ctl.tabCtx, same);
  assert.equal(same.tabId, 'a');
});

test('push wins over a later seed; seed applies when no push', async () => {
  let resolveStack;
  const stackSeed = new Promise((r) => (resolveStack = r));
  const { ctl, handlers, models, anchor } = setup({
    stackSeed,
    targetsSeed: Promise.resolve([{ windowId: 1, label: 'S' }])
  });
  handlers.stack({ size: 2 });
  resolveStack(9);
  await new Promise((r) => setImmediate(r));
  ctl.openTabContextMenu('a', anchor);
  assert.equal(models[0].stackSize, 2);
  assert.deepEqual(models[0].moveTargets, [{ windowId: 1, label: 'S' }]);
});

test('a rejected seed keeps the default and does not throw unhandled', async () => {
  const { ctl, models, anchor } = setup({
    stackSeed: Promise.reject(new Error('x')),
    targetsSeed: Promise.reject(new Error('y'))
  });
  await new Promise((r) => setImmediate(r));
  ctl.openTabContextMenu('a', anchor);
  assert.equal(models[0].stackSize, 0);
  assert.deepEqual(models[0].moveTargets, []);
});
