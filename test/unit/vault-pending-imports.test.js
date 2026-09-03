'use strict';

// Unit tests for the per-owning-window held-import store (PR#112 finding 5; RE-MODELED
// M18 F3 Leg 3 / DD2 ruling 1 — the pin-discipline casualty named in the leg spec). The
// record shape changed from `{ bundle, destinationTarget, overwrite }` (destination bound
// at pick time) to `{ bundle, handle }` at pick, gaining `{ secret, secretKind, labels }`
// only after a verified secret step (DD2 ruling 1: destination binding moved to COMMIT
// time, downstream of the mapping step) — so every test that exercised the old
// destinationTarget/overwrite fields is gone; this file now pins hold/stashSecret/take/
// clear/peek/peekLabels window isolation, the take()/timer cancel-on-consume discipline
// (DD5 ruling 4, cycle-2 HIGH), and the chromeIds()/dropAll() bulk-drop enumeration.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createPendingImportStore, SAFETY_DROP_MS } = require('../../src/main/vault/pending-imports');

// Deterministic handle generator for assertions.
function seqHandles() {
  let n = 0;
  return () => `h${++n}`;
}

// A controllable fake timer pair (mirrors vault-store.test.js's idle-timer idiom): captures
// every scheduled callback + its delay so a test can fire or cancel it deterministically,
// with NO real wall-clock wait.
function fakeTimers() {
  let nextId = 1;
  /** @type {Map<number, { fn: () => void, ms: number }>} */
  const scheduled = new Map();
  return {
    setTimeout: (fn, ms) => {
      const id = nextId++;
      scheduled.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => {
      scheduled.delete(id);
    },
    fire: (id) => {
      const entry = scheduled.get(id);
      if (!entry) throw new Error(`no scheduled timer ${id}`);
      scheduled.delete(id);
      entry.fn();
    },
    isScheduled: (id) => scheduled.has(id),
    scheduledCount: () => scheduled.size
  };
}

function makeStore(timers = fakeTimers()) {
  return { store: createPendingImportStore({ mintHandle: seqHandles(), ...timers }), timers };
}

test('two windows hold INDEPENDENT records — neither can see/consume the other (finding 5)', () => {
  const { store } = makeStore();
  const A = 100; // window A's owning-chrome id
  const B = 200; // window B's

  const hA = store.hold(A, { bundle: { tag: 'A' } });
  const hB = store.hold(B, { bundle: { tag: 'B' } });
  assert.notEqual(hA, hB, 'distinct handles per transaction');

  // Each window sees ONLY its own record.
  assert.equal(store.peek(A).bundle.tag, 'A');
  assert.equal(store.peek(B).bundle.tag, 'B');

  // Consuming A's record leaves B's untouched (the cross-window confusion is gone).
  const takenA = store.take(A);
  assert.equal(takenA.bundle.tag, 'A');
  assert.equal(store.peek(A), null, 'A is consumed');
  assert.equal(store.peek(B).bundle.tag, 'B', 'B is unaffected by A being consumed');
});

test('DD2 ruling 1: hold() carries ONLY { bundle, handle } — no destination, no overwrite', () => {
  const { store } = makeStore();
  const h = store.hold(100, { bundle: { tag: 'A' } });
  const rec = store.peek(100);
  assert.deepEqual(Object.keys(rec).sort(), ['bundle', 'handle']);
  assert.equal(rec.handle, h);
});

test("a second window re-holding does NOT overwrite the first window's record", () => {
  const { store } = makeStore();
  store.hold(100, { bundle: { tag: 'A' } });
  store.hold(200, { bundle: { tag: 'B-overwrite-attempt' } });
  // Window A's record is exactly as it was — window B cannot clobber it (the demonstrated exploit).
  assert.equal(store.peek(100).bundle.tag, 'A');
});

test('a re-pick in the SAME window replaces the record and safely drops (zeroizes) any secret it held', () => {
  const { store, timers } = makeStore();
  const h1 = store.hold(100, { bundle: { tag: 'first' } });
  const secret = Buffer.from('hunter2');
  store.stashSecret(100, { secret, secretKind: 'master', labels: [] }, h1);
  assert.equal(timers.scheduledCount(), 1, 'the safety-drop timer is armed');

  const h2 = store.hold(100, { bundle: { tag: 'second' } });
  assert.notEqual(h1, h2);
  assert.equal(store.peek(100).bundle.tag, 'second');
  assert.equal(timers.scheduledCount(), 0, 're-pick cancels the prior timer');
  assert.ok(
    secret.every((b) => b === 0),
    're-pick zeroizes the prior record’s held secret'
  );
});

test('stashSecret binds { secret, secretKind, labels } and arms the safety-drop timer at SAFETY_DROP_MS', () => {
  const { store, timers } = makeStore();
  const h = store.hold(100, { bundle: {} });
  const secret = Buffer.from('correct horse battery staple');
  const labels = [{ sourceId: 'work', jarMeta: { name: 'Work', color: '#fff' }, itemCount: 3 }];
  store.stashSecret(100, { secret, secretKind: 'recovery', labels }, h);

  const rec = store.peek(100);
  assert.equal(rec.secret, secret);
  assert.equal(rec.secretKind, 'recovery');
  assert.deepEqual(rec.labels, labels);
  assert.equal(timers.scheduledCount(), 1);
});

test('stashSecret is window-scoped and handle-guarded: a mismatched handle or an unheld window is a no-op', () => {
  const { store } = makeStore();
  const h = store.hold(100, { bundle: {} });
  store.stashSecret(999, { secret: Buffer.from('x'), labels: [] }, h);
  assert.equal(store.peek(999), null, 'no record materializes for an unheld window');

  store.stashSecret(100, { secret: Buffer.from('x'), labels: [] }, 'stale-handle');
  assert.equal(store.peek(100).secret, undefined, 'a mismatched handle cannot bind the secret');
});

test('take() CANCELS the safety-drop timer WITHOUT zeroizing — the consumer owns the secret (DD5 ruling 4, cycle-2 HIGH)', () => {
  const { store, timers } = makeStore();
  const h = store.hold(100, { bundle: { tag: 'A' } });
  const secret = Buffer.from('correct horse battery staple');
  store.stashSecret(100, { secret, secretKind: 'master', labels: [] }, h);
  assert.equal(timers.scheduledCount(), 1);

  const taken = store.take(100);
  assert.equal(taken.secret, secret);
  assert.ok(
    secret.every((b) => b !== 0),
    'take() must NOT zeroize — a commit needs the live buffer'
  );
  assert.equal(timers.scheduledCount(), 0, 'take() cancels the timer as part of consuming the record');
  assert.equal(store.peek(100), null, 'the record is removed');
});

test('a bare hold (pre-secret) can still be taken (its optional fields are simply absent)', () => {
  const { store } = makeStore();
  store.hold(100, { bundle: { tag: 'A' } });
  const taken = store.take(100);
  assert.equal(taken.secret, undefined);
  assert.equal(taken.labels, undefined);
});

test('clear() zeroizes the secret (when present) and cancels the timer — explicit cancel/dismiss', () => {
  const { store, timers } = makeStore();
  const h = store.hold(100, { bundle: {} });
  const secret = Buffer.from('hunter2');
  store.stashSecret(100, { secret, labels: [] }, h);

  store.clear(100, h);
  assert.equal(store.peek(100), null);
  assert.equal(timers.scheduledCount(), 0);
  assert.ok(
    secret.every((b) => b === 0),
    'clear() zeroizes the held secret'
  );
});

test('the opaque handle guards a stale same-window transaction on clear', () => {
  const { store } = makeStore();
  const h1 = store.hold(100, { bundle: { tag: 'first' } });
  const h2 = store.hold(100, { bundle: { tag: 'second' } });
  assert.notEqual(h1, h2);

  // A late clear carrying the STALE handle (h1) is ignored — it cannot clear the live record.
  store.clear(100, h1);
  assert.equal(store.peek(100).bundle.tag, 'second', 'a stale handle cannot clear the live record');

  // The CURRENT handle works.
  store.clear(100, h2);
  assert.equal(store.peek(100), null, 'the matching handle clears it');
});

test('clear/take are safe no-ops on an unheld window', () => {
  const { store } = makeStore();
  assert.equal(store.take(999), null);
  assert.doesNotThrow(() => store.clear(999, 'whatever'));
  assert.equal(store.peek(999), null);
});

test('a handle-less mutating call still works (window key is the primary isolation)', () => {
  const { store } = makeStore();
  store.hold(100, { bundle: { tag: 'A' } });
  store.clear(100); // no handle
  assert.equal(store.peek(100), null);
});

// ---------------------------------------------------------------------------
// peekLabels — the page's window-scoped labels fetch (DD2 ruling 3(c))
// ---------------------------------------------------------------------------

test('peekLabels returns null before the secret step, and { handle, labels } (never bundle/secret) after', () => {
  const { store } = makeStore();
  const h = store.hold(100, { bundle: { tag: 'secret-bundle-contents' } });
  assert.equal(store.peekLabels(100), null, 'no labels yet — the secret step has not run');

  const labels = [{ sourceId: 'global', jarMeta: null, itemCount: 5 }];
  store.stashSecret(100, { secret: Buffer.from('x'), secretKind: 'master', labels }, h);
  const projection = store.peekLabels(100);
  assert.deepEqual(projection, { handle: h, labels });
  assert.deepEqual(Object.keys(projection).sort(), ['handle', 'labels'], 'never bundle or secret');
});

test('peekLabels is null for an unheld window', () => {
  const { store } = makeStore();
  assert.equal(store.peekLabels(999), null);
});

// ---------------------------------------------------------------------------
// chromeIds() / dropAll() — the vault-lock bulk-drop enumeration (DD5 ruling 4)
// ---------------------------------------------------------------------------

test('chromeIds() lists every window with a held record; dropAll() zeroizes + clears every one', () => {
  const { store, timers } = makeStore();
  const hA = store.hold(100, { bundle: {} });
  store.hold(200, { bundle: {} }); // no secret stashed — must still be dropped
  const secretA = Buffer.from('a-secret');
  store.stashSecret(100, { secret: secretA, labels: [] }, hA);

  assert.deepEqual(store.chromeIds().sort(), [100, 200]);
  assert.equal(timers.scheduledCount(), 1, 'only window A armed a safety-drop timer');

  store.dropAll();
  assert.equal(store.peek(100), null);
  assert.equal(store.peek(200), null);
  assert.deepEqual(store.chromeIds(), []);
  assert.equal(timers.scheduledCount(), 0, 'dropAll cancels every armed timer');
  assert.ok(
    secretA.every((b) => b === 0),
    'dropAll zeroizes every held secret'
  );
});

test('dropAll on an empty store is a safe no-op', () => {
  const { store } = makeStore();
  assert.doesNotThrow(() => store.dropAll());
});

// ---------------------------------------------------------------------------
// Safety-drop timer expiry — the secret-bearing phase's bound (DD5 ruling 4)
// ---------------------------------------------------------------------------

test('the safety-drop timer arms at SAFETY_DROP_MS and, left to fire, zeroizes + drops the record', () => {
  assert.equal(SAFETY_DROP_MS, 5 * 60 * 1000, 'five minutes — mapping is operator-paced reading, DD5 ruling 4');
  const timers = fakeTimers();
  const { store } = makeStore(timers);
  const h = store.hold(100, { bundle: {} });
  const secret = Buffer.from('correct horse battery staple');
  store.stashSecret(100, { secret, labels: [] }, h);

  assert.equal(timers.scheduledCount(), 1, 'exactly one timer armed for this record');
  // Fire the ONE scheduled timer directly (deterministic, no wall-clock wait) — this
  // store's timer ids start at 1 (fakeTimers is fresh per test).
  timers.fire(1);

  assert.equal(store.peek(100), null, 'expiry drops the record');
  assert.ok(
    secret.every((b) => b === 0),
    'expiry zeroizes the secret'
  );
});

test('a commit-started take() just before expiry leaves the buffer intact — the timer cancel-on-consume race (cycle-2 HIGH)', () => {
  const timers = fakeTimers();
  const { store } = makeStore(timers);
  const h = store.hold(100, { bundle: {} });
  const secret = Buffer.from('correct horse battery staple');
  store.stashSecret(100, { secret, labels: [] }, h);

  // take() (a commit starting at T-1s) cancels the timer before the dangling expiry could fire.
  const taken = store.take(100);
  assert.equal(timers.scheduledCount(), 0, 'the timer never fires after take()');
  assert.ok(
    taken.secret.every((b) => b !== 0),
    'the consumed buffer is intact for the commit'
  );
});

// ---------------------------------------------------------------------------
// Held-bundle lifetime MATRIX (DD5 ruling 4, top-level AC): every drop path — lock
// (chromeIds()/dropAll(), manual AND idle share the one hook), window close (a
// releaseVaultHoldsForWindow call clears via the SAME clear()), tab pagehide (best-effort,
// the page also calls clear()), safety-drop timer expiry, explicit cancel, successful
// commit (take()) — leaves a clean slate each time, and resume-from-pick (hold() again)
// always works afterward. No autolock suppression is EVER acquired for a held bundle —
// structural: this module never imports/touches the suppression holder at all.
// ---------------------------------------------------------------------------

test('module never references an autolock-suppression holder — no held bundle can ever suppress autolock (DD5)', () => {
  const src = require('fs').readFileSync(require.resolve('../../src/main/vault/pending-imports'), 'utf8');
  assert.ok(!/suppress|holder|autolock/i.test(src), 'pending-imports.js is structurally holder-free');
});

test('held-bundle lifetime matrix: lock (dropAll), window-close (clear), pagehide (clear), timer expiry, cancel (clear), and commit (take) each leave a clean slate, and hold() always resumes afterward', () => {
  const rows = [
    ['lock (dropAll)', (store) => store.dropAll()],
    ['window-close (clear, the releaseVaultHoldsForWindow idiom)', (store, chromeId) => store.clear(chromeId)],
    ['pagehide (clear, best-effort page-side)', (store, chromeId) => store.clear(chromeId)],
    ['explicit cancel/dismiss (clear)', (store, chromeId, handle) => store.clear(chromeId, handle)],
    ['successful commit (take)', (store, chromeId) => store.take(chromeId)]
  ];
  for (const [label, drop] of rows) {
    const timers = fakeTimers();
    const { store } = makeStore(timers);
    const chromeId = 100;
    const h = store.hold(chromeId, { bundle: { tag: label } });
    const secret = Buffer.from('correct horse battery staple');
    store.stashSecret(chromeId, { secret, labels: [] }, h);
    assert.equal(timers.scheduledCount(), 1, `${label}: precondition — timer armed`);

    drop(store, chromeId, h);

    assert.equal(store.peek(chromeId), null, `${label}: record gone`);
    assert.equal(timers.scheduledCount(), 0, `${label}: timer canceled`);
    if (label !== 'successful commit (take)') {
      // take() deliberately does NOT zeroize (the commit owns the buffer); every other
      // drop path does.
      assert.ok(
        secret.every((b) => b === 0),
        `${label}: secret zeroized`
      );
    }

    // Resume-from-pick: hold() fully works again after any drop.
    const h2 = store.hold(chromeId, { bundle: { tag: 're-pick' } });
    assert.equal(store.peek(chromeId).bundle.tag, 're-pick', `${label}: resume-from-pick works`);
    store.clear(chromeId, h2); // tidy up between rows.
  }
});

test('held-bundle lifetime matrix: safety-drop timer expiry zeroizes + drops, and resume-from-pick still works', () => {
  const timers = fakeTimers();
  const { store } = makeStore(timers);
  const h = store.hold(100, { bundle: {} });
  const secret = Buffer.from('correct horse battery staple');
  store.stashSecret(100, { secret, labels: [] }, h);
  timers.fire(1); // expiry — the one scheduled timer.

  assert.equal(store.peek(100), null);
  assert.ok(secret.every((b) => b === 0));

  const h2 = store.hold(100, { bundle: { tag: 're-pick-after-expiry' } });
  assert.equal(store.peek(100).bundle.tag, 're-pick-after-expiry', 'resume-from-pick works after expiry too');
  store.clear(100, h2);
});
