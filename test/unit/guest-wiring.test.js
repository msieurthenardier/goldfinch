'use strict';

const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGuestWiring } = require('../../src/main/guest-wiring');

class FakeContents extends EventEmitter {
  constructor(id, internal = false) {
    super();
    this.id = id;
    this.session = { __goldfinchInternal: internal };
    this.destroyed = false;
    this.url = 'https://example.test/page';
    this.openHandler = null;
    this.printCalls = 0;
  }
  setWindowOpenHandler(fn) { this.openHandler = fn; }
  isDestroyed() { return this.destroyed; }
  getURL() { return this.url; }
  canGoBack() { return true; }
  canGoForward() { return false; }
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
    logger: { warn() {} }
  });
  return { wiring, sends, calls, records, chrome, setHistoryRecorder: (value) => { historyRecorder = value; } };
}

function inputEvent() {
  return { prevented: false, preventDefault() { this.prevented = true; } };
}

test('popup inherits the opener partition, targets owning chrome, and always denies native creation', () => {
  const h = setup();
  const wc = new FakeContents(7);
  h.records.set(7, { tabViews: new Map([[7, { partition: 'persist:jar-a' }]]) });
  h.wiring.wireGuestContents(wc);
  assert.deepEqual(wc.openHandler({ url: 'https://popup.test/' }), { action: 'deny' });
  assert.deepEqual(h.sends, [['open-tab', { url: 'https://popup.test/', openerPartition: 'persist:jar-a' }]]);
});

test('will-navigate applies the web and internal allowlists without trust inference', () => {
  const h = setup();
  const web = new FakeContents(1, false);
  const internal = new FakeContents(2, true);
  h.wiring.wireGuestContents(web);
  h.wiring.wireGuestContents(internal);

  const webBad = inputEvent();
  web.emit('will-navigate', webBad, 'goldfinch://settings');
  assert.equal(webBad.prevented, true);
  const internalGood = inputEvent();
  internal.emit('will-navigate', internalGood, 'goldfinch://settings');
  assert.equal(internalGood.prevented, false);
  const internalBad = inputEvent();
  internal.emit('will-navigate', internalBad, 'https://example.test/');
  assert.equal(internalBad.prevented, true);
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
