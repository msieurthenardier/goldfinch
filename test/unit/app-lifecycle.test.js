'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { registerAppLifecycle } = require('../../src/main/app-lifecycle');

// Mission 13 Flight 3 / Leg 3 (DD3, AC2/AC3): a minimal webContents double for the
// web-contents-created catch-all tests — just enough EventEmitter + setWindowOpenHandler
// surface to drive will-navigate/will-frame-navigate/will-redirect and read the result.
class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.openHandler = null;
  }
  setWindowOpenHandler(fn) { this.openHandler = fn; }
}

function navEvent(url) {
  return { url, prevented: false, preventDefault() { this.prevented = true; } };
}

function makeHarness({ restore = null, platform = 'linux', dev = false, automationEnabled = false, hygieneMarker = null } = {}) {
  const events = [];
  const appListeners = new Map();
  const handlers = new Map();
  const ipcListeners = new Map();
  const settingsValues = { spellcheck: true, restoreSession: restore != null, automationEnabled };
  const records = [{ win: { id: 1 } }];
  let bootRecord = null;
  const created = [];
  const downloadsManager = { listAll: () => [], flushInterrupted: () => events.push('flush-downloads') };
  const server = { stop: () => events.push('stop-mcp') };
  const internalSession = {
    protocol: { handle: (scheme) => events.push(`protocol:${scheme}`) }
  };
  let defaultSessionReads = 0;
  // Media proxy wiring (Mission 13 Flight 1 / Leg 2 — DD2/AC2): capture what
  // createMediaProxyHandler was invoked with, and what got registered on the
  // default session's protocol.handle, so the tests can pin the threading.
  let capturedMediaProxyDeps = null;
  const mediaProxyHandlerFn = () => {};
  const defaultSessionProtocolCalls = [];
  const getTabContentsFake = () => null;
  const isInternalContentsFake = () => false;
  const parseMediaProxyUrlFake = () => null;
  // DD7 (Mission 13 Flight 1 / Leg 2): one-time default-session hygiene purge.
  // `hygieneMarker` seeds the fake appDb document row (null = fresh profile,
  // never purged); `hygieneDocStoreCreatedFor` and the clear-* events below
  // let tests pin the threading + gating without real Electron sessions.
  let hygieneDocStoreCreatedFor = null;
  const hygieneWrites = [];
  const app = {
    isPackaged: !dev,
    on: (name, fn) => appListeners.set(name, fn),
    whenReady: () => Promise.resolve(),
    quit: () => events.push('quit'),
  };
  const lifecycle = registerAppLifecycle({
    app,
    ipcMain: {
      handle: (channel, fn) => handlers.set(channel, fn),
      on: (channel, fn) => ipcListeners.set(channel, fn),
    },
    sessionRuntime: { onSessionCreated: () => events.push('session-created') },
    initProfileAndStores: () => events.push('init-stores'),
    profileStores: { jars: { getDefault: () => ({ id: 'personal' }) } },
    historyStore: {
      open: () => events.push('history-open'), close: () => events.push('history-close'),
      listRecent: () => [], search: () => [],
    },
    sessionStore: {
      load: () => events.push('session-load'), read: () => restore,
      write: () => events.push('session-write'),
    },
    getUserDataPath: () => '/profile',
    createHistoryRecorder: () => ({ recorder: true }),
    setHistoryRecorder: () => events.push('history-recorder'),
    listJars: () => [],
    broadcast: () => {},
    pruneAllJars: () => events.push('prune'),
    scheduleInterval: () => ({ unref: () => events.push('interval') }),
    createDownloadsManager: () => { events.push('downloads-manager'); return downloadsManager; },
    downloadsStore: {},
    setDownloadsManager: () => events.push('set-downloads-manager'),
    getDownloadsManager: () => downloadsManager,
    wireDownloadHandler: () => events.push('wire-downloads'),
    applyShields: () => events.push('apply-shields'),
    applySpellcheck: () => events.push('apply-spellcheck'),
    settings: { get: (key) => settingsValues[key] },
    getDefaultSession: () => {
      defaultSessionReads++;
      return {
        protocol: {
          handle: (scheme, handler) => {
            defaultSessionProtocolCalls.push({ scheme, handler });
            events.push(`default-protocol:${scheme}`);
          },
        },
        clearStorageData: (options) => {
          events.push(['clear-storage-data', options]);
          return Promise.resolve();
        },
        clearCache: () => {
          events.push('clear-cache');
          return Promise.resolve();
        },
      };
    },
    fromPartition: () => { events.push('internal-session'); return internalSession; },
    internalPartition: 'goldfinch-internal',
    setCreatingInternalSession: (value) => events.push(`creating:${value}`),
    handleInternal: () => {},
    getTabContents: getTabContentsFake,
    isInternalContents: isInternalContentsFake,
    createMediaProxyHandler: (deps) => {
      capturedMediaProxyDeps = deps;
      events.push('media-proxy-handler-built');
      return mediaProxyHandlerFn;
    },
    parseMediaProxyUrl: parseMediaProxyUrlFake,
    // Mission 13 Flight 3 / Leg 3 (DD3, AC2): the web-contents-created catch-all's
    // scheme predicates. Mirrors the real url-safety module closely enough for the
    // catch-all tests below (http/https/about:blank safe; goldfinch://settings the
    // one internal page exercised).
    isSafeTabUrl: (url) => typeof url === 'string' && (/^https?:\/\//.test(url) || url === 'about:blank'),
    isInternalPageUrl: (url) => typeof url === 'string' && url.startsWith('goldfinch://settings'),
    createWindow: (options) => {
      const rec = { options, win: { id: created.length + 10 } };
      created.push(rec);
      events.push(`create-window:${options && options.noBootTab === true}`);
      return rec;
    },
    registry: {
      records: () => records,
      getWindowForChrome: () => bootRecord,
      isTabViewWcId: () => false,
      isChromeContents: () => false,
    },
    isMcpAutomationEnabled: () => dev,
    shouldBindAutomation: (decision) => {
      events.push(['bind-decision', decision]);
      return decision.automationEnabled || decision.devForceBind;
    },
    shouldAutoMint: () => false,
    setDevEnableOverride: (value) => events.push(`dev:${value}`),
    startMcpServerInstance: () => events.push('start-mcp'),
    createEngine: () => ({ ping: () => 'pong' }),
    getChromeContents: () => null,
    grabWindow: () => {},
    listWindows: () => [],
    enumerateWindows: () => [],
    chromeForTab: () => null,
    raiseWindowForTab: () => {},
    isKnownJar: () => false,
    resolveAutoMintTarget: () => null,
    mintJarKey: () => '', mintAdminKey: () => '',
    getMcpServer: () => server,
    setSessionQuitting: (value) => events.push(`quitting:${value}`),
    buildSessionSnapshot: () => ({ windows: [] }),
    appDb: {
      close: () => events.push('appdb-close'),
      createDocumentStore: (name) => {
        hygieneDocStoreCreatedFor = name;
        events.push(`create-document-store:${name}`);
        return {
          read: () => hygieneMarker,
          write: (payload) => {
            hygieneMarker = payload;
            hygieneWrites.push(payload);
            events.push(`hygiene-write:${payload}`);
          },
        };
      },
    },
    getAllWindows: () => [],
    argv: [], env: {}, platform,
    stdout: { write: () => {} },
    logger: { error: (...args) => events.push(['error', ...args]), warn: () => {} },
  });
  return {
    events, appListeners, handlers, ipcListeners, lifecycle, created, internalSession,
    defaultSessionReads: () => defaultSessionReads,
    setBootRecord: (record) => { bootRecord = record; },
    defaultSessionProtocolCalls,
    getCapturedMediaProxyDeps: () => capturedMediaProxyDeps,
    mediaProxyHandlerFn,
    getTabContentsFake,
    isInternalContentsFake,
    parseMediaProxyUrlFake,
    getHygieneDocStoreCreatedFor: () => hygieneDocStoreCreatedFor,
    hygieneWrites,
    getHygieneMarker: () => hygieneMarker,
  };
}

// Flushes the microtask queue past a macrotask boundary — needed because the
// DD7 purge is deliberately fire-and-forget (never chained into `ready`'s
// promise) so first paint is never gated on it. `await lifecycle.ready` alone
// resolves before the purge's own .then() chain settles.
function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('ready path preserves store/session initialization order and default window creation', async () => {
  const h = makeHarness();
  assert.equal(h.defaultSessionReads(), 0, 'lifecycle registration must not touch Electron session');
  await h.lifecycle.ready;
  assert.equal(h.defaultSessionReads(), 1, 'default session resolves only inside the ready continuation');
  assert.deepEqual(h.events.slice(0, 16), [
    'init-stores', 'history-open', 'session-load', 'history-recorder', 'prune', 'interval',
    'downloads-manager', 'set-downloads-manager', 'wire-downloads', 'apply-shields',
    'apply-spellcheck', 'media-proxy-handler-built', 'default-protocol:goldfinch-media',
    'creating:true', 'internal-session', 'creating:false'
  ]);
  assert.equal(h.events.includes('protocol:goldfinch'), true);
  assert.equal(h.internalSession.__goldfinchInternal, true);
  assert.equal(h.events.includes('create-window:undefined'), true);
  assert.equal(h.appListeners.has('activate'), true);
  assert.equal(h.appListeners.has('session-created'), true);
});

test('web-contents-created catch-all is registered at TOP-LEVEL scope, before whenReady resolves (Mission 13 F3 Leg 3 / DD3)', () => {
  const h = makeHarness();
  // Registered synchronously by registerAppLifecycle itself — NOT deferred into
  // the whenReady().then(...) continuation, since createWindow() (which makes the
  // first chrome webContents) runs inside that continuation and a late listener
  // would miss it.
  assert.equal(h.appListeners.has('web-contents-created'), true);
});

test('web-contents-created catch-all denies window-open and blocks a non-guest navigation to a remote unsafe scheme (Mission 13 F3 Leg 3 / AC2)', () => {
  const h = makeHarness();
  const onWebContentsCreated = h.appListeners.get('web-contents-created');
  const contents = new FakeWebContents();
  onWebContentsCreated(null, contents);

  assert.equal(typeof contents.openHandler, 'function');
  assert.deepEqual(contents.openHandler(), { action: 'deny' }, 'setWindowOpenHandler must deny by default');

  for (const eventName of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
    const event = navEvent('javascript:alert(1)');
    contents.emit(eventName, event);
    assert.equal(event.prevented, true, `${eventName} to a remote unsafe scheme must be prevented`);
  }
});

test('web-contents-created catch-all allows devtools:/file:/chrome-extension:/about: navigations (Mission 13 F3 Leg 3 / AC2 — DevTools/PDF viewer must not break)', () => {
  const h = makeHarness();
  const onWebContentsCreated = h.appListeners.get('web-contents-created');
  const contents = new FakeWebContents();
  onWebContentsCreated(null, contents);

  for (const url of [
    'devtools://devtools/bundled/inspector.html',
    'file:///home/user/downloaded.pdf',
    'chrome-extension://abcdefg/panel.html',
    'about:blank'
  ]) {
    const event = navEvent(url);
    contents.emit('will-navigate', event);
    assert.equal(event.prevented, false, `${url} must not be blocked`);
  }
});

test('web-contents-created catch-all early-returns for a latched guest, even on an https navigation (Mission 13 F3 Leg 3 / AC3)', () => {
  const h = makeHarness();
  const onWebContentsCreated = h.appListeners.get('web-contents-created');
  const contents = new FakeWebContents();
  // Simulates wireGuestContents having already set the latch (it fires
  // synchronously, before the guest's own listeners could possibly run) —
  // the catch-all must defer entirely to the guest's own predicate.
  contents.__goldfinchNavGuarded = true;
  onWebContentsCreated(null, contents);

  const event = navEvent('https://example.test/');
  contents.emit('will-navigate', event);
  assert.equal(event.prevented, false, 'a latched guest must never be blocked by the catch-all');

  const unsafeButLatched = navEvent('javascript:alert(1)');
  contents.emit('will-navigate', unsafeButLatched);
  assert.equal(unsafeButLatched.prevented, false, 'the latch early-returns unconditionally — enforcement is the guest\'s own job');
});

test('media proxy handler is built with the threaded deps and registered on the DEFAULT session only (Mission 13 F1 Leg 2 / DD2/AC2)', async () => {
  const h = makeHarness();
  await h.lifecycle.ready;

  // Threading: getTabContents/isInternalContents/parseMediaProxyUrl (previously NOT
  // passed into this call at all) must reach createMediaProxyHandler unchanged.
  const deps = h.getCapturedMediaProxyDeps();
  assert.ok(deps, 'createMediaProxyHandler must be invoked');
  assert.equal(deps.getTabContents, h.getTabContentsFake);
  assert.equal(deps.isInternalContents, h.isInternalContentsFake);
  assert.equal(deps.parseMediaProxyUrl, h.parseMediaProxyUrlFake);

  // Registration: exactly one 'goldfinch-media' handler.handle call, on the DEFAULT
  // session's protocol (never the internal session's) — using the built handler.
  assert.deepEqual(
    h.defaultSessionProtocolCalls.map((call) => call.scheme),
    ['goldfinch-media']
  );
  assert.equal(h.defaultSessionProtocolCalls[0].handler, h.mediaProxyHandlerFn);
  assert.equal(h.events.includes('protocol:goldfinch-media'), false, 'goldfinch-media must never be registered on the internal session');
});

test('DD7: a fresh profile purges default-session cookies + cache once, fire-and-forget, and writes the marker', async () => {
  const h = makeHarness({ hygieneMarker: null });
  await h.lifecycle.ready;

  // Placement: the purge must not be part of the ready chain itself (first
  // paint is never gated on it) — right after `ready` resolves, the store is
  // built (gate check already run) but the async clear-* calls may not have
  // settled yet. Flushing lets the fire-and-forget chain complete.
  assert.equal(h.getHygieneDocStoreCreatedFor(), 'hygiene');
  await flushMicrotasks();

  const clearStorageCall = h.events.find((e) => Array.isArray(e) && e[0] === 'clear-storage-data');
  assert.ok(clearStorageCall, 'clearStorageData must be called on a fresh profile');
  assert.deepEqual(clearStorageCall[1], { storages: ['cookies'] });
  assert.equal(h.events.includes('clear-cache'), true);
  assert.equal(h.hygieneWrites.length, 1, 'marker must be written exactly once after a successful purge');
  assert.equal(h.getHygieneMarker(), h.hygieneWrites[0]);

  // Ordering: clearStorageData and clearCache both precede the marker write —
  // a crash between the purge and the write must not leave a false marker.
  const clearStorageIdx = h.events.findIndex((e) => Array.isArray(e) && e[0] === 'clear-storage-data');
  const clearCacheIdx = h.events.indexOf('clear-cache');
  const writeIdx = h.events.findIndex((e) => typeof e === 'string' && e.startsWith('hygiene-write:'));
  assert.ok(clearStorageIdx < clearCacheIdx && clearCacheIdx < writeIdx);
});

test('DD7: a second boot with the marker already present performs no purge', async () => {
  const h = makeHarness({ hygieneMarker: 'default-session-purge-v1' });
  await h.lifecycle.ready;
  await flushMicrotasks();

  assert.equal(h.events.some((e) => Array.isArray(e) && e[0] === 'clear-storage-data'), false);
  assert.equal(h.events.includes('clear-cache'), false);
  assert.equal(h.hygieneWrites.length, 0, 'an already-purged profile must not rewrite the marker');
});

test('automation bind decision honors production setting and unpackaged dev override', async () => {
  for (const options of [
    { automationEnabled: true },
    { dev: true },
  ]) {
    const h = makeHarness(options);
    await h.lifecycle.ready;
    const decision = h.events.find((event) => Array.isArray(event) && event[0] === 'bind-decision');
    assert.deepEqual(decision[1], {
      automationEnabled: options.automationEnabled === true,
      devForceBind: options.dev === true,
    });
    assert.equal(h.events.includes('start-mcp'), true);
    assert.equal(h.handlers.has('automation:dev-invoke'), options.dev === true);
  }
});

test('restore topology and boot-config keep saved tabs and flush queued chrome sends', async () => {
  const h = makeHarness({ restore: { windows: [{ tabs: [{ url: 'https://example.com' }] }] } });
  await h.lifecycle.ready;
  assert.equal(h.created.length, 1);
  assert.deepEqual(h.created[0].options, { noBootTab: true });
  assert.deepEqual(h.created[0].restoreTabs, [{ url: 'https://example.com' }]);

  const sent = [];
  const rec = {
    bootConfigServed: false,
    noBootTab: true,
    restoreTabs: h.created[0].restoreTabs,
    pendingChromeSends: [() => ['adopt-tab', { wcId: 7 }]],
    chromeView: { webContents: { isDestroyed: () => false, send: (...args) => sent.push(args) } },
  };
  h.setBootRecord(rec);
  assert.deepEqual(h.handlers.get('window-boot-config')({ sender: {} }), {
    bootTab: false,
    restoreTabs: [{ url: 'https://example.com' }]
  });
  assert.equal(rec.bootConfigServed, true);
  assert.deepEqual(sent, [['adopt-tab', { wcId: 7 }]]);
});

test('quit path snapshots and flushes before MCP stop, then closes stores at will-quit', async () => {
  const h = makeHarness({ restore: { windows: [{ tabs: [] }] } });
  await h.lifecycle.ready;
  h.events.length = 0;
  h.appListeners.get('before-quit')();
  assert.deepEqual(h.events, ['quitting:true', 'session-write', 'flush-downloads', 'stop-mcp']);
  h.events.length = 0;
  h.appListeners.get('window-all-closed')();
  assert.deepEqual(h.events, ['stop-mcp', 'quit']);
  h.events.length = 0;
  h.appListeners.get('will-quit')();
  assert.deepEqual(h.events, ['history-close', 'appdb-close']);
});
