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
  // Vault fill-icon native-menu delegate capture (I8): the owning window + recorded calls.
  const iconMenuWin = { id: 17, isDestroyed: () => false };
  const iconMenuCalls = [];
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
      // Guest sender → owning window record (used by the vault fill-icon native menu path).
      getWindowForGuest: (id) => id === 5 ? { win: iconMenuWin } : null,
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
    // M12 F5 HAT batch 1 (I8): the native fill-icon menu delegate. Records its args so a test
    // can assert the bare, no-secret hand-off + that NOTHING is sent to the guest.
    popupVaultIconMenu: (arg) => iconMenuCalls.push(arg),
    random: () => 0.5,
    logger: { warn: (...args) => events.push(['warn', ...args]) },
  });
  return { handlers, listeners, internal, events, wc, chrome, chromeSender, human, iconMenuCalls, iconMenuWin };
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
    // M12 F5 HAT (I14, import split): the BARE vault-request-import forward (beginImportUnlock) is
    // UNCONDITIONAL — it needs only chromeForTab. The pickImportFile + clearPendingImport channels
    // are GATED on their injections (this harness omits them), so only this one appears here.
    'internal-vault-begin-import-unlock',
    // M12 F4 Leg 2 (key-rotation): the cross-renderer rotate-recovery / change-master / recover
    // triggers (bare, no secret), registered alongside the other request triggers.
    'internal-vault-request-rotate-recovery',
    // M12 F4 Leg 3 (admin-key-provision): the cross-renderer rotate-admin trigger (bare, no secret),
    // registered immediately after rotate-recovery.
    'internal-vault-request-rotate-admin',
    'internal-vault-request-change-master',
    'internal-vault-request-recover',
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

test('vault fill-icon context menu: a BARE guest signal pops a NATIVE menu over the owning window — no secret, no guest DOM', () => {
  const h = makeHarness();
  // The listener is bare (registered via ipcMain.on) and carries no payload — the guest sends
  // no arguments; the trusted wcId is derived from event.sender.id.
  assert.equal(h.listeners.has('guest-vault-icon-menu'), true);
  h.listeners.get('guest-vault-icon-menu')({ sender: { id: 5 } });

  // The native-menu delegate is invoked with the derived wcId + the OWNING window (resolved via
  // registry.getWindowForGuest) — this is what pops an OS-native Menu.popup, NEVER a guest-DOM
  // menu.
  assert.deepEqual(h.iconMenuCalls, [{ wcId: 5, win: h.iconMenuWin }]);
  // Nothing is sent back into the guest page — no menu DOM, no secret crosses to content.
  assert.deepEqual(h.events, [], 'the icon-menu path sends nothing to the guest wc or chrome');
  // The signal carried no payload at all (bare) — there is no secret to leak.
  assert.deepEqual(Object.keys(h.iconMenuCalls[0]).sort(), ['wcId', 'win']);
});

test('vault fill-icon context menu: an unresolvable owning window no-ops (delegate still called with win undefined)', () => {
  const h = makeHarness();
  // A guest whose window does not resolve (id 6) — the delegate is called with win undefined and
  // guards internally (real delegate returns early); no throw, nothing sent to the guest.
  h.listeners.get('guest-vault-icon-menu')({ sender: { id: 6 } });
  assert.deepEqual(h.iconMenuCalls, [{ wcId: 6, win: undefined }]);
  assert.deepEqual(h.events, []);
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
