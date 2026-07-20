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
  const record = {
    id: 1, url: 'https://retry.example/file', filename: 'file', savePath: '/trusted/file',
    state: 'completed', received: 10, total: 10, endTime: 9
  };
  const partialRecord = {
    id: 2, url: 'https://retry.example/partial', filename: 'partial',
    savePath: '/trusted/partial', state: 'progressing'
  };
  const cancelledRecord = {
    id: 3, url: 'https://retry.example/cancelled', filename: 'cancelled',
    savePath: null, state: 'cancelled', endTime: 8
  };
  const manager = {
    listAll: () => [record, partialRecord, cancelledRecord],
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
  return { handlers, internal, events, chromeSender, wireDownloadHandler, manager };
}

test('download directory authority is minted by the chooser and enforced by download-media', async () => {
  const h = makeHarness();
  assert.deepEqual([...h.handlers.keys()].sort(), ['choose-download-dir', 'download-media', 'downloads-snapshot', 'open-downloaded-file', 'reveal-downloaded-file', 'show-item-in-folder']);
  assert.deepEqual([...h.internal.keys()].sort(), ['internal-downloads-action', 'internal-downloads-clear', 'internal-downloads-list']);

  const payload = { webContentsId: 9, url: 'https://example/file', suggestedName: 'file', saveDir: '/approved' };
  assert.deepEqual(await h.handlers.get('download-media')({ sender: h.chromeSender }, payload), {
    ok: false, error: 'Download directory not approved.'
  });
  assert.equal(await h.handlers.get('choose-download-dir')({ sender: h.chromeSender }), '/approved');
  assert.deepEqual(await h.handlers.get('download-media')({ sender: h.chromeSender }, payload), { ok: true });
  assert.deepEqual(h.events, [['download', 'https://example/file']]);
});

test('downloads-snapshot is chrome-authorized and omits paths and URLs', async () => {
  const h = makeHarness();
  assert.deepEqual(await h.handlers.get('downloads-snapshot')({ sender: {} }), []);
  assert.deepEqual(await h.handlers.get('downloads-snapshot')({ sender: h.chromeSender }), [
    {
      id: 2, filename: 'partial', state: 'progressing', received: undefined,
      total: undefined, paused: undefined, endTime: null, active: true
    }, {
      id: 1, filename: 'file', state: 'completed', received: 10, total: 10,
      paused: undefined, endTime: 9, active: false
    }
  ]);
});

test('downloads-snapshot minimizes history to active rows plus the 25 newest completions', async () => {
  const h = makeHarness();
  h.manager.listAll = () => [
    { id: 100, filename: 'active', state: 'progressing', savePath: '/private/active' },
    ...Array.from({ length: 30 }, (_, i) => ({
      id: i + 1, filename: `done-${i + 1}`, state: 'completed', endTime: i + 1,
      savePath: `/private/done-${i + 1}`, url: `https://private/${i + 1}`
    })),
    { id: 200, filename: 'cancelled', state: 'cancelled', endTime: 31 },
  ];
  const rows = await h.handlers.get('downloads-snapshot')({ sender: h.chromeSender });
  assert.equal(rows.length, 26);
  assert.equal(rows[0].id, 100);
  assert.deepEqual(rows.slice(1).map((row) => row.id), Array.from({ length: 25 }, (_, i) => 30 - i));
  assert.equal(rows.some((row) => 'savePath' in row || 'url' in row), false);
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

test('open-downloaded-file resolves savePath by id from the manager, never a path arg', async () => {
  const h = makeHarness();
  // A bogus path passed as a second/third arg must be ignored — the handler
  // signature is (_event, id); savePath comes only from the resolved record.
  assert.deepEqual(await h.handlers.get('open-downloaded-file')({}, 1, '/attacker/path'), {
    ok: true, error: undefined
  });
  assert.deepEqual(h.events, [['open', '/trusted/file']]);
});

test('open-downloaded-file returns { ok: false } and does not open for an unknown id', async () => {
  const h = makeHarness();
  assert.deepEqual(await h.handlers.get('open-downloaded-file')({}, 999), { ok: false });
  assert.deepEqual(h.events, []);
});

test('open-downloaded-file gates on completion — an in-progress record is not opened', async () => {
  const h = makeHarness();
  assert.deepEqual(await h.handlers.get('open-downloaded-file')({}, 2), { ok: false });
  assert.deepEqual(h.events, []);
});

test('reveal-downloaded-file resolves savePath by id and shows it', async () => {
  const h = makeHarness();
  assert.deepEqual(await h.handlers.get('reveal-downloaded-file')({}, 1, '/attacker/path'), { ok: true });
  assert.deepEqual(h.events, [['show', '/trusted/file']]);
});

test('reveal-downloaded-file returns { ok: false } and does not show for an unknown id', async () => {
  const h = makeHarness();
  assert.deepEqual(await h.handlers.get('reveal-downloaded-file')({}, 999), { ok: false });
  assert.deepEqual(h.events, []);
});
