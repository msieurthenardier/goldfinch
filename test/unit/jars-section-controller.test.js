'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Element, createDocument } = require('./helpers/jars-page-dom');

const moduleUrl = pathToFileURL(path.join(__dirname, '../../src/renderer/pages/jars-section-controller.js')).href;
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
