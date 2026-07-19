'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '../../src/renderer/chrome/window-controller.js')).href;

class El {
  constructor() { this.listeners = new Map(); this.attributes = new Map(); this.classList = { values: new Set(), toggle: (x, on) => on ? this.classList.values.add(x) : this.classList.values.delete(x), contains: (x) => this.classList.values.has(x) }; this.textContent = ''; }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
}

async function harness() {
  const callbacks = {}; const calls = [];
  const els = Object.fromEntries(['winMin','winMax','winClose','tabs','tabStatus','toggleMedia','togglePrivacy','toggleDevtools'].map((name) => [name, new El()]));
  const window = { goldfinch: {
    windowMinimize: () => calls.push('minimize'), windowToggleMaximize: () => calls.push('maximize'), windowClose: () => calls.push('close'),
    windowIsMaximized: async () => false, onWindowMaximizedChange: (fn) => { callbacks.maximized = fn; },
    settingsGet: async () => ({ media: true, shields: false, devtools: true }), onSettingsChanged: (fn) => { callbacks.settings = fn; }
  } };
  const deps = {
    window, document: { activeElement: null }, ctx: { activeTabId: null }, els, tabs: new Map(),
    orderedTabIds: () => [], releaseTabWidths: () => {}, keyboardMove: (ids) => ids, commitTabMove: () => {},
    activateTab: () => {}, closeTab: () => {}, activeTab: () => null,
    setHomePage: (value) => calls.push(['home', value]), updateAutomationKeyState: (value) => calls.push(['keys', value])
  };
  const { createWindowController } = await import(moduleUrl);
  const controller = createWindowController(deps);
  await Promise.resolve();
  return { controller, callbacks, calls, els };
}

test('maximize state and window controls preserve labels and bridge mappings', async () => {
  const h = await harness();
  h.callbacks.maximized(true);
  assert.equal(h.els.winMax.attributes.get('data-state'), 'maximized');
  assert.equal(h.els.winMax.attributes.get('aria-label'), 'Restore');
  assert.equal(h.els.winMax.title, 'Restore');
  h.els.winMin.listeners.get('click')(); h.els.winMax.listeners.get('click')(); h.els.winClose.listeners.get('click')();
  assert.deepEqual(h.calls.slice(-3), ['minimize', 'maximize', 'close']);
});

test('toolbar pins and settings broadcasts stay independent of active-tab type', async () => {
  const h = await harness();
  h.controller.applyToolbarPins({ media: false, shields: true, devtools: false });
  assert.equal(h.els.toggleMedia.classList.contains('hidden'), true);
  assert.equal(h.els.togglePrivacy.classList.contains('hidden'), false);
  assert.equal(h.els.toggleDevtools.classList.contains('hidden'), true);
  h.callbacks.settings({ homePage: 'https://home.test/', toolbarPins: { media: true, shields: true, devtools: true }, automationKeyHashes: [] });
  assert.ok(h.calls.some((item) => Array.isArray(item) && item[0] === 'home'));
  assert.ok(h.calls.some((item) => Array.isArray(item) && item[0] === 'keys'));
});
