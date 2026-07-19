'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerAppLifecycle } = require('../../src/main/app-lifecycle');

function makeHarness({ restore = null, platform = 'linux', dev = false, automationEnabled = false } = {}) {
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
    defaultSession: {},
    fromPartition: () => { events.push('internal-session'); return internalSession; },
    internalPartition: 'goldfinch-internal',
    setCreatingInternalSession: (value) => events.push(`creating:${value}`),
    handleInternal: () => {},
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
    appDb: { close: () => events.push('appdb-close') },
    getAllWindows: () => [],
    argv: [], env: {}, platform,
    stdout: { write: () => {} },
    logger: { error: (...args) => events.push(['error', ...args]), warn: () => {} },
  });
  return {
    events, appListeners, handlers, ipcListeners, lifecycle, created, internalSession,
    setBootRecord: (record) => { bootRecord = record; },
  };
}

test('ready path preserves store/session initialization order and default window creation', async () => {
  const h = makeHarness();
  await h.lifecycle.ready;
  assert.deepEqual(h.events.slice(0, 14), [
    'init-stores', 'history-open', 'session-load', 'history-recorder', 'prune', 'interval',
    'downloads-manager', 'set-downloads-manager', 'wire-downloads', 'apply-shields',
    'apply-spellcheck', 'creating:true', 'internal-session', 'creating:false'
  ]);
  assert.equal(h.events.includes('protocol:goldfinch'), true);
  assert.equal(h.internalSession.__goldfinchInternal, true);
  assert.equal(h.events.includes('create-window:undefined'), true);
  assert.equal(h.appListeners.has('activate'), true);
  assert.equal(h.appListeners.has('session-created'), true);
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
