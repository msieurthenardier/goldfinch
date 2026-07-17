'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { tabContextModel } = require('../../src/shared/tab-context-model');

const ids = (model) => model.filter((m) => m.type === 'item').map((m) => m.id);
const seps = (model) => model.filter((m) => m.type === 'separator').length;

// ---------------------------------------------------------------------------
// Full model: multi-tab, tabs to the right, non-empty stack — every item present
// ---------------------------------------------------------------------------
test('multi-tab + tabs-to-right + non-empty stack: all five items, in order, two separators', () => {
  const model = tabContextModel({ tabId: 't1', isLastTab: false, tabsToRight: 2, stackSize: 3 });
  assert.deepEqual(ids(model), [
    'tab:close', 'tab:close-others', 'tab:close-right', 'tab:duplicate', 'tab:reopen-closed'
  ]);
  assert.equal(seps(model), 2);
  // Never a leading or trailing separator.
  assert.notEqual(model[0].type, 'separator');
  assert.notEqual(model[model.length - 1].type, 'separator');
});

// ---------------------------------------------------------------------------
// Only-tab omission: no close-others (regardless of tabsToRight, which is 0 here too)
// ---------------------------------------------------------------------------
test('only tab in the strip: tab:close-others omitted', () => {
  const model = tabContextModel({ tabId: 't1', isLastTab: true, tabsToRight: 0, stackSize: 1 });
  assert.deepEqual(ids(model), ['tab:close', 'tab:duplicate', 'tab:reopen-closed']);
});

// ---------------------------------------------------------------------------
// None-to-right omission: no close-right, even with other tabs present (isLastTab false)
// ---------------------------------------------------------------------------
test('rightmost tab of a multi-tab strip: tab:close-right omitted, tab:close-others kept', () => {
  const model = tabContextModel({ tabId: 't1', isLastTab: false, tabsToRight: 0, stackSize: 0 });
  assert.deepEqual(ids(model), ['tab:close', 'tab:close-others', 'tab:duplicate']);
});

// ---------------------------------------------------------------------------
// Empty-stack omission: no reopen-closed
// ---------------------------------------------------------------------------
test('empty closed-tab stack: tab:reopen-closed omitted, no trailing separator', () => {
  const model = tabContextModel({ tabId: 't1', isLastTab: false, tabsToRight: 1, stackSize: 0 });
  assert.deepEqual(ids(model), ['tab:close', 'tab:close-others', 'tab:close-right', 'tab:duplicate']);
  assert.notEqual(model[model.length - 1].type, 'separator');
  assert.equal(seps(model), 1); // only the separator before duplicate
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
