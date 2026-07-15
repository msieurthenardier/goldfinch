'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { tabContextModel } = require('../../src/shared/tab-context-model');

const ids = (model) => model.filter((m) => m.type === 'item').map((m) => m.id);
const seps = (model) => model.filter((m) => m.type === 'separator').length;

// ---------------------------------------------------------------------------
// Full model: multi-tab, tabs to the right, non-empty stack — every item present
// (six since M09 F6: tab:move-new-window joins the duplicate section)
// ---------------------------------------------------------------------------
test('multi-tab + tabs-to-right + non-empty stack: all six items, in order, two separators', () => {
  const model = tabContextModel({ tabId: 't1', isLastTab: false, tabsToRight: 2, stackSize: 3 });
  assert.deepEqual(ids(model), [
    'tab:close', 'tab:close-others', 'tab:close-right', 'tab:duplicate', 'tab:move-new-window', 'tab:reopen-closed'
  ]);
  assert.equal(seps(model), 2);
  // Never a leading or trailing separator.
  assert.notEqual(model[0].type, 'separator');
  assert.notEqual(model[model.length - 1].type, 'separator');
});

// ---------------------------------------------------------------------------
// Only-tab omission: no close-others — and (M09 F6) no move-new-window (a
// sole-tab move is a no-op window swap)
// ---------------------------------------------------------------------------
test('only tab in the strip: tab:close-others AND tab:move-new-window omitted', () => {
  const model = tabContextModel({ tabId: 't1', isLastTab: true, tabsToRight: 0, stackSize: 1 });
  assert.deepEqual(ids(model), ['tab:close', 'tab:duplicate', 'tab:reopen-closed']);
});

// ---------------------------------------------------------------------------
// None-to-right omission: no close-right, even with other tabs present (isLastTab false)
// ---------------------------------------------------------------------------
test('rightmost tab of a multi-tab strip: tab:close-right omitted, tab:close-others kept', () => {
  const model = tabContextModel({ tabId: 't1', isLastTab: false, tabsToRight: 0, stackSize: 0 });
  assert.deepEqual(ids(model), ['tab:close', 'tab:close-others', 'tab:duplicate', 'tab:move-new-window']);
});

// ---------------------------------------------------------------------------
// Empty-stack omission: no reopen-closed
// ---------------------------------------------------------------------------
test('empty closed-tab stack: tab:reopen-closed omitted, no trailing separator', () => {
  const model = tabContextModel({ tabId: 't1', isLastTab: false, tabsToRight: 1, stackSize: 0 });
  assert.deepEqual(ids(model), ['tab:close', 'tab:close-others', 'tab:close-right', 'tab:duplicate', 'tab:move-new-window']);
  assert.notEqual(model[model.length - 1].type, 'separator');
  assert.equal(seps(model), 1); // only the separator before duplicate
});

// ---------------------------------------------------------------------------
// tab:move-new-window (M09 F6 DD5 / review M4): omitted at isLastTab AND for
// internal tabs; present in the duplicate section (no extra separator) for a
// movable web tab; isInternal defaults false (pre-F6 callers unaffected).
// ---------------------------------------------------------------------------
test('internal tab: tab:move-new-window omitted (M4 ruling), everything else per its own rules', () => {
  const model = tabContextModel({ tabId: 't1', isLastTab: false, tabsToRight: 2, stackSize: 3, isInternal: true });
  assert.deepEqual(ids(model), [
    'tab:close', 'tab:close-others', 'tab:close-right', 'tab:duplicate', 'tab:reopen-closed'
  ]);
});

test('internal + only tab: both omission rules compose (no move row, no close-others)', () => {
  const model = tabContextModel({ tabId: 't1', isLastTab: true, tabsToRight: 0, stackSize: 0, isInternal: true });
  assert.deepEqual(ids(model), ['tab:close', 'tab:duplicate']);
});

test('move row shares the duplicate section: separator count unchanged by its presence/absence', () => {
  const withMove = tabContextModel({ tabId: 't1', isLastTab: false, tabsToRight: 1, stackSize: 1, isInternal: false });
  const withoutMove = tabContextModel({ tabId: 't1', isLastTab: false, tabsToRight: 1, stackSize: 1, isInternal: true });
  assert.equal(seps(withMove), 2);
  assert.equal(seps(withoutMove), 2);
  // Adjacency pin (Chrome parity): move-new-window renders directly after duplicate.
  const i = ids(withMove).indexOf('tab:duplicate');
  assert.equal(ids(withMove)[i + 1], 'tab:move-new-window');
});

test('isInternal omitted (pre-F6 caller shape) behaves as false — move row present on a movable tab', () => {
  const model = tabContextModel({ tabId: 't1', isLastTab: false, tabsToRight: 1, stackSize: 0 });
  assert.ok(ids(model).includes('tab:move-new-window'));
});

// ---------------------------------------------------------------------------
// Duplicate is always present — the only item with no omission rule
// ---------------------------------------------------------------------------
test('tab:duplicate is present in every combination, including the minimal (only tab, empty stack)', () => {
  const combos = [
    { isLastTab: true, tabsToRight: 0, stackSize: 0 },
    { isLastTab: true, tabsToRight: 0, stackSize: 5 },
    { isLastTab: false, tabsToRight: 0, stackSize: 0 },
    { isLastTab: false, tabsToRight: 3, stackSize: 0 }
  ];
  for (const c of combos) {
    const model = tabContextModel({ tabId: 't1', ...c });
    assert.ok(ids(model).includes('tab:duplicate'));
  }
});

// ---------------------------------------------------------------------------
// Absolute minimal model: only tab, nothing to the right, empty stack
// ---------------------------------------------------------------------------
test('minimal model (only tab, empty stack): just close + duplicate, one separator between', () => {
  const model = tabContextModel({ tabId: 't1', isLastTab: true, tabsToRight: 0, stackSize: 0 });
  assert.deepEqual(model, [
    { type: 'item', id: 'tab:close', label: 'Close' },
    { type: 'separator' },
    { type: 'item', id: 'tab:duplicate', label: 'Duplicate' }
  ]);
});
