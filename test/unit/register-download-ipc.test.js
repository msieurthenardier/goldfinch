'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { registerDownloadIpc } = require('../../src/main/register-download-ipc');

function makeHarness() {
  const handlers = new Map();
  const internal = new Map();
  const events = [];
  const chromeSender = {};
  const downloader = { downloadURL: (url) => events.push(['download', url]) };
  const record = { id: 1, url: 'https://retry.example/file', savePath: '/trusted/file' };
  const manager = {
    listAll: () => [record],
    register: () => 1,
    update: (...args) => events.push(['update', ...args]),
    finalize: (...args) => events.push(['finalize', ...args]),
    remove: (id) => events.push(['remove', id]),
    clear: () => events.push(['clear']),
  };
  const { wireDownloadHandler } = registerDownloadIpc({
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
    webContents: { fromId: (id) => id === 9 ? downloader : null },
    registry: {
      getWindowForChrome: (sender) => sender === chromeSender
        ? { activeTabWcId: null, win: { id: 1 }, chromeView: { webContents: downloader } }
        : null,
      getLastFocused: () => null,
    },
    getTabContents: () => null,
    path,
    fs: { existsSync: () => false },
    sanitizeFilename: (name) => name,
    isWithinDir: () => true,
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['/approved'] }) },
    shell: {
      openPath: (savePath) => { events.push(['open', savePath]); return ''; },
      showItemInFolder: (savePath) => events.push(['show', savePath]),
    },
    getDownloadsPath: () => '/downloads',
    getDownloadsManager: () => manager,
    buildRegisterRecord: () => ({}),
    buildProgressPayload: (_item, meta) => ({ ...meta, received: 1, total: 2, paused: false }),
    buildDonePayload: (_item, meta) => ({ ...meta, savePath: '/trusted/file' }),
    broadcast: (channel, payload) => events.push(['broadcast', channel, payload]),
    registerInternalHandler: (_ipc, channel, fn) => internal.set(channel, fn),
    getChromeContents: () => ({ isDestroyed: () => false, downloadURL: (url) => events.push(['retry', url]) }),
    now: () => 10,
    logger: { warn: (...args) => events.push(['warn', ...args]) },
  });
  return { handlers, internal, events, chromeSender, wireDownloadHandler };
}

test('download directory authority is minted by the chooser and enforced by download-media', async () => {
  const h = makeHarness();
  assert.deepEqual([...h.handlers.keys()].sort(), ['choose-download-dir', 'download-media', 'show-item-in-folder']);
  assert.deepEqual([...h.internal.keys()].sort(), ['internal-downloads-action', 'internal-downloads-clear', 'internal-downloads-list']);

  const payload = { webContentsId: 9, url: 'https://example/file', suggestedName: 'file', saveDir: '/approved' };
  assert.deepEqual(await h.handlers.get('download-media')({ sender: h.chromeSender }, payload), {
    ok: false, error: 'Download directory not approved.'
  });
  assert.equal(await h.handlers.get('choose-download-dir')({ sender: h.chromeSender }), '/approved');
  assert.deepEqual(await h.handlers.get('download-media')({ sender: h.chromeSender }, payload), { ok: true });
  assert.deepEqual(h.events, [['download', 'https://example/file']]);
});

test('downloads-page action allowlist resolves open/show paths only from the manager', async () => {
  const h = makeHarness();
  assert.deepEqual(await h.internal.get('internal-downloads-action')({}, {
    id: 1, action: 'delete-everything', savePath: '/attacker/path'
  }), { ok: false });
  assert.deepEqual(h.events, []);

  assert.deepEqual(await h.internal.get('internal-downloads-action')({}, {
    id: 1, action: 'open', savePath: '/attacker/path'
  }), { ok: true, error: undefined });
  assert.deepEqual(h.events, [['open', '/trusted/file']]);
  h.events.length = 0;
  assert.deepEqual(await h.internal.get('internal-downloads-action')({}, {
    id: 1, action: 'show', savePath: '/attacker/path'
  }), { ok: true });
  assert.deepEqual(h.events, [['show', '/trusted/file']]);
});
