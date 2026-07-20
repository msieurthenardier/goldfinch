'use strict';

// Unit tests for the pure downloads-indicator decision model (M11 F1 Leg 2, DD5;
// HAT fix Leg 4 — Chrome-like persistence: visibility survives acknowledgment,
// hiding only via the 5-min idle expiry; acknowledgment instead clears the separate
// `attention` emphasis flag). Covers every transition: progress upsert + visibility,
// same-id dedupe, done→recent move, acknowledge clears attention (stays visible),
// done-after-ack re-raises attention, the cap-25 eviction, and the time-injected
// expire (past / before the 5-min window, including while another item is active), plus the
// ariaLabel strings for active / recent / idle.

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

test('done removes from in-flight and prepends to recent; visible + attention (unacked)', () => {
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
  assert.equal(m.attention, true);
});

test('done newest-first ordering', () => {
  let s = reduce(initialState(), done(1, T0));
  s = reduce(s, done(2, T0 + 1));
  assert.deepEqual(s.recent.map((e) => e.id), [2, 1]);
});

test('a completion after a five-minute gap starts a new recent epoch', () => {
  let s = reduce(initialState(), done(1, T0));
  s = reduce(s, done(2, T0 + IDLE_TIMEOUT_MS));
  assert.deepEqual(s.recent.map((entry) => entry.id), [2]);
});

test('done for an id never seen in progress still records a recent entry (no crash)', () => {
  const s = reduce(initialState(), done(99, T0));
  assert.equal(s.recent.length, 1);
  assert.equal(s.inFlight.size, 0);
});

test('non-completed done removes in-flight without claiming a recent completion', () => {
  let s = reduce(initialState(), progress(5));
  s = reduce(s, { type: 'done', d: { id: 5, filename: 'x', state: 'cancelled', savePath: null }, now: T0 });
  assert.equal(s.inFlight.size, 0);
  assert.equal(s.recent.length, 0);
  assert.equal(deriveModel(s).visible, false);
});

test('hydrate seeds active + the whole live recent epoch and excludes failed rows', () => {
  const s = reduce(initialState(), {
    type: 'hydrate',
    now: T0,
    d: [
      { id: 1, filename: 'active', state: 'progressing', active: true },
      { id: 2, filename: 'fresh', state: 'completed', active: false, endTime: T0 - 2 * 60 * 1000 },
      { id: 3, filename: 'failed', state: 'cancelled', active: false, endTime: T0 - 1 },
      { id: 4, filename: 'older-in-epoch', state: 'completed', active: false, endTime: T0 - 6 * 60 * 1000 },
    ],
  });
  assert.deepEqual([...s.inFlight.keys()], [1]);
  assert.deepEqual(s.recent.map((entry) => entry.id), [2, 4]);
  assert.equal(s.lastCompletionAt, T0 - 2 * 60 * 1000);
});

test('hydrate excludes the whole completion epoch once the newest completion expired', () => {
  const s = reduce(initialState(), {
    type: 'hydrate',
    now: T0,
    d: [
      { id: 1, filename: 'newest-old', state: 'completed', active: false, endTime: T0 - IDLE_TIMEOUT_MS },
      { id: 2, filename: 'older', state: 'completed', active: false, endTime: T0 - IDLE_TIMEOUT_MS - 1 },
    ],
  });
  assert.deepEqual(s.recent, []);
  assert.equal(s.lastCompletionAt, null);
});

test('hydrate never overwrites ids already observed from the live event stream', () => {
  let s = reduce(initialState(), progress(8, { received: 9 }));
  s = reduce(s, {
    type: 'hydrate', now: T0, seen: new Set([8]),
    d: [{ id: 8, filename: 'stale', state: 'progressing', active: true, received: 1 }],
  });
  assert.equal(s.inFlight.get(8).received, 9);
  assert.equal(s.inFlight.get(8).filename, 'file-8.bin');
});

// ---------------------------------------------------------------------------
// acknowledge clears attention, NOT visibility (HAT fix, Leg 4 — Chrome-like:
// the indicator persists after the popup is viewed; only the 5-min idle expiry
// hides it). Inverted from the pre-fix "acknowledge hides the indicator" test —
// renamed rather than deleted so git blame shows the behavior/intent shift.
// ---------------------------------------------------------------------------

test('acknowledge clears attention but keeps the indicator visible once in-flight is empty', () => {
  let s = reduce(initialState(), progress(1));
  s = reduce(s, done(1, T0));
  s = reduce(s, { type: 'acknowledge' });
  assert.equal(s.acknowledged, true);
  const m = deriveModel(s);
  assert.equal(m.visible, true);
  assert.equal(m.attention, false);
  assert.equal(m.recentCount, 1);
});

test('a done after acknowledge resets acknowledgment and re-raises attention (stays visible throughout)', () => {
  let s = reduce(initialState(), done(1, T0));
  s = reduce(s, { type: 'acknowledge' });
  let m = deriveModel(s);
  assert.equal(m.visible, true);
  assert.equal(m.attention, false);
  s = reduce(s, done(2, T0 + 1));
  assert.equal(s.acknowledged, false);
  m = deriveModel(s);
  assert.equal(m.visible, true);
  assert.equal(m.attention, true);
  assert.equal(m.recentCount, 2);
});

test('acknowledged but still in-flight stays visible (active wins) and carries no attention', () => {
  let s = reduce(initialState(), progress(1));
  s = reduce(s, { type: 'acknowledge' });
  const m = deriveModel(s);
  assert.equal(m.visible, true);
  assert.equal(m.attention, false);
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

test('expire past the 5-min window still clears recent and hides after acknowledgment', () => {
  let s = reduce(initialState(), done(1, T0));
  s = reduce(s, { type: 'acknowledge' });
  assert.equal(deriveModel(s).visible, true); // acknowledged but not yet expired: still visible
  s = reduce(s, { type: 'expire', now: T0 + IDLE_TIMEOUT_MS });
  assert.equal(s.recent.length, 0);
  const m = deriveModel(s);
  assert.equal(m.visible, false);
  assert.equal(m.attention, false);
});

test('expire before the 5-min window is a no-op', () => {
  let s = reduce(initialState(), done(1, T0));
  const before = s;
  s = reduce(s, { type: 'expire', now: T0 + IDLE_TIMEOUT_MS - 1 });
  assert.equal(s, before); // unchanged reference — pure no-op
  assert.equal(s.recent.length, 1);
});

test('expire clears stale recent while an in-flight download keeps the indicator visible', () => {
  let s = reduce(initialState(), done(1, T0));
  s = reduce(s, progress(2)); // still active
  s = reduce(s, { type: 'expire', now: T0 + IDLE_TIMEOUT_MS + 5000 });
  assert.equal(s.recent.length, 0);
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

test('ariaLabel: acknowledged recent is still visible and keeps the same completed-count wording', () => {
  let s = reduce(initialState(), done(1, T0));
  s = reduce(s, { type: 'acknowledge' });
  const m = deriveModel(s);
  assert.equal(m.visible, true);
  assert.equal(m.attention, false);
  assert.equal(m.ariaLabel, 'Downloads — 1 recently completed');
});

test('ariaLabel: idle state is the plain label', () => {
  assert.equal(deriveModel(initialState()).ariaLabel, 'Downloads');
});

test('unknown event type is a pure no-op', () => {
  const s0 = initialState();
  assert.equal(reduce(s0, { type: 'nope' }), s0);
  assert.equal(reduce(s0, undefined), s0);
});
