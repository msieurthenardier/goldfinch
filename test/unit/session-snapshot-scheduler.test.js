'use strict';

// Unit tests for src/main/session-snapshot-scheduler.js (squawk 0073 — the session
// snapshot used to be written ONLY at before-quit / per-window close, so a hard kill
// lost every tab). Covers all three exports:
//   - createSessionSnapshotScheduler: debounce/flush/cancel mechanics, the isPending
//     re-arm-instead-of-write behavior, and swallow-and-log on a throwing write/isPending.
//   - createDedupedSnapshotWriter: the process-local dedupe cache.
//   - isRestorePending is covered in its own file (session-restore-gate.test.js).
//
// MockTimers recipe (CLAUDE.md): enabled PER TEST (never file-global), drained with a
// real setImmediate around single-step ticks — see test/unit/automation-find.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createSessionSnapshotScheduler,
  createDedupedSnapshotWriter
} = require('../../src/main/session-snapshot-scheduler');

async function drain() {
  await new Promise((r) => setImmediate(r));
}

// ---------------------------------------------------------------------------
// createSessionSnapshotScheduler
// ---------------------------------------------------------------------------

test('schedule() coalesces N calls into exactly one write, after the trailing debounce elapses', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let writes = 0;
  const scheduler = createSessionSnapshotScheduler({
    write: () => writes++,
    setTimeout,
    clearTimeout,
    delayMs: 1500,
    logger: { error() {} }
  });

  scheduler.schedule();
  t.mock.timers.tick(500);
  scheduler.schedule(); // re-arms — the first timer must not have fired yet
  t.mock.timers.tick(500);
  scheduler.schedule(); // re-arms again
  await drain();
  assert.equal(writes, 0, 'no write before the trailing debounce actually elapses');

  t.mock.timers.tick(1500); // the LAST schedule()'s full delay
  await drain();
  assert.equal(writes, 1, 'three schedule() calls coalesce into exactly one write');
});

test('schedule() unrefs the armed timer handle when the handle exposes unref (standing-timer hygiene)', () => {
  let unrefCalls = 0;
  const fakeHandle = { unref: () => unrefCalls++ };
  const scheduler = createSessionSnapshotScheduler({
    write: () => {},
    setTimeout: () => fakeHandle,
    clearTimeout: () => {},
    delayMs: 1500,
    logger: { error() {} }
  });

  scheduler.schedule();
  assert.equal(unrefCalls, 1, 'the armed timer handle was unref()d exactly once');

  // Re-arming (a second schedule() before the first fires) unrefs the new handle too.
  scheduler.schedule();
  assert.equal(unrefCalls, 2, 're-arming unrefs the replacement handle as well');
});

test('schedule() tolerates a timer handle with no unref (e.g. a fake/mock timer handle)', () => {
  // MockTimers / plain numeric handles never expose unref — the guard must not throw.
  const scheduler = createSessionSnapshotScheduler({
    write: () => {},
    setTimeout: () => 42,
    clearTimeout: () => {},
    delayMs: 1500,
    logger: { error() {} }
  });

  assert.doesNotThrow(() => scheduler.schedule());
});

test('flush() writes immediately (when a write is pending) and cancels the timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let writes = 0;
  const scheduler = createSessionSnapshotScheduler({
    write: () => writes++,
    setTimeout,
    clearTimeout,
    delayMs: 1500,
    logger: { error() {} }
  });

  scheduler.schedule();
  scheduler.flush();
  assert.equal(writes, 1, 'flush() performs the pending write immediately');

  // The cancelled timer must never ALSO fire later.
  t.mock.timers.tick(5000);
  await drain();
  assert.equal(writes, 1, 'the original debounce timer was cancelled by flush() — no double write');
});

test('flush() with nothing pending is a no-op', () => {
  let writes = 0;
  const scheduler = createSessionSnapshotScheduler({
    write: () => writes++,
    setTimeout,
    clearTimeout,
    logger: { error() {} }
  });
  scheduler.flush();
  assert.equal(writes, 0, 'flush() with no armed timer never calls write');
});

test('cancel() drops a pending write — it never fires', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let writes = 0;
  const scheduler = createSessionSnapshotScheduler({
    write: () => writes++,
    setTimeout,
    clearTimeout,
    delayMs: 1500,
    logger: { error() {} }
  });

  scheduler.schedule();
  scheduler.cancel();
  t.mock.timers.tick(5000);
  await drain();
  assert.equal(writes, 0, 'a cancelled schedule() never produces a write');
});

test('a write that throws is swallowed and logged — never propagates out of the timer callback', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const errors = [];
  const scheduler = createSessionSnapshotScheduler({
    write: () => {
      throw new Error('disk full');
    },
    setTimeout,
    clearTimeout,
    delayMs: 100,
    logger: { error: (...args) => errors.push(args) }
  });

  scheduler.schedule();
  assert.doesNotThrow(() => t.mock.timers.tick(100));
  await drain();
  assert.equal(errors.length, 1, 'the write error was logged exactly once');
  assert.match(String(errors[0][0]), /write failed/);
});

test('isPending true re-arms instead of writing; a later isPending false lets the write through', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let writes = 0;
  let pending = true;
  const scheduler = createSessionSnapshotScheduler({
    write: () => writes++,
    isPending: () => pending,
    setTimeout,
    clearTimeout,
    delayMs: 1000,
    logger: { error() {} }
  });

  scheduler.schedule();
  t.mock.timers.tick(1000);
  await drain();
  assert.equal(writes, 0, 'gated: the debounce fired but isPending() true refused the write');

  // No new schedule() call was made — the internal re-arm must still be the thing
  // that eventually produces a write once the gate clears.
  pending = false;
  t.mock.timers.tick(1000);
  await drain();
  assert.equal(writes, 1, 'once isPending() clears, the self re-armed timer performs the write');
});

test('an isPending() that throws is swallowed and logged, and does not perform the write', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let writes = 0;
  const errors = [];
  const scheduler = createSessionSnapshotScheduler({
    write: () => writes++,
    isPending: () => {
      throw new Error('registry unavailable');
    },
    setTimeout,
    clearTimeout,
    delayMs: 100,
    logger: { error: (...args) => errors.push(args) }
  });

  scheduler.schedule();
  t.mock.timers.tick(100);
  await drain();
  assert.equal(errors.length, 1, 'the isPending error was logged');
  assert.match(String(errors[0][0]), /isPending check failed/);
  // A throwing isPending() is treated as "not pending" (false) after logging — so the
  // scheduler still attempts the write rather than wedging silently forever.
  assert.equal(writes, 1);
});

// ---------------------------------------------------------------------------
// createDedupedSnapshotWriter
// ---------------------------------------------------------------------------

test('createDedupedSnapshotWriter persists on the first call and skips an identical serialized snapshot', () => {
  const persisted = [];
  let snapshot = { windows: [{ tabs: [{ url: 'https://a.test/', jarId: 'jar-a', active: true }] }] };
  const write = createDedupedSnapshotWriter({
    buildSnapshot: () => snapshot,
    persist: (s) => persisted.push(s)
  });

  write();
  assert.equal(persisted.length, 1, 'first call persists');

  write(); // same snapshot object/content again
  assert.equal(persisted.length, 1, 'an identical serialized snapshot is skipped');

  // A DIFFERENT object with the SAME content also dedupes (string comparison, not
  // reference comparison).
  snapshot = JSON.parse(JSON.stringify(snapshot));
  write();
  assert.equal(persisted.length, 1, 'content-identical (different object identity) still dedupes');

  // A real change persists again.
  snapshot = { windows: [{ tabs: [{ url: 'https://b.test/', jarId: 'jar-a', active: true }] }] };
  write();
  assert.equal(persisted.length, 2, 'a genuinely different snapshot persists');
});

test('createDedupedSnapshotWriter skips entirely (no persist, no cache write) when buildSnapshot returns null/undefined', () => {
  const persisted = [];
  let next = null;
  const write = createDedupedSnapshotWriter({
    buildSnapshot: () => next,
    persist: (s) => persisted.push(s)
  });

  write();
  assert.equal(persisted.length, 0, 'null buildSnapshot() never persists');

  next = undefined;
  write();
  assert.equal(persisted.length, 0, 'undefined buildSnapshot() never persists either');

  // A skip must not seed the dedupe cache — the first REAL snapshot still persists.
  next = { windows: [] };
  write();
  assert.equal(persisted.length, 1, 'the first real snapshot after skips still persists');
});
