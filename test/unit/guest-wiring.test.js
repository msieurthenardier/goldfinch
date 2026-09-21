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
    // Mission 20 Flight 1 Leg 3 (HAT H7): settable via the field directly —
    // defaults false (the common case: nothing focuses a fake guest unless a
    // test says so).
    this.focused = false;
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
  isFocused() {
    return this.focused;
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
  // Mission 20 Flight 3 Leg 2: the kill-and-reload / crash-recovery respawn.
  reload() {
    this.reloadCalls = (this.reloadCalls || 0) + 1;
  }
}

function setup({ vaultHuman } = {}) {
  const sends = [];
  const calls = [];
  // Mission 20 Flight 1 (AC3): a THIRD, independent log — additive only, so no
  // legacy `h.calls`/`h.sends` exact-match assertion is affected. It exists
  // solely so the new failure/clear tests can pin the RELATIVE ORDER between a
  // chrome send and the applyGuestVisibility/findOverlay.hide recording fakes,
  // which otherwise land in two separate arrays with no shared sequence.
  const events = [];
  const chrome = {
    focus: () => {
      calls.push('focus-chrome');
      // Mission 20 Flight 1 Leg 3 (HAT H7): additive to `events` too, so the
      // new focus-reassert tests can pin its order relative to the
      // tab-load-failure send via the same shared sequence log AC3 uses.
      events.push(['focus']);
    },
    send: (channel, payload) => {
      sends.push([channel, payload]);
      events.push(['send', channel, payload]);
    }
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
  // Mission 20 Flight 2 Leg 2 (DD6/DD7): a controllable fake — defaults to
  // "no observer entry" (null), which every pre-existing did-navigate test
  // exercises implicitly (none of them care about security/certificate).
  // New tests override via setCertObserverLookup.
  let certObserverLookup = () => null;
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
    // Mission 20 Flight 3 Leg 3 (DD5): `wireTabViewEvents`'s `sendToChrome`
    // now routes through `sendOrQueue` rather than `chromeForTab(wcId)?.send`
    // directly — this fake preserves every existing test's "always delivers
    // immediately to `chrome`" behavior (the real boot-gate semantics are
    // pinned in register-tab-ipc.test.js).
    sendOrQueue: (wcId, channel, payload) => chrome.send(channel, payload),
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
    // Mission 20 Flight 2 Leg 2 (DD6): the observer's read seam — did-navigate
    // calls this to build entry.certificate/security. clearPartition is not
    // exercised from THIS module (jar-data-lifecycle.js owns that call site)
    // but the fake carries it anyway for shape parity.
    certObserver: {
      lookup: (partition, hostname) => certObserverLookup(partition, hostname),
      clearPartition: () => {}
    },
    // Mission 20 Flight 1 (DD1/AC3/AC4): a RECORDING fake, not the real
    // register-tab-ipc.js helper — this suite asserts guest-wiring's CALL
    // POINT and its ordering relative to sendToChrome/findOverlay.hide; the
    // real two-axis semantics are pinned by register-tab-ipc.test.js and the
    // grep-AC in guest-visibility-invariant.test.js.
    applyGuestVisibility: (entry) =>
      events.push(['apply-visibility', { active: entry.active, loadFailure: entry.loadFailure }]),
    // Mission 20 Flight 3 Leg 2: the OPTIONAL crash-record sink — a recording
    // fake here (leg 3 wires the real crash-log.js).
    onCrash: (record) => {
      calls.push(['on-crash', record]);
      events.push(['on-crash', record]);
    },
    // Mission 21 Flight 1 Leg 5 (broadened-capture, DD4): the settle release
    // gate's navigation-commit half — OMITTED by default (every pre-Leg-5 test
    // is unaffected: `vaultHuman?.()?.captureRelease(...)` optional-chains to
    // nothing). Tests that care pass it explicitly via `setup({ vaultHuman })`.
    vaultHuman,
    logger: { warn() {} }
  });
  return {
    wiring,
    sends,
    calls,
    events,
    records,
    chrome,
    fullscreenIds,
    popupRegistry,
    setHistoryRecorder: (value) => {
      historyRecorder = value;
    },
    setFaviconRequest: (fn) => {
      faviconRequest = fn;
    },
    setCertObserverLookup: (fn) => {
      certObserverLookup = fn;
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

// --- Mission 21 Flight 1 Leg 5 (broadened-capture, DD3f/DD4): the settle
// release gate's navigation-commit half. ---------------------------------

test('did-navigate releases a held gesture capture via vaultHuman().captureRelease and forwards the resulting offer BEFORE tab-did-navigate', () => {
  const releaseCalls = [];
  const h = setup({
    vaultHuman: () => ({
      captureRelease: (wcId) => {
        releaseCalls.push(wcId);
        return [{ captureId: 'cap1', model: { origin: 'https://a.example', username: 'me', mode: 'save' } }];
      }
    })
  });
  const wc = new FakeContents(60);
  h.wiring.wireTabViewEvents({ webContents: wc }, 60, 'persist:jar-a');

  wc.emit('did-navigate');

  assert.deepEqual(releaseCalls, [60]);
  assert.deepEqual(h.sends[0], [
    'vault-capture-offer',
    { captureId: 'cap1', model: { origin: 'https://a.example', username: 'me', mode: 'save' } }
  ]);
  assert.deepEqual(h.sends[1], ['tab-did-navigate', { wcId: 60, url: wc.url }]);
});

// M21 F3 L2 (DD1's amendment, AC4): captureRelease can now return MULTIPLE
// entries in one call (one per family) — did-navigate must send one
// vault-capture-offer per entry, IN ORDER, all still before tab-did-navigate.
test('AC4: did-navigate sends ONE vault-capture-offer per entry captureRelease returns, preserving release order, all before tab-did-navigate', () => {
  const h = setup({
    vaultHuman: () => ({
      captureRelease: () => [
        { captureId: 'cap-login', model: { origin: 'https://a.example', username: 'me', mode: 'save' } },
        { captureId: 'cap-card', model: { kind: 'card', origin: 'https://a.example', mode: 'save' } }
      ]
    })
  });
  const wc = new FakeContents(63);
  h.wiring.wireTabViewEvents({ webContents: wc }, 63, 'persist:jar-a');

  wc.emit('did-navigate');

  const offerSends = h.sends.filter(([channel]) => channel === 'vault-capture-offer');
  assert.equal(offerSends.length, 2, 'one vault-capture-offer per released entry');
  assert.equal(offerSends[0][1].captureId, 'cap-login', 'release order preserved — login first');
  assert.equal(offerSends[1][1].captureId, 'cap-card', 'release order preserved — card second');
  const navigateIndex = h.sends.findIndex(([channel]) => channel === 'tab-did-navigate');
  assert.ok(
    h.sends.findIndex(([channel]) => channel === 'vault-capture-offer') < navigateIndex,
    'every vault-capture-offer send precedes tab-did-navigate'
  );
});

test('did-navigate calls captureRelease every time, but forwards NOTHING when it returns [] (the ordinary, no-held-capture case — M21 F3 L2 AC2 contract update)', () => {
  const releaseCalls = [];
  const h = setup({
    vaultHuman: () => ({
      captureRelease: (wcId) => {
        releaseCalls.push(wcId);
        return [];
      }
    })
  });
  const wc = new FakeContents(61);
  h.wiring.wireTabViewEvents({ webContents: wc }, 61, 'persist:jar-a');

  wc.emit('did-navigate');

  assert.deepEqual(releaseCalls, [61]);
  assert.equal(
    h.sends.some(([channel]) => channel === 'vault-capture-offer'),
    false
  );
});

test('did-navigate with vaultHuman OMITTED (the default, every pre-Leg-5 caller) never throws and sends no vault-capture-offer', () => {
  const h = setup(); // no vaultHuman override
  const wc = new FakeContents(62);
  h.wiring.wireTabViewEvents({ webContents: wc }, 62, 'persist:jar-a');

  assert.doesNotThrow(() => wc.emit('did-navigate'));
  assert.equal(
    h.sends.some(([channel]) => channel === 'vault-capture-offer'),
    false
  );
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
    // Mission 20 Flight 3 Leg 3 (DD7): the popup crash site's `windowId` is
    // the popup's OWN `win.id` — a distinct fake value from its webContents
    // id so a test asserting both fields catches an accidental id mix-up.
    this.id = wcId + 10_000;
  }
  isDestroyed() {
    return this.destroyed;
  }
  destroy() {
    this.destroyed = true;
  }
  // Mission 20 Flight 3 Leg 2 (DD2): a popup crash calls win.close() — models
  // Electron's real BrowserWindow.close() firing 'closed' (which
  // onWindowClosed's sanctioned wrapper listens for).
  close() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('closed');
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

// ---------------------------------------------------------------------------
// Mission 20 Flight 1 (DD1/DD2/DD4/AC3/AC4/AC6): the did-fail-load handler,
// the did-start-navigation clear, and effectiveUrl in the did-navigate push.
// ---------------------------------------------------------------------------

function makeFailureRecord(
  h,
  wcId,
  entry,
  { active = true, findOverlay = { hide: () => h.events.push(['find-hide']) } } = {}
) {
  const tabViews = new Map([[wcId, entry]]);
  // Mission 20 Flight 3 Leg 3 (DD7): the crash-record sites read `owner.win.id`
  // for the record's `windowId` field — every record fake carries one.
  const record = { activeTabWcId: active ? wcId : null, tabViews, findOverlay, win: { id: 1 } };
  h.records.set(wcId, record);
  return record;
}

test('AC3: did-fail-load records the failure, hides, closes find, then tells the chrome — in that order (active tab)', () => {
  const h = setup();
  const wc = new FakeContents(40);
  const view = { webContents: wc };
  const entry = { view, active: true, loadFailure: null, lastRequestedUrl: 'http://127.0.0.1:1/' };
  makeFailureRecord(h, 40, entry);
  h.wiring.wireTabViewEvents(view, 40, 'persist:jar-a');

  wc.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'http://127.0.0.1:1/', true);

  assert.deepEqual(entry.loadFailure, { code: -102, name: 'ERR_CONNECTION_REFUSED', url: 'http://127.0.0.1:1/' });
  assert.equal(entry.lastRequestedUrl, 'http://127.0.0.1:1/');
  const order = h.events.map((e) => e[0]);
  const applyIdx = order.indexOf('apply-visibility');
  const findIdx = order.indexOf('find-hide');
  const sendIdx = order.indexOf('send');
  assert.ok(applyIdx !== -1 && findIdx !== -1 && sendIdx !== -1, 'all three effects fired');
  assert.ok(applyIdx < findIdx, 'hide runs before find-overlay hide');
  assert.ok(findIdx < sendIdx, 'find-overlay hide runs before the chrome push');
  // Mission 20 Flight 2 Leg 4 (design review, HIGH): the tab-security 'none'
  // push now follows the failure push unconditionally — the census/chip fix
  // for a tab that loaded securely and then failed.
  assert.deepEqual(h.sends.at(-2), [
    'tab-load-failure',
    { wcId: 40, failure: { code: -102, name: 'ERR_CONNECTION_REFUSED', url: 'http://127.0.0.1:1/' } }
  ]);
  assert.deepEqual(h.sends.at(-1), ['tab-security', { wcId: 40, security: 'none' }]);
});

test('AC3 edge case: failure on an INACTIVE tab records + pushes only — no hide, no find-close', () => {
  const h = setup();
  const wc = new FakeContents(41);
  const view = { webContents: wc };
  const entry = { view, active: false, loadFailure: null, lastRequestedUrl: 'http://x.invalid/' };
  makeFailureRecord(h, 41, entry, { active: false });
  h.wiring.wireTabViewEvents(view, 41, 'persist:jar-a');

  wc.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'http://x.invalid/', true);

  assert.deepEqual(entry.loadFailure, { code: -105, name: 'ERR_NAME_NOT_RESOLVED', url: 'http://x.invalid/' });
  assert.deepEqual(
    h.events.filter((e) => e[0] === 'apply-visibility' || e[0] === 'find-hide'),
    [],
    'an inactive tab is neither hidden (already hidden) nor find-closed (not the active tab)'
  );
  assert.deepEqual(h.sends, [
    [
      'tab-load-failure',
      { wcId: 41, failure: { code: -105, name: 'ERR_NAME_NOT_RESOLVED', url: 'http://x.invalid/' } }
    ],
    ['tab-security', { wcId: 41, security: 'none' }]
  ]);
});

// ---------------------------------------------------------------------------
// Mission 20 Flight 2 Leg 1 (#216, DD12): the F1 HAT H7 `wc.isFocused()`
// reasserts that used to live in did-fail-load/did-finish-load are REMOVED —
// the leg-1 live spike traced the steal to a `focus`/`blur` cycle on the
// GUEST that starts asynchronously right after `wc.loadURL()`, well before
// either of these events fires, so a one-shot reassert keyed to either
// instant raced the steal and lost (matching the debrief's own finding that
// neither reassert "changed the observed behavior"). The fix moved upstream:
// a `chromeNavPending` flag armed at `tab-navigate` (register-tab-ipc.test.js)
// and a reactive chrome-`blur` listener (window-factory.test.js). This
// module's own remaining responsibility is disarming the flag once the
// navigation settles — pinned below — and no longer calling `chrome.focus()`
// itself at all.
// ---------------------------------------------------------------------------

test('#216: did-fail-load clears entry.chromeNavPending and never calls chrome.focus() itself', () => {
  const h = setup();
  const wc = new FakeContents(60);
  wc.focused = true;
  const view = { webContents: wc };
  const entry = {
    view,
    active: true,
    loadFailure: null,
    lastRequestedUrl: 'http://x.invalid/',
    chromeNavPending: true
  };
  makeFailureRecord(h, 60, entry);

  h.wiring.wireTabViewEvents(view, 60, 'persist:jar-a');
  wc.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'http://x.invalid/', true);

  assert.equal(entry.chromeNavPending, false, 'the pending flag is disarmed at did-fail-load');
  assert.equal(h.calls.includes('focus-chrome'), false, 'guest-wiring no longer calls chrome.focus() itself');
});

test('#216: did-fail-load on a BACKGROUND tab still clears its own chromeNavPending', () => {
  const h = setup();
  const wc = new FakeContents(62);
  const view = { webContents: wc };
  const entry = {
    view,
    active: false,
    loadFailure: null,
    lastRequestedUrl: 'http://x.invalid/',
    chromeNavPending: true
  };
  makeFailureRecord(h, 62, entry, { active: false });

  h.wiring.wireTabViewEvents(view, 62, 'persist:jar-a');
  wc.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'http://x.invalid/', true);

  assert.equal(entry.chromeNavPending, false);
});

test("#216: did-navigate clears entry.chromeNavPending (covers both a real commit and the chrome-error document's own eventual commit)", () => {
  const h = setup();
  const wc = new FakeContents(64);
  const view = { webContents: wc };
  const entry = { view, active: true, loadFailure: null, lastRequestedUrl: 'https://ok.test/', chromeNavPending: true };
  makeFailureRecord(h, 64, entry);

  h.wiring.wireTabViewEvents(view, 64, 'persist:jar-a');
  wc.url = 'https://ok.test/';
  wc.emit('did-navigate');

  assert.equal(entry.chromeNavPending, false);
});

test('#216: did-finish-load no longer touches focus or chromeNavPending at all', () => {
  const h = setup();
  const wc = new FakeContents(65);
  wc.focused = true;
  const view = { webContents: wc };
  const entry = {
    view,
    active: true,
    loadFailure: { code: -105, name: 'ERR_NAME_NOT_RESOLVED', url: 'http://x.invalid/' },
    lastRequestedUrl: 'http://x.invalid/',
    chromeNavPending: true
  };
  makeFailureRecord(h, 65, entry);

  h.wiring.wireTabViewEvents(view, 65, 'persist:jar-a');
  wc.emit('did-finish-load');

  assert.equal(h.calls.includes('focus-chrome'), false, 'did-finish-load is inert on focus (dead per the leg-1 spike)');
  assert.equal(
    entry.chromeNavPending,
    true,
    'did-finish-load does not disarm — did-navigate/did-fail-load already did'
  );
  assert.equal(entry.loadFailure.code, -105, 'did-finish-load never mutates loadFailure');
});

test('AC3/DD2: subframe failures are ignored entirely — no state, no push', () => {
  const h = setup();
  const wc = new FakeContents(42);
  const view = { webContents: wc };
  const entry = { view, active: true, loadFailure: null, lastRequestedUrl: 'http://ok.test/' };
  makeFailureRecord(h, 42, entry);
  h.wiring.wireTabViewEvents(view, 42, 'persist:jar-a');

  wc.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'http://iframe.invalid/', false);

  assert.equal(entry.loadFailure, null);
  assert.deepEqual(h.sends, []);
  assert.deepEqual(h.events, []);
});

test('AC3/DD2: ERR_ABORTED (-3) is ignored entirely — no state, no push', () => {
  const h = setup();
  const wc = new FakeContents(43);
  const view = { webContents: wc };
  const entry = { view, active: true, loadFailure: null, lastRequestedUrl: 'http://ok.test/' };
  makeFailureRecord(h, 43, entry);
  h.wiring.wireTabViewEvents(view, 43, 'persist:jar-a');

  wc.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'http://ok.test/', true);

  assert.equal(entry.loadFailure, null);
  assert.deepEqual(h.sends, []);
  assert.deepEqual(h.events, []);
});

test('edge case: did-fail-load arriving after the entry is gone from tabViews drops silently (never throws)', () => {
  const h = setup();
  const wc = new FakeContents(44);
  const view = { webContents: wc };
  // Owner record exists (teardown-in-progress), but its tabViews entry for
  // this wcId is already gone.
  h.records.set(44, { activeTabWcId: null, tabViews: new Map(), findOverlay: null });
  h.wiring.wireTabViewEvents(view, 44, 'persist:jar-a');

  assert.doesNotThrow(() => wc.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'http://x.invalid/', true));
  assert.deepEqual(h.sends, []);
});

test('edge case: an empty validatedURL keeps the prior lastRequestedUrl', () => {
  const h = setup();
  const wc = new FakeContents(45);
  const view = { webContents: wc };
  const entry = { view, active: true, loadFailure: null, lastRequestedUrl: 'http://kept.test/' };
  makeFailureRecord(h, 45, entry);
  h.wiring.wireTabViewEvents(view, 45, 'persist:jar-a');

  wc.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', '', true);

  assert.equal(entry.lastRequestedUrl, 'http://kept.test/');
  assert.deepEqual(entry.loadFailure, { code: -105, name: 'ERR_NAME_NOT_RESOLVED', url: '' });
});

test('AC4: did-start-navigation clears a recorded failure on the next real navigation — shows, pushes null', () => {
  const h = setup();
  const wc = new FakeContents(46);
  const view = { webContents: wc };
  const entry = {
    view,
    active: true,
    loadFailure: { code: -105, name: 'ERR_NAME_NOT_RESOLVED', url: 'http://x.invalid/' },
    lastRequestedUrl: 'http://x.invalid/'
  };
  makeFailureRecord(h, 46, entry);
  h.wiring.wireTabViewEvents(view, 46, 'persist:jar-a');

  wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'https://retry.test/' });

  assert.equal(entry.loadFailure, null);
  assert.equal(entry.lastRequestedUrl, 'https://retry.test/');
  assert.deepEqual(
    h.events.filter((e) => e[0] === 'apply-visibility'),
    [['apply-visibility', { active: true, loadFailure: null }]]
  );
  assert.deepEqual(h.sends, [['tab-load-failure', { wcId: 46, failure: null }]]);
});

test('AC4: a did-start-navigation whose URL is chrome-error: changes nothing (the error commit must not erase its own failure)', () => {
  const h = setup();
  const wc = new FakeContents(47);
  const view = { webContents: wc };
  const failure = { code: -105, name: 'ERR_NAME_NOT_RESOLVED', url: 'http://x.invalid/' };
  const entry = { view, active: true, loadFailure: failure, lastRequestedUrl: 'http://x.invalid/' };
  makeFailureRecord(h, 47, entry);
  h.wiring.wireTabViewEvents(view, 47, 'persist:jar-a');

  wc.emit('did-start-navigation', {
    isMainFrame: true,
    isSameDocument: false,
    url: 'chrome-error://chromewebdata/'
  });

  assert.equal(entry.loadFailure, failure, 'loadFailure is untouched — still the SAME object');
  assert.equal(entry.lastRequestedUrl, 'http://x.invalid/', 'lastRequestedUrl is untouched');
  assert.deepEqual(h.sends, []);
  assert.deepEqual(h.events, []);
});

test('AC4: did-start-navigation with no recorded failure only stamps lastRequestedUrl — no spurious push', () => {
  const h = setup();
  const wc = new FakeContents(48);
  const view = { webContents: wc };
  const entry = { view, active: true, loadFailure: null, lastRequestedUrl: null };
  makeFailureRecord(h, 48, entry);
  h.wiring.wireTabViewEvents(view, 48, 'persist:jar-a');

  wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'https://ok.test/' });

  assert.equal(entry.lastRequestedUrl, 'https://ok.test/');
  assert.deepEqual(h.sends, []);
});

test('AC6: did-navigate substitutes the intended address when the live URL is chrome-error: (effectiveUrl)', () => {
  const h = setup();
  const wc = new FakeContents(49);
  wc.url = 'chrome-error://chromewebdata/';
  const view = { webContents: wc };
  const entry = { view, active: true, loadFailure: null, lastRequestedUrl: 'http://127.0.0.1:1/' };
  makeFailureRecord(h, 49, entry);
  h.wiring.wireTabViewEvents(view, 49, 'persist:jar-a');

  wc.emit('did-navigate');

  assert.deepEqual(h.sends[0], ['tab-did-navigate', { wcId: 49, url: 'http://127.0.0.1:1/' }]);
  assert.ok(
    h.calls.some((x) => Array.isArray(x) && x[0] === 'history-nav' && x[1].url === 'http://127.0.0.1:1/'),
    'the history recorder receives the SAME substituted url'
  );
});

test('AC6: did-navigate passes the live URL through unchanged when it is not chrome-error:', () => {
  const h = setup();
  const wc = new FakeContents(50);
  wc.url = 'https://real-page.test/';
  const view = { webContents: wc };
  const entry = { view, active: true, loadFailure: null, lastRequestedUrl: 'https://real-page.test/' };
  makeFailureRecord(h, 50, entry);
  h.wiring.wireTabViewEvents(view, 50, 'persist:jar-a');

  wc.emit('did-navigate');

  assert.deepEqual(h.sends[0], ['tab-did-navigate', { wcId: 50, url: 'https://real-page.test/' }]);
});

// ---------------------------------------------------------------------------
// Mission 20 Flight 2 Leg 2 (DD1/DD4/DD6/DD7): the cert-error fold at
// did-fail-load, the certFailure/certOverride clear at did-start-navigation,
// and the certificate/security stamp + tab-security push at did-navigate.
// ---------------------------------------------------------------------------

test('DD1/DD4: did-fail-load folds a pending certFailure into loadFailure.cert and clears certFailure', () => {
  const h = setup();
  const wc = new FakeContents(70);
  const view = { webContents: wc };
  const entry = {
    view,
    active: true,
    loadFailure: null,
    lastRequestedUrl: 'https://bad.test/',
    certFailure: {
      url: 'https://bad.test/',
      host: 'bad.test',
      port: 443,
      error: 'ERR_CERT_AUTHORITY_INVALID',
      fingerprint: 'AA:BB',
      summary: { status: 'untrusted' }
    }
  };
  makeFailureRecord(h, 70, entry);
  h.wiring.wireTabViewEvents(view, 70, 'persist:jar-a');

  wc.emit('did-fail-load', {}, -202, 'ERR_CERT_AUTHORITY_INVALID', 'https://bad.test/', true);

  assert.deepEqual(entry.loadFailure, {
    code: -202,
    name: 'ERR_CERT_AUTHORITY_INVALID',
    url: 'https://bad.test/',
    cert: {
      host: 'bad.test',
      port: 443,
      error: 'ERR_CERT_AUTHORITY_INVALID',
      fingerprint: 'AA:BB',
      overridable: true,
      summary: { status: 'untrusted' }
    }
  });
  assert.equal(entry.certFailure, null, 'certFailure is cleared after folding');
});

test('DD1/DD4: did-fail-load never folds a non-ERR_CERT_ failure even with a stale certFailure present, but still clears it', () => {
  const h = setup();
  const wc = new FakeContents(71);
  const view = { webContents: wc };
  const entry = {
    view,
    active: true,
    loadFailure: null,
    lastRequestedUrl: 'http://x.invalid/',
    certFailure: {
      url: 'https://bad.test/',
      host: 'bad.test',
      port: 443,
      error: 'ERR_CERT_AUTHORITY_INVALID',
      fingerprint: '',
      summary: {}
    }
  };
  makeFailureRecord(h, 71, entry);
  h.wiring.wireTabViewEvents(view, 71, 'persist:jar-a');

  wc.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'http://x.invalid/', true);

  assert.equal(entry.loadFailure.cert, undefined, 'no cert field folded for an unrelated failure');
  assert.equal(entry.certFailure, null, 'the stale stamp is still cleared');
});

test('Mission 20 F2 Leg 4 (design review, HIGH): did-fail-load stamps entry.security = none and pushes tab-security, overwriting a stale prior value — even for a cert-blocked failure', () => {
  const h = setup();
  const wc = new FakeContents(90);
  const view = { webContents: wc };
  const entry = {
    view,
    active: true,
    loadFailure: null,
    lastRequestedUrl: 'https://bad.test/',
    security: 'secure' // stale — the tab loaded fine before this failure
  };
  makeFailureRecord(h, 90, entry);
  h.wiring.wireTabViewEvents(view, 90, 'persist:jar-a');

  wc.emit('did-fail-load', {}, -202, 'ERR_CERT_AUTHORITY_INVALID', 'https://bad.test/', true);

  assert.equal(entry.security, 'none');
  assert.deepEqual(h.sends.at(-1), ['tab-security', { wcId: 90, security: 'none' }]);
});

test('DD1: did-start-navigation clears certFailure and certOverride on a real navigation', () => {
  const h = setup();
  const wc = new FakeContents(72);
  const view = { webContents: wc };
  const entry = {
    view,
    active: true,
    loadFailure: null,
    lastRequestedUrl: 'https://bad.test/',
    certFailure: { url: 'https://bad.test/', host: 'bad.test' },
    certOverride: { host: 'bad.test', port: 443 }
  };
  makeFailureRecord(h, 72, entry);
  h.wiring.wireTabViewEvents(view, 72, 'persist:jar-a');

  wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'https://retry.test/' });

  assert.equal(entry.certFailure, null);
  assert.equal(entry.certOverride, null);
});

test('DD1: a chrome-error: did-start-navigation leaves certFailure/certOverride untouched', () => {
  const h = setup();
  const wc = new FakeContents(73);
  const view = { webContents: wc };
  const certFailure = { url: 'https://bad.test/', host: 'bad.test' };
  const certOverride = { host: 'other.test', port: 443 };
  const entry = {
    view,
    active: true,
    loadFailure: null,
    lastRequestedUrl: 'https://bad.test/',
    certFailure,
    certOverride
  };
  makeFailureRecord(h, 73, entry);
  h.wiring.wireTabViewEvents(view, 73, 'persist:jar-a');

  wc.emit('did-start-navigation', {
    isMainFrame: true,
    isSameDocument: false,
    url: 'chrome-error://chromewebdata/'
  });

  assert.equal(entry.certFailure, certFailure);
  assert.equal(entry.certOverride, certOverride);
});

test('DD6/DD7: did-navigate stamps entry.certificate/security from the observer and pushes tab-security AFTER tab-did-navigate', () => {
  const h = setup();
  const wc = new FakeContents(74);
  wc.url = 'https://trusted.test/';
  const view = { webContents: wc };
  const entry = { view, active: true, loadFailure: null, lastRequestedUrl: 'https://trusted.test/', trusted: false };
  makeFailureRecord(h, 74, entry);
  h.wiring.wireTabViewEvents(view, 74, 'persist:jar-a');
  const observerEntry = {
    verificationResult: 'net::OK',
    errorCode: 0,
    isIssuedByKnownRoot: true,
    summary: { status: 'trusted' }
  };
  h.setCertObserverLookup((partition, hostname) => {
    assert.equal(partition, 'persist:jar-a');
    assert.equal(hostname, 'trusted.test');
    return observerEntry;
  });

  wc.emit('did-navigate');

  assert.equal(entry.certificate, observerEntry);
  assert.equal(entry.security, 'secure');
  assert.deepEqual(h.sends[0], ['tab-did-navigate', { wcId: 74, url: 'https://trusted.test/' }]);
  assert.deepEqual(h.sends[1], ['tab-security', { wcId: 74, security: 'secure' }]);
});

// HAT F5 note: `deriveSecurityState`'s override check now runs BEFORE the
// observer lookup (site-security.js), so with no `entry.certOverride` set
// here this test now exercises that module's defensive/unreachable-in-
// practice branch (observer non-OK, no override → overridden) rather than
// the primary override-wins path — kept as a fail-safe regression pin, not
// because this scenario is expected to occur live (a non-OK verification
// with no override would have failed the load rather than committing one).
test('DD7: did-navigate reads overridden from the observer verification when present', () => {
  const h = setup();
  const wc = new FakeContents(75);
  wc.url = 'https://bad.test/';
  const view = { webContents: wc };
  const entry = { view, active: true, loadFailure: null, lastRequestedUrl: 'https://bad.test/' };
  makeFailureRecord(h, 75, entry);
  h.wiring.wireTabViewEvents(view, 75, 'persist:jar-a');
  h.setCertObserverLookup(() => ({ verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID' }));

  wc.emit('did-navigate');

  assert.equal(entry.security, 'overridden');
});

test('DD7: did-navigate falls back to the certOverride decision when the observer has no entry (post-eviction)', () => {
  const h = setup();
  const wc = new FakeContents(76);
  wc.url = 'https://bad.test/';
  const view = { webContents: wc };
  const entry = {
    view,
    active: true,
    loadFailure: null,
    lastRequestedUrl: 'https://bad.test/',
    certOverride: { host: 'bad.test', port: 443 }
  };
  makeFailureRecord(h, 76, entry);
  h.wiring.wireTabViewEvents(view, 76, 'persist:jar-a');
  h.setCertObserverLookup(() => null);

  wc.emit('did-navigate');

  assert.equal(entry.certificate, null);
  assert.equal(entry.security, 'overridden');
});

test('DD7: did-navigate for a plain http: page reports insecure, never overridden', () => {
  const h = setup();
  const wc = new FakeContents(77);
  wc.url = 'http://plain.test/';
  const view = { webContents: wc };
  const entry = { view, active: true, loadFailure: null, lastRequestedUrl: 'http://plain.test/' };
  makeFailureRecord(h, 77, entry);
  h.wiring.wireTabViewEvents(view, 77, 'persist:jar-a');

  wc.emit('did-navigate');

  assert.equal(entry.security, 'insecure');
});

test('DD7: did-navigate for a trusted internal entry reports internal regardless of scheme', () => {
  const h = setup();
  const wc = new FakeContents(78);
  wc.url = 'goldfinch://settings/';
  const view = { webContents: wc };
  const entry = { view, active: true, loadFailure: null, lastRequestedUrl: 'goldfinch://settings/', trusted: true };
  makeFailureRecord(h, 78, entry);
  h.wiring.wireTabViewEvents(view, 78, 'persist:jar-a');

  wc.emit('did-navigate');

  assert.equal(entry.security, 'internal');
});

test('DD7 edge case: did-navigate-in-page never touches certificate/security (no push, no recompute)', () => {
  const h = setup();
  const wc = new FakeContents(79);
  wc.url = 'https://trusted.test/';
  const view = { webContents: wc };
  const entry = {
    view,
    active: true,
    loadFailure: null,
    lastRequestedUrl: 'https://trusted.test/',
    security: 'secure',
    certificate: { x: 1 }
  };
  makeFailureRecord(h, 79, entry);
  h.wiring.wireTabViewEvents(view, 79, 'persist:jar-a');

  wc.emit('did-navigate-in-page');

  assert.equal(entry.security, 'secure');
  assert.deepEqual(entry.certificate, { x: 1 });
  assert.ok(!h.sends.some(([channel]) => channel === 'tab-security'));
});

test('edge case: did-navigate for a chrome-error: commit defensively reports security none (never fires live per the leg-1 spike, but guarded)', () => {
  const h = setup();
  const wc = new FakeContents(80);
  wc.url = 'chrome-error://chromewebdata/';
  const view = { webContents: wc };
  const entry = { view, active: true, loadFailure: null, lastRequestedUrl: 'http://127.0.0.1:1/' };
  makeFailureRecord(h, 80, entry);
  h.wiring.wireTabViewEvents(view, 80, 'persist:jar-a');

  wc.emit('did-navigate');

  assert.equal(entry.certificate, null);
  assert.equal(entry.security, 'none');
});

// ---------------------------------------------------------------------------
// Mission 20 Flight 3 Leg 2 (DD1/DD2/DD3): render-process-gone (crash +
// kill-and-reload), unresponsive/responsive (hang), and did-start-navigation
// clearing crash/hung/killRequested.
// ---------------------------------------------------------------------------

test('AC1: render-process-gone with reason !== clean-exit hides the guest, stamps entry.crash, clears loadFailure/hung, and pushes tab-crash on its own channel', () => {
  const h = setup();
  const wc = new FakeContents(100);
  wc.url = 'https://crashed.test/';
  const view = { webContents: wc };
  const entry = { view, active: true, loadFailure: { code: -1, name: 'stale' }, hung: true, lastRequestedUrl: null };
  makeFailureRecord(h, 100, entry);
  h.wiring.wireTabViewEvents(view, 100, 'persist:jar-a');

  wc.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 139 });

  assert.deepEqual(entry.crash, { reason: 'crashed', exitCode: 139, url: 'https://crashed.test/' });
  assert.equal(entry.loadFailure, null, 'a dead renderer is never also reported failed');
  assert.equal(entry.hung, false, 'a dead renderer is never also reported hung');
  assert.ok(
    h.events.some((e) => e[0] === 'apply-visibility'),
    'the guest is hidden through the shared visibility helper'
  );
  assert.ok(
    h.events.some((e) => e[0] === 'find-hide'),
    'the active tab find overlay is closed'
  );
  assert.deepEqual(h.sends, [
    ['tab-crash', { wcId: 100, crash: { reason: 'crashed', exitCode: 139, url: 'https://crashed.test/' } }],
    ['tab-hung', { wcId: 100, hung: false }],
    ['tab-security', { wcId: 100, security: 'none' }]
  ]);
  assert.equal(entry.security, 'none');
  assert.deepEqual(h.calls.at(-1), [
    'on-crash',
    {
      kind: 'guest',
      reason: 'crashed',
      exitCode: 139,
      wcId: 100,
      url: 'https://crashed.test/',
      partition: 'persist:jar-a',
      windowId: 1,
      recovery: 'panel'
    }
  ]);
});

test('AC1: render-process-gone does not push tab-hung when the tab was never hung', () => {
  const h = setup();
  const wc = new FakeContents(101);
  const view = { webContents: wc };
  const entry = { view, active: true, loadFailure: null, hung: false, lastRequestedUrl: null };
  makeFailureRecord(h, 101, entry);
  h.wiring.wireTabViewEvents(view, 101, 'persist:jar-a');

  wc.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 139 });

  assert.deepEqual(
    h.sends.map((s) => s[0]),
    ['tab-crash', 'tab-security'],
    'no tab-hung push when the tab was not hung'
  );
});

test('AC1: render-process-gone with reason clean-exit is ignored entirely', () => {
  const h = setup();
  const wc = new FakeContents(102);
  const view = { webContents: wc };
  const entry = { view, active: true, loadFailure: null, crash: null, hung: false, lastRequestedUrl: null };
  makeFailureRecord(h, 102, entry);
  h.wiring.wireTabViewEvents(view, 102, 'persist:jar-a');

  wc.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 });

  assert.equal(entry.crash, null);
  assert.deepEqual(h.sends, []);
  assert.deepEqual(h.calls, []);
});

test('AC1 edge case: render-process-gone for a gone window (registry miss) is ignored, never throws', () => {
  const h = setup();
  const wc = new FakeContents(103);
  const view = { webContents: wc };
  // No h.records.set(103, ...) — the owning window is gone.
  h.wiring.wireTabViewEvents(view, 103, 'persist:jar-a');

  assert.doesNotThrow(() => wc.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 139 }));
  assert.deepEqual(h.sends, []);
});

test('AC1 edge case: render-process-gone for a gone tabViews entry (mid-teardown) is ignored, never throws', () => {
  const h = setup();
  const wc = new FakeContents(104);
  const view = { webContents: wc };
  h.records.set(104, { activeTabWcId: null, tabViews: new Map(), findOverlay: null });
  h.wiring.wireTabViewEvents(view, 104, 'persist:jar-a');

  assert.doesNotThrow(() => wc.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 139 }));
  assert.deepEqual(h.sends, []);
});

test('AC1 edge case: a crash on a BACKGROUND (inactive) tab hides no find overlay and stamps only', () => {
  const h = setup();
  const wc = new FakeContents(105);
  const view = { webContents: wc };
  const entry = { view, active: false, loadFailure: null, hung: false, lastRequestedUrl: null };
  makeFailureRecord(h, 105, entry, { active: false });
  h.wiring.wireTabViewEvents(view, 105, 'persist:jar-a');

  wc.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 139 });

  assert.ok(entry.crash, 'the crash is still recorded for a background tab');
  assert.ok(
    !h.events.some((e) => e[0] === 'find-hide'),
    'a background crash never closes the find overlay (not the active tab)'
  );
});

test('AC2: kill-and-reload — the flag alone gates the bypass, WHATEVER the reported reason (spike (f))', () => {
  const h = setup();
  const wc = new FakeContents(106);
  const view = { webContents: wc };
  const entry = {
    view,
    active: true,
    loadFailure: null,
    crash: null,
    hung: true,
    killRequested: true,
    lastRequestedUrl: null
  };
  makeFailureRecord(h, 106, entry);
  h.wiring.wireTabViewEvents(view, 106, 'persist:jar-a');

  // Spike (f): forcefullyCrashRenderer() reports itself as 'crashed' on this
  // platform, NOT 'killed' — the bypass must still fire.
  wc.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 133 });

  assert.equal(entry.killRequested, false, 'the flag is consumed');
  assert.equal(entry.crash, null, 'no crash panel for a kill-and-reload');
  assert.equal(entry.hung, false);
  assert.deepEqual(h.sends, [['tab-hung', { wcId: 106, hung: false }]], 'no tab-crash push on the kill-reload path');
  assert.equal(wc.reloadCalls, 1, 'the guest is reloaded in place');
  assert.deepEqual(h.calls.at(-1), [
    'on-crash',
    {
      kind: 'guest',
      reason: 'crashed',
      exitCode: 133,
      wcId: 106,
      url: 'https://example.test/page',
      partition: 'persist:jar-a',
      windowId: 1,
      recovery: 'reloaded'
    }
  ]);
});

test('AC3: unresponsive stamps entry.hung and pushes tab-hung true', () => {
  const h = setup();
  const wc = new FakeContents(107);
  const view = { webContents: wc };
  const entry = { view, active: true, loadFailure: null, hung: false, lastRequestedUrl: null };
  makeFailureRecord(h, 107, entry);
  h.wiring.wireTabViewEvents(view, 107, 'persist:jar-a');

  wc.emit('unresponsive');

  assert.equal(entry.hung, true);
  assert.deepEqual(h.sends, [['tab-hung', { wcId: 107, hung: true }]]);
});

test('AC3: responsive clears entry.hung and pushes tab-hung false', () => {
  const h = setup();
  const wc = new FakeContents(108);
  const view = { webContents: wc };
  const entry = { view, active: true, loadFailure: null, hung: true, lastRequestedUrl: null };
  makeFailureRecord(h, 108, entry);
  h.wiring.wireTabViewEvents(view, 108, 'persist:jar-a');

  wc.emit('responsive');

  assert.equal(entry.hung, false);
  assert.deepEqual(h.sends, [['tab-hung', { wcId: 108, hung: false }]]);
});

test('AC3: unresponsive is ignored for a TRUSTED (internal) entry, a crashed entry, and a kill-pending entry', () => {
  const cases = [
    { trusted: true, crash: null, killRequested: false, label: 'trusted' },
    { trusted: false, crash: { reason: 'crashed', exitCode: 139, url: 'x' }, killRequested: false, label: 'crashed' },
    { trusted: false, crash: null, killRequested: true, label: 'kill-pending' }
  ];
  for (const [i, c] of cases.entries()) {
    const h = setup();
    const wcId = 200 + i;
    const wc = new FakeContents(wcId);
    const view = { webContents: wc };
    const entry = {
      view,
      active: true,
      loadFailure: null,
      hung: false,
      trusted: c.trusted,
      crash: c.crash,
      killRequested: c.killRequested,
      lastRequestedUrl: null
    };
    makeFailureRecord(h, wcId, entry);
    h.wiring.wireTabViewEvents(view, wcId, 'persist:jar-a');

    wc.emit('unresponsive');

    assert.equal(entry.hung, false, `${c.label}: unresponsive must be ignored`);
    assert.deepEqual(h.sends, [], `${c.label}: no tab-hung push`);
  }
});

test('AC2/DD1: did-start-navigation clears a lingering crash, hung, and killRequested flag', () => {
  const h = setup();
  const wc = new FakeContents(109);
  const view = { webContents: wc };
  const entry = {
    view,
    active: true,
    loadFailure: null,
    crash: { reason: 'crashed', exitCode: 139, url: 'https://old.test/' },
    hung: true,
    killRequested: true,
    lastRequestedUrl: null
  };
  makeFailureRecord(h, 109, entry);
  h.wiring.wireTabViewEvents(view, 109, 'persist:jar-a');

  wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'https://new.test/' });

  assert.equal(entry.crash, null);
  assert.equal(entry.hung, false);
  assert.equal(entry.killRequested, false);
  assert.deepEqual(h.sends, [
    ['tab-crash', { wcId: 109, crash: null }],
    ['tab-hung', { wcId: 109, hung: false }]
  ]);
});

test('AC2 edge case: did-start-navigation clears a lingering killRequested flag even with no crash/hung to clear', () => {
  const h = setup();
  const wc = new FakeContents(110);
  const view = { webContents: wc };
  const entry = {
    view,
    active: true,
    loadFailure: null,
    crash: null,
    hung: false,
    killRequested: true,
    lastRequestedUrl: null
  };
  makeFailureRecord(h, 110, entry);
  h.wiring.wireTabViewEvents(view, 110, 'persist:jar-a');

  wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'https://new.test/' });

  assert.equal(entry.killRequested, false);
  assert.deepEqual(h.sends, [], 'no spurious pushes when there was nothing to clear');
});

// ---------------------------------------------------------------------------
// Mission 20 Flight 3 Leg 2 (DD2): a popup's own render-process-gone.
// ---------------------------------------------------------------------------

test('DD2: a popup render-process-gone (non-clean-exit) records and closes the popup window', () => {
  const h = popupHarness();
  const win = new FakePopupWindow(701);
  h.wc.emit('did-create-window', win);
  const popupWc = win.webContents;
  popupWc.url = 'https://popup.test/oauth';

  popupWc.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 139 });

  assert.equal(win.destroyed, true, 'the popup window is closed (win.close(), which also fires its own teardown)');
  assert.deepEqual(
    h.calls.filter((c) => Array.isArray(c) && c[0] === 'on-crash'),
    [
      [
        'on-crash',
        {
          kind: 'popup',
          reason: 'crashed',
          exitCode: 139,
          url: 'https://popup.test/oauth',
          partition: 'persist:jar-a',
          windowId: win.id,
          recovery: 'closed'
        }
      ]
    ]
  );
});

test('DD2: a popup render-process-gone with reason clean-exit is ignored — the window stays open', () => {
  const h = popupHarness();
  const win = new FakePopupWindow(702);
  h.wc.emit('did-create-window', win);
  const popupWc = win.webContents;

  popupWc.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 });

  assert.deepEqual(
    h.calls.filter((c) => Array.isArray(c) && c[0] === 'on-crash'),
    []
  );
});

// ---------------------------------------------------------------------------
// Mission 20 Flight 3 Leg 3 (DD5/AC4): sendToChrome routes through
// sendOrQueue — grep-AC: zero `chromeForTab(wcId)?.send` inside
// wireTabViewEvents (the two remaining call sites, devtools-state-changed
// and page-context-menu, both live in wireGuestContents, ABOVE this
// function).
// ---------------------------------------------------------------------------

test('AC4 source-scan: wireTabViewEvents contains zero chromeForTab(wcId)?.send call sites', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'guest-wiring.js'), 'utf8');
  const start = src.indexOf('function wireTabViewEvents(');
  assert.ok(start >= 0, 'wireTabViewEvents must exist');
  // Isolate the function body via balanced-brace matching (the sheet-
  // automation-gate-invariant idiom — never a fixed-line-count slice).
  let depth = 0;
  let end = -1;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  assert.ok(end > start, 'must find the end of wireTabViewEvents');
  const body = src.slice(start, end);
  assert.equal(
    (body.match(/chromeForTab\(wcId\)\?\.send/g) || []).length,
    0,
    'wireTabViewEvents must route every per-tab push through sendOrQueue, never chromeForTab(wcId)?.send directly'
  );
  assert.ok(body.includes('sendOrQueue(wcId, channel, payload)'), 'sendToChrome must be sendOrQueue-backed');
});
