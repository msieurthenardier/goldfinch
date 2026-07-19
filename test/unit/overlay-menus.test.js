'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

async function makeHarness() {
  const { createOverlayMenus, fixedTriggerMenu } = await import('../../src/renderer/chrome/overlay-menus.js');
  const callbacks = {};
  const events = [];
  let clock = 1000;
  const trigger = {
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = value; events.push(['aria', value]); },
    focus() { events.push(['focus']); },
  };
  const bridge = {
    menuOverlayOpen: (payload) => events.push(['open', payload]),
    menuOverlayClose: (payload) => events.push(['close', payload]),
    onMenuOverlayActivated: (fn) => { callbacks.activated = fn; },
    onMenuOverlayClosed: (fn) => { callbacks.closed = fn; },
  };
  const states = { kebab: fixedTriggerMenu(() => trigger) };
  const client = createOverlayMenus({
    bridge, states, now: () => clock,
    onActivated: (payload) => events.push(['activated', payload]),
    onClosed: (payload) => events.push(['closed', payload]),
  });
  return { callbacks, events, states, client, trigger, tick: (ms) => { clock += ms; } };
}

test('menu open mints monotonic tokens and stale close cannot reset ARIA or refocus', async () => {
  const h = await makeHarness();
  h.client.open('kebab', [{ id: 'settings' }], { x: 1 }, 0);
  const first = h.states.kebab.token;
  h.client.open('kebab', [{ id: 'downloads' }], { x: 2 }, 0);
  const second = h.states.kebab.token;
  assert.ok(second > first);
  h.events.length = 0;
  h.callbacks.closed({ menuType: 'kebab', reason: 'escape', token: first });
  assert.equal(h.states.kebab.open, true);
  assert.deepEqual(h.events, []);
  h.callbacks.closed({ menuType: 'kebab', reason: 'escape', token: second });
  assert.equal(h.states.kebab.open, false);
  assert.deepEqual(h.events.map((event) => event[0]), ['aria', 'focus', 'closed']);
});

test('blur close suppresses only the same trigger for 300ms', async () => {
  const h = await makeHarness();
  h.client.open('kebab', [], {}, 0);
  h.callbacks.closed({ menuType: 'kebab', reason: 'blur', token: h.states.kebab.token });
  h.events.length = 0;
  h.client.trigger('kebab', () => h.events.push(['reopen']));
  assert.deepEqual(h.events, []);
  h.tick(301);
  h.client.trigger('kebab', () => h.events.push(['reopen']));
  assert.deepEqual(h.events, [['reopen']]);
});

test('activation dispatch is allowlisted to registered menu types', async () => {
  const h = await makeHarness();
  h.callbacks.activated({ menuType: 'unknown', id: 'exit' });
  h.callbacks.activated({ menuType: 'kebab', id: 7 });
  assert.deepEqual(h.events, []);
  h.callbacks.activated({ menuType: 'kebab', id: 'exit' });
  assert.deepEqual(h.events, [['activated', { menuType: 'kebab', id: 'exit' }]]);
});

test('menu models and chrome-to-sheet anchor conversion retain exact shapes', async () => {
  const { buildKebabModel, chromePointToSheet, leftSheetAnchor, rightSheetAnchor } =
    await import('../../src/renderer/chrome/overlay-menus.js');
  assert.deepEqual(buildKebabModel().map((item) => item.id), [
    'new-window', 'settings', 'downloads', 'jars', 'print', 'exit'
  ]);
  const webviews = { left: 100, top: 40 };
  const trigger = { left: 90, right: 250 };
  assert.deepEqual(chromePointToSheet(webviews, 91, 30), { x: -9, y: 0 });
  assert.deepEqual(leftSheetAnchor(webviews, trigger), { alignLeft: 0, y: 0 });
  assert.deepEqual(rightSheetAnchor(webviews, trigger), { alignRight: 150, y: 0 });
});
