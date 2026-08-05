'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Element, createDocument } = require('./helpers/jars-page-dom');

const moduleUrl = pathToFileURL(path.join(__dirname, '../../src/renderer/pages/jars-section-controller.js')).href;
const confirmModalUrl = pathToFileURL(path.join(__dirname, '../../src/renderer/pages/jars-confirm-modal.js')).href;
const jarPanelModelUrl = pathToFileURL(path.join(__dirname, '../../src/shared/jar-panel-model.js')).href;
const jarDataClassesUrl = pathToFileURL(path.join(__dirname, '../../src/shared/jar-data-classes.js')).href;
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('sections patch stable nodes and count invalidation de-duplicates the active panel', async () => {
  const { createJarsSections } = await import(moduleUrl);
  const document = createDocument();
  const sectionsEl = document.createElement('main');
  const calls = { history: 0, cookies: 0, site: 0, cookieInvalidations: 0, siteInvalidations: 0 };
  const bridge = {
    historyCount: async () => { calls.history++; return { ok: true, count: 7 }; },
    jarsCookiesList: async () => { calls.cookies++; return { ok: true, cookies: [{}, {}] }; },
    jarsSiteDataList: async () => { calls.site++; return { ok: true, origins: [{}, {}, {}] }; },
    jarsRename: async () => ({}),
    jarsSetDefault: async () => true,
    jarsSetRetention: async () => ({ ok: true }),
    jarsClearData: async () => ({ ok: true }),
    jarsWipe: async () => ({ ok: true }),
    jarsRemove: async () => ({ ok: true })
  };
  const panels = [{ id: 'history' }, { id: 'cookies' }, { id: 'site-data' }];
  const createJarTabs = () => ({
    build(row, { buildPanelContent }) {
      const tabsWrap = document.createElement('div');
      const tabRefs = new Map();
      for (const descriptor of panels) {
        const tab = document.createElement('button');
        const panel = document.createElement('div');
        panel.id = `jar-${row.id}--${descriptor.id}`;
        panel.classList.add('jar-tabpanel');
        const countSpan = document.createElement('span');
        tabRefs.set(descriptor.id, { tab, panel, countSpan });
        buildPanelContent(descriptor.id, panel);
        tabsWrap.appendChild(tab);
        tabsWrap.appendChild(panel);
      }
      return { tabsWrap, tabRefs };
    },
    selectTab(refs, panelId) { refs.activeTab = panelId; }
  });
  const noopPanel = () => ({ onExpanded() {}, onHistoryChanged() {}, onActivated() {}, refresh() {}, destroy() {} });
  let ui = { mode: null, rowId: null, action: null, draft: null };
  const containers = [{ id: 'work', name: 'Work', color: '#123456', retentionDays: 30 }];
  const controller = createJarsSections({
    window: { setTimeout },
    document,
    Node: Element,
    bridge,
    sectionsEl,
    newBtn: document.createElement('button'),
    isSafeColor: () => true,
    PALETTE: ['#123456'],
    JAR_PANELS: panels,
    panelForDataClass: (id) => id === 'cookies' ? 'cookies' : id === 'storage' ? 'site-data' : null,
    JAR_DATA_CLASSES: [{ id: 'cookies', label: 'Cookies' }, { id: 'storage', label: 'Storage' }],
    createHistoryPanel: noopPanel,
    createCookiesPanel: () => ({
      onActivated() {}, refresh() {}, destroy() {},
      onJarDataChanged() { calls.cookieInvalidations++; }
    }),
    createSiteDataPanel: () => ({
      onActivated() {}, refresh() {}, destroy() {},
      onJarDataChanged() { calls.siteInvalidations++; }
    }),
    createJarTabs,
    createConfirmModal: () => ({ captureTrigger() {}, update() {} }),
    getContainers: () => containers,
    getUi: () => ui,
    setUi: (next) => { ui = next; },
    setPageError() {},
    clearPageError() {},
    requestRender() {}
  });
  const rows = [
    { id: 'work', name: 'Work', color: '#123456', isDefault: false, isBurner: false },
    { id: '__burner__', name: 'Burner', color: '#999999', isDefault: true, isBurner: true }
  ];

  controller.render(rows);
  await tick();
  const refs = controller.getSectionRefs('work');
  const originalRoot = refs.root;
  const counts = Object.fromEntries(Array.from(refs.tabRefs, ([id, ref]) => [id, ref.countSpan.textContent]));
  assert.deepEqual(calls, { history: 1, cookies: 1, site: 1, cookieInvalidations: 0, siteInvalidations: 0 });
  assert.deepEqual(counts, { history: ' (7)', cookies: ' (2)', 'site-data': ' (3)' });

  refs.activeTab = 'cookies';
  controller.render([{ ...rows[0], name: 'Renamed' }, rows[1]]);
  assert.equal(controller.getSectionRefs('work').root, originalRoot);
  assert.equal(refs.activeTab, 'cookies');
  assert.deepEqual(Object.fromEntries(Array.from(refs.tabRefs, ([id, ref]) => [id, ref.countSpan.textContent])), counts);

  controller.handleJarDataChanged({ jarId: 'work', classes: ['cookies', 'storage'] });
  await tick();
  assert.equal(calls.cookieInvalidations, 1);
  assert.equal(calls.siteInvalidations, 1);
  assert.equal(calls.cookies, 1, 'active Cookies panel owns its refreshed count');
  assert.equal(calls.site, 2, 'inactive touched panel receives one count re-fetch');
  controller.destroy();
});

// ---------------------------------------------------------------------------
// CLEAR_COPY / CLEAR_OK_NOTE totality (M15 F2 Leg 2 / DD9, round-2 review
// finding, HIGH): the test above deliberately uses a FAKE two-class
// JAR_DATA_CLASSES fixture and a STUBBED createConfirmModal, so it cannot
// catch an unlisted class id rendering the literal string "undefined" in
// the confirm dialog body / success toast. This test drives the REAL
// JAR_DATA_CLASSES (imported from src/shared/jar-data-classes.js, which now
// carries the fifth `bookmarks` entry) through the REAL createConfirmModal
// (src/renderer/pages/jars-confirm-modal.js) — the jar-panel-model.test.js:43
// totality-over-the-real-list pattern, applied to the confirm-copy tables
// instead of the panel router.
// ---------------------------------------------------------------------------

function findById(root, id) {
  let found = null;
  const visit = (node) => {
    if (node.id === id) found = node;
    node.children.forEach(visit);
  };
  visit(root);
  return found;
}

test('every REAL JAR_DATA_CLASSES id has a non-"undefined" confirm-dialog copy AND success note (CLEAR_COPY/CLEAR_OK_NOTE totality)', async () => {
  const { createJarsSections } = await import(moduleUrl);
  const { createConfirmModal } = await import(confirmModalUrl);
  const { JAR_PANELS, panelForDataClass } = await import(jarPanelModelUrl);
  const { JAR_DATA_CLASSES } = await import(jarDataClassesUrl);

  const document = createDocument();
  document.body = document.createElement('body');
  document.body.ownerDocument = document;
  // jars-confirm-modal.js reads the GLOBAL `document` (no injected-doc dep,
  // the jars-confirm-vault-reachability.test.js precedent) — node isolates
  // each test file in its own process, so this is contained. captureTrigger()
  // also does `document.activeElement instanceof HTMLElement` — the fake DOM's
  // `Element` class stands in for it here.
  globalThis.document = document;
  globalThis.HTMLElement = Element;

  const sectionsEl = document.createElement('main');
  const clearDataCalls = [];
  const bridge = {
    historyCount: async () => ({ ok: true, count: 0 }),
    jarsCookiesList: async () => ({ ok: true, cookies: [] }),
    jarsSiteDataList: async () => ({ ok: true, origins: [] }),
    jarsRename: async () => ({}),
    jarsSetDefault: async () => true,
    jarsSetRetention: async () => ({ ok: true }),
    jarsClearData: async (payload) => {
      clearDataCalls.push(payload);
      return { ok: true };
    },
    jarsWipe: async () => ({ ok: true }),
    jarsRemove: async () => ({ ok: true })
  };
  const createJarTabs = () => ({
    build(row, { buildPanelContent }) {
      const tabsWrap = document.createElement('div');
      const tabRefs = new Map();
      for (const descriptor of JAR_PANELS) {
        const tabEl = document.createElement('button');
        const panel = document.createElement('div');
        panel.id = `jar-${row.id}--${descriptor.id}`;
        panel.classList.add('jar-tabpanel');
        const countSpan = document.createElement('span');
        tabRefs.set(descriptor.id, { tab: tabEl, panel, countSpan });
        buildPanelContent(descriptor.id, panel);
        tabsWrap.appendChild(tabEl);
        tabsWrap.appendChild(panel);
      }
      return { tabsWrap, tabRefs };
    },
    selectTab(refs, panelId) { refs.activeTab = panelId; }
  });
  const noopPanel = () => ({ onExpanded() {}, onHistoryChanged() {}, onActivated() {}, refresh() {}, destroy() {} });
  let ui = { mode: null, rowId: null, action: null, draft: null };
  const containers = [{ id: 'work', name: 'Work', color: '#123456', retentionDays: 30 }];

  /** @type {any} */
  let confirmModal;
  const controller = createJarsSections({
    window: { setTimeout },
    document,
    Node: Element,
    bridge,
    sectionsEl,
    newBtn: document.createElement('button'),
    isSafeColor: () => true,
    PALETTE: ['#123456'],
    JAR_PANELS,
    panelForDataClass,
    JAR_DATA_CLASSES,
    createHistoryPanel: noopPanel,
    createCookiesPanel: () => ({ onActivated() {}, refresh() {}, destroy() {}, onJarDataChanged() {} }),
    createSiteDataPanel: () => ({ onActivated() {}, refresh() {}, destroy() {}, onJarDataChanged() {} }),
    createJarTabs,
    // The REAL confirm modal — the whole point of this test. Constructed
    // with the SAME shape jars.js itself uses (dataActions/titles resolved
    // from createJarsSections' internals is not observable from here, so
    // instead: createConfirmModal is invoked by createJarsSections
    // INTERNALLY using its own private DATA_ACTIONS/CONFIRM_TITLE — this
    // dep slot only supplies the FACTORY; capture the instance it builds so
    // this test can call `.update()` after each openDataConfirm click.
    createConfirmModal: (deps) => {
      confirmModal = createConfirmModal(deps);
      return confirmModal;
    },
    getContainers: () => containers,
    getUi: () => ui,
    setUi: (next) => { ui = next; },
    setPageError() {},
    clearPageError() {},
    requestRender() { confirmModal.update(); }
  });

  const rows = [{ id: 'work', name: 'Work', color: '#123456', isDefault: false, isBurner: false }];
  controller.render(rows);
  await tick();

  const refs = controller.getSectionRefs('work');
  for (const cls of JAR_DATA_CLASSES) {
    const action = 'clear-' + cls.id;
    const btn = refs.dataButtons.get(action);
    assert.ok(btn, `a "Clear ${cls.label}" button should render for every JAR_DATA_CLASSES entry`);
    btn.dispatch('click');
    await tick();
    controller.updateConfirm();

    const desc = findById(document.body, 'jars-confirm-desc');
    assert.ok(desc, `${action}: the confirm dialog should be open`);
    assert.ok(
      typeof desc.textContent === 'string' && desc.textContent.length > 0 && !desc.textContent.includes('undefined'),
      `${action}: confirm-dialog copy must be a real string, not "${desc.textContent}"`
    );

    const confirmBtn = findById(document.body, 'jars-confirm-backdrop').children
      .flatMap(function flatten(n) { return [n, ...n.children.flatMap(flatten)]; })
      .find((n) => n.tagName === 'BUTTON' && n.textContent === 'Confirm');
    assert.ok(confirmBtn, `${action}: a Confirm button should render`);
    confirmBtn.dispatch('click');
    await tick();
    await tick(); // let bridge.jarsClearData's promise resolve

    assert.ok(
      typeof refs.errorLine.textContent === 'string' &&
        refs.errorLine.textContent.length > 0 &&
        !refs.errorLine.textContent.includes('undefined'),
      `${action}: the success note must be a real string, not "${refs.errorLine.textContent}"`
    );
    // Reset for the next class's confirm cycle.
    ui = { mode: null, rowId: null, action: null, draft: null };
    controller.updateConfirm();
  }
  assert.equal(clearDataCalls.length, JAR_DATA_CLASSES.length, 'every class was actually confirmed and dispatched');
  controller.destroy();
});
