'use strict';

const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGuestWiring } = require('../../src/main/guest-wiring');

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
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
    this.navigationHistory = {
      canGoBack: () => true,
      canGoForward: () => false
    };
  }
  setWindowOpenHandler(fn) { this.openHandler = fn; }
  isDestroyed() { return this.destroyed; }
  getURL() { return this.url; }
  print(_opts, cb) { this.printCalls++; cb(true); }
}

function setup() {
  const sends = [];
  const calls = [];
  const chrome = { focus: () => calls.push('focus-chrome'), send: (channel, payload) => sends.push([channel, payload]) };
  const records = new Map();
  const registry = {
    getWindowForGuest(id) { return records.get(id) || null; }
  };
  let historyRecorder = {
    handleNavigation(payload) { calls.push(['history-nav', payload]); },
    handleTitleUpdated(id, title) { calls.push(['history-title', id, title]); }
  };
  // The favicon-fetch harness has its first async cases (AC6): a test overrides
  // this via setFaviconRequest to hand back a controllable deferred promise, so
  // the assertion can await the fake fetch chain before checking h.sends.
  let faviconRequest = () => Promise.resolve(null);
  const wiring = createGuestWiring({
    registry,
    chromeForTab: () => chrome,
    crossViewNavAction: (input) => { calls.push('classify-cross-view'); return input.key === 'l' ? 'focus-address' : null; },
    keydownToAction: (input) => { calls.push('classify-chrome'); return input.key === 't' ? 'new-tab' : null; },
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
    logger: { warn() {} }
  });
  return {
    wiring, sends, calls, records, chrome,
    setHistoryRecorder: (value) => { historyRecorder = value; },
    setFaviconRequest: (fn) => { faviconRequest = fn; }
  };
}

function inputEvent(url) {
  return { url, prevented: false, preventDefault() { this.prevented = true; } };
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
    preventDefault() { this.prevented = true; }
  };
  web.emit('will-frame-navigate', subframeBad);
  assert.equal(subframeBad.prevented, true, 'subframe nav to a disallowed scheme must be prevented');

  const subframeGood = {
    url: 'https://example.test/frame',
    isMainFrame: false,
    prevented: false,
    preventDefault() { this.prevented = true; }
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
  h.setFaviconRequest((args) => { capturedArgs = args; return pending.promise; });
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
