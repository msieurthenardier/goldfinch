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
  const els = Object.fromEntries(['winMin','winMax','winClose','tabs','tabStatus','toggleMedia','togglePrivacy','toggleDevtools','bookmarksBar'].map((name) => [name, new El()]));
  // index.html's real markup starts #bookmarks-bar with class="hidden" — the
  // net-visibility-change discipline (M15 F2 Leg 3, L3-DD-C) relies on that
  // starting DOM state matching the controller's own initial `barVisible =
  // false`, so the fixture must replicate it (a bare fresh element with no
  // classes at all would desync the two).
  els.bookmarksBar.classList.toggle('hidden', true);
  const window = { goldfinch: {
    windowMinimize: () => calls.push('minimize'), windowToggleMaximize: () => calls.push('maximize'), windowClose: () => calls.push('close'),
    windowIsMaximized: async () => false, onWindowMaximizedChange: (fn) => { callbacks.maximized = fn; },
    settingsGet: async (key) => key === 'bookmarksBarEnabled' ? false : { media: true, shields: false, devtools: true },
    onSettingsChanged: (fn) => { callbacks.settings = fn; }
  } };
  const deps = {
    window, document: { activeElement: null }, ctx: { activeTabId: null }, els, tabs: new Map(),
    orderedTabIds: () => [], releaseTabWidths: () => {}, keyboardMove: (ids) => ids, commitTabMove: () => {},
    activateTab: () => {}, closeTab: () => {}, activeTab: () => null,
    setHomePage: (value) => calls.push(['home', value]), updateAutomationKeyState: (value) => calls.push(['keys', value]),
    sendActiveBounds: () => calls.push('bounds')
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

test('applyBookmarksBar toggles visibility and sends active bounds ONLY on a net visibility change (M15 F2 Leg 3, L3-DD-C)', async () => {
  const h = await harness();
  await Promise.resolve(); // let the initial settingsGet('bookmarksBarEnabled') resolve
  assert.equal(h.els.bookmarksBar.classList.contains('hidden'), true, 'off by default');
  h.calls.length = 0;

  h.controller.applyBookmarksBar(true);
  assert.equal(h.els.bookmarksBar.classList.contains('hidden'), false);
  assert.ok(h.calls.includes('bounds'), 'a net change (hidden -> visible) fires the explicit bounds send');

  h.calls.length = 0;
  h.controller.applyBookmarksBar(false);
  assert.equal(h.els.bookmarksBar.classList.contains('hidden'), true);
  assert.ok(h.calls.includes('bounds'), 'a net change (visible -> hidden) fires it too');

  // A repeat apply with the SAME value is not a net change — no DOM toggle,
  // no bounds send (the same-class tab-switch case this discipline exists
  // to keep quiet).
  h.calls.length = 0;
  h.controller.applyBookmarksBar(false);
  assert.equal(h.els.bookmarksBar.classList.contains('hidden'), true);
  assert.equal(h.calls.includes('bounds'), false, 'no net change — no spurious bounds send');
});

test('setBarSuppressed composes with the setting: enabled + suppressed still hides; suppression alone (setting off) is already-hidden, no net change (L3-DD-C)', async () => {
  const h = await harness();
  await Promise.resolve();
  h.controller.applyBookmarksBar(true); // setting ON — bar visible
  assert.equal(h.els.bookmarksBar.classList.contains('hidden'), false);
  h.calls.length = 0;

  // Activating a burner/internal tab suppresses it even though the setting stays ON.
  h.controller.setBarSuppressed(true);
  assert.equal(h.els.bookmarksBar.classList.contains('hidden'), true);
  assert.ok(h.calls.includes('bounds'), 'net change (visible -> hidden) — bounds sent');

  // Setting toggled OFF while ALREADY suppressed: enabled&&!suppressed stays
  // false either way — no net change, no spurious DOM/bounds churn.
  h.calls.length = 0;
  h.controller.applyBookmarksBar(false);
  assert.equal(h.els.bookmarksBar.classList.contains('hidden'), true);
  assert.equal(h.calls.includes('bounds'), false, 'still hidden either way — no net change');

  // Switching back to a web tab (suppression lifted) with the setting still
  // off stays hidden too (enabled is false) — no net change.
  h.calls.length = 0;
  h.controller.setBarSuppressed(false);
  assert.equal(h.els.bookmarksBar.classList.contains('hidden'), true);
  assert.equal(h.calls.includes('bounds'), false);

  // Re-enable the setting with suppression already lifted: NOW it's a net change.
  h.calls.length = 0;
  h.controller.applyBookmarksBar(true);
  assert.equal(h.els.bookmarksBar.classList.contains('hidden'), false);
  assert.ok(h.calls.includes('bounds'));
});

test('bookmarksBarEnabled syncs live from the settings-changed broadcast (multi-window sync)', async () => {
  const h = await harness();
  await Promise.resolve();
  h.calls.length = 0;
  h.callbacks.settings({ bookmarksBarEnabled: true, toolbarPins: { media: true, shields: true, devtools: true } });
  assert.equal(h.els.bookmarksBar.classList.contains('hidden'), false);
  assert.ok(h.calls.includes('bounds'));
});
