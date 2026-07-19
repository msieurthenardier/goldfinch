'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const moduleUrl = pathToFileURL(path.join(__dirname, '../../src/renderer/chrome/tab-controller.js')).href;

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const next = force === undefined ? !this.values.has(name) : !!force;
    if (next) this.values.add(name); else this.values.delete(name);
    return next;
  }
}

class FakeElement {
  constructor(name = 'div') {
    this.name = name;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.attributes = new Map();
    this.parent = null;
    this.disabled = false;
    this.value = '';
    this.tabIndex = 0;
    this._parts = new Map();
  }
  set className(value) { value.split(/\s+/).filter(Boolean).forEach((name) => this.classList.add(name)); }
  set innerHTML(_value) {
    for (const selector of ['.tab-title', '.tab-close', '.tab-fav']) this._parts.set(selector, new FakeElement(selector));
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  insertBefore(child, reference) {
    this.children = this.children.filter((item) => item !== child);
    const index = reference == null ? -1 : this.children.indexOf(reference);
    child.parent = this;
    if (index < 0) this.children.push(child); else this.children.splice(index, 0, child);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((item) => item !== this);
    this.parent = null;
  }
  querySelector(selector) { return this._parts.get(selector) || null; }
  getBoundingClientRect() { return { x: 10, y: 20, left: 10, top: 20, right: 210, bottom: 120, width: 200, height: 100 }; }
}

function createHarness() {
  const tabs = new Map();
  const ctx = { tabs, activeTabId: null, tabSeq: 0, activeViewWcId: null, rafGeometryPending: false };
  const els = {
    tabs: new FakeElement('tabs'), tabstrip: new FakeElement('tabstrip'), webviews: new FakeElement('webviews'),
    address: new FakeElement('address'), privacyPanel: new FakeElement('privacy'),
    toggleMedia: new FakeElement(), togglePrivacy: new FakeElement(), toggleDevtools: new FakeElement()
  };
  els.privacyPanel.classList.add('collapsed');
  const documentListeners = new Map();
  const document = {
    createElement: (name) => new FakeElement(name),
    addEventListener: (name, fn) => documentListeners.set(name, fn)
  };
  const callbacks = {};
  const calls = [];
  let nextWcId = 100;
  const bridge = {
    internalPartition: 'goldfinch-internal',
    tabCreate(payload) { calls.push(['tabCreate', payload]); return Promise.resolve(nextWcId++); },
    tabSetActive(...args) { calls.push(['tabSetActive', ...args]); },
    tabSetBounds(...args) { calls.push(['tabSetBounds', ...args]); },
    tabHide(...args) { calls.push(['tabHide', ...args]); },
    tabClose(...args) { calls.push(['tabClose', ...args]); },
    tabDragStarted() {}, tabDragEnded() {}, tabAdoptByDrop: async () => ({ ok: true }), tabTearOff: async () => ({ ok: true }),
    findOverlayOpen() {}, isDevtoolsOpen: async () => false,
    onAdoptTab(fn) { callbacks.adopt = fn; },
    onTabMovedAway(fn) { callbacks.movedAway = fn; },
    onTriggerSendBounds(fn) { callbacks.bounds = fn; }
  };
  const window = { goldfinch: bridge };
  class FakeResizeObserver { constructor(fn) { this.fn = fn; } observe() {} }
  const jar = { id: 'persist', name: 'Default', color: '#123456', partition: 'persist:default' };
  const jarsClient = { containers: [jar], defaultId: jar.id, makeBurner: () => ({ id: 'burner', name: 'Burner', color: '#222222', partition: 'temp', burner: true }) };
  const noOp = () => {};
  const deps = {
    window, document, requestAnimationFrame: (fn) => { fn(); return 1; }, ResizeObserver: FakeResizeObserver,
    ctx, els, tabs, jarsClient,
    blankPrivacy: () => ({ net: null, fp: {}, permissions: [], cookies: null }),
    escapeHtml: String, openTabContextMenu: noOp, currentHomePage: () => 'https://home.example/',
    isInternalPageUrl: (url) => /^goldfinch:\/\/(settings|downloads|jars)$/.test(url),
    isSafeTabUrl: (url) => /^https?:/.test(url) || url === 'about:blank',
    resolveNewTabContainer: (containers, defaultId) => containers.find((item) => item.id === defaultId) || null,
    classifyDragPoint: () => ({ zone: 'reorder', index: 0 }),
    announceTabStatus: noOp, updateNavButtons: noOp, refreshZoomControl: noOp, fetchCookies: noOp,
    closeSuggestions: noOp, resetSuggestionsForActivation: noOp, updateAddressChip: noOp,
    renderMedia: noOp, renderPrivacy: noOp, setDevtoolsPressed: noOp
  };
  return { deps, tabs, ctx, els, callbacks, calls, jar };
}

async function loadController(harness) {
  const { createTabController } = await import(moduleUrl);
  return createTabController(harness.deps);
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('safe and trusted create paths preserve URL gates, jar routing, strip ARIA, and activation', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  assert.equal(controller.createTab('javascript:alert(1)'), null);
  assert.equal(controller.createTab('goldfinch://settings'), null);
  assert.equal(h.calls.length, 0);

  const web = controller.createTab('https://example.test/');
  const internal = controller.createTab('goldfinch://settings', null, { trusted: true });
  await settle();

  assert.equal(web.container, h.jar);
  assert.equal(internal.container.id, 'internal');
  assert.equal(internal.container.partition, 'goldfinch-internal');
  assert.deepEqual(controller.orderedTabIds(), [web.id, internal.id]);
  assert.equal(web.btn.getAttribute('role'), 'tab');
  assert.equal(internal.btn.getAttribute('aria-selected'), 'true');
  assert.equal(controller.activeTab(), internal);
  assert.deepEqual(h.calls.filter(([name]) => name === 'tabCreate').map(([, payload]) => payload.trusted), [false, true]);
});

test('ordered movement, close fallback, and geometry use the live strip and shared context', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  const a = controller.createTab('https://a.test/');
  const b = controller.createTab('https://b.test/');
  const c = controller.createTab('https://c.test/');
  await settle();

  controller.commitTabMove(c.id, 0);
  assert.deepEqual(controller.orderedTabIds(), [c.id, a.id, b.id]);
  controller.closeTab(c.id);
  assert.deepEqual(controller.orderedTabIds(), [a.id, b.id]);
  assert.equal(controller.activeTab(), b);
  assert.deepEqual(controller.measureWebviewsSlotDIP(), { x: 10, y: 20, width: 200, height: 100 });
  controller.sendActiveBounds();
  assert.ok(h.calls.some(([name, wcId]) => name === 'tabSetBounds' && wcId === b.wcId));
});

test('cross-window adopt and moved-away reuse the strip authority without create or close IPC', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  const first = controller.createTab('https://first.test/');
  await settle();
  const createCount = h.calls.filter(([name]) => name === 'tabCreate').length;

  h.callbacks.adopt({ wcId: 777, url: 'https://adopted.test/', title: 'Adopted', favicon: null, container: h.jar });
  assert.equal(h.calls.filter(([name]) => name === 'tabCreate').length, createCount);
  assert.equal(controller.activeTab().wcId, 777);
  assert.equal(controller.findTabByWcId(777).title, 'Adopted');

  const closesBefore = h.calls.filter(([name]) => name === 'tabClose').length;
  h.callbacks.movedAway({ wcId: 777 });
  assert.equal(controller.findTabByWcId(777), null);
  assert.equal(controller.activeTab(), first);
  assert.equal(h.calls.filter(([name]) => name === 'tabClose').length, closesBefore);
});
