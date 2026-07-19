'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '../../src/renderer/chrome/privacy-controller.js')).href;

class El {
  constructor() {
    this.listeners = new Map(); this.children = []; this.attributes = new Map(); this.style = {};
    this.textContent = ''; this.innerHTML = ''; this.disabled = false;
    this.classList = { values: new Set(), add: (x) => this.classList.values.add(x), remove: (x) => this.classList.values.delete(x), contains: (x) => this.classList.values.has(x), toggle: (x, on) => on ? this.classList.values.add(x) : this.classList.values.delete(x) };
  }
  set className(value) { value.split(/\s+/).filter(Boolean).forEach((x) => this.classList.add(x)); }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  focus() { this.focused = true; }
  contains(node) { return this.children.includes(node); }
}

function harness() {
  const names = ['address','automationIndicator','automationIndicatorBadge','privacyBody','privacyClose','privacyCount','privacyPanel','privacyRefresh','toggleDevtools','togglePrivacy'];
  const els = Object.fromEntries(names.map((name) => [name, new El()]));
  els.privacyPanel.classList.add('collapsed');
  const document = { activeElement: null, createElement: () => new El() };
  const ctx = { activeTabId: 'a' };
  const calls = []; const toasts = []; const callbacks = {};
  let identityResolve;
  const baseShields = { enabled: true, block: true, strip: true, isolate: true, farble: true, pausedSites: [] };
  const bridge = {
    onDevtoolsStateChanged: (fn) => { callbacks.devtools = fn; }, onPrivacyNet: (fn) => { callbacks.net = fn; }, onPrivacyPermission: (fn) => { callbacks.permission = fn; },
    shieldsGet: async () => baseShields, onShieldsChanged: (fn) => { callbacks.shields = fn; },
    automationGetActivity: async () => ({ sessions: [] }), onAutomationActivity: (fn) => { callbacks.activity = fn; }, settingsGet: async () => ({}),
    shieldsSet: async (value) => { calls.push(['shieldsSet', value]); return { ...baseShields, ...value }; },
    shieldsPause: async (value) => { calls.push(['shieldsPause', value]); return { ...baseShields, pausedSites: value.paused ? [value.site] : [] }; },
    privacyClearCookies: async (value) => { calls.push(['clearCookies', value]); return { removed: 2 }; },
    privacyClearStorage: async (value) => { calls.push(['clearStorage', value]); return { ok: true, origin: 'https://example.test' }; },
    privacyCookies: async () => [],
    identityNew: (value) => { calls.push(['identityNew', value]); return new Promise((resolve) => { identityResolve = resolve; }); },
    tabNavigate: (value) => calls.push(['navigate', value]), toggleDevtools: async () => false
  };
  const window = { goldfinch: bridge };
  const tabA = { id: 'a', wcId: 10, url: 'https://www.example.test/page', internal: false, container: { id: 'jar-a', name: 'A', color: '#123456', partition: 'persist:a' }, privacy: { net: { firstParty: 'example.test', trackers: { count: 3, blocked: 3 }, stripped: 0, cookiesBlocked: 0 }, fp: {}, permissions: [], cookies: [] } };
  const tabB = { ...tabA, id: 'b', wcId: 20, container: { ...tabA.container, id: 'jar-b', partition: 'persist:b' } };
  const state = { active: tabA, models: [] };
  const deps = {
    window, document, ctx, els, activeTab: () => state.active, findTabByWcId: () => null,
    isInternalTab: (tab) => !!tab?.internal, isWebTab: (tab) => !!tab && !tab.internal,
    togglePanel: () => {}, sendActiveBounds: () => {}, openToolbarContextMenu: () => {},
    toast: (...args) => toasts.push(args), jarsClient: { containers: [tabA.container, tabB.container] },
    buildAutomationIndicatorModel: (input) => { state.models.push(input); return { visible: true, mode: input.adminActive ? 'admin' : 'idle', color: null, count: input.enabledJarKeyCount }; },
    isSafeColor: () => true, escapeHtml: String, isInternalPageUrl: (url) => url.startsWith('goldfinch://')
  };
  return { deps, state, tabA, tabB, ctx, els, calls, toasts, resolveIdentity: (value) => identityResolve(value) };
}

async function create(h) {
  const { createPrivacyController } = await import(moduleUrl);
  const controller = createPrivacyController(h.deps);
  await Promise.resolve();
  return controller;
}

test('Shields changes and site pause persist without implicit reload', async () => {
  const h = harness(); const controller = await create(h);
  await controller.setShield('block', false);
  await controller.toggleSitePause();
  assert.deepEqual(h.calls.slice(0, 2), [
    ['shieldsSet', { block: false }],
    ['shieldsPause', { site: 'example.test', paused: true }]
  ]);
  assert.equal(h.calls.some(([name]) => name === 'navigate'), false, 'Shields apply only after the explicit reload action');
});

test('cookie and storage clearing preserve active tab payloads and user feedback', async () => {
  const h = harness(); const controller = await create(h);
  await controller.clearCookies('site');
  await controller.clearStorage();
  assert.deepEqual(h.calls.find(([name]) => name === 'clearCookies')[1], { webContentsId: 10, scope: 'site', url: h.tabA.url });
  assert.deepEqual(h.calls.find(([name]) => name === 'clearStorage')[1], { url: h.tabA.url, webContentsId: 10 });
  assert.ok(h.toasts.some(([title]) => title === 'Cookies cleared'));
  assert.ok(h.toasts.some(([title]) => title === 'Site storage cleared'));
});

test('new identity captures the initiating tab across await and refuses internal tabs', async () => {
  const h = harness(); const controller = await create(h);
  const pending = controller.newIdentity();
  h.state.active = h.tabB; h.ctx.activeTabId = 'b';
  h.resolveIdentity({ ok: true });
  await pending;
  assert.deepEqual(h.calls.find(([name]) => name === 'identityNew')[1], { partition: 'persist:a' });
  assert.deepEqual(h.calls.find(([name]) => name === 'navigate')[1], { wcId: 10, verb: 'reload', args: [] });
  const before = h.calls.length;
  h.state.active = { ...h.tabB, internal: true };
  await controller.newIdentity();
  assert.equal(h.calls.length, before);
});

test('privacy badge and automation cache reconciliation derive from authoritative snapshots', async () => {
  const h = harness(); const controller = await create(h);
  controller.updatePrivacyBadge();
  assert.equal(h.els.privacyCount.textContent, '3');
  assert.equal(h.els.togglePrivacy.attributes.get('aria-label'), 'Shields, 3 blocked');

  controller.updateAutomationIndicator({ sessions: [{ jarId: 'jar-a', kind: 'jar' }] });
  controller.updateAutomationKeyState({ automationKeyHashes: ['one'], automationAdminKeyHash: 'admin' });
  const last = h.state.models.at(-1);
  assert.deepEqual(last.activeJarIds, ['jar-a']);
  assert.equal(last.enabledJarKeyCount, 1);
  assert.equal(last.adminKeyEnabled, true);
});
