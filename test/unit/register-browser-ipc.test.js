'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerBrowserIpc } = require('../../src/main/register-browser-ipc');

function makeHarness() {
  const handlers = new Map();
  const listeners = new Map();
  const internal = new Map();
  const events = [];
  const chromeSender = {};
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
  // Leg 4 (capture-save): a fake human whose capture() returns a settable offer (or
  // null when the gate drops) and records the dismiss ids.
  const human = {
    captures: [], dismissed: [], nextOffer: null,
    capture(arg) { human.captures.push(arg); return human.nextOffer; },
    captureDismiss(id) { human.dismissed.push(id); },
  };
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
    jars: {
      list: () => [{ id: 'personal', partition: 'persist:personal' }],
      add: (name) => ({ id: 'new', name }),
    },
    registry: {
      getWindowForChrome: (sender) => sender === chromeSender
        ? { win: { id: 17, isMaximized: () => false, minimize: () => events.push(['minimize']), maximize: () => events.push(['maximize']), close: () => events.push(['close']) } }
        : null,
    },
    createWindow: () => ({ win: { id: 23 } }),
    broadcastJarsChanged: () => events.push(['jars-changed']),
    isSafeTabUrl: (url) => typeof url === 'string' && url.startsWith('https://'),
    getChromeContents: () => chrome,
    session: { fromPartition: (partition) => partition === 'internal' ? internalSession : webSession },
    registrableDomain: (host) => host,
    hostnameOf: (url) => new URL(url).hostname,
    shields: { active: () => true },
    getVaultHuman: () => human,
    random: () => 0.5,
    logger: { warn: (...args) => events.push(['warn', ...args]) },
  });
  return { handlers, listeners, internal, events, wc, chrome, chromeSender, human };
}

test('browser registrar preserves channel inventory and owner-routed media forwarding', () => {
  const h = makeHarness();
  assert.deepEqual([...h.internal.keys()], [
    // M12 F3 Leg 4 (first-run-setup): the cross-renderer setup/unlock request triggers
    // (registered alongside the other guest-vault-* handlers, ahead of open-tab-in-jar).
    'internal-vault-request-setup',
    'internal-vault-request-unlock',
    // M12 F3 Leg 5 (access-keys): the cross-renderer access-key MINT trigger (carries the
    // non-secret target), registered alongside the other request triggers.
    'internal-vault-request-mint',
    'internal-open-tab-in-jar',
  ]);
  assert.equal(h.handlers.has('privacy-cookies'), true);
  assert.equal(h.listeners.has('guest-media-list'), true);
  h.listeners.get('guest-media-list')({ sender: { id: 5 } }, ['song']);
  assert.deepEqual(h.events, [['chrome-send', 'tab-media-list', { wcId: 5, mediaList: ['song'] }]]);
});

test('window actions derive authority from the sender and container creation broadcasts', async () => {
  const h = makeHarness();
  assert.equal(await h.handlers.get('window-create')({ sender: {} }), null);
  assert.equal(await h.handlers.get('window-create')({ sender: h.chromeSender }), 23);
  h.listeners.get('window-minimize')({ sender: {} });
  assert.deepEqual(h.events, []);
  h.listeners.get('window-minimize')({ sender: h.chromeSender });
  assert.deepEqual(h.events, [['minimize']]);
  h.events.length = 0;
  assert.equal(await h.handlers.get('new-container-create')({}, null), null);
  assert.deepEqual(await h.handlers.get('new-container-create')({}, { name: 'Work' }), { id: 'new', name: 'Work' });
  assert.deepEqual(h.events, [['jars-changed']]);
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

test('vault capture: an offer forwards to the owning chrome (no password on the wire); a dropped gate forwards nothing', () => {
  const h = makeHarness();
  // The main-side capture derives origin itself; the guest sends only { username, password }.
  const passwordBytes = new TextEncoder().encode('typed-secret');

  // GATE DROP: capture() returns null → no vault-capture-offer is sent.
  h.human.nextOffer = null;
  h.listeners.get('guest-vault-capture')({ sender: { id: 5 } }, { username: 'me@a', password: passwordBytes });
  assert.deepEqual(h.human.captures[0], { wcId: 5, username: 'me@a', passwordBytes });
  assert.deepEqual(h.events, [], 'no forward when the gate drops (null offer)');

  // OFFER: capture() returns { captureId, model } → forwarded to the owning chrome.
  h.human.nextOffer = { captureId: 'cap123', model: { origin: 'https://a.example', username: 'me@a', mode: 'save', defaultVaultId: 'personal', choices: ['personal', 'global'] } };
  h.listeners.get('guest-vault-capture')({ sender: { id: 5 } }, { username: 'me@a', password: passwordBytes });
  assert.deepEqual(h.events, [
    ['chrome-send', 'vault-capture-offer', { captureId: 'cap123', model: h.human.nextOffer.model }],
  ]);
  // The forwarded payload never carries a password (grep the whole event stream).
  assert.ok(!JSON.stringify(h.events).includes('typed-secret'), 'no captured password crosses to chrome');
});

test('vault capture dismiss: the chrome-invoked drop reaches the human ops', () => {
  const h = makeHarness();
  h.handlers.get('vault-capture-dismiss')({}, 'cap123');
  assert.deepEqual(h.human.dismissed, ['cap123']);
  // A non-string id is ignored (no drop).
  h.handlers.get('vault-capture-dismiss')({}, 42);
  assert.deepEqual(h.human.dismissed, ['cap123']);
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
