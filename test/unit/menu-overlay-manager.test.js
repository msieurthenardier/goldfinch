'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createMenuOverlayManager } = require('../../src/main/menu-overlay-manager');

// ---------------------------------------------------------------------------
// Fakes (AC9): createSheetView returns a recording view whose webContents is a
// minimal emitter (on/isDestroyed/destroy); getContentView returns a recording
// contentView or null (null-window tolerance). No Electron anywhere.
// ---------------------------------------------------------------------------

function makeFakeView() {
  const listeners = new Map();
  let destroyed = false;
  const view = {
    calls: [],
    webContents: {
      on: (event, cb) => {
        listeners.set(event, cb);
      },
      emit: (event, ...args) => {
        const cb = listeners.get(event);
        if (cb) cb(...args);
      },
      isDestroyed: () => destroyed,
      destroy: () => {
        destroyed = true;
        view.calls.push(['destroy']);
      },
      focus: () => {
        view.calls.push(['focus']);
      },
      send: (channel, payload) => {
        view.calls.push(['send', channel, payload]);
      },
      markDestroyed: () => {
        destroyed = true;
      }
    },
    setBounds: (b) => {
      view.calls.push(['setBounds', b]);
    },
    setVisible: (v) => {
      view.calls.push(['setVisible', v]);
    }
  };
  return view;
}

function makeFakeContentView() {
  const cv = {
    calls: [],
    addChildView: (v) => {
      cv.calls.push(['addChildView', v]);
    },
    removeChildView: (v) => {
      cv.calls.push(['removeChildView', v]);
    }
  };
  return cv;
}

let cv;
let createdViews;
let mgr;

function setup({ contentView } = {}) {
  cv = contentView === undefined ? makeFakeContentView() : contentView;
  createdViews = [];
  mgr = createMenuOverlayManager({
    getContentView: () => cv,
    createSheetView: () => {
      const v = makeFakeView();
      createdViews.push(v);
      return v;
    }
  });
}

beforeEach(() => setup());

// ---------------------------------------------------------------------------
// AC9 — single creation across repeated shows
// ---------------------------------------------------------------------------

test('repeated shows create the sheet view exactly once (lazy singleton)', () => {
  mgr.show();
  mgr.hide();
  mgr.show();
  mgr.show();
  assert.equal(createdViews.length, 1, 'createSheetView called once');
  assert.equal(mgr.getView(), createdViews[0]);
});

// ---------------------------------------------------------------------------
// AC9 — show applies stored bounds and add-then-setVisible ordering
// ---------------------------------------------------------------------------

test('show applies stored bounds, then addChildView, then setVisible(true)', () => {
  const bounds = { x: 0, y: 88, width: 1400, height: 812 };
  mgr.syncBounds(bounds); // stored while hidden
  mgr.show();
  const v = createdViews[0];
  assert.deepEqual(v.calls[0], ['setBounds', bounds], 'stored bounds applied on show');
  // Ordering: setBounds (view) → addChildView (contentView) → setVisible (view).
  // The contentView add must precede setVisible(true).
  const setVisibleIdx = v.calls.findIndex(
    (c) => c[0] === 'setVisible' && c[1] === true
  );
  assert.ok(setVisibleIdx >= 0, 'setVisible(true) called');
  assert.equal(cv.calls.length, 1, 'one addChildView');
  assert.equal(cv.calls[0][0], 'addChildView');
  // setBounds happened before setVisible
  const setBoundsIdx = v.calls.findIndex((c) => c[0] === 'setBounds');
  assert.ok(setBoundsIdx < setVisibleIdx, 'bounds applied before setVisible(true)');
  assert.equal(mgr.isVisible(), true);
});

test('show without any stored bounds skips setBounds (next tab-set-bounds corrects)', () => {
  mgr.show();
  const v = createdViews[0];
  assert.equal(
    v.calls.some((c) => c[0] === 'setBounds'),
    false,
    'no setBounds when no guest bounds ever seen'
  );
  assert.equal(mgr.isVisible(), true);
});

// ---------------------------------------------------------------------------
// AC9 — show with null getContentView() is a state-preserving no-op
// ---------------------------------------------------------------------------

test('show with null contentView is a state-preserving no-op (visible stays false)', () => {
  setup({ contentView: null });
  assert.doesNotThrow(() => mgr.show());
  assert.equal(mgr.isVisible(), false, 'visible must NOT flip (F7 parity)');
  assert.equal(createdViews.length, 0, 'no view created before mutating state');
  assert.equal(mgr.getView(), null);
});

// ---------------------------------------------------------------------------
// AC9 — show never focuses the sheet's webContents (AC2)
// ---------------------------------------------------------------------------

test('show never calls webContents.focus()', () => {
  mgr.syncBounds({ x: 0, y: 0, width: 100, height: 100 });
  mgr.show();
  mgr.show(); // re-show / re-assert path too
  const v = createdViews[0];
  assert.equal(
    v.calls.some((c) => c[0] === 'focus'),
    false,
    'the guest must keep focus (AC2)'
  );
});

// ---------------------------------------------------------------------------
// AC9 — hide is visibility-gated and idempotent
// ---------------------------------------------------------------------------

test('hide before any show is a no-op (removeChildView of a non-child is UB)', () => {
  assert.doesNotThrow(() => mgr.hide());
  assert.equal(cv.calls.length, 0, 'no removeChildView');
});

test('hide removes the child once; second hide is a no-op', () => {
  mgr.show();
  mgr.hide();
  mgr.hide();
  const removes = cv.calls.filter((c) => c[0] === 'removeChildView');
  assert.equal(removes.length, 1, 'exactly one removeChildView');
  assert.equal(mgr.isVisible(), false);
});

test('hide never uses setVisible(false)-only (view removed from the stack)', () => {
  mgr.show();
  mgr.hide();
  const v = createdViews[0];
  assert.equal(
    v.calls.some((c) => c[0] === 'setVisible' && c[1] === false),
    false,
    'hide is removeChildView, not setVisible(false)'
  );
  assert.equal(cv.calls.at(-1)[0], 'removeChildView');
});

// ---------------------------------------------------------------------------
// AC9 — syncBounds: applies while visible, only stores while hidden
// ---------------------------------------------------------------------------

test('syncBounds while visible re-applies bounds 1:1', () => {
  mgr.show();
  const v = createdViews[0];
  const before = v.calls.length;
  const b = { x: 60, y: 100, width: 1000, height: 700 };
  mgr.syncBounds(b);
  assert.deepEqual(v.calls[before], ['setBounds', b], 'applied immediately while visible');
});

test('syncBounds while hidden only stores (applied on next show)', () => {
  mgr.show();
  mgr.hide();
  const v = createdViews[0];
  const before = v.calls.length;
  const b = { x: 5, y: 6, width: 700, height: 500 };
  mgr.syncBounds(b);
  assert.equal(v.calls.length, before, 'no setBounds while hidden');
  mgr.show();
  assert.deepEqual(
    v.calls.find((c, i) => i >= before && c[0] === 'setBounds'),
    ['setBounds', b],
    'stored bounds applied on the next show'
  );
});

// ---------------------------------------------------------------------------
// AC9 — destroyed-recreate guard
// ---------------------------------------------------------------------------

test('a destroyed webContents causes ensure/show to rebuild a fresh view', () => {
  mgr.show();
  createdViews[0].webContents.markDestroyed();
  mgr.show();
  assert.equal(createdViews.length, 2, 'fresh view built after destruction');
  assert.equal(mgr.getView(), createdViews[1]);
  assert.equal(mgr.isVisible(), true);
});

// ---------------------------------------------------------------------------
// AC9 — render-process-gone causes the next ensure to rebuild
// ---------------------------------------------------------------------------

test('render-process-gone tears down so the next show rebuilds (no dead-view re-show)', () => {
  mgr.show();
  const first = createdViews[0];
  // Crash: the WebContents object stays ALIVE (isDestroyed() false) — the
  // construction-time listener's teardown is what guarantees the rebuild.
  first.webContents.emit('render-process-gone');
  assert.equal(mgr.getView(), null, 'teardown nulled the view');
  assert.equal(mgr.isVisible(), false);
  // Crash-while-visible removed the dead view from the stack.
  assert.equal(cv.calls.filter((c) => c[0] === 'removeChildView').length, 1);
  mgr.show();
  assert.equal(createdViews.length, 2, 'next show rebuilt a fresh view');
  assert.equal(mgr.getView(), createdViews[1]);
});

// ---------------------------------------------------------------------------
// AC9 — teardown destroys and resets so a later show recreates
// ---------------------------------------------------------------------------

test('teardown destroys the webContents, resets state; later show recreates', () => {
  mgr.syncBounds({ x: 1, y: 2, width: 30, height: 40 });
  mgr.show();
  mgr.teardown();
  const first = createdViews[0];
  assert.ok(
    first.calls.some((c) => c[0] === 'destroy'),
    'webContents destroyed'
  );
  assert.equal(mgr.getView(), null);
  assert.equal(mgr.isVisible(), false);
  assert.equal(
    cv.calls.filter((c) => c[0] === 'removeChildView').length,
    1,
    'removed from the stack while visible'
  );
  mgr.show();
  assert.equal(createdViews.length, 2, 'later show recreated the view');
});

test('teardown while hidden does not removeChildView and does not throw', () => {
  mgr.show();
  mgr.hide();
  const removesBefore = cv.calls.filter((c) => c[0] === 'removeChildView').length;
  assert.doesNotThrow(() => mgr.teardown());
  const removesAfter = cv.calls.filter((c) => c[0] === 'removeChildView').length;
  assert.equal(removesAfter, removesBefore, 'no second removeChildView');
});

test('teardown when never shown is a safe no-op', () => {
  assert.doesNotThrow(() => mgr.teardown());
  assert.equal(mgr.getView(), null);
});

// ---------------------------------------------------------------------------
// Readiness flag: did-finish-load flips it; recreate resets it
// ---------------------------------------------------------------------------

test('did-finish-load flips readiness; teardown resets it', () => {
  mgr.show();
  assert.equal(mgr.isReady(), false, 'not ready before load');
  createdViews[0].webContents.emit('did-finish-load');
  assert.equal(mgr.isReady(), true, 'ready after did-finish-load');
  mgr.teardown();
  assert.equal(mgr.isReady(), false, 'reset on teardown');
});

// ===========================================================================
// Leg 2 (DD4/DD5) — openMenu / closeMenuOverlay protocol state machine (AC10)
// ===========================================================================

let chromeSends; // recorded sendToChrome calls: [channel, payload]
let hideFindCalls;
let restoreReasons; // recorded restoreFindOverlay(reason) calls
let focusChromeCalls;

function setupProto({ contentView } = {}) {
  cv = contentView === undefined ? makeFakeContentView() : contentView;
  createdViews = [];
  chromeSends = [];
  hideFindCalls = 0;
  restoreReasons = [];
  focusChromeCalls = 0;
  mgr = createMenuOverlayManager({
    getContentView: () => cv,
    createSheetView: () => {
      const v = makeFakeView();
      createdViews.push(v);
      return v;
    },
    sendToChrome: (channel, payload) => {
      chromeSends.push([channel, payload]);
    },
    hideFindOverlay: () => {
      hideFindCalls++;
    },
    restoreFindOverlay: (reason) => {
      restoreReasons.push(reason);
    },
    focusChrome: () => {
      focusChromeCalls++;
    }
  });
}

function payloadFor(token, menuType = 'kebab') {
  return {
    menuType,
    model: [{ id: 'settings', label: 'Settings' }],
    anchor: { alignRight: 500, y: 0 },
    startIndex: 0,
    token
  };
}

// Ready the (lazily-created) sheet so init delivery is synchronous.
function readySheet() {
  mgr.ensureView();
  createdViews[0].webContents.emit('did-finish-load');
}

const closes = () => chromeSends.filter((c) => c[0] === 'menu-overlay-closed');

test('bare teardown clears an open menu state and drops the sheet view', () => {
  setupProto();
  mgr.openMenu(payloadFor(1));
  mgr.teardown();
  assert.equal(mgr.isMenuOpen(), false);
  assert.equal(mgr.getView(), null);
});

test('openMenu shows, hides the find overlay, delivers init then focuses (ready path)', () => {
  setupProto();
  readySheet();
  const p = payloadFor(1);
  mgr.openMenu(p);
  const v = createdViews[0];
  assert.equal(mgr.isVisible(), true, 'sheet shown');
  assert.equal(mgr.isMenuOpen(), true);
  assert.deepEqual(mgr.getCurrentMenu(), { menuType: 'kebab', token: 1 });
  assert.equal(hideFindCalls, 1, 'DD5 sheet-show hook ran');
  const sendIdx = v.calls.findIndex((c) => c[0] === 'send' && c[1] === 'menu-overlay:init');
  const focusIdx = v.calls.findIndex((c) => c[0] === 'focus');
  assert.ok(sendIdx >= 0, 'init delivered');
  assert.deepEqual(v.calls[sendIdx][2], p, 'init carries the full open payload (incl. token)');
  assert.ok(focusIdx > sendIdx, 'focus AFTER init delivery');
});

test('openMenu before load queues init (latest wins); did-finish-load delivers + focuses once', () => {
  setupProto();
  mgr.openMenu(payloadFor(1));
  mgr.openMenu(payloadFor(2, 'kebab'));
  const v = createdViews[0];
  assert.equal(
    v.calls.some((c) => c[0] === 'send'),
    false,
    'nothing delivered before load'
  );
  v.webContents.emit('did-finish-load');
  const sends = v.calls.filter((c) => c[0] === 'send' && c[1] === 'menu-overlay:init');
  assert.equal(sends.length, 1, 'exactly one queued init delivered (latest wins)');
  assert.equal(sends[0][2].token, 2, 'the LATEST open won the queue');
  assert.ok(
    v.calls.some((c) => c[0] === 'focus'),
    'focus delivered by the did-finish-load path'
  );
});

test('close before load clears the queued init — a stale seed never fires', () => {
  setupProto();
  mgr.openMenu(payloadFor(1));
  mgr.closeMenuOverlay('blur');
  createdViews[0].webContents.emit('did-finish-load');
  assert.equal(
    createdViews[0].calls.some((c) => c[0] === 'send'),
    false,
    'no init delivered against a closed menu'
  );
});

test('open-while-open is MODEL-REPLACE: superseded channel 7 with the OLD token, no hide/re-show', () => {
  setupProto();
  readySheet();
  mgr.openMenu(payloadFor(1, 'kebab'));
  const removesBefore = cv.calls.filter((c) => c[0] === 'removeChildView').length;
  mgr.openMenu(payloadFor(2, 'container'));
  assert.equal(closes().length, 1, 'one channel-7 close for the superseded menu');
  assert.deepEqual(closes()[0][1], { menuType: 'kebab', reason: 'superseded', token: 1 });
  assert.equal(
    cv.calls.filter((c) => c[0] === 'removeChildView').length,
    removesBefore,
    'NO hide during model-replace (no flicker)'
  );
  assert.deepEqual(mgr.getCurrentMenu(), { menuType: 'container', token: 2 });
  const sends = createdViews[0].calls.filter((c) => c[0] === 'send' && c[1] === 'menu-overlay:init');
  assert.equal(sends.length, 2, 'the replacing menu got its own init');
  assert.equal(sends[1][2].token, 2);
});

test('closeMenuOverlay hides, emits channel 7 {menuType, reason, token}, runs the DD5 hook', () => {
  setupProto();
  readySheet();
  mgr.openMenu(payloadFor(3));
  mgr.closeMenuOverlay('escape');
  assert.equal(mgr.isVisible(), false, 'sheet hidden');
  assert.equal(mgr.isMenuOpen(), false);
  assert.equal(closes().length, 1);
  assert.deepEqual(closes()[0][1], { menuType: 'kebab', reason: 'escape', token: 3 });
  assert.deepEqual(restoreReasons, ['escape'], 'DD5 restore hook received the reason');
});

test('closeMenuOverlay is IDEMPOTENT — double blur (app switch) yields exactly one close effect', () => {
  setupProto();
  readySheet();
  mgr.openMenu(payloadFor(4));
  mgr.closeMenuOverlay('blur'); // BaseWindow blur
  mgr.closeMenuOverlay('blur'); // the sheet's own blur, arriving second
  assert.equal(closes().length, 1, 'chrome sees exactly one channel-7 close');
  assert.equal(restoreReasons.length, 1, 'the DD5 restore ran exactly once');
});

test('a STALE token is dropped: the close no-ops and the current menu stays open', () => {
  setupProto();
  readySheet();
  mgr.openMenu(payloadFor(7));
  mgr.closeMenuOverlay('blur', 6); // stale sheet report from a previous instance
  assert.equal(mgr.isMenuOpen(), true, 'current menu untouched');
  assert.equal(closes().length, 0, 'no channel-7 emission');
  assert.equal(restoreReasons.length, 0, 'no restore run');
  mgr.closeMenuOverlay('escape', 7); // the matching token closes normally
  assert.equal(mgr.isMenuOpen(), false);
  assert.equal(closes().length, 1);
});

test('focusChrome runs for escape/activated ONLY (reason-resolved refocus, main-side half)', () => {
  for (const reason of ['escape', 'activated']) {
    setupProto();
    readySheet();
    mgr.openMenu(payloadFor(1));
    mgr.closeMenuOverlay(reason);
    assert.equal(focusChromeCalls, 1, `focusChrome ran for '${reason}'`);
  }
  for (const reason of ['blur', 'toggle', 'outside-click', 'superseded', 'tab-switch', 'tab-hide', 'tab-close', 'teardown']) {
    setupProto();
    readySheet();
    mgr.openMenu(payloadFor(1));
    mgr.closeMenuOverlay(reason);
    assert.equal(focusChromeCalls, 0, `focusChrome must NOT run for '${reason}'`);
  }
});

test('the DD5 hook receives EVERY close reason (the tab-lifecycle skip lives in the injected impl)', () => {
  // The manager passes the reason through unconditionally; main.js's injected
  // restoreFindOverlay applies the three-reason skip set. Replicate that impl
  // shape here to pin the skip contract: tab-switch/tab-hide/tab-close restore
  // NOTHING; every other reason restores iff the find session targets the
  // active tab.
  const reasonsSeen = [];
  let restores = 0;
  const mainLikeRestore = (reason) => {
    reasonsSeen.push(reason);
    if (reason === 'tab-switch' || reason === 'tab-hide' || reason === 'tab-close') return;
    restores++; // stands in for `if (isFindOverlayActive(activeTabWcId)) showFindOverlay()`
  };
  const allReasons = ['escape', 'outside-click', 'blur', 'toggle', 'activated', 'superseded', 'tab-switch', 'tab-hide', 'tab-close', 'teardown'];
  for (const reason of allReasons) {
    cv = makeFakeContentView();
    createdViews = [];
    const m = createMenuOverlayManager({
      getContentView: () => cv,
      createSheetView: () => {
        const v = makeFakeView();
        createdViews.push(v);
        return v;
      },
      restoreFindOverlay: mainLikeRestore
    });
    m.ensureView();
    createdViews[0].webContents.emit('did-finish-load');
    m.openMenu(payloadFor(1));
    m.closeMenuOverlay(reason);
  }
  assert.deepEqual(reasonsSeen, allReasons, 'hook invoked with every reason');
  assert.equal(restores, allReasons.length - 3, 'exactly the three tab-lifecycle reasons skipped restore');
});

test('sheet crash with a menu open: channel-7 teardown close FIRST, then rebuildable', () => {
  setupProto();
  readySheet();
  mgr.openMenu(payloadFor(5));
  createdViews[0].webContents.emit('render-process-gone');
  assert.equal(closes().length, 1, 'teardown close emitted');
  assert.deepEqual(closes()[0][1], { menuType: 'kebab', reason: 'teardown', token: 5 });
  assert.deepEqual(restoreReasons, ['teardown'], 'DD5 hook ran (find session still live restores)');
  assert.equal(mgr.getView(), null, 'torn down');
  assert.equal(mgr.isMenuOpen(), false);
  mgr.openMenu(payloadFor(6));
  assert.equal(createdViews.length, 2, 'next open rebuilt a fresh view');
  assert.equal(mgr.isVisible(), true);
});

test('openMenu with a null contentView is a state-preserving no-op', () => {
  setupProto({ contentView: null });
  mgr.openMenu(payloadFor(1));
  assert.equal(mgr.isMenuOpen(), false);
  assert.equal(mgr.isVisible(), false);
  assert.equal(chromeSends.length, 0);
  assert.equal(hideFindCalls, 0);
});

test('openMenu validates the payload shape (missing token/menuType → no-op)', () => {
  setupProto();
  readySheet();
  mgr.openMenu(/** @type {any} */ (null));
  mgr.openMenu(/** @type {any} */ ({ menuType: 'kebab' })); // no token
  mgr.openMenu(/** @type {any} */ ({ token: 1 })); // no menuType
  assert.equal(mgr.isMenuOpen(), false);
  assert.equal(hideFindCalls, 0);
});

test('show() itself still never focuses the sheet — focus enters ONLY via openMenu', () => {
  setupProto();
  readySheet();
  mgr.openMenu(payloadFor(1));
  const v = createdViews[0];
  const focusesAfterOpen = v.calls.filter((c) => c[0] === 'focus').length;
  mgr.show(); // tab-set-active same-tab re-add path
  mgr.show();
  assert.equal(
    v.calls.filter((c) => c[0] === 'focus').length,
    focusesAfterOpen,
    're-add/show never adds focus calls'
  );
});
