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
