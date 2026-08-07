'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerOverlayIpc } = require('../../src/main/register-overlay-ipc');

function makeIpc() {
  const listeners = new Map();
  return {
    listeners,
    on(channel, fn) { assert.equal(listeners.has(channel), false); listeners.set(channel, fn); },
  };
}

test('overlay registrar preserves sender roles, token checks, and close-before-activate ordering', () => {
  const ipcMain = makeIpc();
  const events = [];
  const chrome = { send(channel, payload) { events.push(['send', channel, payload]); } };
  const chromeSender = {};
  const sheetSender = { isDestroyed: () => false };
  const findSender = { isDestroyed: () => false };
  const guest = { webContents: { isDestroyed: () => false }, getBounds: () => ({ x: 1, y: 2, width: 3, height: 4 }) };
  const sheet = {
    getView: () => ({ webContents: sheetSender }),
    getCurrentMenu: () => ({ token: 7, menuType: 'kebab' }),
    openMenu: (payload, attachment) => events.push(['open', payload, attachment.bounds]),
    closeMenuOverlay: (reason, token) => events.push(['close', reason, token]),
  };
  const findOverlay = {
    getView: () => ({ webContents: findSender }),
    getSessionTabWcId: () => 42,
    openSession: (...args) => events.push(['find-open', ...args]),
    closeSession: (opts) => events.push(['find-close', opts]),
    query: (payload) => events.push(['find-query', payload]),
  };
  const rec = {
    win: { contentView: {} }, chromeView: { webContents: chrome }, sheet, findOverlay,
    activeTabWcId: 42, tabViews: new Map([[42, { view: guest }]]),
    tearoffOverlay: {
      show: (...args) => events.push(['tear-show', ...args]),
      setPosition: (...args) => events.push(['tear-move', ...args]),
      hide: () => events.push(['tear-hide']),
    },
  };
  const registry = {
    records: () => [rec],
    getWindowForChrome: (sender) => sender === chromeSender ? rec : null,
    getWindowForGuest: (wcId) => wcId === 42 ? rec : null,
  };

  registerOverlayIpc({
    ipcMain, registry,
    chromeForAttachment: () => chrome,
    chromeForTab: () => chrome,
    sanitizeActivatedValue: (value) => typeof value === 'string' && value.length <= 24 ? value : undefined,
  });

  assert.deepEqual([...ipcMain.listeners.keys()].sort(), [
    'find-overlay:close', 'find-overlay:open', 'find-overlay:query',
    'menu-overlay:activated', 'menu-overlay:close', 'menu-overlay:dismissed', 'menu-overlay:open',
    'menu-overlay:overflow-drop', // M15 F3 Leg 5a
    'menu-overlay:refocus', // keep-focus re-grab
    'menu-overlay:sheet-drag', // M15 F3 Leg 5b
    'tearoff-overlay:hide', 'tearoff-overlay:move', 'tearoff-overlay:show',
  ]);

  ipcMain.listeners.get('menu-overlay:open')({ sender: {} }, { menuType: 'bad' });
  assert.deepEqual(events, []);
  ipcMain.listeners.get('menu-overlay:open')({ sender: chromeSender }, { menuType: 'kebab' });
  assert.deepEqual(events.shift(), ['open', { menuType: 'kebab' }, { x: 1, y: 2, width: 3, height: 4 }]);

  ipcMain.listeners.get('menu-overlay:activated')({ sender: sheetSender }, { id: 'settings', token: 6 });
  assert.deepEqual(events, []);
  ipcMain.listeners.get('menu-overlay:activated')({ sender: sheetSender }, { id: 'settings', token: 7, value: 'ok' });
  assert.deepEqual(events, [
    ['close', 'activated', 7],
    ['send', 'menu-overlay-activated', { menuType: 'kebab', id: 'settings', value: 'ok' }],
  ]);
  events.length = 0;

  ipcMain.listeners.get('find-overlay:open')({ sender: chromeSender }, { wcId: 42, findText: 9 });
  ipcMain.listeners.get('find-overlay:query')({ sender: findSender }, { text: 'x' });
  ipcMain.listeners.get('find-overlay:close')({ sender: findSender });
  assert.deepEqual(events, [
    ['find-open', 42, ''],
    ['find-query', { text: 'x' }],
    ['send', 'find-overlay-closed', { wcId: 42 }],
    ['find-close', { refocusGuest: true }],
  ]);
});

// ---------------------------------------------------------------------------
// M14 F1 L3 (flight DD4): cert-picker selection routing in the activated
// handler — MAIN-SIDE, LEDGER-FIRST. The review-critical detail: the
// certSelectFromSheet call MUST precede closeMenuOverlay('activated'), because
// that close maps 'activated' to resolution-cancel in the store — without
// ledger-first ordering every selection would resolve as a cancel.
// ---------------------------------------------------------------------------

function makeCertHarness({ menuType = 'cert-picker', certSelectFromSheet } = {}) {
  const ipcMain = makeIpc();
  const events = [];
  const chrome = { send(channel, payload) { events.push(['send', channel, payload]); } };
  const sheetSender = { isDestroyed: () => false };
  const sheet = {
    getView: () => ({ webContents: sheetSender }),
    getCurrentMenu: () => ({ token: 7, menuType }),
    closeMenuOverlay: (reason, token) => events.push(['close', reason, token]),
  };
  const rec = { win: {}, sheet };
  const registry = { records: () => [rec], getWindowForChrome: () => null };
  registerOverlayIpc({
    ipcMain, registry,
    chromeForAttachment: () => chrome,
    chromeForTab: () => chrome,
    sanitizeActivatedValue: () => undefined,
    certSelectFromSheet: certSelectFromSheet === undefined
      ? (record, index) => events.push(['cert-select', record, index])
      : certSelectFromSheet,
  });
  return { ipcMain, events, rec, sheetSender };
}

test('cert-picker activation: certSelectFromSheet runs BEFORE the activated close, with the parsed index; ch-6 still forwards', () => {
  const h = makeCertHarness();
  h.ipcMain.listeners.get('menu-overlay:activated')({ sender: h.sheetSender }, { id: 'cert:2', token: 7 });
  assert.deepEqual(h.events, [
    ['cert-select', h.rec, 2], // LEDGER FIRST —
    ['close', 'activated', 7], // — the trailing close is the store's exactly-once no-op
    ['send', 'menu-overlay-activated', { menuType: 'cert-picker', id: 'cert:2' }],
  ]);
});

test("cert-picker cancel row / malformed ids skip certSelectFromSheet — the close's resolution-cancel handles them", () => {
  for (const id of ['cancel', 'cert:', 'cert:-1', 'cert:x', 'cert:1.5', 'pick:1']) {
    const h = makeCertHarness();
    h.ipcMain.listeners.get('menu-overlay:activated')({ sender: h.sheetSender }, { id, token: 7 });
    assert.deepEqual(h.events, [
      ['close', 'activated', 7],
      ['send', 'menu-overlay-activated', { menuType: 'cert-picker', id }],
    ], `id '${id}' must not reach certSelectFromSheet`);
  }
});

test('non-cert-picker activations never call certSelectFromSheet, even for a cert-shaped id', () => {
  const h = makeCertHarness({ menuType: 'vault-picker' });
  h.ipcMain.listeners.get('menu-overlay:activated')({ sender: h.sheetSender }, { id: 'cert:0', token: 7 });
  assert.deepEqual(h.events, [
    ['close', 'activated', 7],
    ['send', 'menu-overlay-activated', { menuType: 'vault-picker', id: 'cert:0' }],
  ]);
});

test('the activated handler tolerates an absent certSelectFromSheet injection (offline overlay tests)', () => {
  const h = makeCertHarness({ certSelectFromSheet: null });
  h.ipcMain.listeners.get('menu-overlay:activated')({ sender: h.sheetSender }, { id: 'cert:0', token: 7 });
  assert.deepEqual(h.events, [
    ['close', 'activated', 7],
    ['send', 'menu-overlay-activated', { menuType: 'cert-picker', id: 'cert:0' }],
  ]);
});

// ---------------------------------------------------------------------------
// M15 F1 Leg 2 (flight DD4): the bookmark-edit sheet's dedicated submit
// channel — sender identity, token freshness, per-field validation,
// close-only-on-success, chromeForAttachment forward. `action:'remove'`
// bypasses field validation entirely.
// ---------------------------------------------------------------------------

function makeIpcWithHandle() {
  const listeners = new Map();
  const handlers = new Map();
  return {
    listeners,
    handlers,
    on(channel, fn) { assert.equal(listeners.has(channel), false); listeners.set(channel, fn); },
    handle(channel, fn) { assert.equal(handlers.has(channel), false); handlers.set(channel, fn); },
  };
}

// HAT FIX 1 (M15 F2 Leg 4 HAT fixes — H5) added `list` (the bookmarks store's
// read-only `list(jarId)` binding, optional — offline overlay tests omit it
// exactly as before) and `jarId` (the current menu's captured jar, threaded
// through getCurrentMenu() — omitted, as before HAT fix 1, when a test wants
// the "no jarId ever captured" shape).
function makeBookmarkEditHarness({ validateBookmarkEdit, list, jarId } = {}) {
  const ipcMain = makeIpcWithHandle();
  const events = [];
  const chrome = { send(channel, payload) { events.push(['send', channel, payload]); } };
  const sheetSender = { isDestroyed: () => false };
  const sheet = {
    getView: () => ({ webContents: sheetSender }),
    getCurrentMenu: () => ({ token: 7, menuType: 'bookmark-edit', ...(jarId !== undefined ? { jarId } : {}) }),
    closeMenuOverlay: (reason, token) => events.push(['close', reason, token]),
  };
  const rec = { win: {}, sheet };
  const registry = { records: () => [rec], getWindowForChrome: () => null };
  registerOverlayIpc({
    ipcMain, registry,
    chromeForAttachment: () => chrome,
    chromeForTab: () => chrome,
    sanitizeActivatedValue: () => undefined,
    validateBookmarkEdit: validateBookmarkEdit === undefined
      ? ({ name, url }) => (name === 'Example' && url === 'https://example.com/'
        ? { ok: true, name, url }
        : { ok: false })
      : validateBookmarkEdit,
    ...(list !== undefined ? { list } : {}),
  });
  return { ipcMain, events, rec, sheetSender };
}

test('the registrar never registers menu-overlay:bookmark-edit-submit when validateBookmarkEdit is absent (offline overlay tests)', () => {
  const ipcMain = makeIpcWithHandle();
  const registry = { records: () => [], getWindowForChrome: () => null };
  registerOverlayIpc({
    ipcMain, registry,
    chromeForAttachment: () => null,
    chromeForTab: () => null,
    sanitizeActivatedValue: () => undefined,
  });
  assert.equal(ipcMain.handlers.has('menu-overlay:bookmark-edit-submit'), false);
});

test('bookmark-edit-submit: valid save fields close the sheet and forward {id, action:"save", name, url} to the chrome', async () => {
  const h = makeBookmarkEditHarness();
  const res = await h.ipcMain.handlers.get('menu-overlay:bookmark-edit-submit')(
    { sender: h.sheetSender },
    { token: 7, id: 'bm-1', action: 'save', name: 'Example', url: 'https://example.com/' }
  );
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(h.events, [
    ['close', 'activated', 7],
    ['send', 'bookmark-edit-submit', { id: 'bm-1', action: 'save', name: 'Example', url: 'https://example.com/' }],
  ]);
});

test('bookmark-edit-submit: a validation failure keeps the sheet open — no close, no forward', async () => {
  const h = makeBookmarkEditHarness();
  const res = await h.ipcMain.handlers.get('menu-overlay:bookmark-edit-submit')(
    { sender: h.sheetSender },
    { token: 7, id: 'bm-1', action: 'save', name: '', url: 'https://example.com/' }
  );
  assert.deepEqual(res, { ok: false });
  assert.deepEqual(h.events, []);
});

test('bookmark-edit-submit: action "remove" skips field validation entirely and always closes-and-forwards', async () => {
  const h = makeBookmarkEditHarness({
    validateBookmarkEdit: () => { throw new Error('must not be called for remove'); },
  });
  const res = await h.ipcMain.handlers.get('menu-overlay:bookmark-edit-submit')(
    { sender: h.sheetSender },
    { token: 7, id: 'bm-1', action: 'remove' }
  );
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(h.events, [
    ['close', 'activated', 7],
    ['send', 'bookmark-edit-submit', { id: 'bm-1', action: 'remove' }],
  ]);
});

test('bookmark-edit-submit: a stale token is rejected — no close, no forward', async () => {
  const h = makeBookmarkEditHarness();
  const res = await h.ipcMain.handlers.get('menu-overlay:bookmark-edit-submit')(
    { sender: h.sheetSender },
    { token: 6, id: 'bm-1', action: 'save', name: 'Example', url: 'https://example.com/' }
  );
  assert.deepEqual(res, { ok: false });
  assert.deepEqual(h.events, []);
});

test('bookmark-edit-submit: a malformed payload (non-string id / non-number token) is rejected', async () => {
  const h = makeBookmarkEditHarness();
  const handler = h.ipcMain.handlers.get('menu-overlay:bookmark-edit-submit');
  assert.deepEqual(await handler({ sender: h.sheetSender }, { token: 7, id: 42, action: 'remove' }), { ok: false });
  assert.deepEqual(await handler({ sender: h.sheetSender }, { token: '7', id: 'bm-1', action: 'remove' }), { ok: false });
  assert.deepEqual(await handler({ sender: h.sheetSender }, null), { ok: false });
  assert.deepEqual(h.events, []);
});

test('bookmark-edit-submit: an unrecognized sender resolves { ok:false } (recordForSheetSender fails closed)', async () => {
  const h = makeBookmarkEditHarness();
  const res = await h.ipcMain.handlers.get('menu-overlay:bookmark-edit-submit')(
    { sender: {} },
    { token: 7, id: 'bm-1', action: 'remove' }
  );
  assert.deepEqual(res, { ok: false });
  assert.deepEqual(h.events, []);
});

// ---------------------------------------------------------------------------
// HAT FIX 1 (M15 F2 Leg 4 HAT fixes — H5): the pre-close store consult.
// duplicate-url and not-found now reject BEFORE the sheet closes (instead of
// closing/forwarding and surfacing an architecturally invisible post-close
// chrome toast). Gated on the optional `list` injection.
// ---------------------------------------------------------------------------

test('bookmark-edit-submit: with no `list` injected, save/remove succeed with zero store consultation (offline overlay shape, unchanged by HAT fix 1)', async () => {
  const h = makeBookmarkEditHarness();
  const saveRes = await h.ipcMain.handlers.get('menu-overlay:bookmark-edit-submit')(
    { sender: h.sheetSender },
    { token: 7, id: 'bm-1', action: 'save', name: 'Example', url: 'https://example.com/' }
  );
  assert.deepEqual(saveRes, { ok: true });
  const removeRes = await h.ipcMain.handlers.get('menu-overlay:bookmark-edit-submit')(
    { sender: h.sheetSender },
    { token: 7, id: 'bm-1', action: 'remove' }
  );
  assert.deepEqual(removeRes, { ok: true });
});

test('bookmark-edit-submit: a same-jar duplicate URL on save rejects {ok:false, reason:"duplicate-url"} — no close, no forward', async () => {
  const rows = [
    { id: 'bm-1', url: 'https://old.example.com/' },
    { id: 'bm-2', url: 'https://example.com/' },
  ];
  const h = makeBookmarkEditHarness({ jarId: 'work', list: (jid) => (jid === 'work' ? rows : []) });
  const res = await h.ipcMain.handlers.get('menu-overlay:bookmark-edit-submit')(
    { sender: h.sheetSender },
    { token: 7, id: 'bm-1', action: 'save', name: 'Example', url: 'https://example.com/' }
  );
  assert.deepEqual(res, { ok: false, reason: 'duplicate-url' });
  assert.deepEqual(h.events, []);
});

test('bookmark-edit-submit: save keeps its OWN unchanged URL — matching only itself is not a duplicate', async () => {
  const rows = [{ id: 'bm-1', url: 'https://example.com/' }];
  const h = makeBookmarkEditHarness({ jarId: 'work', list: () => rows });
  const res = await h.ipcMain.handlers.get('menu-overlay:bookmark-edit-submit')(
    { sender: h.sheetSender },
    { token: 7, id: 'bm-1', action: 'save', name: 'Example', url: 'https://example.com/' }
  );
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(h.events, [
    ['close', 'activated', 7],
    ['send', 'bookmark-edit-submit', { id: 'bm-1', action: 'save', name: 'Example', url: 'https://example.com/' }],
  ]);
});

test('bookmark-edit-submit: the SAME URL bookmarked in a DIFFERENT jar does NOT trip duplicate-url (load-bearing for jar scoping)', async () => {
  const byJar = {
    work: [{ id: 'bm-1', url: 'https://old.example.com/' }],
    personal: [{ id: 'bm-9', url: 'https://example.com/' }], // same URL, different jar AND id
  };
  const h = makeBookmarkEditHarness({ jarId: 'work', list: (jid) => byJar[jid] || [] });
  const res = await h.ipcMain.handlers.get('menu-overlay:bookmark-edit-submit')(
    { sender: h.sheetSender },
    { token: 7, id: 'bm-1', action: 'save', name: 'Example', url: 'https://example.com/' }
  );
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(h.events, [
    ['close', 'activated', 7],
    ['send', 'bookmark-edit-submit', { id: 'bm-1', action: 'save', name: 'Example', url: 'https://example.com/' }],
  ]);
});

test('bookmark-edit-submit: save on a since-vanished id rejects {ok:false, reason:"not-found"} — no close, no forward', async () => {
  const h = makeBookmarkEditHarness({ jarId: 'work', list: () => [] });
  const res = await h.ipcMain.handlers.get('menu-overlay:bookmark-edit-submit')(
    { sender: h.sheetSender },
    { token: 7, id: 'bm-1', action: 'save', name: 'Example', url: 'https://example.com/' }
  );
  assert.deepEqual(res, { ok: false, reason: 'not-found' });
  assert.deepEqual(h.events, []);
});

test('bookmark-edit-submit: remove on a since-vanished id rejects {ok:false, reason:"not-found"} — no close, no forward (zero-consultation before HAT fix 1)', async () => {
  const h = makeBookmarkEditHarness({ jarId: 'work', list: () => [] });
  const res = await h.ipcMain.handlers.get('menu-overlay:bookmark-edit-submit')(
    { sender: h.sheetSender },
    { token: 7, id: 'bm-1', action: 'remove' }
  );
  assert.deepEqual(res, { ok: false, reason: 'not-found' });
  assert.deepEqual(h.events, []);
});

test('bookmark-edit-submit: remove of a row that still exists in its jar closes and forwards normally', async () => {
  const rows = [{ id: 'bm-1', url: 'https://example.com/' }];
  const h = makeBookmarkEditHarness({ jarId: 'work', list: () => rows });
  const res = await h.ipcMain.handlers.get('menu-overlay:bookmark-edit-submit')(
    { sender: h.sheetSender },
    { token: 7, id: 'bm-1', action: 'remove' }
  );
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(h.events, [
    ['close', 'activated', 7],
    ['send', 'bookmark-edit-submit', { id: 'bm-1', action: 'remove' }],
  ]);
});

test('bookmark-edit-submit: a current menu with no captured jarId normalizes to null for the store consult (never a bare `undefined`)', async () => {
  let seenJarId = 'unset';
  const h = makeBookmarkEditHarness({
    list: (jid) => { seenJarId = jid; return []; },
  });
  const res = await h.ipcMain.handlers.get('menu-overlay:bookmark-edit-submit')(
    { sender: h.sheetSender },
    { token: 7, id: 'bm-1', action: 'remove' }
  );
  assert.equal(seenJarId, null, 'a non-string jarId is normalized to null before reaching `list`');
  assert.deepEqual(res, { ok: false, reason: 'not-found' });
});

// ---------------------------------------------------------------------------
// M15 F3 Leg 5a (AC8/AC8b): the bookmarks-overflow DROP-INDEX channel.
//
// The sheet is ONE persistent document shared by every menuType, so this
// handler's guards are the whole of its safety. All three are asserted as
// PREDICATES here — sender identity, token freshness, AND the menuType — because
// this flight has recorded four separate findings of a handler that carried only
// the first two and would therefore accept a message while `vault-unlock` was on
// screen.
// ---------------------------------------------------------------------------

function makeOverflowDropHarness({ menuType = 'bookmarks-overflow', token = 7 } = {}) {
  const ipcMain = makeIpc();
  const events = [];
  const chrome = { send: (channel, payload) => events.push(['send', channel, payload]) };
  const sheetSender = { isDestroyed: () => false };
  const current = menuType == null ? null : { token, menuType };
  const sheet = {
    getView: () => ({ webContents: sheetSender }),
    getCurrentMenu: () => current,
    closeMenuOverlay: (reason, tok) => events.push(['close', reason, tok]),
  };
  const rec = { win: {}, sheet };
  const registry = { records: () => [rec], getWindowForChrome: () => null };
  registerOverlayIpc({
    ipcMain, registry,
    chromeForAttachment: () => chrome,
    chromeForTab: () => chrome,
    sanitizeActivatedValue: () => undefined,
  });
  return {
    events, sheetSender,
    fire: (sender, payload) => ipcMain.listeners.get('menu-overlay:overflow-drop')({ sender }, payload),
  };
}

test('Leg 5a AC8: a valid drop index CLOSES the sheet, then forwards the bare index to the owning chrome', () => {
  const h = makeOverflowDropHarness();
  h.fire(h.sheetSender, { token: 7, index: 2 });
  assert.deepEqual(h.events, [
    ['close', 'activated', 7],
    ['send', 'bookmark-overflow-drop', { index: 2 }],
  ]);
  // Nothing but the index crosses: no bookmark id, no url, no jar — the chrome
  // resolves all three from its own dragstart-time hold, so the message cannot
  // be aimed even if it were forged.
  assert.deepEqual(Object.keys(h.events[1][2]), ['index']);
});

test('Leg 5a AC8b: guard 1 — a NON-SHEET sender is refused', () => {
  const h = makeOverflowDropHarness();
  h.fire({}, { token: 7, index: 0 });
  h.fire(undefined, { token: 7, index: 0 });
  assert.deepEqual(h.events, []);
});

test('Leg 5a AC8b: guard 2 — a STALE open token is refused', () => {
  const h = makeOverflowDropHarness({ token: 7 });
  h.fire(h.sheetSender, { token: 6, index: 0 });
  assert.deepEqual(h.events, []);
});

test('Leg 5a AC8b: guard 3 — the menuType predicate. A drop index is REFUSED while vault-unlock is on screen', () => {
  for (const menuType of ['vault-unlock', 'kebab', 'bookmark-edit', 'auth-basic', 'cert-picker', 'page-context']) {
    const h = makeOverflowDropHarness({ menuType });
    h.fire(h.sheetSender, { token: 7, index: 0 });
    assert.deepEqual(h.events, [], `${menuType} must not be able to report an overflow drop index`);
  }
});

test('Leg 5a AC8b: guard 2 — a NULL current menu (sheet hidden / nothing open) is refused', () => {
  const h = makeOverflowDropHarness({ menuType: null });
  h.fire(h.sheetSender, { token: 7, index: 0 });
  assert.deepEqual(h.events, []);
});

test('Leg 5a AC8: the payload is VALIDATED-NO-OP on every malformed shape', () => {
  const h = makeOverflowDropHarness();
  for (const bad of [
    undefined, null, {}, { token: 7 }, { index: 0 }, { token: '7', index: 0 },
    { token: 7, index: -1 }, { token: 7, index: 1.5 }, { token: 7, index: '0' },
    { token: 7, index: null },
  ]) {
    h.fire(h.sheetSender, bad);
  }
  assert.deepEqual(h.events, []);
  h.fire(h.sheetSender, { token: 7, index: 0 }); // …and a good one still works
  assert.equal(h.events.length, 2);
});

// ---------------------------------------------------------------------------
// M15 F3 Leg 5b (AC3): the bookmarks-overflow DRAG-LIFECYCLE channel.
//
// The reverse direction — the sheet is the drag SOURCE, so these two signals are
// the entire bracket the chrome ever sees. `start` carries all three guards; `end`
// carries sender identity alone, and that asymmetry is asserted as a deliberate
// property below (see the handler's own note): by the time a sheet-sourced drag
// ends, the sheet has been blur-closed since the drag STARTED, so a token/menuType
// gate would refuse EVERY `end` and the clear signal would never arrive. The
// freshness check moves to the chrome, which still holds the live session.
// ---------------------------------------------------------------------------

function makeSheetDragHarness({ menuType = 'bookmarks-overflow', token = 7 } = {}) {
  const ipcMain = makeIpc();
  const events = [];
  const chrome = { send: (channel, payload) => events.push(['send', channel, payload]) };
  const sheetSender = { isDestroyed: () => false };
  const current = menuType == null ? null : { token, menuType };
  const sheet = {
    getView: () => ({ webContents: sheetSender }),
    getCurrentMenu: () => current,
    closeMenuOverlay: (reason, tok) => events.push(['close', reason, tok]),
  };
  const rec = { win: {}, sheet };
  const registry = { records: () => [rec], getWindowForChrome: () => null };
  registerOverlayIpc({
    ipcMain, registry,
    chromeForAttachment: () => chrome,
    chromeForTab: () => chrome,
    sanitizeActivatedValue: () => undefined,
  });
  return {
    events, sheetSender,
    fire: (sender, payload) => ipcMain.listeners.get('menu-overlay:sheet-drag')({ sender }, payload),
  };
}

test('Leg 5b AC3: a valid `start` forwards the bare phase/token/index — and does NOT close the sheet', () => {
  const h = makeSheetDragHarness();
  h.fire(h.sheetSender, { token: 7, phase: 'start', index: 2 });
  assert.deepEqual(h.events, [['send', 'bookmark-sheet-drag', { phase: 'start', token: 7, index: 2 }]]);
  // No close: the sheet's own blur close owns that, and closing from here would
  // race the drag session this message is announcing.
  assert.equal(h.events.some((e) => e[0] === 'close'), false);
  // Nothing but the phase, the token and the index crosses — no bookmark id, no
  // url, no jar. The chrome resolves those from its own overflow snapshot.
  assert.deepEqual(Object.keys(h.events[0][2]).sort(), ['index', 'phase', 'token']);
});

test('Leg 5b AC3: `start` guard 1 — a NON-SHEET sender is refused', () => {
  const h = makeSheetDragHarness();
  h.fire({}, { token: 7, phase: 'start', index: 0 });
  h.fire(undefined, { token: 7, phase: 'start', index: 0 });
  h.fire({}, { token: 7, phase: 'end' }); // …and `end` is sender-gated too
  assert.deepEqual(h.events, []);
});

test('Leg 5b AC3: `start` guard 2 — a STALE open token, and a NULL current menu, are refused', () => {
  const stale = makeSheetDragHarness({ token: 7 });
  stale.fire(stale.sheetSender, { token: 6, phase: 'start', index: 0 });
  assert.deepEqual(stale.events, []);

  const none = makeSheetDragHarness({ menuType: null });
  none.fire(none.sheetSender, { token: 7, phase: 'start', index: 0 });
  assert.deepEqual(none.events, []);
});

test('Leg 5b AC3: `start` guard 3 — the menuType predicate. No other menu may arm a bar-suppressing session', () => {
  for (const menuType of ['vault-unlock', 'kebab', 'bookmark-edit', 'auth-basic', 'cert-picker', 'page-context']) {
    const h = makeSheetDragHarness({ menuType });
    h.fire(h.sheetSender, { token: 7, phase: 'start', index: 0 });
    assert.deepEqual(h.events, [], `${menuType} must not be able to open a foreign-drag session`);
  }
});

test('Leg 5b AC3: `end` is forwarded even though the sheet has legitimately CLOSED — the asymmetry, deliberately', () => {
  // This is the case that occurs on every single real gesture: the sheet
  // blur-closes at drag START, so by dragend `getCurrentMenu()` is null. A
  // token/menuType gate here would refuse 100% of `end` signals and the chrome's
  // suppression would only ever be released by AC3's timer.
  const h = makeSheetDragHarness({ menuType: null });
  h.fire(h.sheetSender, { token: 7, phase: 'end' });
  assert.deepEqual(h.events, [['send', 'bookmark-sheet-drag', { phase: 'end', token: 7 }]]);
  // The token still crosses — the freshness check is not dropped, it MOVES to the
  // chrome, which matches it against its own live session.
  assert.equal(h.events[0][2].token, 7);
});

test('Leg 5b AC3: the payload is VALIDATED-NO-OP on every malformed shape, and on unknown phases', () => {
  const h = makeSheetDragHarness();
  for (const bad of [
    undefined, null, {}, { phase: 'start' }, { token: 7 }, { token: '7', phase: 'start', index: 0 },
    { token: 7, phase: 'start' }, { token: 7, phase: 'start', index: -1 },
    { token: 7, phase: 'start', index: 1.5 }, { token: 7, phase: 'start', index: '0' },
    { token: 7, phase: 'start', index: null },
    { token: 7, phase: 'cancel' }, { token: 7, phase: 'END' }, { token: 7, phase: 0 },
  ]) {
    h.fire(h.sheetSender, bad);
  }
  assert.deepEqual(h.events, []);
  h.fire(h.sheetSender, { token: 7, phase: 'start', index: 0 }); // …and a good one still works
  assert.equal(h.events.length, 1);
});

test('menu-overlay:refocus is sheet-sender-gated and never steals focus from another app', () => {
  const ipcMain = makeIpc();
  const events = [];
  const chromeSender = {};
  const sheetSender = { isDestroyed: () => false };
  let focused = true;
  let destroyed = false;
  const sheet = {
    getView: () => ({ webContents: sheetSender }),
    getCurrentMenu: () => ({ token: 1, menuType: 'vault-unlock' }),
    openMenu: () => {},
    closeMenuOverlay: () => {},
    reassertFocus: () => { events.push('reassert'); return true; },
  };
  const rec = {
    win: { contentView: {}, isDestroyed: () => destroyed, isFocused: () => focused },
    sheet, activeTabWcId: null, tabViews: new Map(),
  };
  const registry = {
    records: () => [rec],
    getWindowForChrome: (sender) => (sender === chromeSender ? rec : null),
    getWindowForGuest: () => null,
  };
  registerOverlayIpc({
    ipcMain, registry,
    chromeForAttachment: () => null,
    chromeForTab: () => null,
    sanitizeActivatedValue: () => undefined,
  });
  const refocus = ipcMain.listeners.get('menu-overlay:refocus');

  // A foreign sender (the chrome, a guest, anything that is not THIS sheet) is dropped.
  refocus({ sender: chromeSender });
  assert.deepEqual(events, [], 'only the sheet itself may ask for its focus back');

  refocus({ sender: sheetSender });
  assert.deepEqual(events, ['reassert'], 'the sheet is re-focused while its window is focused');
  events.length = 0;

  // A genuine app-switch blurs the window too: pulling focus back from ANOTHER
  // application would be far worse than the dismissal it prevents.
  focused = false;
  refocus({ sender: sheetSender });
  assert.deepEqual(events, [], 'no focus grab while the window is unfocused');

  // A window torn down between the report and its delivery must not throw.
  focused = true;
  destroyed = true;
  assert.doesNotThrow(() => refocus({ sender: sheetSender }));
  assert.deepEqual(events, []);
});
