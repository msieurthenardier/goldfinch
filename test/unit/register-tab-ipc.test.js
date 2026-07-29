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
      restore: (value) => { log.push(['restore', id, value]); return Promise.resolve(); },
      canGoBack: () => true,
      canGoForward: () => false,
      goBack: () => { this.log.push(['back', this.id]); },
      goForward: () => { this.log.push(['forward', this.id]); }
    };
  }
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; this.log.push(['destroy', this.id]); }
  getURL() { return this.url; }
  getTitle() { return `Tab ${this.id}`; }
  isFocused() { return this.focused; }
  focus() { this.log.push(['focus-wc', this.id]); }
  send(channel, payload) { this.log.push(['send', this.id, channel, payload]); }
  loadURL(url) { this.log.push(['load', this.id, url]); return Promise.resolve(); }
  reload() { this.log.push(['reload', this.id]); }
  stop() { this.log.push(['stop', this.id]); }
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
      htmlFullscreen: null,
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
  const faviconForgotten = [];
  const views = [];
  class WebContentsView {
    constructor(opts) { const view = new FakeView(opts, log, nextWcId++); views.push(view); return view; }
  }
  let nextWindowId = 50;
  // M14 F1 L1: fullscreen module FAKE mirroring the real contract's mutations
  // (mode clear on forceExit + restore of savedBounds; pending stash on
  // handleRendererBounds) — this suite asserts register-tab-ipc's CALL POINTS;
  // the real mode logic is pinned by html-fullscreen.test.js.
  const htmlFullscreen = {
    forceExit: (record) => {
      log.push(['force-exit', record.win.id, record.htmlFullscreen ? record.htmlFullscreen.wcId : null]);
      const mode = record.htmlFullscreen;
      record.htmlFullscreen = null;
      if (!mode) return;
      const entry = record.tabViews.get(mode.wcId);
      if (entry && !entry.view.webContents.isDestroyed()) entry.view.setBounds(mode.savedBounds);
    },
    handleRendererBounds: (record, wcId, rounded) => {
      if (record.htmlFullscreen && record.htmlFullscreen.wcId === wcId) {
        record.htmlFullscreen.pendingBounds = rounded;
        log.push(['defer-bounds', wcId]);
        return true;
      }
      return false;
    }
  };
  // M14 F1 L2: auth pending-challenge store FAKE — this suite asserts
  // register-tab-ipc's CALL POINTS; the real lifecycle is pinned by
  // auth-challenges.test.js.
  const authCalls = [];
  const authChallenges = {
    cancelForTab: (wcId, reason) => authCalls.push(['cancel-tab', wcId, reason]),
    notifyTabActivated: (record, wcId) => authCalls.push(['notify-activated', record.win.id, wcId])
  };
  // M14 F2 L1 (step 3b): popup registry FAKE — this suite asserts the move
  // core's re-key CALL POINT; the real re-key semantics are pinned by
  // popup-registry.test.js. L2: listForRecord backs the cancel-on-rekey walk —
  // a test seeds popupEntries with { popupWcId, openerWcId, openerRecord }.
  const popupRekeys = [];
  const popupEntries = [];
  const popupRegistry = {
    rekeyForRecord: (wcId, record) => {
      popupRekeys.push([wcId, record.win.id]);
      // Mirror the real registry: re-keyed entries now belong to the destination.
      for (const e of popupEntries) if (e.openerWcId === wcId) e.openerRecord = record;
    },
    listForRecord: (record) => popupEntries.filter((e) => e.openerRecord === record)
  };
  const deps = {
    ipcMain,
    WebContentsView,
    internalPreloadPath: '/preload/internal.js',
    webPreloadPath: '/preload/web.js',
    INTERNAL_PARTITION: 'goldfinch-internal',
    registry,
    htmlFullscreen,
    authChallenges,
    wireGuestContents: (wc) => log.push(['wire-guest', wc.id]),
    wireTabViewEvents: (_view, id, partition) => log.push(['wire-tab', id, partition]),
    captureClosedTabEntry: ({ tabEntry, stripIndex, windowId }) => ({ url: tabEntry.view.webContents.url, title: 'x', jarId: 'jar-a', stripIndex, windowId, navEntries: [], navIndex: 0 }),
    jars: { list: () => [{ id: 'jar-a', partition: 'persist:jar-a' }] },
    APPEND_SENTINEL: -1,
    closedTabStack: { push: (entry) => closed.push(entry), pop: () => closed.pop() || null, size: () => closed.length },
    broadcastClosedTabStackChanged: () => log.push(['broadcast-stack']),
    getHistoryRecorder: () => ({ forgetTab: (id) => history.push(id) }),
    faviconFetcher: { forget: (id) => faviconForgotten.push(id) },
    isSafeTabUrl: (url) => url.startsWith('https://'),
    isInternalPageUrl: (url) => url.startsWith('goldfinch://'),
    reopenStripIndex: (entry, winId) => entry.windowId === winId ? entry.stripIndex : -1,
    webContents,
    isInternalContents: (wc) => wc.internal === true,
    buildMoveTargets: (all, source) => all.filter((record) => record !== source).map((record) => ({ windowId: record.win.id })),
    createWindow: () => makeRecord(nextWindowId++),
    validateMoveTabPayload: (payload) => payload && typeof payload.wcId === 'number' ? payload : null,
    buildAdoptPayload: (payload, wc) => ({ ...payload, url: wc.getURL(), title: wc.getTitle() }),
    broadcastMoveTargetsChanged: () => log.push(['broadcast-targets']),
    getTabContents: (id) => webContents.fromId(id),
    popupRegistry,
    schedule: (fn, ms) => { const token = { fn, ms }; timers.push(token); return token; },
    cancelScheduled: (token) => { const i = timers.indexOf(token); if (i >= 0) timers.splice(i, 1); },
    logger: { warn() {}, error() {} }
  };
  registerTabIpc(deps);
  return { ipcMain, log, records, registry, makeRecord, addTab, views, timers, closed, history, faviconForgotten, authCalls, popupRekeys, popupEntries };
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
  // DD7 (M12 F1 Leg 4) / F2 DD4 security invariant: the WEB guest runs with
  // nodeIntegration off AND sandbox on — nodeIntegration:false denies page JS
  // an ipcRenderer (it cannot register a rogue 'vault-fill' listener to spoof
  // credential fills); sandbox:true additionally contains a hostile page's
  // V8/Blink RCE inside the OS-level Chromium sandbox instead of letting it
  // execute with full user-account privileges. contextIsolation stays false
  // (farbling needs the page main world) — the sandbox restricts the
  // preload's Node surface, not world isolation.
  assert.equal(h.views[0].opts.webPreferences.nodeIntegration, false);
  assert.equal(h.views[0].opts.webPreferences.sandbox, true);
  assert.equal(h.views[0].opts.webPreferences.preload, '/preload/web.js');
  // M14 F1 L4 (DD5): the WEB branch enables the plugin process (inline PDF
  // viewer) — with sandbox retained (asserted above). The internal branch must
  // NOT gain the key (deepEqual below is the structural pin; the explicit
  // assertion documents the invariant).
  assert.equal(h.views[0].opts.webPreferences.plugins, true);
  assert.ok(h.log.findIndex((x) => x[0] === 'wire-tab') < h.log.findIndex((x) => x[0] === 'load'));

  await h.ipcMain.invoke('tab-create', source.chromeView.webContents, {
    url: 'goldfinch://settings', partition: 'ignored', trusted: true
  });
  assert.deepEqual(h.views[1].opts.webPreferences, {
    preload: '/preload/internal.js', contextIsolation: true, sandbox: true,
    nodeIntegration: false, partition: 'goldfinch-internal', spellcheck: false
  });
  assert.equal('plugins' in h.views[1].opts.webPreferences, false,
    'internal branch webPreferences must not carry a plugins key (DD5 scopes the relaxation to web guests)');
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
  assert.equal(h.faviconForgotten.includes(102), true, 'favicon fetcher forgets the closed tab beside the history recorder');
  assert.equal(h.ipcMain.invoke('closed-tab-stack-size', source.chromeView.webContents), 1);
  const reopened = h.ipcMain.invoke('tab-reopen', source.chromeView.webContents);
  assert.equal(reopened.url, 'https://tab-102.test/');
  assert.equal(reopened.stripIndex, 1);
});

// ---------------------------------------------------------------------------
// M14 F1 L1 (DD1) — fullscreen bounds gate + exit edges. The htmlFullscreen
// dep is the contract-mirroring fake defined in setup(); these tests pin THIS
// module's call points: where the gate is consulted, where force-exit fires,
// and their ordering against the surrounding handler bodies.
// ---------------------------------------------------------------------------

function armFullscreen(record, wcId, savedBounds = { x: 0, y: 80, width: 1000, height: 700 }) {
  record.htmlFullscreen = { wcId, savedBounds, pendingBounds: null };
}

test('fullscreen: tab-set-bounds defers the fullscreen tab (no apply, no overlay fan-out); other tabs apply normally', () => {
  const h = setup();
  const record = h.makeRecord(1);
  const fsView = h.addTab(record, 101);
  const other = h.addTab(record, 102);
  record.activeTabWcId = 101;
  armFullscreen(record, 101);
  fsView.bounds = { x: 0, y: 0, width: 1200, height: 800 }; // expanded
  h.log.length = 0;

  h.ipcMain.send('tab-set-bounds', record.chromeView.webContents, {
    wcId: 101, bounds: { x: 0, y: 80.4, width: 1000.2, height: 700.4 }
  });
  assert.deepEqual(record.htmlFullscreen.pendingBounds, { x: 0, y: 80, width: 1000, height: 700 }, 'rounded rect stored as pending');
  assert.deepEqual(fsView.bounds, { x: 0, y: 0, width: 1200, height: 800 }, 'the expanded guest is never shrunk');
  assert.equal(h.log.some((x) => x[0] === 'sync-find' || x[0] === 'sync-menu'), false, 'overlay syncBounds fan-out skipped');

  // A DIFFERENT (background) tab's bounds still apply normally.
  h.ipcMain.send('tab-set-bounds', record.chromeView.webContents, {
    wcId: 102, bounds: { x: 0, y: 80, width: 990, height: 690 }
  });
  assert.deepEqual(other.bounds, { x: 0, y: 80, width: 990, height: 690 });
});

test('fullscreen: activating a DIFFERENT tab force-exits BEFORE the swap; the restored rect lands on the old holder', () => {
  const h = setup();
  const record = h.makeRecord(1);
  const fsView = h.addTab(record, 101);
  h.addTab(record, 102);
  record.activeTabWcId = 101;
  record.tabViews.get(101).active = true;
  const saved = { x: 0, y: 80, width: 1000, height: 700 };
  armFullscreen(record, 101, saved);
  fsView.bounds = { x: 0, y: 0, width: 1200, height: 800 };
  h.log.length = 0;

  h.ipcMain.send('tab-set-active', record.chromeView.webContents, {
    wcId: 102, bounds: { x: 0, y: 80, width: 1000, height: 700 }
  });
  assert.equal(record.htmlFullscreen, null);
  assert.deepEqual(h.log.find((x) => x[0] === 'force-exit'), ['force-exit', 1, 101]);
  assert.deepEqual(fsView.bounds, saved, 'old holder restored by the force-exit');
  const exitIdx = h.log.findIndex((x) => x[0] === 'force-exit');
  const raiseIdx = h.log.findIndex((x) => x[0] === 'add-view' && x[2] === 102);
  assert.ok(exitIdx < raiseIdx, 'force-exit runs before the incoming activation work');
  assert.equal(record.activeTabWcId, 102);
});

test('fullscreen: same-tab tab-set-active is a geometry no-op — bounds deferred, find restore and sheet sync skipped', () => {
  const h = setup();
  const record = h.makeRecord(1);
  const fsView = h.addTab(record, 101);
  record.activeTabWcId = 101;
  record.tabViews.get(101).active = true;
  armFullscreen(record, 101);
  fsView.bounds = { x: 0, y: 0, width: 1200, height: 800 };
  // A live find session on the fullscreen tab: the AC6b restore branch would
  // fire show() here if the same-tab skip regressed.
  record.findOverlay.isSessionActive = (wcId) => wcId === 101;
  record.findOverlay.getSessionTabWcId = () => 101;
  h.log.length = 0;

  h.ipcMain.send('tab-set-active', record.chromeView.webContents, {
    wcId: 101, bounds: { x: 0, y: 80, width: 1000, height: 700 }
  });
  assert.deepEqual(fsView.bounds, { x: 0, y: 0, width: 1200, height: 800 }, 'MCP activateTab must not shrink the fullscreen guest');
  assert.deepEqual(record.htmlFullscreen.pendingBounds, { x: 0, y: 80, width: 1000, height: 700 });
  assert.equal(h.log.some((x) => x[0] === 'show-find' || x[0] === 'sync-find'), false, 'find restore branch skipped');
  assert.equal(h.log.some((x) => x[0] === 'sync-menu'), false, 'sheet syncBounds skipped');
  assert.equal(h.log.some((x) => x[0] === 'force-exit'), false, 'same-tab activation is NOT an exit edge');
});

test('fullscreen: tab-hide of the holding tab force-exits first', () => {
  const h = setup();
  const record = h.makeRecord(1);
  const fsView = h.addTab(record, 101);
  record.activeTabWcId = 101;
  const saved = { x: 0, y: 80, width: 1000, height: 700 };
  armFullscreen(record, 101, saved);
  fsView.bounds = { x: 0, y: 0, width: 1200, height: 800 };
  h.log.length = 0;

  h.ipcMain.send('tab-hide', record.chromeView.webContents, 101);
  assert.equal(record.htmlFullscreen, null);
  assert.deepEqual(fsView.bounds, saved);
  const exitIdx = h.log.findIndex((x) => x[0] === 'force-exit');
  const hideIdx = h.log.findIndex((x) => x[0] === 'visible' && x[1] === 101 && x[2] === false);
  assert.ok(exitIdx !== -1 && exitIdx < hideIdx, 'restore runs while the entry is still resolvable');
});

test('fullscreen: tab-close clears the mode even after the entry is destroyed (armed gate never survives its tab)', () => {
  const h = setup();
  const record = h.makeRecord(1);
  h.addTab(record, 101);
  h.addTab(record, 102);
  record.activeTabWcId = 101;
  armFullscreen(record, 101);

  h.ipcMain.send('tab-close', record.chromeView.webContents, 101, -1);
  assert.equal(record.htmlFullscreen, null);
  assert.ok(h.log.some((x) => x[0] === 'force-exit' && x[2] === 101));
});

test('fullscreen: closing a NON-holding tab leaves the mode armed', () => {
  const h = setup();
  const record = h.makeRecord(1);
  h.addTab(record, 101);
  h.addTab(record, 102);
  record.activeTabWcId = 101;
  armFullscreen(record, 101);

  h.ipcMain.send('tab-close', record.chromeView.webContents, 102, -1);
  assert.deepEqual(record.htmlFullscreen && record.htmlFullscreen.wcId, 101);
  assert.equal(h.log.some((x) => x[0] === 'force-exit'), false);
});

test('fullscreen: moveTabIntoWindow force-exits BEFORE the geometry capture — the target seeds the RESTORED rect', () => {
  const h = setup();
  const source = h.makeRecord(1);
  h.makeRecord(2);
  const moved = h.addTab(source, 101);
  h.addTab(source, 102);
  source.activeTabWcId = 101;
  const saved = { x: 0, y: 80, width: 1000, height: 700 };
  armFullscreen(source, 101, saved);
  moved.bounds = { x: 0, y: 0, width: 1200, height: 800 }; // expanded fullscreen rect

  const result = h.ipcMain.invoke('tab-move-to-window', source.chromeView.webContents, { wcId: 101, windowId: 2 });
  assert.equal(result.ok, true);
  assert.equal(source.htmlFullscreen, null, 'the gate never stays armed on the source record');
  // The post-re-parent seed setBounds carries the CAPTURED rect: if the
  // capture had run before force-exit it would seed the full-window rect.
  assert.deepEqual(moved.bounds, saved, 'captured (and re-applied) rect is the restored slot rect');
});

// Leg 2 (F3 DD2, AC1/AC5): sender-identity gate on the wcId-scoped channels —
// a non-chrome sender and a DIFFERENT window's real chrome are both refused,
// while the legitimate owning chrome (already covered by every test above)
// keeps working.
test('AC1: owning-chrome checks refuse non-chrome and cross-window senders on wcId-scoped channels', () => {
  const h = setup();
  const source = h.makeRecord(1);
  const other = h.makeRecord(2);
  const tab = h.addTab(source, 101);
  tab.setVisible(true);
  source.tabViews.get(101).active = true;

  // A non-chrome sender (bare object — resolves no window at all) is refused on
  // a wcId-scoped channel: the tab survives untouched.
  h.ipcMain.send('tab-close', {}, 101, -1);
  assert.equal(source.tabViews.has(101), true, 'a non-chrome sender cannot close a tab');

  // Cross-window: window 2's REAL chrome sender resolves a record via
  // getWindowForChrome, but that record does not equal getWindowForGuest(101) —
  // refused all the same.
  h.ipcMain.send('tab-hide', other.chromeView.webContents, 101);
  assert.equal(tab.visible, true, 'a different window\'s chrome cannot hide this tab');
  assert.equal(source.tabViews.get(101).active, true);

  h.ipcMain.send('tab-set-active', other.chromeView.webContents, { wcId: 101, bounds: { x: 0, y: 0, width: 10, height: 10 } });
  assert.equal(other.activeTabWcId, null, 'cross-window tab-set-active is refused, not just a no-op on the wrong record');

  // A non-chrome sender is also refused on the chrome-required (not owning-
  // scoped) tab-history-snapshot handle.
  assert.equal(h.ipcMain.invoke('tab-history-snapshot', {}, { webContentsId: 101 }), null);

  // The legitimate owning chrome still works (AC6 — no regression).
  h.ipcMain.send('tab-hide', source.chromeView.webContents, 101);
  assert.equal(tab.visible, false);
});

// Leg 2 (F3 DD2, AC3/AC5): tab-navigate's loadURL gate is BRANCHED on the target
// tab's trust — never an unconditional isSafeTabUrl. This is the HIGH-regression
// guard: openSiteSettingsTab navigates an EXISTING INTERNAL tab to
// goldfinch://settings/#privacy, which isSafeTabUrl alone would reject outright.
test('AC3: tab-navigate loadURL is gated on the target tab\'s trust — unsafe web URL refused, internal goldfinch:// allowed', () => {
  const h = setup();
  const source = h.makeRecord(1);
  h.addTab(source, 101, false);
  h.addTab(source, 102, true);

  // WEB tab: an unsafe URL is refused — no loadURL call reaches the guest.
  h.ipcMain.send('tab-navigate', source.chromeView.webContents, { wcId: 101, verb: 'loadURL', args: ['javascript:alert(1)'] });
  assert.equal(h.log.some((x) => x[0] === 'load' && x[1] === 101), false);

  // WEB tab: a safe https URL still loads (no regression on the common case).
  h.ipcMain.send('tab-navigate', source.chromeView.webContents, { wcId: 101, verb: 'loadURL', args: ['https://example.test/'] });
  assert.ok(h.log.some((x) => x[0] === 'load' && x[1] === 101 && x[2] === 'https://example.test/'));

  // INTERNAL tab: goldfinch://settings/#privacy is ALLOWED — the regression this
  // leg exists to avoid (openSiteSettingsTab must keep working).
  h.ipcMain.send('tab-navigate', source.chromeView.webContents, { wcId: 102, verb: 'loadURL', args: ['goldfinch://settings/#privacy'] });
  assert.ok(h.log.some((x) => x[0] === 'load' && x[1] === 102 && x[2] === 'goldfinch://settings/#privacy'));

  // INTERNAL tab: a web URL is refused — isInternalPageUrl (not isSafeTabUrl) governs
  // the internal branch, and it rejects a non-goldfinch: URL.
  h.ipcMain.send('tab-navigate', source.chromeView.webContents, { wcId: 102, verb: 'loadURL', args: ['https://evil.test/'] });
  assert.equal(h.log.filter((x) => x[0] === 'load' && x[1] === 102).length, 1, 'the internal tab only ever loaded the one allowed URL');

  // A non-chrome sender is refused outright by the owning-chrome check, before
  // the URL gate is even reached.
  h.ipcMain.send('tab-navigate', {}, { wcId: 101, verb: 'loadURL', args: ['https://example.test/'] });
  assert.equal(h.log.filter((x) => x[0] === 'load' && x[1] === 101).length, 1, 'an unowned sender adds no further loads');
});

// ---------------------------------------------------------------------------
// M14 F1 L2 (DD2) — auth pending-challenge store call points.
// ---------------------------------------------------------------------------

test('tab-close cancels the closing tab pending auth challenges (M14 F1 L2)', () => {
  const h = setup();
  const record = h.makeRecord(1);
  const view = h.addTab(record, 100);
  void view;
  h.ipcMain.send('tab-close', record.chromeView.webContents, 100, 0);
  assert.deepEqual(h.authCalls, [['cancel-tab', 100, 'tab-close']]);
});

test('a cross-window move cancels the moved tab pending auth challenges at move time (flight DD2 ruling)', () => {
  const h = setup();
  const source = h.makeRecord(1);
  h.addTab(source, 100);
  h.addTab(source, 101);
  const result = h.ipcMain.invoke('tab-move-to-new-window', source.chromeView.webContents, { wcId: 100 });
  assert.equal(result.ok, true);
  assert.deepEqual(h.authCalls.filter((c) => c[0] === 'cancel-tab'), [['cancel-tab', 100, 'moved']]);
});

test('a REFUSED move (sole tab) cancels nothing — the guards run before the cancel', () => {
  const h = setup();
  const source = h.makeRecord(1);
  h.addTab(source, 100); // sole tab → refused
  const result = h.ipcMain.invoke('tab-move-to-new-window', source.chromeView.webContents, { wcId: 100 });
  assert.equal(result, null);
  assert.deepEqual(h.authCalls, [], 'a refused move must not cancel live challenges');
});

test('tab-set-active notifies the auth store AFTER activeTabWcId is written (re-present trigger)', () => {
  const h = setup();
  const record = h.makeRecord(1);
  h.addTab(record, 100);
  h.ipcMain.send('tab-set-active', record.chromeView.webContents, { wcId: 100, bounds: { x: 0, y: 80, width: 1000, height: 700 } });
  assert.deepEqual(h.authCalls, [['notify-activated', 1, 100]]);
  assert.equal(record.activeTabWcId, 100, 'the eligibility read (activeTabWcId) is already current');
});

// ---------------------------------------------------------------------------
// M14 F2 L1 (step 3b) — popup re-key on cross-window tab moves.
// ---------------------------------------------------------------------------

test('a committed move re-keys the moved tab popups to the DESTINATION record (M14 F2 L1)', () => {
  const h = setup();
  const source = h.makeRecord(1);
  h.addTab(source, 100);
  h.addTab(source, 101);
  const result = h.ipcMain.invoke('tab-move-to-new-window', source.chromeView.webContents, { wcId: 100 });
  assert.equal(result.ok, true);
  assert.deepEqual(h.popupRekeys, [[100, result.windowId]],
    'popups opened by the moved tab now belong to the destination window (DD1f closes with the CURRENT owner)');
});

test('a REFUSED move re-keys nothing — the guards run before the re-key', () => {
  const h = setup();
  const source = h.makeRecord(1);
  h.addTab(source, 100); // sole tab → refused
  const result = h.ipcMain.invoke('tab-move-to-new-window', source.chromeView.webContents, { wcId: 100 });
  assert.equal(result, null);
  assert.deepEqual(h.popupRekeys, []);
});

test('cancel-on-rekey (M14 F2 L2, FD ruling): a committed move cancels the MOVED opener popups challenges with tab-parity reason moved', () => {
  const h = setup();
  const source = h.makeRecord(1);
  h.addTab(source, 100);
  h.addTab(source, 101);
  // Two popups opened by the moving tab, one by the staying tab.
  h.popupEntries.push(
    { popupWcId: 701, openerWcId: 100, openerRecord: source },
    { popupWcId: 702, openerWcId: 100, openerRecord: source },
    { popupWcId: 703, openerWcId: 101, openerRecord: source }
  );
  const result = h.ipcMain.invoke('tab-move-to-new-window', source.chromeView.webContents, { wcId: 100 });
  assert.equal(result.ok, true);
  const cancels = h.authCalls.filter((c) => c[0] === 'cancel-tab');
  assert.deepEqual(cancels, [
    ['cancel-tab', 100, 'moved'],            // the tab contract (F1 DD2 ruling)
    ['cancel-tab', 701, 'moved'],            // its popups — byte-consistent reason
    ['cancel-tab', 702, 'moved'],
  ], 'moved-opener popups cancel; the staying tab popup (703) is untouched — no hung callback across a re-key');
});

test('cancel-on-rekey: a REFUSED move cancels no popup challenges (guards precede the hook)', () => {
  const h = setup();
  const source = h.makeRecord(1);
  h.addTab(source, 100); // sole tab → refused
  h.popupEntries.push({ popupWcId: 701, openerWcId: 100, openerRecord: source });
  const result = h.ipcMain.invoke('tab-move-to-new-window', source.chromeView.webContents, { wcId: 100 });
  assert.equal(result, null);
  assert.deepEqual(h.authCalls, []);
});
