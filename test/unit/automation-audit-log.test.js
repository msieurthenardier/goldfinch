'use strict';

// Unit tests for the pure, Electron-free automation audit log (Flight 4, Leg 3,
// DD8). Covers ring eviction at capacity, deterministic ts stamping via an
// injected clock, session open/close (incl. idempotency), the admin-vs-jar kind
// + named jarId derivation, and onChange firing with a snapshot on every
// mutation. No Electron, no SDK — the module is dependency-free by design.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAuditLog, DEFAULT_CAPACITY } = require('../../src/main/automation/audit-log');

// A controllable clock: each read returns the next queued value, or the last one
// forever once the queue drains (so callers that read once-per-mutation get a
// predictable stamp).
function fakeClock(values) {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i += 1;
    return v;
  };
}

test('DEFAULT_CAPACITY is 500 (the named constant)', () => {
  assert.equal(DEFAULT_CAPACITY, 500);
});

test('record stamps ts via the injected now and appends newest-last', () => {
  const log = createAuditLog({ now: fakeClock([100, 200, 300]) });
  log.record({ identity: 'test', sessionId: 's1', op: 'navigate', targetWcId: 1, outcome: 'ok' });
  log.record({ identity: 'test', sessionId: 's1', op: 'click', targetWcId: 2, outcome: 'ok' });

  const entries = log.recentEntries();
  assert.equal(entries.length, 2);
  // Newest-last (natural append order): navigate@100 then click@200.
  assert.equal(entries[0].ts, 100);
  assert.equal(entries[0].op, 'navigate');
  assert.equal(entries[1].ts, 200);
  assert.equal(entries[1].op, 'click');
});

test('record fills defaults: sessionId/targetWcId/errorCode default to null', () => {
  const log = createAuditLog({ now: () => 42 });
  log.record({ identity: 'admin', op: 'enumerateTabs', outcome: 'ok' });
  const [e] = log.recentEntries();
  assert.deepEqual(e, {
    ts: 42,
    sessionId: null,
    identity: 'admin',
    op: 'enumerateTabs',
    targetWcId: null,
    outcome: 'ok',
    errorCode: null,
  });
});

test('record carries an errorCode on an error outcome', () => {
  const log = createAuditLog({ now: () => 1 });
  log.record({ identity: 'test', sessionId: 's', op: 'navigate', targetWcId: 2, outcome: 'error', errorCode: 'out-of-jar' });
  const [e] = log.recentEntries();
  assert.equal(e.outcome, 'error');
  assert.equal(e.errorCode, 'out-of-jar');
});

test('ring evicts the oldest past capacity', () => {
  const log = createAuditLog({ capacity: 3, now: fakeClock([1, 2, 3, 4, 5]) });
  for (let n = 1; n <= 5; n += 1) {
    log.record({ identity: 'test', sessionId: 's', op: 'op' + n, targetWcId: null, outcome: 'ok' });
  }
  const entries = log.recentEntries();
  assert.equal(entries.length, 3, 'length is capped at capacity');
  // The two oldest (op1@1, op2@2) were evicted; op3..op5 remain newest-last.
  assert.deepEqual(entries.map((e) => e.op), ['op3', 'op4', 'op5']);
  assert.deepEqual(entries.map((e) => e.ts), [3, 4, 5]);
});

test('recentEntries returns a copy — mutating it does not affect the ring', () => {
  const log = createAuditLog({ now: () => 1 });
  log.record({ identity: 'test', sessionId: 's', op: 'a', targetWcId: null, outcome: 'ok' });
  const first = log.recentEntries();
  first.push({ tampered: true });
  first[0].op = 'mutated';
  assert.equal(log.recentEntries().length, 1, 'pushing to the copy does not grow the ring');
  assert.equal(log.recentEntries()[0].op, 'a', 'mutating a copied entry does not change the ring');
});

test('noteSessionOpen — a jar identity yields kind:jar with a NAMED jarId', () => {
  const log = createAuditLog({ now: () => 7 });
  log.noteSessionOpen('sid-1', 'work');
  const sessions = log.activeSessions();
  assert.equal(sessions.length, 1);
  assert.deepEqual(sessions[0], { sessionId: 'sid-1', identity: 'work', kind: 'jar', jarId: 'work', since: 7 });
});

test('noteSessionOpen — the admin identity yields kind:admin with jarId null', () => {
  const log = createAuditLog({ now: () => 9 });
  log.noteSessionOpen('sid-a', 'admin');
  const [s] = log.activeSessions();
  assert.deepEqual(s, { sessionId: 'sid-a', identity: 'admin', kind: 'admin', jarId: null, since: 9 });
});

test('noteSessionClose removes the session from the active set', () => {
  const log = createAuditLog({ now: () => 1 });
  log.noteSessionOpen('sid-1', 'test');
  log.noteSessionOpen('sid-2', 'work');
  log.noteSessionClose('sid-1');
  const ids = log.activeSessions().map((s) => s.sessionId);
  assert.deepEqual(ids, ['sid-2']);
});

test('noteSessionClose is idempotent — closing an unknown/already-closed sid is a no-op and does NOT fire onChange', () => {
  let calls = 0;
  const log = createAuditLog({ now: () => 1, onChange: () => { calls += 1; } });
  log.noteSessionOpen('sid-1', 'test'); // 1 fire
  log.noteSessionClose('sid-1'); // 2 fires (real removal)
  log.noteSessionClose('sid-1'); // no-op — no fire
  log.noteSessionClose('never-opened'); // no-op — no fire
  assert.equal(calls, 2, 'only the open and the real close fired onChange');
  assert.equal(log.activeSessions().length, 0);
});

test('onChange fires with a full snapshot on every mutation', () => {
  const snapshots = [];
  const log = createAuditLog({ now: fakeClock([10, 20, 30]), onChange: (snap) => snapshots.push(snap) });

  log.noteSessionOpen('s1', 'test'); // 1
  log.record({ identity: 'test', sessionId: 's1', op: 'navigate', targetWcId: 1, outcome: 'ok' }); // 2
  log.noteSessionClose('s1'); // 3

  assert.equal(snapshots.length, 3);
  // Each snapshot has both views.
  for (const snap of snapshots) {
    assert.ok(Array.isArray(snap.sessions));
    assert.ok(Array.isArray(snap.log));
  }
  // After open: one session, empty log.
  assert.equal(snapshots[0].sessions.length, 1);
  assert.equal(snapshots[0].log.length, 0);
  // After record: still one session, one log entry.
  assert.equal(snapshots[1].sessions.length, 1);
  assert.equal(snapshots[1].log.length, 1);
  assert.equal(snapshots[1].log[0].op, 'navigate');
  // After close: zero sessions, log retained.
  assert.equal(snapshots[2].sessions.length, 0);
  assert.equal(snapshots[2].log.length, 1);
});

test('snapshot() returns both views and is independent of later mutations', () => {
  const log = createAuditLog({ now: () => 1 });
  log.noteSessionOpen('s1', 'test');
  const snap = log.snapshot();
  assert.equal(snap.sessions.length, 1);
  assert.equal(snap.log.length, 0);
  // A later record does not retroactively appear in the captured snapshot.
  log.record({ identity: 'test', sessionId: 's1', op: 'click', targetWcId: 1, outcome: 'ok' });
  assert.equal(snap.log.length, 0, 'captured snapshot is a point-in-time copy');
});

test('onChange is optional — mutations work with no listener', () => {
  const log = createAuditLog({ now: () => 1 });
  assert.doesNotThrow(() => {
    log.noteSessionOpen('s1', 'test');
    log.record({ identity: 'test', sessionId: 's1', op: 'reload', targetWcId: 1, outcome: 'ok' });
    log.noteSessionClose('s1');
  });
});
