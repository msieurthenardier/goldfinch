'use strict';

// Unit net for the extracted per-window find-overlay manager (M09 F7 Leg 1, DD5).
// Mirrors test/unit/menu-overlay-manager.test.js — the pure-module exemplar — because
// find-overlay-manager.js is its structural sibling: the same lazy-singleton /
// destroyed-recreate / render-process-gone / pending-init / syncBounds contracts, plus
// the find-specific session + query half that has no sheet analogue.
//
// main.js's WIRING half is unit-test-exempt (Electron-bound, no offline harness — this
// is why the pure-module pattern exists at all); it leans on the behavior-test invariant
// set + the live smoke. This file covers the extracted module.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createFindOverlayManager } = require('../../src/main/find-overlay-manager');
const { computeFindOverlayBounds } = require('../../src/main/find-overlay-geometry');

// ---------------------------------------------------------------------------
// Fakes: createOverlayView returns a recording view whose webContents is a minimal
// emitter; getContentView returns a recording contentView or null (null-window
// tolerance). getTabContents returns a recording fake guest. No Electron anywhere.
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

function makeFakeGuest() {
  const wc = {
    calls: [],
    stopFindInPage: (action) => wc.calls.push(['stopFindInPage', action]),
    focus: () => wc.calls.push(['focus']),
    findInPage: (text, opts) => wc.calls.push(['findInPage', text, opts])
  };
  return wc;
}

// A guest bounds rect the geometry helper maps to a known overlay rect.
const GUEST = { x: 0, y: 88, width: 1400, height: 812 };

let cv;
let createdViews;
let mgr;
let guests; // Map<wcId, fake wc>
let findable; // Set<wcId> — the window's live, non-trusted tabs
let activeGuestBounds;
let chromeSends;

function setup({ contentView } = {}) {
  cv = contentView === undefined ? makeFakeContentView() : contentView;
  createdViews = [];
  guests = new Map();
  findable = new Set();
  activeGuestBounds = null;
  chromeSends = [];
  mgr = createFindOverlayManager({
    getContentView: () => cv,
    createOverlayView: () => {
      const v = makeFakeView();
      createdViews.push(v);
      return v;
    },
    getActiveGuestBounds: () => activeGuestBounds,
    computeBounds: computeFindOverlayBounds,
    getTabContents: (wcId) => guests.get(wcId) || null,
    isFindableTab: (wcId) => findable.has(wcId),
    notifyChrome: (channel, payload) => chromeSends.push([channel, payload])
  });
}

/** Register a findable fake guest tab and return its recording webContents. */
function addTab(wcId) {
  const wc = makeFakeGuest();
  guests.set(wcId, wc);
  findable.add(wcId);
  return wc;
}

beforeEach(() => setup());

// ---------------------------------------------------------------------------
// Lazy singleton / show / hide — the template's lifecycle contract list
// ---------------------------------------------------------------------------

test('repeated shows create the overlay view exactly once (lazy singleton)', () => {
  mgr.show();
  mgr.hide();
  mgr.show();
  mgr.show();
  assert.equal(createdViews.length, 1, 'createOverlayView called once');
  assert.equal(mgr.getView(), createdViews[0]);
});

test('show applies computed bounds, then addChildView, then setVisible(true)', () => {
  mgr.syncBounds(GUEST); // stored while hidden
  mgr.show();
  const v = createdViews[0];
  // The bar's rect is the GEOMETRY of the guest bounds, not the guest bounds
  // themselves — the find overlay's one structural difference from the sheet, whose
  // bounds are an identity mapping (F8 DD12).
  assert.deepEqual(v.calls[0], ['setBounds', computeFindOverlayBounds(GUEST)]);
  const setVisibleIdx = v.calls.findIndex((c) => c[0] === 'setVisible' && c[1] === true);
  assert.ok(setVisibleIdx >= 0, 'setVisible(true) called');
  assert.equal(cv.calls.length, 1, 'one addChildView');
  assert.equal(cv.calls[0][0], 'addChildView');
  const setBoundsIdx = v.calls.findIndex((c) => c[0] === 'setBounds');
  assert.ok(setBoundsIdx < setVisibleIdx, 'bounds applied before setVisible(true)');
  assert.equal(mgr.isVisible(), true);
});

test('show without any known guest bounds skips setBounds (next tab-set-bounds corrects)', () => {
  // computeBounds does not tolerate null — the guard is what keeps a never-sized
  // window from throwing on first show.
  mgr.show();
  const v = createdViews[0];
  assert.equal(
    v.calls.some((c) => c[0] === 'setBounds'),
    false,
    'no setBounds when no guest bounds have ever been seen'
  );
  assert.equal(mgr.isVisible(), true);
});

test('show prefers the LIVE active-guest bounds over the stored fallback', () => {
  const stale = { x: 0, y: 88, width: 800, height: 600 };
  mgr.syncBounds(stale);
  activeGuestBounds = GUEST; // the record has a live active guest
  mgr.show();
  const v = createdViews[0];
  assert.deepEqual(v.calls[0], ['setBounds', computeFindOverlayBounds(GUEST)], 'per-call live fetch wins');
});

test('show falls back to the stored bounds when the record has no live active guest', () => {
  mgr.syncBounds(GUEST);
  activeGuestBounds = null;
  mgr.show();
  const v = createdViews[0];
  assert.deepEqual(v.calls[0], ['setBounds', computeFindOverlayBounds(GUEST)], 'last-resort fallback used');
});

test('show with null contentView is a state-preserving no-op (visible stays false)', () => {
  setup({ contentView: null });
  assert.doesNotThrow(() => mgr.show());
  assert.equal(mgr.isVisible(), false, 'visible must NOT flip');
  assert.equal(createdViews.length, 0, 'no view created before mutating state');
  assert.equal(mgr.getView(), null);
});

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
// syncBounds: store-always / apply-while-visible
// ---------------------------------------------------------------------------

test('syncBounds while visible re-applies the computed bounds', () => {
  mgr.show();
  const v = createdViews[0];
  const before = v.calls.length;
  mgr.syncBounds(GUEST);
  assert.deepEqual(v.calls[before], ['setBounds', computeFindOverlayBounds(GUEST)]);
});

test('syncBounds while hidden only stores (applied on next show)', () => {
  mgr.show();
  mgr.hide();
  const v = createdViews[0];
  const before = v.calls.length;
  mgr.syncBounds(GUEST);
  assert.equal(v.calls.length, before, 'no setBounds while hidden');
  mgr.show();
  assert.deepEqual(
    v.calls.find((c, i) => i >= before && c[0] === 'setBounds'),
    ['setBounds', computeFindOverlayBounds(GUEST)],
    'stored bounds applied on the next show'
  );
});

// ---------------------------------------------------------------------------
// Crash / destruction recovery
// ---------------------------------------------------------------------------

test('a destroyed webContents causes ensure/show to rebuild a fresh view', () => {
  mgr.show();
  createdViews[0].webContents.markDestroyed();
  mgr.show();
  assert.equal(createdViews.length, 2, 'fresh view built after destruction');
  assert.equal(mgr.getView(), createdViews[1]);
  assert.equal(mgr.isVisible(), true);
});

test('render-process-gone tears down so the next show rebuilds (no dead-view re-show)', () => {
  mgr.show();
  const first = createdViews[0];
  // Crash: the WebContents object stays ALIVE (isDestroyed() false) — the
  // construction-time listener's teardown is what guarantees the rebuild.
  first.webContents.emit('render-process-gone');
  assert.equal(mgr.getView(), null, 'teardown nulled the view');
  assert.equal(mgr.isVisible(), false);
  assert.equal(cv.calls.filter((c) => c[0] === 'removeChildView').length, 1);
  mgr.show();
  assert.equal(createdViews.length, 2, 'next show rebuilt a fresh view');
});

test('teardown destroys the webContents, resets state; later show recreates', () => {
  mgr.syncBounds(GUEST);
  mgr.show();
  mgr.teardown();
  assert.ok(
    createdViews[0].calls.some((c) => c[0] === 'destroy'),
    'webContents destroyed — the view is gone, not merely detached'
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
  assert.equal(cv.calls.filter((c) => c[0] === 'removeChildView').length, removesBefore);
});

test('teardown when never shown is a safe no-op', () => {
  assert.doesNotThrow(() => mgr.teardown());
  assert.equal(mgr.getView(), null);
});

test('teardown clears the find session (the F8 DD5 ordering pin depends on this)', () => {
  // The `close` handler runs find teardown BEFORE the sheet's teardown so the sheet's
  // teardown-reason find-restore naturally no-ops. That no-op is only automatic
  // because teardown nulls the session.
  addTab(7);
  mgr.openSession(7, 'hello');
  assert.equal(mgr.getSessionTabWcId(), 7);
  mgr.teardown();
  assert.equal(mgr.getSessionTabWcId(), null, 'session nulled by teardown');
  assert.equal(mgr.isSessionActive(7), false);
});

test('did-finish-load flips readiness; teardown resets it', () => {
  mgr.show();
  assert.equal(mgr.isReady(), false, 'not ready before load');
  createdViews[0].webContents.emit('did-finish-load');
  assert.equal(mgr.isReady(), true, 'ready after did-finish-load');
  mgr.teardown();
  assert.equal(mgr.isReady(), false, 'reset on teardown');
});

// ---------------------------------------------------------------------------
// Pending-init queue (AC7 first-load race): latest wins; a close clears the seed
// ---------------------------------------------------------------------------

test('an open before load queues exactly one init seed, delivered on did-finish-load', () => {
  addTab(7);
  mgr.openSession(7, 'seed-text');
  const v = createdViews[0];
  assert.equal(
    v.calls.some((c) => c[0] === 'send'),
    false,
    'nothing delivered before the page loaded'
  );
  v.webContents.emit('did-finish-load');
  const sends = v.calls.filter((c) => c[0] === 'send');
  assert.equal(sends.length, 1, 'exactly one init delivered');
  assert.deepEqual(sends[0], ['send', 'find-overlay:init', { findText: 'seed-text' }]);
});

test('pending init: latest seed wins (a re-target before load does not deliver the stale one)', () => {
  addTab(7);
  addTab(8);
  mgr.openSession(7, 'first');
  mgr.openSession(8, 'second'); // retargets: closes 7's session, opens 8's
  const v = createdViews[0];
  v.webContents.emit('did-finish-load');
  const sends = v.calls.filter((c) => c[0] === 'send');
  assert.equal(sends.length, 1, 'only one init delivered');
  assert.deepEqual(sends[0][2], { findText: 'second' }, 'latest seed wins');
});

test('a session close before load clears the seed so a stale init never fires', () => {
  addTab(7);
  mgr.openSession(7, 'doomed');
  mgr.closeSession({ refocusGuest: false });
  const v = createdViews[0];
  v.webContents.emit('did-finish-load');
  assert.equal(
    v.calls.some((c) => c[0] === 'send'),
    false,
    'no init delivered against a closed session'
  );
});

test('an open AFTER load delivers init immediately (and focuses the bar)', () => {
  addTab(7);
  mgr.show();
  const v = createdViews[0];
  v.webContents.emit('did-finish-load');
  mgr.openSession(7, 'now');
  const sends = v.calls.filter((c) => c[0] === 'send');
  assert.deepEqual(sends.at(-1), ['send', 'find-overlay:init', { findText: 'now' }]);
  assert.ok(v.calls.some((c) => c[0] === 'focus'), 'DD6: main focuses the overlay wc');
});

// ---------------------------------------------------------------------------
// openSession — the find-specific contracts with no sheet analogue
// ---------------------------------------------------------------------------

test('openSession refuses a non-findable target (absent / trusted-internal / destroyed)', () => {
  // DD4: find is web-tab-only. isFindableTab encodes present + !trusted + live.
  mgr.openSession(99, 'nope');
  assert.equal(mgr.getSessionTabWcId(), null, 'no session opened');
  assert.equal(createdViews.length, 0, 'no view constructed for a refused open');
  assert.equal(mgr.isVisible(), false);
});

test('AC6e: re-open on the already-targeted tab re-focuses WITHOUT re-seeding init', () => {
  // Re-init would wipe whatever the user has typed into the overlay input.
  addTab(7);
  mgr.openSession(7, 'typed');
  const v = createdViews[0];
  v.webContents.emit('did-finish-load');
  const sendsBefore = v.calls.filter((c) => c[0] === 'send').length;
  const focusBefore = v.calls.filter((c) => c[0] === 'focus').length;

  mgr.openSession(7, 'DIFFERENT');

  assert.equal(
    v.calls.filter((c) => c[0] === 'send').length,
    sendsBefore,
    'no re-init — the typed text survives'
  );
  assert.equal(
    v.calls.filter((c) => c[0] === 'focus').length,
    focusBefore + 1,
    're-focused instead'
  );
  assert.equal(mgr.getSessionTabWcId(), 7);
});

test('a session open for a DIFFERENT tab closes the old one first (defensive retarget)', () => {
  const oldGuest = addTab(7);
  addTab(8);
  mgr.openSession(7, 'a');
  mgr.openSession(8, 'b');
  // The old guest's highlight is cleared, and NO refocus (it is not the explicit
  // close path).
  assert.deepEqual(oldGuest.calls, [['stopFindInPage', 'clearSelection']]);
  assert.equal(mgr.getSessionTabWcId(), 8);
  assert.equal(mgr.isSessionActive(7), false);
  assert.equal(mgr.isSessionActive(8), true);
});

test('isSessionActive is null-safe and false when no session is open', () => {
  assert.equal(mgr.isSessionActive(null), false);
  assert.equal(mgr.isSessionActive(undefined), false);
  assert.equal(mgr.isSessionActive(7), false);
});

// ---------------------------------------------------------------------------
// closeSession — the AC5 refocus contract
// ---------------------------------------------------------------------------

test('closeSession always stops the find; refocuses the guest ONLY when refocusGuest', () => {
  const guest = addTab(7);
  mgr.openSession(7, 'x');
  mgr.closeSession({ refocusGuest: true });
  assert.deepEqual(guest.calls, [
    ['stopFindInPage', 'clearSelection'],
    ['focus']
  ]);
});

test('closeSession with refocusGuest:false never focuses the guest (AC5)', () => {
  // Every implicit close — tab-switch, tab-close, window teardown — passes false:
  // refocusing there lands OS focus on a view about to be hidden and steals focus
  // from tab-strip keyboard navigation.
  const guest = addTab(7);
  mgr.openSession(7, 'x');
  mgr.closeSession({ refocusGuest: false });
  assert.deepEqual(guest.calls, [['stopFindInPage', 'clearSelection']]);
});

test('closeSession hides the bar and clears the session', () => {
  addTab(7);
  mgr.openSession(7, 'x');
  assert.equal(mgr.isVisible(), true);
  mgr.closeSession({ refocusGuest: false });
  assert.equal(mgr.isVisible(), false);
  assert.equal(mgr.getSessionTabWcId(), null);
  assert.equal(cv.calls.filter((c) => c[0] === 'removeChildView').length, 1);
});

test('closeSession with no session open is a no-op', () => {
  assert.doesNotThrow(() => mgr.closeSession({ refocusGuest: true }));
  assert.equal(cv.calls.length, 0);
});

test('closeSession tolerates a destroyed/mid-destruction target guest', () => {
  // The tab-close path closes the session AFTER tabViews.delete, so the guest
  // resolves null — the close must still hide and clear.
  addTab(7);
  mgr.openSession(7, 'x');
  guests.delete(7); // the entry is gone; getTabContents resolves null
  assert.doesNotThrow(() => mgr.closeSession({ refocusGuest: false }));
  assert.equal(mgr.getSessionTabWcId(), null);
  assert.equal(mgr.isVisible(), false);
});

// ---------------------------------------------------------------------------
// query — the HAT-1 findNext inversion. The single most-regressed contract in the
// overlay's history (carried silently as "faithful parity" through two migrations).
// Electron's FindInPageOptions.findNext means "begin a NEW session" — the INVERSE of
// the legacy <webview>-era reading the payload's `findNext` still uses.
// ---------------------------------------------------------------------------

test('HAT-1: the FIRST query of a session begins a NEW engine session (findNext:true)', () => {
  const guest = addTab(7);
  mgr.openSession(7, '');
  mgr.query({ text: 'cat', findNext: false });
  assert.deepEqual(guest.calls.at(-1), [
    'findInPage',
    'cat',
    { findNext: true, forward: true, matchCase: false }
  ]);
});

test('HAT-1: same text + step ⇒ findNext:false (continue the engine session)', () => {
  const guest = addTab(7);
  mgr.openSession(7, '');
  mgr.query({ text: 'cat', findNext: true }); // first — new session
  mgr.query({ text: 'cat', findNext: true }); // step on unchanged text
  assert.deepEqual(guest.calls.at(-1), [
    'findInPage',
    'cat',
    { findNext: false, forward: true, matchCase: false }
  ]);
});

test('HAT-1: CHANGED text ⇒ findNext:true even when the payload says step', () => {
  // The regression this pins: Chromium keeps advancing the OLD session when the text
  // changed, so an edited term must force a new session or it never re-searches.
  const guest = addTab(7);
  mgr.openSession(7, '');
  mgr.query({ text: 'cat', findNext: true });
  mgr.query({ text: 'cats', findNext: true });
  assert.deepEqual(guest.calls.at(-1), [
    'findInPage',
    'cats',
    { findNext: true, forward: true, matchCase: false }
  ]);
});

test('HAT-1: empty text makes NO engine call and resets the session text', () => {
  const guest = addTab(7);
  mgr.openSession(7, '');
  mgr.query({ text: 'cat', findNext: true });
  const callsBefore = guest.calls.length;
  mgr.query({ text: '', findNext: true });
  assert.equal(guest.calls.length, callsBefore, 'no findInPage and NO stopFindInPage');
  // The reset is observable: the next non-empty query must begin a NEW session even
  // though the text matches the pre-delete one.
  mgr.query({ text: 'cat', findNext: true });
  assert.deepEqual(guest.calls.at(-1), [
    'findInPage',
    'cat',
    { findNext: true, forward: true, matchCase: false }
  ]);
});

test('a NEW session resets the last-queried text (first query re-searches)', () => {
  // Retargeting to tab 8 must not let tab 7's 'cat' make 8's first 'cat' look like a
  // step — the new target's first query has to begin a fresh engine session.
  addTab(7);
  const newGuest = addTab(8);
  mgr.openSession(7, '');
  mgr.query({ text: 'cat', findNext: true });
  mgr.openSession(8, ''); // fresh session target
  mgr.query({ text: 'cat', findNext: true });
  assert.deepEqual(newGuest.calls.at(-1), [
    'findInPage',
    'cat',
    { findNext: true, forward: true, matchCase: false }
  ]);
});

test('query forwards EVERY query text to chrome, empty included (DD9 deletion sync)', () => {
  addTab(7);
  mgr.openSession(7, '');
  mgr.query({ text: 'cat', findNext: false });
  mgr.query({ text: '', findNext: false });
  assert.deepEqual(chromeSends, [
    ['find-overlay-text', { wcId: 7, text: 'cat' }],
    ['find-overlay-text', { wcId: 7, text: '' }]
  ]);
});

test('query honors forward and matchCase (forward defaults true, matchCase defaults false)', () => {
  const guest = addTab(7);
  mgr.openSession(7, '');
  mgr.query({ text: 'cat', findNext: false, forward: false, matchCase: true });
  assert.deepEqual(guest.calls.at(-1), [
    'findInPage',
    'cat',
    { findNext: true, forward: false, matchCase: true }
  ]);
});

test('query with no live session is a no-op', () => {
  mgr.query({ text: 'cat', findNext: true });
  assert.deepEqual(chromeSends, [], 'nothing forwarded without a session');
});

test('query with a non-string text is dropped before any chrome notify', () => {
  addTab(7);
  mgr.openSession(7, '');
  mgr.query({ text: 42, findNext: true });
  assert.deepEqual(chromeSends, []);
});

test('query against a stale/destroyed target resolves null and no-ops', () => {
  addTab(7);
  mgr.openSession(7, '');
  guests.delete(7);
  assert.doesNotThrow(() => mgr.query({ text: 'cat', findNext: true }));
  assert.deepEqual(chromeSends, []);
});

// ---------------------------------------------------------------------------
// PER-INSTANCE ISOLATION — the whole point of the leg (recon S9).
// The shared-slot bug is unrepresentable once the state is closure-local, but pin it
// so a future refactor back to module scope fails loudly instead of silently.
// ---------------------------------------------------------------------------

function makeIsolatedManager() {
  const ctx = {
    cv: makeFakeContentView(),
    views: [],
    guests: new Map(),
    findable: new Set(),
    activeGuestBounds: null,
    chromeSends: []
  };
  ctx.mgr = createFindOverlayManager({
    getContentView: () => ctx.cv,
    createOverlayView: () => {
      const v = makeFakeView();
      ctx.views.push(v);
      return v;
    },
    getActiveGuestBounds: () => ctx.activeGuestBounds,
    computeBounds: computeFindOverlayBounds,
    getTabContents: (wcId) => ctx.guests.get(wcId) || null,
    isFindableTab: (wcId) => ctx.findable.has(wcId),
    notifyChrome: (channel, payload) => ctx.chromeSends.push([channel, payload])
  });
  ctx.addTab = (wcId) => {
    const wc = makeFakeGuest();
    ctx.guests.set(wcId, wc);
    ctx.findable.add(wcId);
    return wc;
  };
  return ctx;
}

test('two instances share NO state: a syncBounds on A never moves B\'s view', () => {
  const a = makeIsolatedManager();
  const b = makeIsolatedManager();
  a.mgr.show();
  b.mgr.show();
  const bCallsBefore = b.views[0].calls.length;

  a.mgr.syncBounds(GUEST);

  assert.deepEqual(a.views[0].calls.at(-1), ['setBounds', computeFindOverlayBounds(GUEST)]);
  assert.equal(b.views[0].calls.length, bCallsBefore, "B's view was not touched");
});

test("two instances share NO state: A's session never appears in B", () => {
  const a = makeIsolatedManager();
  const b = makeIsolatedManager();
  a.addTab(7);
  a.mgr.openSession(7, 'x');

  assert.equal(a.mgr.getSessionTabWcId(), 7);
  assert.equal(b.mgr.getSessionTabWcId(), null, "B has no session");
  assert.equal(b.mgr.isSessionActive(7), false, "A's target is not active in B");
  assert.equal(b.mgr.isVisible(), false, "B's bar never showed");
});

test("two instances share NO state: tearing down A leaves B fully live", () => {
  // The leg's headline: closing one window destroys ONLY that window's overlays.
  const a = makeIsolatedManager();
  const b = makeIsolatedManager();
  a.addTab(7);
  b.addTab(8);
  a.mgr.openSession(7, 'x');
  b.mgr.openSession(8, 'y');

  a.mgr.teardown();

  assert.equal(a.mgr.getView(), null, "A's view destroyed");
  assert.ok(a.views[0].calls.some((c) => c[0] === 'destroy'));
  assert.equal(b.mgr.getSessionTabWcId(), 8, "B's session intact");
  assert.equal(b.mgr.isVisible(), true, "B's bar still shown");
  assert.equal(b.mgr.getView(), b.views[0], "B's view still live");
  assert.equal(
    b.views[0].calls.some((c) => c[0] === 'destroy'),
    false,
    "B's view was NOT destroyed"
  );
});

test('two instances each keep their own last-queried text (HAT-1 state is per-instance)', () => {
  const a = makeIsolatedManager();
  const b = makeIsolatedManager();
  const aGuest = a.addTab(7);
  const bGuest = b.addTab(8);
  a.mgr.openSession(7, '');
  b.mgr.openSession(8, '');

  a.mgr.query({ text: 'cat', findNext: true }); // A: new session on 'cat'
  b.mgr.query({ text: 'cat', findNext: true }); // B: FIRST query — must be a new session

  assert.deepEqual(bGuest.calls.at(-1)[2], { findNext: true, forward: true, matchCase: false });
  // And A stepping on its own unchanged text still continues its session.
  a.mgr.query({ text: 'cat', findNext: true });
  assert.deepEqual(aGuest.calls.at(-1)[2], { findNext: false, forward: true, matchCase: false });
});
