'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerBrowserIpc } = require('../../src/main/register-browser-ipc');

function makeHarness() {
  const handlers = new Map();
  const listeners = new Map();
  const internal = new Map();
  const events = [];
  const webSession = {
    cookies: { get: async () => [], remove: async () => {} },
    clearStorageData: async (opts) => events.push(['clear-storage', opts]),
    clearCache: async () => events.push(['clear-cache']),
  };
  const internalSession = { __goldfinchInternal: true };
  const wc = {
    id: 5,
    session: webSession,
    isDestroyed: () => false,
    getURL: () => 'https://example.com/',
    getZoomFactor: () => 1.25,
    isDevToolsOpened: () => true,
    focus: () => events.push(['focus']),
    replaceMisspelling: (word) => events.push(['correct', word]),
    cut: () => events.push(['cut']), copy: () => events.push(['copy']), paste: () => events.push(['paste']),
    undo: () => events.push(['undo']), redo: () => events.push(['redo']),
    send: (...args) => events.push(['guest-send', ...args]),
    print: () => events.push(['print']),
  };
  const chrome = { send: (...args) => events.push(['chrome-send', ...args]) };
  registerBrowserIpc({
    ipcMain: {
      handle: (channel, fn) => handlers.set(channel, fn),
      on: (channel, fn) => listeners.set(channel, fn),
    },
    webContents: { fromId: (id) => id === 5 ? wc : id === 6 ? { ...wc, session: internalSession } : null },
    chromeForTab: () => chrome,
    getTabContents: (id) => id === 5 ? wc : null,
    applyZoom: (_wc, action) => events.push(['zoom', action]),
    isInternalContents: (target) => target.session.__goldfinchInternal === true,
    toggleDevTools: () => { events.push(['devtools']); return true; },
    registerInternalHandler: (_ipc, channel, fn) => internal.set(channel, fn),
    jars: { list: () => [{ id: 'personal', partition: 'persist:personal' }] },
    isSafeTabUrl: (url) => typeof url === 'string' && url.startsWith('https://'),
    getChromeContents: () => chrome,
    session: { fromPartition: (partition) => partition === 'internal' ? internalSession : webSession },
    registrableDomain: (host) => host,
    hostnameOf: (url) => new URL(url).hostname,
    shields: { active: () => true },
    random: () => 0.5,
    logger: { warn: (...args) => events.push(['warn', ...args]) },
  });
  return { handlers, listeners, internal, events, wc, chrome };
}

test('browser registrar preserves channel inventory and owner-routed media forwarding', () => {
  const h = makeHarness();
  assert.deepEqual([...h.internal.keys()], ['internal-open-tab-in-jar']);
  assert.equal(h.handlers.has('privacy-cookies'), true);
  assert.equal(h.listeners.has('guest-media-list'), true);
  h.listeners.get('guest-media-list')({ sender: { id: 5 } }, ['song']);
  assert.deepEqual(h.events, [['chrome-send', 'tab-media-list', { wcId: 5, mediaList: ['song'] }]]);
});

test('browser target guards and page-context allowlist refuse malformed/internal requests', async () => {
  const h = makeHarness();
  assert.equal(await h.handlers.get('get-zoom')({}, null), null);
  assert.equal(await h.handlers.get('toggle-devtools')({}, { webContentsId: 6 }), false);
  await h.handlers.get('page-context-action')({}, { webContentsId: 5, action: 'destroy' });
  assert.deepEqual(h.events, []);
  await h.handlers.get('page-context-action')({}, { webContentsId: 5, action: 'copy' });
  assert.deepEqual(h.events, [['copy']]);

  assert.deepEqual(await h.internal.get('internal-open-tab-in-jar')({}, null), {
    ok: false, error: 'open-tab-in-jar — malformed-payload'
  });
  assert.deepEqual(await h.internal.get('internal-open-tab-in-jar')({}, { jarId: 'personal', url: 'javascript:bad' }), {
    ok: false, error: 'open-tab-in-jar — bad-args'
  });
});

test('privacy channels retain their exact empty/no-tab return shapes', async () => {
  const h = makeHarness();
  assert.deepEqual(await h.handlers.get('privacy-cookies')({}, { webContentsId: 999 }), {
    firstParty: null, first: 0, third: 0, total: 0, list: []
  });
  assert.deepEqual(await h.handlers.get('privacy-clear-cookies')({}, { webContentsId: 6, scope: 'all' }), { removed: 0 });
  assert.deepEqual(await h.handlers.get('privacy-clear-storage')({}, { webContentsId: 999, url: 'https://example.com' }), {
    ok: false, error: 'no-tab'
  });
});
