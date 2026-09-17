'use strict';

const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  registerTabIpc,
  queueChromeSend,
  createSendOrQueue,
  pushTabStateFor
} = require('../../src/main/register-tab-ipc');

class FakeIpc {
  constructor() {
    this.handles = new Map();
    this.listeners = new Map();
  }
  handle(channel, fn) {
    this.handles.set(channel, fn);
  }
  on(channel, fn) {
    this.listeners.set(channel, fn);
  }
  invoke(channel, sender, ...args) {
    return this.handles.get(channel)({ sender }, ...args);
  }
  send(channel, sender, ...args) {
    return this.listeners.get(channel)({ sender }, ...args);
  }
}

class FakeContents extends EventEmitter {
  constructor(id, log) {
    super();
    this.id = id;
    this.log = log;
    this.destroyed = false;
    this.focused = false;
    this.url = `https://tab-${id}.test/`;
    // Mission 20 Flight 3 Leg 2: default history length 1 (the common "has
    // committed something" case) — a test exercising the empty-history reload
    // fallback overrides this directly (`wc.navigationHistory._length = 0`).
    this._historyLength = 1;
    this.navigationHistory = {
      getAllEntries: () => [{ url: this.url }],
      getActiveIndex: () => 0,
      length: () => this._historyLength,
      restore: (value) => {
        log.push(['restore', id, value]);
        return Promise.resolve();
      },
      canGoBack: () => true,
      canGoForward: () => false,
      goBack: () => {
        this.log.push(['back', this.id]);
      },
      goForward: () => {
        this.log.push(['forward', this.id]);
      }
    };
  }
  isDestroyed() {
    return this.destroyed;
  }
  destroy() {
    this.destroyed = true;
    this.log.push(['destroy', this.id]);
  }
  getURL() {
    return this.url;
  }
  getTitle() {
    return `Tab ${this.id}`;
  }
  isFocused() {
    return this.focused;
  }
  focus() {
    this.log.push(['focus-wc', this.id]);
  }
  send(channel, payload) {
    this.log.push(['send', this.id, channel, payload]);
  }
  loadURL(url) {
    this.log.push(['load', this.id, url]);
    return Promise.resolve();
  }
  reload() {
    this.log.push(['reload', this.id]);
  }
  stop() {
    this.log.push(['stop', this.id]);
  }
  forcefullyCrashRenderer() {
    this.log.push(['force-crash', this.id]);
  }
  findInPage(text, options) {
    this.log.push(['find', this.id, text, options]);
  }
  stopFindInPage(action) {
    this.log.push(['stop-find', this.id, action]);
  }
  setWebRTCIPHandlingPolicy(policy) {
    this.log.push(['webrtc-policy', this.id, policy]);
  }
}

class FakeView {
  constructor(opts, log, id) {
    this.opts = opts;
    this.log = log;
    this.webContents = new FakeContents(id, log);
    this.bounds = { x: 0, y: 80, width: 1000, height: 700 };
    this.visible = false;
  }
  setBounds(bounds) {
    this.bounds = { ...bounds };
    this.log.push(['bounds', this.webContents.id, bounds]);
  }
  getBounds() {
    return { ...this.bounds };
  }
  setVisible(value) {
    this.visible = value;
    this.log.push(['visible', this.webContents.id, value]);
  }
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
    // M15 F3 Leg 4: routing class 3 (owner-resolved per-tab push) — the real
    // registry's getChromeForTab is exactly this, resolved at event time.
    getChromeForTab: (wcId) => {
      const rec = records.find((record) => record.tabViews.has(wcId));
      return rec ? rec.chromeView.webContents : null;
    },
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
        isDestroyed() {
          return this.destroyed;
        },
        focus: () => log.push(['raise', id]),
        close() {
          this.closed = true;
          log.push(['close-window', id]);
        }
      },
      chromeView: { webContents: chrome },
      tabViews: new Map(),
      activeTabWcId: null,
      noBootTab: false,
      bootConfigServed: true,
      pendingChromeSends: [],
      dragWcId: null,
      bookmarkDragActive: false, // M15 F3 Leg 4 — the bookmark drag's OWN slot
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
    record.tabViews.set(wcId, {
      view,
      partition: trusted ? 'goldfinch-internal' : 'persist:jar-a',
      trusted,
      active: false
    });
    return view;
  }
  const webContents = {
    fromId: (id) =>
      records.flatMap((r) => [...r.tabViews.values()]).find((e) => e.view.webContents.id === id)?.view.webContents ||
      null
  };
  const timers = [];
  const closed = [];
  const history = [];
  const faviconForgotten = [];
  const views = [];
  class WebContentsView {
    constructor(opts) {
      const view = new FakeView(opts, log, nextWcId++);
      views.push(view);
      return view;
    }
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
    captureClosedTabEntry: ({ tabEntry, stripIndex, windowId }) => ({
      url: tabEntry.view.webContents.url,
      title: 'x',
      jarId: 'jar-a',
      stripIndex,
      windowId,
      navEntries: [],
      navIndex: 0
    }),
    jars: { list: () => [{ id: 'jar-a', partition: 'persist:jar-a' }] },
    APPEND_SENTINEL: -1,
    closedTabStack: { push: (entry) => closed.push(entry), pop: () => closed.pop() || null, size: () => closed.length },
    broadcastClosedTabStackChanged: () => log.push(['broadcast-stack']),
    getHistoryRecorder: () => ({ forgetTab: (id) => history.push(id) }),
    faviconFetcher: { forget: (id) => faviconForgotten.push(id) },
    isSafeTabUrl: (url) => url.startsWith('https://'),
    isInternalPageUrl: (url) => url.startsWith('goldfinch://'),
    reopenStripIndex: (entry, winId) => (entry.windowId === winId ? entry.stripIndex : -1),
    webContents,
    isInternalContents: (wc) => wc.internal === true,
    buildMoveTargets: (all, source) =>
      all.filter((record) => record !== source).map((record) => ({ windowId: record.win.id })),
    createWindow: () => makeRecord(nextWindowId++),
    validateMoveTabPayload: (payload) => (payload && typeof payload.wcId === 'number' ? payload : null),
    buildAdoptPayload: (payload, wc) => ({ ...payload, url: wc.getURL(), title: wc.getTitle() }),
    broadcastMoveTargetsChanged: () => log.push(['broadcast-targets']),
    getTabContents: (id) => webContents.fromId(id),
    popupRegistry,
    schedule: (fn, ms) => {
      const token = { fn, ms };
      timers.push(token);
      return token;
    },
    cancelScheduled: (token) => {
      const i = timers.indexOf(token);
      if (i >= 0) timers.splice(i, 1);
    },
    logger: { warn() {}, error() {} }
  };
  registerTabIpc(deps);
  return {
    ipcMain,
    log,
    records,
    registry,
    makeRecord,
    addTab,
    views,
    timers,
    closed,
    history,
    faviconForgotten,
    authCalls,
    popupRekeys,
    popupEntries
  };
}

test('registers the complete tab/move channel set exactly once', () => {
  const h = setup();
  assert.deepEqual(
    [...h.ipcMain.handles.keys()].sort(),
    [
      'closed-tab-stack-size',
      'move-targets',
      'tab-adopt-by-drop',
      // Mission 20 Flight 2 Leg 4 (DD9): the cert-viewer card's read-only summary.
      'tab-certificate-get',
      'tab-create',
      // M17 F1 L1 (DD2/DD4): the F6 chrome→content focus-entry gesture's handle.
      'tab-focus-guest',
      'tab-history-snapshot',
      'tab-move-to-new-window',
      'tab-move-to-window',
      'tab-reopen',
      'tab-tear-off'
    ].sort()
  );
  assert.deepEqual(
    [...h.ipcMain.listeners.keys()].sort(),
    [
      // M15 F3 Leg 4: the bookmark-drag bookend (chrome-sender) + the guest's bare
      // drop signal (guest-sender) — three new one-way channels.
      'bookmark-drag-ended',
      'bookmark-drag-started',
      'guest-bookmark-drop',
      'tab-close',
      'tab-drag-ended',
      'tab-drag-started',
      'tab-find',
      'tab-hide',
      'tab-navigate',
      'tab-set-active',
      'tab-set-bounds'
    ].sort()
  );
});

// ---------------------------------------------------------------------------
// tab-focus-guest (M17 Flight 1 Leg 1, DD2/DD4/AC4): the F6 focus-entry
// bridge. Sender-validated, no wcId payload — focuses ONLY the sender
// window's OWN active tab.
// ---------------------------------------------------------------------------

test("tab-focus-guest: focuses the sender window's active tab guest", async () => {
  const h = setup();
  const record = h.makeRecord(1);
  const view = h.addTab(record, 101);
  record.activeTabWcId = 101;
  const ok = await h.ipcMain.invoke('tab-focus-guest', record.chromeView.webContents);
  assert.equal(ok, true);
  assert.deepEqual(
    h.log.filter((e) => e[0] === 'focus-wc'),
    [['focus-wc', 101]]
  );
  assert.equal(view.webContents.id, 101);
});

test('tab-focus-guest: no active tab on the sender window refuses (no focus call)', async () => {
  const h = setup();
  const record = h.makeRecord(1);
  h.addTab(record, 101);
  record.activeTabWcId = null;
  const ok = await h.ipcMain.invoke('tab-focus-guest', record.chromeView.webContents);
  assert.equal(ok, false);
  assert.deepEqual(
    h.log.filter((e) => e[0] === 'focus-wc'),
    []
  );
});

test('tab-focus-guest: activeTabWcId pointing at an unknown/stale tab refuses', async () => {
  const h = setup();
  const record = h.makeRecord(1);
  record.activeTabWcId = 999; // no matching tabViews entry
  const ok = await h.ipcMain.invoke('tab-focus-guest', record.chromeView.webContents);
  assert.equal(ok, false);
});

test('tab-focus-guest: a non-chrome sender is refused', async () => {
  const h = setup();
  const record = h.makeRecord(1);
  h.addTab(record, 101);
  record.activeTabWcId = 101;
  const ok = await h.ipcMain.invoke('tab-focus-guest', {}); // no chrome record owns this sender
  assert.equal(ok, false);
  assert.deepEqual(
    h.log.filter((e) => e[0] === 'focus-wc'),
    []
  );
});

test("tab-focus-guest: window A's active tab is unaffected by window B — never cross-window", async () => {
  const h = setup();
  const a = h.makeRecord(1);
  const b = h.makeRecord(2);
  h.addTab(a, 101);
  h.addTab(b, 201);
  a.activeTabWcId = 101;
  b.activeTabWcId = 201;
  const ok = await h.ipcMain.invoke('tab-focus-guest', b.chromeView.webContents);
  assert.equal(ok, true);
  assert.deepEqual(
    h.log.filter((e) => e[0] === 'focus-wc'),
    [['focus-wc', 201]],
    "only window B's own active tab (201) is focused, never window A's (101)"
  );
});

test('tab-create preserves trusted/untrusted construction and wires before navigation', async () => {
  const h = setup();
  const source = h.makeRecord(1);
  const webId = await h.ipcMain.invoke('tab-create', source.chromeView.webContents, {
    url: 'https://example.test/',
    partition: 'persist:jar-a',
    trusted: false
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
    url: 'goldfinch://settings',
    partition: 'ignored',
    trusted: true
  });
  assert.deepEqual(h.views[1].opts.webPreferences, {
    preload: '/preload/internal.js',
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    partition: 'goldfinch-internal',
    spellcheck: false
  });
  assert.equal(
    'plugins' in h.views[1].opts.webPreferences,
    false,
    'internal branch webPreferences must not carry a plugins key (DD5 scopes the relaxation to web guests)'
  );
});

// Squawk 0036 (#104 carve-out): burner tabs must not leak LAN/public IPs via
// WebRTC ICE candidate gathering — a burner-hardening invariant, no user
// toggle. Gated on the pinned `burner:<n>` partition shape (isBurnerPartition,
// src/shared/burner.js), never on trust level alone (internal tabs never reach
// this branch; normal jars must NOT get the call — out of scope, #147).
test('tab-create sets the disable_non_proxied_udp WebRTC policy for a burner partition, and only there', async () => {
  const h = setup();
  const source = h.makeRecord(1);

  await h.ipcMain.invoke('tab-create', source.chromeView.webContents, {
    url: 'https://example.test/',
    partition: 'burner:42',
    trusted: false
  });
  assert.deepEqual(
    h.log.filter((x) => x[0] === 'webrtc-policy'),
    [['webrtc-policy', h.views[0].webContents.id, 'disable_non_proxied_udp']],
    'burner web guest gets the policy exactly once'
  );

  await h.ipcMain.invoke('tab-create', source.chromeView.webContents, {
    url: 'https://example.test/',
    partition: 'persist:jar-a',
    trusted: false
  });
  await h.ipcMain.invoke('tab-create', source.chromeView.webContents, {
    url: 'goldfinch://settings',
    partition: 'ignored',
    trusted: true
  });
  assert.equal(
    h.log.filter((x) => x[0] === 'webrtc-policy').length,
    1,
    'a normal-jar web guest and an internal guest never receive the burner-only policy call'
  );
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
    wcId: 101,
    windowId: 2,
    sourceWindowId: 999
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
  assert.deepEqual(h.ipcMain.invoke('tab-move-to-window', {}, { wcId: 101, windowId: 2 }), {
    ok: false,
    reason: 'no-source'
  });
  assert.deepEqual(h.ipcMain.invoke('tab-move-to-window', source.chromeView.webContents, {}), {
    ok: false,
    reason: 'bad-payload'
  });
  assert.deepEqual(
    h.ipcMain.invoke('tab-move-to-window', source.chromeView.webContents, { wcId: 101, windowId: 999 }),
    { ok: false, reason: 'no-target' }
  );
  assert.deepEqual(h.ipcMain.invoke('tab-tear-off', source.chromeView.webContents, { wcId: 101 }), {
    ok: false,
    reason: 'sole-tab'
  });
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
  assert.deepEqual(h.ipcMain.invoke('tab-adopt-by-drop', target.chromeView.webContents, { wcId: 101 }), {
    ok: false,
    reason: 'not-dragging'
  });
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
    wcId: 102,
    bounds: { x: 1.2, y: 2.2, width: 900.8, height: 700.1 }
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
    entries: [{ url: first.webContents.url }],
    index: 0
  });
  assert.deepEqual(h.ipcMain.invoke('move-targets', source.chromeView.webContents), [{ windowId: 2 }]);
  h.ipcMain.send('tab-navigate', source.chromeView.webContents, { wcId: 101, verb: 'reload' });
  h.ipcMain.send('tab-find', source.chromeView.webContents, { wcId: 101, text: 'needle', options: { forward: true } });
  h.ipcMain.send('tab-set-bounds', source.chromeView.webContents, {
    wcId: 101,
    bounds: { x: 1.4, y: 2.4, width: 900.6, height: 700.6 }
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

  assert.equal(
    h.ipcMain.invoke('tab-move-to-new-window', source.chromeView.webContents, { wcId: 999 }),
    null,
    'menu move keeps its historical null refusal shape'
  );
  h.ipcMain.send('tab-close', source.chromeView.webContents, 102, 1);
  assert.equal(h.history.includes(102), true);
  assert.equal(
    h.faviconForgotten.includes(102),
    true,
    'favicon fetcher forgets the closed tab beside the history recorder'
  );
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
    wcId: 101,
    bounds: { x: 0, y: 80.4, width: 1000.2, height: 700.4 }
  });
  assert.deepEqual(
    record.htmlFullscreen.pendingBounds,
    { x: 0, y: 80, width: 1000, height: 700 },
    'rounded rect stored as pending'
  );
  assert.deepEqual(fsView.bounds, { x: 0, y: 0, width: 1200, height: 800 }, 'the expanded guest is never shrunk');
  assert.equal(
    h.log.some((x) => x[0] === 'sync-find' || x[0] === 'sync-menu'),
    false,
    'overlay syncBounds fan-out skipped'
  );

  // A DIFFERENT (background) tab's bounds still apply normally.
  h.ipcMain.send('tab-set-bounds', record.chromeView.webContents, {
    wcId: 102,
    bounds: { x: 0, y: 80, width: 990, height: 690 }
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
    wcId: 102,
    bounds: { x: 0, y: 80, width: 1000, height: 700 }
  });
  assert.equal(record.htmlFullscreen, null);
  assert.deepEqual(
    h.log.find((x) => x[0] === 'force-exit'),
    ['force-exit', 1, 101]
  );
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
    wcId: 101,
    bounds: { x: 0, y: 80, width: 1000, height: 700 }
  });
  assert.deepEqual(
    fsView.bounds,
    { x: 0, y: 0, width: 1200, height: 800 },
    'MCP activateTab must not shrink the fullscreen guest'
  );
  assert.deepEqual(record.htmlFullscreen.pendingBounds, { x: 0, y: 80, width: 1000, height: 700 });
  assert.equal(
    h.log.some((x) => x[0] === 'show-find' || x[0] === 'sync-find'),
    false,
    'find restore branch skipped'
  );
  assert.equal(
    h.log.some((x) => x[0] === 'sync-menu'),
    false,
    'sheet syncBounds skipped'
  );
  assert.equal(
    h.log.some((x) => x[0] === 'force-exit'),
    false,
    'same-tab activation is NOT an exit edge'
  );
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
  assert.equal(
    h.log.some((x) => x[0] === 'force-exit'),
    false
  );
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
  assert.equal(tab.visible, true, "a different window's chrome cannot hide this tab");
  assert.equal(source.tabViews.get(101).active, true);

  h.ipcMain.send('tab-set-active', other.chromeView.webContents, {
    wcId: 101,
    bounds: { x: 0, y: 0, width: 10, height: 10 }
  });
  assert.equal(
    other.activeTabWcId,
    null,
    'cross-window tab-set-active is refused, not just a no-op on the wrong record'
  );

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
test("AC3: tab-navigate loadURL is gated on the target tab's trust — unsafe web URL refused, internal goldfinch:// allowed", () => {
  const h = setup();
  const source = h.makeRecord(1);
  h.addTab(source, 101, false);
  h.addTab(source, 102, true);

  // WEB tab: an unsafe URL is refused — no loadURL call reaches the guest.
  h.ipcMain.send('tab-navigate', source.chromeView.webContents, {
    wcId: 101,
    verb: 'loadURL',
    args: ['javascript:alert(1)']
  });
  assert.equal(
    h.log.some((x) => x[0] === 'load' && x[1] === 101),
    false
  );

  // WEB tab: a safe https URL still loads (no regression on the common case).
  h.ipcMain.send('tab-navigate', source.chromeView.webContents, {
    wcId: 101,
    verb: 'loadURL',
    args: ['https://example.test/']
  });
  assert.ok(h.log.some((x) => x[0] === 'load' && x[1] === 101 && x[2] === 'https://example.test/'));

  // INTERNAL tab: goldfinch://settings/#privacy is ALLOWED — the regression this
  // leg exists to avoid (openSiteSettingsTab must keep working).
  h.ipcMain.send('tab-navigate', source.chromeView.webContents, {
    wcId: 102,
    verb: 'loadURL',
    args: ['goldfinch://settings/#privacy']
  });
  assert.ok(h.log.some((x) => x[0] === 'load' && x[1] === 102 && x[2] === 'goldfinch://settings/#privacy'));

  // INTERNAL tab: a web URL is refused — isInternalPageUrl (not isSafeTabUrl) governs
  // the internal branch, and it rejects a non-goldfinch: URL.
  h.ipcMain.send('tab-navigate', source.chromeView.webContents, {
    wcId: 102,
    verb: 'loadURL',
    args: ['https://evil.test/']
  });
  assert.equal(
    h.log.filter((x) => x[0] === 'load' && x[1] === 102).length,
    1,
    'the internal tab only ever loaded the one allowed URL'
  );

  // A non-chrome sender is refused outright by the owning-chrome check, before
  // the URL gate is even reached.
  h.ipcMain.send('tab-navigate', {}, { wcId: 101, verb: 'loadURL', args: ['https://example.test/'] });
  assert.equal(
    h.log.filter((x) => x[0] === 'load' && x[1] === 101).length,
    1,
    'an unowned sender adds no further loads'
  );
});

// ---------------------------------------------------------------------------
// Mission 20 Flight 2 Leg 1 (#216, DD12 H2/H3): tab-navigate's loadURL branch
// arms entry.chromeNavPending from the SENDER chrome's OS focus at call time —
// the live spike traced the stranded-focus steal to an asynchronous guest
// self-focus that starts a few ms into the navigation, so the reactive
// chrome-blur listener (window-factory.js) is what actually reasserts; this
// handler's only job is recording whether that listener should care.
// ---------------------------------------------------------------------------

test('#216: tab-navigate loadURL arms entry.chromeNavPending when the sender chrome held focus', () => {
  const h = setup();
  const source = h.makeRecord(1);
  h.addTab(source, 101, false);
  source.chromeView.webContents.focused = true;

  h.ipcMain.send('tab-navigate', source.chromeView.webContents, {
    wcId: 101,
    verb: 'loadURL',
    args: ['https://example.test/']
  });

  assert.equal(source.tabViews.get(101).chromeNavPending, true);
});

test('#216: tab-navigate loadURL does NOT arm entry.chromeNavPending when the sender chrome did not hold focus', () => {
  const h = setup();
  const source = h.makeRecord(1);
  h.addTab(source, 101, false);
  source.chromeView.webContents.focused = false;

  h.ipcMain.send('tab-navigate', source.chromeView.webContents, {
    wcId: 101,
    verb: 'loadURL',
    args: ['https://example.test/']
  });

  assert.equal(source.tabViews.get(101).chromeNavPending, false);
});

test('#216: a SECOND tab-navigate re-evaluates chromeNavPending from the CURRENT chrome focus (a stale arm never survives)', () => {
  const h = setup();
  const source = h.makeRecord(1);
  h.addTab(source, 101, false);
  source.chromeView.webContents.focused = true;

  h.ipcMain.send('tab-navigate', source.chromeView.webContents, {
    wcId: 101,
    verb: 'loadURL',
    args: ['https://example.test/']
  });
  assert.equal(source.tabViews.get(101).chromeNavPending, true);

  source.chromeView.webContents.focused = false;
  h.ipcMain.send('tab-navigate', source.chromeView.webContents, {
    wcId: 101,
    verb: 'loadURL',
    args: ['https://example.test/two']
  });
  assert.equal(source.tabViews.get(101).chromeNavPending, false);
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
  assert.deepEqual(
    h.authCalls.filter((c) => c[0] === 'cancel-tab'),
    [['cancel-tab', 100, 'moved']]
  );
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
  h.ipcMain.send('tab-set-active', record.chromeView.webContents, {
    wcId: 100,
    bounds: { x: 0, y: 80, width: 1000, height: 700 }
  });
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
  assert.deepEqual(
    h.popupRekeys,
    [[100, result.windowId]],
    'popups opened by the moved tab now belong to the destination window (DD1f closes with the CURRENT owner)'
  );
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
  assert.deepEqual(
    cancels,
    [
      ['cancel-tab', 100, 'moved'], // the tab contract (F1 DD2 ruling)
      ['cancel-tab', 701, 'moved'], // its popups — byte-consistent reason
      ['cancel-tab', 702, 'moved']
    ],
    'moved-opener popups cancel; the staying tab popup (703) is untouched — no hung callback across a re-key'
  );
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

// ---------------------------------------------------------------------------
// M15 F3 Leg 4 (`drag-onto-page`) — the bookmark-drag bookend and the guest's
// bare drop signal (DD5/DD6; AC5/AC6/AC6b/AC8/AC9).
//
// This is the leg's security surface: a `contextIsolation: false` guest, where a
// hostile page can fabricate a DragEvent and reach our preload handler directly,
// is the sender of the signal that ends in a navigation. Every test below exists
// because of that, not for coverage.
// ---------------------------------------------------------------------------

/** Chrome sends recorded for a record, by channel. */
function chromeSends(h, record, channel) {
  return h.log.filter((x) => x[0] === 'send' && x[1] === record.chromeView.webContents.id && x[2] === channel);
}

test('AC6: main REFUSES a guest drop signal with no bookmark drag declared — no forward at all', () => {
  const h = setup();
  const record = h.makeRecord(1);
  const guest = h.addTab(record, 101);

  // The fabricated-DragEvent case: a page with no drag in flight. There is no
  // declaration, so there is nothing to forward and no navigation can follow.
  h.ipcMain.send('guest-bookmark-drop', guest.webContents);
  assert.deepEqual(chromeSends(h, record, 'bookmark-drop'), []);
  assert.equal(record.bookmarkDragActive, false);
});

test("AC9: with a declaration, the signal forwards the SENDER's wcId — resolving tab-switch-mid-drag by construction", () => {
  const h = setup();
  const record = h.makeRecord(1);
  h.addTab(record, 101);
  const background = h.addTab(record, 102);
  record.activeTabWcId = 101; // the operator switched tabs mid-drag; 102 is NOT active

  h.ipcMain.send('bookmark-drag-started', record.chromeView.webContents);
  assert.equal(record.bookmarkDragActive, true);
  h.ipcMain.send('guest-bookmark-drop', background.webContents);

  const forwards = chromeSends(h, record, 'bookmark-drop');
  assert.equal(forwards.length, 1);
  // The tab that RECEIVED the drop, derived from event.sender.id — never the
  // active tab, and never anything a renderer named.
  assert.deepEqual(forwards[0][3], { targetWcId: 102 });
});

test('AC5/AC6: the declaration carries no bookmark identity — the payload of both sends is ignored entirely', () => {
  const h = setup();
  const record = h.makeRecord(1);
  const guest = h.addTab(record, 101);
  // A chrome (or anything able to reach the chrome bridge) naming a bookmark id
  // or a url on these channels changes nothing: the handlers read no payload.
  h.ipcMain.send('bookmark-drag-started', record.chromeView.webContents, { url: 'https://evil.test/', id: 'b1' });
  h.ipcMain.send('guest-bookmark-drop', guest.webContents, { url: 'https://evil.test/' });
  const forwards = chromeSends(h, record, 'bookmark-drop');
  assert.deepEqual(forwards[0][3], { targetWcId: 101 }, 'only the sender-derived wcId ever crosses');
});

test('AC6b: a successful forward CONSUMES the declaration — one navigation, in one tab, per drag', () => {
  const h = setup();
  const record = h.makeRecord(1);
  const dropped = h.addTab(record, 101);
  const other = h.addTab(record, 102); // a background tab the operator never dropped on

  h.ipcMain.send('bookmark-drag-started', record.chromeView.webContents);
  h.ipcMain.send('guest-bookmark-drop', dropped.webContents);
  assert.equal(record.bookmarkDragActive, false, 'consumed on the first successful forward');

  // Without the consume, EVERY guest in this window — including background tabs —
  // could fabricate a DragEvent for the whole drag plus its grace window and
  // navigate itself, repeatedly, destroying unrelated page state.
  h.ipcMain.send('guest-bookmark-drop', dropped.webContents);
  h.ipcMain.send('guest-bookmark-drop', other.webContents);
  assert.equal(chromeSends(h, record, 'bookmark-drop').length, 1, 'exactly one forward per declared drag');
});

test("AC6: the bookmark declaration lives on its OWN field — an in-flight TAB drag's dragWcId is untouched", () => {
  const h = setup();
  const record = h.makeRecord(1);
  h.addTab(record, 101);

  h.ipcMain.send('tab-drag-started', record.chromeView.webContents, 101);
  assert.equal(record.dragWcId, 101);

  h.ipcMain.send('bookmark-drag-started', record.chromeView.webContents);
  h.ipcMain.send('bookmark-drag-ended', record.chromeView.webContents);
  assert.equal(record.dragWcId, 101, 'dragWcId is a SINGLE slot per record — sharing it would clobber the tab drag');
  assert.equal(record.bookmarkDragActive, true, 'the bookmark clear is on a grace timer, never synchronous');
});

test("the bookmark declaration clears on a GRACE TIMER, at the tab bookend's 1500 ms", () => {
  const h = setup();
  const record = h.makeRecord(1);
  const guest = h.addTab(record, 101);

  h.ipcMain.send('bookmark-drag-started', record.chromeView.webContents);
  h.ipcMain.send('bookmark-drag-ended', record.chromeView.webContents);
  // AC7's ordering is the DEFAULT case, not an edge one: dragend fires in the
  // chrome at release while the drop is still crossing the guest's macrotask and
  // two IPC pipes. An immediate clear here would race a legitimate drop into
  // "no declaration" — intermittently.
  const timer = h.timers.at(-1);
  assert.equal(timer.ms, 1500);
  assert.equal(record.bookmarkDragActive, true);
  h.ipcMain.send('guest-bookmark-drop', guest.webContents);
  assert.equal(chromeSends(h, record, 'bookmark-drop').length, 1, 'a drop inside the grace window still forwards');

  // …and once the timer fires, the window is closed.
  h.ipcMain.send('bookmark-drag-started', record.chromeView.webContents);
  h.ipcMain.send('bookmark-drag-ended', record.chromeView.webContents);
  h.timers.at(-1).fn();
  assert.equal(record.bookmarkDragActive, false);
  h.ipcMain.send('guest-bookmark-drop', guest.webContents);
  assert.equal(chromeSends(h, record, 'bookmark-drop').length, 1, 'no forward after the grace expires');
});

test('a fresh declaration CANCELS a pending grace clear rather than being erased by it', () => {
  const h = setup();
  const record = h.makeRecord(1);
  const guest = h.addTab(record, 101);
  h.ipcMain.send('bookmark-drag-started', record.chromeView.webContents);
  h.ipcMain.send('bookmark-drag-ended', record.chromeView.webContents);
  const stale = h.timers.at(-1);
  h.ipcMain.send('bookmark-drag-started', record.chromeView.webContents); // second drag starts
  assert.equal(h.timers.includes(stale), false, "the previous drag's clear was cancelled");
  h.ipcMain.send('guest-bookmark-drop', guest.webContents);
  assert.equal(chromeSends(h, record, 'bookmark-drop').length, 1);
});

test('a NON-CHROME sender cannot declare a bookmark drag (the bookend is chrome-only)', () => {
  const h = setup();
  const record = h.makeRecord(1);
  const guest = h.addTab(record, 101);
  h.ipcMain.send('bookmark-drag-started', guest.webContents); // a guest trying to declare
  h.ipcMain.send('bookmark-drag-started', {});
  assert.equal(record.bookmarkDragActive, false);
  h.ipcMain.send('guest-bookmark-drop', guest.webContents);
  assert.deepEqual(chromeSends(h, record, 'bookmark-drop'), []);
});

test("CROSS-WINDOW drop: a drag declared in window A, released on window B's guest, is refused (deliberate no-op)", () => {
  const h = setup();
  const a = h.makeRecord(1);
  const b = h.makeRecord(2);
  h.addTab(a, 101);
  const bGuest = h.addTab(b, 201);

  h.ipcMain.send('bookmark-drag-started', a.chromeView.webContents);
  h.ipcMain.send('guest-bookmark-drop', bGuest.webContents);
  assert.deepEqual(chromeSends(h, b, 'bookmark-drop'), [], 'B never declared a drag');
  assert.deepEqual(chromeSends(h, a, 'bookmark-drop'), [], 'and the signal is never re-routed to A');
  assert.equal(a.bookmarkDragActive, true, "A's own declaration survives — its drag has not ended");
});

test('a signal from a wcId that is not a tab in any window is refused', () => {
  const h = setup();
  const record = h.makeRecord(1);
  h.addTab(record, 101);
  h.ipcMain.send('bookmark-drag-started', record.chromeView.webContents);
  // The sheet / find overlay / anything else: getWindowForGuest resolves null.
  h.ipcMain.send('guest-bookmark-drop', { id: 9999 });
  assert.deepEqual(chromeSends(h, record, 'bookmark-drop'), []);
  assert.equal(record.bookmarkDragActive, true, 'a refused signal consumes nothing');
});

test("AC8: the drop navigation dies at the REAL gate — tab-navigate's trust-branched URL check", () => {
  // ⚠ The enforcement point is `tab-navigate`, NOT `will-navigate`: Electron does
  // not emit will-navigate for a programmatic loadURL, so guest-wiring's guardNav
  // never runs on this path. This test drives the exact channel the drop
  // navigation rides, with the hostile url injected at the FORWARD layer — a
  // test that tried to STORE such a bookmark would be vacuous, since
  // bookmarks-store's validUrl (isSafeTabUrl && !== about:blank) refuses it.
  const h = setup();
  const record = h.makeRecord(1);
  const guest = h.addTab(record, 101);
  h.ipcMain.send('bookmark-drag-started', record.chromeView.webContents);
  h.ipcMain.send('guest-bookmark-drop', guest.webContents);
  const target = chromeSends(h, record, 'bookmark-drop')[0][3].targetWcId;

  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'goldfinch://settings/#privacy']) {
    h.ipcMain.send('tab-navigate', record.chromeView.webContents, { wcId: target, verb: 'loadURL', args: [url] });
  }
  assert.deepEqual(
    h.log.filter((x) => x[0] === 'load' && x[1] === 101),
    [],
    'a web guest gets isSafeTabUrl — goldfinch:// included, so the drop path can never reach an internal page'
  );

  h.ipcMain.send('tab-navigate', record.chromeView.webContents, {
    wcId: target,
    verb: 'loadURL',
    args: ['https://example.test/']
  });
  assert.equal(h.log.filter((x) => x[0] === 'load' && x[1] === 101).length, 1, 'the legitimate bookmark url loads');
  void guest;
});

// ---------------------------------------------------------------------------
// Mission 20 Flight 1 (DD1/DD2/AC2/AC5/AC7/AC9): entry fields, the two-axis
// visibility/focus invariant, and the adopt-time failure re-push.
// ---------------------------------------------------------------------------

test('AC2: tab-create seeds loadFailure: null and lastRequestedUrl from the loadURL argument', async () => {
  const h = setup();
  const source = h.makeRecord(1);
  const wcId = await h.ipcMain.invoke('tab-create', source.chromeView.webContents, {
    url: 'https://example.test/page',
    partition: 'persist:jar-a',
    trusted: false
  });
  const entry = source.tabViews.get(wcId);
  assert.equal(entry.loadFailure, null);
  assert.equal(entry.lastRequestedUrl, 'https://example.test/page');
});

test('Mission 20 F2 L2: tab-create seeds certFailure/certOverride/certificate/security all null', async () => {
  const h = setup();
  const source = h.makeRecord(1);
  const wcId = await h.ipcMain.invoke('tab-create', source.chromeView.webContents, {
    url: 'https://example.test/page',
    partition: 'persist:jar-a',
    trusted: false
  });
  const entry = source.tabViews.get(wcId);
  assert.equal(entry.certFailure, null);
  assert.equal(entry.certOverride, null);
  assert.equal(entry.certificate, null);
  assert.equal(entry.security, null);
});

test('AC2: tab-create restore branch seeds lastRequestedUrl from the active history entry', async () => {
  const h = setup();
  const source = h.makeRecord(1);
  const wcId = await h.ipcMain.invoke('tab-create', source.chromeView.webContents, {
    url: 'https://ignored.test/',
    partition: 'persist:jar-a',
    trusted: false,
    restoreHistory: {
      entries: [{ url: 'https://first.test/' }, { url: 'https://second.test/' }],
      index: 1
    }
  });
  const entry = source.tabViews.get(wcId);
  assert.equal(entry.loadFailure, null);
  assert.equal(entry.lastRequestedUrl, 'https://second.test/');
});

test('AC7: tab-set-active hides (never shows) an incoming tab carrying a load failure, and never focuses it', () => {
  const h = setup();
  const record = h.makeRecord(1);
  h.addTab(record, 101);
  const incoming = h.addTab(record, 102);
  incoming.webContents.destroyed = false;
  record.tabViews.get(102).loadFailure = { code: -105, name: 'ERR_NAME_NOT_RESOLVED', url: 'http://x.invalid/' };
  record.activeTabWcId = 101;
  h.log.length = 0;
  h.ipcMain.send('tab-set-active', record.chromeView.webContents, {
    wcId: 102,
    bounds: { x: 0, y: 0, width: 900, height: 700 }
  });
  assert.deepEqual(
    h.log.filter((x) => x[0] === 'visible' && x[1] === 102),
    [['visible', 102, false]],
    'applyGuestVisibility hides a failed incoming tab'
  );
  assert.deepEqual(
    h.log.filter((x) => x[0] === 'focus-wc' && x[1] === 102),
    [],
    'a failed incoming tab never receives OS focus, even when the outgoing tab was page-focused'
  );
  assert.equal(record.tabViews.get(102).active, true, 'entry.active is still set — the tab IS active, just hidden');
});

test('AC7: tab-set-active shows a clean incoming tab as before (no regression)', () => {
  const h = setup();
  const record = h.makeRecord(1);
  h.addTab(record, 101);
  h.addTab(record, 102);
  record.activeTabWcId = 101;
  h.log.length = 0;
  h.ipcMain.send('tab-set-active', record.chromeView.webContents, {
    wcId: 102,
    bounds: { x: 0, y: 0, width: 900, height: 700 }
  });
  assert.deepEqual(
    h.log.filter((x) => x[0] === 'visible' && x[1] === 102),
    [['visible', 102, true]]
  );
});

test('AC7: tab-focus-guest refuses a failed active tab without calling focus()', async () => {
  const h = setup();
  const record = h.makeRecord(1);
  h.addTab(record, 101);
  record.tabViews.get(101).loadFailure = { code: -102, name: 'ERR_CONNECTION_REFUSED', url: 'http://127.0.0.1:1/' };
  record.activeTabWcId = 101;
  h.log.length = 0;
  const ok = await h.ipcMain.invoke('tab-focus-guest', record.chromeView.webContents);
  assert.equal(ok, false);
  assert.deepEqual(
    h.log.filter((e) => e[0] === 'focus-wc'),
    []
  );
});

test('AC5: tab-navigate loadURL stamps lastRequestedUrl on the entry before issuing the load', () => {
  const h = setup();
  const record = h.makeRecord(1);
  h.addTab(record, 101);
  h.ipcMain.send('tab-navigate', record.chromeView.webContents, {
    wcId: 101,
    verb: 'loadURL',
    args: ['https://retried.test/']
  });
  assert.equal(record.tabViews.get(101).lastRequestedUrl, 'https://retried.test/');
});

test('AC9: a move re-pushes tab-load-failure to the target AFTER adopt-tab when the moved entry carries a failure', () => {
  const h = setup();
  const source = h.makeRecord(1);
  const target = h.makeRecord(2);
  h.addTab(source, 101);
  const failure = { code: -105, name: 'ERR_NAME_NOT_RESOLVED', url: 'http://x.invalid/' };
  source.tabViews.get(101).loadFailure = failure;

  const result = h.ipcMain.invoke('tab-move-to-window', source.chromeView.webContents, { wcId: 101, windowId: 2 });
  assert.deepEqual(result, { ok: true, windowId: 2 });

  const targetChromeId = target.chromeView.webContents.id;
  const sends = h.log.filter((x) => x[0] === 'send' && x[1] === targetChromeId);
  const adoptIdx = sends.findIndex((x) => x[2] === 'adopt-tab');
  const failureIdx = sends.findIndex((x) => x[2] === 'tab-load-failure');
  assert.ok(adoptIdx !== -1, 'adopt-tab was sent');
  assert.ok(failureIdx !== -1, 'tab-load-failure was re-pushed');
  assert.ok(failureIdx > adoptIdx, 'the re-push lands strictly AFTER the adopt payload');
  assert.deepEqual(sends[failureIdx][3], { wcId: 101, failure });
  // The moved guest stays hidden across the re-parent (AC7).
  assert.deepEqual(
    h.log.filter((x) => x[0] === 'visible' && x[1] === 101),
    [['visible', 101, false]]
  );
});

test('AC9: a move of a clean (non-failed) entry sends no tab-load-failure re-push', () => {
  const h = setup();
  const source = h.makeRecord(1);
  const target = h.makeRecord(2);
  h.addTab(source, 101);
  h.ipcMain.invoke('tab-move-to-window', source.chromeView.webContents, { wcId: 101, windowId: 2 });
  const targetChromeId = target.chromeView.webContents.id;
  const sends = h.log.filter((x) => x[0] === 'send' && x[1] === targetChromeId && x[2] === 'tab-load-failure');
  assert.deepEqual(sends, []);
  assert.deepEqual(
    h.log.filter((x) => x[0] === 'visible' && x[1] === 101),
    [['visible', 101, true]]
  );
});

// ---------------------------------------------------------------------------
// Mission 20 Flight 2 Leg 2 (DD7 FD amendment/AC6): the tab-security re-push
// at adopt — its own channel, never a replay of tab-did-navigate.
// ---------------------------------------------------------------------------

test('DD7: a move re-pushes tab-security to the target AFTER adopt-tab (never replaying tab-did-navigate)', () => {
  const h = setup();
  const source = h.makeRecord(1);
  const target = h.makeRecord(2);
  h.addTab(source, 101);
  source.tabViews.get(101).security = 'overridden';

  const result = h.ipcMain.invoke('tab-move-to-window', source.chromeView.webContents, { wcId: 101, windowId: 2 });
  assert.deepEqual(result, { ok: true, windowId: 2 });

  const targetChromeId = target.chromeView.webContents.id;
  const sends = h.log.filter((x) => x[0] === 'send' && x[1] === targetChromeId);
  const adoptIdx = sends.findIndex((x) => x[2] === 'adopt-tab');
  const securityIdx = sends.findIndex((x) => x[2] === 'tab-security');
  const didNavigateIdx = sends.findIndex((x) => x[2] === 'tab-did-navigate');
  assert.ok(adoptIdx !== -1, 'adopt-tab was sent');
  assert.ok(securityIdx !== -1, 'tab-security was re-pushed');
  assert.ok(securityIdx > adoptIdx, 'the re-push lands strictly AFTER the adopt payload');
  assert.deepEqual(sends[securityIdx][3], { wcId: 101, security: 'overridden' });
  assert.equal(didNavigateIdx, -1, 'tab-did-navigate is never replayed by the adopt path');
});

test('DD7: a move of an entry with no security value yet sends no tab-security re-push', () => {
  const h = setup();
  const source = h.makeRecord(1);
  const target = h.makeRecord(2);
  h.addTab(source, 101);
  h.ipcMain.invoke('tab-move-to-window', source.chromeView.webContents, { wcId: 101, windowId: 2 });
  const targetChromeId = target.chromeView.webContents.id;
  const sends = h.log.filter((x) => x[0] === 'send' && x[1] === targetChromeId && x[2] === 'tab-security');
  assert.deepEqual(sends, []);
});

// ---------------------------------------------------------------------------
// Mission 20 Flight 2 Leg 4 (DD9): tab-certificate-get — requireChrome +
// ownsTab (the tab-navigate shape), reads entry.certificate's OBSERVER
// WRAPPER (never a bare summary), and never returns a `data`/PEM field.
// ---------------------------------------------------------------------------

test('tab-certificate-get: refuses a non-chrome sender', () => {
  const h = setup();
  const source = h.makeRecord(1);
  h.addTab(source, 101);
  assert.equal(h.ipcMain.invoke('tab-certificate-get', {}, { wcId: 101 }), null);
});

test('tab-certificate-get: refuses a chrome sender that does not own the tab', () => {
  const h = setup();
  const source = h.makeRecord(1);
  const other = h.makeRecord(2);
  h.addTab(source, 101);
  assert.equal(h.ipcMain.invoke('tab-certificate-get', other.chromeView.webContents, { wcId: 101 }), null);
});

test('tab-certificate-get: unknown wcId (no entry) returns null', () => {
  const h = setup();
  const source = h.makeRecord(1);
  h.addTab(source, 101);
  assert.equal(h.ipcMain.invoke('tab-certificate-get', source.chromeView.webContents, { wcId: 999 }), null);
});

test('tab-certificate-get: a wrapper with a null summary counts as absent', () => {
  const h = setup();
  const source = h.makeRecord(1);
  h.addTab(source, 101);
  source.tabViews.get(101).certificate = { verificationResult: 'net::OK', errorCode: 0, summary: null };
  assert.equal(h.ipcMain.invoke('tab-certificate-get', source.chromeView.webContents, { wcId: 101 }), null);
});

test('tab-certificate-get: no observer wrapper and no cert-blocked failure returns null', () => {
  const h = setup();
  const source = h.makeRecord(1);
  h.addTab(source, 101);
  assert.equal(h.ipcMain.invoke('tab-certificate-get', source.chromeView.webContents, { wcId: 101 }), null);
});

test('tab-certificate-get: a trusted (secure) tab returns the observer summary with status=trusted, error undefined', () => {
  const h = setup();
  const source = h.makeRecord(1);
  h.addTab(source, 101);
  const entry = source.tabViews.get(101);
  entry.security = 'secure';
  entry.certificate = {
    verificationResult: 'net::OK',
    errorCode: 0,
    isIssuedByKnownRoot: true,
    summary: { subject: { commonName: 'a.example' }, fingerprints: { sha256: 'AA', sha1: 'BB' }, status: 'trusted' }
  };
  const result = h.ipcMain.invoke('tab-certificate-get', source.chromeView.webContents, { wcId: 101 });
  assert.equal(result.status, 'trusted');
  assert.equal(result.error, undefined);
  assert.equal(result.subject.commonName, 'a.example');
  assert.equal(result.fingerprints.sha256, 'AA');
});

test('tab-certificate-get: an overridden tab returns status=overridden from certOverride.summary, with the certOverride error', () => {
  const h = setup();
  const source = h.makeRecord(1);
  h.addTab(source, 101);
  const entry = source.tabViews.get(101);
  entry.security = 'overridden';
  entry.certOverride = {
    host: 'bad.test',
    port: 443,
    fingerprint: 'AA:BB',
    error: 'ERR_CERT_AUTHORITY_INVALID',
    summary: { subject: { commonName: 'bad.test' }, status: 'overridden', error: 'ERR_CERT_AUTHORITY_INVALID' }
  };
  const result = h.ipcMain.invoke('tab-certificate-get', source.chromeView.webContents, { wcId: 101 });
  assert.equal(result.status, 'overridden');
  assert.equal(result.error, 'ERR_CERT_AUTHORITY_INVALID');
  assert.equal(result.subject.commonName, 'bad.test');
});

// HAT F5: the collision this fix closes — a hostname-keyed OBSERVER entry
// from a prior TRUSTED visit to a DIFFERENT port on the same host must never
// leak into an overridden tab's viewer. Observer says OK for a certificate
// whose subject is 'trusted-other-port.test' (subject A); this tab's OWN
// override is for a different certificate (subject B). The read must return
// subject B (certOverride.summary), never subject A (entry.certificate).
test('tab-certificate-get: an overridden tab never falls back to a hostname-keyed observer entry from a different port (HAT F5 collision)', () => {
  const h = setup();
  const source = h.makeRecord(1);
  h.addTab(source, 101);
  const entry = source.tabViews.get(101);
  entry.security = 'overridden';
  // The observer's stale, hostname-only-keyed OK entry — subject A, a
  // DIFFERENT certificate than the one this tab's own load overrode.
  entry.certificate = {
    verificationResult: 'net::OK',
    errorCode: 0,
    isIssuedByKnownRoot: true,
    summary: { subject: { commonName: 'trusted-other-port.test' }, status: 'trusted' }
  };
  // This load's own override — subject B.
  entry.certOverride = {
    host: '127.0.0.1',
    port: 42525,
    fingerprint: 'CC:DD',
    error: 'ERR_CERT_AUTHORITY_INVALID',
    summary: { subject: { commonName: 'this-load.test' }, status: 'overridden', error: 'ERR_CERT_AUTHORITY_INVALID' }
  };
  const result = h.ipcMain.invoke('tab-certificate-get', source.chromeView.webContents, { wcId: 101 });
  assert.equal(result.status, 'overridden');
  assert.equal(result.subject.commonName, 'this-load.test');
});

test('tab-certificate-get: an overridden tab with no certOverride.summary (e.g. a pre-fix stamp) returns null, never entry.certificate', () => {
  const h = setup();
  const source = h.makeRecord(1);
  h.addTab(source, 101);
  const entry = source.tabViews.get(101);
  entry.security = 'overridden';
  entry.certOverride = { host: 'bad.test', port: 443, fingerprint: 'AA:BB', error: 'ERR_CERT_AUTHORITY_INVALID' };
  entry.certificate = {
    verificationResult: 'net::OK',
    errorCode: 0,
    isIssuedByKnownRoot: true,
    summary: { subject: { commonName: 'wrong.test' }, status: 'trusted' }
  };
  const result = h.ipcMain.invoke('tab-certificate-get', source.chromeView.webContents, { wcId: 101 });
  assert.equal(result, null);
});

test('tab-certificate-get: a cert-blocked interstitial returns entry.loadFailure.cert.summary as-is (status untrusted)', () => {
  const h = setup();
  const source = h.makeRecord(1);
  h.addTab(source, 101);
  const entry = source.tabViews.get(101);
  const summary = { subject: { commonName: 'bad.test' }, status: 'untrusted', error: 'ERR_CERT_AUTHORITY_INVALID' };
  entry.loadFailure = { code: -202, name: 'ERR_CERT_AUTHORITY_INVALID', url: 'https://bad.test/', cert: { summary } };
  // Even a stray observer wrapper on the same entry must be ignored — the
  // cert-blocked branch wins.
  entry.certificate = { summary: { status: 'trusted' } };
  const result = h.ipcMain.invoke('tab-certificate-get', source.chromeView.webContents, { wcId: 101 });
  assert.equal(result, summary);
});

test('tab-certificate-get: the reply never carries a data/PEM field', () => {
  const h = setup();
  const source = h.makeRecord(1);
  h.addTab(source, 101);
  const entry = source.tabViews.get(101);
  entry.security = 'secure';
  entry.certificate = { summary: { subject: {}, status: 'trusted' } };
  const result = h.ipcMain.invoke('tab-certificate-get', source.chromeView.webContents, { wcId: 101 });
  assert.equal('data' in result, false);
  assert.equal(JSON.stringify(result).includes('-----BEGIN'), false);
});

// ---------------------------------------------------------------------------
// Mission 20 Flight 3 Leg 2 (DD1/DD3/DD9): the crash/hang entry fields, the
// guestTakenOver-widened visibility/focus invariant, the adopt re-pushes, and
// the kill-reload verb + the empty-history reload fallback.
// ---------------------------------------------------------------------------

test('tab-create seeds crash: null, hung: false, killRequested: false', async () => {
  const h = setup();
  const source = h.makeRecord(1);
  const wcId = await h.ipcMain.invoke('tab-create', source.chromeView.webContents, {
    url: 'https://example.test/page',
    partition: 'persist:jar-a',
    trusted: false
  });
  const entry = source.tabViews.get(wcId);
  assert.equal(entry.crash, null);
  assert.equal(entry.hung, false);
  assert.equal(entry.killRequested, false);
});

test('AC4/DD1: tab-set-active hides (never shows) an incoming tab carrying a crash, and never focuses it', () => {
  const h = setup();
  const record = h.makeRecord(1);
  h.addTab(record, 101);
  const incoming = h.addTab(record, 102);
  incoming.webContents.destroyed = false;
  record.tabViews.get(102).crash = { reason: 'crashed', exitCode: 139, url: 'https://x.test/' };
  record.activeTabWcId = 101;
  h.log.length = 0;
  h.ipcMain.send('tab-set-active', record.chromeView.webContents, {
    wcId: 102,
    bounds: { x: 0, y: 0, width: 900, height: 700 }
  });
  assert.deepEqual(
    h.log.filter((x) => x[0] === 'visible' && x[1] === 102),
    [['visible', 102, false]],
    'applyGuestVisibility (via guestTakenOver) hides a crashed incoming tab'
  );
  assert.deepEqual(
    h.log.filter((x) => x[0] === 'focus-wc' && x[1] === 102),
    [],
    'a crashed incoming tab never receives OS focus'
  );
});

test('AC4/DD1: tab-set-active skips the page-focus re-arm for a crashed incoming tab', () => {
  const h = setup();
  const record = h.makeRecord(1);
  const outgoing = h.addTab(record, 101);
  h.addTab(record, 102);
  record.tabViews.get(102).crash = { reason: 'crashed', exitCode: 139, url: 'https://x.test/' };
  record.activeTabWcId = 101;
  outgoing.webContents.focused = true;
  h.log.length = 0;
  h.ipcMain.send('tab-set-active', record.chromeView.webContents, {
    wcId: 102,
    bounds: { x: 0, y: 0, width: 900, height: 700 }
  });
  assert.deepEqual(
    h.log.filter((x) => x[0] === 'focus-wc' && x[1] === 102),
    [],
    'the re-arm is skipped even though the outgoing tab was page-focused'
  );
});

test('AC4/DD1: tab-focus-guest refuses a crashed active tab without calling focus()', async () => {
  const h = setup();
  const record = h.makeRecord(1);
  h.addTab(record, 101);
  record.tabViews.get(101).crash = { reason: 'crashed', exitCode: 139, url: 'https://x.test/' };
  record.activeTabWcId = 101;
  h.log.length = 0;
  const ok = await h.ipcMain.invoke('tab-focus-guest', record.chromeView.webContents);
  assert.equal(ok, false);
  assert.deepEqual(
    h.log.filter((e) => e[0] === 'focus-wc'),
    []
  );
});

test('AC9/DD9: a move re-pushes tab-crash to the target AFTER adopt-tab when the moved entry carries a crash', () => {
  const h = setup();
  const source = h.makeRecord(1);
  const target = h.makeRecord(2);
  h.addTab(source, 101);
  const crash = { reason: 'crashed', exitCode: 139, url: 'https://x.test/' };
  source.tabViews.get(101).crash = crash;

  const result = h.ipcMain.invoke('tab-move-to-window', source.chromeView.webContents, { wcId: 101, windowId: 2 });
  assert.deepEqual(result, { ok: true, windowId: 2 });

  const targetChromeId = target.chromeView.webContents.id;
  const sends = h.log.filter((x) => x[0] === 'send' && x[1] === targetChromeId);
  const adoptIdx = sends.findIndex((x) => x[2] === 'adopt-tab');
  const crashIdx = sends.findIndex((x) => x[2] === 'tab-crash');
  assert.ok(adoptIdx !== -1, 'adopt-tab was sent');
  assert.ok(crashIdx !== -1, 'tab-crash was re-pushed');
  assert.ok(crashIdx > adoptIdx, 'the re-push lands strictly AFTER the adopt payload');
  assert.deepEqual(sends[crashIdx][3], { wcId: 101, crash });
});

test('AC9/DD9: a move re-pushes tab-hung to the target AFTER adopt-tab when the moved entry is hung', () => {
  const h = setup();
  const source = h.makeRecord(1);
  const target = h.makeRecord(2);
  h.addTab(source, 101);
  source.tabViews.get(101).hung = true;

  h.ipcMain.invoke('tab-move-to-window', source.chromeView.webContents, { wcId: 101, windowId: 2 });

  const targetChromeId = target.chromeView.webContents.id;
  const sends = h.log.filter((x) => x[0] === 'send' && x[1] === targetChromeId);
  const adoptIdx = sends.findIndex((x) => x[2] === 'adopt-tab');
  const hungIdx = sends.findIndex((x) => x[2] === 'tab-hung');
  assert.ok(adoptIdx !== -1, 'adopt-tab was sent');
  assert.ok(hungIdx !== -1, 'tab-hung was re-pushed');
  assert.ok(hungIdx > adoptIdx, 'the re-push lands strictly AFTER the adopt payload');
  assert.deepEqual(sends[hungIdx][3], { wcId: 101, hung: true });
});

test('AC9/DD9: a move of a clean (no crash/hung) entry sends neither tab-crash nor tab-hung', () => {
  const h = setup();
  const source = h.makeRecord(1);
  const target = h.makeRecord(2);
  h.addTab(source, 101);
  h.ipcMain.invoke('tab-move-to-window', source.chromeView.webContents, { wcId: 101, windowId: 2 });
  const targetChromeId = target.chromeView.webContents.id;
  const sends = h.log.filter(
    (x) => x[0] === 'send' && x[1] === targetChromeId && (x[2] === 'tab-crash' || x[2] === 'tab-hung')
  );
  assert.deepEqual(sends, []);
});

test('AC2: tab-navigate kill-reload sets killRequested then calls forcefullyCrashRenderer', () => {
  const h = setup();
  const record = h.makeRecord(1);
  h.addTab(record, 101);
  h.ipcMain.send('tab-navigate', record.chromeView.webContents, { wcId: 101, verb: 'kill-reload' });
  assert.equal(record.tabViews.get(101).killRequested, true);
  assert.deepEqual(
    h.log.filter((x) => x[0] === 'force-crash'),
    [['force-crash', 101]]
  );
});

test('AC2 edge case: kill-reload is refused for a TRUSTED (internal) entry', () => {
  const h = setup();
  const record = h.makeRecord(1);
  h.addTab(record, 101, true);
  h.ipcMain.send('tab-navigate', record.chromeView.webContents, { wcId: 101, verb: 'kill-reload' });
  assert.notEqual(record.tabViews.get(101).killRequested, true);
  assert.deepEqual(
    h.log.filter((x) => x[0] === 'force-crash'),
    []
  );
});

test('AC2 edge case: kill-reload is refused for a destroyed guest', () => {
  const h = setup();
  const record = h.makeRecord(1);
  const tab = h.addTab(record, 101);
  tab.webContents.destroyed = true;
  h.ipcMain.send('tab-navigate', record.chromeView.webContents, { wcId: 101, verb: 'kill-reload' });
  assert.notEqual(record.tabViews.get(101).killRequested, true);
});

test('Edge case: reload falls back to loadURL(effectiveUrl(entry)) when the history is empty', () => {
  const h = setup();
  const record = h.makeRecord(1);
  const tab = h.addTab(record, 101);
  tab.webContents._historyLength = 0;
  tab.webContents.url = 'https://crashed-before-commit.test/';
  record.tabViews.get(101).lastRequestedUrl = 'https://crashed-before-commit.test/';
  h.log.length = 0;
  h.ipcMain.send('tab-navigate', record.chromeView.webContents, { wcId: 101, verb: 'reload' });
  assert.deepEqual(
    h.log.filter((x) => x[0] === 'load' || x[0] === 'reload'),
    [['load', 101, 'https://crashed-before-commit.test/']],
    'wc.reload() is a no-op on empty history — loadURL(effectiveUrl(entry)) is the fallback'
  );
});

test('reload calls wc.reload() as before when history is non-empty (no regression)', () => {
  const h = setup();
  const record = h.makeRecord(1);
  const tab = h.addTab(record, 101);
  assert.equal(tab.webContents._historyLength, 1);
  h.log.length = 0;
  h.ipcMain.send('tab-navigate', record.chromeView.webContents, { wcId: 101, verb: 'reload' });
  assert.deepEqual(
    h.log.filter((x) => x[0] === 'load' || x[0] === 'reload'),
    [['reload', 101]]
  );
});

// ---------------------------------------------------------------------------
// AC4 — grep-AC: every bare `entry.loadFailure` read across src/main/ is one
// of the known, exempt state-management sites (never a focus/visibility
// site, which now reads guestTakenOver(entry) exclusively).
// ---------------------------------------------------------------------------

test('AC4 grep-AC: entry.loadFailure occurrences in src/main/ are confined to the exempt files, at the expected count', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const repoRoot = path.join(__dirname, '..', '..');
  const mainDir = path.join(repoRoot, 'src', 'main');

  /** Recursively list every .js file under `dir`. */
  function listJsFiles(dir) {
    const out = [];
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, name.name);
      if (name.isDirectory()) out.push(...listJsFiles(full));
      else if (name.isFile() && name.name.endsWith('.js')) out.push(full);
    }
    return out;
  }

  // The exempt sites (flight.md DD1 / the leg's AC4): the entry literal, the
  // cert-summary reads, and the adopt re-push in register-tab-ipc.js; the
  // did-start-navigation/did-fail-load stamps in guest-wiring.js; the
  // cert-override-proceed cert read in register-overlay-ipc.js; and a
  // documentation comment in tab-entry-url.js. Counts are occurrence counts
  // (grep -o), not line counts — a real regression (a new bare read at a
  // focus/visibility site) changes one of these numbers.
  const EXPECTED = {
    'register-tab-ipc.js': 4,
    'guest-wiring.js': 6,
    'register-overlay-ipc.js': 2,
    'tab-entry-url.js': 1
  };

  const actual = {};
  for (const file of listJsFiles(mainDir)) {
    const src = fs.readFileSync(file, 'utf8');
    const count = (src.match(/entry\.loadFailure/g) || []).length;
    if (count > 0) actual[path.basename(file)] = count;
  }

  assert.deepEqual(
    actual,
    EXPECTED,
    'entry.loadFailure occurrences drifted outside the exempt state-management sites — a new hit is real; ' +
      'every focus/visibility site must read guestTakenOver(entry) instead'
  );
});

test('AC4: guestTakenOver is the predicate at the four main-side focus/visibility sites (source-scan)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const repoRoot = path.join(__dirname, '..', '..');

  const registerTabIpcSrc = fs.readFileSync(path.join(repoRoot, 'src/main/register-tab-ipc.js'), 'utf8');
  const windowFactorySrc = fs.readFileSync(path.join(repoRoot, 'src/main/window-factory.js'), 'utf8');

  // applyGuestVisibility, tab-focus-guest, and the tab-set-active re-arm all
  // live in register-tab-ipc.js; isFindableTab lives in window-factory.js.
  const occurrences = (registerTabIpcSrc.match(/guestTakenOver\(entry\)/g) || []).length;
  assert.equal(
    occurrences,
    3,
    'expected exactly 3 guestTakenOver(entry) call sites in register-tab-ipc.js: applyGuestVisibility, ' +
      'tab-focus-guest, the tab-set-active re-arm'
  );
  assert.ok(
    /guestTakenOver\(entry\)/.test(windowFactorySrc),
    'window-factory.js isFindableTab must read guestTakenOver(entry)'
  );
});

// ---------------------------------------------------------------------------
// Mission 20 Flight 3 Leg 3 (DD5): queueChromeSend / createSendOrQueue /
// pushTabStateFor — the module-level exports shared by guest-wiring.js's
// sendToChrome, the move/adopt block above, and chrome-recovery.js's
// buildRecoveryAdopts.
// ---------------------------------------------------------------------------

function makeSimpleRecord({ booted = true } = {}) {
  const sent = [];
  return {
    bootConfigServed: booted,
    pendingChromeSends: [],
    chromeView: { webContents: { isDestroyed: () => false, send: (ch, p) => sent.push([ch, p]) } },
    sent
  };
}

test('queueChromeSend: booted record sends immediately via the chrome webContents', () => {
  const record = makeSimpleRecord({ booted: true });
  queueChromeSend(record, () => ['tab-title', { wcId: 1, title: 'A' }]);
  assert.deepEqual(record.sent, [['tab-title', { wcId: 1, title: 'A' }]]);
  assert.deepEqual(record.pendingChromeSends, []);
});

test('queueChromeSend: unbooted record queues the thunk instead of sending', () => {
  const record = makeSimpleRecord({ booted: false });
  const build = () => ['tab-title', { wcId: 1, title: 'A' }];
  queueChromeSend(record, build);
  assert.deepEqual(record.sent, []);
  assert.equal(record.pendingChromeSends.length, 1);
  assert.equal(record.pendingChromeSends[0], build);
});

test('queueChromeSend: a destroyed chrome webContents drops the send silently (booted branch)', () => {
  const record = makeSimpleRecord({ booted: true });
  record.chromeView.webContents.isDestroyed = () => true;
  assert.doesNotThrow(() => queueChromeSend(record, () => ['tab-title', { wcId: 1, title: 'A' }]));
  assert.deepEqual(record.sent, []);
});

test('queueChromeSend: a chromeRecoveryPaused record drops the message rather than sending or queueing (acceptance-run fix pass F1)', () => {
  const bootedPaused = makeSimpleRecord({ booted: true });
  bootedPaused.chromeRecoveryPaused = true;
  queueChromeSend(bootedPaused, () => ['tab-title', { wcId: 1, title: 'A' }]);
  assert.deepEqual(bootedPaused.sent, []);
  assert.deepEqual(bootedPaused.pendingChromeSends, []);

  const unbootedPaused = makeSimpleRecord({ booted: false });
  unbootedPaused.chromeRecoveryPaused = true;
  queueChromeSend(unbootedPaused, () => ['tab-title', { wcId: 1, title: 'A' }]);
  assert.deepEqual(unbootedPaused.sent, []);
  assert.deepEqual(unbootedPaused.pendingChromeSends, []);
});

test('createSendOrQueue: resolves the owning record by wcId and routes through queueChromeSend', () => {
  const record = makeSimpleRecord({ booted: true });
  const registry = { getWindowForGuest: (wcId) => (wcId === 42 ? record : null) };
  const sendOrQueue = createSendOrQueue(registry);
  sendOrQueue(42, 'tab-crash', { wcId: 42, crash: { reason: 'crashed' } });
  assert.deepEqual(record.sent, [['tab-crash', { wcId: 42, crash: { reason: 'crashed' } }]]);
});

test('createSendOrQueue: unbooted → queued; replayed once the record boots (flushed in insertion order)', () => {
  const record = makeSimpleRecord({ booted: false });
  const registry = { getWindowForGuest: () => record };
  const sendOrQueue = createSendOrQueue(registry);
  sendOrQueue(1, 'tab-title', { wcId: 1, title: 'first' });
  sendOrQueue(1, 'tab-loading', { wcId: 1, loading: true });
  assert.deepEqual(record.sent, []);
  // Simulate window-boot-config's flush.
  record.bootConfigServed = true;
  for (const build of record.pendingChromeSends.splice(0)) {
    const [ch, p] = build();
    record.chromeView.webContents.send(ch, p);
  }
  assert.deepEqual(record.sent, [
    ['tab-title', { wcId: 1, title: 'first' }],
    ['tab-loading', { wcId: 1, loading: true }]
  ]);
});

test('createSendOrQueue: an unresolvable wcId (no owning record) is a silent no-op', () => {
  const registry = { getWindowForGuest: () => null };
  const sendOrQueue = createSendOrQueue(registry);
  assert.doesNotThrow(() => sendOrQueue(999, 'tab-title', { wcId: 999, title: 'ghost' }));
});

test('pushTabStateFor: sends only the SET fields, then nav-state unconditionally', () => {
  const wc = { isDestroyed: () => false, navigationHistory: { canGoBack: () => true, canGoForward: () => false } };
  const entry = { loadFailure: null, security: 'secure', crash: null, hung: false };
  const out = [];
  const send = (ch, build) => out.push([ch, build()]);
  pushTabStateFor({}, 5, entry, wc, send);
  assert.deepEqual(out, [
    ['tab-security', { wcId: 5, security: 'secure' }],
    ['tab-nav-state', { wcId: 5, canGoBack: true, canGoForward: false }]
  ]);
});

test('pushTabStateFor: all four optional fields set → all four re-pushed, then nav-state', () => {
  const wc = { isDestroyed: () => false, navigationHistory: { canGoBack: () => false, canGoForward: () => true } };
  const entry = {
    loadFailure: { code: -1, name: 'refused' },
    security: 'insecure',
    crash: { reason: 'crashed', exitCode: 139, url: 'https://a.example/' },
    hung: true
  };
  const out = [];
  const send = (ch, build) => out.push([ch, build()]);
  pushTabStateFor({}, 5, entry, wc, send);
  assert.deepEqual(
    out.map((o) => o[0]),
    ['tab-load-failure', 'tab-security', 'tab-crash', 'tab-hung', 'tab-nav-state']
  );
});

test('pushTabStateFor: nothing set beyond nav-state → exactly one send', () => {
  const wc = { isDestroyed: () => true, navigationHistory: { canGoBack: () => false, canGoForward: () => false } };
  const entry = { loadFailure: null, security: null, crash: null, hung: false };
  const out = [];
  const send = (ch, build) => out.push([ch, build()]);
  pushTabStateFor({}, 5, entry, wc, send);
  assert.deepEqual(out, [['tab-nav-state', { wcId: 5, canGoBack: false, canGoForward: false }]]);
});
