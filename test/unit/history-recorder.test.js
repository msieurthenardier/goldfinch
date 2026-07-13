'use strict';

// Unit tests for src/main/history-recorder.js (flight DD4/DD5 recording gate,
// M08 Flight 1 Leg 2). Electron-free factory — every dependency is a fake, no
// electron stub needed. Builds a fresh recorder per test (factory shape, not a
// module singleton) so tests never share in-memory suppression/backfill state.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHistoryRecorder } = require('../../src/main/history-recorder');

const JAR_A = { id: 'personal', partition: 'persist:container:personal' };
const JAR_B = { id: 'work', partition: 'persist:container:work' };

function makeStore(overrides = {}) {
  const calls = [];
  let nextId = 1;
  return {
    calls,
    recordVisit: (visit) => {
      calls.push(['recordVisit', visit]);
      if (overrides.recordVisit) return overrides.recordVisit(visit);
      return nextId++;
    },
    setTitle: (visitId, title) => {
      calls.push(['setTitle', visitId, title]);
      if (overrides.setTitle) return overrides.setTitle(visitId, title);
    }
  };
}

function makeBroadcast() {
  const calls = [];
  const broadcast = (channel, payload) => calls.push([channel, payload]);
  broadcast.calls = calls;
  return broadcast;
}

function makeRecorder({ jars = [JAR_A, JAR_B], store = makeStore(), broadcast = makeBroadcast(), now, suppressionMs } = {}) {
  return {
    store,
    broadcast,
    recorder: createHistoryRecorder({
      store,
      listJars: () => jars,
      broadcast,
      ...(now !== undefined ? { now } : {}),
      ...(suppressionMs !== undefined ? { suppressionMs } : {})
    })
  };
}

function clockFrom(start) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => {
    t += ms;
  };
  return now;
}

// ---------------------------------------------------------------------------
// handleNavigation — positive path
// ---------------------------------------------------------------------------

test('handleNavigation: registered jar + https URL records and broadcasts', () => {
  const { recorder, store, broadcast } = makeRecorder();
  const id = recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/' });
  assert.equal(typeof id, 'number');
  assert.equal(store.calls.length, 1);
  assert.deepEqual(store.calls[0], [
    'recordVisit',
    { jarId: 'personal', url: 'https://example.com/', title: null, visitedAt: store.calls[0][1].visitedAt }
  ]);
  assert.deepEqual(broadcast.calls, [['history-changed', { jarId: 'personal' }]]);
});

test('handleNavigation: registered jar + http URL records', () => {
  const { recorder, store } = makeRecorder();
  const id = recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'http://example.com/' });
  assert.equal(typeof id, 'number');
  assert.equal(store.calls.length, 1);
});

// ---------------------------------------------------------------------------
// handleNavigation — DD5 positive allowlist: everything that resolves no jar
// ---------------------------------------------------------------------------

test('handleNavigation: burner partition returns null, zero store calls', () => {
  const { recorder, store, broadcast } = makeRecorder();
  const result = recorder.handleNavigation({ wcId: 1, partition: 'burner:1', url: 'https://example.com/' });
  assert.equal(result, null);
  assert.equal(store.calls.length, 0);
  assert.equal(broadcast.calls.length, 0);
});

test('handleNavigation: internal partition returns null, zero store calls', () => {
  const { recorder, store } = makeRecorder();
  const result = recorder.handleNavigation({ wcId: 1, partition: 'goldfinch-internal', url: 'https://example.com/' });
  assert.equal(result, null);
  assert.equal(store.calls.length, 0);
});

test('handleNavigation: unknown/unregistered partition returns null, zero store calls', () => {
  const { recorder, store } = makeRecorder();
  const result = recorder.handleNavigation({ wcId: 1, partition: 'persist:container:ghost', url: 'https://example.com/' });
  assert.equal(result, null);
  assert.equal(store.calls.length, 0);
});

test('handleNavigation: undefined partition returns null, zero store calls', () => {
  const { recorder, store } = makeRecorder();
  const result = recorder.handleNavigation({ wcId: 1, partition: undefined, url: 'https://example.com/' });
  assert.equal(result, null);
  assert.equal(store.calls.length, 0);
});

// ---------------------------------------------------------------------------
// handleNavigation — DD4 scheme allowlist
// ---------------------------------------------------------------------------

test('handleNavigation: goldfinch:// URL returns null, zero store calls', () => {
  const { recorder, store } = makeRecorder();
  const result = recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'goldfinch://settings' });
  assert.equal(result, null);
  assert.equal(store.calls.length, 0);
});

test('handleNavigation: about:blank returns null, zero store calls', () => {
  const { recorder, store } = makeRecorder();
  const result = recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'about:blank' });
  assert.equal(result, null);
  assert.equal(store.calls.length, 0);
});

test('handleNavigation: invalid/unparseable URL returns null, zero store calls', () => {
  const { recorder, store } = makeRecorder();
  const result = recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'not a url' });
  assert.equal(result, null);
  assert.equal(store.calls.length, 0);
});

// ---------------------------------------------------------------------------
// handleNavigation — DD4 consecutive-duplicate suppression
// ---------------------------------------------------------------------------

test('handleNavigation: same URL within the suppression window is suppressed', () => {
  const now = clockFrom(1_000_000);
  const { recorder, store } = makeRecorder({ now });
  const first = recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/' });
  assert.equal(typeof first, 'number');
  now.advance(10_000); // 10s < 30s default window
  const second = recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/' });
  assert.equal(second, null, 'reload within the window is suppressed');
  assert.equal(store.calls.length, 1, 'no second recordVisit call');
});

test('handleNavigation: same URL after the suppression window elapses records again', () => {
  const now = clockFrom(1_000_000);
  const { recorder, store } = makeRecorder({ now, suppressionMs: 30_000 });
  recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/' });
  now.advance(30_001);
  const second = recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/' });
  assert.equal(typeof second, 'number');
  assert.equal(store.calls.length, 2);
});

test('handleNavigation: a different URL within the window is not suppressed', () => {
  const now = clockFrom(1_000_000);
  const { recorder, store } = makeRecorder({ now });
  recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/a' });
  now.advance(1_000);
  const second = recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/b' });
  assert.equal(typeof second, 'number');
  assert.equal(store.calls.length, 2);
});

test('handleNavigation: suppression does not self-extend — a suppressed hit does not push ts forward', () => {
  const now = clockFrom(1_000_000);
  const { recorder, store } = makeRecorder({ now, suppressionMs: 30_000 });
  recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/' }); // t=1_000_000
  now.advance(20_000); // t=1_020_000 — inside window, suppressed, ts must NOT move to here
  const suppressed = recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/' });
  assert.equal(suppressed, null);
  now.advance(15_000); // t=1_035_000 — 35s after the ORIGINAL record, 15s after the suppressed hit
  // If suppression had self-extended from the suppressed hit's ts (1_020_000), this would still
  // be suppressed (only 15s later). It must record, proving ts stayed at the original 1_000_000.
  const third = recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/' });
  assert.equal(typeof third, 'number', 'suppression window measured from the original recorded ts, not the suppressed hit');
  assert.equal(store.calls.length, 2);
});

test('handleNavigation: suppression is per-jar — two tabs in the same jar suppress each other', () => {
  const now = clockFrom(1_000_000);
  const { recorder, store } = makeRecorder({ now });
  recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/' });
  now.advance(1_000);
  const secondTab = recorder.handleNavigation({ wcId: 2, partition: JAR_A.partition, url: 'https://example.com/' });
  assert.equal(secondTab, null, 'suppression map is jar-scoped, not tab-scoped');
  assert.equal(store.calls.length, 1);
});

test('handleNavigation: suppression does not cross jars', () => {
  const now = clockFrom(1_000_000);
  const { recorder, store } = makeRecorder({ now });
  recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/' });
  now.advance(1_000);
  const otherJar = recorder.handleNavigation({ wcId: 2, partition: JAR_B.partition, url: 'https://example.com/' });
  assert.equal(typeof otherJar, 'number');
  assert.equal(store.calls.length, 2);
});

// ---------------------------------------------------------------------------
// handleTitleUpdated — backfill
// ---------------------------------------------------------------------------

test('handleTitleUpdated: hit updates the store and broadcasts with the recorded jarId', () => {
  const { recorder, store, broadcast } = makeRecorder();
  recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/' });
  broadcast.calls.length = 0; // isolate the title-update broadcast
  recorder.handleTitleUpdated(1, 'Example Domain');
  assert.deepEqual(store.calls[store.calls.length - 1], ['setTitle', 1, 'Example Domain']);
  assert.deepEqual(broadcast.calls, [['history-changed', { jarId: 'personal' }]]);
});

test('handleTitleUpdated: miss (no prior navigation for wcId) is a no-op', () => {
  const { recorder, store, broadcast } = makeRecorder();
  recorder.handleTitleUpdated(999, 'Ghost');
  assert.equal(store.calls.length, 0);
  assert.equal(broadcast.calls.length, 0);
});

test('handleTitleUpdated: empty string title is a no-op', () => {
  const { recorder, store, broadcast } = makeRecorder();
  recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/' });
  broadcast.calls.length = 0;
  const before = store.calls.length;
  recorder.handleTitleUpdated(1, '');
  assert.equal(store.calls.length, before, 'no setTitle call for an empty title');
  assert.equal(broadcast.calls.length, 0);
});

test('handleTitleUpdated: non-string title is a no-op', () => {
  const { recorder, store, broadcast } = makeRecorder();
  recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/' });
  broadcast.calls.length = 0;
  const before = store.calls.length;
  recorder.handleTitleUpdated(1, /** @type {any} */ (null));
  assert.equal(store.calls.length, before);
  assert.equal(broadcast.calls.length, 0);
});

test('handleTitleUpdated: forgetTab clears the backfill entry — a later title update is a no-op', () => {
  const { recorder, store, broadcast } = makeRecorder();
  recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/' });
  recorder.forgetTab(1);
  broadcast.calls.length = 0;
  const before = store.calls.length;
  recorder.handleTitleUpdated(1, 'Too Late');
  assert.equal(store.calls.length, before);
  assert.equal(broadcast.calls.length, 0);
});

// ---------------------------------------------------------------------------
// Store-throw swallowed
// ---------------------------------------------------------------------------

test('handleNavigation: a throwing store.recordVisit is swallowed, returns null, navigation unaffected', () => {
  const store = makeStore({
    recordVisit: () => {
      throw new Error('disk full');
    }
  });
  const { recorder } = makeRecorder({ store });
  const result = recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/' });
  assert.equal(result, null);
});

test('handleTitleUpdated: a throwing store.setTitle is swallowed, does not throw', () => {
  const store = makeStore({
    setTitle: () => {
      throw new Error('disk full');
    }
  });
  const { recorder } = makeRecorder({ store });
  recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/' });
  assert.doesNotThrow(() => recorder.handleTitleUpdated(1, 'Title'));
});
