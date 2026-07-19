'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '../../src/renderer/chrome/navigation-controller.js')).href;

class El {
  constructor() {
    this.listeners = new Map(); this.attributes = new Map(); this.value = ''; this.textContent = '';
    this.disabled = false; this.readOnly = false; this.blurred = false;
    this.classList = { values: new Set(), add: (x) => this.classList.values.add(x), remove: (x) => this.classList.values.delete(x), contains: (x) => this.classList.values.has(x) };
  }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  blur() { this.blurred = true; }
}

function harness() {
  const names = ['address', 'addressChip', 'back', 'forward', 'reload', 'newTab', 'zoomControl', 'zoomPercent', 'zoomOut', 'zoomIn', 'zoomReset', 'lightbox'];
  const els = Object.fromEntries(names.map((name) => [name, new El()]));
  els.lightbox.classList.add('hidden');
  const state = { active: null, suggestions: { open: false, token: 0 }, openedModels: [], calls: [] };
  const callbacks = {};
  let suggestResolve;
  let zoomResolve;
  const window = { goldfinch: {
    tabNavigate: (payload) => state.calls.push(['navigate', payload]),
    historySuggest: () => new Promise((resolve) => { suggestResolve = resolve; }),
    getZoom: () => new Promise((resolve) => { zoomResolve = resolve; }),
    zoomApply: (payload) => state.calls.push(['zoom', payload]),
    findOverlayOpen: (payload) => state.calls.push(['find', payload]),
    onZoomChanged: (fn) => { callbacks.zoomChanged = fn; },
    onOpenFind: (fn) => { callbacks.openFind = fn; },
    onOpenDownloads: (fn) => { callbacks.openDownloads = fn; }
  } };
  const document = { activeElement: els.address };
  const ctx = { activeTabId: null };
  const deps = {
    window, document, ctx, els,
    activeTab: () => state.active,
    isInternalTab: (tab) => !!tab?.internal,
    isWebTab: (tab) => !!tab && !tab.internal,
    createTab: (url) => state.calls.push(['create', url]),
    openDownloads: () => state.calls.push(['downloads']),
    isInternalPageUrl: (url) => url.startsWith('goldfinch://'),
    shouldQuery: ({ focused, isInternal, isBurner, value }) => focused && !isInternal && !isBurner && !!value.trim(),
    buildSuggestionModel: (items, selectedIndex) => ({ items, selectedIndex }),
    moveSelection: (index, delta, length) => length ? Math.max(0, Math.min(length - 1, index + delta)) : -1,
    acceptSuggestResponse: ({ requestSeq, currentSeq, gateNow }) => requestSeq === currentSeq && gateNow,
    suggestionsState: () => state.suggestions,
    closeOverlayMenu: () => { state.suggestions.open = false; },
    openOverlayMenu: (_type, model) => { state.suggestions.open = true; state.openedModels.push(model); },
    leftAnchorOf: () => ({ x: 0, y: 0 })
  };
  return { deps, state, els, ctx, callbacks, resolveSuggest: (value) => suggestResolve(value), resolveZoom: (value) => zoomResolve(value) };
}

async function create(h) {
  const { createNavigationController } = await import(moduleUrl);
  return createNavigationController(h.deps);
}

test('URL conversion and navigation preserve internal-tab refusal and web-tab capture', async () => {
  const h = harness();
  const controller = await create(h);
  assert.equal(controller.toUrl('example.com/path'), 'https://example.com/path');
  assert.equal(controller.toUrl('hello world'), 'https://www.google.com/search?q=hello%20world');

  h.state.active = { id: 'internal', internal: true, wcId: 1 };
  controller.navigate('example.com');
  assert.deepEqual(h.state.calls.pop(), ['create', 'https://example.com']);
  h.state.active = { id: 'web', internal: false, wcId: 9 };
  controller.navigate('https://example.test/');
  assert.deepEqual(h.state.calls.pop(), ['navigate', { wcId: 9, verb: 'loadURL', args: ['https://example.test/'] }]);
});

test('suggestion responses are rejected after the tab controller invalidates on switch', async () => {
  const h = harness();
  const controller = await create(h);
  h.state.active = { id: 'a', container: { id: 'jar-a' } };
  h.ctx.activeTabId = 'a';
  h.els.address.value = 'gold';
  h.els.address.listeners.get('input')();
  await new Promise((resolve) => setTimeout(resolve, 110));
  h.state.active = { id: 'b', container: { id: 'jar-b' } };
  h.ctx.activeTabId = 'b';
  h.els.address.value = 'changed';
  controller.resetSuggestionsForActivation();
  h.resolveSuggest({ ok: true, suggestions: [{ url: 'https://stale.test/' }] });
  await Promise.resolve();
  assert.deepEqual(h.state.openedModels, []);
});

test('zoom readback drops a result after TOCTOU tab switch and find restores saved text', async () => {
  const h = harness();
  const controller = await create(h);
  const a = { id: 'a', wcId: 10, internal: false, findText: 'needle', findOpen: false };
  const b = { id: 'b', wcId: 11, internal: false };
  h.state.active = a; h.ctx.activeTabId = a.id;
  const pending = controller.refreshZoomControl(a);
  h.state.active = b; h.ctx.activeTabId = b.id;
  h.resolveZoom(1.5);
  await pending;
  assert.equal(h.els.zoomPercent.textContent, '');

  h.state.active = a; h.ctx.activeTabId = a.id;
  controller.openFind(a);
  assert.equal(a.findOpen, true);
  assert.deepEqual(h.state.calls.pop(), ['find', { wcId: 10, findText: 'needle' }]);
  controller.openFind({ id: 'internal', wcId: 12, internal: true });
  assert.equal(h.state.calls.some(([name, payload]) => name === 'find' && payload.wcId === 12), false);
});
