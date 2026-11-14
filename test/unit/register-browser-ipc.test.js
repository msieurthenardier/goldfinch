'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerBrowserIpc } = require('../../src/main/register-browser-ipc');
const { eventFrom, guestEvent, makeTestGate } = require('../helpers/ipc-gate-fixture');
const { createMediaProxyTokens } = require('../../src/main/media-proxy-tokens');

function makeHarness(options = {}) {
  const handlers = new Map();
  const listeners = new Map();
  const internal = new Map();
  const events = [];
  const chromeForTabCalls = [];
  const chromeSender = {};
  const webSession = {
    cookies: { get: async () => [], remove: async () => {} },
    clearStorageData: async (opts) => events.push(['clear-storage', opts]),
    clearCache: async () => events.push(['clear-cache'])
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
    cut: () => events.push(['cut']),
    copy: () => events.push(['copy']),
    paste: () => events.push(['paste']),
    undo: () => events.push(['undo']),
    redo: () => events.push(['redo']),
    send: (...args) => events.push(['guest-send', ...args]),
    print: () => events.push(['print'])
  };
  const chrome = { send: (...args) => events.push(['chrome-send', ...args]) };
  // Vault fill-icon native-menu delegate capture (I8): the owning window + recorded calls.
  const iconMenuWin = {
    id: 17,
    isDestroyed: () => false,
    isMaximized: () => false,
    minimize: () => events.push(['minimize']),
    maximize: () => events.push(['maximize']),
    close: () => events.push(['close'])
  };
  // Sortie 06 (DD5/AC12): the guest-5 owner record; `activeTabWcId` gates the main-side offer send.
  const ownerRecord = { win: iconMenuWin, activeTabWcId: 5, tabViews: new Map([[5, { security: 'secure' }]]) };
  const iconMenuCalls = [];
  // Mission 23 Flight 1 (`vault-fill-trust`): a recording witness. `options.gestureVerdict` is what its
  // `admit` answers (default: accept); the calls it received are kept for the assertions.
  const admitCalls = [];
  // Leg `jar-isolation`: the REAL token store, so the media-list tests assert real minting and drops.
  const mediaProxyTokens = createMediaProxyTokens();
  const gestureWitness = options.noWitness
    ? undefined
    : {
        admit(arg) {
          admitCalls.push(arg);
          return options.gestureVerdict || { ok: true };
        }
      };
  // Sortie 06 Leg 2: a SECOND window (its own chrome sender) for the finalize owner-gate tests.
  const otherChromeSender = {};
  const otherRecord = { win: { id: 18 }, activeTabWcId: 99 };
  // Leg 5 (broadened-capture): a fake human whose holdGestureLogin/holdGestureCard
  // record their args (recording ONLY the gesture-hold call — this leg's IPC
  // handlers never dispose/offer anything themselves) and whose captureRelease
  // returns a settable offer (or null), plus captureDismiss recording dismiss ids.
  const human = {
    // Mission 23 Flight 1 (`vault-fill-trust`): the picker-context mint the accepted gesture calls.
    minted: [],
    mintContext(arg) {
      human.minted.push(arg);
      return { id: `ctx-${human.minted.length}`, certOverride: arg.certOverride === true };
    },
    captures: [],
    dismissed: [],
    // M21 F3 L2 (DD1's amendment, AC2 contract update): captureRelease now returns an
    // ARRAY — [] for the common nothing-pending case, one entry per released family.
    nextOffer: [],
    holdGestureLogin(arg) {
      human.captures.push(arg);
      return { captureId: 'held' };
    },
    holdGestureCard(arg) {
      human.captures.push(arg);
      return { captureId: 'held' };
    },
    // M21 F3 L4 (AC10): the identity twin — same shape as the login/card fakes.
    holdGestureIdentity(arg) {
      human.captures.push(arg);
      return { captureId: 'held' };
    },
    captureRelease() {
      return human.nextOffer;
    },
    captureDismiss(id) {
      human.dismissed.push(id);
    },
    // Sortie 06 Leg 2: finalize seams (captureId -> owning tab; recorded finalize calls).
    tabs: new Map([['held', 5]]),
    finalized: [],
    nextFinalize: { captureId: 'held', model: { mode: 'save' } },
    captureTabOf(id) {
      return human.tabs.has(id) ? human.tabs.get(id) : null;
    },
    captureFinalize(id) {
      human.finalized.push(id);
      return human.nextFinalize;
    }
  };
  const ipcMain = {
    handle: (channel, fn) => handlers.set(channel, fn),
    on: (channel, fn) => listeners.set(channel, fn)
  };
  const registry = {
    getWindowForChrome: (sender) =>
      sender === chromeSender ? ownerRecord : sender === otherChromeSender ? otherRecord : null,
    // Guest sender → owning window record (used by the vault fill-icon native menu path).
    getWindowForGuest: (id) => (id === 5 ? ownerRecord : null)
  };
  registerBrowserIpc({
    ipcMain,
    gate: makeTestGate({
      ipcMain,
      registry,
      isPopupWcId: (id) => !!(options.popupRegistry && options.popupRegistry.getByWcId(id))
    }),
    webContents: {
      fromId: (id) =>
        id === 5 ? wc : id === 6 ? { ...wc, session: internalSession } : id === 77 ? { ...wc, id: 77 } : null
    },
    chromeForTab: (wcId) => {
      chromeForTabCalls.push(wcId);
      return chrome;
    },
    getTabContents: (id) => (id === 5 ? wc : null),
    applyZoom: (_wc, action) => events.push(['zoom', action]),
    isInternalContents: (target) => target.session.__goldfinchInternal === true,
    toggleDevTools: () => {
      events.push(['devtools']);
      return true;
    },
    registerInternalHandler: (_ipc, channel, fn) => internal.set(channel, fn),
    jars: {
      list: () => [{ id: 'personal', partition: 'persist:personal' }],
      add: (name) => ({ id: 'new', name })
    },
    registry,
    createWindow: () => ({ win: { id: 23 } }),
    broadcastJarsChanged: () => events.push(['jars-changed']),
    isSafeTabUrl: (url) => typeof url === 'string' && url.startsWith('https://'),
    getChromeContents: () => chrome,
    session: { fromPartition: (partition) => (partition === 'internal' ? internalSession : webSession) },
    registrableDomain: (host) => host,
    hostnameOf: (url) => new URL(url).hostname,
    shields: { active: () => true },
    getVaultHuman: () => human,
    // M19 F1 Leg 2 (AC7): the browser-CSV-import flow's four channels — optional, threaded
    // only when a test's options object supplies them (mirrors popupRegistry below), so the
    // "channel inventory" test's harness (no options) omits them and stays green.
    browserImportBegin: options.browserImportBegin,
    browserImportSummary: options.browserImportSummary,
    browserImportCancel: options.browserImportCancel,
    browserImportCommit: options.browserImportCommit,
    // M12 F5 HAT batch 1 (I8): the native fill-icon menu delegate. Records its args so a test
    // can assert the bare, no-secret hand-off + that NOTHING is sent to the guest.
    popupVaultIconMenu: (arg) => iconMenuCalls.push(arg),
    gestureWitness,
    mediaProxyTokens,
    // M14 F2 L1 (DD1d): popup registry for the guest-window-close popup path —
    // optional (offline suites that omit it exercise the optional-chain).
    popupRegistry: options.popupRegistry,
    random: options.random || (() => 0.5),
    logger: { warn: (...args) => events.push(['warn', ...args]) }
  });
  return {
    handlers,
    listeners,
    internal,
    events,
    wc,
    chrome,
    chromeSender,
    otherChromeSender,
    otherRecord,
    human,
    iconMenuCalls,
    admitCalls,
    mediaProxyTokens,
    iconMenuWin,
    ownerRecord,
    chromeForTabCalls
  };
}

// ---------------------------------------------------------------------------
// guest-vault-gesture (M12 F2 Leg 1; extended M21 F4 Leg 3 — generate-in-
// picker, DD5/AC8): sender-derived wcId, the optional `generate` sub-payload
// re-validated main-side (never trusting the guest to have kept it honest).
// ---------------------------------------------------------------------------

// What every accepted gesture push carries next to `{ wcId }` (Mission 23 Flight 1, `vault-fill-trust`):
// the minted context id, the destination display string of the tab's committed origin
// (`https://example.com/` in this harness) and the certificate flag.
const PICKER_FIELDS = (n, extra = {}) => ({
  contextId: `ctx-${n}`,
  destination: 'example.com',
  certificate: false,
  ...extra
});

test('AC8: a bare gesture (no payload) forwards { wcId } plus the picker context fields (regression gate)', () => {
  const h = makeHarness();
  h.listeners.get('guest-vault-gesture')(guestEvent(5));
  assert.deepEqual(h.events, [['chrome-send', 'vault-gesture', { wcId: 5, ...PICKER_FIELDS(1) }]]);
});

test('AC8: an empty {} payload forwards the bare { wcId } shape', () => {
  const h = makeHarness();
  h.listeners.get('guest-vault-gesture')(guestEvent(5), {});
  assert.deepEqual(h.events, [['chrome-send', 'vault-gesture', { wcId: 5, ...PICKER_FIELDS(1) }]]);
});

test('AC8: a valid { generate: { passwordRole: "new", constraints } } payload forwards { wcId, generate: { canGenerate, constraints } }', () => {
  const h = makeHarness();
  h.listeners.get('guest-vault-gesture')(guestEvent(5), {
    generate: { passwordRole: 'new', constraints: { minLength: 10, maxLength: 20, passwordRules: null } }
  });
  assert.deepEqual(h.events, [
    [
      'chrome-send',
      'vault-gesture',
      {
        wcId: 5,
        ...PICKER_FIELDS(1),
        generate: { canGenerate: true, constraints: { minLength: 10, maxLength: 20, passwordRules: null } }
      }
    ]
  ]);
});

test('AC8: an unsatisfiable-but-well-formed constraints object still forwards, with canGenerate: false', () => {
  const h = makeHarness();
  h.listeners.get('guest-vault-gesture')(guestEvent(5), {
    generate: { passwordRole: 'new', constraints: { minLength: 20, maxLength: 10, passwordRules: null } }
  });
  assert.deepEqual(h.events, [
    [
      'chrome-send',
      'vault-gesture',
      {
        wcId: 5,
        ...PICKER_FIELDS(1),
        generate: { canGenerate: false, constraints: { minLength: 20, maxLength: 10, passwordRules: null } }
      }
    ]
  ]);
});

test('AC8: passwordRole other than the literal "new" degrades to the bare shape', () => {
  const h = makeHarness();
  for (const role of [null, 'current', 'confirm', 'sign-in', 42, undefined]) {
    h.events.length = 0;
    h.listeners.get('guest-vault-gesture')(guestEvent(5), { generate: { passwordRole: role, constraints: {} } });
    assert.deepEqual(
      h.events,
      [['chrome-send', 'vault-gesture', { wcId: 5, ...PICKER_FIELDS(h.human.minted.length) }]],
      `role ${String(role)} must degrade`
    );
  }
});

test('AC8: malformed constraints degrade to the bare shape', () => {
  const h = makeHarness();
  for (const constraints of [{ minLength: -5 }, { passwordRules: 'x'.repeat(513) }, { minLength: 1.5 }, null, 'x', 5]) {
    h.events.length = 0;
    h.listeners.get('guest-vault-gesture')(guestEvent(5), { generate: { passwordRole: 'new', constraints } });
    assert.deepEqual(h.events, [
      ['chrome-send', 'vault-gesture', { wcId: 5, ...PICKER_FIELDS(h.human.minted.length) }]
    ]);
  }
});

test('AC8: a non-object generate, or a non-object payload, degrades to the bare shape', () => {
  const h = makeHarness();
  for (const payload of [{ generate: null }, { generate: 'x' }, { generate: 5 }, null, 'x', 5]) {
    h.events.length = 0;
    h.listeners.get('guest-vault-gesture')(guestEvent(5), payload);
    assert.deepEqual(h.events, [
      ['chrome-send', 'vault-gesture', { wcId: 5, ...PICKER_FIELDS(h.human.minted.length) }]
    ]);
  }
});

// ---------------------------------------------------------------------------
// guest-tab-boundary (M17 Flight 1 Leg 1, DD2/AC3): the guest preload's
// capturing Tab/Shift+Tab handoff. Sender-derived wcId, direction allowlist,
// forwards only 'tab-boundary' to chromeForTab(wcId) — the guest-vault-gesture
// shape.
// ---------------------------------------------------------------------------

test('guest-tab-boundary: forwards a valid direction, wcId derived from event.sender.id only', () => {
  const h = makeHarness();
  assert.equal(h.listeners.has('guest-tab-boundary'), true);
  h.listeners.get('guest-tab-boundary')(guestEvent(5), { direction: 'forward' });
  assert.deepEqual(h.events, [['chrome-send', 'tab-boundary', { direction: 'forward' }]]);
  assert.deepEqual(h.chromeForTabCalls, [5]);
});

test('guest-tab-boundary: backward direction forwards too', () => {
  const h = makeHarness();
  h.listeners.get('guest-tab-boundary')(guestEvent(5), { direction: 'backward' });
  assert.deepEqual(h.events, [['chrome-send', 'tab-boundary', { direction: 'backward' }]]);
});

test('guest-tab-boundary: a renderer-supplied wcId in the payload is ignored — only event.sender.id is used', () => {
  const h = makeHarness();
  h.listeners.get('guest-tab-boundary')(guestEvent(5), { direction: 'forward', wcId: 999 });
  assert.deepEqual(h.chromeForTabCalls, [5], 'the forged wcId (999) in the payload must never reach chromeForTab');
});

test('guest-tab-boundary: an unrecognized direction is dropped — no forward, chromeForTab never called', () => {
  const h = makeHarness();
  h.listeners.get('guest-tab-boundary')(guestEvent(5), { direction: 'sideways' });
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.chromeForTabCalls, []);
});

test('guest-tab-boundary: a missing/malformed payload is dropped, not thrown', () => {
  const h = makeHarness();
  assert.doesNotThrow(() => h.listeners.get('guest-tab-boundary')(guestEvent(5), undefined));
  assert.deepEqual(h.events, []);
});

test('browser registrar preserves channel inventory and owner-routed media forwarding', () => {
  const h = makeHarness();
  assert.deepEqual(
    [...h.internal.keys()],
    [
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
      // M18 F2 L4 (compromise-mode rotation): the bare compromise trigger, registered
      // immediately after the rotation/recover triggers.
      'internal-vault-request-compromise',
      'internal-open-tab-in-jar'
    ]
  );
  assert.equal(h.handlers.has('privacy-cookies'), true);
  assert.equal(h.listeners.has('guest-media-list'), true);
});

// Mission 23 Flight 1 (leg `jar-isolation`): the media list is rebuilt in main and pushed with the tab's
// proxy token; the registrar never forwards the page's list verbatim.
function sentMediaList(h) {
  return h.events.filter((e) => e[0] === 'chrome-send' && e[1] === 'tab-media-list').map((e) => e[2]);
}

test('guest-media-list pushes the VALIDATED list with the tab token, never the raw list', () => {
  const h = makeHarness();
  const hostile = [
    { type: 'image', url: 'https://example.com/a.png', name: 'a.png', extra: 'dropped' },
    { type: 'image', url: 'goldfinch-media://proxy/28/http%3A%2F%2Fexample.com%2Fx.png', name: 'x' },
    { type: 'image', url: 'file:///etc/hostname', name: 'hostname' },
    { type: 'audio', url: 'ftp://example.com/x.mp3', name: 'x.mp3' }
  ];
  h.listeners.get('guest-media-list')(guestEvent(5), hostile);
  const [push, ...rest] = sentMediaList(h);
  assert.equal(rest.length, 0);
  assert.equal(push.wcId, 5);
  assert.deepEqual(push.mediaList, [{ type: 'image', url: 'https://example.com/a.png', name: 'a.png' }]);
  assert.match(push.mediaToken, /^[A-Za-z0-9_-]{22,}$/);
  assert.equal(h.mediaProxyTokens.resolve(push.mediaToken), 5);
  assert.deepEqual(Object.keys(push).sort(), ['mediaList', 'mediaToken', 'wcId']);
});

test('guest-media-list: a non-array list pushes an empty list (still with the token)', () => {
  const h = makeHarness();
  h.listeners.get('guest-media-list')(guestEvent(5), 'not a list');
  const [push] = sentMediaList(h);
  assert.deepEqual(push.mediaList, []);
});

test('guest-media-list: a list from a frame that is not the current main frame is dropped, nothing pushed', () => {
  const h = makeHarness();
  const stale = guestEvent(5, { senderFrame: { frameTreeNodeId: 1, frameToken: 'doc-OLD' } });
  h.listeners.get('guest-media-list')(stale, [{ type: 'image', url: 'https://example.com/a.png', name: 'a' }]);
  assert.deepEqual(sentMediaList(h), []);
  assert.equal(h.mediaProxyTokens.resolve('anything'), null);
});

test('guest-media-list: unreadable or missing frame tokens drop the list', () => {
  const h = makeHarness();
  const list = [{ type: 'image', url: 'https://example.com/a.png', name: 'a' }];
  const throwing = guestEvent(5);
  Object.defineProperty(throwing, 'senderFrame', {
    get() {
      throw new Error('frame gone');
    }
  });
  h.listeners.get('guest-media-list')(throwing, list);
  h.listeners.get('guest-media-list')(guestEvent(5, { senderFrame: { frameTreeNodeId: 1 } }), list);
  h.listeners.get('guest-media-list')(
    { sender: { id: 5 }, senderFrame: { frameTreeNodeId: 1, frameToken: 'x' } },
    list
  );
  assert.deepEqual(sentMediaList(h), []);
});

test('guest-media-list: the same document keeps its token across lists; a new document gets a new one', () => {
  const h = makeHarness();
  h.listeners.get('guest-media-list')(guestEvent(5), []);
  h.listeners.get('guest-media-list')(guestEvent(5), []);
  const next = guestEvent(5);
  next.sender.mainFrame.frameToken = 'doc-2';
  next.senderFrame.frameToken = 'doc-2';
  h.listeners.get('guest-media-list')(next, []);
  const [a, b, c] = sentMediaList(h);
  assert.equal(a.mediaToken, b.mediaToken);
  assert.notEqual(b.mediaToken, c.mediaToken);
  assert.equal(h.mediaProxyTokens.resolve(a.mediaToken), null, 'the replaced token no longer resolves');
  assert.equal(h.mediaProxyTokens.resolve(c.mediaToken), 5);
});

test('window actions derive authority from the sender and container creation broadcasts', async () => {
  const h = makeHarness();
  assert.equal(await h.handlers.get('window-create')({ sender: {} }), null);
  assert.equal(await h.handlers.get('window-create')(eventFrom(h.chromeSender)), 23);
  h.listeners.get('window-minimize')({ sender: {} });
  assert.deepEqual(h.events, []);
  h.listeners.get('window-minimize')(eventFrom(h.chromeSender));
  assert.deepEqual(h.events, [['minimize']]);
  h.events.length = 0;
  assert.equal(await h.handlers.get('new-container-create')({}, null), null);
  // Leg 2 (F3 DD2, AC2/AC5): INVERTED — a bare `{}` sender (no chrome identity)
  // now refuses. This was the succeeds-with-{}-sender pin the leg exists to close.
  assert.equal(
    await h.handlers.get('new-container-create')({}, { name: 'Work' }),
    null,
    'a non-chrome sender is refused, even with a well-formed payload'
  );
  assert.deepEqual(h.events, [], 'no jars-changed broadcast on a refused create');
  // The legitimate chrome sender still succeeds (AC6 — no regression).
  assert.deepEqual(await h.handlers.get('new-container-create')(eventFrom(h.chromeSender), { name: 'Work' }), {
    id: 'new',
    name: 'Work'
  });
  assert.deepEqual(h.events, [['jars-changed']]);
});

test('browser target guards and page-context allowlist refuse malformed/internal requests', async () => {
  const h = makeHarness();
  // Leg 2 (F3 DD2, AC2): these channels now also require a chrome sender — a
  // real chrome sender is used here so the pre-existing target/internal guard
  // assertions below stay meaningful (AC6 — no legitimate caller breaks).
  const chromeEvent = eventFrom(h.chromeSender);
  assert.equal(await h.handlers.get('get-zoom')(chromeEvent, null), null);
  assert.equal(await h.handlers.get('toggle-devtools')(chromeEvent, { webContentsId: 6 }), false);
  await h.handlers.get('page-context-action')(chromeEvent, { webContentsId: 5, action: 'destroy' });
  assert.deepEqual(h.events, []);
  await h.handlers.get('page-context-action')(chromeEvent, { webContentsId: 5, action: 'copy' });
  assert.deepEqual(h.events, [['copy']]);

  assert.deepEqual(await h.internal.get('internal-open-tab-in-jar')({}, null), {
    ok: false,
    error: 'open-tab-in-jar — malformed-payload'
  });
  assert.deepEqual(await h.internal.get('internal-open-tab-in-jar')({}, { jarId: 'personal', url: 'javascript:bad' }), {
    ok: false,
    error: 'open-tab-in-jar — bad-args'
  });
});

// Leg 2 (F3 DD2, AC2/AC5): a non-chrome sender is refused across the browser
// chrome-trust channels — demonstrated against otherwise-VALID targets/payloads
// (the same ones the previous test's chrome-sender calls succeed against), so
// the refusal is attributable to the sender gate and not to a bad target.
test('AC2/AC5: a non-chrome sender is refused across the browser chrome-trust channels', async () => {
  const h = makeHarness();
  assert.equal(
    await h.handlers.get('get-zoom')({}, { webContentsId: 5 }),
    null,
    'a valid external target is still refused without a chrome sender'
  );
  assert.equal(await h.handlers.get('toggle-devtools')({}, { webContentsId: 5 }), false);
  await h.handlers.get('page-context-action')({}, { webContentsId: 5, action: 'copy' });
  assert.deepEqual(h.events, [], 'a non-chrome sender cannot dispatch a page-context action against a valid target');
  h.listeners.get('rescan-media')({}, { wcId: 5 });
  assert.deepEqual(h.events, [], 'rescan-media refuses a non-chrome sender');
});

test('vault capture (Leg 5, broadened-capture): guest-vault-capture HOLDS only — no offer is sent at gesture time', () => {
  const h = makeHarness();
  // The main-side hold derives/freezes origin itself; the guest sends only
  // { username, usernameDetected, password }.
  const passwordBytes = new TextEncoder().encode('typed-secret');

  h.listeners.get('guest-vault-capture')(guestEvent(5), {
    username: 'me@a',
    usernameDetected: true,
    password: passwordBytes
  });
  assert.deepEqual(h.human.captures[0], {
    wcId: 5,
    username: 'me@a',
    usernameDetected: true,
    passwordBytes,
    currentPasswordBytes: undefined
  });
  // GESTURE-TIME HOLD never forwards an offer — settle does that (guest-wiring.js's
  // did-navigate hook, or guest-vault-gesture-settle below).
  assert.deepEqual(h.events, [], 'a gesture hold never itself forwards a vault-capture-offer');
});

test('vault capture (Mission 21, Flight 4, Leg 2 — password-field-roles): guest-vault-capture forwards an OPTIONAL currentPassword as currentPasswordBytes', () => {
  const h = makeHarness();
  const passwordBytes = new TextEncoder().encode('typed-new-secret');
  const currentPasswordBytes = new TextEncoder().encode('typed-current-secret');

  h.listeners.get('guest-vault-capture')(guestEvent(5), {
    username: 'me@a',
    usernameDetected: true,
    password: passwordBytes,
    currentPassword: currentPasswordBytes
  });
  assert.deepEqual(h.human.captures[0], {
    wcId: 5,
    username: 'me@a',
    usernameDetected: true,
    passwordBytes,
    currentPasswordBytes
  });
});

test('vault capture identity (M21 F3 Leg 4, AC10): guest-vault-capture-identity HOLDS only', () => {
  const h = makeHarness();
  const identitySecrets = new TextEncoder().encode(JSON.stringify({ email: 'a@b.com' }));

  h.listeners.get('guest-vault-capture-identity')(guestEvent(5), { identitySecrets, fullName: 'Ada Lovelace' });
  assert.deepEqual(h.human.captures[0], {
    wcId: 5,
    identitySecretsBytes: identitySecrets,
    fullName: 'Ada Lovelace'
  });
  assert.deepEqual(h.events, [], 'a gesture hold never itself forwards a vault-capture-offer');
});

test('vault capture card (Leg 5): guest-vault-capture-card HOLDS only', () => {
  const h = makeHarness();
  const numberBytes = new TextEncoder().encode('4111111111111111');
  const cvvBytes = new TextEncoder().encode('123');

  h.listeners.get('guest-vault-capture-card')(guestEvent(5), {
    number: numberBytes,
    cvv: cvvBytes,
    cardholder: 'Ada',
    expiry: '12/28'
  });
  assert.deepEqual(h.human.captures[0], {
    wcId: 5,
    numberBytes,
    cvvBytes,
    cardholder: 'Ada',
    expiry: '12/28'
  });
  assert.deepEqual(h.events, [], 'a gesture hold never itself forwards a vault-capture-offer');
});

test('vault capture settle (Leg 5, DD4 detachment path): guest-vault-gesture-settle releases via captureRelease and forwards the resulting offer (no password on the wire); nothing pending forwards nothing', () => {
  const h = makeHarness();

  // NOTHING PENDING: captureRelease() returns [] (M21 F3 L2 AC2 contract update) →
  // no vault-capture-offer is sent.
  h.human.nextOffer = [];
  h.listeners.get('guest-vault-gesture-settle')(guestEvent(5));
  assert.deepEqual(h.events, [], 'no forward when captureRelease finds nothing pending / drops');

  // RELEASED: captureRelease() returns [{ captureId, model }] → forwarded to the owning chrome.
  const offerModel = {
    origin: 'https://a.example',
    username: 'me@a',
    mode: 'save',
    defaultVaultId: 'personal',
    choices: ['personal', 'global']
  };
  h.human.nextOffer = [{ captureId: 'cap123', model: offerModel }];
  h.listeners.get('guest-vault-gesture-settle')(guestEvent(5));
  assert.deepEqual(h.events, [
    ['chrome-send', 'vault-capture-offer', { captureId: 'cap123', model: offerModel, wcId: 5 }]
  ]);
  // The forwarded payload never carries a password (grep the whole event stream).
  assert.ok(!JSON.stringify(h.events).includes('typed-secret'), 'no captured password crosses to chrome');
});

// M21 F3 L2 (DD1's amendment, AC4): captureRelease can release MULTIPLE families in
// one settle — the detachment settle path must send one vault-capture-offer per
// entry, in order, exactly like guest-wiring.js's navigation-commit settle half.
test('AC4: guest-vault-gesture-settle sends ONE vault-capture-offer per entry captureRelease returns, preserving release order', () => {
  const h = makeHarness();
  h.human.nextOffer = [
    { captureId: 'cap-login', model: { origin: 'https://a.example', username: 'me@a', mode: 'save' } },
    { captureId: 'cap-card', model: { kind: 'card', origin: 'https://a.example', mode: 'save' } }
  ];
  h.listeners.get('guest-vault-gesture-settle')(guestEvent(5));
  assert.deepEqual(h.events, [
    ['chrome-send', 'vault-capture-offer', { captureId: 'cap-login', model: h.human.nextOffer[0].model, wcId: 5 }],
    ['chrome-send', 'vault-capture-offer', { captureId: 'cap-card', model: h.human.nextOffer[1].model, wcId: 5 }]
  ]);
});

// Sortie 06 Leg 1 (DD5/AC12): the offer is gated MAIN-side to the window's ACTIVE tab - a
// background tab's settle dismisses the held captures and sends nothing.
test('Sortie 06 AC12: guest-vault-gesture-settle for a NON-ACTIVE tab dismisses each released capture and sends no offer', () => {
  const h = makeHarness();
  h.ownerRecord.activeTabWcId = 99;
  h.human.nextOffer = [
    { captureId: 'cap-login', model: { origin: 'https://a.example', username: 'me@a', mode: 'save' } },
    { captureId: 'cap-card', model: { kind: 'card', origin: 'https://a.example', mode: 'save' } }
  ];
  h.listeners.get('guest-vault-gesture-settle')(guestEvent(5));
  assert.deepEqual(h.events, [], 'no vault-capture-offer is sent for a background tab');
  assert.deepEqual(h.human.dismissed, ['cap-login', 'cap-card']);
});

test('vault fill-icon context menu: an ADMITTED right-click pops a NATIVE menu over the owning window with the committed origin and a raise closure — no secret, no guest DOM', () => {
  const h = makeHarness();
  assert.equal(h.listeners.has('guest-vault-icon-menu'), true);
  const box = { x: 10, y: 20, width: 30, height: 16 };
  h.listeners.get('guest-vault-icon-menu')(guestEvent(5), { box });

  // The witness was asked about THIS tab, the message as sent, the live zoom factor (1.25 in this
  // harness) and the committed origin read from the tab's own URL.
  assert.deepEqual(h.admitCalls, [
    { kind: 'icon-menu', wcId: 5, message: { box }, zoom: 1.25, origin: 'https://example.com' }
  ]);
  // The native-menu delegate is invoked with the derived wcId + the OWNING window + the origin.
  assert.equal(h.iconMenuCalls.length, 1);
  assert.deepEqual(Object.keys(h.iconMenuCalls[0]).sort(), ['origin', 'raise', 'wcId', 'win']);
  assert.equal(h.iconMenuCalls[0].wcId, 5);
  assert.equal(h.iconMenuCalls[0].win, h.iconMenuWin);
  assert.equal(h.iconMenuCalls[0].origin, 'https://example.com');
  // Nothing is sent to the guest or the chrome until the menu item is clicked.
  assert.deepEqual(h.events, [], 'the icon-menu path sends nothing to the guest wc or chrome');
  assert.deepEqual(h.human.minted, []);
});

test('vault fill-icon context menu: a REFUSED right-click never reaches the delegate (witness verdict, no fail-open)', () => {
  const h = makeHarness({ gestureVerdict: { ok: false, reason: 'no-real-input' } });
  h.listeners.get('guest-vault-icon-menu')(guestEvent(5), { box: { x: 0, y: 0, width: 30, height: 16 } });
  assert.deepEqual(h.iconMenuCalls, []);
  const noWitness = makeHarness({ noWitness: true });
  noWitness.listeners.get('guest-vault-icon-menu')(guestEvent(5), { box: { x: 0, y: 0, width: 30, height: 16 } });
  assert.deepEqual(noWitness.iconMenuCalls, [], 'a registrar built without the witness refuses everything');
});

test('"Fill login…" raise closure: mints a context and sends the enriched push only while the tab is alive, ACTIVE and at the admitted origin', () => {
  const box = { box: { x: 0, y: 0, width: 30, height: 16 } };
  // Still valid: mints and sends the push (no generate info on this path).
  let h = makeHarness();
  h.listeners.get('guest-vault-icon-menu')(guestEvent(5), box);
  h.iconMenuCalls[0].raise();
  assert.deepEqual(h.events, [['chrome-send', 'vault-gesture', { wcId: 5, ...PICKER_FIELDS(1) }]]);
  assert.deepEqual(h.human.minted, [{ wcId: 5, origin: 'https://example.com', certOverride: false }]);
  // The tab navigated to another origin while the native menu was open: nothing.
  h = makeHarness();
  h.listeners.get('guest-vault-icon-menu')(guestEvent(5), box);
  h.wc.getURL = () => 'https://evil.example/login';
  h.iconMenuCalls[0].raise();
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.human.minted, []);
  // The tab is no longer its window's active tab: nothing.
  h = makeHarness();
  h.listeners.get('guest-vault-icon-menu')(guestEvent(5), box);
  h.ownerRecord.activeTabWcId = 99;
  h.iconMenuCalls[0].raise();
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.human.minted, []);
  // The tab is gone (destroyed): nothing.
  h = makeHarness();
  h.listeners.get('guest-vault-icon-menu')(guestEvent(5), box);
  h.wc.isDestroyed = () => true;
  h.iconMenuCalls[0].raise();
  assert.deepEqual(h.events, []);
  // An error page / non-http(s) URL at raise time has no committed origin: nothing.
  h = makeHarness();
  h.listeners.get('guest-vault-icon-menu')(guestEvent(5), box);
  h.wc.getURL = () => 'chrome-error://chromewebdata/';
  h.iconMenuCalls[0].raise();
  assert.deepEqual(h.events, []);
});

test('guest-vault-gesture: the witness decides - a refusal mints nothing and sends nothing; an accepted gesture mints once with the committed origin', () => {
  const box = { x: 5, y: 6, width: 30, height: 16 };
  let h = makeHarness({ gestureVerdict: { ok: false, reason: 'outside-box' } });
  h.listeners.get('guest-vault-gesture')(guestEvent(5), { box });
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.human.minted, []);
  assert.deepEqual(h.admitCalls, [
    { kind: 'gesture', wcId: 5, message: { box }, zoom: 1.25, origin: 'https://example.com' }
  ]);
  // No witness injected (a harness that cannot judge): fail-closed.
  h = makeHarness({ noWitness: true });
  h.listeners.get('guest-vault-gesture')(guestEvent(5), { box });
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.human.minted, []);
  // Accepted: one mint, origin and certificate flag from main's own reads.
  h = makeHarness();
  h.listeners.get('guest-vault-gesture')(guestEvent(5), { box });
  assert.deepEqual(h.human.minted, [{ wcId: 5, origin: 'https://example.com', certOverride: false }]);
  assert.deepEqual(h.events, [['chrome-send', 'vault-gesture', { wcId: 5, ...PICKER_FIELDS(1) }]]);
});

test('guest-vault-gesture: the origin handed to the witness is the COMMITTED origin (null for an error or non-http(s) page); the certificate flag mirrors the tab security state', () => {
  const box = { x: 5, y: 6, width: 30, height: 16 };
  for (const url of ['chrome-error://chromewebdata/', 'about:blank', 'file:///etc/hosts', 'data:text/html,x', '']) {
    const h = makeHarness();
    h.wc.getURL = () => url;
    h.listeners.get('guest-vault-gesture')(guestEvent(5), { box });
    assert.equal(h.admitCalls[0].origin, null, url);
  }
  const h = makeHarness();
  h.wc.getURL = () => 'https://Sub.Example.com:8443/path?q=1';
  h.ownerRecord.tabViews.get(5).security = 'overridden';
  h.listeners.get('guest-vault-gesture')(guestEvent(5), { box });
  assert.equal(h.admitCalls[0].origin, 'https://sub.example.com:8443');
  assert.deepEqual(h.events, [
    [
      'chrome-send',
      'vault-gesture',
      { wcId: 5, contextId: 'ctx-1', destination: 'sub.example.com:8443', certificate: true }
    ]
  ]);
});

test('vault fill-icon context menu: a sender that is no tab (id 6, unowned) is refused by the tab-guest class — the delegate never runs', () => {
  const h = makeHarness();
  // Mission 23 Flight 1: before the gate this reached the delegate with `win: undefined`; the
  // tab-guest class now turns a non-tab sender away before the handler.
  h.listeners.get('guest-vault-icon-menu')(guestEvent(6));
  assert.deepEqual(h.iconMenuCalls, []);
  assert.deepEqual(h.events, []);
});

test('vault capture dismiss: the chrome-invoked drop reaches the human ops', () => {
  const h = makeHarness();
  h.handlers.get('vault-capture-dismiss')(eventFrom(h.chromeSender), 'cap123');
  assert.deepEqual(h.human.dismissed, ['cap123']);
  // A non-string id is ignored (no drop).
  h.handlers.get('vault-capture-dismiss')(eventFrom(h.chromeSender), 42);
  assert.deepEqual(h.human.dismissed, ['cap123']);
});

test('vault capture dismiss is chrome-class: a page sender is refused, a late dismiss of an unknown id from the chrome is accepted', () => {
  const h = makeHarness();
  const page = { sender: { id: 5 }, senderFrame: { origin: 'https://evil.test' } };
  assert.throws(() => h.handlers.get('vault-capture-dismiss')(page, 'cap123'), /forbidden/);
  assert.deepEqual(h.human.dismissed, []);
  // The capture id is opaque (not a tab id): an expired / unknown one from the chrome still passes the gate.
  h.handlers.get('vault-capture-dismiss')(eventFrom(h.chromeSender), 'expired-id');
  assert.deepEqual(h.human.dismissed, ['expired-id']);
});

test('privacy channels retain their exact empty/no-tab return shapes', async () => {
  const h = makeHarness();
  assert.deepEqual(await h.handlers.get('privacy-cookies')({}, { webContentsId: 999 }), {
    firstParty: null,
    first: 0,
    third: 0,
    total: 0,
    list: []
  });
  assert.deepEqual(await h.handlers.get('privacy-clear-cookies')({}, { webContentsId: 6, scope: 'all' }), {
    removed: 0
  });
  assert.deepEqual(
    await h.handlers.get('privacy-clear-storage')({}, { webContentsId: 999, url: 'https://example.com' }),
    {
      ok: false,
      error: 'no-tab'
    }
  );
});

// ---------------------------------------------------------------------------
// M14 F2 L1 (DD1d): guest-window-close — popup wcIds destroy their own
// BrowserWindow; tab wcIds keep the chrome tab-self-close path; and the
// spike-observed silent no-op (popup close reaching the tab path) is closed.
// ---------------------------------------------------------------------------

test('guest-window-close from a POPUP destroys its BrowserWindow and never reaches the tab path', () => {
  const destroys = [];
  const popupWin = {
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    destroy() {
      this.destroyed = true;
      destroys.push('popup');
    }
  };
  const h = makeHarness({
    popupRegistry: { getByWcId: (id) => (id === 42 ? { popupWcId: 42, win: popupWin } : null) }
  });

  h.listeners.get('guest-window-close')(guestEvent(42), { historyLength: 1 });
  assert.deepEqual(destroys, ['popup'], 'the popup BrowserWindow is destroyed');
  assert.deepEqual(
    h.events,
    [],
    'no tab-self-close send for a popup sender — the silent no-op is replaced by a real close'
  );

  // Idempotent against an already-destroyed window (double window.close()).
  assert.doesNotThrow(() => h.listeners.get('guest-window-close')(guestEvent(42), {}));
  assert.deepEqual(destroys, ['popup'], 'no second destroy on a dead window');
});

test('guest-window-close from a TAB keeps the chrome tab-self-close path (registry present but non-member)', () => {
  const h = makeHarness({ popupRegistry: { getByWcId: () => null } });
  h.listeners.get('guest-window-close')(guestEvent(5), { historyLength: 3 });
  assert.deepEqual(h.events, [['chrome-send', 'tab-self-close', { wcId: 5, historyLength: 3 }]]);
});

test('guest-window-close sanitizes a forged historyLength and tolerates an absent popup registry (optional-chain)', () => {
  const h = makeHarness(); // no popupRegistry at all
  h.listeners.get('guest-window-close')(guestEvent(5), { historyLength: 'nope' });
  assert.deepEqual(h.events, [['chrome-send', 'tab-self-close', { wcId: 5, historyLength: 1 }]]);
});

// ---------------------------------------------------------------------------
// M19 F1 Leg 2 (AC7): the browser-CSV-import flow's four channels — gated on
// their own injections, resolving the window via chromeForTab(sender.id).
// ---------------------------------------------------------------------------

test('browser-import channels register only when their delegate is injected', () => {
  const bare = makeHarness();
  assert.equal(bare.internal.has('internal-vault-browser-import-pick'), false);
  assert.equal(bare.internal.has('internal-vault-browser-import-summary'), false);
  assert.equal(bare.internal.has('internal-vault-browser-import-cancel'), false);
  assert.equal(bare.internal.has('internal-vault-browser-import-commit'), false);

  const calls = [];
  const wired = makeHarness({
    browserImportBegin: async (chromeId) => {
      calls.push(['begin', chromeId]);
      return { ok: true };
    },
    browserImportSummary: (chromeId) => {
      calls.push(['summary', chromeId]);
      return null;
    },
    browserImportCancel: (chromeId, handle) => {
      calls.push(['cancel', chromeId, handle]);
    },
    browserImportCommit: async (chromeId, payload) => {
      calls.push(['commit', chromeId, payload]);
      return { ok: true, target: payload.target, counts: {} };
    }
  });
  assert.equal(wired.internal.has('internal-vault-browser-import-pick'), true);
  assert.equal(wired.internal.has('internal-vault-browser-import-summary'), true);
  assert.equal(wired.internal.has('internal-vault-browser-import-cancel'), true);
  assert.equal(wired.internal.has('internal-vault-browser-import-commit'), true);
});

test('browser-import channels resolve the window via chromeForTab(event.sender.id), not a payload-declared id', async () => {
  const calls = [];
  const h = makeHarness({
    browserImportBegin: async (chromeId) => {
      calls.push(['begin', chromeId]);
      return { ok: true };
    },
    browserImportSummary: (chromeId) => {
      calls.push(['summary', chromeId]);
      return null;
    },
    browserImportCancel: (chromeId, handle) => {
      calls.push(['cancel', chromeId, handle]);
    },
    browserImportCommit: async (chromeId, payload) => {
      calls.push(['commit', chromeId, payload]);
      return { ok: true, target: payload.target, counts: {} };
    }
  });

  await h.internal.get('internal-vault-browser-import-pick')({ sender: { id: 7 } });
  h.internal.get('internal-vault-browser-import-summary')({ sender: { id: 7 } });
  h.internal.get('internal-vault-browser-import-cancel')({ sender: { id: 7 } }, 'h1');
  await h.internal.get('internal-vault-browser-import-commit')(
    { sender: { id: 7 } },
    { handle: 'h1', target: 'global', mode: 'merge' }
  );

  assert.deepEqual(h.chromeForTabCalls, [7, 7, 7, 7]);
  // Every delegate receives chromeForTab(sender.id)?.id — this harness's chrome
  // double has no `.id`, so the resolved chromeId is `undefined` for every call
  // (proving the id comes from chromeForTab's return, never the payload).
  assert.deepEqual(calls, [
    ['begin', undefined],
    ['summary', undefined],
    ['cancel', undefined, 'h1'],
    ['commit', undefined, { handle: 'h1', target: 'global', mode: 'merge' }]
  ]);
});

test('browser-import commit rejects a malformed payload with { ok:false, reason:"state" } BEFORE delegating', async () => {
  const calls = [];
  const h = makeHarness({
    browserImportCommit: async (chromeId, payload) => {
      calls.push(['commit', chromeId, payload]);
      return { ok: true, target: payload.target, counts: {} };
    }
  });
  const handler = h.internal.get('internal-vault-browser-import-commit');

  assert.deepEqual(await handler({ sender: { id: 7 } }, undefined), { ok: false, reason: 'state' });
  assert.deepEqual(await handler({ sender: { id: 7 } }, {}), { ok: false, reason: 'state' });
  assert.deepEqual(await handler({ sender: { id: 7 } }, { handle: 'h1', target: 'global' }), {
    ok: false,
    reason: 'state'
  });
  assert.deepEqual(await handler({ sender: { id: 7 } }, { handle: 1, target: 'global', mode: 'merge' }), {
    ok: false,
    reason: 'state'
  });
  assert.deepEqual(calls, [], 'the delegate is never called on a malformed payload');

  const ok = await handler({ sender: { id: 7 } }, { handle: 'h1', target: 'global', mode: 'merge' });
  assert.equal(ok.ok, true);
  assert.equal(calls.length, 1);
});

// ---------------------------------------------------------------------------
// vault-capture-finalize (Sortie 06 Leg 2, AC7 / AC10.7-8): the bare chrome handle that now hosts
// the consented write gained a SENDER gate and an ACTIVE-TAB gate.
// ---------------------------------------------------------------------------

test("AC10.8: finalize from a NON-OWNING window's chrome -> refused, no finalize, record intact (no dismiss)", async () => {
  const h = makeHarness();
  const res = await h.handlers.get('vault-capture-finalize')(eventFrom(h.otherChromeSender), 'held');
  assert.deepEqual(res, { reason: 'refused' });
  assert.deepEqual(h.human.finalized, []);
  assert.deepEqual(h.human.dismissed, [], 'the record is left intact');
  // a non-chrome sender is refused the same way
  assert.deepEqual(await h.handlers.get('vault-capture-finalize')({ sender: {} }, 'held'), { reason: 'refused' });
  assert.deepEqual(h.human.finalized, []);
});

test('AC10.7: finalize for a NON-ACTIVE tab -> tab-changed, no finalize/write, record dropped', async () => {
  const h = makeHarness();
  h.ownerRecord.activeTabWcId = 6;
  const res = await h.handlers.get('vault-capture-finalize')(eventFrom(h.chromeSender), 'held');
  assert.deepEqual(res, { reason: 'tab-changed' });
  assert.deepEqual(h.human.finalized, []);
  assert.deepEqual(h.human.dismissed, ['held']);
});

test('AC7: finalize for an unknown id -> expired; a non-string id -> null; the owner + active tab reaches captureFinalize', async () => {
  const h = makeHarness();
  const fin = h.handlers.get('vault-capture-finalize');
  assert.deepEqual(await fin(eventFrom(h.chromeSender), 'nope'), { reason: 'expired' });
  assert.equal(await fin(eventFrom(h.chromeSender), 42), null);
  assert.deepEqual(await fin(eventFrom(h.chromeSender), 'held'), h.human.nextFinalize);
  assert.deepEqual(h.human.finalized, ['held']);
});

// ---------------------------------------------------------------------------
// Mission 23 Flight 1 (`ipc-gate-complete`, NF7): the chrome-only channels that take a tab id are
// OWNING-CHROME. A tab owned by ANOTHER window, and an id that names no tab at all (here 77: a
// live webContents that is not in any window's tabViews — a chrome or an overlay), are refused
// with the refusal value each channel always gave; the owner's chrome is unaffected.
// ---------------------------------------------------------------------------

test('NF7: the owning chrome reaches every tab-id channel; another window chrome and a non-tab id do not', async () => {
  const h = makeHarness();
  const owner = eventFrom(h.chromeSender);
  const other = eventFrom(h.otherChromeSender);
  const pageGet = (ch, ev, payload) => h.handlers.get(ch)(ev, payload);

  // get-zoom: the factor for the owner; the refusal value null for the rest.
  assert.equal(pageGet('get-zoom', owner, { webContentsId: 5 }), 1.25);
  assert.equal(pageGet('get-zoom', other, { webContentsId: 5 }), null, "another window's tab");
  assert.equal(pageGet('get-zoom', owner, { webContentsId: 77 }), null, 'a non-tab webContents');
  // toggle-devtools / is-devtools-open: refusal value false.
  assert.equal(pageGet('toggle-devtools', owner, { webContentsId: 5 }), true);
  assert.equal(pageGet('toggle-devtools', other, { webContentsId: 5 }), false);
  assert.equal(pageGet('toggle-devtools', owner, { webContentsId: 77 }), false);
  assert.equal(pageGet('is-devtools-open', owner, { webContentsId: 5 }), true);
  assert.equal(pageGet('is-devtools-open', other, { webContentsId: 5 }), false);
  assert.equal(pageGet('is-devtools-open', owner, { webContentsId: 77 }), false);
  assert.deepEqual(h.events, [['devtools']], 'only the owner toggled DevTools');
  h.events.length = 0;

  // zoom-apply / print / rescan-media (one-way): effects only for the owner.
  h.listeners.get('zoom-apply')(owner, { webContentsId: 5, action: 'in' });
  h.listeners.get('zoom-apply')(other, { webContentsId: 5, action: 'in' });
  h.listeners.get('zoom-apply')(owner, { webContentsId: 77, action: 'in' });
  h.listeners.get('print')(owner, { webContentsId: 5 });
  h.listeners.get('print')(other, { webContentsId: 5 });
  h.listeners.get('print')(owner, { webContentsId: 77 });
  h.listeners.get('rescan-media')(owner, { wcId: 5 });
  h.listeners.get('rescan-media')(other, { wcId: 5 });
  h.listeners.get('rescan-media')(owner, { wcId: 77 });
  assert.deepEqual(h.events, [['zoom', 'in'], ['print'], ['guest-send', 'rescan-media']]);
  h.events.length = 0;

  // page-context-correct / page-context-action (invoke, refusal undefined).
  await pageGet('page-context-correct', owner, { webContentsId: 5, word: 'fixed' });
  assert.equal(await pageGet('page-context-correct', other, { webContentsId: 5, word: 'x' }), undefined);
  assert.equal(await pageGet('page-context-correct', owner, { webContentsId: 77, word: 'x' }), undefined);
  await pageGet('page-context-action', owner, { webContentsId: 5, action: 'copy' });
  assert.equal(await pageGet('page-context-action', other, { webContentsId: 5, action: 'cut' }), undefined);
  assert.equal(await pageGet('page-context-action', owner, { webContentsId: 77, action: 'cut' }), undefined);
  assert.deepEqual(h.events, [['focus'], ['correct', 'fixed'], ['copy']]);
  h.events.length = 0;

  // privacy-*: real work for the owner; the empty / no-tab shapes for everyone else.
  const cookies = await pageGet('privacy-cookies', owner, { webContentsId: 5, url: 'https://example.com/' });
  assert.equal(cookies.firstParty, 'example.com', 'the owner reads its own tab');
  const empty = { firstParty: null, first: 0, third: 0, total: 0, list: [] };
  assert.deepEqual(await pageGet('privacy-cookies', other, { webContentsId: 5 }), empty);
  assert.deepEqual(await pageGet('privacy-cookies', owner, { webContentsId: 77 }), empty);
  assert.deepEqual(await pageGet('privacy-clear-cookies', owner, { webContentsId: 5, scope: 'all' }), { removed: 0 });
  assert.deepEqual(await pageGet('privacy-clear-cookies', other, { webContentsId: 5, scope: 'all' }), { removed: 0 });
  assert.deepEqual(await pageGet('privacy-clear-storage', owner, { webContentsId: 5, url: 'https://example.com/' }), {
    ok: true,
    origin: 'https://example.com'
  });
  const noTab = { ok: false, error: 'no-tab' };
  assert.deepEqual(
    await pageGet('privacy-clear-storage', other, { webContentsId: 5, url: 'https://example.com/' }),
    noTab
  );
  assert.deepEqual(
    await pageGet('privacy-clear-storage', owner, { webContentsId: 77, url: 'https://example.com/' }),
    noTab
  );
  assert.deepEqual(
    h.events,
    [['clear-storage', { origin: 'https://example.com' }]],
    'storage cleared once, for the owner'
  );
});

test('NF7: a refused tab-id channel with a hostile or missing payload never throws', async () => {
  const h = makeHarness();
  const owner = eventFrom(h.chromeSender);
  for (const ch of [
    'get-zoom',
    'toggle-devtools',
    'is-devtools-open',
    'page-context-correct',
    'page-context-action',
    'privacy-cookies',
    'privacy-clear-cookies',
    'privacy-clear-storage'
  ]) {
    for (const payload of [undefined, null, 5, 'x', [], { webContentsId: '5' }, { webContentsId: {} }]) {
      await assert.doesNotReject(async () => h.handlers.get(ch)(owner, payload), `${ch} ${JSON.stringify(payload)}`);
    }
  }
  for (const ch of ['zoom-apply', 'print', 'rescan-media']) {
    for (const payload of [undefined, null, 5, 'x', [], { webContentsId: '5', wcId: '5' }]) {
      assert.doesNotThrow(() => h.listeners.get(ch)(owner, payload), `${ch} ${JSON.stringify(payload)}`);
    }
  }
});

// ---------------------------------------------------------------------------
// `identity-new` shares tab-create's partition predicate: it can neither create nor wipe an
// arbitrary partition.
// ---------------------------------------------------------------------------

test('identity-new: a registered jar partition and a burner by exact shape are wiped; anything else is refused before session.fromPartition', async () => {
  const h = makeHarness();
  const owner = eventFrom(h.chromeSender);
  assert.deepEqual(await h.handlers.get('identity-new')(owner, { partition: 'persist:personal' }), { ok: true });
  assert.deepEqual(await h.handlers.get('identity-new')(owner, { partition: 'burner:12345' }), { ok: true });
  assert.deepEqual(h.events.filter((e) => e[0] === 'clear-storage').length, 2);
  h.events.length = 0;
  for (const partition of [
    'persist:attacker',
    'burner:abc',
    'burner:',
    'burner:1x',
    'goldfinch-internal',
    'internal',
    '',
    null,
    undefined,
    5,
    {}
  ]) {
    assert.deepEqual(await h.handlers.get('identity-new')(owner, { partition }), { ok: false }, String(partition));
  }
  assert.deepEqual(await h.handlers.get('identity-new')(owner, undefined), { ok: false });
  assert.deepEqual(h.events, [], 'nothing was cleared for any refused partition');
  // a non-chrome sender is refused by the gate
  assert.deepEqual(await h.handlers.get('identity-new')(guestEvent(5), { partition: 'persist:personal' }), {
    ok: false
  });
  assert.deepEqual(h.events, []);
});

// ---------------------------------------------------------------------------
// The synchronous guest-boot channels ALWAYS answer, and the page-influenced channels refuse
// whoever is not a tab main frame.
// ---------------------------------------------------------------------------

test('shields-farble (sync, popups on): a tab and a popup get the session seed; a refused sender gets farbling ON with a per-call random seed, never the session seed', () => {
  let n = 0;
  let calls = 0;
  const h = makeHarness({
    random: () => ++calls / 100, // every draw differs: the session seed, then each refusal's own
    popupRegistry: { getByWcId: (id) => (id === 42 ? { popupWcId: 42 } : null) }
  });
  const fn = h.listeners.get('shields-farble');
  const tab = { ...guestEvent(5), sender: { id: 5, mainFrame: { frameTreeNodeId: 1 }, session: h.wc.session } };
  fn(tab, 'https://example.com/');
  assert.deepEqual(tab.returnValue, { farble: true, seed: tab.returnValue.seed });
  assert.equal(typeof tab.returnValue.seed, 'number');
  const sessionSeed = tab.returnValue.seed;
  const popup = { ...guestEvent(42), sender: { id: 42, mainFrame: { frameTreeNodeId: 1 }, session: h.wc.session } };
  fn(popup, 'https://example.com/');
  assert.equal(popup.returnValue.seed, sessionSeed, 'a popup in the same session shares the session seed');
  // refused senders: not a tab or popup (id 99), a subframe of a real tab, and a null frame
  const refusals = [
    { ...guestEvent(99), sender: { id: 99, mainFrame: { frameTreeNodeId: 1 }, session: h.wc.session } },
    {
      ...guestEvent(5, { senderFrame: { frameTreeNodeId: 3 } }),
      sender: { id: 5, mainFrame: { frameTreeNodeId: 1 }, session: h.wc.session }
    },
    {
      ...guestEvent(5, { senderFrame: null }),
      sender: { id: 5, mainFrame: { frameTreeNodeId: 1 }, session: h.wc.session }
    }
  ];
  for (const ev of refusals) {
    fn(ev, 'https://example.com/');
    assert.ok('returnValue' in ev, 'a refused synchronous call is STILL answered (the page load must not block)');
    assert.equal(ev.returnValue.farble, true, 'farbling stays ON');
    assert.equal(typeof ev.returnValue.seed, 'number');
    assert.notEqual(ev.returnValue.seed, sessionSeed, "never the session's seed");
    n++;
  }
  assert.equal(n, 3);
});

test('shields-farble (sync): a throwing handler still answers (farble on, random seed)', () => {
  const h = makeHarness();
  const ev = { ...guestEvent(5), sender: { id: 5, mainFrame: { frameTreeNodeId: 1 }, session: h.wc.session } };
  h.listeners.get('shields-farble')(ev, { not: 'a string' }); // hostnameOf(new URL(object)) throws
  assert.equal(ev.returnValue.farble, true);
  assert.equal(typeof ev.returnValue.seed, 'number');
});

test('vault-eligible (sync, popups on): always answers; a refused sender is "not eligible, locked"', () => {
  const h = makeHarness({ popupRegistry: { getByWcId: (id) => (id === 42 ? { popupWcId: 42 } : null) } });
  const fn = h.listeners.get('vault-eligible');
  const popup = guestEvent(42);
  fn(popup);
  assert.deepEqual(
    popup.returnValue,
    { eligible: false, unlocked: false },
    'a popup is admitted (and is never eligible)'
  );
  const refused = guestEvent(99);
  fn(refused);
  assert.deepEqual(refused.returnValue, { eligible: false, unlocked: false });
  const sub = guestEvent(5, { senderFrame: { frameTreeNodeId: 9 } });
  fn(sub);
  assert.deepEqual(sub.returnValue, { eligible: false, unlocked: false });
  assert.ok('returnValue' in refused && 'returnValue' in sub);
});

test('guest-tab-boundary: the ACTIVE tab (web or internal) forwards; a background tab, a subframe and a non-tab move nothing (NF3)', () => {
  const h = makeHarness();
  h.ownerRecord.tabViews = new Map([
    [5, { trusted: false }],
    [8, { trusted: false }],
    [9, { trusted: true }]
  ]);
  h.ownerRecord.activeTabWcId = 5;
  h.listeners.get('guest-tab-boundary')(guestEvent(5), { direction: 'forward' });
  h.listeners.get('guest-tab-boundary')(guestEvent(8), { direction: 'forward' }); // background
  h.listeners.get('guest-tab-boundary')(guestEvent(5, { senderFrame: { frameTreeNodeId: 4 } }), {
    direction: 'forward'
  });
  h.listeners.get('guest-tab-boundary')(guestEvent(99), { direction: 'forward' });
  assert.deepEqual(
    h.events,
    [['chrome-send', 'tab-boundary', { direction: 'forward' }]],
    'exactly the active tab forwarded'
  );
});

test('every page-influenced tab-guest channel refuses a non-tab sender and a subframe, with no side effect', () => {
  const h = makeHarness();
  const channels = [
    ['guest-vault-gesture', {}],
    ['guest-vault-icon-menu', undefined],
    ['guest-vault-capture', { password: Uint8Array.from([1]) }],
    ['guest-vault-capture-card', { number: Uint8Array.from([1]) }],
    ['guest-vault-capture-identity', {}],
    ['guest-vault-gesture-settle', undefined],
    ['guest-media-list', ['x']],
    ['guest-privacy-fp', { canvas: 1 }],
    ['guest-window-close', { historyLength: 1 }]
  ];
  for (const [ch, payload] of channels) {
    h.listeners.get(ch)(guestEvent(99), payload);
    h.listeners.get(ch)(guestEvent(5, { senderFrame: { frameTreeNodeId: 8 } }), payload);
    h.listeners.get(ch)(guestEvent(5, { senderFrame: null }), payload);
    h.listeners.get(ch)({ sender: h.chromeSender, senderFrame: {} }, payload);
  }
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.human.captures, []);
  assert.deepEqual(h.iconMenuCalls, []);
  assert.deepEqual(h.chromeForTabCalls, []);
});

test('guest-privacy-fp forwards only a validated object: fixed keys, non-negative integers, clamped; anything else is dropped whole (NF8)', () => {
  const h = makeHarness();
  const send = (payload) => h.listeners.get('guest-privacy-fp')(guestEvent(5), payload);
  send({ canvas: 2, webgl: 0, audio: 1 });
  send({ canvas: 3 }); // partial: the absent keys are 0
  send({ canvas: 10 ** 9, webgl: 1, audio: 1 }); // clamped
  assert.deepEqual(h.events, [
    ['chrome-send', 'tab-privacy-fp', { wcId: 5, fpCounts: { canvas: 2, webgl: 0, audio: 1 } }],
    ['chrome-send', 'tab-privacy-fp', { wcId: 5, fpCounts: { canvas: 3, webgl: 0, audio: 0 } }],
    ['chrome-send', 'tab-privacy-fp', { wcId: 5, fpCounts: { canvas: 100000, webgl: 1, audio: 1 } }]
  ]);
  h.events.length = 0;
  for (const bad of [
    undefined,
    null,
    7,
    'x',
    [],
    {},
    { canvas: -1 },
    { canvas: 1.5 },
    { canvas: NaN },
    { canvas: Infinity },
    { canvas: '1' },
    { canvas: 1, extra: 1 },
    { __proto__: { canvas: 1 } },
    { canvas: 1, webgl: 1, audio: 1, evil: '<img onerror=x>' },
    Object.create({ canvas: 1 })
  ]) {
    send(bad);
  }
  assert.deepEqual(h.events, [], 'every malformed payload was dropped whole');
});
