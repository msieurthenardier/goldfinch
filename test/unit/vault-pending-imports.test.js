'use strict';

// Unit tests for the per-owning-window held-import store (PR#112 finding 5). The portable-vault
// IMPORT flow held its picked bundle + destination in ONE process-global record, so a second
// window could overwrite the first and the first window's Continue / secret-submit / overwrite /
// cancel then acted on the WRONG window's import. This store keys every record by the owning-chrome
// id + an opaque per-transaction handle, so windows are fully isolated.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createPendingImportStore } = require('../../src/main/vault/pending-imports');

// Deterministic handle generator for assertions.
function seqHandles() {
  let n = 0;
  return () => `h${++n}`;
}

test('two windows hold INDEPENDENT records — neither can see/consume the other (finding 5)', () => {
  const store = createPendingImportStore(seqHandles());
  const A = 100; // window A's owning-chrome id
  const B = 200; // window B's

  const hA = store.hold(A, { bundle: { tag: 'A' }, destinationTarget: 'work' });
  const hB = store.hold(B, { bundle: { tag: 'B' }, destinationTarget: 'personal' });
  assert.notEqual(hA, hB, 'distinct handles per transaction');

  // Each window sees ONLY its own record.
  assert.equal(store.peek(A).bundle.tag, 'A');
  assert.equal(store.peek(A).destinationTarget, 'work');
  assert.equal(store.peek(B).bundle.tag, 'B');
  assert.equal(store.peek(B).destinationTarget, 'personal');

  // Consuming A's record leaves B's untouched (the cross-window confusion is gone).
  const takenA = store.take(A);
  assert.equal(takenA.bundle.tag, 'A');
  assert.equal(store.peek(A), null, 'A is consumed');
  assert.equal(store.peek(B).bundle.tag, 'B', 'B is unaffected by A being consumed');
});

test('a second window re-holding does NOT overwrite the first window\'s record', () => {
  const store = createPendingImportStore(seqHandles());
  store.hold(100, { bundle: { tag: 'A' }, destinationTarget: 'work' });
  store.hold(200, { bundle: { tag: 'B-overwrite-attempt' }, destinationTarget: 'global' });
  // Window A's record is exactly as it was — window B cannot clobber it (the demonstrated exploit).
  assert.equal(store.peek(100).bundle.tag, 'A');
  assert.equal(store.peek(100).destinationTarget, 'work');
});

test('setOverwrite is window-scoped: window B cannot flip window A\'s destructive overwrite flag', () => {
  const store = createPendingImportStore(seqHandles());
  const hA = store.hold(100, { bundle: { tag: 'A' }, destinationTarget: 'work' });
  store.hold(200, { bundle: { tag: 'B' }, destinationTarget: 'personal' });

  // A window operating on B's key can never touch A's record.
  store.setOverwrite(200, true, /* B's own handle irrelevant here */ undefined);
  assert.equal(store.peek(100).overwrite, false, 'A\'s overwrite is untouched by a B-keyed call');

  // A's own window can set its overwrite with its matching handle.
  store.setOverwrite(100, true, hA);
  assert.equal(store.peek(100).overwrite, true);
});

test('the opaque handle guards a stale same-window transaction', () => {
  const store = createPendingImportStore(seqHandles());
  const h1 = store.hold(100, { bundle: { tag: 'first' }, destinationTarget: 'work' });
  // A re-pick in the SAME window mints a fresh handle and replaces the record.
  const h2 = store.hold(100, { bundle: { tag: 'second' }, destinationTarget: 'global' });
  assert.notEqual(h1, h2);

  // A late step carrying the STALE handle (h1) is ignored — it cannot mutate/clear the live record.
  store.setOverwrite(100, true, h1);
  assert.equal(store.peek(100).overwrite, false, 'a stale handle cannot bind overwrite');
  store.clear(100, h1);
  assert.equal(store.peek(100).bundle.tag, 'second', 'a stale handle cannot clear the live record');

  // The CURRENT handle works.
  store.setOverwrite(100, true, h2);
  assert.equal(store.peek(100).overwrite, true);
  store.clear(100, h2);
  assert.equal(store.peek(100), null, 'the matching handle clears it');
});

test('clear/setOverwrite/take are safe no-ops on an unheld window', () => {
  const store = createPendingImportStore(seqHandles());
  assert.equal(store.take(999), null);
  assert.doesNotThrow(() => store.clear(999, 'whatever'));
  assert.doesNotThrow(() => store.setOverwrite(999, true, 'whatever'));
  assert.equal(store.peek(999), null);
});

test('a handle-less mutating call still works (window key is the primary isolation)', () => {
  // The registrar tolerates a legacy page that omits the handle; window keying alone still isolates.
  const store = createPendingImportStore(seqHandles());
  store.hold(100, { bundle: { tag: 'A' }, destinationTarget: 'work' });
  store.setOverwrite(100, true); // no handle
  assert.equal(store.peek(100).overwrite, true);
  store.clear(100); // no handle
  assert.equal(store.peek(100), null);
});
