'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { registerDownloadIpc } = require('../../src/main/register-download-ipc');
const fsReal = require('node:fs');
const { eventFrom, makeTestGate } = require('../helpers/ipc-gate-fixture');
const { partitionFromStoragePath } = require('../../src/main/jar-data-helpers');

function makeHarness(opts = {}) {
  const handlers = new Map();
  const internal = new Map();
  const events = [];
  const chromeSender = {};
  const downloader = { id: 9, downloadURL: (url) => events.push(['download', url]) };
  let activeTabWcId = null;
  const record = {
    id: 1,
    url: 'https://retry.example/file',
    filename: 'file',
    savePath: '/trusted/file',
    state: 'completed',
    received: 10,
    total: 10,
    endTime: 9
  };
  const partialRecord = {
    id: 2,
    url: 'https://retry.example/partial',
    filename: 'partial',
    savePath: '/trusted/partial',
    state: 'progressing'
  };
  const cancelledRecord = {
    id: 3,
    url: 'https://retry.example/cancelled',
    filename: 'cancelled',
    savePath: null,
    state: 'cancelled',
    endTime: 8
  };
  const extraRecords = opts.records || [];
  const jarList = opts.jars || [{ id: 'work', partition: 'persist:container:work' }];
  const liveBurners = new Set(opts.liveBurners || []);
  const registerArgs = [];
  const sessionRequests = [];
  const manager = {
    listAll: () => [record, partialRecord, cancelledRecord, ...extraRecords],
    register: () => 1,
    update: (...args) => events.push(['update', ...args]),
    finalize: (...args) => events.push(['finalize', ...args]),
    remove: (id) => events.push(['remove', id]),
    clear: () => events.push(['clear'])
  };
  // One stable window record (identity matters: the gate's owning-chrome class compares the
  // sender's record with the tab's owner). Tab 9 is this window's genuine tab.
  const windowRecord = {
    get activeTabWcId() {
      return activeTabWcId;
    },
    win: { id: 1 },
    chromeView: { webContents: downloader }
  };
  const registry = {
    getWindowForChrome: (sender) => (sender === chromeSender ? windowRecord : null),
    getWindowForGuest: (id) => (id === 9 ? windowRecord : null),
    getLastFocused: () => null
  };
  const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn), on() {} };
  const { wireDownloadHandler, noteSessionPartition } = registerDownloadIpc({
    ipcMain,
    gate: makeTestGate({ ipcMain, registry }),
    registry,
    // getTabContents mirrors main.js's registry.getWindowForGuest contract
    // (design-review CONFIRMED): a real tab id (9) resolves to a live
    // contents; any non-tab id (the chrome id 42, a sheet/popup id, an
    // unknown id) resolves to null, never throws.
    getTabContents: (id) => (id === 9 ? downloader : null),
    path,
    fs: { existsSync: () => false },
    sanitizeFilename: (name) => name,
    isWithinDir: () => true,
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['/approved'] }) },
    shell: {
      openPath: (savePath) => {
        events.push(['open', savePath]);
        return '';
      },
      showItemInFolder: (savePath) => events.push(['show', savePath])
    },
    getDownloadsPath: () => '/downloads',
    getDownloadsManager: () => manager,
    buildRegisterRecord: (_item, meta) => {
      registerArgs.push(meta);
      return {};
    },
    buildProgressPayload: (_item, meta) => ({ ...meta, received: 1, total: 2, paused: false }),
    buildDonePayload: (_item, meta) => ({ ...meta, savePath: '/trusted/file' }),
    broadcast: (channel, payload) => events.push(['broadcast', channel, payload]),
    registerInternalHandler: (_ipc, channel, fn) => internal.set(channel, fn),
    sessionFromPartition: (partition) => {
      const ses = {
        partition,
        downloadURL: (url) => {
          sessionRequests.push({ partition, url });
          events.push(['session-download', partition, url]);
        }
      };
      return opts.sessionFor ? opts.sessionFor(partition, ses) : ses;
    },
    getJars: () => jarList,
    partitionFromStoragePath,
    isPartitionLive: (partition) => liveBurners.has(partition),
    now: opts.now || (() => 10),
    logger: { warn: (...args) => events.push(['warn', ...args]) }
  });
  return {
    handlers,
    internal,
    events,
    chromeSender,
    downloader,
    wireDownloadHandler,
    noteSessionPartition,
    registerArgs,
    sessionRequests,
    liveBurners,
    manager,
    setActiveTab: (id) => {
      activeTabWcId = id;
    }
  };
}

test('download directory authority is minted by the chooser and enforced by download-media', async () => {
  const h = makeHarness();
  assert.deepEqual([...h.handlers.keys()].sort(), [
    'choose-download-dir',
    'download-media',
    'downloads-snapshot',
    'open-downloaded-file',
    'reveal-downloaded-file',
    'show-item-in-folder'
  ]);
  assert.deepEqual([...h.internal.keys()].sort(), [
    'internal-downloads-action',
    'internal-downloads-clear',
    'internal-downloads-list'
  ]);

  const payload = { webContentsId: 9, url: 'https://example/file', suggestedName: 'file', saveDir: '/approved' };
  assert.deepEqual(await h.handlers.get('download-media')(eventFrom(h.chromeSender), payload), {
    ok: false,
    error: 'Download directory not approved.'
  });
  assert.equal(await h.handlers.get('choose-download-dir')(eventFrom(h.chromeSender)), '/approved');
  assert.deepEqual(await h.handlers.get('download-media')(eventFrom(h.chromeSender), payload), { ok: true });
  assert.deepEqual(h.events, [['download', 'https://example/file']]);
});

test('download-media fails loudly with no resolvable jar-guest context — the chrome-view terminal fallback is removed (DD6)', async () => {
  const h = makeHarness();
  // No webContentsId on the payload, and the sender's registry record has no
  // activeTabWcId — so both wc and senderActiveTab resolve to null. Before
  // DD6 this fell back to rec.chromeView.webContents (the default session);
  // now it must fail loudly instead.
  const payload = { url: 'https://example/file', suggestedName: 'file' };
  assert.deepEqual(await h.handlers.get('download-media')(eventFrom(h.chromeSender), payload), {
    ok: false,
    error: 'No web contents available to download with.'
  });
  assert.deepEqual(h.events, []);
});

test('download-media refuses a webContentsId its sender window does not own — the gate, stricter than the F10c fall-through', async () => {
  const h = makeHarness();
  h.setActiveTab(9); // the sender's genuine tab
  // 42 stands in for the chrome's own id / another window's tab: present but not owned by the
  // sender's window. Before the gate it fell through to the sender's active tab; the owning-chrome
  // class now refuses it outright (a tab id that is named must be owned).
  const payload = { webContentsId: 42, url: 'https://example/chrome-id', suggestedName: 'file' };
  await assert.rejects(async () => h.handlers.get('download-media')(eventFrom(h.chromeSender), payload), /forbidden/);
  assert.deepEqual(h.events, []);
  // No tab named at all is chrome-only and means the sender window's active tab.
  assert.deepEqual(
    await h.handlers.get('download-media')(eventFrom(h.chromeSender), {
      url: 'https://example/active',
      suggestedName: 'f'
    }),
    { ok: true }
  );
  assert.deepEqual(h.events, [['download', 'https://example/active']]);
});

test('download channels refuse a page sender, a null frame, and an unknown sender — no last-focused fallback', async () => {
  const h = makeHarness();
  const page = { sender: { id: 'page' }, senderFrame: { origin: 'https://evil.test' } };
  const nullFrame = { sender: h.chromeSender, senderFrame: null };
  for (const [channel, args] of [
    ['download-media', [{ webContentsId: 9, url: 'https://x/y' }]],
    ['choose-download-dir', []],
    ['show-item-in-folder', ['/approved']],
    ['open-downloaded-file', [1]],
    ['reveal-downloaded-file', [1]]
  ]) {
    await assert.rejects(async () => h.handlers.get(channel)(page, ...args), /forbidden/, `${channel} page`);
    await assert.rejects(async () => h.handlers.get(channel)(nullFrame, ...args), /forbidden/, `${channel} null frame`);
  }
  assert.deepEqual(h.events, [], 'no refused call reached a handler body');
});

test('download-media uses a real tab webContentsId directly, with no active-tab fallback needed', async () => {
  const h = makeHarness();
  // activeTabWcId stays null — if the code used the fallback instead of the
  // resolved tab contents, downloader would be null and this would fail loudly.
  const payload = { webContentsId: 9, url: 'https://example/tab-id', suggestedName: 'file' };
  assert.deepEqual(await h.handlers.get('download-media')(eventFrom(h.chromeSender), payload), { ok: true });
  assert.deepEqual(h.events, [['download', 'https://example/tab-id']]);
});

test('downloads-snapshot is chrome-authorized and omits paths and URLs', async () => {
  const h = makeHarness();
  assert.deepEqual(await h.handlers.get('downloads-snapshot')(eventFrom({})), []);
  assert.deepEqual(await h.handlers.get('downloads-snapshot')(eventFrom(h.chromeSender)), [
    {
      id: 2,
      filename: 'partial',
      state: 'progressing',
      received: undefined,
      total: undefined,
      paused: undefined,
      endTime: null,
      active: true
    },
    {
      id: 1,
      filename: 'file',
      state: 'completed',
      received: 10,
      total: 10,
      paused: undefined,
      endTime: 9,
      active: false
    }
  ]);
});

test('downloads-snapshot minimizes history to active rows plus the 25 newest completions', async () => {
  const h = makeHarness();
  h.manager.listAll = () => [
    { id: 100, filename: 'active', state: 'progressing', savePath: '/private/active' },
    ...Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      filename: `done-${i + 1}`,
      state: 'completed',
      endTime: i + 1,
      savePath: `/private/done-${i + 1}`,
      url: `https://private/${i + 1}`
    })),
    { id: 200, filename: 'cancelled', state: 'cancelled', endTime: 31 }
  ];
  const rows = await h.handlers.get('downloads-snapshot')(eventFrom(h.chromeSender));
  assert.equal(rows.length, 26);
  assert.equal(rows[0].id, 100);
  assert.deepEqual(
    rows.slice(1).map((row) => row.id),
    Array.from({ length: 25 }, (_, i) => 30 - i)
  );
  assert.equal(
    rows.some((row) => 'savePath' in row || 'url' in row),
    false
  );
});

test('downloads-page action allowlist resolves open/show paths only from the manager', async () => {
  const h = makeHarness();
  assert.deepEqual(
    await h.internal.get('internal-downloads-action')(
      {},
      {
        id: 1,
        action: 'delete-everything',
        savePath: '/attacker/path'
      }
    ),
    { ok: false }
  );
  assert.deepEqual(h.events, []);

  assert.deepEqual(
    await h.internal.get('internal-downloads-action')(
      {},
      {
        id: 1,
        action: 'open',
        savePath: '/attacker/path'
      }
    ),
    { ok: true, error: undefined }
  );
  assert.deepEqual(h.events, [['open', '/trusted/file']]);
  h.events.length = 0;
  assert.deepEqual(
    await h.internal.get('internal-downloads-action')(
      {},
      {
        id: 1,
        action: 'show',
        savePath: '/attacker/path'
      }
    ),
    { ok: true }
  );
  assert.deepEqual(h.events, [['show', '/trusted/file']]);
});

test('show-item-in-folder shows an approved download directory (mirrors media-controller.js:494) — F10c', async () => {
  const h = makeHarness();
  const chosen = await h.handlers.get('choose-download-dir')(eventFrom(h.chromeSender));
  assert.equal(chosen, '/approved');
  assert.deepEqual(await h.handlers.get('show-item-in-folder')(eventFrom(h.chromeSender), '/approved'), undefined);
  assert.deepEqual(h.events, [['show', '/approved']]);
});

test('show-item-in-folder shows a known download record savePath (mirrors media-controller.js:715) — F10c', async () => {
  const h = makeHarness();
  assert.deepEqual(await h.handlers.get('show-item-in-folder')(eventFrom(h.chromeSender), '/trusted/file'), undefined);
  assert.deepEqual(h.events, [['show', '/trusted/file']]);
});

test('show-item-in-folder no-ops for an arbitrary/unknown renderer-supplied path — F10c', async () => {
  const h = makeHarness();
  // Path-traversal-y: resolves to a directory outside both the approved-dirs
  // set and any known record savePath. The cancelled fixture record's
  // savePath is null, exercising that a null savePath in the manager's list
  // does not crash or falsely match.
  assert.deepEqual(
    await h.handlers.get('show-item-in-folder')(eventFrom(h.chromeSender), '/trusted/../attacker/evil'),
    undefined
  );
  // Neuter: removing the validation would call shell.showItemInFolder with
  // the raw path here → this assertion would go red.
  assert.deepEqual(h.events, []);
});

test('show-item-in-folder is a no-op for an empty or non-string savePath', async () => {
  const h = makeHarness();
  assert.deepEqual(await h.handlers.get('show-item-in-folder')(eventFrom(h.chromeSender), ''), undefined);
  assert.deepEqual(await h.handlers.get('show-item-in-folder')(eventFrom(h.chromeSender), null), undefined);
  assert.deepEqual(h.events, []);
});

test('open-downloaded-file resolves savePath by id from the manager, never a path arg', async () => {
  const h = makeHarness();
  // A bogus path passed as a second/third arg must be ignored — the handler
  // signature is (_event, id); savePath comes only from the resolved record.
  assert.deepEqual(await h.handlers.get('open-downloaded-file')(eventFrom(h.chromeSender), 1, '/attacker/path'), {
    ok: true,
    error: undefined
  });
  assert.deepEqual(h.events, [['open', '/trusted/file']]);
});

test('open-downloaded-file returns { ok: false } and does not open for an unknown id', async () => {
  const h = makeHarness();
  assert.deepEqual(await h.handlers.get('open-downloaded-file')(eventFrom(h.chromeSender), 999), { ok: false });
  assert.deepEqual(h.events, []);
});

test('open-downloaded-file gates on completion — an in-progress record is not opened', async () => {
  const h = makeHarness();
  assert.deepEqual(await h.handlers.get('open-downloaded-file')(eventFrom(h.chromeSender), 2), { ok: false });
  assert.deepEqual(h.events, []);
});

test('reveal-downloaded-file resolves savePath by id and shows it', async () => {
  const h = makeHarness();
  assert.deepEqual(await h.handlers.get('reveal-downloaded-file')(eventFrom(h.chromeSender), 1, '/attacker/path'), {
    ok: true
  });
  assert.deepEqual(h.events, [['show', '/trusted/file']]);
});

test('reveal-downloaded-file returns { ok: false } and does not show for an unknown id', async () => {
  const h = makeHarness();
  assert.deepEqual(await h.handlers.get('reveal-downloaded-file')(eventFrom(h.chromeSender), 999), { ok: false });
  assert.deepEqual(h.events, []);
});

// Mission 23 Flight 1 (leg `jar-isolation`): the media-download scheme allowlist and the per-tab pending key.

test('download-media accepts http, https, blob: and raster data: images - and refuses everything else, recording nothing', async () => {
  const h = makeHarness();
  const call = (url) => h.handlers.get('download-media')(eventFrom(h.chromeSender), { webContentsId: 9, url });
  for (const url of [
    'http://example.com/a.png',
    'https://example.com/a.png',
    'blob:https://example.com/9f1c',
    'data:image/png;base64,AAAA'
  ]) {
    assert.deepEqual(await call(url), { ok: true }, url);
  }
  assert.equal(h.events.length, 4);
  h.events.length = 0;
  for (const url of [
    'file:///etc/hostname',
    'ftp://example.com/x.mp3',
    'javascript:alert(1)',
    'goldfinch-media://proxy/tok/http%3A%2F%2Fexample.com%2Fx.png',
    'goldfinch://settings',
    'data:image/svg+xml;base64,AAAA',
    'data:text/html,hi',
    'about:blank',
    '',
    undefined,
    null,
    42,
    {}
  ]) {
    const res = await call(url);
    assert.equal(res.ok, false, String(url));
  }
  assert.deepEqual(h.events, [], 'a refused call starts no download');
});

test('download-media refuses a bad url before resolving anything: even with an unapproved saveDir the error is the url', async () => {
  const h = makeHarness();
  const res = await h.handlers.get('download-media')(eventFrom(h.chromeSender), {
    webContentsId: 9,
    url: 'file:///etc/hostname',
    saveDir: '/never-approved'
  });
  assert.deepEqual(res, { ok: false, error: 'Unsupported download URL.' });
});

function startDownload(h, sess, url, contents) {
  const calls = [];
  const item = {
    getURL: () => url,
    getFilename: () => 'chromium-name',
    setSavePath: (p) => calls.push(['savePath', p]),
    on() {},
    once() {}
  };
  sess.listeners.get('will-download')({}, item, contents);
  return calls;
}

function fakeSession() {
  const listeners = new Map();
  return { listeners, on: (name, fn) => listeners.set(name, fn) };
}

test("the pending record is keyed by tab and url: another tab downloading the same url gets Chromium's name and the default folder", async () => {
  const h = makeHarness();
  const sess = fakeSession();
  h.wireDownloadHandler(sess);
  h.setActiveTab(9);
  const ok = await h.handlers.get('choose-download-dir')(eventFrom(h.chromeSender));
  const url = 'https://example.com/pic.png';
  await h.handlers.get('download-media')(eventFrom(h.chromeSender), {
    webContentsId: 9,
    url,
    suggestedName: 'suggested.png',
    saveDir: ok
  });
  // A page-started download of the SAME url in a different tab (id 77) inherits nothing.
  const other = startDownload(h, sess, url, { id: 77 });
  assert.deepEqual(other, [['savePath', path.join('/downloads', 'chromium-name')]]);
  // ...and it did not consume the real record: the media panel's own download still gets its name and folder.
  const own = startDownload(h, sess, url, { id: 9 });
  assert.deepEqual(own, [['savePath', path.join('/approved', 'suggested.png')]]);
});

test('a download that reports no webContents never matches a pending record', async () => {
  const h = makeHarness();
  const sess = fakeSession();
  h.wireDownloadHandler(sess);
  const url = 'https://example.com/pic.png';
  await h.handlers.get('download-media')(eventFrom(h.chromeSender), {
    webContentsId: 9,
    url,
    suggestedName: 'suggested.png'
  });
  assert.deepEqual(startDownload(h, sess, url, undefined), [['savePath', path.join('/downloads', 'chromium-name')]]);
  assert.deepEqual(startDownload(h, sess, url, null), [['savePath', path.join('/downloads', 'chromium-name')]]);
});

test('the pending record is consumed when the download starts: a later page-started download of the same url inherits nothing', async () => {
  const h = makeHarness();
  const sess = fakeSession();
  h.wireDownloadHandler(sess);
  const url = 'https://example.com/pic.png';
  await h.handlers.get('download-media')(eventFrom(h.chromeSender), {
    webContentsId: 9,
    url,
    suggestedName: 'suggested.png'
  });
  assert.deepEqual(startDownload(h, sess, url, { id: 9 }), [['savePath', path.join('/downloads', 'suggested.png')]]);
  assert.deepEqual(startDownload(h, sess, url, { id: 9 }), [['savePath', path.join('/downloads', 'chromium-name')]]);
});

test('a pending record older than 60 s is dropped when another is added (a request that never produced a download)', async () => {
  let clock = 1000;
  const h = makeHarness({ now: () => clock });
  const sess = fakeSession();
  h.wireDownloadHandler(sess);
  const stale = 'https://example.com/never-started.png';
  const fresh = 'https://example.com/fresh.png';
  await h.handlers.get('download-media')(eventFrom(h.chromeSender), {
    webContentsId: 9,
    url: stale,
    suggestedName: 'stale.png'
  });
  clock += 59_000; // inside the window: the record is still there
  await h.handlers.get('download-media')(eventFrom(h.chromeSender), {
    webContentsId: 9,
    url: fresh,
    suggestedName: 'a.png'
  });
  clock += 2_000; // the first is now 61 s old, the second 2 s
  await h.handlers.get('download-media')(eventFrom(h.chromeSender), {
    webContentsId: 9,
    url: 'https://example.com/third.png',
    suggestedName: 'c.png'
  });
  assert.deepEqual(startDownload(h, sess, stale, { id: 9 }), [['savePath', path.join('/downloads', 'chromium-name')]]);
  assert.deepEqual(startDownload(h, sess, fresh, { id: 9 }), [['savePath', path.join('/downloads', 'a.png')]]);
});

// ---------------------------------------------------------------------------
// Mission 23 Flight 1 (leg `downloads`): records carry their jar, Retry uses the owning jar, one open path
// ---------------------------------------------------------------------------

function sessionWithStorage(storagePath) {
  const listeners = new Map();
  return { storagePath, listeners, on: (name, fn) => listeners.set(name, fn) };
}

test('a record carries the partition of the session its download runs in', () => {
  const h = makeHarness();
  const cases = [
    // A container jar: derived from the percent-encoded storage directory.
    ['container jar', sessionWithStorage('/data/Partitions/container%3Awork'), 'persist:container:work'],
    // The legacy default-flagged jar lives at persist:goldfinch.
    ['default-flagged jar', sessionWithStorage('/data/Partitions/goldfinch'), 'persist:goldfinch'],
    // The browser's own session has no Partitions segment: no partition recorded.
    ['browser session', sessionWithStorage('/data'), undefined],
    ['in-memory session', sessionWithStorage(undefined), undefined]
  ];
  for (const [label, sess, expected] of cases) {
    h.registerArgs.length = 0;
    h.wireDownloadHandler(sess);
    startDownload(h, sess, 'https://example.com/a.bin', { id: 9 });
    assert.equal(h.registerArgs.length, 1, label);
    assert.equal(h.registerArgs[0].partition, expected, label);
  }
});

test('a burner session (no storage path) records the partition tab creation noted for it', () => {
  const h = makeHarness();
  const burner = sessionWithStorage(undefined);
  h.noteSessionPartition(burner, 'burner:3');
  h.wireDownloadHandler(burner);
  startDownload(h, burner, 'https://example.com/a.bin', { id: 9 });
  assert.equal(h.registerArgs[0].partition, 'burner:3');
});

test('a popup shares its opener session, so its downloads record the opener partition', () => {
  const h = makeHarness();
  const shared = sessionWithStorage(undefined);
  h.noteSessionPartition(shared, 'burner:7'); // written at the opener tab's creation
  h.wireDownloadHandler(shared);
  // The popup's contents report the same session object; the download event names the popup's own id.
  startDownload(h, shared, 'https://example.com/a.bin', { id: 501 });
  assert.equal(h.registerArgs[0].partition, 'burner:7');
});

test('noteSessionPartition ignores a non-string or empty partition and a missing session', () => {
  const h = makeHarness();
  const sess = sessionWithStorage(undefined);
  h.noteSessionPartition(sess, '');
  h.noteSessionPartition(sess, 42);
  h.noteSessionPartition(null, 'burner:1');
  h.wireDownloadHandler(sess);
  startDownload(h, sess, 'https://example.com/a.bin', { id: 9 });
  assert.equal(h.registerArgs[0].partition, undefined);
});

const retryRecord = (over) => ({
  id: 50,
  url: 'https://retry.example/flaky.bin',
  filename: 'flaky.bin',
  savePath: '/downloads/flaky.bin',
  state: 'interrupted',
  partition: 'persist:container:work',
  ...over
});
const retry = (h, id = 50) => h.internal.get('internal-downloads-action')({}, { id, action: 'retry' });

test('Retry re-requests through session.fromPartition(record.partition) and nothing else', async () => {
  const h = makeHarness({ records: [retryRecord()] });
  assert.deepEqual(await retry(h), { ok: true });
  assert.deepEqual(h.sessionRequests, [
    { partition: 'persist:container:work', url: 'https://retry.example/flaky.bin' }
  ]);
  // Nothing went through the tab's contents (the chrome-view style call).
  assert.equal(h.events.filter((e) => e[0] === 'download').length, 0);
});

test('Retry notes the partition on the session before requesting, so the retried download records it', async () => {
  const sess = sessionWithStorage(undefined);
  const requests = [];
  const h = makeHarness({
    records: [retryRecord({ partition: 'burner:4' })],
    liveBurners: ['burner:4'],
    sessionFor: (partition) => {
      Object.assign(sess, { downloadURL: (url) => requests.push([partition, url]) });
      return sess;
    }
  });
  h.wireDownloadHandler(sess);
  assert.deepEqual(await retry(h), { ok: true });
  assert.deepEqual(requests, [['burner:4', 'https://retry.example/flaky.bin']]);
  startDownload(h, sess, 'https://retry.example/flaky.bin', undefined);
  assert.equal(h.registerArgs.at(-1).partition, 'burner:4');
});

test('Retry is refused, doing nothing and answering a reason, in each impossible case', async () => {
  const cases = [
    ['no partition', retryRecord({ partition: undefined }), 'no-partition', {}],
    ['empty partition', retryRecord({ partition: '' }), 'no-partition', {}],
    ['jar deleted', retryRecord({ partition: 'persist:container:gone' }), 'jar-gone', {}],
    ['unknown partition shape', retryRecord({ partition: 'goldfinch-internal' }), 'jar-gone', {}],
    ['burner with nothing open', retryRecord({ partition: 'burner:9' }), 'burner-gone', {}],
    ['blob url', retryRecord({ url: 'blob:https://example.com/abc' }), 'unsupported-url', {}],
    ['data url', retryRecord({ url: 'data:image/png;base64,AAAA' }), 'unsupported-url', {}],
    ['file url', retryRecord({ url: 'file:///etc/hostname' }), 'unsupported-url', {}],
    ['empty url', retryRecord({ url: '' }), 'unsupported-url', {}]
  ];
  for (const [label, rec, reason] of cases) {
    const h = makeHarness({ records: [rec] });
    const res = await retry(h);
    assert.equal(res.ok, false, label);
    assert.equal(res.reason, reason, label);
    assert.equal(typeof res.message, 'string', label);
    assert.deepEqual(h.sessionRequests, [], `${label}: nothing requested`);
    assert.deepEqual(h.events, [], `${label}: nothing happened`);
  }
  // An unknown id is refused too.
  const h = makeHarness();
  assert.equal((await retry(h, 4242)).ok, false);
  assert.deepEqual(h.sessionRequests, []);
});

test('a burner Retry works while its partition is live', async () => {
  const h = makeHarness({ records: [retryRecord({ partition: 'burner:9' })], liveBurners: ['burner:9'] });
  assert.deepEqual(await retry(h), { ok: true });
  assert.deepEqual(h.sessionRequests, [{ partition: 'burner:9', url: 'https://retry.example/flaky.bin' }]);
});

test('a Retry whose session request throws answers request-failed rather than throwing', async () => {
  const h = makeHarness({
    records: [retryRecord()],
    sessionFor: () => ({
      downloadURL() {
        throw new Error('boom');
      }
    })
  });
  const res = await retry(h);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'request-failed');
});

test('the downloads list rows carry the main-derived retry verdict', async () => {
  const h = makeHarness({
    records: [
      retryRecord({ id: 50 }),
      retryRecord({ id: 51, partition: undefined }),
      retryRecord({ id: 52, partition: 'persist:container:gone' }),
      retryRecord({ id: 53, partition: 'burner:1' })
    ]
  });
  const rows = await h.internal.get('internal-downloads-list')({});
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId[50].retryable, true);
  assert.equal(byId[50].retryReason, null);
  assert.equal(byId[50].retryNote, null);
  assert.deepEqual([byId[51].retryable, byId[51].retryReason], [false, 'no-partition']);
  assert.deepEqual([byId[52].retryable, byId[52].retryReason], [false, 'jar-gone']);
  assert.deepEqual([byId[53].retryable, byId[53].retryReason], [false, 'burner-gone']);
  assert.match(byId[51].retryNote, /^Cannot retry/);
  // The record's own fields are untouched.
  assert.equal(byId[50].url, 'https://retry.example/flaky.bin');
  assert.equal(byId[50].partition, 'persist:container:work');
});

test('the page action `open` opens a finished record only: in-progress and interrupted records open nothing', async () => {
  const h = makeHarness({ records: [retryRecord({ id: 60, state: 'interrupted', savePath: '/downloads/x' })] });
  const open = (id) => h.internal.get('internal-downloads-action')({}, { id, action: 'open' });
  assert.deepEqual(await open(2), { ok: false }, 'in-progress');
  assert.deepEqual(await open(60), { ok: false }, 'interrupted');
  assert.deepEqual(await open(3), { ok: false }, 'cancelled, no path');
  assert.deepEqual(await open(999), { ok: false }, 'unknown');
  assert.deepEqual(h.events, []);
  assert.deepEqual(await open(1), { ok: true, error: undefined }, 'completed');
  assert.deepEqual(h.events, [['open', '/trusted/file']]);
});

test('the module no longer takes a chrome accessor and never downloads through a chrome view', () => {
  const src = fsReal.readFileSync(require.resolve('../../src/main/register-download-ipc'), 'utf8');
  assert.ok(!/getChromeContents/.test(src), 'getChromeContents dependency removed');
  assert.ok(!/chromeView|\bchrome\.downloadURL/.test(src));
  // The only downloadURL callers are the media download's tab contents and Retry's owning-jar session.
  const calls = src.match(/\b\w+\.downloadURL\(/g) || [];
  assert.deepEqual(calls.sort(), ['downloader.downloadURL(', 'ses.downloadURL('].sort());
});

test('shell.openPath is called from exactly one function in src/main (source-scan pin)', () => {
  const dir = path.join(__dirname, '..', '..', 'src', 'main');
  const hits = [];
  const walk = (d) => {
    for (const entry of fsReal.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        const code = fsReal
          .readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        const count = (code.match(/\bopenPath\s*\(/g) || []).length;
        for (let n = 0; n < count; n++) hits.push(path.relative(dir, full));
      }
    }
  };
  walk(dir);
  assert.deepEqual(hits, ['register-download-ipc.js']);
  // ...and inside that file it sits in the single `openDownload` function.
  const src = fsReal.readFileSync(path.join(dir, 'register-download-ipc.js'), 'utf8');
  const fn = /function openDownload\([\s\S]*?\n {2}\}\n/.exec(src);
  assert.ok(fn && /shell\.openPath\(/.test(fn[0]), 'openPath lives in openDownload');
  const callers = src.match(/return openDownload\(id\);/g) || [];
  assert.equal(callers.length, 2, 'the chrome channel and the page action both call it');
});

test('main.js wires the owning-jar facts into the downloads registrar and the partition write into tab creation', () => {
  const src = fsReal.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.js'), 'utf8');
  const downloads = /registerDownloadIpc\(\{[\s\S]*?\n\}\);/.exec(src);
  assert.ok(downloads, 'registerDownloadIpc call found');
  for (const dep of ['sessionFromPartition', 'getJars', 'partitionFromStoragePath', 'isPartitionLive']) {
    assert.match(downloads[0], new RegExp(`\\b${dep}\\b`), dep);
  }
  assert.ok(!/getChromeContents/.test(downloads[0]), 'no chrome accessor is handed to the downloads registrar');
  const tabs = /registerTabIpc\(\{[\s\S]*?\n\}\);/.exec(src);
  assert.ok(tabs && /\bnoteSessionPartition\b/.test(tabs[0]), 'registerTabIpc receives noteSessionPartition');
});
