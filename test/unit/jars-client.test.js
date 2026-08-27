'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

async function makeHarness() {
  const { createJarsClient } = await import('../../src/renderer/chrome/jars-client.js');
  const callbacks = {};
  const events = [];
  const ctx = { tabs: new Map(), activeTabId: null };
  const bridge = {
    jarsList: async () => [{ id: 'personal', name: 'Personal', color: '#123', partition: 'persist:personal' }],
    jarsGetDefault: async () => ({ id: '__burner__' }),
    onJarsChanged: (fn) => {
      callbacks.changed = fn;
    },
    onJarWiped: (fn) => {
      callbacks.wiped = fn;
    }
  };
  const client = createJarsClient({
    bridge,
    ctx,
    burner: { id: '__burner__', name: 'Burner', color: '#999' },
    isWebTab: (tab) => !tab.trusted,
    isInternalTab: (tab) => !!(tab && tab.trusted),
    activateTab: (id) => {
      events.push(['activate', id]);
      ctx.activeTabId = id;
    },
    closeTab: (id) => events.push(['close', id]),
    updateAutomationIndicator: (snap) => events.push(['indicator', snap]),
    getAutomationSnapshot: () => ({ sessions: [] }),
    inheritContainerDecision: (container, internal) =>
      internal ? { container: null, freshBurner: false } : { container, freshBurner: !container },
    inheritFromPartition: (partition, containers) => ({
      container: containers.find((entry) => entry.partition === partition) || null,
      freshBurner: partition && partition.startsWith('burner:')
    }),
    random: () => 0.25
  });
  return { callbacks, events, ctx, client };
}

test('jar boot normalizes Burner default and reconciles the automation snapshot', async () => {
  const h = await makeHarness();
  await h.client.boot;
  assert.equal(h.client.defaultId, null);
  assert.equal(h.client.containers[0].id, 'personal');
  assert.deepEqual(h.events, [['indicator', { sessions: [] }]]);
});

test('jars-changed refreshes survivors and closes active orphans without intermediate activation', async () => {
  const h = await makeHarness();
  await h.client.boot;
  h.events.length = 0;
  const dot = { style: {}, title: '' };
  const orphan = { id: 'orphan', trusted: false, container: { id: 'gone' }, wcId: 1 };
  const survivor = {
    id: 'survivor',
    trusted: false,
    container: { id: 'personal' },
    wcId: 2,
    btn: { querySelector: () => dot }
  };
  h.ctx.tabs.set(orphan.id, orphan);
  h.ctx.tabs.set(survivor.id, survivor);
  h.ctx.activeTabId = orphan.id;
  h.callbacks.changed({
    containers: [{ id: 'personal', name: 'Renamed', color: '#abc', partition: 'persist:personal' }],
    defaultId: 'personal'
  });
  assert.deepEqual(h.events.slice(0, 2), [
    ['activate', 'survivor'],
    ['close', 'orphan']
  ]);
  assert.equal(survivor.container.name, 'Renamed');
  assert.equal(dot.style.background, '#abc');
});

test('jar-wiped activates a non-matching survivor before ordered close', async () => {
  const h = await makeHarness();
  await h.client.boot;
  h.events.length = 0;
  const first = { id: 'a', trusted: false, container: { id: 'personal' }, wcId: 1 };
  const second = { id: 'b', trusted: false, container: { id: 'personal' }, wcId: 2 };
  const survivor = { id: 'c', trusted: false, container: { id: 'other' }, wcId: 3 };
  for (const tab of [first, second, survivor]) h.ctx.tabs.set(tab.id, tab);
  h.ctx.activeTabId = first.id;
  h.callbacks.wiped({ id: 'personal' });
  assert.deepEqual(h.events, [
    ['activate', 'c'],
    ['close', 'a'],
    ['close', 'b']
  ]);
});

test('DD7 regression pin (M15 F2 Leg 3, flight non-blocking suggestion): refreshOpenTabJars matches a tab to its fresh container strictly by id — a REFERENCE REFRESH, never a re-home', async () => {
  const h = await makeHarness();
  await h.client.boot;
  h.events.length = 0;
  const originalContainer = { id: 'personal', name: 'Personal', color: '#123', partition: 'persist:personal' };
  const tab = {
    id: 'tab-1',
    trusted: false,
    container: originalContainer,
    wcId: 1,
    btn: { querySelector: () => null }
  };
  h.ctx.tabs.set(tab.id, tab);
  h.ctx.activeTabId = tab.id;

  const freshPersonal = { id: 'personal', name: 'Personal Renamed', color: '#fff', partition: 'persist:personal' };
  h.callbacks.changed({ containers: [freshPersonal], defaultId: 'personal' });

  // `entry.id === tab.container.id` (jars-client.js:24) is the predicate this
  // pins: same id -> the tab's container reference is swapped to the FRESH
  // object (this DD7 line is what makes the new re-derive trigger set true —
  // "no live tab is ever re-homed", only ever reference-refreshed).
  assert.equal(tab.container, freshPersonal, 'same id -> reference refresh to the fresh container object');
  assert.notEqual(tab.container, originalContainer);
  assert.ok(
    h.events.every(([kind]) => kind !== 'activate' && kind !== 'close'),
    'a still-resolvable id is never treated as an orphan (no activate/close)'
  );
});

test('routing helpers preserve persistent jars and mint fresh burner identities', async () => {
  const h = await makeHarness();
  await h.client.boot;
  const persistent = h.client.inheritContainerFromPartition('persist:personal');
  assert.equal(persistent.id, 'personal');
  const burner = h.client.inheritContainerFromPartition('burner:old');
  assert.deepEqual(burner, {
    id: 'burner-250000000',
    name: 'Burner',
    color: '#999',
    partition: 'burner:250000000',
    burner: true
  });
});
