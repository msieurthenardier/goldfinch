'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '../../src/renderer/chrome/shortcut-controller.js')).href;

function harness() {
  const calls = []; const listeners = {}; const forwarded = {};
  const tab = { id: 'b', wcId: 22, internal: false };
  const state = { active: tab };
  const els = { address: { focus: () => calls.push('focus'), select: () => calls.push('select') }, lightbox: { classList: { contains: () => true } } };
  const window = { goldfinch: {
    toggleDevtools: (x) => calls.push(['devtools', x]), zoomApply: (x) => calls.push(['zoom', x]), windowCreate: () => calls.push('window'),
    tabReopen: async () => null, tabNavigate: (x) => calls.push(['reload', x]), onChromeShortcutAction: (fn) => { forwarded.fn = fn; }
  } };
  const deps = {
    window, document: { addEventListener: (name, fn) => { listeners[name] = fn; } }, ctx: { activeTabId: 'b' }, els,
    activeTab: () => state.active, isInternalTab: (t) => !!t?.internal, isWebTab: (t) => !!t && !t.internal,
    openFind: (t) => calls.push(['find', t.id]), createTab: (...x) => calls.push(['create', ...x]), closeTab: (id) => calls.push(['close', id]),
    jarsClient: { inheritContainerFromPartition: () => ({ id: 'jar' }) }, announceTabStatus: (x) => calls.push(['announce', x]),
    togglePanel: () => calls.push('panel'), togglePrivacy: () => calls.push('privacy'), openDownloads: () => calls.push('downloads'),
    orderedTabIds: () => ['a', 'b', 'c'], activateTab: (id) => { calls.push(['activate', id]); deps.ctx.activeTabId = id; },
    keydownToAction: ({ key }) => key === 'F12' ? 'devtools' : key === 'j' ? 'downloads' : null
  };
  return { deps, state, tab, calls, listeners, forwarded };
}

async function create(h) {
  const { createShortcutController } = await import(moduleUrl);
  return createShortcutController(h.deps);
}

test('guarded actions refuse internal tabs without claiming prevent-default', async () => {
  const h = harness(); const controller = await create(h);
  h.state.active = { ...h.tab, internal: true };
  for (const action of ['devtools', 'zoom-in', 'zoom-out', 'zoom-reset', 'find']) {
    assert.equal(controller.dispatchChromeAction(action), false, action);
  }
  assert.deepEqual(h.calls, []);
  assert.equal(controller.dispatchChromeAction('reload'), true);
  assert.equal(controller.dispatchChromeAction('downloads'), true);
  assert.deepEqual(h.calls, [], 'reload and downloads are swallowed but remain inert on internal tabs');
});

test('every shortcut action maps to its existing tab, window, panel, and navigation body', async () => {
  const h = harness(); const controller = await create(h);
  const actions = ['devtools','zoom-in','zoom-out','zoom-reset','find','new-tab','close-tab','new-window','reopen-closed-tab','focus-address','toggle-panel','toggle-privacy','reload','downloads','tab-next','tab-prev','tab-jump-1','tab-jump-8','tab-jump-last'];
  for (const action of actions) assert.equal(controller.dispatchChromeAction(action), true, action);
  assert.ok(h.calls.some(([name]) => name === 'devtools'));
  assert.equal(h.calls.filter((item) => Array.isArray(item) && item[0] === 'zoom').length, 3);
  assert.ok(h.calls.some((item) => Array.isArray(item) && item[0] === 'find'));
  assert.ok(h.calls.includes('window') && h.calls.includes('panel') && h.calls.includes('privacy') && h.calls.includes('downloads'));
  assert.ok(h.calls.some((item) => Array.isArray(item) && item[0] === 'activate' && item[1] === 'c'));
  assert.equal(controller.dispatchChromeAction('unknown'), false);
});

test('classifier dispatch prevents default only for handled actions and forwarded actions reuse it', async () => {
  const h = harness(); await create(h);
  let prevented = false;
  h.listeners.keydown({ key: 'F12', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  h.state.active = { ...h.tab, internal: true };
  prevented = false;
  h.listeners.keydown({ key: 'F12', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false);
  h.state.active = h.tab;
  h.forwarded.fn({ action: 'new-window' });
  assert.ok(h.calls.includes('window'));
});
