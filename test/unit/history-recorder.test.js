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
    setTitle: (visit, title) => {
      calls.push(['setTitle', visit, title]);
      if (overrides.setTitle) return overrides.setTitle(visit, title);
      return true; // a row changed
    }
  };
}

function makeBroadcast() {
  const calls = [];
  const broadcast = (channel, payload) => calls.push([channel, payload]);
  broadcast.calls = calls;
  return broadcast;
}

function makeRecorder({
  jars = [JAR_A, JAR_B],
  store = makeStore(),
  broadcast = makeBroadcast(),
  now,
  suppressionMs
} = {}) {
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
  const result = recorder.handleNavigation({
    wcId: 1,
    partition: 'persist:container:ghost',
    url: 'https://example.com/'
  });
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
  assert.equal(
    typeof third,
    'number',
    'suppression window measured from the original recorded ts, not the suppressed hit'
  );
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
  assert.deepEqual(store.calls[store.calls.length - 1], [
    'setTitle',
    { visitId: 1, jarId: 'personal', url: 'https://example.com/', visitedAt: store.calls[0][1].visitedAt },
    'Example Domain'
  ]);
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

// Mission 23 Flight 1 (leg `jar-isolation`): the handle carries id, jar, url and time; no row changed means
// no broadcast and the handle is forgotten.

test('handleTitleUpdated: when the store changes no row, nothing is broadcast and the handle is forgotten', () => {
  const store = makeStore({ setTitle: () => false });
  const { recorder, broadcast } = makeRecorder({ store });
  recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/' });
  broadcast.calls.length = 0;
  recorder.handleTitleUpdated(1, 'Stale');
  assert.deepEqual(broadcast.calls, []);
  const before = store.calls.length;
  recorder.handleTitleUpdated(1, 'Again');
  assert.equal(store.calls.length, before, 'the forgotten handle makes no further store call');
});

test('end to end on the REAL store: a handle that outlives its jar clear never retitles another jar visit', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const resolved = require.resolve('../../src/main/history-store');
  delete require.cache[resolved];
  const realStore = require('../../src/main/history-store');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-hist-rec-'));
  try {
    realStore.open(dir);
    const clock = clockFrom(5_000);
    const { recorder, broadcast } = makeRecorder({ store: realStore, now: clock });
    const url = 'https://example.com/';
    // Tab 1 (jar A) records a visit, then jar A's history is cleared (a module the recorder never hears from).
    const idA = recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url });
    realStore.clearJar(JAR_A.id);
    // A visit in jar B (another tab) is recorded and reuses the row id.
    const idB = recorder.handleNavigation({ wcId: 2, partition: JAR_B.partition, url });
    assert.equal(idB, idA, 'precondition: the row id was reused');
    broadcast.calls.length = 0;
    // The first tab's later title update changes no row and broadcasts nothing.
    recorder.handleTitleUpdated(1, 'HOSTILE');
    assert.equal(realStore.listRecent(JAR_B.id)[0].title, null);
    assert.deepEqual(realStore.search(JAR_B.id, 'HOSTILE'), []);
    assert.deepEqual(broadcast.calls, []);
    // A normal title update on tab 2 works, still broadcasts its own jar, and the index follows.
    recorder.handleTitleUpdated(2, 'Legit Title');
    assert.equal(realStore.listRecent(JAR_B.id)[0].title, 'Legit Title');
    assert.deepEqual(broadcast.calls, [['history-changed', { jarId: JAR_B.id }]]);
    assert.equal(realStore.search(JAR_B.id, 'Legit').length, 1);

    // The same sequence within ONE jar: clear, clock advances, a different visit takes the id.
    recorder.handleNavigation({ wcId: 3, partition: JAR_A.partition, url: 'https://example.com/a' });
    realStore.clearJar(JAR_A.id);
    clock.advance(31_000); // past the duplicate-suppression window
    recorder.handleNavigation({ wcId: 4, partition: JAR_A.partition, url: 'https://example.com/a' });
    broadcast.calls.length = 0;
    recorder.handleTitleUpdated(3, 'HOSTILE');
    assert.equal(realStore.listRecent(JAR_A.id)[0].title, null);
    assert.deepEqual(broadcast.calls, []);
  } finally {
    realStore.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Mission 23 Flight 1, leg `prompts-and-bounds`: title cap + limiter, address cap, userinfo strip
// ---------------------------------------------------------------------------

const { TITLE_MAX_CHARS, TITLE_INTERVAL_MS, ADDRESS_MAX_CHARS } = require('../../src/main/history-recorder');

/** A fake timer: fires due callbacks when the shared clock is advanced. */
function makeFakeTimers(clock) {
  const timers = [];
  let seq = 0;
  return {
    timers,
    setTimer: (fn, ms) => {
      const h = { id: ++seq, at: clock() + ms, fn, cleared: false };
      timers.push(h);
      return h;
    },
    clearTimer: (h) => {
      h.cleared = true;
    },
    fireDue: () => {
      for (const h of timers) {
        if (!h.cleared && h.at <= clock()) {
          h.cleared = true;
          h.fn();
        }
      }
    },
    pending: () => timers.filter((h) => !h.cleared).length
  };
}

function makeLimited(overrides = {}) {
  let t = 1_000_000;
  const clock = () => t;
  const timers = makeFakeTimers(clock);
  const store = overrides.store || makeStore();
  const broadcast = makeBroadcast();
  const recorder = createHistoryRecorder({
    store,
    listJars: () => [JAR_A, JAR_B],
    broadcast,
    now: clock,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });
  const advance = (ms) => {
    t += ms;
    timers.fireDue();
  };
  return { recorder, store, broadcast, timers, advance };
}

const titleCalls = (store) => store.calls.filter((c) => c[0] === 'setTitle');

test('title limiter: a burst of 1,000 updates in one interval writes once at once and once at the end, the LAST value', () => {
  const { recorder, store, timers, advance } = makeLimited();
  recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/' });
  for (let i = 1; i <= 1000; i++) {
    recorder.handleTitleUpdated(1, 'title ' + i);
    advance(0.5);
  }
  assert.equal(titleCalls(store).length, 1, 'only the first update was written inside the interval');
  assert.equal(titleCalls(store)[0][2], 'title 1');
  assert.equal(timers.pending(), 1, 'one trailing timer');
  advance(TITLE_INTERVAL_MS);
  assert.equal(titleCalls(store).length, 2);
  assert.equal(titleCalls(store)[1][2], 'title 1000');
  assert.equal(timers.pending(), 0);
});

test('title limiter: a title set once is written at once with no trailing write', () => {
  const { recorder, store, timers, advance } = makeLimited();
  recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/' });
  recorder.handleTitleUpdated(1, 'Once');
  assert.equal(titleCalls(store).length, 1);
  assert.equal(timers.pending(), 0);
  advance(TITLE_INTERVAL_MS * 5);
  assert.equal(titleCalls(store).length, 1);
  // and a later update after the interval is again written at once
  recorder.handleTitleUpdated(1, 'Later');
  assert.equal(titleCalls(store).length, 2);
});

test('title cap: a 100 KB title is stored at the cap, and the trailing write is capped too', () => {
  const { recorder, store, advance } = makeLimited();
  recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/' });
  recorder.handleTitleUpdated(1, 'x'.repeat(100 * 1024));
  recorder.handleTitleUpdated(1, 'y'.repeat(100 * 1024));
  advance(TITLE_INTERVAL_MS);
  const calls = titleCalls(store);
  assert.equal(calls[0][2].length, TITLE_MAX_CHARS);
  assert.equal(calls[1][2].length, TITLE_MAX_CHARS);
  assert.equal(calls[1][2][0], 'y');
});

test('title cap: never leaves half a surrogate pair at the end', () => {
  const { recorder, store } = makeLimited();
  recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/' });
  recorder.handleTitleUpdated(1, 'a'.repeat(TITLE_MAX_CHARS - 1) + '\u{1F600}');
  const stored = titleCalls(store)[0][2];
  assert.equal(stored, 'a'.repeat(TITLE_MAX_CHARS - 1));
});

test('title limiter: the trailing write still passes the four-field visit match', () => {
  const { recorder, store, advance } = makeLimited();
  const id = recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/' });
  recorder.handleTitleUpdated(1, 'first');
  recorder.handleTitleUpdated(1, 'last');
  advance(TITLE_INTERVAL_MS);
  const visit = titleCalls(store)[1][1];
  assert.equal(visit.visitId, id);
  assert.equal(visit.jarId, JAR_A.id);
  assert.equal(visit.url, 'https://example.com/');
  assert.equal(typeof visit.visitedAt, 'number');
});

test('title limiter: forgetting the tab cancels the pending write', () => {
  const { recorder, store, timers, advance } = makeLimited();
  recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/' });
  recorder.handleTitleUpdated(1, 'first');
  recorder.handleTitleUpdated(1, 'pending');
  assert.equal(timers.pending(), 1);
  recorder.forgetTab(1);
  assert.equal(timers.pending(), 0);
  advance(TITLE_INTERVAL_MS * 2);
  assert.equal(titleCalls(store).length, 1);
});

test("title limiter: a new visit on the tab drops the previous visit's pending title and writes the next one at once", () => {
  const { recorder, store, advance } = makeLimited();
  recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/a' });
  recorder.handleTitleUpdated(1, 'a1');
  recorder.handleTitleUpdated(1, 'a-pending');
  recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/b' });
  recorder.handleTitleUpdated(1, 'b1');
  advance(TITLE_INTERVAL_MS * 2);
  assert.deepEqual(
    titleCalls(store).map((c) => c[2]),
    ['a1', 'b1'],
    "the old visit's pending value never lands, on either row"
  );
});

test('title limiter: tabs (and popups) are limited independently, each by its own contents id', () => {
  const { recorder, store, advance } = makeLimited();
  recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/a' });
  recorder.handleNavigation({ wcId: 2, partition: JAR_A.partition, url: 'https://example.com/b' });
  recorder.handleTitleUpdated(1, 'one');
  recorder.handleTitleUpdated(2, 'two');
  assert.equal(titleCalls(store).length, 2, 'both written at once');
  recorder.handleTitleUpdated(1, 'one-late');
  advance(TITLE_INTERVAL_MS);
  assert.equal(titleCalls(store).length, 3);
});

test('address cap: exactly the cap is recorded; one over is not, and clears the last-visit handle (review C5)', () => {
  const { recorder, store } = makeLimited();
  const base = 'https://example.com/';
  const atCap = base + 'a'.repeat(ADDRESS_MAX_CHARS - base.length);
  assert.equal(atCap.length, ADDRESS_MAX_CHARS);
  assert.notEqual(recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: atCap }), null);
  const over = atCap + 'b';
  assert.equal(recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: over }), null);
  assert.equal(store.calls.filter((c) => c[0] === 'recordVisit').length, 1);
  // the over-long page's title is written nowhere (it must not land on the earlier visit's row)
  recorder.handleTitleUpdated(1, 'T');
  assert.equal(titleCalls(store).length, 0);
});

test('C5: an unrecorded scheme or jar clears the handle and a pending title; a later recorded visit works again', () => {
  const { recorder, store, timers, advance } = makeLimited();
  recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/a' });
  recorder.handleTitleUpdated(1, 'first'); // written at once
  recorder.handleTitleUpdated(1, 'pending'); // coalesced, timer armed
  assert.equal(timers.pending(), 1);
  assert.equal(recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'about:blank' }), null);
  assert.equal(timers.pending(), 0, 'the pending title is dropped');
  advance(TITLE_INTERVAL_MS * 2);
  recorder.handleTitleUpdated(1, 'blank page title');
  assert.deepEqual(
    titleCalls(store).map((c) => c[2]),
    ['first']
  );
  recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/b' });
  recorder.handleTitleUpdated(1, 'b title');
  assert.equal(titleCalls(store).at(-1)[1].url, 'https://example.com/b');
});

test("C5: a suppressed duplicate of the tab's own address keeps the handle; another tab's visit does not", () => {
  const { recorder, store } = makeLimited();
  recorder.handleNavigation({ wcId: 2, partition: JAR_A.partition, url: 'https://example.com/z' });
  const id = recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/a' });
  assert.notEqual(id, null);
  assert.equal(recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/a' }), null);
  recorder.handleTitleUpdated(1, 'same page');
  assert.equal(titleCalls(store).length, 1, 'the title still belongs to the tab’s own visit');
  // tab 2 (last visit: z) navigates to the address tab 1 just recorded (suppressed jar-wide)
  recorder.handleNavigation({ wcId: 2, partition: JAR_A.partition, url: 'https://example.com/a' });
  recorder.handleTitleUpdated(2, 'a title');
  assert.equal(titleCalls(store).filter((c) => c[1].url === 'https://example.com/z').length, 0);
});

test('C6: cancelPendingTitles drops every pending title timer, so nothing fires after the store closes', () => {
  const { recorder, store, timers, advance } = makeLimited();
  recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'https://example.com/a' });
  recorder.handleNavigation({ wcId: 2, partition: JAR_B.partition, url: 'https://example.com/b' });
  for (const wc of [1, 2]) {
    recorder.handleTitleUpdated(wc, 'first');
    recorder.handleTitleUpdated(wc, 'second');
  }
  assert.equal(timers.pending(), 2);
  const before = titleCalls(store).length;
  recorder.cancelPendingTitles();
  assert.equal(timers.pending(), 0);
  advance(TITLE_INTERVAL_MS * 5);
  assert.equal(titleCalls(store).length, before, 'no write after the cancel');
});

test('address: userinfo is removed from what is stored, from the handle, and from duplicate suppression', () => {
  const { recorder, store } = makeLimited();
  const id = recorder.handleNavigation({ wcId: 1, partition: JAR_A.partition, url: 'http://u:p@example.com/x' });
  assert.notEqual(id, null);
  assert.equal(store.calls[0][1].url, 'http://example.com/x');
  assert.equal(
    recorder.handleNavigation({ wcId: 2, partition: JAR_A.partition, url: 'http://example.com/x' }),
    null,
    'the same address without credentials is a duplicate'
  );
  recorder.handleTitleUpdated(1, 'T');
  assert.equal(titleCalls(store)[0][1].url, 'http://example.com/x');
});
