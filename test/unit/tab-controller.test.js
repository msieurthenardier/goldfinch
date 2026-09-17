'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const moduleUrl = pathToFileURL(path.join(__dirname, '../../src/renderer/chrome/tab-controller.js')).href;

// Squawk 0077: the shared fake-DOM harness (test/unit/helpers/fake-dom.js) —
// this file's local FakeClassList/FakeElement copies are gone; the shared
// FakeElement's `innerHTML` setter auto-populates `.tab-title`/`.tab-close`/
// `.tab-fav`/`.tab-status` by default (Mission 20 F1 Leg 2, AC4 — load-bearing
// for tab-controller.js's `innerHTML`-built strip button), matching this
// file's prior local behavior exactly.
const { FakeElement } = require('./helpers/fake-dom');

function createHarness() {
  const tabs = new Map();
  const ctx = { tabs, activeTabId: null, tabSeq: 0, activeViewWcId: null, rafGeometryPending: false };
  const els = {
    tabs: new FakeElement('tabs'),
    tabstrip: new FakeElement('tabstrip'),
    webviews: new FakeElement('webviews'),
    address: new FakeElement('address'),
    privacyPanel: new FakeElement('privacy'),
    toggleMedia: new FakeElement(),
    togglePrivacy: new FakeElement(),
    toggleDevtools: new FakeElement()
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
    tabCreate(payload) {
      calls.push(['tabCreate', payload]);
      return Promise.resolve(nextWcId++);
    },
    tabSetActive(...args) {
      calls.push(['tabSetActive', ...args]);
    },
    tabSetBounds(...args) {
      calls.push(['tabSetBounds', ...args]);
    },
    tabHide(...args) {
      calls.push(['tabHide', ...args]);
    },
    tabClose(...args) {
      calls.push(['tabClose', ...args]);
    },
    tabDragStarted() {},
    tabDragEnded() {},
    tabAdoptByDrop: async () => ({ ok: true }),
    // Squawk 0011: was `async () => ({ ok: true })` with no `calls` record — every
    // assertion filtering `h.calls` for 'tabTearOff' was vacuously true regardless of
    // whether requestTearOff ever actually dispatched. Track it like every other
    // bridge call above so a guard-removal actually flips a filtered-count assertion.
    tabTearOff(payload) {
      calls.push(['tabTearOff', payload]);
      return Promise.resolve({ ok: true });
    },
    tabNavigate(payload) {
      calls.push(['tabNavigate', payload]);
    },
    findOverlayOpen() {},
    isDevtoolsOpen: async () => false,
    onAdoptTab(fn) {
      callbacks.adopt = fn;
    },
    onTabMovedAway(fn) {
      callbacks.movedAway = fn;
    },
    onTriggerSendBounds(fn) {
      callbacks.bounds = fn;
    }
  };
  const window = { goldfinch: bridge };
  class FakeResizeObserver {
    constructor(fn) {
      this.fn = fn;
    }
    observe() {}
  }
  const jar = { id: 'persist', name: 'Default', color: '#123456', partition: 'persist:default' };
  const jarsClient = {
    containers: [jar],
    defaultId: jar.id,
    makeBurner: () => ({ id: 'burner', name: 'Burner', color: '#222222', partition: 'temp', burner: true })
  };
  const noOp = () => {};
  // M16 F2 Leg 1/2: mutable boxes so tests can flip the resolved home page /
  // search engine mid-test without reconstructing the controller
  // (currentHomePage/currentSearchEngine are destructured once at
  // construction; the FUNCTION reference stays the same, only the value it
  // reads changes).
  let homePageValue = 'https://home.example/';
  let searchEngineValue = 'google';
  const deps = {
    window,
    document,
    requestAnimationFrame: (fn) => {
      fn();
      return 1;
    },
    ResizeObserver: FakeResizeObserver,
    ctx,
    els,
    tabs,
    jarsClient,
    blankPrivacy: () => ({ net: null, fp: {}, permissions: [], cookies: null }),
    escapeHtml: String,
    isSafeColor: (color) => typeof color === 'string' && color.startsWith('#'),
    openTabContextMenu: noOp,
    currentHomePage: () => homePageValue,
    currentSearchEngine: () => searchEngineValue, // M16 F2 Leg 2 (DD7): openNewTab's reasons rule
    isInternalPageUrl: (url) => /^goldfinch:\/\/(settings|downloads|jars|vault)$/.test(url),
    isSafeTabUrl: (url) => /^https?:/.test(url) || url === 'about:blank',
    resolveNewTabContainer: (containers, defaultId) => containers.find((item) => item.id === defaultId) || null,
    classifyDragPoint: () => ({ zone: 'reorder', index: 0 }),
    announceTabStatus: noOp,
    updateNavButtons: noOp,
    refreshZoomControl: noOp,
    refreshStar: noOp,
    fetchCookies: noOp,
    closeSuggestions: noOp,
    resetSuggestionsForActivation: noOp,
    refreshTabIndicators: noOp, // Mission 20 F3 Leg 1 (DD11): site-security-controller.js's unified chip owner
    renderMedia: noOp,
    renderPrivacy: noOp,
    setDevtoolsPressed: noOp,
    // M15 F2 Leg 3 (DD7 table 3/5, 4/5): the two activation-class bar-render
    // trigger sites — tracked (not a no-op) so the tests below can pin that
    // both actually call it.
    refreshBookmarksSurfaces: (tab) => calls.push(['refreshBookmarksSurfaces', tab && tab.id]),
    // M16 F2 Leg 1 (DD1/DD7): the welcome-panel toggle — tracked so tests can
    // pin that activateTab/onViewCreated drive it correctly.
    showWelcomePanel: (tab) => calls.push(['showWelcomePanel', tab && tab.id]),
    hideWelcomePanel: () => calls.push(['hideWelcomePanel']),
    // Mission 20 F1 Leg 2 (AC3): the load-failure panel toggle — same
    // tracked-wrapper shape as the welcome pair above.
    showLoadFailurePanel: (tab) => calls.push(['showLoadFailurePanel', tab && tab.id]),
    hideLoadFailurePanel: () => calls.push(['hideLoadFailurePanel']),
    // Mission 20 F3 Leg 2 (DD3): the hang bar's activation-class projection —
    // tracked so tests can pin that activateTab re-projects it every time.
    projectHangNotice: (tab) => calls.push(['projectHangNotice', tab && tab.id])
  };
  return {
    deps,
    tabs,
    ctx,
    els,
    callbacks,
    calls,
    jar,
    setHomePage: (v) => {
      homePageValue = v;
    },
    setSearchEngine: (v) => {
      searchEngineValue = v;
    }
  };
}

async function loadController(harness) {
  const { createTabController } = await import(moduleUrl);
  return createTabController(harness.deps);
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('an unsafe jar color is gated by isSafeColor before it reaches the tab-strip innerHTML sink (squawk 0020)', async () => {
  const h = createHarness();
  h.jar.color = '"><script>alert(1)</script>'; // fails the harness isSafeColor stub (no leading '#')
  const controller = await loadController(h);

  const web = controller.createTab('https://example.test/');
  await settle();

  assert.doesNotMatch(web.btn.innerHTML, /<script>/);
  assert.doesNotMatch(web.btn.innerHTML, /style="background:"><script>/);
  assert.match(web.btn.innerHTML, /style="background:#9aa0ac"/);
});

test('a safe jar color rides through to the tab-strip dot unchanged', async () => {
  const h = createHarness();
  h.jar.color = '#abc123';
  const controller = await loadController(h);

  const web = controller.createTab('https://example.test/');
  await settle();

  assert.match(web.btn.innerHTML, /style="background:#abc123"/);
});

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
  assert.deepEqual(
    h.calls.filter(([name]) => name === 'tabCreate').map(([, payload]) => payload.trusted),
    [false, true]
  );
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
// Mission 20 Flight 3 Leg 3 (leg-3 design review Decision): recovery adopts
// carry `trusted` (main-derived, never renderer-supplied) and an explicit
// `active` flag — `onAdoptTab` must honor both without breaking the ordinary
// single-adopt move path (no `trusted`/`active` field at all).
// ---------------------------------------------------------------------------

test('onAdoptTab honors payload.trusted (main-derived internal-tab fidelity across recovery)', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  const internalContainer = { id: 'internal', name: 'settings', color: '#9aa0ac', partition: 'goldfinch-internal' };
  h.callbacks.adopt({
    wcId: 900,
    url: 'goldfinch://settings/',
    title: 'Settings',
    favicon: null,
    container: internalContainer,
    trusted: true
  });
  const tab = controller.findTabByWcId(900);
  assert.equal(tab.trusted, true);
});

test('onAdoptTab: a move-path payload with no trusted field adopts as untrusted (unchanged)', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  h.callbacks.adopt({ wcId: 901, url: 'https://a.example/', title: 'A', favicon: null, container: h.jar });
  const tab = controller.findTabByWcId(901);
  assert.equal(tab.trusted, false);
});

test('onAdoptTab: active !== false activates (absent field — the move path is unaffected)', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  controller.createTab('https://first.test/');
  await settle();
  h.callbacks.adopt({ wcId: 902, url: 'https://adopted.test/', title: 'Adopted', favicon: null, container: h.jar });
  assert.equal(controller.activeTab().wcId, 902);
});

test('onAdoptTab: active: false does NOT activate (a recovery adopt for a non-active entry)', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  controller.createTab('https://first.test/');
  await settle();
  h.callbacks.adopt({
    wcId: 903,
    url: 'https://background.test/',
    title: 'Background',
    favicon: null,
    container: h.jar,
    active: false
  });
  assert.notEqual(controller.activeTab().wcId, 903);
  assert.ok(controller.findTabByWcId(903), 'the tab is still adopted onto the strip');
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

// ---------------------------------------------------------------------------
// Mission 20 F1 Leg 2 (DD1/AC3/AC4/AC8): the load-failure surface projection,
// strip state, and census fields.
// ---------------------------------------------------------------------------

test('activating a background-failed tab shows the load-failure panel; switching to a healthy tab hides it', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  const failed = controller.createTab('https://a.test/');
  const healthy = controller.createTab('https://b.test/');
  await settle();
  failed.loadFailure = { code: -105, name: 'ERR_NAME_NOT_RESOLVED', url: 'https://a.test/' };
  h.calls.length = 0;

  controller.activateTab(failed.id);
  assert.ok(h.calls.some(([name, id]) => name === 'showLoadFailurePanel' && id === failed.id));
  assert.ok(h.calls.some(([name]) => name === 'hideWelcomePanel'));
  assert.ok(!h.calls.some(([name]) => name === 'showWelcomePanel'));

  h.calls.length = 0;
  controller.activateTab(healthy.id);
  assert.ok(h.calls.some(([name]) => name === 'hideLoadFailurePanel'));
  assert.ok(!h.calls.some(([name]) => name === 'showLoadFailurePanel'));
});

test('DD1 (F3 L2 precedence amendment): loadFailure wins over welcome on a (structurally-impossible) same record — precedence crash > loadFailure > welcome > neither', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  const welcome = controller.openWelcomeTab({ reasons: ['home'] });
  welcome.loadFailure = { code: -1, name: 'ERR_X', url: 'x' }; // defensive-only: never happens in practice (no guest)
  h.calls.length = 0;

  controller.activateTab(welcome.id);
  assert.ok(h.calls.some(([name, id]) => name === 'showLoadFailurePanel' && id === welcome.id));
  assert.ok(h.calls.some(([name]) => name === 'hideWelcomePanel'));
  assert.ok(!h.calls.some(([name]) => name === 'showWelcomePanel'));
});

test('the tab-row template gains a hidden .tab-status span before .tab-title (AC4)', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  const tab = controller.createTab('https://example.test/');
  await settle();
  assert.match(
    tab.btn.innerHTML,
    /<span class="tab-status" hidden aria-hidden="true"><\/span><span class="tab-title">/
  );
  // The strip-mutation half (data-load-state, the glyph, host title, aria-label)
  // is applyStripState's own responsibility, unit-pinned in
  // load-failure-controller.test.js on the same .tab-status/.tab-title/.tab-close
  // selectors this harness now resolves (the FakeElement innerHTML setter change
  // above) — this test only pins the template shape tab-controller.js owns.
  assert.ok(tab.loadFailure === null, 'a fresh tab record starts with loadFailure: null');
});

test('listTabs() census reports loadState/loadError per tab (AC8)', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  const ok = controller.createTab('https://ok.test/');
  const failed = controller.createTab('https://failed.test/');
  await settle();
  failed.loadFailure = { code: -105, name: 'ERR_NAME_NOT_RESOLVED', url: 'https://failed.test/' };

  // @ts-ignore — the automation hook (window.__goldfinchAutomation) is chrome-renderer-only
  const rows = h.deps.window.__goldfinchAutomation.listTabs();
  const okRow = rows.find((r) => r.wcId === ok.wcId);
  const failedRow = rows.find((r) => r.wcId === failed.wcId);
  assert.equal(okRow.loadState, 'ok');
  assert.equal(okRow.loadError, null);
  assert.equal(failedRow.loadState, 'failed');
  assert.deepEqual(failedRow.loadError, { code: -105, name: 'ERR_NAME_NOT_RESOLVED' });
});

test('Mission 20 F2 Leg 4 (design review, belt-and-suspenders): census security is none for any tab with a loadFailure, regardless of a stale prior value', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  const ok = controller.createTab('https://ok.test/');
  const failed = controller.createTab('https://failed.test/');
  await settle();
  ok.security = 'secure';
  failed.security = 'secure'; // stale — the tab loaded fine before this failure
  failed.loadFailure = { code: -202, name: 'ERR_CERT_AUTHORITY_INVALID', url: 'https://failed.test/' };

  // @ts-ignore — the automation hook (window.__goldfinchAutomation) is chrome-renderer-only
  const rows = h.deps.window.__goldfinchAutomation.listTabs();
  const okRow = rows.find((r) => r.wcId === ok.wcId);
  const failedRow = rows.find((r) => r.wcId === failed.wcId);
  assert.equal(okRow.security, 'secure');
  assert.equal(failedRow.security, 'none');
});

// ---------------------------------------------------------------------------
// Mission 20 Flight 3 Leg 2 (DD1/DD3/DD9): the crash/hang projection
// precedence, the hang-bar activation-class projection, and the census's
// crashed/hung rows.
// ---------------------------------------------------------------------------

test('DD1: activateTab projects exactly the crash panel — crash beats a load failure and welcome', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  const tab = controller.createTab('https://a.test/');
  await settle();
  tab.crash = { reason: 'crashed', exitCode: 139, url: 'https://a.test/' };
  tab.loadFailure = { code: -1, name: 'stale' };
  h.calls.length = 0;

  controller.activateTab(tab.id);

  assert.ok(h.calls.some(([name, id]) => name === 'showLoadFailurePanel' && id === tab.id));
  assert.ok(h.calls.some(([name]) => name === 'hideWelcomePanel'));
  assert.ok(!h.calls.some(([name]) => name === 'showWelcomePanel'));
});

test('DD3: activateTab re-projects the hang bar on every activation', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  const tab = controller.createTab('https://a.test/');
  await settle();
  h.calls.length = 0;

  controller.activateTab(tab.id);

  assert.ok(h.calls.some(([name, id]) => name === 'projectHangNotice' && id === tab.id));
});

test('DD9: census reports loadState crashed with loadError { code: exitCode, name: reason }', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  const crashed = controller.createTab('https://crashed.test/');
  await settle();
  crashed.crash = { reason: 'crashed', exitCode: 139, url: 'https://crashed.test/' };

  // @ts-ignore
  const rows = h.deps.window.__goldfinchAutomation.listTabs();
  const row = rows.find((r) => r.wcId === crashed.wcId);
  assert.equal(row.loadState, 'crashed');
  assert.deepEqual(row.loadError, { code: 139, name: 'crashed' });
  assert.equal(row.security, 'none');
});

test('DD9: census reports loadState hung when the tab is hung and has no crash/failure', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  const hung = controller.createTab('https://hung.test/');
  await settle();
  hung.hung = true;

  // @ts-ignore
  const rows = h.deps.window.__goldfinchAutomation.listTabs();
  const row = rows.find((r) => r.wcId === hung.wcId);
  assert.equal(row.loadState, 'hung');
  assert.equal(row.loadError, null);
});

test('DD9: census precedence — crash beats hung (a dead renderer is never also reported hung)', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  const tab = controller.createTab('https://x.test/');
  await settle();
  tab.crash = { reason: 'crashed', exitCode: 139, url: 'https://x.test/' };
  tab.hung = true; // stale — must never surface once crashed

  // @ts-ignore
  const rows = h.deps.window.__goldfinchAutomation.listTabs();
  const row = rows.find((r) => r.wcId === tab.wcId);
  assert.equal(row.loadState, 'crashed');
});

test('DD9: census title on a crashed tab is the same host-derived label the strip shows', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  const crashed = controller.createTab('https://crashed.test/path');
  await settle();
  crashed.title = 'chrome-error://chromewebdata/';
  crashed.crash = { reason: 'crashed', exitCode: 139, url: 'https://crashed.test/path' };

  // @ts-ignore
  const rows = h.deps.window.__goldfinchAutomation.listTabs();
  const row = rows.find((r) => r.wcId === crashed.wcId);
  assert.equal(row.title, 'crashed.test');
});

test('F2: listTabs() census title on a failed tab is the same host-derived label the strip shows', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  const ok = controller.createTab('https://ok.test/');
  const failed = controller.createTab('https://failed.test/path');
  await settle();
  // Simulate what a re-navigated/reopened failed tab's stale page title looks
  // like in the wild (F2's finding: 'New tab' / a stale previous title / '') —
  // the census must ignore it entirely once loadFailure is set.
  failed.title = '';
  failed.loadFailure = { code: -105, name: 'ERR_NAME_NOT_RESOLVED', url: 'https://failed.test/path' };

  // @ts-ignore — the automation hook (window.__goldfinchAutomation) is chrome-renderer-only
  const rows = h.deps.window.__goldfinchAutomation.listTabs();
  const okRow = rows.find((r) => r.wcId === ok.wcId);
  const failedRow = rows.find((r) => r.wcId === failed.wcId);
  assert.equal(okRow.title, ok.title, 'an ok tab keeps reporting its own title, unaffected');
  assert.equal(
    failedRow.title,
    'failed.test',
    'a failed tab reports the host-derived label, never the stale/empty title'
  );
});

test('openWelcomeTab resolves a burner jar when the resolver yields none', async () => {
  const h = createHarness();
  h.deps.resolveNewTabContainer = () => null; // force the makeBurner() fallback
  const controller = await loadController(h);
  const tab = controller.openWelcomeTab({ reasons: ['home'] });
  assert.equal(tab.container.burner, true);
});

test("attachView sends exactly one tabCreate with the record's partition, clears welcome, and runs onViewCreated", async () => {
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

test('a welcome record refuses to start a drag: dragstart preventDefaults on a viewless tab', async () => {
  const h = createHarness();
  const controller = await loadController(h);
  const tab = controller.openWelcomeTab({ reasons: ['home'] });
  const dragStartFn = tab.btn.listeners.get('dragstart');
  let prevented = false;
  dragStartFn({
    dataTransfer: { setData() {}, effectAllowed: null },
    preventDefault: () => {
      prevented = true;
    },
    clientX: 0,
    clientY: 0
  });
  assert.equal(prevented, true, 'dragstart on a viewless record must preventDefault (refused)');
  // dragstart's own gate means no drag session (`dnd`) is ever created for this tab, so
  // requestTearOff — dragend's only call site — never runs. Squawk 0011: this assertion
  // alone previously stood in for coverage of requestTearOff's OWN guard, which it does
  // not exercise. See the two tests below for that guard.
  assert.equal(
    h.calls.filter(([name]) => name === 'tabTearOff').length,
    0,
    'a refused dragstart never creates a drag session'
  );
});

// Squawk 0011: `requestTearOff`'s own guard — `if (!tab || tab.wcId == null) return;`
// (tab-controller.js:703) — is a second, independent line of defense, distinct from
// dragstart's gate above: it protects against a tab losing its view WHILE a drag is
// already in flight (e.g. the guest view is torn down mid-drag), which dragstart's own
// gate cannot see since it only runs once, at the start. `requestTearOff` is not on the
// controller's returned API (it is dragend's private helper, dragend is its one call
// site) and dnd (the drag session) is private module state, so the only way to reach it
// is the full dragstart -> dragend gesture on the tab's own listeners — the same gesture
// dragstart/dragend are already exercised through elsewhere in this file.
// `classifyDragPoint` is stubbed per-test (same DI seam `currentHomePage`/
// `currentSearchEngine` use above) to force dragend's release-point classification into
// the tear-off zone, so the only outstanding variable is the tab's own `wcId`.
test('requestTearOff refuses a tab that lost its view mid-drag: no tabTearOff IPC fires', async () => {
  const h = createHarness();
  h.deps.classifyDragPoint = () => ({ zone: 'tearOff' });
  const controller = await loadController(h);
  const tab = controller.createTab('https://example.test/');
  await settle(); // tab.wcId arrives (100) — dragstart's own gate needs it set to start the session
  const dragStartFn = tab.btn.listeners.get('dragstart');
  dragStartFn({
    dataTransfer: { setData() {}, effectAllowed: null, setDragImage() {} },
    preventDefault: () => {},
    clientX: 0,
    clientY: 0
  });
  tab.wcId = null; // the view goes away mid-drag — the exact condition requestTearOff's guard exists for
  h.calls.length = 0;
  const dragEndFn = tab.btn.listeners.get('dragend');
  dragEndFn({ clientX: -50, clientY: -50 });
  assert.equal(
    h.calls.filter(([name]) => name === 'tabTearOff').length,
    0,
    'requestTearOff must refuse a tab with no view, even mid-drag'
  );
});

test('requestTearOff dispatches tabTearOff for a tab with a live view (positive control)', async () => {
  const h = createHarness();
  h.deps.classifyDragPoint = () => ({ zone: 'tearOff' });
  const controller = await loadController(h);
  const tab = controller.createTab('https://example.test/');
  await settle();
  const dragStartFn = tab.btn.listeners.get('dragstart');
  dragStartFn({
    dataTransfer: { setData() {}, effectAllowed: null, setDragImage() {} },
    preventDefault: () => {},
    clientX: 0,
    clientY: 0
  });
  h.calls.length = 0;
  const dragEndFn = tab.btn.listeners.get('dragend');
  dragEndFn({ clientX: -50, clientY: -50 });
  // Proves the harness/gesture actually reaches requestTearOff's dispatch — the guard
  // test above is not vacuously green because the mechanism never fires at all.
  const tearOffCall = h.calls.find(([name]) => name === 'tabTearOff');
  assert.ok(tearOffCall, 'requestTearOff dispatches tabTearOff when the tab still has a view');
  assert.equal(tearOffCall[1].wcId, tab.wcId);
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

// Squawk 0018 / issue #134 item 3: tab-create is synchronous main-side (view
// constructed and attached before the invoke resolves), so a tab closed while
// the invoke is still in flight leaves onViewCreated's `!tabs.has(tab.id)`
// early return with a live, orphaned guest view nothing will ever close.
test('onViewCreated closes the orphaned view via tabClose with skipCapture when the tab closed before wcId arrived', async () => {
  const h = createHarness();
  // Control tabCreate's resolution timing directly so the test can close the
  // tab BEFORE the wcId arrives, reproducing the race deterministically
  // instead of relying on timing. Queue resolvers in call order — closing the
  // window's only tab backfills via openNewTab (a SECOND tabCreate call), so a
  // single shared `resolveCreate` variable would get clobbered by it.
  const pendingResolvers = [];
  h.deps.window.goldfinch.tabCreate = (payload) => {
    h.calls.push(['tabCreate', payload]);
    return new Promise((resolve) => {
      pendingResolvers.push(resolve);
    });
  };
  const controller = await loadController(h);
  const tab = controller.createTab('https://example.test/');
  assert.equal(tab.wcId, null);
  assert.equal(pendingResolvers.length, 1);

  // Close the tab while tab-create is still in flight — the exact race: no
  // tabClose IPC fires here since tab.wcId is still null (closeTab's own
  // `if (tab.wcId != null)` guard, unaffected by this fix). It was the only
  // tab, so closeTab backfills via openNewTab — a second, unrelated tabCreate.
  controller.closeTab(tab.id);
  assert.equal(h.calls.filter(([name]) => name === 'tabClose').length, 0);
  assert.equal(pendingResolvers.length, 2);

  // Main "returns" the ORIGINAL tab's wcId now, after the tab is already gone
  // from `tabs` — the backfill tab's own create is left unresolved/untouched.
  h.calls.length = 0;
  pendingResolvers[0](999);
  await settle();

  const closeCalls = h.calls.filter(([name]) => name === 'tabClose');
  assert.equal(closeCalls.length, 1, 'the orphaned view must be closed exactly once');
  assert.deepEqual(closeCalls[0], ['tabClose', 999, -1, { skipCapture: true }]);
  // No tab record was resurrected for the orphan.
  assert.equal(controller.findTabByWcId(999), null);
  assert.equal(
    [...h.tabs.values()].some((t) => t.wcId === 999),
    false
  );
});
