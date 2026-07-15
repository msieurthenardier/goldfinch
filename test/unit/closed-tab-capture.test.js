'use strict';

// Unit tests for src/main/closed-tab-capture.js (M09 Flight 6, Leg 3, DD4) —
// the pure capture/pop rules around the closed-tab stack: windowId tagging,
// the positive persist-jar allowlist body shared by both capture sites, the
// whole-window insertion-order/append-sentinel capture, and the origin-window
// stripIndex pop rule. Electron-free by design (the window-registry precedent):
// webContents handles are minimal fakes.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  APPEND_SENTINEL,
  captureClosedTabEntry,
  captureWindowCloseEntries,
  reopenStripIndex,
} = require('../../src/main/closed-tab-capture');

// ---------------------------------------------------------------------------
// Fakes: the module reads webContents through getURL/getTitle/navigationHistory/
// isDestroyed only, and tabViews entries through { view, partition, trusted }.
// ---------------------------------------------------------------------------

function makeWc({ url = 'https://example.com/', title = 'Example', destroyed = false, entries = [{ url }], index = 0 } = {}) {
  return {
    isDestroyed: () => destroyed,
    getURL: () => url,
    getTitle: () => title,
    navigationHistory: {
      getAllEntries: () => entries,
      getActiveIndex: () => index,
    },
  };
}

function makeTabEntry({ partition = 'persist:jar-work', trusted = false, wc = makeWc() } = {}) {
  return { view: { webContents: wc }, partition, trusted, active: false };
}

const JARS = [
  { id: 'work', partition: 'persist:jar-work' },
  { id: 'play', partition: 'persist:jar-play' },
];

// --- captureClosedTabEntry: allowlist + tagging -------------------------------

test('captureClosedTabEntry captures a persist-jar tab with windowId and the given stripIndex', () => {
  const wc = makeWc({
    url: 'https://a.example/page',
    title: 'A Page',
    entries: [{ url: 'https://a.example/' }, { url: 'https://a.example/page' }],
    index: 1,
  });
  const entry = captureClosedTabEntry({
    tabEntry: makeTabEntry({ wc }),
    jarsList: JARS,
    stripIndex: 3,
    windowId: 7,
  });
  assert.ok(entry);
  assert.equal(entry.url, 'https://a.example/page');
  assert.equal(entry.title, 'A Page');
  assert.equal(entry.jarId, 'work');
  assert.equal(entry.stripIndex, 3);
  assert.equal(entry.navEntries.length, 2);
  assert.equal(entry.navIndex, 1);
  assert.equal(entry.windowId, 7);
  assert.equal(typeof entry.closedAt, 'number');
});

test('captureClosedTabEntry excludes burner partitions (positive allowlist — no jar match)', () => {
  const entry = captureClosedTabEntry({
    tabEntry: makeTabEntry({ partition: 'burner:1' }),
    jarsList: JARS,
    stripIndex: 0,
    windowId: 1,
  });
  assert.equal(entry, null);
});

test('captureClosedTabEntry excludes trusted/internal tabs (belt-and-suspenders !trusted)', () => {
  // Even with a partition that WOULD match a jar, trusted short-circuits.
  const entry = captureClosedTabEntry({
    tabEntry: makeTabEntry({ partition: 'persist:jar-work', trusted: true }),
    jarsList: JARS,
    stripIndex: 0,
    windowId: 1,
  });
  assert.equal(entry, null);
});

test('captureClosedTabEntry excludes a destroyed webContents (nothing left to read)', () => {
  const entry = captureClosedTabEntry({
    tabEntry: makeTabEntry({ wc: makeWc({ destroyed: true }) }),
    jarsList: JARS,
    stripIndex: 0,
    windowId: 1,
  });
  assert.equal(entry, null);
});

// --- captureWindowCloseEntries: order + sentinel + filtering ------------------

test('captureWindowCloseEntries captures persist-jar tabs in tabViews INSERTION order', () => {
  const tabViews = new Map();
  tabViews.set(11, makeTabEntry({ wc: makeWc({ url: 'https://first.example/' }) }));
  tabViews.set(12, makeTabEntry({ partition: 'persist:jar-play', wc: makeWc({ url: 'https://second.example/' }) }));
  tabViews.set(13, makeTabEntry({ wc: makeWc({ url: 'https://third.example/' }) }));
  const entries = captureWindowCloseEntries({ tabViews, jarsList: JARS, windowId: 4 });
  assert.deepEqual(
    entries.map((e) => e.url),
    ['https://first.example/', 'https://second.example/', 'https://third.example/']
  );
  assert.deepEqual(entries.map((e) => e.jarId), ['work', 'play', 'work']);
});

test('captureWindowCloseEntries tags every entry with the dying windowId and the append sentinel', () => {
  const tabViews = new Map();
  tabViews.set(21, makeTabEntry());
  tabViews.set(22, makeTabEntry({ partition: 'persist:jar-play' }));
  const entries = captureWindowCloseEntries({ tabViews, jarsList: JARS, windowId: 9 });
  assert.equal(entries.length, 2);
  for (const e of entries) {
    assert.equal(e.windowId, 9);
    assert.equal(e.stripIndex, APPEND_SENTINEL);
  }
});

test('captureWindowCloseEntries skips burner/internal/destroyed tabs but keeps the rest in order', () => {
  const tabViews = new Map();
  tabViews.set(31, makeTabEntry({ partition: 'burner:2', wc: makeWc({ url: 'https://burner.example/' }) }));
  tabViews.set(32, makeTabEntry({ wc: makeWc({ url: 'https://kept-a.example/' }) }));
  tabViews.set(33, makeTabEntry({ trusted: true, partition: 'goldfinch-internal' }));
  tabViews.set(34, makeTabEntry({ wc: makeWc({ url: 'https://kept-b.example/', destroyed: true }) }));
  tabViews.set(35, makeTabEntry({ partition: 'persist:jar-play', wc: makeWc({ url: 'https://kept-c.example/' }) }));
  const entries = captureWindowCloseEntries({ tabViews, jarsList: JARS, windowId: 2 });
  assert.deepEqual(
    entries.map((e) => e.url),
    ['https://kept-a.example/', 'https://kept-c.example/']
  );
});

test('captureWindowCloseEntries on an empty/no-persist window returns []', () => {
  assert.deepEqual(captureWindowCloseEntries({ tabViews: new Map(), jarsList: JARS, windowId: 1 }), []);
  const burnersOnly = new Map([[41, makeTabEntry({ partition: 'burner:3' })]]);
  assert.deepEqual(captureWindowCloseEntries({ tabViews: burnersOnly, jarsList: JARS, windowId: 1 }), []);
});

// --- reopenStripIndex: the DD4 pop rule ----------------------------------------

test('reopenStripIndex honors stripIndex only for the ORIGIN window', () => {
  const entry = { stripIndex: 5, windowId: 3 };
  assert.equal(reopenStripIndex(entry, 3), 5);
});

test('reopenStripIndex appends for a different invoking window', () => {
  const entry = { stripIndex: 5, windowId: 3 };
  assert.equal(reopenStripIndex(entry, 4), APPEND_SENTINEL);
});

test('reopenStripIndex appends when the invoker is unresolvable (null)', () => {
  const entry = { stripIndex: 5, windowId: 3 };
  assert.equal(reopenStripIndex(entry, null), APPEND_SENTINEL);
});

test('reopenStripIndex appends for an untagged (pre-DD4) entry — never a wrong-strip position', () => {
  const entry = { stripIndex: 5 };
  assert.equal(reopenStripIndex(entry, 3), APPEND_SENTINEL);
});

test('reopenStripIndex passes the append sentinel through unchanged for whole-window entries', () => {
  // A whole-window entry: sentinel stripIndex + a windowId that (in real use)
  // can never match — but even a hypothetical match yields the sentinel.
  const entry = { stripIndex: APPEND_SENTINEL, windowId: 3 };
  assert.equal(reopenStripIndex(entry, 3), APPEND_SENTINEL);
});

test('APPEND_SENTINEL is -1 (the renderer treats any negative insertAt as append)', () => {
  assert.equal(APPEND_SENTINEL, -1);
});
