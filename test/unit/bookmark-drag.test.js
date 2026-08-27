'use strict';

// Unit tests for src/shared/bookmark-drag.js (M15 Flight 3 "Drag Interactions"
// Leg 3, AC2) — the pure bar-drag decision model: hidden-filtered slot
// assembly, drop classification, and the insertion-indicator geometry. Pure,
// offline, no DOM. Real ESM (Node >=22 synchronous require(esm)).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  BOOKMARK_DND_MIME,
  visibleSlotRects,
  classifyBookmarkDrop,
  isInsideBar,
  indicatorX,
  overflowDropIndexY,
  overflowIndicatorY,
  overflowDropToIndex,
  barDropToIndex,
  isOverChevron
} = require('../../src/shared/bookmark-drag.js');
const { dropIndexFromPointer, moveIndex } = require('../../src/shared/tab-order.js');

const BAR = { left: 0, top: 100, right: 400, bottom: 130 };

/** Build the `{rect, hidden}` input shape bookmarks-bar.js produces. */
function slot(left, width, hidden = false) {
  return { rect: { left, width }, hidden };
}

// ---------------------------------------------------------------------------
// DD2: the MIME literal is single-sourced here.
// ---------------------------------------------------------------------------

test('BOOKMARK_DND_MIME is the DD2 custom type, single-sourced', () => {
  assert.equal(BOOKMARK_DND_MIME, 'application/x-goldfinch-bookmark');
});

// ---------------------------------------------------------------------------
// visibleSlotRects — the function DD3's correction exists for.
// ---------------------------------------------------------------------------

test('visibleSlotRects — passes visible slots through in order, {left,width} only', () => {
  assert.deepEqual(visibleSlotRects([slot(0, 100), slot(100, 60), slot(160, 40)]), [
    { left: 0, width: 100 },
    { left: 100, width: 60 },
    { left: 160, width: 40 }
  ]);
});

test('visibleSlotRects — the display:none overflow TAIL is filtered out', () => {
  // Hidden items report a zero-width rect AT LEFT 0 (that is what display:none
  // does to getBoundingClientRect), which is precisely why they must not reach
  // dropIndexFromPointer.
  const assembled = visibleSlotRects([slot(0, 100), slot(100, 100), slot(0, 0, true), slot(0, 0, true)]);
  assert.deepEqual(assembled, [
    { left: 0, width: 100 },
    { left: 100, width: 100 }
  ]);
});

test('visibleSlotRects — DISCRIMINATING case: visible items on BOTH sides of the pointer AND hidden items', () => {
  // Four visible items across 0..400, then two overflowed ones at left 0.
  const items = [slot(0, 100), slot(100, 100), slot(200, 100), slot(300, 100), slot(0, 0, true), slot(0, 0, true)];
  const filtered = visibleSlotRects(items);
  const raw = items.map((i) => i.rect); // what a careless implementation would pass

  // Pointer at 250: past the midpoints of slots 0 (50) and 1 (150) only —
  // slot 2 is the dragged one, slot 3's midpoint (350) is ahead.
  const pointerX = 250;
  const draggedIndex = 2;
  assert.equal(dropIndexFromPointer(filtered, pointerX, draggedIndex), 2);
  // The raw array inflates the answer by EXACTLY the overflow count (2): both
  // hidden midpoints are 0, and 0 < 250.
  assert.equal(dropIndexFromPointer(raw, pointerX, draggedIndex), 4);
  assert.equal(
    dropIndexFromPointer(raw, pointerX, draggedIndex) - dropIndexFromPointer(filtered, pointerX, draggedIndex),
    2,
    'the inflation is exactly the number of hidden items — the defect this filtering exists to prevent'
  );
});

test('visibleSlotRects — because the hide is a strict tail, the returned index IS the full-list index', () => {
  // Full list of 5, last 2 overflowed. Every visible item keeps its full-list
  // index in the assembled array — there is no translation to write.
  const items = [slot(0, 80), slot(80, 80), slot(160, 80), slot(0, 0, true), slot(0, 0, true)];
  const assembled = visibleSlotRects(items);
  assert.equal(assembled.length, 3);
  assembled.forEach((rect, i) => {
    assert.deepEqual(
      rect,
      { left: items[i].rect.left, width: items[i].rect.width },
      `assembled[${i}] must describe full-list item ${i}`
    );
  });
});

test('visibleSlotRects — degenerate input resolves to the NON-DESTRUCTIVE outcome (empty)', () => {
  assert.deepEqual(visibleSlotRects(/** @type {any} */ (null)), []);
  assert.deepEqual(visibleSlotRects(/** @type {any} */ ('nope')), []);
  assert.deepEqual(visibleSlotRects([]), []);
  // A VISIBLE item with an unreadable rect poisons the WHOLE array rather than
  // being skipped: skipping it would shift every later index by one and commit
  // a wrong move.
  assert.deepEqual(visibleSlotRects([slot(0, 100), { rect: null, hidden: false }, slot(200, 100)]), []);
  assert.deepEqual(visibleSlotRects([slot(0, 100), { rect: { left: NaN, width: 100 }, hidden: false }]), []);
  assert.deepEqual(visibleSlotRects([slot(0, 100), { rect: { left: 0, width: Infinity }, hidden: false }]), []);
  assert.deepEqual(visibleSlotRects([slot(0, 100), /** @type {any} */ (null)]), []);
});

test('visibleSlotRects — an unreadable HIDDEN item is harmless (never measured)', () => {
  assert.deepEqual(visibleSlotRects([slot(0, 100), { rect: null, hidden: true }]), [{ left: 0, width: 100 }]);
});

// ---------------------------------------------------------------------------
// classifyBookmarkDrop
// ---------------------------------------------------------------------------

test('classifyBookmarkDrop — inside the bar reorders, index is EXACTLY dropIndexFromPointer', () => {
  const slots = [
    { left: 0, width: 100 },
    { left: 100, width: 100 },
    { left: 200, width: 100 }
  ];
  for (const x of [10, 60, 150, 250, 299]) {
    assert.deepEqual(
      classifyBookmarkDrop(BAR, slots, x, 115, 0),
      { zone: 'reorder', index: dropIndexFromPointer(slots, x, 0) },
      `x=${x}: the module adds the y-test and nothing else`
    );
  }
});

test('classifyBookmarkDrop — outside the bar on ANY edge is `outside`, no index', () => {
  const slots = [
    { left: 0, width: 100 },
    { left: 100, width: 100 }
  ];
  assert.deepEqual(classifyBookmarkDrop(BAR, slots, -1, 115, 0), { zone: 'outside' }); // left
  assert.deepEqual(classifyBookmarkDrop(BAR, slots, 401, 115, 0), { zone: 'outside' }); // right
  assert.deepEqual(classifyBookmarkDrop(BAR, slots, 50, 99, 0), { zone: 'outside' }); // above
  assert.deepEqual(classifyBookmarkDrop(BAR, slots, 50, 131, 0), { zone: 'outside' }); // below (the page)
});

test('classifyBookmarkDrop — all four edges are INCLUSIVE (a pointer on the boundary still reorders)', () => {
  const slots = [{ left: 0, width: 100 }];
  for (const [x, y] of [
    [0, 100],
    [400, 130],
    [0, 130],
    [400, 100]
  ]) {
    assert.equal(classifyBookmarkDrop(BAR, slots, x, y, 0).zone, 'reorder', `(${x},${y}) is on the boundary`);
  }
});

test('classifyBookmarkDrop — degenerate inputs resolve to the NON-DESTRUCTIVE outcome (no reorder)', () => {
  const slots = [{ left: 0, width: 100 }];
  // Unreadable bar rect — the POLARITY IS INVERTED from tab-drag-zone.js, and
  // deliberately so: there tearOff is the destructive branch, here the reorder
  // IS the write.
  assert.deepEqual(classifyBookmarkDrop(/** @type {any} */ (null), slots, 50, 115, 0), { zone: 'outside' });
  assert.deepEqual(classifyBookmarkDrop(/** @type {any} */ ('bar'), slots, 50, 115, 0), { zone: 'outside' });
  assert.deepEqual(classifyBookmarkDrop({ ...BAR, right: NaN }, slots, 50, 115, 0), { zone: 'outside' });
  assert.deepEqual(classifyBookmarkDrop(BAR, slots, NaN, 115, 0), { zone: 'outside' });
  assert.deepEqual(classifyBookmarkDrop(BAR, slots, 50, Infinity, 0), { zone: 'outside' });
  // Empty / unusable slot array — including the poisoned-array output of
  // visibleSlotRects above.
  assert.deepEqual(classifyBookmarkDrop(BAR, [], 50, 115, 0), { zone: 'outside' });
  assert.deepEqual(classifyBookmarkDrop(BAR, /** @type {any} */ (null), 50, 115, 0), { zone: 'outside' });
});

test('classifyBookmarkDrop — single bookmark: a drag is a no-op, not an error (Edge Case)', () => {
  const zone = classifyBookmarkDrop(BAR, [{ left: 0, width: 100 }], 50, 115, 0);
  assert.deepEqual(zone, { zone: 'reorder', index: 0 });
  // …and composing forward, the commit no-ops on the same-reference return.
  const order = ['only'];
  assert.equal(moveIndex(order, 0, zone.index === undefined ? 0 : zone.index), order);
});

test('isInsideBar — exported predicate is the positive phrasing (unreadable -> false)', () => {
  assert.equal(isInsideBar(BAR, 50, 115), true);
  assert.equal(isInsideBar(BAR, 500, 115), false);
  assert.equal(isInsideBar(/** @type {any} */ (undefined), 50, 115), false);
  assert.equal(isInsideBar({ ...BAR, left: undefined }, 50, 115), false);
});

// ---------------------------------------------------------------------------
// The composed pair (design-review finding: moveIndex is imported, not
// hand-rolled, and it composes EXACTLY with dropIndexFromPointer).
// ---------------------------------------------------------------------------

test('classifyBookmarkDrop + moveIndex compose exactly — forward move is not off-by-one', () => {
  const slots = [
    { left: 0, width: 100 },
    { left: 100, width: 100 },
    { left: 200, width: 100 }
  ];
  const order = ['a', 'b', 'c'];
  // Drag 'a' (index 0) to past 'c''s midpoint (250 > 250 is false; use 260).
  const zone = classifyBookmarkDrop(BAR, slots, 260, 115, 0);
  assert.deepEqual(zone, { zone: 'reorder', index: 2 });
  assert.deepEqual(moveIndex(order, 0, 2), ['b', 'c', 'a'], 'a hand-rolled splice pair lands this one slot short');
});

test('classifyBookmarkDrop + moveIndex compose exactly — backward move', () => {
  const slots = [
    { left: 0, width: 100 },
    { left: 100, width: 100 },
    { left: 200, width: 100 }
  ];
  const order = ['a', 'b', 'c'];
  const zone = classifyBookmarkDrop(BAR, slots, 110, 115, 2); // drag 'c' back over 'b'
  assert.deepEqual(zone, { zone: 'reorder', index: 1 });
  assert.deepEqual(moveIndex(order, 2, 1), ['a', 'c', 'b']);
});

test('moveIndex returns the SAME REFERENCE for a drop back into the original position (AC4)', () => {
  const slots = [
    { left: 0, width: 100 },
    { left: 100, width: 100 },
    { left: 200, width: 100 }
  ];
  const order = ['a', 'b', 'c'];
  const zone = classifyBookmarkDrop(BAR, slots, 60, 115, 0); // still in slot 0's half
  assert.deepEqual(zone, { zone: 'reorder', index: 0 });
  assert.equal(moveIndex(order, 0, 0), order, 'reference equality is the "nothing changed" signal the commit skips on');
});

test('moveIndex no-ops when the dragged id vanished mid-drag (Edge Case)', () => {
  const order = ['a', 'b', 'c'];
  assert.equal(moveIndex(order, order.indexOf('gone'), 1), order, 'indexOf -> -1 -> same reference -> no commit');
});

// ---------------------------------------------------------------------------
// indicatorX
// ---------------------------------------------------------------------------

test('indicatorX — points at the left edge of the slot that would FOLLOW the drop', () => {
  const slots = [
    { left: 0, width: 100 },
    { left: 100, width: 100 },
    { left: 200, width: 100 }
  ];
  // Dragging slot 0: remaining run is [slot1, slot2].
  assert.equal(indicatorX(slots, 0, 0), 100); // before slot1
  assert.equal(indicatorX(slots, 1, 0), 200); // between slot1 and slot2
  assert.equal(indicatorX(slots, 2, 0), 300); // past the end -> right edge of slot2
});

test('indicatorX — the dragged slot is excluded from the remaining run', () => {
  const slots = [
    { left: 0, width: 100 },
    { left: 100, width: 100 },
    { left: 200, width: 100 }
  ];
  // Dragging slot 1: remaining run is [slot0, slot2].
  assert.equal(indicatorX(slots, 0, 1), 0);
  assert.equal(indicatorX(slots, 1, 1), 200);
  assert.equal(indicatorX(slots, 2, 1), 300);
});

test('indicatorX — an external drag source (draggedIndex -1) leaves every slot in the run', () => {
  const slots = [
    { left: 0, width: 100 },
    { left: 100, width: 100 }
  ];
  assert.equal(indicatorX(slots, 0, -1), 0);
  assert.equal(indicatorX(slots, 2, -1), 200);
});

test('indicatorX — degenerate inputs return null so the caller HIDES rather than parking at 0', () => {
  assert.equal(indicatorX([], 0, 0), null);
  assert.equal(indicatorX(/** @type {any} */ (null), 0, 0), null);
  assert.equal(indicatorX([{ left: 0, width: 10 }], 0, 0), null, 'the only slot is the dragged one — nothing remains');
  assert.equal(
    indicatorX(
      [
        { left: 0, width: 10 },
        { left: 10, width: 10 }
      ],
      -1,
      0
    ),
    null
  );
  assert.equal(
    indicatorX(
      [
        { left: 0, width: 10 },
        { left: 10, width: 10 }
      ],
      1.5,
      0
    ),
    null
  );
});

// ---------------------------------------------------------------------------
// Purity (the tab-drag-zone.js discipline this module copies).
// ---------------------------------------------------------------------------

test('the module is pure — no DOM and no Electron reachable from its CODE', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { maskComments } = require('../helpers/source-scan.js');
  const src = fs.readFileSync(path.join(__dirname, '../../src/shared/bookmark-drag.js'), 'utf8');
  // Comments are masked: the header documents the DOM facts this module exists
  // to keep OUT of itself, so a raw substring scan would flag its own prose.
  const code = maskComments(src);
  for (const forbidden of ['require(', 'document.', 'window.', 'getBoundingClientRect', 'electron']) {
    assert.equal(code.includes(forbidden), false, `bookmark-drag.js must stay pure — found "${forbidden}" in code`);
  }
  assert.match(
    src,
    /^import \{ dropIndexFromPointer \} from '\.\/tab-order\.js';$/m,
    'the midpoint rule is IMPORTED unchanged, never re-implemented here'
  );
  assert.equal(
    /function dropIndexFromPointer|left \+ width \/ 2/.test(code),
    false,
    'the midpoint rule must not be re-derived here — it is imported'
  );
});

// ---------------------------------------------------------------------------
// M15 F3 Leg 5a — the overflow sheet's Y-AXIS siblings and the RULED index rule.
// ---------------------------------------------------------------------------

/** Four 24px rows starting at viewport y 200 — midpoints 212/236/260/284. */
const ROWS = [0, 1, 2, 3].map((i) => ({ top: 200 + i * 24, height: 24 }));

test('Leg 5a overflowDropIndexY — the midpoint rule, on the y axis', () => {
  assert.equal(overflowDropIndexY(ROWS, 199), 0, 'above everything');
  assert.equal(overflowDropIndexY(ROWS, 205), 0, 'in row 0, above its midpoint');
  assert.equal(overflowDropIndexY(ROWS, 212), 0, 'EXACTLY on a midpoint does not count — ties resolve "before"');
  assert.equal(overflowDropIndexY(ROWS, 213), 1);
  assert.equal(overflowDropIndexY(ROWS, 237), 2);
  assert.equal(overflowDropIndexY(ROWS, 261), 3);
  assert.equal(overflowDropIndexY(ROWS, 285), 4, 'past the last row — the PAST-THE-END answer the clamp consumes');
  assert.equal(overflowDropIndexY(ROWS, 9999), 4, "a release on the menu's bottom padding resolves to end-of-list");
});

test('Leg 5a overflowDropIndexY — it DELEGATES to dropIndexFromPointer, external-source form', () => {
  // Same numbers, run through the x-axis original with the axes swapped and
  // draggedIndex = -1. If someone re-derives the rule here, this diverges.
  const axis = ROWS.map((r) => ({ left: r.top, width: r.height }));
  for (const y of [199, 205, 212, 213, 237, 261, 285]) {
    assert.equal(overflowDropIndexY(ROWS, y), dropIndexFromPointer(axis, y, -1), `y=${y}`);
  }
});

test('Leg 5a overflowDropIndexY — NON-DESTRUCTIVE on unreadable input (null, not 0)', () => {
  // 0 is a REAL drop position here (the top of the overflow run), so a failed
  // measurement must not resolve to it — that would spend a write.
  assert.equal(overflowDropIndexY([], 210), null);
  assert.equal(overflowDropIndexY(null, 210), null);
  assert.equal(overflowDropIndexY(ROWS, NaN), null);
  assert.equal(overflowDropIndexY([{ top: 0, height: 10 }, null], 5), null);
  assert.equal(overflowDropIndexY([{ top: NaN, height: 10 }], 5), null);
  assert.equal(overflowDropIndexY([{ top: 0, height: Infinity }], 5), null);
});

test('Leg 5a overflowIndicatorY — the top edge of the following row, or the bottom of the last', () => {
  assert.equal(overflowIndicatorY(ROWS, 0), 200);
  assert.equal(overflowIndicatorY(ROWS, 1), 224);
  assert.equal(overflowIndicatorY(ROWS, 3), 272);
  assert.equal(overflowIndicatorY(ROWS, 4), 296, 'past the end -> the bottom edge of the last row');
  assert.equal(overflowIndicatorY(ROWS, 99), 296);
  assert.equal(overflowIndicatorY([], 0), null);
  assert.equal(overflowIndicatorY(ROWS, -1), null);
  assert.equal(overflowIndicatorY(ROWS, 1.5), null);
  assert.equal(overflowIndicatorY([{ top: NaN, height: 10 }], 0), null);
});

// ---------------------------------------------------------------------------
// AC4 — THE INDEX RULE. Operator-ruled 2026-08-05 after TWO design-review cycles
// both proposed a wrong alternative. These cases assert the LITERAL expected
// values from the ruling; nothing here re-derives the formula.
// ---------------------------------------------------------------------------

test('Leg 5a AC4: toIndex = min(visibleCount + k, n - 1) — pinned at k=0, k=1, k=last, k=past-the-end', () => {
  const n = 12; // order A..L
  const visible = 8; // overflow rows I,J,K,L
  assert.equal(overflowDropToIndex(visible, 0, n), 8);
  assert.equal(overflowDropToIndex(visible, 1, n), 9);
  assert.equal(overflowDropToIndex(visible, 2, n), 10);
  assert.equal(overflowDropToIndex(visible, 3, n), 11, 'k = the last row');
  assert.equal(overflowDropToIndex(visible, 4, n), 11, 'k past the last row CLAMPS — it must not become n');
});

test('Leg 5a AC4: the CLAMP is load-bearing — without it the drop is a SILENT NO-OP', () => {
  const order = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
  // The unclamped value moveIndex would receive for a drop past the last row.
  assert.equal(
    moveIndex(order, 0, 8 + 4),
    order,
    "toIndex === order.length is moveIndex's out-of-range no-op — SAME ARRAY REFERENCE, " +
      'which commitReorder reads as "nothing moved" and never calls the store'
  );
  // Clamped, the same gesture is a real move.
  assert.notEqual(moveIndex(order, 0, overflowDropToIndex(8, 4, order.length)), order);
});

test("Leg 5a AC4: degenerate input resolves to moveIndex's no-op, not to position 0", () => {
  for (const args of [
    [-1, 0, 12],
    [8, -1, 12],
    [8, 0, 0],
    [8.5, 0, 12],
    [8, 0.5, 12],
    [8, 0, 12.5],
    ['8', 0, 12],
    [8, null, 12],
    [8, 0, undefined]
  ]) {
    assert.equal(overflowDropToIndex(...args), -1, JSON.stringify(args));
  }
  const order = ['a', 'b', 'c'];
  assert.equal(
    moveIndex(order, 0, overflowDropToIndex(-1, 0, 3)),
    order,
    '-1 is out of range for moveIndex, so it returns the SAME reference and commitReorder skips the store call'
  );
});

test('Leg 5a isOverChevron — containment, and a ZERO-AREA (hidden) chevron never hits', () => {
  const chevron = { left: 380, top: 100, right: 404, bottom: 124 };
  assert.equal(isOverChevron(chevron, 390, 112), true);
  assert.equal(isOverChevron(chevron, 380, 100), true, 'edges are inclusive, matching isInsideBar');
  assert.equal(isOverChevron(chevron, 404, 124), true);
  assert.equal(isOverChevron(chevron, 379, 112), false);
  assert.equal(isOverChevron(chevron, 390, 125), false);
  // display:none -> 0,0,0,0. isInsideBar's inclusive edges would match the
  // viewport origin and spring a menu with nothing in it.
  assert.equal(isInsideBar({ left: 0, top: 0, right: 0, bottom: 0 }, 0, 0), true, 'the shape being defended against');
  assert.equal(isOverChevron({ left: 0, top: 0, right: 0, bottom: 0 }, 0, 0), false);
  assert.equal(isOverChevron(null, 1, 1), false);
  assert.equal(isOverChevron({ left: 0, top: 0, right: NaN, bottom: 10 }, 1, 1), false);
});

// ---------------------------------------------------------------------------
// M15 F3 Leg 5b (AC5) — barDropToIndex: the OTHER direction's clamp.
// ---------------------------------------------------------------------------

test('Leg 5b barDropToIndex — every position below the boundary passes through untouched', () => {
  // Three visible slots. Indices 0..2 are real bar positions and are the
  // full-list positions too (the overflow hide is a strict tail).
  assert.equal(barDropToIndex(0, 3), 0);
  assert.equal(barDropToIndex(1, 3), 1);
  assert.equal(barDropToIndex(2, 3), 2);
});

test('Leg 5b barDropToIndex — THE CLAMP: a release past the last visible slot lands ON the bar', () => {
  // dropIndexFromPointer answers `visibleCount` for a pointer past the last
  // slot's midpoint — the position where the indicator drew at that slot's RIGHT
  // EDGE, i.e. "here, at the end of the bar". UNCLAMPED that is full-list
  // position 3, which with visibleCount 3 is the FIRST OVERFLOW ROW: the bar
  // would be visually unchanged and a deliberate gesture would read as
  // "nothing happened".
  assert.equal(barDropToIndex(3, 3), 2);
  assert.equal(barDropToIndex(99, 3), 2, 'any past-the-end answer resolves to the last visible position');
  // …and it is the mirror of the bar → overflow clamp, which exists for exactly
  // the same reason at the other boundary.
  assert.equal(overflowDropToIndex(3, 9, 12), 11);
});

test('Leg 5b barDropToIndex — the whole range on ONE fixture, every term load-bearing', () => {
  // Per the Flight 2 fixture rule: change any single term and the answer changes.
  // visibleCount 5, dropIndex 4 -> 4 (below the boundary, unclamped);
  // visibleCount 5, dropIndex 5 -> 4 (at the boundary, clamped);
  // visibleCount 4, dropIndex 4 -> 3 (the clamp tracks visibleCount, not a literal).
  assert.equal(barDropToIndex(4, 5), 4);
  assert.equal(barDropToIndex(5, 5), 4);
  assert.equal(barDropToIndex(4, 4), 3);
  assert.equal(barDropToIndex(3, 5), 3);
});

test("Leg 5b barDropToIndex — degenerate input resolves to moveIndex's no-op, not to position 0", () => {
  for (const [k, v] of [
    [-1, 3],
    [1.5, 3],
    [NaN, 3],
    ['1', 3],
    [null, 3],
    [0, 0],
    [0, -1],
    [0, 1.5],
    [0, '3']
  ]) {
    assert.equal(
      barDropToIndex(/** @type {any} */ (k), /** @type {any} */ (v)),
      -1,
      `barDropToIndex(${String(k)}, ${String(v)}) must refuse rather than guess`
    );
  }
  // …and -1 is the NON-DESTRUCTIVE outcome because moveIndex no-ops on it —
  // asserted as a fact about moveIndex, not as a claim about our code.
  const order = ['a', 'b', 'c'];
  assert.equal(moveIndex(order, 2, barDropToIndex(-1, 3)), order, 'same reference — nothing moved');
});
