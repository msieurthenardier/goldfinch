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
    preload: '/app/preload/find-overlay-preload.js',
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
  });
  assert.deepEqual(sheet.opts.webPreferences, {
    preload: '/app/preload/menu-overlay-preload.js',
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
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
  // M14 F1 L1 (DD1): the fullscreen re-expand hook rides all THREE geometry
  // events — resize plus maximize/unmaximize (which can arrive without a
  // paired resize on some platforms) — and each call precedes that event's
  // trigger-send-bounds (the renderer's triggered send must land in an
  // already-re-expanded gate).
  assert.equal(h.log.filter((entry) => entry === `fs-resize:${rec.win.id}`).length, 3);
  const fsIdx = h.log.indexOf(`fs-resize:${rec.win.id}`);
  const sendIdx = h.log.indexOf('send:trigger-send-bounds');
  assert.ok(fsIdx !== -1 && fsIdx < sendIdx, 'resize re-expand precedes the triggered renderer send');
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
    `favicon-forget:${guest.webContents.id}`,
    `remove-view:${guest.webContents.id}`,
    `destroy-wc:${guest.webContents.id}`
  ];
  assert.deepEqual(
    h.log.filter((entry) => ordered.includes(entry)),
    ordered
  );
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
    sessionStore: {
      write() {
        throw new Error('disk full');
      }
    }
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

// ---------------------------------------------------------------------------
// M14 F1 L2 (DD2) — auth pending-challenge store wiring.
// ---------------------------------------------------------------------------

function authWiredHarness() {
  const events = [];
  /** late-bound so the cancelForWindow ordering probe can read the harness log */
  let h = null;
  const authChallenges = {
    notifyWindowFocused: (record) => events.push(['focused', record.win.id]),
    notifySheetClosed: (record, menuType, reason) => events.push(['sheet-closed', record.win.id, menuType, reason]),
    cancelForWindow: (record) =>
      events.push([
        'cancel-window',
        record.win.id,
        // ordering probe: the sheet's 'teardown' close must NOT have run yet —
        // cancelForWindow empties the queue FIRST (load-bearing, leg AC).
        h.log.includes('sheet-close:teardown')
      ])
  };
  h = createHarness({ authChallenges });
  return { h, events };
}

test('window focus notifies the auth store (the blur-close re-present counterpart, M14 F1 L2)', () => {
  const { h, events } = authWiredHarness();
  const rec = h.factory.createWindow();
  rec.win.emit('focus');
  assert.deepEqual(events, [['focused', rec.win.id]]);
});

test('window close cancels the WHOLE auth queue BEFORE the sheet teardown close', () => {
  const { h, events } = authWiredHarness();
  const rec = h.factory.createWindow();
  rec.win.emit('close');
  const cancel = events.find((e) => e[0] === 'cancel-window');
  assert.ok(cancel, 'cancelForWindow ran');
  assert.equal(cancel[1], rec.win.id);
  assert.equal(cancel[2], false, "ran BEFORE the sheet's closeMenuOverlay('teardown')");
  assert.ok(h.log.includes('sheet-close:teardown'), 'the teardown close still runs after');
});

test('the manager onClosed dep threads to notifySheetClosed closing over the window record', () => {
  const { h, events } = authWiredHarness();
  const rec = h.factory.createWindow();
  const sheetDeps = h.managerDeps.sheet;
  assert.equal(typeof sheetDeps.onClosed, 'function', 'onClosed is threaded at the construction site');
  sheetDeps.onClosed({ menuType: 'auth-basic', reason: 'blur' });
  assert.deepEqual(events, [['sheet-closed', rec.win.id, 'auth-basic', 'blur']]);
});

test('absent authChallenges dep is tolerated on every hook (optional-chained)', () => {
  const h = createHarness();
  const rec = h.factory.createWindow();
  assert.doesNotThrow(() => {
    rec.win.emit('focus');
    h.managerDeps.sheet.onClosed({ menuType: 'kebab', reason: 'escape' });
    rec.win.emit('close');
  });
});

// ---------------------------------------------------------------------------
// M14 F2 L1 (DD1f) — popup close-with-owner ordering.
// ---------------------------------------------------------------------------

test('window close runs popupRegistry.closeAllForRecord AFTER the auth cancel (pinned first) and BEFORE sheet/overlay teardown', () => {
  const events = [];
  let h = null;
  const authChallenges = {
    notifyWindowFocused: () => {},
    notifySheetClosed: () => {},
    cancelForWindow: (record) => events.push(['cancel-window', record.win.id])
  };
  const popupRegistry = {
    closeAllForRecord: (record) =>
      events.push([
        'close-popups',
        record.win.id,
        // ordering probes: the window-wide auth cancel already ran (DD1f rides
        // BEHIND the unit-pinned cancelForWindow-first invariant), and no
        // overlay teardown has run yet.
        events.some((e) => e[0] === 'cancel-window'),
        h.log.includes('find-teardown') || h.log.includes('sheet-close:teardown')
      ])
  };
  h = createHarness({ authChallenges, popupRegistry });
  const rec = h.factory.createWindow();
  rec.win.emit('close');

  const closePopups = events.find((e) => e[0] === 'close-popups');
  assert.ok(closePopups, 'closeAllForRecord ran at window close');
  assert.equal(closePopups[1], rec.win.id);
  assert.equal(closePopups[2], true, 'auth cancelForWindow stays FIRST (unit-pinned invariant)');
  assert.equal(closePopups[3], false, 'popups close before any sheet/overlay teardown');
  assert.ok(h.log.includes('sheet-close:teardown'), 'the rest of the close path still runs');
});

test('absent popupRegistry dep is tolerated at window close (optional-chained)', () => {
  const h = createHarness();
  const rec = h.factory.createWindow();
  assert.doesNotThrow(() => rec.win.emit('close'));
});

// ---------------------------------------------------------------------------
// M17 F4 L3 (AC4, squawk 0051), RE-MODELED M18 F2 L4 (flight DD5) — window-close
// release of the window's vault suppression HOLDS. main.js itself cannot be
// require()'d under node:test (see test/helpers/source-scan.js's "NO TEST IN
// THIS REPO LOADS main.js"), so these tests exercise the window-factory
// close-handler wiring against a fake `releaseVaultHoldsForWindow` delegate
// modeling main.js's real contract — now built over the REAL refcounted
// suppression holder (src/main/vault/autolock-suppression.js), NOT the retired
// per-flow `size === 0` boolean discipline: drop this window's pending adopt
// admin-key entry and release ALL of this window's holds; the store flag is
// holders > 0, so suppression stays up while ANY other window (either flow —
// adopt or compromise) still holds a pending reveal.
// ---------------------------------------------------------------------------

const { createSuppressionHolder } = require('../../src/main/vault/autolock-suppression');

function vaultHoldsFake(initialHolds) {
  // The store's setAutoLockSuspended flag, driven by the REAL holder.
  const store = { suspendAutoLock: false };
  const holder = createSuppressionHolder({
    setSuspended: (on) => {
      store.suspendAutoLock = on;
    }
  });
  const pendingAdoptKeys = new Map();
  for (const [chromeId, reason, adoptKey] of initialHolds) {
    holder.acquire(chromeId, reason);
    if (adoptKey !== undefined) pendingAdoptKeys.set(chromeId, adoptKey);
  }
  const calls = [];
  // Models main.js's releaseVaultHoldsForWindow byte-for-byte.
  const releaseVaultHoldsForWindow = (chromeId) => {
    calls.push(chromeId);
    if (chromeId == null) return;
    pendingAdoptKeys.delete(chromeId);
    holder.releaseWindow(chromeId);
  };
  return { holder, store, pendingAdoptKeys, calls, releaseVaultHoldsForWindow };
}

test("window close releases the resolved chrome id's holds on the holder and un-suppresses once nothing remains held", () => {
  const fake = vaultHoldsFake([[900, 'adopt', 'admin-key-b64']]);
  assert.equal(fake.store.suspendAutoLock, true, 'precondition: the adopt hold suspends autolock');
  const h = createHarness({
    releaseVaultHoldsForWindow: fake.releaseVaultHoldsForWindow,
    chromeForAttachment: (win) => (win ? { id: 900 } : null)
  });
  const rec = h.factory.createWindow();
  rec.win.emit('close');

  assert.deepEqual(fake.calls, [900], 'called with the resolved chrome id');
  assert.equal(fake.pendingAdoptKeys.has(900), false, 'the pending admin-key entry is removed');
  assert.equal(fake.holder.count(), 0, "the window's holds are released");
  assert.equal(fake.store.suspendAutoLock, false, 'holders > 0 is the flag — zero holders un-suspends');
});

test("window close leaves autolock suspended while another window holds a pending reveal — EITHER flow's (the DD5 cross-flow pin)", () => {
  // Window 900 holds an adopt reveal; window 901 holds a COMPROMISE reveal. Closing
  // 900 releases only 900's hold — under the retired two-boolean discipline this is
  // exactly the case where whichever flow emptied first would have un-suppressed
  // while 901's dismiss-locked one-time display was still on screen.
  const fake = vaultHoldsFake([
    [900, 'adopt', 'this-window-key'],
    [901, 'compromise']
  ]);
  const h = createHarness({
    releaseVaultHoldsForWindow: fake.releaseVaultHoldsForWindow,
    chromeForAttachment: (win) => (win ? { id: 900 } : null)
  });
  const rec = h.factory.createWindow();
  rec.win.emit('close');

  assert.deepEqual(fake.calls, [900]);
  assert.equal(fake.pendingAdoptKeys.has(900), false, "this window's adopt entry is removed");
  assert.equal(fake.holder.isHeld(901, 'compromise'), true, "the other window's compromise hold is untouched");
  assert.equal(fake.store.suspendAutoLock, true, "suspension stays while another window's reveal is pending");
});

test('window close calls releaseVaultHoldsForWindow with undefined when the window resolves no chrome (no-op, per the real contract)', () => {
  const fake = vaultHoldsFake([[900, 'adopt', 'admin-key-b64']]);
  const h = createHarness({
    releaseVaultHoldsForWindow: fake.releaseVaultHoldsForWindow,
    chromeForAttachment: () => null
  });
  const rec = h.factory.createWindow();
  rec.win.emit('close');

  assert.deepEqual(fake.calls, [undefined]);
  assert.equal(fake.pendingAdoptKeys.size, 1, 'an unrelated window close never touches a hold it does not own');
  assert.equal(fake.store.suspendAutoLock, true);
});

test('absent releaseVaultHoldsForWindow dep is tolerated at window close (optional-chained)', () => {
  const h = createHarness({ chromeForAttachment: (win) => (win ? { id: 900 } : null) });
  const rec = h.factory.createWindow();
  assert.doesNotThrow(() => rec.win.emit('close'));
});
