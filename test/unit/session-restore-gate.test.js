'use strict';

// Unit tests for isRestorePending (src/main/session-snapshot-scheduler.js, squawk 0073
// hazard #4): the boot-restore gate that stops a debounced continuous-snapshot write from
// overwriting the good on-disk snapshot with a PARTIAL one while a restored window is
// still receiving its saved tabs one tab-create at a time.
//
// Pure function, unit-tested with fake records — no Electron, no registry, no clock.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isRestorePending } = require('../../src/main/session-snapshot-scheduler');

function tabViews(size) {
  return { size };
}

test('a record with fewer live tabViews than its restoreTabs length BLOCKS', () => {
  const records = [{ restoreTabs: [{ url: 'a' }, { url: 'b' }, { url: 'c' }], tabViews: tabViews(1) }];
  assert.equal(isRestorePending(records, 1000), true, 'still short of the saved tab count — pending');
});

test('once the live tabViews count reaches the restore length, the gate RELEASES', () => {
  const records = [{ restoreTabs: [{ url: 'a' }, { url: 'b' }], tabViews: tabViews(2) }];
  assert.equal(isRestorePending(records, 1000), false, 'count reached — no longer pending');

  // More tabs than the saved count (the operator opened extra tabs since boot) also
  // releases — the check is >=, not ===.
  const grown = [{ restoreTabs: [{ url: 'a' }, { url: 'b' }], tabViews: tabViews(5) }];
  assert.equal(isRestorePending(grown, 1000), false);
});

test('a record with NO restoreTabs never blocks (fresh window, noBootTab window, or an empty saved window)', () => {
  assert.equal(isRestorePending([{ tabViews: tabViews(0) }], 1000), false, 'no restoreTabs field at all');
  assert.equal(isRestorePending([{ restoreTabs: null, tabViews: tabViews(0) }], 1000), false, 'explicit null');
  assert.equal(
    isRestorePending([{ restoreTabs: [], tabViews: tabViews(0) }], 1000),
    false,
    'an empty restoreTabs array (nothing to restore) never blocks'
  );
});

test('the settle timeout releases the gate for a saved URL that never arrives (rejected at tab-create)', () => {
  const settleMs = 30000;
  const records = [{ restoreTabs: [{ url: 'a' }, { url: 'b' }], tabViews: tabViews(1), bootConfigServedAt: 1000 }];
  // Just short of settle: still pending.
  assert.equal(isRestorePending(records, 1000 + settleMs - 1, settleMs), true, 'not settled yet — still pending');
  // At/after settle: released, even though the count never caught up.
  assert.equal(isRestorePending(records, 1000 + settleMs, settleMs), false, 'settled — released regardless');
  assert.equal(isRestorePending(records, 1000 + settleMs + 5000, settleMs), false, 'well past settle — released');
});

test('no bootConfigServedAt yet (boot config not served) never settles — stays pending until served', () => {
  const records = [{ restoreTabs: [{ url: 'a' }], tabViews: tabViews(0) }];
  assert.equal(isRestorePending(records, 10_000_000), true, 'no servedAt timestamp — the settle check cannot fire');
});

test('ANY pending record gates the whole result — a debounced write touches every window at once', () => {
  const records = [
    { restoreTabs: [{ url: 'a' }], tabViews: tabViews(1) }, // this one is done
    { restoreTabs: [{ url: 'a' }, { url: 'b' }], tabViews: tabViews(0) } // this one is not
  ];
  assert.equal(isRestorePending(records, 1000), true, 'one still-restoring window gates the whole snapshot');
});

test('an empty or missing records list is never pending', () => {
  assert.equal(isRestorePending([], 1000), false);
  assert.equal(isRestorePending(undefined, 1000), false);
  assert.equal(isRestorePending(null, 1000), false);
});
