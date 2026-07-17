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

// ---------------------------------------------------------------------------
// tab:move-window:<windowId> (M09 F8 DD8) — one FLAT item per OTHER window.
//
// AC1's two readings live here and in move-targets.test.js's builder half. This
// side proves the MODEL's count is driven by the target list it is handed rather
// than fixed: a model that ignored moveTargets would emit the same items either
// way, which is discrimination zero.
// ---------------------------------------------------------------------------
const win = (windowId, label) => ({ windowId, label });

test('AC1 — one window (no other windows): ZERO move-to-window items', () => {
  const model = tabContextModel({ tabId: 't1', isLastTab: false, tabsToRight: 0, stackSize: 0, moveTargets: [] });
  assert.deepEqual(ids(model).filter((i) => i.startsWith('tab:move-window:')), []);
  // The new-window move is unaffected — it needs no second window.
  assert.ok(ids(model).includes('tab:move-new-window'));
});

test('AC1 — three windows (two others): TWO move-to-window items, captioned from their active tabs', () => {
  const model = tabContextModel({
    tabId: 't1', isLastTab: false, tabsToRight: 0, stackSize: 0,
    moveTargets: [win(7, 'GitHub'), win(9, 'Wikipedia')]
  });
  assert.deepEqual(ids(model).filter((i) => i.startsWith('tab:move-window:')), [
    'tab:move-window:7', 'tab:move-window:9'
  ]);
  const items = model.filter((m) => m.type === 'item');
  assert.equal(items.find((i) => i.id === 'tab:move-window:7').label, 'Move to window "GitHub"');
  assert.equal(items.find((i) => i.id === 'tab:move-window:9').label, 'Move to window "Wikipedia"');
});

test('AC3 — the item is keyed by windowId, NOT by its position in the list', () => {
  // The reversed ordinal scheme would have emitted tab:move-window:0 / :1 here.
  // Same two windows, opposite ORDER: each item keeps its own id, so nothing
  // downstream can resolve a target by position.
  const forward = tabContextModel({
    tabId: 't1', isLastTab: false, tabsToRight: 0, stackSize: 0,
    moveTargets: [win(7, 'A'), win(9, 'B')]
  });
  const reversed = tabContextModel({
    tabId: 't1', isLastTab: false, tabsToRight: 0, stackSize: 0,
    moveTargets: [win(9, 'B'), win(7, 'A')]
  });
  assert.deepEqual(ids(forward).filter((i) => i.startsWith('tab:move-window:')), ['tab:move-window:7', 'tab:move-window:9']);
  assert.deepEqual(ids(reversed).filter((i) => i.startsWith('tab:move-window:')), ['tab:move-window:9', 'tab:move-window:7']);
  // The SET of destinations is order-invariant — only the render order moved.
  assert.deepEqual(
    ids(forward).filter((i) => i.startsWith('tab:move-window:')).sort(),
    ids(reversed).filter((i) => i.startsWith('tab:move-window:')).sort()
  );
});

test('AC1 (M09 F10 L3) — a SOLE tab offers move-to-window (existing windows) but NOT move-new-window', () => {
  const targets = [win(7, 'GitHub'), win(9, 'Wikipedia')];
  // Sole tab + other windows: move-window:* now PRESENT (a sole tab may
  // consolidate into an existing window; main's core passes allowSoleTab on the
  // tab-move-to-window path and closes the emptied source). move-new-window
  // stays OMITTED (a sole-tab move to a NEW window is still a no-op swap).
  const sole = tabContextModel({ tabId: 't1', isLastTab: true, tabsToRight: 0, stackSize: 0, moveTargets: targets });
  assert.deepEqual(ids(sole).filter((i) => i.startsWith('tab:move-window:')), [
    'tab:move-window:7', 'tab:move-window:9'
  ]);
  assert.ok(!ids(sole).includes('tab:move-new-window'));
});

test('AC1 (M09 F10 L3) — a SOLE tab with NO other window offers no move items at all', () => {
  // No target to consolidate into: move-window:* empty, move-new-window omitted.
  const sole = tabContextModel({ tabId: 't1', isLastTab: true, tabsToRight: 0, stackSize: 0, moveTargets: [] });
  assert.deepEqual(ids(sole).filter((i) => i.startsWith('tab:move-window:')), []);
  assert.ok(!ids(sole).includes('tab:move-new-window'));
});

test('AC1 — move items are omitted for an INTERNAL tab regardless of window count', () => {
  const targets = [win(7, 'GitHub'), win(9, 'Wikipedia')];
  // Internal tab: main's core refuses `internal`. Both move families omitted.
  const internal = tabContextModel({
    tabId: 't1', isLastTab: false, tabsToRight: 0, stackSize: 0, isInternal: true, moveTargets: targets
  });
  assert.deepEqual(ids(internal).filter((i) => i.startsWith('tab:move-window:')), []);
  assert.ok(!ids(internal).includes('tab:move-new-window'));
});

test('the move items are flat items in the duplicate section — no submenu, no note, no header', () => {
  const model = tabContextModel({
    tabId: 't1', isLastTab: false, tabsToRight: 0, stackSize: 0,
    moveTargets: [win(7, 'GitHub')]
  });
  // Every entry is still one of the two types the sheet's renderMenu knows (DD8:
  // no submenu capability is assumed of it).
  for (const m of model) assert.ok(m.type === 'item' || m.type === 'separator', `unexpected type ${m.type}`);
  // Adjacency: the window moves render directly after tab:move-new-window.
  const i = ids(model).indexOf('tab:move-new-window');
  assert.equal(ids(model)[i + 1], 'tab:move-window:7');
});

test('absent moveTargets defaults to none — every pre-F8 caller is unaffected', () => {
  const model = tabContextModel({ tabId: 't1', isLastTab: false, tabsToRight: 2, stackSize: 3 });
  assert.deepEqual(ids(model), [
    'tab:close', 'tab:close-others', 'tab:close-right', 'tab:duplicate', 'tab:move-new-window', 'tab:reopen-closed'
  ]);
});
