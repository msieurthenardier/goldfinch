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
    onJarsChanged: (fn) => { callbacks.changed = fn; },
    onJarWiped: (fn) => { callbacks.wiped = fn; },
  };
  const client = createJarsClient({
    bridge, ctx,
    burner: { id: '__burner__', name: 'Burner', color: '#999' },
    isWebTab: (tab) => !tab.trusted,
    isInternalTab: (tab) => !!(tab && tab.trusted),
    activateTab: (id) => { events.push(['activate', id]); ctx.activeTabId = id; },
    closeTab: (id) => events.push(['close', id]),
    updateAutomationIndicator: (snap) => events.push(['indicator', snap]),
    getAutomationSnapshot: () => ({ sessions: [] }),
    inheritContainerDecision: (container, internal) => internal
      ? { container: null, freshBurner: false }
      : { container, freshBurner: !container },
    inheritFromPartition: (partition, containers) => ({
      container: containers.find((entry) => entry.partition === partition) || null,
      freshBurner: partition && partition.startsWith('burner:')
    }),
    random: () => 0.25,
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
    id: 'survivor', trusted: false, container: { id: 'personal' }, wcId: 2,
    btn: { querySelector: () => dot }
  };
  h.ctx.tabs.set(orphan.id, orphan);
  h.ctx.tabs.set(survivor.id, survivor);
  h.ctx.activeTabId = orphan.id;
  h.callbacks.changed({
    containers: [{ id: 'personal', name: 'Renamed', color: '#abc', partition: 'persist:personal' }],
    defaultId: 'personal'
  });
  assert.deepEqual(h.events.slice(0, 2), [['activate', 'survivor'], ['close', 'orphan']]);
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
  assert.deepEqual(h.events, [['activate', 'c'], ['close', 'a'], ['close', 'b']]);
});

test('routing helpers preserve persistent jars and mint fresh burner identities', async () => {
  const h = await makeHarness();
  await h.client.boot;
  const persistent = h.client.inheritContainerFromPartition('persist:personal');
  assert.equal(persistent.id, 'personal');
  const burner = h.client.inheritContainerFromPartition('burner:old');
  assert.deepEqual(burner, {
    id: 'burner-250000000', name: 'Burner', color: '#999', partition: 'burner:250000000', burner: true
  });
});
