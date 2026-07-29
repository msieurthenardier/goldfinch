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
