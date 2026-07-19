'use strict';

const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerTabIpc } = require('../../src/main/register-tab-ipc');

class FakeIpc {
  constructor() { this.handles = new Map(); this.listeners = new Map(); }
  handle(channel, fn) { this.handles.set(channel, fn); }
  on(channel, fn) { this.listeners.set(channel, fn); }
  invoke(channel, sender, ...args) { return this.handles.get(channel)({ sender }, ...args); }
  send(channel, sender, ...args) { return this.listeners.get(channel)({ sender }, ...args); }
}

class FakeContents extends EventEmitter {
  constructor(id, log) {
    super();
    this.id = id;
    this.log = log;
    this.destroyed = false;
    this.focused = false;
    this.url = `https://tab-${id}.test/`;
    this.navigationHistory = {
      getAllEntries: () => [{ url: this.url }],
      getActiveIndex: () => 0,
      restore: (value) => { log.push(['restore', id, value]); return Promise.resolve(); }
    };
  }
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; this.log.push(['destroy', this.id]); }
  getURL() { return this.url; }
  getTitle() { return `Tab ${this.id}`; }
  canGoBack() { return true; }
  canGoForward() { return false; }
  isFocused() { return this.focused; }
  focus() { this.log.push(['focus-wc', this.id]); }
  send(channel, payload) { this.log.push(['send', this.id, channel, payload]); }
  loadURL(url) { this.log.push(['load', this.id, url]); return Promise.resolve(); }
  reload() { this.log.push(['reload', this.id]); }
  stop() { this.log.push(['stop', this.id]); }
  goBack() { this.log.push(['back', this.id]); }
  goForward() { this.log.push(['forward', this.id]); }
  findInPage(text, options) { this.log.push(['find', this.id, text, options]); }
  stopFindInPage(action) { this.log.push(['stop-find', this.id, action]); }
}

class FakeView {
  constructor(opts, log, id) {
    this.opts = opts;
    this.log = log;
    this.webContents = new FakeContents(id, log);
    this.bounds = { x: 0, y: 80, width: 1000, height: 700 };
    this.visible = false;
  }
  setBounds(bounds) { this.bounds = { ...bounds }; this.log.push(['bounds', this.webContents.id, bounds]); }
  getBounds() { return { ...this.bounds }; }
  setVisible(value) { this.visible = value; this.log.push(['visible', this.webContents.id, value]); }
}

function setup() {
  const ipcMain = new FakeIpc();
  const log = [];
  const records = [];
  let nextWcId = 100;
  const registry = {
    records: () => records,
    get: (id) => records.find((record) => record.win.id === id) || null,
    getWindowForChrome: (sender) => records.find((record) => record.chromeView.webContents === sender) || null,
    getWindowForGuest: (wcId) => records.find((record) => record.tabViews.has(wcId)) || null,
    noteFocus: (id) => log.push(['focus-window', id])
  };
  function makeRecord(id) {
    const chrome = new FakeContents(id * 10, log);
    const record = {
      win: {
        id,
        destroyed: false,
        closed: false,
        contentView: {
          addChildView: (view) => log.push(['add-view', id, view.webContents.id]),
          removeChildView: (view) => log.push(['remove-view', id, view.webContents.id])
        },
        getContentBounds: () => ({ width: 1200, height: 800 }),
        isDestroyed() { return this.destroyed; },
        focus: () => log.push(['raise', id]),
        close() { this.closed = true; log.push(['close-window', id]); }
      },
      chromeView: { webContents: chrome },
      tabViews: new Map(),
      activeTabWcId: null,
      noBootTab: false,
      bootConfigServed: true,
      pendingChromeSends: [],
      dragWcId: null,
      findOverlay: {
        isSessionActive: () => false,
        getSessionTabWcId: () => null,
        closeSession: () => log.push(['close-find', id]),
        hide: () => log.push(['hide-find', id]),
        show: () => log.push(['show-find', id]),
        syncBounds: () => log.push(['sync-find', id])
      },
      sheet: {
        closeMenuOverlay: (reason) => log.push(['close-menu', id, reason]),
        syncBounds: () => log.push(['sync-menu', id]),
        isMenuOpen: () => false,
        show: () => log.push(['show-menu', id])
      },
      tearoffOverlay: { isVisible: () => false, show: () => log.push(['show-tearoff', id]) }
    };
    records.push(record);
    return record;
  }
  function addTab(record, wcId = nextWcId++, trusted = false) {
    const view = new FakeView({}, log, wcId);
    record.tabViews.set(wcId, { view, partition: trusted ? 'goldfinch-internal' : 'persist:jar-a', trusted, active: false });
    return view;
  }
  const webContents = { fromId: (id) => records.flatMap((r) => [...r.tabViews.values()]).find((e) => e.view.webContents.id === id)?.view.webContents || null };
  const timers = [];
  const closed = [];
  const history = [];
  const views = [];
  class WebContentsView {
    constructor(opts) { const view = new FakeView(opts, log, nextWcId++); views.push(view); return view; }
  }
  let nextWindowId = 50;
  const deps = {
    ipcMain,
    WebContentsView,
    internalPreloadPath: '/preload/internal.js',
    webPreloadPath: '/preload/web.js',
    INTERNAL_PARTITION: 'goldfinch-internal',
    registry,
    wireGuestContents: (wc) => log.push(['wire-guest', wc.id]),
    wireTabViewEvents: (_view, id, partition) => log.push(['wire-tab', id, partition]),
    captureClosedTabEntry: ({ tabEntry, stripIndex, windowId }) => ({ url: tabEntry.view.webContents.url, title: 'x', jarId: 'jar-a', stripIndex, windowId, navEntries: [], navIndex: 0 }),
    jars: { list: () => [{ id: 'jar-a', partition: 'persist:jar-a' }] },
    APPEND_SENTINEL: -1,
    closedTabStack: { push: (entry) => closed.push(entry), pop: () => closed.pop() || null, size: () => closed.length },
    broadcastClosedTabStackChanged: () => log.push(['broadcast-stack']),
    getHistoryRecorder: () => ({ forgetTab: (id) => history.push(id) }),
    isSafeTabUrl: (url) => url.startsWith('https://'),
    reopenStripIndex: (entry, winId) => entry.windowId === winId ? entry.stripIndex : -1,
    webContents,
    isInternalContents: (wc) => wc.internal === true,
    buildMoveTargets: (all, source) => all.filter((record) => record !== source).map((record) => ({ windowId: record.win.id })),
    createWindow: () => makeRecord(nextWindowId++),
    validateMoveTabPayload: (payload) => payload && typeof payload.wcId === 'number' ? payload : null,
    buildAdoptPayload: (payload, wc) => ({ ...payload, url: wc.getURL(), title: wc.getTitle() }),
    broadcastMoveTargetsChanged: () => log.push(['broadcast-targets']),
    getTabContents: (id) => webContents.fromId(id),
    schedule: (fn, ms) => { const token = { fn, ms }; timers.push(token); return token; },
    cancelScheduled: (token) => { const i = timers.indexOf(token); if (i >= 0) timers.splice(i, 1); },
    logger: { warn() {}, error() {} }
  };
  registerTabIpc(deps);
  return { ipcMain, log, records, registry, makeRecord, addTab, views, timers, closed, history };
}

test('registers the complete tab/move channel set exactly once', () => {
  const h = setup();
  assert.deepEqual([...h.ipcMain.handles.keys()].sort(), [
    'closed-tab-stack-size', 'move-targets', 'tab-adopt-by-drop', 'tab-create',
    'tab-history-snapshot', 'tab-move-to-new-window', 'tab-move-to-window',
    'tab-reopen', 'tab-tear-off'
  ].sort());
  assert.deepEqual([...h.ipcMain.listeners.keys()].sort(), [
    'tab-close', 'tab-drag-ended', 'tab-drag-started', 'tab-find', 'tab-hide',
    'tab-navigate', 'tab-set-active', 'tab-set-bounds'
  ].sort());
});

test('tab-create preserves trusted/untrusted construction and wires before navigation', async () => {
  const h = setup();
  const source = h.makeRecord(1);
  const webId = await h.ipcMain.invoke('tab-create', source.chromeView.webContents, {
    url: 'https://example.test/', partition: 'persist:jar-a', trusted: false
  });
  assert.equal(source.tabViews.has(webId), true);
  assert.equal(h.views[0].opts.webPreferences.contextIsolation, false);
  assert.equal(h.views[0].opts.webPreferences.preload, '/preload/web.js');
  assert.ok(h.log.findIndex((x) => x[0] === 'wire-tab') < h.log.findIndex((x) => x[0] === 'load'));

  await h.ipcMain.invoke('tab-create', source.chromeView.webContents, {
    url: 'goldfinch://settings', partition: 'ignored', trusted: true
  });
  assert.deepEqual(h.views[1].opts.webPreferences, {
    preload: '/preload/internal.js', contextIsolation: true, sandbox: true,
    nodeIntegration: false, partition: 'goldfinch-internal', spellcheck: false
  });
});

test('move-to-window derives source from sender, treats windowId as a destination request, and mutates synchronously', () => {
  const h = setup();
  const source = h.makeRecord(1);
  const target = h.makeRecord(2);
  const moved = h.addTab(source, 101);
  h.addTab(source, 102);
  const previous = h.addTab(target, 201);
  target.activeTabWcId = 201;
  previous.visible = true;

  const result = h.ipcMain.invoke('tab-move-to-window', source.chromeView.webContents, {
    wcId: 101, windowId: 2, sourceWindowId: 999
  });
  assert.deepEqual(result, { ok: true, windowId: 2 });
  assert.equal(source.tabViews.has(101), false);
  assert.equal(target.tabViews.get(101).view, moved);
  assert.equal(previous.visible, false, 'target outgoing guest is hidden before the async adopt round-trip');
  assert.ok(h.log.some((x) => x[0] === 'send' && x[2] === 'tab-moved-away'));
});

test('move refusals are discriminated and never return a bare null on physical/cross-window paths', () => {
  const h = setup();
  const source = h.makeRecord(1);
  const target = h.makeRecord(2);
  h.addTab(source, 101);
  assert.deepEqual(h.ipcMain.invoke('tab-move-to-window', {}, { wcId: 101, windowId: 2 }), { ok: false, reason: 'no-source' });
  assert.deepEqual(h.ipcMain.invoke('tab-move-to-window', source.chromeView.webContents, {}), { ok: false, reason: 'bad-payload' });
  assert.deepEqual(h.ipcMain.invoke('tab-move-to-window', source.chromeView.webContents, { wcId: 101, windowId: 999 }), { ok: false, reason: 'no-target' });
  assert.deepEqual(h.ipcMain.invoke('tab-tear-off', source.chromeView.webContents, { wcId: 101 }), { ok: false, reason: 'sole-tab' });
  assert.equal(target.tabViews.size, 0);
});

test('existing-window sole-tab consolidate closes the emptied source', () => {
  const h = setup();
  const source = h.makeRecord(1);
  h.makeRecord(2);
  h.addTab(source, 101);
  const result = h.ipcMain.invoke('tab-move-to-window', source.chromeView.webContents, { wcId: 101, windowId: 2 });
  assert.equal(result.ok, true);
  assert.equal(source.win.closed, true);
});

test('drop adoption requires sender-derived target plus source drag provenance and consumes it', () => {
  const h = setup();
  const source = h.makeRecord(1);
  const target = h.makeRecord(2);
  h.addTab(source, 101);
  h.addTab(source, 102);
  assert.deepEqual(h.ipcMain.invoke('tab-adopt-by-drop', target.chromeView.webContents, { wcId: 101 }), { ok: false, reason: 'not-dragging' });
  h.ipcMain.send('tab-drag-started', source.chromeView.webContents, 101);
  const result = h.ipcMain.invoke('tab-adopt-by-drop', target.chromeView.webContents, { wcId: 101 });
  assert.equal(result.ok, true);
  assert.equal(source.dragWcId, null);
});

test('tab activation conditionally rearms page focus after visibility and view insertion', () => {
  const h = setup();
  const record = h.makeRecord(1);
  const outgoing = h.addTab(record, 101);
  h.addTab(record, 102);
  record.activeTabWcId = 101;
  outgoing.webContents.focused = true;
  h.log.length = 0;
  h.ipcMain.send('tab-set-active', record.chromeView.webContents, {
    wcId: 102, bounds: { x: 1.2, y: 2.2, width: 900.8, height: 700.1 }
  });
  const add = h.log.findIndex((x) => x[0] === 'add-view' && x[2] === 102);
  const focus = h.log.findIndex((x) => x[0] === 'focus-wc' && x[1] === 102);
  assert.ok(add !== -1 && focus > add);
  assert.equal(record.activeTabWcId, 102);
});

test('remaining lifecycle channels execute through captured handlers with their established shapes', () => {
  const h = setup();
  const source = h.makeRecord(1);
  h.makeRecord(2);
  const first = h.addTab(source, 101);
  h.addTab(source, 102);
  source.activeTabWcId = 101;

  assert.deepEqual(h.ipcMain.invoke('tab-history-snapshot', source.chromeView.webContents, { webContentsId: 101 }), {
    entries: [{ url: first.webContents.url }], index: 0
  });
  assert.deepEqual(h.ipcMain.invoke('move-targets', source.chromeView.webContents), [{ windowId: 2 }]);
  h.ipcMain.send('tab-navigate', source.chromeView.webContents, { wcId: 101, verb: 'reload' });
  h.ipcMain.send('tab-find', source.chromeView.webContents, { wcId: 101, text: 'needle', options: { forward: true } });
  h.ipcMain.send('tab-set-bounds', source.chromeView.webContents, {
    wcId: 101, bounds: { x: 1.4, y: 2.4, width: 900.6, height: 700.6 }
  });
  h.ipcMain.send('tab-hide', source.chromeView.webContents, 101);
  assert.equal(first.visible, false);

  h.ipcMain.send('tab-drag-started', source.chromeView.webContents, 102);
  assert.equal(source.dragWcId, 102);
  h.ipcMain.send('tab-drag-ended', source.chromeView.webContents, 102);
  assert.equal(source.dragWcId, 102, 'grace clear is never synchronous');
  assert.equal(h.timers[0].ms, 1500);
  h.timers[0].fn();
  assert.equal(source.dragWcId, null);

  assert.equal(h.ipcMain.invoke('tab-move-to-new-window', source.chromeView.webContents, { wcId: 999 }), null,
    'menu move keeps its historical null refusal shape');
  h.ipcMain.send('tab-close', source.chromeView.webContents, 102, 1);
  assert.equal(h.history.includes(102), true);
  assert.equal(h.ipcMain.invoke('closed-tab-stack-size', source.chromeView.webContents), 1);
  const reopened = h.ipcMain.invoke('tab-reopen', source.chromeView.webContents);
  assert.equal(reopened.url, 'https://tab-102.test/');
  assert.equal(reopened.stripIndex, 1);
});
