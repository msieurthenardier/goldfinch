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
    tabNavigate(payload) { calls.push(['tabNavigate', payload]); },
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
  // M16 F2 Leg 1/2: mutable boxes so tests can flip the resolved home page /
  // search engine mid-test without reconstructing the controller
  // (currentHomePage/currentSearchEngine are destructured once at
  // construction; the FUNCTION reference stays the same, only the value it
  // reads changes).
  let homePageValue = 'https://home.example/';
  let searchEngineValue = 'google';
  const deps = {
    window, document, requestAnimationFrame: (fn) => { fn(); return 1; }, ResizeObserver: FakeResizeObserver,
    ctx, els, tabs, jarsClient,
    blankPrivacy: () => ({ net: null, fp: {}, permissions: [], cookies: null }),
    escapeHtml: String, openTabContextMenu: noOp, currentHomePage: () => homePageValue,
    currentSearchEngine: () => searchEngineValue, // M16 F2 Leg 2 (DD7): openNewTab's reasons rule
    isInternalPageUrl: (url) => /^goldfinch:\/\/(settings|downloads|jars|vault)$/.test(url),
    isSafeTabUrl: (url) => /^https?:/.test(url) || url === 'about:blank',
    resolveNewTabContainer: (containers, defaultId) => containers.find((item) => item.id === defaultId) || null,
    classifyDragPoint: () => ({ zone: 'reorder', index: 0 }),
    announceTabStatus: noOp, updateNavButtons: noOp, refreshZoomControl: noOp, refreshStar: noOp, fetchCookies: noOp,
    closeSuggestions: noOp, resetSuggestionsForActivation: noOp, updateAddressChip: noOp,
    renderMedia: noOp, renderPrivacy: noOp, setDevtoolsPressed: noOp,
    // M15 F2 Leg 3 (DD7 table 3/5, 4/5): the two activation-class bar-render
    // trigger sites — tracked (not a no-op) so the tests below can pin that
    // both actually call it.
    refreshBookmarksSurfaces: (tab) => calls.push(['refreshBookmarksSurfaces', tab && tab.id]),
    // M16 F2 Leg 1 (DD1/DD7): the welcome-panel toggle — tracked so tests can
    // pin that activateTab/onViewCreated drive it correctly.
    showWelcomePanel: (tab) => calls.push(['showWelcomePanel', tab && tab.id]),
    hideWelcomePanel: () => calls.push(['hideWelcomePanel'])
  };
  return {
    deps, tabs, ctx, els, callbacks, calls, jar,
    setHomePage: (v) => { homePageValue = v; },
    setSearchEngine: (v) => { searchEngineValue = v; }
  };
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
  // M15 F2 Leg 3 (DD7 table 3/5, 4/5): activateTab's synchronous body (both
  // createTab calls above self-activate) AND the wcId-arrival path both call
  // refreshBookmarksSurfaces for the tab they concern.
  const bookmarksSurfacesIds = new Set(
    h.calls.filter(([name]) => name === 'refreshBookmarksSurfaces').map(([, id]) => id)
  );
  assert.deepEqual(bookmarksSurfacesIds, new Set([web.id, internal.id]));
});

test('trusted internal jar name is derived per host, including vault (squawk 0009)', async () => {
  const h = createHarness();
  const controller = await loadController(h);

  const settings = controller.createTab('goldfinch://settings', null, { trusted: true });
  const downloads = controller.createTab('goldfinch://downloads', null, { trusted: true });
  const jars = controller.createTab('goldfinch://jars', null, { trusted: true });
  const vault = controller.createTab('goldfinch://vault', null, { trusted: true });
  await settle();

  assert.equal(settings.container.name, 'Settings');
  assert.equal(downloads.container.name, 'Downloads');
  assert.equal(jars.container.name, 'Cookie Jars');
  // Matches the label the Vault page and kebab menu item both use ("Secrets" —
  // src/renderer/pages/vault.html's <title>/<h1> and overlay-menus.js's kebab
  // entry), not the host name.
  assert.equal(vault.container.name, 'Secrets');
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

// ---------------------------------------------------------------------------
// M16 F2 Leg 1 (DD1/DD2/DD4): the viewless welcome record, its attach
// primitive, and the openNewTab resolver.
// ---------------------------------------------------------------------------

test('openWelcomeTab builds a viewless record with no tabCreate IPC, the right jar, reasons, and strip title', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  const tab = controller.openWelcomeTab({ reasons: ['home'] });
  await settle();
  assert.equal(tab.wcId, null);
  assert.equal(tab.container, h.jar);
  assert.ok(tab.welcome.reasons.has('home'));
  assert.equal(tab.welcome.pendingQuery, null);
  assert.equal(tab.title, 'Welcome to Goldfinch');
  assert.equal(tab.btn.querySelector('.tab-title').textContent, 'Welcome to Goldfinch');
  assert.equal(h.calls.filter(([name]) => name === 'tabCreate').length, 0);
  assert.equal(controller.activeTab(), tab);
  // Welcome-panel toggle fires on the self-activation this constructor runs.
  assert.ok(h.calls.some(([name, id]) => name === 'showWelcomePanel' && id === tab.id));
});

test('the welcome panel hides when switching to an ordinary tab and re-shows when switching back', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  const welcome = controller.openWelcomeTab({ reasons: ['home'] });
  const web = controller.createTab('https://example.test/');
  await settle();
  assert.ok(h.calls.some(([name]) => name === 'hideWelcomePanel'));
  assert.equal(controller.activeTab(), web);
  h.calls.length = 0;
  controller.activateTab(welcome.id);
  assert.ok(h.calls.some(([name, id]) => name === 'showWelcomePanel' && id === welcome.id));
  h.calls.length = 0;
  controller.activateTab(web.id);
  assert.ok(h.calls.some(([name]) => name === 'hideWelcomePanel'));
});

test('openWelcomeTab resolves a burner jar when the resolver yields none', async () => {
  const h = createHarness();
  h.deps.resolveNewTabContainer = () => null; // force the makeBurner() fallback
  const controller = await loadController(h);
  const tab = controller.openWelcomeTab({ reasons: ['home'] });
  assert.equal(tab.container.burner, true);
});

test('attachView sends exactly one tabCreate with the record\'s partition, clears welcome, and runs onViewCreated', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  const tab = controller.openWelcomeTab({ reasons: ['home'] });
  h.calls.length = 0;
  controller.attachView(tab, 'https://example.test/');
  // Synchronous: welcome cleared and the panel hidden BEFORE tabCreate resolves.
  assert.equal(tab.welcome, null);
  assert.ok(h.calls.some(([name]) => name === 'hideWelcomePanel'));
  await settle();
  assert.equal(h.calls.filter(([name]) => name === 'tabCreate').length, 1);
  const [, payload] = h.calls.find(([name]) => name === 'tabCreate');
  assert.equal(payload.partition, tab.container.partition);
  assert.equal(payload.trusted, false);
  assert.equal(tab.wcId, 100);
  // The record kept its id and strip position (still the only tab).
  assert.deepEqual(controller.orderedTabIds(), [tab.id]);
});

test('attachView refuses an unsafe URL and leaves the record untouched (address bar keeps the text)', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  const tab = controller.openWelcomeTab({ reasons: ['home'] });
  controller.attachView(tab, 'javascript:alert(1)');
  assert.notEqual(tab.welcome, null);
  assert.equal(tab.wcId, null);
  assert.equal(h.calls.filter(([name]) => name === 'tabCreate').length, 0);
});

test('attachView racing a second navigate queues only the latest URL and applies it once the first attach resolves', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  const tab = controller.openWelcomeTab({ reasons: ['home'] });
  controller.attachView(tab, 'https://first.test/');
  controller.attachView(tab, 'https://second.test/'); // races the in-flight attach
  controller.attachView(tab, 'https://third.test/'); // only the latest survives
  await settle();
  assert.equal(h.calls.filter(([name]) => name === 'tabCreate').length, 1);
  const navCalls = h.calls.filter(([name]) => name === 'tabNavigate');
  assert.equal(navCalls.length, 1);
  assert.deepEqual(navCalls[0][1], { wcId: tab.wcId, verb: 'loadURL', args: ['https://third.test/'] });
});

test('openNewTab routes an unset home page to a welcome tab and a set one to createTab', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  h.setHomePage(null);
  const welcome = controller.openNewTab();
  assert.ok(welcome.welcome);
  assert.equal(welcome.welcome.reasons.has('home'), true);

  h.setHomePage('https://home.example/');
  const web = controller.openNewTab();
  await settle();
  assert.equal(web.welcome, undefined);
  assert.ok(h.calls.some(([name, payload]) => name === 'tabCreate' && payload.url === 'https://home.example/'));
});

// M16 F2 Leg 2 (DD7): welcomeReasons is pure and unit-pinned directly.
test('welcomeReasons: home always present, search only when the engine is unset', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  assert.deepEqual(controller.welcomeReasons('https://home.example/', 'google'), ['home']);
  assert.deepEqual(controller.welcomeReasons(null, 'google'), ['home']);
  assert.deepEqual(controller.welcomeReasons(null, null), ['home', 'search']);
  assert.deepEqual(controller.welcomeReasons('https://home.example/', null), ['home', 'search']);
});

// M16 F2 Leg 2 (DD7): openNewTab opens BOTH blocks when both preferences are
// unset, and stays a normal tab (regardless of the engine) once the home
// page is set — the engine is entirely openNewTab's own business only while
// the home page is unset.
test('openNewTab opens a welcome tab with {home, search} reasons when both preferences are unset', async () => {
  const h = createHarness();
  h.setHomePage(null);
  h.setSearchEngine(null);
  const controller = await loadController(h);
  const welcome = controller.openNewTab();
  assert.ok(welcome.welcome);
  assert.deepEqual([...welcome.welcome.reasons].sort(), ['home', 'search']);
});

test('openNewTab opens a welcome tab with only the {home} reason when the home page is unset but an engine is chosen', async () => {
  const h = createHarness();
  h.setHomePage(null);
  h.setSearchEngine('duckduckgo');
  const controller = await loadController(h);
  const welcome = controller.openNewTab();
  assert.ok(welcome.welcome);
  assert.deepEqual([...welcome.welcome.reasons], ['home']);
});

test('openNewTab opens a normal tab when the home page is set, regardless of the engine', async () => {
  const h = createHarness();
  h.setHomePage('https://home.example/');
  h.setSearchEngine(null);
  const controller = await loadController(h);
  const web = controller.openNewTab();
  await settle();
  assert.equal(web.welcome, undefined);
  assert.ok(h.calls.some(([name, payload]) => name === 'tabCreate' && payload.url === 'https://home.example/'));
});

test('applyToolbarAffordances: the toolbar buttons are disabled before wcId arrives and re-enabled once it does (positive control)', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  const tab = controller.createTab('https://example.test/');
  // activateTab ran synchronously with wcId still null — buttons must be disabled.
  assert.equal(h.els.toggleMedia.disabled, true);
  assert.equal(h.els.togglePrivacy.disabled, true);
  assert.equal(h.els.toggleDevtools.disabled, true);
  await settle();
  // wcId has arrived on the still-active tab — onViewCreated re-runs the affordance check.
  assert.equal(tab.wcId, 100);
  assert.equal(h.els.toggleMedia.disabled, false);
  assert.equal(h.els.togglePrivacy.disabled, false);
  assert.equal(h.els.toggleDevtools.disabled, false);
});

test('a welcome record shows no dead controls: dragstart and requestTearOff both refuse it', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  const tab = controller.openWelcomeTab({ reasons: ['home'] });
  const dragStartFn = tab.btn.listeners.get('dragstart');
  let prevented = false;
  dragStartFn({ dataTransfer: { setData() {}, effectAllowed: null }, preventDefault: () => { prevented = true; }, clientX: 0, clientY: 0 });
  assert.equal(prevented, true, 'dragstart on a viewless record must preventDefault (refused)');
  assert.equal(h.calls.filter(([name]) => name === 'tabTearOff').length, 0, 'no tear-off IPC was ever sent for it');
});

test('closeTab on a welcome record sends no tabClose and backfills via openNewTab when it was the last tab', async () => {
  const h = createHarness();
  h.setHomePage(null); // backfill lands on another welcome tab
  const controller = await loadController(h);
  const tab = controller.openWelcomeTab({ reasons: ['home'] });
  h.calls.length = 0;
  controller.closeTab(tab.id);
  assert.equal(h.calls.filter(([name]) => name === 'tabClose').length, 0);
  // Never left the window with zero tabs — the backfill is itself a welcome tab.
  assert.equal(controller.orderedTabIds().length, 1);
  assert.ok(controller.activeTab().welcome);
});
