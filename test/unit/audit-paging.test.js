'use strict';

// Unit tests for the pure, DOM-free activity-viewer pagination + freshness state
// machine (Flight 7, Leg 6, DD4). Covers windowPage boundaries + newest-first
// ordering, countNewer (incl. the ring-eviction case), and the reduceAudit
// freeze/thaw/back-to-live transitions. No DOM, no Electron — the renderer loads
// the exact same module via <script>.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { windowPage, countNewer, activeLog, reduceAudit } = require('../../src/shared/audit-paging');

// Build a newest-LAST log of N entries with ascending ts (ts === index+1), the
// ring's natural append order.
function makeLog(n) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push({ ts: i + 1, op: 'navigate', identity: 'jar', outcome: 'ok' });
  return out;
}

const PAGE = 20;

test('windowPage: empty log -> no rows, total 0, no prev/next, indices 0', () => {
  const w = windowPage([], 1, PAGE);
  assert.deepEqual(w.rows, []);
  assert.equal(w.total, 0);
  assert.equal(w.showingFrom, 0);
  assert.equal(w.showingTo, 0);
  assert.equal(w.hasPrev, false);
  assert.equal(w.hasNext, false);
});

test('windowPage: single entry', () => {
  const w = windowPage(makeLog(1), 1, PAGE);
  assert.equal(w.rows.length, 1);
  assert.equal(w.total, 1);
  assert.equal(w.showingFrom, 1);
  assert.equal(w.showingTo, 1);
  assert.equal(w.hasNext, false);
  assert.equal(w.hasPrev, false);
});

test('windowPage: 19 entries -> single full-ish page, newest-first', () => {
  const w = windowPage(makeLog(19), 1, PAGE);
  assert.equal(w.rows.length, 19);
  assert.equal(w.total, 19);
  assert.equal(w.showingFrom, 1);
  assert.equal(w.showingTo, 19);
  assert.equal(w.hasNext, false);
  // newest-first: first row is the highest ts (19).
  assert.equal(w.rows[0].ts, 19);
  assert.equal(w.rows[18].ts, 1);
});

test('windowPage: exactly 20 entries -> one page, no next', () => {
  const w = windowPage(makeLog(20), 1, PAGE);
  assert.equal(w.rows.length, 20);
  assert.equal(w.total, 20);
  assert.equal(w.showingFrom, 1);
  assert.equal(w.showingTo, 20);
  assert.equal(w.hasNext, false);
  assert.equal(w.rows[0].ts, 20);
});

test('windowPage: 21 entries -> page 1 has 20 newest, page 2 has the oldest 1', () => {
  const log = makeLog(21);
  const p1 = windowPage(log, 1, PAGE);
  assert.equal(p1.rows.length, 20);
  assert.equal(p1.showingFrom, 1);
  assert.equal(p1.showingTo, 20);
  assert.equal(p1.hasPrev, false);
  assert.equal(p1.hasNext, true);
  assert.equal(p1.rows[0].ts, 21); // newest first
  assert.equal(p1.rows[19].ts, 2);

  const p2 = windowPage(log, 2, PAGE);
  assert.equal(p2.rows.length, 1);
  assert.equal(p2.total, 21);
  assert.equal(p2.showingFrom, 21);
  assert.equal(p2.showingTo, 21);
  assert.equal(p2.hasPrev, true);
  assert.equal(p2.hasNext, false);
  assert.equal(p2.rows[0].ts, 1); // the oldest entry
});

test('windowPage: 41 entries -> first / middle / last page boundaries', () => {
  const log = makeLog(41);
  const p1 = windowPage(log, 1, PAGE);
  assert.equal(p1.rows.length, 20);
  assert.equal(p1.showingFrom, 1);
  assert.equal(p1.showingTo, 20);
  assert.equal(p1.rows[0].ts, 41);
  assert.equal(p1.hasPrev, false);
  assert.equal(p1.hasNext, true);

  const p2 = windowPage(log, 2, PAGE); // middle full page
  assert.equal(p2.rows.length, 20);
  assert.equal(p2.showingFrom, 21);
  assert.equal(p2.showingTo, 40);
  assert.equal(p2.rows[0].ts, 21);
  assert.equal(p2.hasPrev, true);
  assert.equal(p2.hasNext, true);

  const p3 = windowPage(log, 3, PAGE); // last partial page
  assert.equal(p3.rows.length, 1);
  assert.equal(p3.showingFrom, 41);
  assert.equal(p3.showingTo, 41);
  assert.equal(p3.rows[0].ts, 1);
  assert.equal(p3.hasPrev, true);
  assert.equal(p3.hasNext, false);
});

test('windowPage: reverse-then-slice yields strictly-descending ts on every page', () => {
  const log = makeLog(41);
  for (const page of [1, 2, 3]) {
    const { rows } = windowPage(log, page, PAGE);
    for (let i = 1; i < rows.length; i += 1) {
      assert.ok(rows[i - 1].ts > rows[i].ts, `page ${page} row ${i} not strictly descending`);
    }
  }
});

test('windowPage: total comes from the passed log (so a frozen log freezes total)', () => {
  const frozen = makeLog(25);
  const w = windowPage(frozen, 2, PAGE);
  assert.equal(w.total, 25); // not whatever a grown live ring might hold
});

test('countNewer: none newer when live === frozen', () => {
  const log = makeLog(10);
  assert.equal(countNewer(log, log), 0);
});

test('countNewer: some newer (appended entries)', () => {
  const frozen = makeLog(10); // ts 1..10
  const live = makeLog(13); // ts 1..13
  assert.equal(countNewer(live, frozen), 3); // ts 11,12,13
});

test('countNewer: eviction case — equal lengths but newest ts advanced -> N>0', () => {
  // Ring at capacity: frozen holds ts 1..5, live evicted the oldest and now holds
  // ts 3..7 — SAME length (5) but two genuinely-newer entries arrived.
  const frozen = [{ ts: 1 }, { ts: 2 }, { ts: 3 }, { ts: 4 }, { ts: 5 }];
  const live = [{ ts: 3 }, { ts: 4 }, { ts: 5 }, { ts: 6 }, { ts: 7 }];
  assert.equal(frozen.length, live.length);
  assert.equal(countNewer(live, frozen), 2); // ts 6,7 — a length delta would read 0
});

test('countNewer: empty frozen -> all live entries are "newer"', () => {
  assert.equal(countNewer(makeLog(4), []), 4);
});

test('reduceAudit: broadcast on page 1 stays live and keeps frozenLog null', () => {
  let state = { page: 1, frozenLog: null, liveLog: makeLog(5) };
  state = reduceAudit(state, { type: 'broadcast', log: makeLog(7) });
  assert.equal(state.page, 1);
  assert.equal(state.frozenLog, null);
  assert.equal(state.liveLog.length, 7);
  // active log is the live ring
  assert.equal(activeLog(state).length, 7);
});

test('reduceAudit: next -> page 2 freezes a snapshot of the live ring', () => {
  let state = { page: 1, frozenLog: null, liveLog: makeLog(30) };
  state = reduceAudit(state, { type: 'next' });
  assert.equal(state.page, 2);
  assert.ok(state.frozenLog);
  assert.equal(state.frozenLog.length, 30);
  // frozen snapshot is the liveLog reference captured at freeze time
  assert.deepEqual(state.frozenLog, makeLog(30));
});

test('reduceAudit: broadcast while frozen keeps rows stable but updates liveLog for newer-count', () => {
  let state = { page: 1, frozenLog: null, liveLog: makeLog(30) };
  state = reduceAudit(state, { type: 'next' }); // freeze on page 2
  const frozenBefore = state.frozenLog;
  state = reduceAudit(state, { type: 'broadcast', log: makeLog(33) });
  // frozen rows unchanged
  assert.equal(state.frozenLog, frozenBefore);
  assert.equal(state.frozenLog.length, 30);
  // liveLog grew
  assert.equal(state.liveLog.length, 33);
  // active (rendered) log is still the frozen one
  assert.equal(activeLog(state).length, 30);
  // total while frozen comes from frozenLog, not the grown ring
  assert.equal(windowPage(activeLog(state), state.page, PAGE).total, 30);
  // newer-count reflects the live growth
  assert.equal(countNewer(state.liveLog, state.frozenLog), 3);
});

test('reduceAudit: prev back to page 1 clears frozen AND a same-tick broadcast does not re-freeze', () => {
  let state = { page: 1, frozenLog: null, liveLog: makeLog(30) };
  state = reduceAudit(state, { type: 'next' }); // page 2, frozen
  assert.equal(state.page, 2);
  state = reduceAudit(state, { type: 'prev' }); // back to page 1
  assert.equal(state.page, 1);
  assert.equal(state.frozenLog, null);
  // a broadcast arriving the same tick must NOT re-freeze (page is 1)
  state = reduceAudit(state, { type: 'broadcast', log: makeLog(31) });
  assert.equal(state.page, 1);
  assert.equal(state.frozenLog, null);
  assert.equal(activeLog(state).length, 31);
});

test('reduceAudit: prev from page 3 to page 2 keeps the freeze', () => {
  let state = { page: 1, frozenLog: null, liveLog: makeLog(50) };
  state = reduceAudit(state, { type: 'next' }); // page 2, freeze
  state = reduceAudit(state, { type: 'next' }); // page 3, still frozen
  assert.equal(state.page, 3);
  const frozen = state.frozenLog;
  state = reduceAudit(state, { type: 'prev' }); // page 2 — NOT page 1, freeze stays
  assert.equal(state.page, 2);
  assert.equal(state.frozenLog, frozen);
});

test('reduceAudit: next clamps as a no-op at the last page', () => {
  let state = { page: 1, frozenLog: null, liveLog: makeLog(15) }; // single page
  const next = reduceAudit(state, { type: 'next' });
  assert.equal(next, state); // identity — no-op
  assert.equal(next.page, 1);
  assert.equal(next.frozenLog, null);
});

test('reduceAudit: prev clamps as a no-op at page 1', () => {
  let state = { page: 1, frozenLog: null, liveLog: makeLog(40) };
  const prev = reduceAudit(state, { type: 'prev' });
  assert.equal(prev, state); // identity — no-op
  assert.equal(prev.page, 1);
});

test('reduceAudit: back-to-live resets page to 1 and clears frozen', () => {
  let state = { page: 1, frozenLog: null, liveLog: makeLog(60) };
  state = reduceAudit(state, { type: 'next' }); // page 2 frozen
  state = reduceAudit(state, { type: 'next' }); // page 3 frozen
  state = reduceAudit(state, { type: 'back-to-live' });
  assert.equal(state.page, 1);
  assert.equal(state.frozenLog, null);
  assert.equal(activeLog(state).length, 60);
});

test('reduceAudit: back-to-live and prev-to-page-1 reach the same observable end-state', () => {
  const live = makeLog(45);
  let viaPrev = { page: 1, frozenLog: null, liveLog: live };
  viaPrev = reduceAudit(viaPrev, { type: 'next' }); // page 2
  viaPrev = reduceAudit(viaPrev, { type: 'prev' }); // page 1, cleared

  let viaBtl = { page: 1, frozenLog: null, liveLog: live };
  viaBtl = reduceAudit(viaBtl, { type: 'next' }); // page 2
  viaBtl = reduceAudit(viaBtl, { type: 'back-to-live' });

  assert.equal(viaPrev.page, viaBtl.page);
  assert.equal(viaPrev.frozenLog, viaBtl.frozenLog); // both null
});

test('reduceAudit: unknown event type is a no-op (returns the same state)', () => {
  const state = { page: 2, frozenLog: makeLog(20), liveLog: makeLog(25) };
  assert.equal(reduceAudit(state, { type: 'nope' }), state);
});
