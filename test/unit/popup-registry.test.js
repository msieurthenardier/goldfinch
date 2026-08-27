'use strict';

// M14 F2 L1 — popup registry matrix (DD1a lifecycle, DD1e structural pin,
// DD1f close order, step-3b re-key, tolerated-dead-opener seam).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPopupRegistry } = require('../../src/main/popup-registry');

function fakeWin(log, label) {
  return {
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    destroy() {
      this.destroyed = true;
      log.push(['destroy', label]);
    }
  };
}

function fakeRecord(id) {
  return { win: { id }, tabViews: new Map([[id * 10, { partition: 'persist:jar-a' }]]), activeTabWcId: null };
}

test('register / getByWcId / isPopupWcId / remove lifecycle', () => {
  const reg = createPopupRegistry();
  const record = fakeRecord(1);
  const win = fakeWin([], 'p1');
  assert.equal(reg.getByWcId(7), null);
  assert.equal(reg.isPopupWcId(7), false);

  const entry = reg.register(7, { openerWcId: 10, openerRecord: record, partition: 'persist:jar-a', win });
  assert.deepEqual(entry, { popupWcId: 7, openerWcId: 10, openerRecord: record, partition: 'persist:jar-a', win });
  assert.equal(reg.getByWcId(7), entry);
  assert.equal(reg.isPopupWcId(7), true);
  assert.equal(reg.isPopupWcId(null), false, 'null-tolerant predicate');
  assert.equal(reg.getByWcId(undefined), null, 'undefined-tolerant lookup');

  reg.remove(7);
  assert.equal(reg.getByWcId(7), null);
  assert.equal(reg.isPopupWcId(7), false);
  assert.doesNotThrow(() => reg.remove(7), 'remove is idempotent');
});

test('DD1e pin: registration NEVER touches the owning record — popups are structurally invisible to tabViews-walking persistence', () => {
  const reg = createPopupRegistry();
  const record = fakeRecord(1);
  const keysBefore = Object.keys(record);
  const tabViewsBefore = [...record.tabViews.keys()];

  reg.register(7, { openerWcId: 10, openerRecord: record, partition: 'persist:jar-a', win: fakeWin([], 'p1') });

  // Session snapshot and closed-tab capture both iterate record.tabViews only —
  // a popup that never enters tabViews can never be snapshotted or captured.
  assert.deepEqual([...record.tabViews.keys()], tabViewsBefore, 'tabViews untouched by popup registration');
  assert.deepEqual(Object.keys(record), keysBefore, 'no new fields grafted onto the WindowRecord');
});

test('listForRecord is identity-scoped and registration-ordered; chained popups parent flat to the same record', () => {
  const reg = createPopupRegistry();
  const recordA = fakeRecord(1);
  const recordB = fakeRecord(2);
  const w1 = fakeWin([], 'p1');
  const w2 = fakeWin([], 'p2');
  const w3 = fakeWin([], 'p3');
  reg.register(7, { openerWcId: 10, openerRecord: recordA, partition: 'persist:jar-a', win: w1 });
  // chained: popup 7 opened popup 8 — parents FLAT to recordA (openerWcId is the popup)
  reg.register(8, { openerWcId: 7, openerRecord: recordA, partition: 'persist:jar-a', win: w2 });
  reg.register(9, { openerWcId: 20, openerRecord: recordB, partition: 'persist:jar-b', win: w3 });

  assert.deepEqual(
    reg.listForRecord(recordA).map((e) => e.popupWcId),
    [7, 8]
  );
  assert.deepEqual(
    reg.listForRecord(recordB).map((e) => e.popupWcId),
    [9]
  );
  assert.deepEqual(reg.listForRecord(fakeRecord(3)), [], 'unknown record lists empty');
});

test('opener-tab death seam: the entry survives a dead openerWcId (leg 2 eligibility must not depend on it)', () => {
  const reg = createPopupRegistry();
  const record = fakeRecord(1);
  reg.register(7, { openerWcId: 10, openerRecord: record, partition: 'persist:jar-a', win: fakeWin([], 'p1') });
  // The opener TAB closing runs no registry hook at all — the entry (and its
  // captured partition) stay queryable for census/attribution.
  const entry = reg.getByWcId(7);
  assert.equal(entry.partition, 'persist:jar-a');
  assert.equal(entry.openerRecord, record);
});

test('rekeyForRecord re-keys exactly the moved opener tab popups to the destination record (step 3b)', () => {
  const reg = createPopupRegistry();
  const source = fakeRecord(1);
  const dest = fakeRecord(2);
  reg.register(7, { openerWcId: 10, openerRecord: source, partition: 'persist:jar-a', win: fakeWin([], 'p1') });
  reg.register(8, { openerWcId: 11, openerRecord: source, partition: 'persist:jar-a', win: fakeWin([], 'p2') });

  reg.rekeyForRecord(10, dest);

  assert.equal(reg.getByWcId(7).openerRecord, dest, 'moved tab popup follows the destination');
  assert.equal(reg.getByWcId(8).openerRecord, source, 'other tab popups stay with the source');
  assert.deepEqual(
    reg.listForRecord(dest).map((e) => e.popupWcId),
    [7]
  );
  assert.deepEqual(
    reg.listForRecord(source).map((e) => e.popupWcId),
    [8]
  );
});

test('closeAllForRecord honors the DD1f order: cancel-challenges seam for EVERY popup first, then destroy', () => {
  const log = [];
  const reg = createPopupRegistry({
    // M14 F2 L2: the seam signature is (popupWcId) — the thin cancelForTab
    // delegation shape main.js wires.
    cancelChallengesForPopup: (popupWcId) => log.push(['cancel', popupWcId])
  });
  const record = fakeRecord(1);
  const w1 = fakeWin(log, 7);
  const w2 = fakeWin(log, 8);
  reg.register(7, { openerWcId: 10, openerRecord: record, partition: 'persist:jar-a', win: w1 });
  reg.register(8, { openerWcId: 10, openerRecord: record, partition: 'persist:jar-a', win: w2 });

  reg.closeAllForRecord(record);

  assert.deepEqual(
    log,
    [
      ['cancel', 7],
      ['cancel', 8],
      ['destroy', 7],
      ['destroy', 8]
    ],
    'all cancels precede the first destroy (DD1f order)'
  );
  assert.equal(reg.isPopupWcId(7), false);
  assert.equal(reg.isPopupWcId(8), false);
});

test('closeAllForRecord snapshots before destroying — deregister-during-destroy cannot skip a sibling', () => {
  const log = [];
  const reg = createPopupRegistry();
  const record = fakeRecord(1);
  // Mimic production: each destroy fires teardown hooks that call remove()
  // (the mid-iteration mutation the snapshot exists for).
  const winFor = (popupWcId) => ({
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    destroy() {
      this.destroyed = true;
      log.push(['destroy', popupWcId]);
      reg.remove(popupWcId);
    }
  });
  reg.register(7, { openerWcId: 10, openerRecord: record, partition: 'persist:jar-a', win: winFor(7) });
  reg.register(8, { openerWcId: 10, openerRecord: record, partition: 'persist:jar-a', win: winFor(8) });

  reg.closeAllForRecord(record);

  assert.deepEqual(
    log.filter((e) => e[0] === 'destroy').map((e) => e[1]),
    [7, 8],
    'both popups destroyed'
  );
  assert.deepEqual(reg.listForRecord(record), []);
});

test('closeAllForRecord tolerates an already-destroyed window and still drops its entry; other records are untouched', () => {
  const log = [];
  const reg = createPopupRegistry();
  const recordA = fakeRecord(1);
  const recordB = fakeRecord(2);
  const dead = fakeWin(log, 7);
  dead.destroyed = true;
  reg.register(7, { openerWcId: 10, openerRecord: recordA, partition: 'persist:jar-a', win: dead });
  reg.register(9, { openerWcId: 20, openerRecord: recordB, partition: 'persist:jar-b', win: fakeWin(log, 9) });

  assert.doesNotThrow(() => reg.closeAllForRecord(recordA));
  assert.deepEqual(log, [], 'no destroy call on an already-destroyed window');
  assert.equal(reg.isPopupWcId(7), false, 'the zombie entry is still dropped');
  assert.equal(reg.isPopupWcId(9), true, 'the other record popup is untouched');
});

test('closeAllForRecord isolates a throwing cancel seam and a throwing destroy (log-and-continue)', () => {
  const errors = [];
  const log = [];
  const reg = createPopupRegistry({
    cancelChallengesForPopup: (popupWcId) => {
      if (popupWcId === 7) throw new Error('seam boom');
      log.push(['cancel', popupWcId]);
    },
    logger: { error: (...args) => errors.push(args.join(' ')) }
  });
  const record = fakeRecord(1);
  const bad = {
    destroyed: false,
    isDestroyed() {
      return false;
    },
    destroy() {
      throw new Error('destroy boom');
    }
  };
  reg.register(7, { openerWcId: 10, openerRecord: record, partition: 'persist:jar-a', win: bad });
  reg.register(8, { openerWcId: 10, openerRecord: record, partition: 'persist:jar-a', win: fakeWin(log, 8) });

  assert.doesNotThrow(() => reg.closeAllForRecord(record));
  assert.deepEqual(
    log,
    [
      ['cancel', 8],
      ['destroy', 8]
    ],
    'the healthy sibling still cancels and destroys'
  );
  assert.equal(errors.length, 2, 'both failures logged');
  assert.equal(reg.listForRecord(record).length, 0, 'entries dropped even on destroy failure');
});
