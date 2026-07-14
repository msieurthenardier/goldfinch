'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { moveIndex, keyboardMove, dropIndexFromPointer } = require('../../src/shared/tab-order');

// ---------------------------------------------------------------------------
// moveIndex
// ---------------------------------------------------------------------------

test('moveIndex: moves an element forward', () => {
  assert.deepEqual(moveIndex(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
});

test('moveIndex: moves an element backward', () => {
  assert.deepEqual(moveIndex(['a', 'b', 'c', 'd'], 3, 1), ['a', 'd', 'b', 'c']);
});

test('moveIndex: single-tab order is a no-op (nowhere to move)', () => {
  const order = ['only'];
  const result = moveIndex(order, 0, 0);
  assert.equal(result, order); // same reference — no-op signal
});

test('moveIndex: from === to is a no-op (same reference)', () => {
  const order = ['a', 'b', 'c'];
  const result = moveIndex(order, 1, 1);
  assert.equal(result, order);
});

test('moveIndex: out-of-range fromIndex is a no-op', () => {
  const order = ['a', 'b', 'c'];
  assert.equal(moveIndex(order, -1, 1), order);
  assert.equal(moveIndex(order, 3, 1), order);
});

test('moveIndex: out-of-range toIndex is a no-op', () => {
  const order = ['a', 'b', 'c'];
  assert.equal(moveIndex(order, 0, -1), order);
  assert.equal(moveIndex(order, 0, 3), order);
});

test('moveIndex: non-integer indices are a no-op', () => {
  const order = ['a', 'b', 'c'];
  assert.equal(moveIndex(order, 0.5, 1), order);
  assert.equal(moveIndex(order, 0, NaN), order);
});

test('moveIndex: non-array input is returned unchanged', () => {
  const notAnArray = /** @type {any} */ (null);
  assert.equal(moveIndex(notAnArray, 0, 1), notAnArray);
});

test('moveIndex: does not mutate the input array', () => {
  const order = ['a', 'b', 'c'];
  const copy = order.slice();
  moveIndex(order, 0, 2);
  assert.deepEqual(order, copy);
});

// ---------------------------------------------------------------------------
// keyboardMove
// ---------------------------------------------------------------------------

test('keyboardMove: moves one slot right', () => {
  assert.deepEqual(keyboardMove(['a', 'b', 'c'], 'a', 'right'), ['b', 'a', 'c']);
});

test('keyboardMove: moves one slot left', () => {
  assert.deepEqual(keyboardMove(['a', 'b', 'c'], 'c', 'left'), ['a', 'c', 'b']);
});

test('keyboardMove: boundary — rightmost tab moving right no-ops (no wrap)', () => {
  const order = ['a', 'b', 'c'];
  const result = keyboardMove(order, 'c', 'right');
  assert.equal(result, order);
});

test('keyboardMove: boundary — leftmost tab moving left no-ops (no wrap)', () => {
  const order = ['a', 'b', 'c'];
  const result = keyboardMove(order, 'a', 'left');
  assert.equal(result, order);
});

test('keyboardMove: single-tab order no-ops in both directions, no spurious move', () => {
  const order = ['only'];
  assert.equal(keyboardMove(order, 'only', 'left'), order);
  assert.equal(keyboardMove(order, 'only', 'right'), order);
});

test('keyboardMove: unknown id is a no-op (same reference)', () => {
  const order = ['a', 'b', 'c'];
  assert.equal(keyboardMove(order, 'nope', 'right'), order);
});

test('keyboardMove: unrecognized direction is a no-op', () => {
  const order = ['a', 'b', 'c'];
  assert.equal(keyboardMove(order, 'a', /** @type {any} */ ('up')), order);
});

test('keyboardMove: non-array input is returned unchanged', () => {
  const notAnArray = /** @type {any} */ (undefined);
  assert.equal(keyboardMove(notAnArray, 'a', 'right'), notAnArray);
});

// ---------------------------------------------------------------------------
// dropIndexFromPointer
// ---------------------------------------------------------------------------

// Four equal-width (100px) slots at x = [0,100), [100,200), [200,300), [300,400).
// Midpoints at 50, 150, 250, 350.
const FOUR_SLOTS = [
  { left: 0, width: 100 },
  { left: 100, width: 100 },
  { left: 200, width: 100 },
  { left: 300, width: 100 }
];

test('dropIndexFromPointer: pointer in the first slot (before every midpoint) -> 0', () => {
  assert.equal(dropIndexFromPointer(FOUR_SLOTS, 10, 1), 0);
});

test('dropIndexFromPointer: pointer past every midpoint -> end of remaining slots', () => {
  // dragging index 1 away leaves 3 remaining slots; pointer at 390 is past all midpoints.
  assert.equal(dropIndexFromPointer(FOUR_SLOTS, 390, 1), 3);
});

test('dropIndexFromPointer: exactly-at-midpoint ties resolve to "before" (not counted)', () => {
  // Dragging index 0 away; remaining slots are indices 1,2,3 with midpoints 150,250,350.
  // Pointer exactly at 150 must NOT count slot 1's midpoint as passed.
  assert.equal(dropIndexFromPointer(FOUR_SLOTS, 150, 0), 0);
  // One unit past the midpoint DOES count.
  assert.equal(dropIndexFromPointer(FOUR_SLOTS, 151, 0), 1);
});

test('dropIndexFromPointer: excludes the dragged slot from the count', () => {
  // Dragging index 2 (midpoint 250) away. Pointer at 260 is past slot 0 (50) and
  // slot 1 (150) midpoints, and past where slot 2 would have been, but slot 2 is
  // excluded — only slots 0,1,3 remain and 260 is before slot 3's midpoint (350).
  assert.equal(dropIndexFromPointer(FOUR_SLOTS, 260, 2), 2);
});

test('dropIndexFromPointer: dragging the first slot away shifts remaining indices down', () => {
  const twoSlots = [
    { left: 0, width: 100 },
    { left: 100, width: 100 }
  ];
  assert.equal(dropIndexFromPointer(twoSlots, 5, 0), 0);
  assert.equal(dropIndexFromPointer(twoSlots, 195, 0), 1);
});

test('dropIndexFromPointer: empty slotRects is a degenerate no-op -> 0', () => {
  assert.equal(dropIndexFromPointer([], 100, 0), 0);
});

test('dropIndexFromPointer: non-array input is a degenerate no-op -> 0', () => {
  assert.equal(dropIndexFromPointer(/** @type {any} */ (null), 100, 0), 0);
});
