'use strict';

const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createGuestWiring, qualifiesAsPopupRequest } = require('../../src/main/guest-wiring');
const { createPopupRegistry } = require('../../src/main/popup-registry');

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

class FakeContents extends EventEmitter {
  constructor(id, internal = false) {
    super();
    this.id = id;
    this.session = { __goldfinchInternal: internal };
    this.destroyed = false;
    this.url = 'https://example.test/page';
    this.openHandler = null;
    this.printCalls = 0;
    this.execCalls = [];
    this.navigationHistory = {
      canGoBack: () => true,
      canGoForward: () => false
    };
  }
  setWindowOpenHandler(fn) {
    this.openHandler = fn;
  }
  isDestroyed() {
    return this.destroyed;
  }
  getURL() {
    return this.url;
  }
  print(_opts, cb) {
    this.printCalls++;
    cb(true);
  }
  // Rejected on purpose: callers MUST attach their own .catch (a missing one
  // surfaces here as an unhandled rejection failing the suite).
  executeJavaScript(code) {
    this.execCalls.push(code);
    return Promise.reject(new Error('no page'));
  }
  setWebRTCIPHandlingPolicy(policy) {
    this.webrtcPolicy = policy;
  }
}

function setup() {
  const sends = [];
  const calls = [];
  const chrome = {
    focus: () => calls.push('focus-chrome'),
    send: (channel, payload) => sends.push([channel, payload])
  };
  const records = new Map();
  const registry = {
    getWindowForGuest(id) {
      return records.get(id) || null;
    }
  };
  let historyRecorder = {
    handleNavigation(payload) {
      calls.push(['history-nav', payload]);
    },
    handleTitleUpdated(id, title) {
      calls.push(['history-title', id, title]);
    },
    forgetTab(id) {
      calls.push(['history-forget', id]);
    }
  };
  // The favicon-fetch harness has its first async cases (AC6): a test overrides
  // this via setFaviconRequest to hand back a controllable deferred promise, so
  // the assertion can await the fake fetch chain before checking h.sends.
  let faviconRequest = () => Promise.resolve(null);
  // M14 F1 L1: fullscreen module fake — event wiring and the Esc branch are
  // asserted against these calls; the real mode logic has its own suite
  // (html-fullscreen.test.js).
  const fullscreenIds = new Set();
  // M14 F2 L1: the REAL popup registry (Electron-free) — integration through
  // the same instance the popup matrix asserts against.
  const popupRegistry = createPopupRegistry();
  const wiring = createGuestWiring({
    registry,
    chromeForTab: () => chrome,
    htmlFullscreen: {
      enter: (id) => calls.push(['fs-enter', id]),
      exit: (id) => calls.push(['fs-exit', id]),
      isFullscreen: (id) => fullscreenIds.has(id)
    },
    // M14 F1 L2: navigation-away auth invalidation — a recording fake.
    authChallenges: { cancelForTab: (wcId, reason) => calls.push(['auth-cancel', wcId, reason]) },
    crossViewNavAction: (input) => {
      calls.push('classify-cross-view');
      if (input.key === 'l') return 'focus-address';
      // M17 F1 L2 (DD6): a shape closer to the real crossViewNavAction, so
      // the handleCrossView tests below can pin the send payload PER ACTION
      // rather than only ever observing the same hardcoded string.
      if (input.key === 'F6') return input.shift ? 'focus-chrome-end' : 'focus-address';
      return null;
    },
    keydownToAction: (input) => {
      calls.push('classify-chrome');
      return input.key === 't' ? 'new-tab' : null;
    },
    isChromeActionForwardable: (action) => action === 'new-tab',
    isRepeatSafeAction: () => false,
    isInternalPageUrl: (url) => url.startsWith('goldfinch://settings'),
    isSafeTabUrl: (url) => url.startsWith('https://'),
    toggleDevTools: (wc) => calls.push(['devtools', wc.id]),
    applyZoom: (wc, action) => calls.push(['zoom', wc.id, action]),
    isInternalContents: (wc) => !!wc.session.__goldfinchInternal,
    getHistoryRecorder: () => historyRecorder,
    broadcastMoveTargetsChanged: () => calls.push('broadcast-targets'),
    faviconFetcher: { request: (args) => faviconRequest(args) },
    popupRegistry,
    webPreloadPath: '/preload/webview-preload.bundle.js',
    // M14 F2 L2 (DD1f seam): a recording fake — the popup teardown must route
    // its resolve-cancel through THIS seam (main.js's cancelForTab delegation).
    cancelChallengesForPopup: (popupWcId) => calls.push(['popup-cancel', popupWcId]),
    logger: { warn() {} }
  });
  return {
    wiring,
    sends,
    calls,
    records,
    chrome,
    fullscreenIds,
    popupRegistry,
    setHistoryRecorder: (value) => {
      historyRecorder = value;
    },
    setFaviconRequest: (fn) => {
      faviconRequest = fn;
    }
  };
}

function inputEvent(url) {
  return {
    url,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    }
  };
}

test('popup inherits the opener partition, targets owning chrome, and always denies native creation', () => {
  const h = setup();
  const wc = new FakeContents(7);
  h.records.set(7, { tabViews: new Map([[7, { partition: 'persist:jar-a' }]]) });
  h.wiring.wireGuestContents(wc);
  assert.deepEqual(wc.openHandler({ url: 'https://popup.test/' }), { action: 'deny' });
  assert.deepEqual(h.sends, [['open-tab', { url: 'https://popup.test/', openerPartition: 'persist:jar-a' }]]);
});

test('will-navigate applies the web and internal allowlists without trust inference (event.url, not a positional url arg)', () => {
  const h = setup();
  const web = new FakeContents(1, false);
  const internal = new FakeContents(2, true);
  h.wiring.wireGuestContents(web);
  h.wiring.wireGuestContents(internal);

  // Mission 13 F3 Leg 3 (AC1): the handler reads event.url exclusively — a
  // positional 2nd emit argument (the deprecated will-navigate shape) is
  // deliberately NOT set here, so this test would fail loudly if a future edit
  // regressed to reading a positional arg instead of event.url.
  const webBad = inputEvent('goldfinch://settings');
  web.emit('will-navigate', webBad);
  assert.equal(webBad.prevented, true);
  const internalGood = inputEvent('goldfinch://settings');
  internal.emit('will-navigate', internalGood);
  assert.equal(internalGood.prevented, false);
  const internalBad = inputEvent('https://example.test/');
  internal.emit('will-navigate', internalBad);
  assert.equal(internalBad.prevented, true);
});

test('will-frame-navigate and will-redirect enforce the same predicate as will-navigate, reading event.url (Mission 13 F3 Leg 3 / AC1)', () => {
  const h = setup();
  const web = new FakeContents(20, false);
  h.wiring.wireGuestContents(web);

  // will-frame-navigate is emitted with the SINGLE details-object shape Electron
  // actually uses — { url, isMainFrame, preventDefault } — NOT a positional 2nd
  // arg. A test emitting `(event, url)` here would pass even against the buggy
  // `(event, url)` handler signature this leg fixes, masking the real bug.
  const subframeBad = {
    url: 'javascript:alert(1)',
    isMainFrame: false,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    }
  };
  web.emit('will-frame-navigate', subframeBad);
  assert.equal(subframeBad.prevented, true, 'subframe nav to a disallowed scheme must be prevented');

  const subframeGood = {
    url: 'https://example.test/frame',
    isMainFrame: false,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    }
  };
  web.emit('will-frame-navigate', subframeGood);
  assert.equal(subframeGood.prevented, false, 'subframe nav to an allowed https URL must NOT be prevented');

  const redirectBad = inputEvent('file:///etc/passwd');
  web.emit('will-redirect', redirectBad);
  assert.equal(redirectBad.prevented, true, 'redirect to a disallowed scheme must be prevented');

  const redirectGood = inputEvent('https://example.test/redirected');
  web.emit('will-redirect', redirectGood);
  assert.equal(redirectGood.prevented, false, 'redirect to an allowed https URL must NOT be prevented');
});

// ---------------------------------------------------------------------------
// M14 F1 L4 (DD5): frame-scoped PDF-viewer carve-out matrix. Each case drives
// the CAPTURED per-event handler (emit on the named event) — the carve-out
// wrapper REPLACES the will-frame-navigate registration, so testing a single
// shared function would not match the registration shape.
// ---------------------------------------------------------------------------

const PDF_VIEWER_URL = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/stream-uuid';

function navEvent(url, extra = {}) {
  return {
    url,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    ...extra
  };
}

test('PDF-viewer carve-out: a will-frame-navigate SUBFRAME event to the pinned viewer id is allowed (DD5)', () => {
  const h = setup();
  const web = new FakeContents(40, false);
  h.wiring.wireGuestContents(web);
  const event = navEvent(PDF_VIEWER_URL, { isMainFrame: false });
  web.emit('will-frame-navigate', event);
  assert.equal(event.prevented, false, 'the viewer subframe is the one admitted navigation');
});

test('PDF-viewer carve-out: top-frame will-navigate and will-redirect to the viewer URL stay refused (guardNav untouched)', () => {
  const h = setup();
  const web = new FakeContents(41, false);
  h.wiring.wireGuestContents(web);

  const nav = navEvent(PDF_VIEWER_URL, { isMainFrame: true });
  web.emit('will-navigate', nav);
  assert.equal(nav.prevented, true, 'top-frame will-navigate refused — page-JS location= stays blocked');

  const redirect = navEvent(PDF_VIEWER_URL, { isMainFrame: true });
  web.emit('will-redirect', redirect);
  assert.equal(redirect.prevented, true, 'top-frame will-redirect refused');
});

test('PDF-viewer carve-out: a SUBFRAME will-redirect to the viewer URL is refused — the carve-out lives on will-frame-navigate only (DD5 strictness)', () => {
  const h = setup();
  const web = new FakeContents(42, false);
  h.wiring.wireGuestContents(web);
  const event = navEvent(PDF_VIEWER_URL, { isMainFrame: false });
  web.emit('will-redirect', event);
  assert.equal(event.prevented, true, 'will-redirect carries bare guardNav even for subframes');
});

test('PDF-viewer carve-out: a will-frame-navigate top-frame event (isMainFrame true) to the viewer URL is refused', () => {
  const h = setup();
  const web = new FakeContents(43, false);
  h.wiring.wireGuestContents(web);
  const event = navEvent(PDF_VIEWER_URL, { isMainFrame: true });
  web.emit('will-frame-navigate', event);
  assert.equal(event.prevented, true);
});

test('PDF-viewer carve-out: an event LACKING isMainFrame entirely is refused — strict === false fails closed (DD5)', () => {
  const h = setup();
  const web = new FakeContents(44, false);
  h.wiring.wireGuestContents(web);
  const event = navEvent(PDF_VIEWER_URL); // no isMainFrame field at all
  web.emit('will-frame-navigate', event);
  assert.equal(event.prevented, true, 'absent isMainFrame must not satisfy the subframe condition');
});

test('PDF-viewer carve-out: a different extension id is refused — the allow is id-pinned, never scheme-wide', () => {
  const h = setup();
  const web = new FakeContents(45, false);
  h.wiring.wireGuestContents(web);
  const event = navEvent('chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh/stream', { isMainFrame: false });
  web.emit('will-frame-navigate', event);
  assert.equal(event.prevented, true);
});

test('PDF-viewer carve-out: an unparseable subframe URL falls through to guardNav and is refused (URL-parse, never startsWith)', () => {
  const h = setup();
  const web = new FakeContents(46, false);
  h.wiring.wireGuestContents(web);
  // 'chrome-extension://[bad/x' genuinely THROWS in new URL() (unclosed
  // bracket host) — exercising the catch branch, not merely a host mismatch.
  const event = navEvent('chrome-extension://[bad/x', { isMainFrame: false });
  web.emit('will-frame-navigate', event);
  assert.equal(event.prevented, true);
});

test('PDF-viewer carve-out: ordinary http(s) subframes are unaffected — delegation to guardNav is byte-identical for non-viewer URLs', () => {
  const h = setup();
  const web = new FakeContents(47, false);
  h.wiring.wireGuestContents(web);

  const allowed = navEvent('https://example.test/frame', { isMainFrame: false });
  web.emit('will-frame-navigate', allowed);
  assert.equal(allowed.prevented, false, 'allowed subframe stays allowed');

  const refused = navEvent('file:///etc/passwd', { isMainFrame: false });
  web.emit('will-frame-navigate', refused);
  assert.equal(refused.prevented, true, 'disallowed subframe stays refused');
});

test('PDF-viewer carve-out: an INTERNAL guest gets no carve-out — a viewer subframe event on the internal session is refused', () => {
  const h = setup();
  const internal = new FakeContents(48, true);
  h.wiring.wireGuestContents(internal);
  const event = navEvent(PDF_VIEWER_URL, { isMainFrame: false });
  internal.emit('will-frame-navigate', event);
  assert.equal(event.prevented, true, 'internal guests keep the internal allowlist — no plugins, no viewer');
});

test('a guest latched by wireGuestContents is NOT blocked by a catch-all-style nav guard on an https navigation (Mission 13 F3 Leg 3 / AC3)', () => {
  const h = setup();
  const web = new FakeContents(21, false);
  h.wiring.wireGuestContents(web);
  assert.equal(web.__goldfinchNavGuarded, true, 'wireGuestContents must set the latch synchronously');

  // Simulate the app-lifecycle catch-all's guard: it early-returns whenever the
  // latch is present, deferring entirely to the guest's own predicate above.
  let catchAllPrevented = false;
  const catchAllGuard = (event) => {
    if (web.__goldfinchNavGuarded) return;
    catchAllPrevented = true;
    event.preventDefault();
  };
  const event = inputEvent('https://example.test/next');
  catchAllGuard(event);
  web.emit('will-navigate', event);
  assert.equal(catchAllPrevented, false, 'the latch must short-circuit the catch-all guard for guests');
  assert.equal(event.prevented, false, 'a legitimate https navigation on a latched guest is never blocked');
});

test('cross-view shortcut classification runs before generalized forwarding for both guest kinds', () => {
  const h = setup();
  const web = new FakeContents(1, false);
  const internal = new FakeContents(2, true);
  h.wiring.wireGuestContents(web);
  h.wiring.wireGuestContents(internal);

  const webEvent = inputEvent();
  web.emit('before-input-event', webEvent, { type: 'keyDown', key: 'l', control: true });
  assert.deepEqual(h.calls.slice(0, 2), ['classify-cross-view', 'focus-chrome']);
  assert.equal(h.calls.includes('classify-chrome'), false, 'cross-view early return prevents double dispatch');

  h.calls.length = 0;
  const internalEvent = inputEvent();
  internal.emit('before-input-event', internalEvent, { type: 'keyDown', key: 't', control: true });
  assert.deepEqual(h.calls, ['classify-cross-view', 'classify-chrome']);
  assert.deepEqual(h.sends.at(-1), ['chrome-shortcut-action', { action: 'new-tab' }]);
});

// ---------------------------------------------------------------------------
// M17 F1 L2 (DD6): handleCrossView forwards the COMPUTED action — a design-
// review fix (it used to hardcode 'focus-address', which would have made
// Shift+F6's 'focus-chrome-end' silently behave like plain F6).
// ---------------------------------------------------------------------------

test('handleCrossView forwards the computed action — send payload differs for F6 vs Shift+F6 (DD6)', () => {
  const h = setup();
  const web = new FakeContents(50, false);
  h.wiring.wireGuestContents(web);

  const f6 = inputEvent();
  web.emit('before-input-event', f6, { type: 'keyDown', key: 'F6' });
  assert.equal(f6.prevented, true);
  assert.deepEqual(h.sends.at(-1), ['chrome-shortcut-action', { action: 'focus-address' }]);

  const shiftF6 = inputEvent();
  web.emit('before-input-event', shiftF6, { type: 'keyDown', key: 'F6', shift: true });
  assert.equal(shiftF6.prevented, true);
  assert.deepEqual(h.sends.at(-1), ['chrome-shortcut-action', { action: 'focus-chrome-end' }]);
});

test('handleCrossView suppresses the focus-then-send pair on auto-repeat but still preventDefaults', () => {
  const h = setup();
  const web = new FakeContents(51, false);
  h.wiring.wireGuestContents(web);

  const event = inputEvent();
  web.emit('before-input-event', event, { type: 'keyDown', key: 'F6', isAutoRepeat: true });
  assert.equal(event.prevented, true, 'the key is still swallowed on repeat');
  assert.deepEqual(h.sends, [], 'no repeated send on auto-repeat');
  assert.equal(h.calls.includes('focus-chrome'), false, 'no repeated chrome.focus() either');
});

// M14 F1 L1 (DD1): enter/leave-html-full-screen route to the injected module —
// web guests only (an internal page must never seize the window).
test('html fullscreen events wire to the module on web guests only', () => {
  const h = setup();
  const web = new FakeContents(5, false);
  const internal = new FakeContents(6, true);
  h.wiring.wireGuestContents(web);
  h.wiring.wireGuestContents(internal);

  assert.equal(internal.listenerCount('enter-html-full-screen'), 0);
  assert.equal(internal.listenerCount('leave-html-full-screen'), 0);
  web.emit('enter-html-full-screen');
  web.emit('leave-html-full-screen');
  assert.deepEqual(
    h.calls.filter((x) => Array.isArray(x) && String(x[0]).startsWith('fs-')),
    [
      ['fs-enter', 5],
      ['fs-exit', 5]
    ]
  );
});

// M14 F1 L1 (DD1): defensive Esc — page-side exit ask, no preventDefault, only
// while this contents holds the mode, auto-repeat-guarded.
test('defensive Esc asks the fullscreen page to exit without preventDefault', () => {
  const h = setup();
  const web = new FakeContents(5, false);
  h.wiring.wireGuestContents(web);

  // Not fullscreen: Esc does nothing.
  const idle = inputEvent();
  web.emit('before-input-event', idle, { type: 'keyDown', key: 'Escape' });
  assert.deepEqual(web.execCalls, []);

  // Fullscreen: the page is asked to exit; the event is NOT prevented (the
  // page may run its own Esc handling; Blink's native exit stays primary).
  h.fullscreenIds.add(5);
  const event = inputEvent();
  web.emit('before-input-event', event, { type: 'keyDown', key: 'Escape' });
  assert.deepEqual(web.execCalls, ['document.exitFullscreen()']);
  assert.equal(event.prevented, false);

  // Auto-repeat guarded: a held Esc asks once, not per repeat.
  web.emit('before-input-event', inputEvent(), { type: 'keyDown', key: 'Escape', isAutoRepeat: true });
  assert.equal(web.execCalls.length, 1);
});

test('web-only accelerators and DevTools state never attach to internal guests', () => {
  const h = setup();
  const web = new FakeContents(1, false);
  const internal = new FakeContents(2, true);
  h.wiring.wireGuestContents(web);
  h.wiring.wireGuestContents(internal);
  assert.equal(web.listenerCount('devtools-opened'), 1);
  assert.equal(internal.listenerCount('devtools-opened'), 0);
  web.emit('devtools-opened');
  web.emit('devtools-closed');
  assert.deepEqual(h.sends.slice(-2), [
    ['devtools-state-changed', { wcId: 1, open: true }],
    ['devtools-state-changed', { wcId: 1, open: false }]
  ]);
});

test('tab events forward navigation, record history, retitle active move targets, and fan find counts to the owning overlay', () => {
  const h = setup();
  const wc = new FakeContents(9);
  const overlaySends = [];
  const overlayWc = { isDestroyed: () => false, send: (channel, payload) => overlaySends.push([channel, payload]) };
  h.records.set(9, {
    activeTabWcId: 9,
    findOverlay: { isSessionActive: () => true, getView: () => ({ webContents: overlayWc }) }
  });
  h.wiring.wireTabViewEvents({ webContents: wc }, 9, 'persist:jar-a');
  wc.emit('did-navigate');
  wc.emit('page-title-updated', {}, 'New title');
  wc.emit('found-in-page', {}, { activeMatchOrdinal: 2, matches: 5 });

  assert.deepEqual(h.sends.slice(0, 3), [
    ['tab-did-navigate', { wcId: 9, url: wc.url }],
    ['tab-nav-state', { wcId: 9, canGoBack: true, canGoForward: false }],
    ['tab-title', { wcId: 9, title: 'New title' }]
  ]);
  assert.ok(h.calls.some((x) => Array.isArray(x) && x[0] === 'history-nav'));
  assert.ok(h.calls.includes('broadcast-targets'));
  assert.deepEqual(overlaySends, [['find-overlay:count', { activeMatchOrdinal: 2, matches: 5 }]]);
});

test('page-favicon-updated routes through the favicon fetcher and forwards a data: URL only on success', async () => {
  const h = setup();
  const wc = new FakeContents(11);
  let capturedArgs = null;
  const pending = deferred();
  h.setFaviconRequest((args) => {
    capturedArgs = args;
    return pending.promise;
  });
  h.wiring.wireTabViewEvents({ webContents: wc }, 11, 'persist:jar-a');

  wc.emit('page-favicon-updated', {}, ['https://example.test/favicon.ico']);
  assert.deepEqual(h.sends, [], 'nothing is sent before the fetch resolves');
  assert.equal(capturedArgs.wcId, 11);
  assert.deepEqual(capturedArgs.favicons, ['https://example.test/favicon.ico']);
  assert.equal(typeof capturedArgs.fetchImpl, 'function');

  pending.resolve('data:image/png;base64,AAAA');
  await pending.promise;
  await Promise.resolve(); // let the .then() microtask run
  assert.deepEqual(h.sends, [['tab-favicon', { wcId: 11, favicons: ['data:image/png;base64,AAAA'] }]]);
});

test('page-favicon-updated forwards nothing when the fetch resolves to null (failure) — no raw remote URL ever reaches the chrome', async () => {
  const h = setup();
  const wc = new FakeContents(12);
  const pending = deferred();
  h.setFaviconRequest(() => pending.promise);
  h.wiring.wireTabViewEvents({ webContents: wc }, 12, 'persist:jar-a');

  wc.emit('page-favicon-updated', {}, ['https://example.test/favicon.ico']);
  pending.resolve(null);
  await pending.promise;
  await Promise.resolve();
  assert.deepEqual(h.sends, []);
});

test('destroyed tab guards every tab-event side effect and history recorder is read live', () => {
  const h = setup();
  const wc = new FakeContents(3);
  h.records.set(3, { activeTabWcId: 3, findOverlay: null });
  h.wiring.wireTabViewEvents({ webContents: wc }, 3, 'persist:jar-a');
  h.setHistoryRecorder(null);
  wc.destroyed = true;
  wc.emit('did-navigate');
  assert.deepEqual(h.sends, []);
  assert.deepEqual(h.calls, []);
});

// ---------------------------------------------------------------------------
// M14 F1 L2 (DD2): did-start-navigation → pending-auth-challenge invalidation.
// Main-frame, non-same-document only — a hash change / pushState / subframe
// navigation must never cancel a live prompt.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// M14 F2 L1 — popup windows (flight DD1 Option B / DD2 / DD3).
// ---------------------------------------------------------------------------

class FakePopupWindow extends EventEmitter {
  constructor(wcId) {
    super();
    this.webContents = new FakeContents(wcId, false);
    this.destroyed = false;
  }
  isDestroyed() {
    return this.destroyed;
  }
  destroy() {
    this.destroyed = true;
  }
}

/** A live opener record whose chrome sends land in `sends`. */
function popupHarness(openerWcId = 7) {
  const h = setup();
  const wc = new FakeContents(openerWcId);
  const record = {
    win: {
      destroyed: false,
      isDestroyed() {
        return this.destroyed;
      }
    },
    chromeView: {
      webContents: { isDestroyed: () => false, send: (channel, payload) => h.sends.push([channel, payload]) }
    },
    tabViews: new Map([[openerWcId, { partition: 'persist:jar-a' }]]),
    activeTabWcId: openerWcId
  };
  h.records.set(openerWcId, record);
  h.wiring.wireGuestContents(wc);
  return { ...h, wc, record };
}

const QUALIFYING = Object.freeze({
  url: 'https://popup.test/',
  frameName: 'oauth',
  features: 'width=500,height=600',
  disposition: 'new-window'
});

// The exact DD1d posture the allow return must carry (premise #2, flight-logged).
const EXPECTED_ALLOW = Object.freeze({
  action: 'allow',
  overrideBrowserWindowOptions: {
    autoHideMenuBar: true,
    webPreferences: {
      preload: '/preload/webview-preload.bundle.js',
      contextIsolation: false,
      sandbox: true,
      nodeIntegration: false,
      plugins: true
    }
  }
});

test('DD3 predicate matrix: all four axes, including the disposition refinement', () => {
  const safe = (url) => typeof url === 'string' && url.startsWith('https://');
  const ctx = { isSafeTabUrl: safe, isInternalOpener: false };
  const q = (over, c = ctx) => qualifiesAsPopupRequest({ ...QUALIFYING, ...over }, c);

  // qualifying combinations
  assert.equal(q({}), true, 'features + named + new-window + safe + non-internal');
  assert.equal(q({ frameName: '' }), true, 'features alone qualifies');
  assert.equal(q({ features: '' }), true, 'named non-_blank alone qualifies (with new-window disposition)');

  // features/name axis
  assert.equal(q({ features: '', frameName: '' }), false, 'no features, unnamed');
  assert.equal(q({ features: '', frameName: '_blank' }), false, '_blank is not a name');
  assert.equal(q({ features: undefined, frameName: undefined }), false, 'absent fields fail closed');

  // disposition axis (FD refinement): tab-intent gestures must never float.
  assert.equal(q({ disposition: 'foreground-tab' }), false, 'plain click on a named-target link stays a tab');
  assert.equal(q({ disposition: 'background-tab' }), false, 'middle-click stays a tab');
  assert.equal(q({ disposition: undefined }), false, 'absent disposition fails closed');

  // URL axis
  assert.equal(q({ url: 'file:///etc/passwd' }), false, 'unsafe URL refused');
  assert.equal(q({ url: 'goldfinch://settings' }), false, 'internal scheme refused');

  // opener axis
  assert.equal(q({}, { isSafeTabUrl: safe, isInternalOpener: true }), false, 'internal opener refused');
});

test('qualifying window.open returns allow with the exact DD1d posture — and NO adopt-hook key (DD2)', () => {
  const h = popupHarness();
  const result = h.wc.openHandler(QUALIFYING);
  assert.deepEqual(result, EXPECTED_ALLOW);
  assert.deepEqual(
    Object.keys(result).sort(),
    ['action', 'overrideBrowserWindowOptions'],
    'the allow return carries exactly these two keys — the adopt hook is the spike-proven opener-wedging taboo'
  );
  assert.equal(
    'partition' in result.overrideBrowserWindowOptions.webPreferences,
    false,
    'no partition key — the session is automatically the opener jar (spike-verified)'
  );
  assert.deepEqual(h.sends, [], 'no deny-convert forward on the allow path');
});

test('DD2 source-scan pin: guest-wiring.js contains an allow return and no adopt-hook identifier anywhere', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'guest-wiring.js'), 'utf8');
  assert.ok(src.includes("action: 'allow'"), 'the allow path exists');
  assert.equal(
    /\bcreateWindow\b/.test(src),
    false,
    'no createWindow key/identifier may appear in guest-wiring.js — the adopt hook wedges the opener renderer (DD2)'
  );
});

test('named-no-features arrives as foreground-tab and keeps deny-convert (the flight-logged named consequence)', () => {
  const h = popupHarness();
  // Chromium classifies `window.open(url, 'name')` with NO features as
  // foreground-tab (premise-confirmed live) — the disposition conjunction
  // intentionally narrows DD3's "features OR named" reading.
  const result = h.wc.openHandler({
    url: 'https://popup.test/',
    frameName: 'namedNoFeatures',
    features: '',
    disposition: 'foreground-tab'
  });
  assert.deepEqual(result, { action: 'deny' });
  assert.deepEqual(
    h.sends,
    [['open-tab', { url: 'https://popup.test/', openerPartition: 'persist:jar-a' }]],
    'deny-convert forwards to the owning chrome'
  );
});

test('tab-intent dispositions, unsafe URLs, and internal openers always deny(-convert)', () => {
  const h = popupHarness();
  assert.deepEqual(
    h.wc.openHandler({ ...QUALIFYING, disposition: 'background-tab' }),
    { action: 'deny' },
    'middle-click'
  );
  assert.deepEqual(h.wc.openHandler({ ...QUALIFYING, url: 'file:///etc/passwd' }), { action: 'deny' }, 'unsafe URL');

  const internal = new FakeContents(2, true);
  h.wiring.wireGuestContents(internal);
  assert.deepEqual(internal.openHandler(QUALIFYING), { action: 'deny' }, 'internal opener never allows');
});

test('window.open during opener teardown: absent or destroyed record refuses the allow path', () => {
  const h = popupHarness();
  h.record.win.destroyed = true;
  assert.deepEqual(h.wc.openHandler(QUALIFYING), { action: 'deny' }, 'destroyed owner window → deny');

  h.records.delete(7);
  assert.deepEqual(h.wc.openHandler(QUALIFYING), { action: 'deny' }, 'absent record → deny');
});

test('did-create-window registers the popup with eager partition, wires full guest discipline, and latches', () => {
  const h = popupHarness();
  const win = new FakePopupWindow(701);
  h.wc.emit('did-create-window', win);

  const entry = h.popupRegistry.getByWcId(701);
  assert.ok(entry, 'popup registered');
  assert.equal(entry.openerWcId, 7);
  assert.equal(entry.openerRecord, h.record);
  assert.equal(entry.partition, 'persist:jar-a', 'partition captured eagerly at register time');
  assert.equal(entry.win, win);
  assert.equal(h.popupRegistry.isPopupWcId(701), true, 'the leg-2 addressability predicate seam');

  const popupWc = win.webContents;
  assert.equal(popupWc.__goldfinchNavGuarded, true, 'latch set (premise #1: did-create-window precedes first nav)');
  assert.equal(typeof popupWc.openHandler, 'function', 'the popup gets its own window-open handler (chained popups)');
  // DD1e: the popup never joins tabViews — snapshot/closed-tab structures walk
  // tabViews only, and the registry-miss is also what keeps htmlFullscreen out
  // of the popup path (its enter() early-returns; pinned in html-fullscreen.test.js).
  assert.equal(h.records.get(7).tabViews.has(701), false);
});

// Squawk 0036 (#104 carve-out): a popup opened from a burner tab inherits the
// opener's session (DD1d — no partition key in overrideBrowserWindowOptions),
// so it never passes through tab-create's own WebRTC-policy call. The smallest
// shared hook (isBurnerPartition, src/shared/burner.js) must be applied here
// off the SAME captured partition the popup's census/history attribution uses.
test('did-create-window applies the burner WebRTC IP-handling policy when the opener partition is a burner, and only then', () => {
  const burnerHarness = popupHarness(7);
  burnerHarness.record.tabViews.set(7, { partition: 'burner:99' });
  const burnerWin = new FakePopupWindow(701);
  burnerHarness.wc.emit('did-create-window', burnerWin);
  assert.equal(
    burnerWin.webContents.webrtcPolicy,
    'disable_non_proxied_udp',
    'a burner-opened popup gets the hardening policy'
  );

  const normalHarness = popupHarness(8);
  const normalWin = new FakePopupWindow(801);
  normalHarness.wc.emit('did-create-window', normalWin);
  assert.equal(
    normalWin.webContents.webrtcPolicy,
    undefined,
    'a normal-jar popup (default persist:jar-a partition) never receives the burner-only policy call'
  );
});

test('popup nav guards carry the GUEST shape — a file: navigation is refused (never ALLOWED_NONGUEST_SCHEMES)', () => {
  const h = popupHarness();
  const win = new FakePopupWindow(701);
  h.wc.emit('did-create-window', win);
  const popupWc = win.webContents;

  // file: is on the NON-guest allowlist — under the wrong (catch-all) shape
  // this event would pass; the guest shape must refuse it.
  const fileNav = navEvent('file:///etc/passwd', { isMainFrame: true });
  popupWc.emit('will-navigate', fileNav);
  assert.equal(fileNav.prevented, true, 'guest predicate refuses file: — the non-guest allowlist would admit it');

  const httpsNav = navEvent('https://popup.test/next', { isMainFrame: true });
  popupWc.emit('will-navigate', httpsNav);
  assert.equal(httpsNav.prevented, false, 'ordinary https browsing stays allowed');

  // guardFrameNav wrapper present: the PDF-viewer subframe carve-out works in
  // popups (the plugins:true parity ruling is not dead code).
  const viewerFrame = navEvent(PDF_VIEWER_URL, { isMainFrame: false });
  popupWc.emit('will-frame-navigate', viewerFrame);
  assert.equal(viewerFrame.prevented, false, 'PDF-viewer subframe carve-out live in popups');
});

test('popup HTML fullscreen stays native: the popup wcId resolves NO window record, so the module early-returns', () => {
  const h = popupHarness();
  const win = new FakePopupWindow(701);
  h.wc.emit('did-create-window', win);

  // The wiring forwards the event (audited reuse), but the popup wcId is
  // registry-unowned — the REAL htmlFullscreen.enter(wcId) early-returns on
  // getWindowForGuest miss (pinned in html-fullscreen.test.js: "unowned wcId is
  // a no-op"), so `record.htmlFullscreen` is never touched by popup wcIds.
  win.webContents.emit('enter-html-full-screen');
  assert.deepEqual(
    h.calls.filter((c) => Array.isArray(c) && c[0] === 'fs-enter'),
    [['fs-enter', 701]]
  );
  assert.equal(h.records.get(701), undefined, 'popup wcId resolves no record — the early-return premise');
});

test('popup history records under the opener jar and titles feed the recorder (DD1c)', () => {
  const h = popupHarness();
  const win = new FakePopupWindow(701);
  h.wc.emit('did-create-window', win);
  const popupWc = win.webContents;
  popupWc.url = 'https://popup.test/landed';

  popupWc.emit('did-navigate');
  popupWc.emit('did-navigate-in-page');
  popupWc.emit('page-title-updated', {}, 'Popup title');

  const navs = h.calls.filter((c) => Array.isArray(c) && c[0] === 'history-nav').map((c) => c[1]);
  assert.deepEqual(navs, [
    { wcId: 701, partition: 'persist:jar-a', url: 'https://popup.test/landed' },
    { wcId: 701, partition: 'persist:jar-a', url: 'https://popup.test/landed' }
  ]);
  assert.ok(
    h.calls.some((c) => Array.isArray(c) && c[0] === 'history-title' && c[1] === 701 && c[2] === 'Popup title')
  );
});

test('popup teardown rides closed AND destroyed (destroy() skips close), deregisters, and forgets history — idempotently', () => {
  const h = popupHarness();
  const win = new FakePopupWindow(701);
  h.wc.emit('did-create-window', win);
  assert.equal(h.popupRegistry.isPopupWcId(701), true);

  win.emit('closed');
  assert.equal(h.popupRegistry.isPopupWcId(701), false, 'deregistered at window closed');
  assert.ok(
    h.calls.some((c) => Array.isArray(c) && c[0] === 'history-forget' && c[1] === 701),
    'forgetTab ran (the window-factory close loop only covers tabViews)'
  );

  assert.doesNotThrow(() => win.webContents.emit('destroyed'), 'the contents-destroyed twin is idempotent');
  assert.equal(h.popupRegistry.isPopupWcId(701), false);
});

test('popup teardown routes the DD1f cancel seam FIRST — a self-closed popup resolve-cancels before deregistering (M14 F2 L2)', () => {
  const h = popupHarness();
  const win = new FakePopupWindow(701);
  h.wc.emit('did-create-window', win);

  win.emit('closed');
  const cancelIdx = h.calls.findIndex((c) => Array.isArray(c) && c[0] === 'popup-cancel' && c[1] === 701);
  const forgetIdx = h.calls.findIndex((c) => Array.isArray(c) && c[0] === 'history-forget' && c[1] === 701);
  assert.ok(cancelIdx !== -1, 'cancelChallengesForPopup(popupWcId) invoked on popup destruction');
  assert.ok(forgetIdx !== -1 && cancelIdx < forgetIdx, 'the cancel seam runs before the rest of teardown');
});

test('popup did-start-navigation resolve-cancels pending challenges — main-frame, non-same-document only (DD2 popup parity)', () => {
  const h = popupHarness();
  const win = new FakePopupWindow(701);
  h.wc.emit('did-create-window', win);
  const popupWc = win.webContents;
  const authCancels = () => h.calls.filter((c) => Array.isArray(c) && c[0] === 'auth-cancel');

  popupWc.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
  popupWc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
  assert.deepEqual(authCancels(), [], 'subframe and same-document navigations never cancel');

  popupWc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  assert.deepEqual(
    authCancels(),
    [['auth-cancel', 701, 'navigated']],
    'a real popup navigation cancels with the tab-parity reason — DD2 max-staleness holds for popups'
  );

  popupWc.destroyed = true;
  popupWc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  assert.equal(authCancels().length, 1, 'destroyed-contents guard');
});

test('popup-originated window.open resolves the owner popup-registry-first: deny-convert opens a tab in the OWNING window', () => {
  const h = popupHarness();
  const win = new FakePopupWindow(701);
  h.wc.emit('did-create-window', win);
  const popupWc = win.webContents;
  h.sends.length = 0;

  // target=_blank inside the popup ("forgot password" inside an OAuth popup):
  // chromeForTab misses popups by construction — the forward must reach the
  // opener record's chrome with the CAPTURED partition, never vanish.
  const result = popupWc.openHandler({
    url: 'https://reset.test/',
    frameName: '',
    features: '',
    disposition: 'foreground-tab'
  });
  assert.deepEqual(result, { action: 'deny' });
  assert.deepEqual(h.sends, [['open-tab', { url: 'https://reset.test/', openerPartition: 'persist:jar-a' }]]);
});

test('chained qualifying popups allow and parent FLAT to the same opener record', () => {
  const h = popupHarness();
  const win = new FakePopupWindow(701);
  h.wc.emit('did-create-window', win);
  const popupWc = win.webContents;

  assert.deepEqual(popupWc.openHandler(QUALIFYING), EXPECTED_ALLOW, 'a popup opener with a live record allows');

  const chained = new FakePopupWindow(702);
  popupWc.emit('did-create-window', chained);
  const entry = h.popupRegistry.getByWcId(702);
  assert.ok(entry, 'chained popup registered');
  assert.equal(entry.openerRecord, h.record, 'flat parenting — same owning record, not a tree');
  assert.equal(entry.openerWcId, 701, 'openerWcId is the immediate (popup) opener');
  assert.equal(entry.partition, 'persist:jar-a', 'captured partition inherited');
});

test('popup-originated window.open with a DEAD owning record denies with no forward', () => {
  const h = popupHarness();
  const win = new FakePopupWindow(701);
  h.wc.emit('did-create-window', win);
  const popupWc = win.webContents;
  h.record.win.destroyed = true;
  h.sends.length = 0;

  assert.deepEqual(popupWc.openHandler(QUALIFYING), { action: 'deny' }, 'qualifying request refused on a dead record');
  assert.deepEqual(
    popupWc.openHandler({ url: 'https://x.test/', frameName: '', features: '', disposition: 'foreground-tab' }),
    { action: 'deny' }
  );
  assert.deepEqual(h.sends, [], 'no forward anywhere once the owner is dead');
});

test('did-create-window against a dying opener record destroys the orphan popup and registers nothing', () => {
  const h = popupHarness();
  h.records.delete(7); // opener record gone between allow and creation
  const win = new FakePopupWindow(701);
  h.wc.emit('did-create-window', win);

  assert.equal(win.destroyed, true, 'the orphan window is destroyed before it navigates');
  assert.equal(h.popupRegistry.isPopupWcId(701), false, 'nothing registered');
});

test('did-start-navigation cancels the tab pending auth challenges — main-frame, non-same-document only', () => {
  const h = setup();
  const wc = new FakeContents(31);
  h.wiring.wireTabViewEvents({ webContents: wc }, 31, 'persist:jar-a');

  wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  assert.deepEqual(
    h.calls.filter((c) => Array.isArray(c) && c[0] === 'auth-cancel'),
    [['auth-cancel', 31, 'navigated']]
  );

  wc.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false }); // subframe
  wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true }); // hash/pushState
  assert.equal(
    h.calls.filter((c) => Array.isArray(c) && c[0] === 'auth-cancel').length,
    1,
    'subframe and same-document navigations never cancel'
  );
});
