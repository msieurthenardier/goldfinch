'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { registerAppLifecycle } = require('../../src/main/app-lifecycle');
const { extractLaunchUrls, filterLaunchUrls } = require('../../src/shared/launch-urls');

// Mission 13 Flight 3 / Leg 3 (DD3, AC2/AC3): a minimal webContents double for the
// web-contents-created catch-all tests — just enough EventEmitter + setWindowOpenHandler
// surface to drive will-navigate/will-frame-navigate/will-redirect and read the result.
class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.openHandler = null;
  }
  setWindowOpenHandler(fn) {
    this.openHandler = fn;
  }
}

function navEvent(url) {
  return {
    url,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    }
  };
}

function makeHarness({
  restore = null,
  platform = 'linux',
  dev = false,
  automationEnabled = false,
  hygieneMarker = null,
  onChromeBooted = undefined,
  // Mission 20 Flight 3 Leg 3 (DD5): the `recoverTabs` branch's collaborator —
  // a recording FAKE (not the real chrome-recovery.js, which has its own
  // suite) so these tests pin app-lifecycle.js's OWN orchestration: recovered
  // checked before restoreTabs, adopts sent directly before the queue flush,
  // the queue deduped, the zero-tabs fallback.
  chromeRecoveryAdopts = [],
  // Sortie 01: the process argv handed to registerAppLifecycle (was hard-coded []).
  argv = [],
  // Sortie 01: opt in to a registry whose records() TRACKS created windows and whose
  // create path seeds last-focused like the real window-registry create() — else the
  // "first restored window gets the URLs" case would pass vacuously. Off by default so
  // the pre-existing static one-record fake (before-quit tests) is unchanged.
  trackRecords = false,
  // Sortie 01: restoreSession ON while sessionStore.read() returns null (no snapshot).
  restoreOnNullSnapshot = false
} = {}) {
  const events = [];
  const appListeners = new Map();
  const handlers = new Map();
  const ipcListeners = new Map();
  const settingsValues = {
    spellcheck: true,
    restoreSession: restore != null || restoreOnNullSnapshot,
    automationEnabled
  };
  const records = trackRecords ? [] : [{ win: { id: 1 } }];
  let lastFocusedId = null;
  const chromeSends = [];
  const raiseLog = [];
  const makeWin = (id) => ({
    id,
    minimized: false,
    isMinimized() {
      return this.minimized;
    },
    restore() {
      this.minimized = false;
      raiseLog.push(['restore', id]);
    },
    show: () => raiseLog.push(['show', id]),
    focus: () => raiseLog.push(['focus', id])
  });
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
  // M14 F1 L2: captured app.on('login') routings — [webContents, details, authInfo, callback].
  const authLoginCalls = [];
  // M14 F1 L3: captured app.on('select-client-certificate') routings —
  // [webContents, url, list, callback].
  const certSelectCalls = [];
  // Mission 20 Flight 2 Leg 2: captured app.on('certificate-error') routings —
  // [webContents, url, error, certificate, callback, isMainFrame].
  const certErrorCalls = [];
  const chromeRecoveryCalls = [];
  const warnLog = [];
  const debugLog = [];
  const pruneCrashDumpsCalls = [];
  const onChildProcessGoneCalls = [];
  const app = {
    isPackaged: !dev,
    on: (name, fn) => appListeners.set(name, fn),
    whenReady: () => Promise.resolve(),
    quit: () => events.push('quit'),
    // Mission 20 Flight 3 Leg 3 (DD8/AC7): pruneCrashDumps reads this at ready.
    getPath: (name) => `/profile/${name}`
  };
  const lifecycle = registerAppLifecycle({
    app,
    ipcMain: {
      handle: (channel, fn) => handlers.set(channel, fn),
      on: (channel, fn) => ipcListeners.set(channel, fn)
    },
    sessionRuntime: { onSessionCreated: () => events.push('session-created') },
    // M18 F2 L4 (H2 resurface): optional post-boot-config hook — passed through so
    // the boot-config test pins its placement (after the queued-send flush).
    onChromeBooted,
    initProfileAndStores: () => events.push('init-stores'),
    profileStores: { jars: { getDefault: () => ({ id: 'personal' }) } },
    historyStore: {
      open: () => events.push('history-open'),
      close: () => events.push('history-close'),
      listRecent: () => [],
      search: () => []
    },
    sessionStore: {
      load: () => events.push('session-load'),
      read: () => restore,
      write: () => events.push('session-write')
    },
    getUserDataPath: () => '/profile',
    createHistoryRecorder: () => ({ recorder: true }),
    setHistoryRecorder: () => events.push('history-recorder'),
    listJars: () => [],
    broadcast: () => {},
    pruneAllJars: () => events.push('prune'),
    scheduleInterval: () => ({ unref: () => events.push('interval') }),
    createDownloadsManager: () => {
      events.push('downloads-manager');
      return downloadsManager;
    },
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
          }
        },
        clearStorageData: (options) => {
          events.push(['clear-storage-data', options]);
          return Promise.resolve();
        },
        clearCache: () => {
          events.push('clear-cache');
          return Promise.resolve();
        }
      };
    },
    fromPartition: () => {
      events.push('internal-session');
      return internalSession;
    },
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
      const rec = { options, win: makeWin(created.length + 10), chromeRecoveryPaused: false };
      created.push(rec);
      if (trackRecords) {
        records.push(rec);
        lastFocusedId = rec.win.id;
      }
      events.push(`create-window:${options && options.noBootTab === true}`);
      return rec;
    },
    extractLaunchUrls,
    filterLaunchUrls,
    queueChromeSend: (rec, build) => {
      const [channel, payload] = build();
      chromeSends.push({ rec, channel, payload });
      raiseLog.push(['send', rec.win && rec.win.id]);
    },
    registry: {
      records: () => records,
      getLastFocused: () => records.find((r) => r.win.id === lastFocusedId) || records[0] || null,
      noteFocus: (id) => {
        raiseLog.push(['noteFocus', id]);
        if (records.some((r) => r.win.id === id)) lastFocusedId = id;
      },
      getWindowForChrome: () => bootRecord,
      isTabViewWcId: () => false,
      isChromeContents: () => false
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
    mintJarKey: () => '',
    mintAdminKey: () => '',
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
          }
        };
      }
    },
    // M14 F1 L2/L3: the pending-challenge store behind app.on('login') and
    // app.on('select-client-certificate') — recording fakes; the tests pin
    // registration + routing.
    authChallenges: {
      handleLogin: (...args) => authLoginCalls.push(args),
      handleSelectClientCertificate: (...args) => certSelectCalls.push(args)
    },
    // Mission 20 Flight 2 Leg 2 (DD1): the certificate-error trust decision
    // behind app.on('certificate-error') — a recording fake.
    certTrust: {
      handleCertificateError: (...args) => certErrorCalls.push(args)
    },
    // Mission 20 Flight 3 Leg 3 (DD5): `window-boot-config`'s `recoverTabs`
    // branch collaborators.
    chromeRecovery: {
      buildRecoveryAdopts: (rec, ctx) => {
        chromeRecoveryCalls.push({ rec, ctx });
        return chromeRecoveryAdopts;
      }
    },
    buildAdoptPayload: (p) => ({ ...p }),
    getDefaultJar: () => ({ id: 'personal', name: 'Personal', color: '#123456', partition: 'persist:personal' }),
    pruneCrashDumps: (dir) => pruneCrashDumpsCalls.push(dir),
    onChildProcessGone: (details) => onChildProcessGoneCalls.push(details),
    getAllWindows: () => (trackRecords ? records.map((r) => r.win) : []),
    argv,
    env: {},
    platform,
    stdout: { write: () => {} },
    logger: {
      error: (...args) => events.push(['error', ...args]),
      warn: (...args) => warnLog.push(args),
      debug: (...args) => debugLog.push(args)
    }
  });
  return {
    events,
    chromeSends,
    raiseLog,
    warnLog,
    records,
    setLastFocused: (id) => {
      lastFocusedId = id;
    },
    appListeners,
    handlers,
    ipcListeners,
    lifecycle,
    created,
    internalSession,
    authLoginCalls,
    certSelectCalls,
    certErrorCalls,
    defaultSessionReads: () => defaultSessionReads,
    setBootRecord: (record) => {
      bootRecord = record;
    },
    defaultSessionProtocolCalls,
    getCapturedMediaProxyDeps: () => capturedMediaProxyDeps,
    mediaProxyHandlerFn,
    getTabContentsFake,
    isInternalContentsFake,
    parseMediaProxyUrlFake,
    getHygieneDocStoreCreatedFor: () => hygieneDocStoreCreatedFor,
    hygieneWrites,
    getHygieneMarker: () => hygieneMarker,
    chromeRecoveryCalls,
    pruneCrashDumpsCalls,
    debugLog,
    onChildProcessGoneCalls
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
    'init-stores',
    'history-open',
    'session-load',
    'history-recorder',
    'prune',
    'interval',
    'downloads-manager',
    'set-downloads-manager',
    'wire-downloads',
    'apply-shields',
    'apply-spellcheck',
    'media-proxy-handler-built',
    'default-protocol:goldfinch-media',
    'creating:true',
    'internal-session',
    'creating:false'
  ]);
  assert.equal(h.events.includes('protocol:goldfinch'), true);
  assert.equal(h.internalSession.__goldfinchInternal, true);
  assert.equal(h.events.includes('create-window:undefined'), true);
  assert.equal(h.appListeners.has('activate'), true);
  assert.equal(h.appListeners.has('session-created'), true);
});

// ---------------------------------------------------------------------------
// M14 F1 L2 (flight DD2): app.on('login') registration + routing.
// ---------------------------------------------------------------------------

test('login handler is registered at TOP-LEVEL scope, before whenReady resolves (M14 F1 L2 / DD2)', () => {
  const h = makeHarness();
  // Registered synchronously by registerAppLifecycle itself — the first
  // window's first navigation can challenge before whenReady's tail runs.
  assert.equal(h.appListeners.has('login'), true);
});

test('login handler ALWAYS preventDefault()s and routes all four args to authChallenges.handleLogin', () => {
  const h = makeHarness();
  const handler = h.appListeners.get('login');
  const event = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    }
  };
  const webContents = { id: 42, session: {} };
  const details = { url: 'http://127.0.0.1:8091/protected' };
  const authInfo = { isProxy: false, host: '127.0.0.1', port: 8091, scheme: 'basic', realm: 'fixture' };
  const callback = () => {};
  handler(event, webContents, details, authInfo, callback);
  assert.equal(event.prevented, true, 'preventDefault must run unconditionally');
  assert.equal(h.authLoginCalls.length, 1);
  assert.deepEqual(h.authLoginCalls[0], [webContents, details, authInfo, callback]);
});

// ---------------------------------------------------------------------------
// M14 F1 L3 (flight DD4): app.on('select-client-certificate') registration +
// routing — an APP-level event (design-review corrected), beside 'login'.
// ---------------------------------------------------------------------------

test('select-client-certificate handler is registered at TOP-LEVEL scope, before whenReady resolves (M14 F1 L3 / DD4)', () => {
  const h = makeHarness();
  // Registered synchronously by registerAppLifecycle itself — the first
  // window's first navigation can hit a cert-requesting TLS handshake before
  // whenReady's tail runs (the 'login' rationale, verbatim).
  assert.equal(h.appListeners.has('select-client-certificate'), true);
});

test('select-client-certificate handler ALWAYS preventDefault()s and routes all four args to authChallenges.handleSelectClientCertificate', () => {
  const h = makeHarness();
  const handler = h.appListeners.get('select-client-certificate');
  const event = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    }
  };
  const webContents = { id: 42, session: {} };
  const url = 'https://127.0.0.1:8493/';
  const list = [{ subjectName: 'CN=Fixture Client', issuerName: 'CN=Fixture CA' }];
  const callback = () => {};
  handler(event, webContents, url, list, callback);
  assert.equal(
    event.prevented,
    true,
    'preventDefault must run unconditionally (Electron would auto-pick the first cert)'
  );
  assert.equal(h.certSelectCalls.length, 1);
  assert.deepEqual(h.certSelectCalls[0], [webContents, url, list, callback]);
});

// ---------------------------------------------------------------------------
// Mission 20 Flight 2 Leg 2 (DD1): app.on('certificate-error') registration +
// routing — beside 'login'/'select-client-certificate', same rationale.
// ---------------------------------------------------------------------------

test('certificate-error handler is registered at TOP-LEVEL scope, before whenReady resolves (Mission 20 F2 L2 / DD1)', () => {
  const h = makeHarness();
  assert.equal(h.appListeners.has('certificate-error'), true);
});

test('certificate-error handler ALWAYS preventDefault()s and routes all six args to certTrust.handleCertificateError', () => {
  const h = makeHarness();
  const handler = h.appListeners.get('certificate-error');
  const event = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    }
  };
  const webContents = { id: 7, session: {} };
  const url = 'https://bad.test/';
  const error = 'net::ERR_CERT_AUTHORITY_INVALID';
  const certificate = { fingerprint: 'AA:BB', data: '' };
  const callback = () => {};
  const isMainFrame = true;
  handler(event, webContents, url, error, certificate, callback, isMainFrame);
  assert.equal(event.prevented, true, 'preventDefault must run unconditionally');
  assert.equal(h.certErrorCalls.length, 1);
  assert.deepEqual(h.certErrorCalls[0], [webContents, url, error, certificate, callback, isMainFrame]);
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
  assert.equal(
    unsafeButLatched.prevented,
    false,
    "the latch early-returns unconditionally — enforcement is the guest's own job"
  );
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
  assert.equal(
    h.events.includes('protocol:goldfinch-media'),
    false,
    'goldfinch-media must never be registered on the internal session'
  );
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

  assert.equal(
    h.events.some((e) => Array.isArray(e) && e[0] === 'clear-storage-data'),
    false
  );
  assert.equal(h.events.includes('clear-cache'), false);
  assert.equal(h.hygieneWrites.length, 0, 'an already-purged profile must not rewrite the marker');
});

test('automation bind decision honors production setting and unpackaged dev override', async () => {
  for (const options of [{ automationEnabled: true }, { dev: true }]) {
    const h = makeHarness(options);
    await h.lifecycle.ready;
    const decision = h.events.find((event) => Array.isArray(event) && event[0] === 'bind-decision');
    assert.deepEqual(decision[1], {
      automationEnabled: options.automationEnabled === true,
      devForceBind: options.dev === true
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
    chromeView: { webContents: { isDestroyed: () => false, send: (...args) => sent.push(args) } }
  };
  h.setBootRecord(rec);
  assert.deepEqual(h.handlers.get('window-boot-config')({ sender: {} }), {
    bootTab: false,
    restoreTabs: [{ url: 'https://example.com' }]
  });
  assert.equal(rec.bootConfigServed, true);
  assert.deepEqual(sent, [['adopt-tab', { wcId: 7 }]]);
});

test('window-boot-config fires the optional onChromeBooted hook AFTER the queued-send flush, with the booted record (M18 F2 L4 H2 resurface)', async () => {
  const booted = [];
  const h = makeHarness({
    restore: { windows: [{ tabs: [{ url: 'https://example.com' }] }] },
    onChromeBooted: (rec) => booted.push({ rec, flushedFirst: rec.pendingChromeSends.length === 0 })
  });
  await h.lifecycle.ready;
  const sent = [];
  const rec = {
    bootConfigServed: false,
    noBootTab: true,
    restoreTabs: null,
    pendingChromeSends: [() => ['adopt-tab', { wcId: 7 }]],
    chromeView: { webContents: { isDestroyed: () => false, send: (...args) => sent.push(args) } }
  };
  h.setBootRecord(rec);
  h.handlers.get('window-boot-config')({ sender: {} });
  assert.equal(booted.length, 1, 'the hook fired exactly once');
  assert.equal(booted[0].rec, rec, 'the hook receives the booted record');
  assert.equal(booted[0].flushedFirst, true, 'queued chrome sends were flushed BEFORE the hook');
  // And a harness with NO hook still serves boot-config (optional-chained).
  const bare = makeHarness({ restore: { windows: [{ tabs: [] }] } });
  await bare.lifecycle.ready;
  bare.setBootRecord({ ...rec, pendingChromeSends: [] });
  assert.doesNotThrow(() => bare.handlers.get('window-boot-config')({ sender: {} }));
});

// ---------------------------------------------------------------------------
// Mission 20 Flight 3 Leg 3 (DD5): window-boot-config's `recoverTabs` branch —
// checked and consumed BEFORE `restoreTabs`, adopts sent DIRECTLY (never
// queued) before the pendingChromeSends flush, the flush itself deduped
// last-wins per (wcId, channel), and the zero-tabs fallback.
// ---------------------------------------------------------------------------

test('recoverTabs: sends chromeRecovery adopts directly, THEN flushes the queue, returns { bootTab: false }', async () => {
  const sent = [];
  const h = makeHarness({
    chromeRecoveryAdopts: [
      ['adopt-tab', { wcId: 1, active: true }],
      ['tab-nav-state', { wcId: 1, canGoBack: false, canGoForward: false }]
    ]
  });
  await h.lifecycle.ready;
  const rec = {
    bootConfigServed: false,
    noBootTab: false,
    recoverTabs: true,
    restoreTabs: null,
    tabViews: new Map([[1, { view: {} }]]),
    activeTabWcId: 1,
    pendingChromeSends: [() => ['tab-title', { wcId: 1, title: 'queued' }]],
    chromeView: { webContents: { isDestroyed: () => false, send: (...args) => sent.push(args) } }
  };
  h.setBootRecord(rec);
  const result = h.handlers.get('window-boot-config')({ sender: {} });
  assert.deepEqual(result, { bootTab: false });
  assert.equal(rec.recoverTabs, false, 'recoverTabs is consumed');
  assert.equal(rec.bootConfigServed, true);
  assert.deepEqual(sent, [
    ['adopt-tab', { wcId: 1, active: true }],
    ['tab-nav-state', { wcId: 1, canGoBack: false, canGoForward: false }],
    ['tab-title', { wcId: 1, title: 'queued' }]
  ]);
  assert.equal(h.chromeRecoveryCalls.length, 1, 'buildRecoveryAdopts called exactly once');
  assert.equal(h.chromeRecoveryCalls[0].rec, rec);
  assert.equal(typeof h.chromeRecoveryCalls[0].ctx.buildAdoptPayload, 'function');
  assert.deepEqual(h.chromeRecoveryCalls[0].ctx.defaultJar, {
    id: 'personal',
    name: 'Personal',
    color: '#123456',
    partition: 'persist:personal'
  });
});

test('recoverTabs wins over restoreTabs — restoreTabs is left INTACT but never returned', async () => {
  const h = makeHarness({ chromeRecoveryAdopts: [] });
  await h.lifecycle.ready;
  const rec = {
    bootConfigServed: false,
    noBootTab: false,
    recoverTabs: true,
    restoreTabs: [{ url: 'https://saved.example/' }],
    tabViews: new Map([[1, { view: {} }]]),
    activeTabWcId: 1,
    pendingChromeSends: [],
    chromeView: { webContents: { isDestroyed: () => false, send: () => {} } }
  };
  h.setBootRecord(rec);
  const result = h.handlers.get('window-boot-config')({ sender: {} });
  assert.deepEqual(result, { bootTab: false }, 'recoverTabs wins — never { bootTab: false, restoreTabs }');
  assert.deepEqual(rec.restoreTabs, [{ url: 'https://saved.example/' }], 'restoreTabs is left INTACT, never nulled');
});

test('recoverTabs with zero tabViews returns { bootTab: !noBootTab } instead of an empty chrome', async () => {
  const h = makeHarness({ chromeRecoveryAdopts: [] });
  await h.lifecycle.ready;
  const rec = {
    bootConfigServed: false,
    noBootTab: false,
    recoverTabs: true,
    restoreTabs: null,
    tabViews: new Map(),
    activeTabWcId: null,
    pendingChromeSends: [],
    chromeView: { webContents: { isDestroyed: () => false, send: () => {} } }
  };
  h.setBootRecord(rec);
  assert.deepEqual(h.handlers.get('window-boot-config')({ sender: {} }), { bootTab: true });
  assert.equal(h.chromeRecoveryCalls.length, 0, 'buildRecoveryAdopts is never called for zero tabs');
});

test('recoverTabs: the gap queue is deduped last-wins per (wcId, channel), survivor at the LAST occurrence position', async () => {
  const sent = [];
  const h = makeHarness({ chromeRecoveryAdopts: [['adopt-tab', { wcId: 1, active: true }]] });
  await h.lifecycle.ready;
  const rec = {
    bootConfigServed: false,
    noBootTab: false,
    recoverTabs: true,
    restoreTabs: null,
    tabViews: new Map([[1, { view: {} }]]),
    activeTabWcId: 1,
    pendingChromeSends: [
      () => ['tab-loading', { wcId: 1, loading: true }],
      () => ['tab-title', { wcId: 1, title: 'first' }],
      () => ['tab-loading', { wcId: 1, loading: false }] // survivor for (1, tab-loading) — last occurrence
    ],
    chromeView: { webContents: { isDestroyed: () => false, send: (...args) => sent.push(args) } }
  };
  h.setBootRecord(rec);
  h.handlers.get('window-boot-config')({ sender: {} });
  assert.deepEqual(sent, [
    ['adopt-tab', { wcId: 1, active: true }],
    ['tab-title', { wcId: 1, title: 'first' }],
    ['tab-loading', { wcId: 1, loading: false }]
  ]);
});

test('recoverTabs: two no-wcId gap messages both survive the dedupe, in order, interleaved with a deduped wcId pair at its last-occurrence position', async () => {
  const sent = [];
  const h = makeHarness({ chromeRecoveryAdopts: [['adopt-tab', { wcId: 1, active: true }]] });
  await h.lifecycle.ready;
  const rec = {
    bootConfigServed: false,
    noBootTab: false,
    recoverTabs: true,
    restoreTabs: null,
    tabViews: new Map([[1, { view: {} }]]),
    activeTabWcId: 1,
    pendingChromeSends: [
      () => ['tab-loading', { wcId: 1, loading: true }],
      () => ['toast-show', { message: 'first toast' }], // no wcId — must never collapse with the other
      () => ['tab-loading', { wcId: 1, loading: false }], // survivor for (1, tab-loading) — last occurrence
      () => ['toast-show', { message: 'second toast' }] // no wcId — must never collapse with the first
    ],
    chromeView: { webContents: { isDestroyed: () => false, send: (...args) => sent.push(args) } }
  };
  h.setBootRecord(rec);
  h.handlers.get('window-boot-config')({ sender: {} });
  assert.deepEqual(sent, [
    ['adopt-tab', { wcId: 1, active: true }],
    ['toast-show', { message: 'first toast' }],
    ['tab-loading', { wcId: 1, loading: false }],
    ['toast-show', { message: 'second toast' }]
  ]);
});

test('pruneCrashDumps is called at ready with app.getPath("crashDumps")', async () => {
  const h = makeHarness();
  await h.lifecycle.ready;
  assert.equal(h.pruneCrashDumpsCalls.length, 1);
});

test('crash-dump prune debug line is logged unpackaged, suppressed packaged (squawk 0112)', async () => {
  const dev = makeHarness({ dev: true });
  await dev.lifecycle.ready;
  assert.deepEqual(dev.debugLog, [['[app-lifecycle] pruning crash dumps under', '/profile/crashDumps']]);
  const packaged = makeHarness({ dev: false });
  await packaged.lifecycle.ready;
  assert.deepEqual(packaged.debugLog, []);
  assert.equal(packaged.pruneCrashDumpsCalls.length, 1);
});

test("app.on('child-process-gone') routes to the injected onChildProcessGone", async () => {
  const h = makeHarness();
  await h.lifecycle.ready;
  const handler = h.appListeners.get('child-process-gone');
  assert.equal(typeof handler, 'function');
  const details = { type: 'GPU', reason: 'crashed', exitCode: 1 };
  handler({}, details);
  assert.deepEqual(h.onChildProcessGoneCalls, [details]);
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

// ---------------------------------------------------------------------------
// M14 F2 L1 (flight DD3 "catch-all stays" clause) — source-scan pin: the
// popup allow path lives EXCLUSIVELY in guest-wiring's per-guest handler; the
// app-lifecycle non-guest catch-all deny and its nav guard stay byte-unchanged.
// ---------------------------------------------------------------------------

test('the non-guest web-contents-created catch-all deny + guard is byte-unchanged (M14 F2 L1 / DD3 pin)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'app-lifecycle.js'), 'utf8');
  const pinned = `  const ALLOWED_NONGUEST_SCHEMES = ['devtools:', 'file:', 'chrome-extension:', 'about:'];
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const guard = (event) => {
      if (contents.__goldfinchNavGuarded) return; // guests: own predicate already covers them
      const url = event.url || '';
      if (isSafeTabUrl(url) || isInternalPageUrl(url)) return;`;
  assert.ok(
    src.includes(pinned),
    'the catch-all region changed — DD3 requires the non-guest deny to stay; the popup allow path belongs in guest-wiring only'
  );
});

// ---------------------------------------------------------------------------
// Sortie 01 (default browser) — launch-URL intake: cold argv, second-instance,
// open-url. Events emitted synchronously after makeHarness are PRE-ready; events
// after `await lifecycle.ready` are post-ready.
// ---------------------------------------------------------------------------

const A = 'https://a.example/x?q=1';
const B = 'https://b.example/';
const openSends = (h) => h.chromeSends.filter((s) => s.channel === 'open-external-urls');
const secondInstance = (h, ...urls) => h.appListeners.get('second-instance')({}, ['exe', ...urls]);

test('cold argv: first record gets one open-external-urls send and noBootTab', async () => {
  const h = makeHarness({ trackRecords: true, argv: ['exe', '--flag', A, B] });
  await h.lifecycle.ready;
  assert.deepEqual(h.created[0].options, { noBootTab: true });
  assert.equal(openSends(h).length, 1);
  assert.equal(openSends(h)[0].rec, h.created[0]);
  assert.deepEqual(openSends(h)[0].payload, { urls: [A, B] });
});

test('cold argv + restore with TWO saved windows: the FIRST restored record gets the URLs', async () => {
  const restore = { windows: [{ tabs: [{ url: 'https://one.test/' }] }, { tabs: [{ url: 'https://two.test/' }] }] };
  const h = makeHarness({ trackRecords: true, restore, argv: ['exe', A] });
  await h.lifecycle.ready;
  assert.equal(h.created.length, 2);
  assert.deepEqual(h.created[0].options, { noBootTab: true });
  assert.deepEqual(h.created[1].options, { noBootTab: true });
  assert.equal(openSends(h).length, 1);
  assert.equal(openSends(h)[0].rec, h.created[0], 'not the last-created (last-focused) window');
});

test('pre-ready second-instance merges into the cold flush (deduped across argv + second-instance)', async () => {
  const h = makeHarness({ trackRecords: true, argv: ['exe', A] });
  secondInstance(h, A, B);
  await h.lifecycle.ready;
  assert.equal(openSends(h).length, 1);
  assert.deepEqual(openSends(h)[0].payload, { urls: [A, B] });
  assert.deepEqual(
    h.raiseLog.filter((e) => e[0] !== 'send'),
    [],
    'pre-ready intake never touches the registry/window'
  );
});

test('pre-ready open-url buffers, preventDefault()s, and merges', async () => {
  const h = makeHarness({ trackRecords: true });
  const ev = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    }
  };
  h.appListeners.get('open-url')(ev, A);
  assert.equal(ev.prevented, true);
  await h.lifecycle.ready;
  assert.deepEqual(openSends(h)[0].payload, { urls: [A] });
  assert.deepEqual(h.created[0].options, { noBootTab: true });
});

test('restore on + null snapshot + URLs: window is created noBootTab', async () => {
  const h = makeHarness({ trackRecords: true, restoreOnNullSnapshot: true, argv: ['exe', A] });
  await h.lifecycle.ready;
  assert.deepEqual(h.created[0].options, { noBootTab: true });
});

test('no URLs: createWindow() is called with NO argument and nothing is sent', async () => {
  const h = makeHarness({ trackRecords: true, argv: ['exe', '.', '--automation-dev', 'goldfinch://settings'] });
  await h.lifecycle.ready;
  assert.equal(h.created[0].options, undefined);
  assert.equal(h.events.includes('create-window:undefined'), true);
  assert.equal(h.chromeSends.length, 0);
});

test('pre-ready buffer caps at 20 total across three arrivals and dedupes', async () => {
  const mk = (from, n) => Array.from({ length: n }, (_, i) => `https://h${from + i}.test/`);
  const h = makeHarness({ trackRecords: true, argv: ['exe', ...mk(0, 10)] });
  secondInstance(h, ...mk(5, 10)); // 5..14, overlaps 5..9
  secondInstance(h, ...mk(15, 10)); // 15..24
  await h.lifecycle.ready;
  const urls = openSends(h)[0].payload.urls;
  assert.equal(urls.length, 20);
  assert.equal(new Set(urls).size, 20);
});

test('buffer is consumed once: a later flush-less ready sends nothing more', async () => {
  const h = makeHarness({ trackRecords: true, argv: ['exe', A] });
  await h.lifecycle.ready;
  assert.equal(openSends(h).length, 1);
  await flushMicrotasks();
  assert.equal(openSends(h).length, 1);
  h.appListeners.get('activate')();
  assert.equal(openSends(h).length, 1);
});

test('second-instance with hostile-only argv: no send, window NOT raised', async () => {
  const h = makeHarness({ trackRecords: true });
  await h.lifecycle.ready;
  secondInstance(h, 'goldfinch://settings', 'file:///etc/passwd', 'javascript:alert(1)', '--flag');
  assert.equal(openSends(h).length, 0);
  assert.deepEqual(h.raiseLog, []);
});

test('second-instance with a URL: raise (noteFocus) then send to last-focused', async () => {
  const h = makeHarness({ trackRecords: true });
  await h.lifecycle.ready;
  h.created[0].win.minimized = true;
  secondInstance(h, A);
  assert.deepEqual(h.raiseLog, [
    ['restore', 10],
    ['show', 10],
    ['focus', 10],
    ['noteFocus', 10],
    ['send', 10]
  ]);
  assert.deepEqual(openSends(h)[0].payload, { urls: [A] });
});

test('post-ready target is last-focused, with a paused-record fallback', async () => {
  const restore = { windows: [{ tabs: [] }, { tabs: [] }] };
  const h = makeHarness({ trackRecords: true, restore });
  await h.lifecycle.ready;
  const [r1, r2] = h.created;
  h.setLastFocused(r2.win.id);
  secondInstance(h, A);
  assert.equal(openSends(h).at(-1).rec, r2);
  r2.chromeRecoveryPaused = true;
  secondInstance(h, B);
  assert.equal(openSends(h).at(-1).rec, r1, 'paused last-focused falls back to first non-paused');
  r1.chromeRecoveryPaused = true;
  const before = openSends(h).length;
  const raised = h.raiseLog.length;
  secondInstance(h, 'https://c.example/');
  assert.equal(openSends(h).length, before, 'all paused: dropped');
  assert.equal(h.raiseLog.length, raised, 'all paused: not raised');
  assert.equal(h.warnLog.length, 1);
  assert.equal(JSON.stringify(h.warnLog).includes('c.example'), false, 'logs name only a count, never a URL');
});

test('post-ready open-url with windows present raises then sends', async () => {
  const h = makeHarness({ trackRecords: true });
  await h.lifecycle.ready;
  const ev = { preventDefault() {} };
  h.appListeners.get('open-url')(ev, A);
  assert.deepEqual(
    h.raiseLog.map((e) => e[0]),
    ['show', 'focus', 'noteFocus', 'send']
  );
});

test('darwin zero-window post-ready intake: exactly one createWindow({ noBootTab: true }) + send; activate adds no second', async () => {
  const h = makeHarness({ trackRecords: true, platform: 'darwin' });
  await h.lifecycle.ready;
  h.records.length = 0; // every window closed; darwin stays resident
  h.created.length = 0;
  h.appListeners.get('open-url')({ preventDefault() {} }, A);
  assert.equal(h.created.length, 1);
  assert.deepEqual(h.created[0].options, { noBootTab: true });
  assert.equal(openSends(h).at(-1).rec, h.created[0]);
  h.appListeners.get('activate')();
  assert.equal(h.created.length, 1, 'activate must not create a second window');
  // second-instance takes the same path
  h.records.length = 0;
  h.created.length = 0;
  secondInstance(h, B);
  assert.equal(h.created.length, 1);
});

test('non-darwin zero-window post-ready intake: dropped and logged, no window created', async () => {
  const h = makeHarness({ trackRecords: true, platform: 'linux' });
  await h.lifecycle.ready;
  h.records.length = 0;
  const before = h.created.length;
  secondInstance(h, A);
  assert.equal(h.created.length, before);
  assert.equal(openSends(h).length, 0);
  assert.equal(h.warnLog.length, 1);
});
