'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./helpers/window-factory-harness');

test('constructs platform chrome and lazy overlay views with exact trust options', () => {
  const h = createHarness({ platform: 'darwin', argv: ['--automation-dev'], isAutomationEnabled: () => true });
  const rec = h.factory.createWindow();

  assert.deepEqual(h.windowOptions[0], {
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1e1f25',
    title: 'Goldfinch',
    icon: '/app/build/icon.png',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 14 }
  });
  assert.deepEqual(h.viewOptions[0], {
    webPreferences: {
      preload: '/app/preload/chrome-preload.js',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: ['--automation-dev']
    }
  });
  assert.equal(rec.chromeView.backgroundColor, '#1e1f25');
  assert.deepEqual(rec.chromeView.bounds, { x: 0, y: 0, width: 1400, height: 900 });
  assert.deepEqual(rec.chromeView.webContents.loadedFiles, ['/app/renderer/index.html']);

  const find = h.managerDeps.find.createOverlayView();
  const sheet = h.managerDeps.sheet.createSheetView();
  const tearoff = h.managerDeps.tearoff.createOverlayView();
  assert.deepEqual(find.opts.webPreferences, {
    preload: '/app/preload/find-overlay-preload.js', contextIsolation: true, nodeIntegration: false, sandbox: false
  });
  assert.deepEqual(sheet.opts.webPreferences, {
    preload: '/app/preload/menu-overlay-preload.js', contextIsolation: true, nodeIntegration: false, sandbox: false
  });
  assert.deepEqual(tearoff.opts.webPreferences, { contextIsolation: true, nodeIntegration: false, sandbox: true });
  assert.deepEqual(find.webContents.loadedFiles, ['/app/renderer/find-overlay.html']);
  assert.deepEqual(sheet.webContents.loadedFiles, ['/app/renderer/menu-overlay.html']);
  assert.deepEqual(tearoff.webContents.loadedFiles, ['/app/renderer/tearoff-overlay.html']);
});

test('preserves no-boot-tab and exact requested content size', () => {
  const h = createHarness();
  const rec = h.factory.createWindow({ noBootTab: true, contentSize: { width: 1111, height: 777 } });
  assert.equal(rec.noBootTab, true);
  assert.deepEqual(rec.win.contentSize, { width: 1111, height: 777 });
  assert.deepEqual(rec.chromeView.bounds, { x: 0, y: 0, width: 1111, height: 777 });
  assert.equal(h.windowOptions[0].frame, false);
});

test('packaged windows never receive the unpackaged automation renderer argument', () => {
  const h = createHarness({
    argv: ['--automation-dev'],
    isPackaged: true,
    isAutomationEnabled: () => true
  });
  h.factory.createWindow();
  assert.equal('additionalArguments' in h.viewOptions[0].webPreferences, false);
});

test('tracks focus and routes resize/maximize state only to the owning chrome', () => {
  const h = createHarness();
  const rec = h.factory.createWindow();
  rec.win.emit('focus');
  rec.win.contentBounds = { width: 1220, height: 810 };
  rec.win.emit('resize');
  rec.win.emit('maximize');
  rec.win.emit('unmaximize');

  assert.ok(h.log.includes(`focus:${rec.win.id}`));
  assert.deepEqual(rec.chromeView.bounds, { x: 0, y: 0, width: 1220, height: 810 });
  assert.deepEqual(h.chromeSends, [
    ['trigger-send-bounds', undefined],
    ['window-maximized-change', true],
    ['trigger-send-bounds', undefined],
    ['window-maximized-change', false],
    ['trigger-send-bounds', undefined]
  ]);
});

test('close tears down overlays before capture/snapshot and destroys every guest afterward', () => {
  const h = createHarness({ settings: { get: () => true } });
  const rec = h.factory.createWindow();
  const guest = new h.FakeWebContentsView({});
  rec.tabViews.set(guest.webContents.id, { view: guest, trusted: false });
  h.log.length = 0;

  rec.win.emit('close');

  const ordered = [
    'find-teardown',
    'tearoff-teardown',
    'sheet-close:teardown',
    'sheet-teardown',
    'capture-tabs',
    'build-snapshot',
    'snapshot-write',
    `forget:${guest.webContents.id}`,
    `remove-view:${guest.webContents.id}`,
    `destroy-wc:${guest.webContents.id}`
  ];
  assert.deepEqual(h.log.filter((entry) => ordered.includes(entry)), ordered);
  assert.equal(rec.findOverlay, null);
  assert.equal(rec.tearoffOverlay, null);
  assert.equal(rec.sheet, null);
  assert.equal(rec.tabViews.size, 0);
  assert.equal(rec.activeTabWcId, null);
});

test('missing record during close still tears down every overlay', () => {
  const h = createHarness();
  const rec = h.factory.createWindow();
  h.records.delete(rec.win.id);
  h.log.length = 0;
  rec.win.emit('close');
  assert.deepEqual(h.log, ['find-teardown', 'tearoff-teardown', 'sheet-close:teardown', 'sheet-teardown']);
});

test('snapshot errors are isolated and do not abort guest destruction', () => {
  const h = createHarness({
    settings: { get: () => true },
    sessionStore: { write() { throw new Error('disk full'); } }
  });
  const rec = h.factory.createWindow();
  const guest = new h.FakeWebContentsView({});
  rec.tabViews.set(guest.webContents.id, { view: guest, trusted: false });
  rec.win.emit('close');
  assert.equal(guest.webContents.isDestroyed(), true);
  assert.ok(h.log.some((entry) => entry.startsWith('error:[session-store]')));
});

test('closed handler uses only the captured primitive id and destroys chrome deferred', () => {
  const h = createHarness({ throwOnDestroyedRead: true });
  const rec = h.factory.createWindow();
  const id = rec.win.id;
  rec.win.emit('close');
  rec.win.destroyed = true;
  assert.doesNotThrow(() => rec.win.emit('closed'));
  assert.equal(h.registry.get(id), null);
  assert.equal(rec.chromeView.webContents.isDestroyed(), true);
});
