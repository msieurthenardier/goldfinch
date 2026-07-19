'use strict';

// Unit tests for the pure downloads-indicator decision model (M11 F1 Leg 2, DD5).
// Covers every DD5 transition the leg enumerates (§7): progress upsert + visibility,
// same-id dedupe, done→recent move, acknowledge hide, done-after-ack re-show, the
// cap-25 eviction, and the time-injected expire (past / before the 5-min window, and
// blocked while in-flight), plus the ariaLabel strings for active / recent / idle.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  initialState,
  reduce,
  deriveModel,
  RECENT_CAP,
  IDLE_TIMEOUT_MS,
} = require('../../src/renderer/chrome/downloads-indicator-model');

const T0 = 1_000_000; // arbitrary base timestamp

function progress(id, extra = {}) {
  return { type: 'progress', d: { id, filename: `file-${id}.bin`, received: 1, total: 10, state: 'progressing', ...extra } };
}
function done(id, now, extra = {}) {
  return { type: 'done', d: { id, filename: `file-${id}.bin`, state: 'completed', savePath: `/dl/file-${id}.bin`, ...extra }, now };
}

// ---------------------------------------------------------------------------
// progress
// ---------------------------------------------------------------------------

test('progress makes the indicator visible + active with count 1', () => {
  const s = reduce(initialState(), progress(1));
  const m = deriveModel(s);
  assert.equal(m.visible, true);
  assert.equal(m.active, true);
  assert.equal(m.activeCount, 1);
  assert.equal(m.recentCount, 0);
});

test('two progress events for the same id keep a single in-flight entry', () => {
  let s = reduce(initialState(), progress(7, { received: 1 }));
  s = reduce(s, progress(7, { received: 5 }));
  assert.equal(s.inFlight.size, 1);
  assert.equal(s.inFlight.get(7).received, 5); // upsert, latest wins
  assert.equal(deriveModel(s).activeCount, 1);
});

test('reduce does not mutate the prior state (pure)', () => {
  const s0 = initialState();
  const s1 = reduce(s0, progress(1));
  assert.equal(s0.inFlight.size, 0);
  assert.notEqual(s0.inFlight, s1.inFlight);
});

// ---------------------------------------------------------------------------
// done → recent
// ---------------------------------------------------------------------------

test('done removes from in-flight and prepends to recent; still visible (unacked)', () => {
  let s = reduce(initialState(), progress(1));
  s = reduce(s, done(1, T0));
  assert.equal(s.inFlight.size, 0);
  assert.equal(s.recent.length, 1);
  assert.equal(s.recent[0].id, 1);
  assert.equal(s.recent[0].savePath, '/dl/file-1.bin');
  assert.equal(s.lastCompletionAt, T0);
  const m = deriveModel(s);
  assert.equal(m.visible, true);
  assert.equal(m.active, false);
  assert.equal(m.recentCount, 1);
});

test('done newest-first ordering', () => {
  let s = reduce(initialState(), done(1, T0));
  s = reduce(s, done(2, T0 + 1));
  assert.deepEqual(s.recent.map((e) => e.id), [2, 1]);
});

test('done for an id never seen in progress still records a recent entry (no crash)', () => {
  const s = reduce(initialState(), done(99, T0));
  assert.equal(s.recent.length, 1);
  assert.equal(s.inFlight.size, 0);
});

test('non-completed done with null savePath is recorded, not dropped', () => {
  const s = reduce(initialState(), { type: 'done', d: { id: 5, filename: 'x', state: 'cancelled', savePath: null }, now: T0 });
  assert.equal(s.recent.length, 1);
  assert.equal(s.recent[0].state, 'cancelled');
  assert.equal(s.recent[0].savePath, null);
});

// ---------------------------------------------------------------------------
// acknowledge + re-show
// ---------------------------------------------------------------------------

test('acknowledge hides the indicator once in-flight is empty', () => {
  let s = reduce(initialState(), progress(1));
  s = reduce(s, done(1, T0));
  s = reduce(s, { type: 'acknowledge' });
  assert.equal(s.acknowledged, true);
  assert.equal(deriveModel(s).visible, false);
});

test('a done after acknowledge resets acknowledgment and re-shows', () => {
  let s = reduce(initialState(), done(1, T0));
  s = reduce(s, { type: 'acknowledge' });
  assert.equal(deriveModel(s).visible, false);
  s = reduce(s, done(2, T0 + 1));
  assert.equal(s.acknowledged, false);
  assert.equal(deriveModel(s).visible, true);
  assert.equal(deriveModel(s).recentCount, 2);
});

test('acknowledged but still in-flight stays visible (active wins)', () => {
  let s = reduce(initialState(), progress(1));
  s = reduce(s, { type: 'acknowledge' });
  assert.equal(deriveModel(s).visible, true);
});

// ---------------------------------------------------------------------------
// cap-25 eviction
// ---------------------------------------------------------------------------

test('26 dones evict to the 25 newest', () => {
  let s = initialState();
  for (let i = 1; i <= 26; i++) s = reduce(s, done(i, T0 + i));
  assert.equal(s.recent.length, RECENT_CAP);
  assert.equal(s.recent.length, 25);
  assert.equal(s.recent[0].id, 26); // newest kept at head
  assert.equal(s.recent[s.recent.length - 1].id, 2); // id 1 evicted (oldest)
  assert.equal(s.recent.some((e) => e.id === 1), false);
});

// ---------------------------------------------------------------------------
// expire (time-injected)
// ---------------------------------------------------------------------------

test('expire past the 5-min window with no in-flight clears recent and hides', () => {
  let s = reduce(initialState(), done(1, T0));
  s = reduce(s, { type: 'expire', now: T0 + IDLE_TIMEOUT_MS });
  assert.equal(s.recent.length, 0);
  assert.equal(s.acknowledged, false);
  assert.equal(s.lastCompletionAt, null);
  assert.equal(deriveModel(s).visible, false);
});

test('expire before the 5-min window is a no-op', () => {
  let s = reduce(initialState(), done(1, T0));
  const before = s;
  s = reduce(s, { type: 'expire', now: T0 + IDLE_TIMEOUT_MS - 1 });
  assert.equal(s, before); // unchanged reference — pure no-op
  assert.equal(s.recent.length, 1);
});

test('expire while a download is in-flight is a no-op even past the window', () => {
  let s = reduce(initialState(), done(1, T0));
  s = reduce(s, progress(2)); // still active
  s = reduce(s, { type: 'expire', now: T0 + IDLE_TIMEOUT_MS + 5000 });
  assert.equal(s.recent.length, 1);
  assert.equal(s.inFlight.size, 1);
  assert.equal(deriveModel(s).visible, true);
});

test('expire with no completion history is a no-op', () => {
  const s0 = initialState();
  const s = reduce(s0, { type: 'expire', now: T0 });
  assert.equal(s, s0);
});

// ---------------------------------------------------------------------------
// ariaLabel — state conveyed in words
// ---------------------------------------------------------------------------

test('ariaLabel: active state names the in-progress count', () => {
  let s = reduce(initialState(), progress(1));
  s = reduce(s, progress(2));
  assert.equal(deriveModel(s).ariaLabel, 'Downloading — 2 in progress');
});

test('ariaLabel: all-paused active state reads as paused', () => {
  const s = reduce(initialState(), progress(1, { paused: true }));
  assert.equal(deriveModel(s).ariaLabel, 'Downloads paused — 1 in progress');
});

test('ariaLabel: recent-only state names the completed count', () => {
  const s = reduce(initialState(), done(1, T0));
  assert.equal(deriveModel(s).ariaLabel, 'Downloads — 1 recently completed');
});

test('ariaLabel: idle state is the plain label', () => {
  assert.equal(deriveModel(initialState()).ariaLabel, 'Downloads');
});

test('unknown event type is a pure no-op', () => {
  const s0 = initialState();
  assert.equal(reduce(s0, { type: 'nope' }), s0);
  assert.equal(reduce(s0, undefined), s0);
});
