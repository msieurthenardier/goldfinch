'use strict';

// M14 F1 L1 (flight DD1) — the HTML fullscreen window-record mode. Offline
// per house style: fake registry/records/views (register-tab-ipc.test.js
// shapes); the module under test is the REAL createHtmlFullscreen.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHtmlFullscreen } = require('../../src/main/html-fullscreen');

const SLOT = { x: 0, y: 80, width: 1000, height: 700 };
const FULL = { x: 0, y: 0, width: 1200, height: 800 };

function setup() {
  const log = [];
  const records = [];
  const chromeSends = [];
  const registry = {
    getWindowForGuest: (wcId) => records.find((r) => r.tabViews.has(wcId)) || null
  };
  const htmlFullscreen = createHtmlFullscreen({
    registry,
    // Resolves like the registry class-3 helper: null once the tab is unowned.
    chromeForTab: (wcId) => {
      const rec = registry.getWindowForGuest(wcId);
      return rec ? { send: (channel) => chromeSends.push([channel, rec.win.id]) } : null;
    },
    logger: { warn: (...args) => log.push(['warn', args[0]]) }
  });
  function makeRecord(id) {
    const record = {
      win: {
        id,
        destroyed: false,
        isDestroyed() {
          return this.destroyed;
        },
        contentBounds: { width: FULL.width, height: FULL.height },
        getContentBounds() {
          return { ...this.contentBounds };
        },
        contentView: { addChildView: (view) => log.push(['add-view', id, view.webContents.id]) }
      },
      tabViews: new Map(),
      activeTabWcId: null,
      htmlFullscreen: null,
      findOverlay: null,
      sheet: null
    };
    records.push(record);
    return record;
  }
  function addTab(record, wcId) {
    const view = {
      bounds: { ...SLOT },
      webContents: {
        id: wcId,
        destroyed: false,
        isDestroyed() {
          return this.destroyed;
        },
        // Rejected on purpose: the module MUST attach its own .catch — a
        // missing one would surface as an unhandled rejection in this suite.
        executeJavaScript: (code) => {
          log.push(['exec', wcId, code]);
          return Promise.reject(new Error('no page'));
        }
      },
      setBounds(b) {
        this.bounds = { ...b };
        log.push(['bounds', wcId, { ...b }]);
      },
      getBounds() {
        return { ...this.bounds };
      }
    };
    record.tabViews.set(wcId, { view, trusted: false, active: false });
    return view;
  }
  return { htmlFullscreen, registry, log, chromeSends, makeRecord, addTab };
}

function armedRecord(h, { withOverlays = false } = {}) {
  const record = h.makeRecord(1);
  const view = h.addTab(record, 101);
  record.activeTabWcId = 101;
  if (withOverlays) {
    record.findOverlay = {
      sessionWcId: null,
      isSessionActive(wcId) {
        return this.sessionWcId === wcId;
      },
      hide: () => h.log.push(['hide-find']),
      show: () => h.log.push(['show-find']),
      syncBounds: (b) => h.log.push(['sync-find', { ...b }])
    };
    record.sheet = { closeMenuOverlay: (reason) => h.log.push(['close-menu', reason]) };
  }
  return { record, view };
}

test('enter snapshots the slot rect, expands in ONE step, raises the guest, and hides both overlays', () => {
  const h = setup();
  const { record, view } = armedRecord(h, { withOverlays: true });
  h.htmlFullscreen.enter(101);

  assert.deepEqual(record.htmlFullscreen, { wcId: 101, savedBounds: SLOT, pendingBounds: null });
  assert.deepEqual(view.bounds, FULL);
  assert.equal(h.log.filter((x) => x[0] === 'bounds').length, 1, 'expand is a single discrete setBounds step');
  const boundsIdx = h.log.findIndex((x) => x[0] === 'bounds');
  const raiseIdx = h.log.findIndex((x) => x[0] === 'add-view');
  assert.ok(raiseIdx > boundsIdx, 'raise (re-add) follows the expand');
  assert.ok(
    h.log.some((x) => x[0] === 'hide-find'),
    'find overlay hidden (tab-hide mirror)'
  );
  assert.deepEqual(
    h.log.find((x) => x[0] === 'close-menu'),
    ['close-menu', 'tab-hide'],
    'sheet closed with a tab-lifecycle-family reason'
  );
});

test('enter refuses a background tab: no mode, and the page is asked to exit', () => {
  const h = setup();
  const record = h.makeRecord(1);
  h.addTab(record, 101);
  const back = h.addTab(record, 102);
  record.activeTabWcId = 101;

  h.htmlFullscreen.enter(102);
  assert.equal(record.htmlFullscreen, null);
  assert.deepEqual(back.bounds, SLOT, 'background guest bounds untouched');
  assert.deepEqual(
    h.log.find((x) => x[0] === 'exec'),
    ['exec', 102, 'document.exitFullscreen()']
  );
});

test('double enter is idempotent — the slot snapshot is NOT overwritten with the full rect', () => {
  const h = setup();
  const { record } = armedRecord(h);
  h.htmlFullscreen.enter(101);
  h.htmlFullscreen.enter(101);
  assert.deepEqual(
    record.htmlFullscreen.savedBounds,
    SLOT,
    're-snapshot would capture the full-window rect and wedge restore'
  );
  assert.equal(h.log.filter((x) => x[0] === 'bounds').length, 1, 'no second setBounds step');
});

test('enter refuses cleanly when the record or window is gone', () => {
  const h = setup();
  assert.doesNotThrow(() => h.htmlFullscreen.enter(999), 'unowned wcId is a no-op');
  const { record } = armedRecord(h);
  record.win.destroyed = true;
  h.htmlFullscreen.enter(101);
  assert.equal(record.htmlFullscreen, null);
});

test('exit restores savedBounds in one step, restores the surviving find session, and sends convergence', () => {
  const h = setup();
  const { record, view } = armedRecord(h, { withOverlays: true });
  record.findOverlay.sessionWcId = 101; // live find session on the fullscreen tab
  h.htmlFullscreen.enter(101);
  h.log.length = 0;

  h.htmlFullscreen.exit(101);
  assert.equal(record.htmlFullscreen, null);
  assert.deepEqual(view.bounds, SLOT);
  assert.equal(h.log.filter((x) => x[0] === 'bounds').length, 1, 'restore is a single discrete setBounds step');
  // AC6b mirror ordering: syncBounds(restored) then show() (re-add re-asserts z-order).
  const sync = h.log.findIndex((x) => x[0] === 'sync-find');
  const show = h.log.findIndex((x) => x[0] === 'show-find');
  assert.ok(sync !== -1 && show > sync, 'find restore = syncBounds then show');
  assert.deepEqual(h.log[sync][1], SLOT, 'find overlay synced to the RESTORED rect');
  assert.deepEqual(h.chromeSends, [['trigger-send-bounds', 1]], 'renderer convergence send');

  // Idempotent: a second leave (Blink Esc + page ask both firing) restores nothing twice.
  h.log.length = 0;
  h.chromeSends.length = 0;
  h.htmlFullscreen.exit(101);
  assert.deepEqual(h.log, []);
  assert.deepEqual(h.chromeSends, []);
});

test('exit skips the find restore when no session is active on that tab', () => {
  const h = setup();
  const { record } = armedRecord(h, { withOverlays: true });
  h.htmlFullscreen.enter(101);
  h.log.length = 0;
  h.htmlFullscreen.exit(101);
  assert.equal(
    h.log.some((x) => x[0] === 'show-find'),
    false
  );
  assert.equal(record.htmlFullscreen, null);
});

test('exit applies pendingBounds over savedBounds when a deferred renderer send arrived', () => {
  const h = setup();
  const { record, view } = armedRecord(h);
  h.htmlFullscreen.enter(101);
  const fresh = { x: 0, y: 90, width: 1100, height: 640 };
  assert.equal(h.htmlFullscreen.handleRendererBounds(record, 101, fresh), true);
  h.htmlFullscreen.exit(101);
  assert.deepEqual(view.bounds, fresh, 'the deferred (fresher) slot rect wins — no stale-rect flash');
});

test('handleRendererBounds defers ONLY the fullscreen tab; other tabs return false and apply normally', () => {
  const h = setup();
  const { record } = armedRecord(h);
  h.addTab(record, 102);
  assert.equal(h.htmlFullscreen.handleRendererBounds(record, 101, SLOT), false, 'no mode armed → not handled');
  h.htmlFullscreen.enter(101);
  assert.equal(h.htmlFullscreen.handleRendererBounds(record, 102, SLOT), false, 'background tab is never deferred');
  const fresh = { x: 0, y: 82, width: 990, height: 690 };
  assert.equal(h.htmlFullscreen.handleRendererBounds(record, 101, fresh), true);
  assert.deepEqual(record.htmlFullscreen.pendingBounds, fresh);
});

test('handleWindowResize re-expands to the NEW content bounds while fullscreen and no-ops otherwise', () => {
  const h = setup();
  const { record, view } = armedRecord(h);
  h.htmlFullscreen.handleWindowResize(record);
  assert.deepEqual(view.bounds, SLOT, 'no mode → no-op');
  h.htmlFullscreen.enter(101);
  record.win.contentBounds = { width: 1440, height: 900 };
  h.log.length = 0;
  h.htmlFullscreen.handleWindowResize(record);
  assert.deepEqual(view.bounds, { x: 0, y: 0, width: 1440, height: 900 });
  assert.equal(h.log.filter((x) => x[0] === 'bounds').length, 1, 're-expand is a single discrete step');
});

test('forceExit asks the live page to leave, restores synchronously, and a following leave is a no-op', () => {
  const h = setup();
  const { record, view } = armedRecord(h);
  h.htmlFullscreen.enter(101);
  h.log.length = 0;

  h.htmlFullscreen.forceExit(record);
  // Synchronous by contract: state is restored on RETURN, not on a later tick.
  assert.equal(record.htmlFullscreen, null);
  assert.deepEqual(view.bounds, SLOT);
  assert.deepEqual(
    h.log.find((x) => x[0] === 'exec'),
    ['exec', 101, 'document.exitFullscreen()']
  );

  // The page-side exit ask will still fire 'leave-html-full-screen' → exit():
  // mode already cleared → restore must not run twice.
  h.log.length = 0;
  h.htmlFullscreen.exit(101);
  assert.deepEqual(h.log, []);
});

test('forceExit on destroyed contents is record cleanup only — no view touch, no page ask', () => {
  const h = setup();
  const { record, view } = armedRecord(h);
  h.htmlFullscreen.enter(101);
  view.webContents.destroyed = true;
  h.log.length = 0;

  h.htmlFullscreen.forceExit(record);
  assert.equal(record.htmlFullscreen, null);
  assert.equal(
    h.log.some((x) => x[0] === 'bounds'),
    false,
    'restore path never touches a destroyed view'
  );
  assert.equal(
    h.log.some((x) => x[0] === 'exec'),
    false
  );
});

test('forceExit after the tab entry is gone (tab-close edge) clears the mode without a convergence send', () => {
  const h = setup();
  const { record } = armedRecord(h);
  h.htmlFullscreen.enter(101);
  record.tabViews.delete(101); // tab-close already removed + destroyed the entry
  h.chromeSends.length = 0;

  assert.doesNotThrow(() => h.htmlFullscreen.forceExit(record));
  assert.equal(record.htmlFullscreen, null, 'the armed gate never survives its tab');
  assert.deepEqual(h.chromeSends, [], 'chromeForTab resolves null for the unowned wcId');
});

test('enter while ANOTHER tab holds the mode force-exits the holder first (defense-in-depth)', () => {
  const h = setup();
  const record = h.makeRecord(1);
  const first = h.addTab(record, 101);
  const second = h.addTab(record, 102);
  record.activeTabWcId = 101;
  h.htmlFullscreen.enter(101);
  // Activation moved on without the IPC edge running (defensive scenario).
  record.activeTabWcId = 102;

  h.htmlFullscreen.enter(102);
  assert.deepEqual(first.bounds, SLOT, 'previous holder restored');
  assert.deepEqual(second.bounds, FULL, 'new holder expanded');
  assert.deepEqual(record.htmlFullscreen && record.htmlFullscreen.wcId, 102);
});

test('isFullscreen answers membership for exactly the holding tab', () => {
  const h = setup();
  const { record } = armedRecord(h);
  h.addTab(record, 102);
  assert.equal(h.htmlFullscreen.isFullscreen(101), false);
  h.htmlFullscreen.enter(101);
  assert.equal(h.htmlFullscreen.isFullscreen(101), true);
  assert.equal(h.htmlFullscreen.isFullscreen(102), false);
  assert.equal(h.htmlFullscreen.isFullscreen(999), false, 'unowned wcId is false, not a throw');
});

// ---------------------------------------------------------------------------
// M14 F1 L2 — the optional onExited(record) observer (auth re-present trigger).
// ---------------------------------------------------------------------------

function setupWithExitObserver() {
  const exits = [];
  const registryRecords = [];
  const registry = {
    getWindowForGuest: (wcId) => registryRecords.find((r) => r.tabViews.has(wcId)) || null
  };
  const htmlFullscreen = createHtmlFullscreen({
    registry,
    chromeForTab: () => ({ send: () => {} }),
    onExited: (record) => exits.push(record),
    logger: { warn: () => {} }
  });
  const record = {
    win: {
      isDestroyed: () => false,
      getContentBounds: () => ({ width: FULL.width, height: FULL.height }),
      contentView: { addChildView: () => {} }
    },
    tabViews: new Map(),
    activeTabWcId: 10,
    htmlFullscreen: null,
    findOverlay: null,
    sheet: null
  };
  record.tabViews.set(10, {
    view: {
      bounds: { ...SLOT },
      webContents: { id: 10, isDestroyed: () => false, executeJavaScript: () => Promise.resolve() },
      setBounds() {},
      getBounds() {
        return { ...SLOT };
      }
    },
    trusted: false,
    active: true
  });
  registryRecords.push(record);
  return { htmlFullscreen, record, exits };
}

test('onExited fires on every exit edge (page exit + forceExit), strictly after the mode clears (M14 F1 L2)', () => {
  const h = setupWithExitObserver();
  h.htmlFullscreen.enter(10);
  assert.equal(h.exits.length, 0, 'enter fires no exit');
  h.htmlFullscreen.exit(10);
  assert.equal(h.exits.length, 1);
  assert.equal(h.exits[0], h.record, 'record-shaped, for the auth store');
  assert.equal(h.record.htmlFullscreen, null, 'mode already cleared when the observer ran');

  h.htmlFullscreen.enter(10);
  h.htmlFullscreen.forceExit(h.record);
  assert.equal(h.exits.length, 2, 'forceExit reaches the observer through the shared restore path');
});

test('onExited does NOT fire for a no-op exit (no mode armed) and defaults to a no-op when absent', () => {
  const h = setupWithExitObserver();
  h.htmlFullscreen.exit(10); // nothing armed
  h.htmlFullscreen.forceExit(h.record);
  assert.equal(h.exits.length, 0);
  // Absent injection: the L1 setup() harness above builds without onExited —
  // every prior test in this file passing IS the no-op-default proof.
});
