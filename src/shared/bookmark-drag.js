// @ts-check

/**
 * Bookmark-drag decision model (M15 Flight 3 "Drag Interactions" Leg 3, DD3).
 * Pure, no DOM, no Electron — the bar drag's two decisions (which slots are
 * measurable, and where a pointer point would drop) are computed here from
 * plain numbers and unit-tested offline; `bookmarks-bar.js` owns only the DOM
 * reads that produce the inputs. Same division of labour as `tab-drag-zone.js`,
 * whose `dropIndexFromPointer` delegation this copies verbatim — the midpoint
 * rule Flight 2 pinned is not re-litigated here, and `moveIndex` (the commit's
 * half of the same pair) is likewise imported unchanged by the caller.
 *
 * WINDOW-LOCAL COORDINATES ONLY, exactly as `tab-drag-zone.js`: every point is
 * a viewport coordinate from `e.clientX`/`e.clientY`, measured against the same
 * window's own `getBoundingClientRect()`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FACT A FUTURE READER WILL OTHERWISE RE-DERIVE INCORRECTLY (DD3):
 *
 * There is NO visible→full-list index translation, because the two index
 * spaces are IDENTICAL. `bookmarks-bar.js`'s `itemEls()` returns ALL `.bm-item`
 * children in full-list order, and the overflow hide is a strict TAIL —
 * `items.forEach((el, i) => el.classList.toggle('hidden', i >= visibleCount))`.
 * So for every visible item, its index among the visible items IS its index in
 * `bookmarksClient.listFor(jarId)`. A "translator" here would be the identity
 * function.
 *
 * The real requirement is the inverse, and it is what `visibleSlotRects` is
 * for: `.bm-item.hidden` is `display: none`, so an overflowed item reports a
 * ZERO-WIDTH rect AT LEFT 0. Feeding the raw `itemEls()` rects into
 * `dropIndexFromPointer` counts every hidden one (its midpoint, 0, is less than
 * any pointer x past the bar's left edge), inflating the answer by exactly the
 * overflow count. Hidden items must be filtered out BEFORE measuring.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @typedef {{ left: number, top: number, right: number, bottom: number }} BarRect
 * @typedef {{ left: number, width: number }} SlotRect
 * @typedef {{ top: number, height: number }} RowRect
 * @typedef {{ rect: { left: number, width: number } | null | undefined, hidden: boolean }} SlotInput
 * @typedef {{ zone: 'reorder', index: number } | { zone: 'outside' }} BookmarkDropZone
 */

import { dropIndexFromPointer } from './tab-order.js';

/** The chrome's own dispatch key for a bookmark drag (DD2). The bookmark's
 * **id** rides this type; `text/uri-list` and `text/plain` carry the url for
 * web interop. Single-sourced here so `bookmarks-bar.js` and (Leg 4) the
 * drag-onto-page consumer never re-type the literal. */
export const BOOKMARK_DND_MIME = 'application/x-goldfinch-bookmark';

/**
 * visibleSlotRects(items)
 *
 * Assemble the `{left, width}` slot array `dropIndexFromPointer` consumes, from
 * one `{ rect, hidden }` entry per `.bm-item` IN FULL-LIST ORDER, dropping the
 * `display: none` overflow tail (see the header note — this is the whole point
 * of the function).
 *
 * Because the hide is a strict tail, the returned array's index IS the full-list
 * index of the item it describes. Nothing downstream translates.
 *
 * NON-DESTRUCTIVE ON UNREADABLE INPUT, and the shape is deliberate: a VISIBLE
 * item whose rect cannot be read makes the WHOLE array unusable — silently
 * dropping it would shift every later index by one and commit a wrong move.
 * Such an input returns `[]`, which `classifyBookmarkDrop` resolves to
 * `outside` (no reorder). Degenerate `items` likewise returns `[]`.
 *
 * @param {Array<SlotInput>} items
 * @returns {Array<SlotRect>}
 */
export function visibleSlotRects(items) {
  if (!Array.isArray(items)) return [];
  /** @type {Array<SlotRect>} */
  const out = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') return []; // unreadable entry — whole array is untrustworthy
    if (item.hidden) continue; // the overflow tail: display:none, zero-width at left 0
    const rect = item.rect;
    if (!rect || typeof rect !== 'object') return [];
    const { left, width } = rect;
    if (!Number.isFinite(left) || !Number.isFinite(width)) return [];
    out.push({ left, width });
  }
  return out;
}

/**
 * classifyBookmarkDrop(barRect, slotRects, pointerX, pointerY, draggedIndex)
 *
 *   - `{ zone: 'reorder', index }` — the point is within the bar's own rect.
 *     `index` is EXACTLY `dropIndexFromPointer(slotRects, pointerX,
 *     draggedIndex)`: this module adds the y-axis test and the hidden-item
 *     filtering (above) and nothing else.
 *   - `{ zone: 'outside' }` — the point is outside the bar on any edge. No
 *     reorder. `drag-onto-page` owns that zone; this module does not pre-empt
 *     it by naming a second positive outcome.
 *
 * The rect is INCLUSIVE on all four edges: a pointer exactly on the boundary
 * still reorders, and `dropIndexFromPointer` resolves its own midpoint ties the
 * same way (toward "before"), so the two agree at their boundaries.
 *
 * ⚠ THE DEGENERATE-INPUT POLARITY IS THE OPPOSITE OF `tab-drag-zone.js`'s, and
 * that is correct rather than an inconsistency. There, the destructive outcome
 * is `tearOff`, so an unreadable rect falls through to `reorder`. HERE the
 * reorder IS the write, and `outside` is the outcome that changes nothing — so
 * an unreadable `barRect`, a non-finite edge, or an empty slot array all
 * resolve to `outside`. The rule both modules obey is the same one: a
 * measurement that failed must never spend the destructive outcome.
 *
 * @param {BarRect} barRect
 * @param {Array<SlotRect>} slotRects
 * @param {number} pointerX
 * @param {number} pointerY
 * @param {number} draggedIndex
 * @returns {BookmarkDropZone}
 */
export function classifyBookmarkDrop(barRect, slotRects, pointerX, pointerY, draggedIndex) {
  if (!isInsideBar(barRect, pointerX, pointerY)) return { zone: 'outside' };
  if (!Array.isArray(slotRects) || slotRects.length === 0) return { zone: 'outside' };
  return { zone: 'reorder', index: dropIndexFromPointer(slotRects, pointerX, draggedIndex) };
}

/**
 * Is the point inside the bar's rect, on a rect this module could actually read?
 *
 * Phrased as the POSITIVE (the mirror image of `tab-drag-zone.js`'s
 * `isOutsideStrip`, for the polarity reason in `classifyBookmarkDrop`'s note):
 * every unreadable input falls through to `false`, so the caller's reorder
 * branch is reachable only from a rect that was actually measured.
 *
 * @param {BarRect} barRect
 * @param {number} pointerX
 * @param {number} pointerY
 * @returns {boolean}
 */
export function isInsideBar(barRect, pointerX, pointerY) {
  if (!barRect || typeof barRect !== 'object') return false;
  const { left, top, right, bottom } = barRect;
  if (
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    !Number.isFinite(right) ||
    !Number.isFinite(bottom) ||
    !Number.isFinite(pointerX) ||
    !Number.isFinite(pointerY)
  ) {
    return false; // an unmeasurable bar never reorders
  }
  return pointerX >= left && pointerX <= right && pointerY >= top && pointerY <= bottom;
}

/**
 * indicatorX(slotRects, index, draggedIndex)
 *
 * The viewport x at which the insertion indicator belongs for a drop index
 * `index` produced by `classifyBookmarkDrop`. `index` counts positions among
 * the REMAINING slots (the dragged one excluded — `dropIndexFromPointer`'s
 * contract), so the remaining run is rebuilt here and the boundary read off it:
 * the left edge of the slot that would FOLLOW the drop, or the right edge of
 * the last remaining slot when the drop lands past the end.
 *
 * Returns `null` when there is nothing to point at or the inputs are
 * unreadable — the caller hides the indicator rather than parking it at 0.
 * Deliberately returns a VIEWPORT coordinate, not a bar-relative one: the
 * caller owns the single subtraction of the bar's own left edge, which keeps
 * this function free of any knowledge of the indicator's CSS containing block.
 *
 * @param {Array<SlotRect>} slotRects
 * @param {number} index
 * @param {number} draggedIndex
 * @returns {number | null}
 */
export function indicatorX(slotRects, index, draggedIndex) {
  if (!Array.isArray(slotRects) || slotRects.length === 0) return null;
  if (!Number.isInteger(index) || index < 0) return null;
  const remaining = slotRects.filter((_, i) => i !== draggedIndex);
  if (remaining.length === 0) return null;
  if (index >= remaining.length) {
    const last = remaining[remaining.length - 1];
    return last.left + last.width;
  }
  return remaining[index].left;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * THE OVERFLOW SHEET'S Y-AXIS SIBLINGS (M15 F3 Leg 5a, AC3/AC4)
 *
 * The bar is a horizontal run; the overflow sheet's rows are a VERTICAL list.
 * Everything above is x-only (`dropIndexFromPointer` takes a pointer x,
 * `indicatorX` returns an x), so the sheet needs its own pair — here, pure and
 * unit-tested, NEVER hand-rolled inside `menu-overlay.js`.
 *
 * The midpoint rule itself is still NOT re-derived: `overflowDropIndexY` maps
 * the vertical axis onto the horizontal one (`top → left`, `height → width`)
 * and delegates to the same `dropIndexFromPointer` the bar uses, so a change to
 * the tie rule stays visible to both axes.
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * overflowDropIndexY(rowRects, pointerY)
 *
 * Where a pointer at `pointerY` would insert among the overflow sheet's rows,
 * as an index in `[0, rowRects.length]` — SNAPSHOT-LOCAL (the sheet renders
 * exactly the overflowed entries, so row i is snapshot entry i).
 *
 * The dragged item is NEVER one of these rows in this leg: the source is a BAR
 * item, so there is no slot to exclude. That is `dropIndexFromPointer`'s
 * EXTERNAL-SOURCE case and it is passed `draggedIndex = -1` deliberately (see
 * that function's JSDoc — the past-the-end answer is load-bearing here, it is
 * what `overflowDropToIndex`'s clamp converts into "last position").
 *
 * NON-DESTRUCTIVE ON UNREADABLE INPUT: returns `null` rather than 0, because 0
 * is a REAL drop position here (the top of the overflow run) and a failed
 * measurement must never spend a write — the same rule `visibleSlotRects`
 * obeys with its `[]`.
 *
 * @param {Array<RowRect>} rowRects
 * @param {number} pointerY
 * @returns {number | null}
 */
export function overflowDropIndexY(rowRects, pointerY) {
  if (!Array.isArray(rowRects) || rowRects.length === 0) return null;
  if (!Number.isFinite(pointerY)) return null;
  /** @type {Array<SlotRect>} */
  const axis = [];
  for (const row of rowRects) {
    if (!row || typeof row !== 'object') return null;
    const { top, height } = row;
    if (!Number.isFinite(top) || !Number.isFinite(height)) return null;
    axis.push({ left: top, width: height });
  }
  return dropIndexFromPointer(axis, pointerY, -1);
}

/**
 * overflowIndicatorY(rowRects, index)
 *
 * The viewport y at which the sheet's placement indicator belongs for an index
 * from `overflowDropIndexY`: the TOP edge of the row that would follow the
 * drop, or the BOTTOM edge of the last row when the drop lands past the end.
 * The y-axis mirror of `indicatorX`, minus its dragged-slot exclusion (there is
 * no dragged slot among these rows — see above).
 *
 * Returns `null` when there is nothing to point at or the input is unreadable;
 * the caller hides the indicator rather than parking it at 0.
 *
 * @param {Array<RowRect>} rowRects
 * @param {number} index
 * @returns {number | null}
 */
export function overflowIndicatorY(rowRects, index) {
  if (!Array.isArray(rowRects) || rowRects.length === 0) return null;
  if (!Number.isInteger(index) || index < 0) return null;
  const row = index >= rowRects.length ? rowRects[rowRects.length - 1] : rowRects[index];
  if (!row || !Number.isFinite(row.top) || !Number.isFinite(row.height)) return null;
  return index >= rowRects.length ? row.top + row.height : row.top;
}

/**
 * overflowDropToIndex(visibleCount, dropIndex, orderLength)
 *
 * ⚠ THE INDEX RULE, RULED BY THE OPERATOR ON 2026-08-05 AFTER TWO DESIGN-REVIEW
 * CYCLES BOTH GOT IT WRONG. DO NOT RE-DERIVE IT.
 *
 *     toIndex = min(visibleCount + dropIndex, orderLength - 1)
 *
 * and that value is passed to `moveIndex` UNCHANGED. Semantics: *land where the
 * indicator drew* — after the drop the item sits at overflow position
 * `dropIndex`, and whichever item the visible/overflow boundary displaces is
 * promoted onto the bar. The boundary moving is inherent (the bar's capacity did
 * not change) and is a HAT confirmation item, not a defect.
 *
 * Verified across the whole range against `order = A..L`, `visibleCount = 8`
 * (overflow rows I,J,K,L), dragging A:
 *   k=0 → overflow [A,J,K,L] · k=1 → [J,A,K,L] · k=2 → [J,K,A,L] ·
 *   k=3 → [J,K,L,A] · k=4 (past the last row) → [J,K,L,A], A last.
 *
 * ⚠ THE CLAMP IS LOAD-BEARING, not tidiness. Without it a drop past the last
 * overflow row yields `toIndex === orderLength`, `moveIndex` returns the SAME
 * ARRAY REFERENCE (its documented out-of-range no-op), and `commitReorder`
 * reads that reference equality as "nothing moved" — a SILENT NO-OP on a
 * deliberate gesture, which the leg's Edge Cases explicitly forbid.
 *
 * Degenerate input returns `-1`, which `moveIndex` also no-ops on — the
 * non-destructive outcome, reached deliberately rather than by accident.
 *
 * @param {number} visibleCount how many entries were on the BAR when the sheet's
 *   snapshot was taken (STORED alongside that snapshot — never derived from a
 *   live list read, which is temporally unsafe mid-drag)
 * @param {number} dropIndex the snapshot-local index from `overflowDropIndexY`
 * @param {number} orderLength the length of the FRESH full order the commit read
 * @returns {number}
 */
export function overflowDropToIndex(visibleCount, dropIndex, orderLength) {
  if (!Number.isInteger(visibleCount) || visibleCount < 0) return -1;
  if (!Number.isInteger(dropIndex) || dropIndex < 0) return -1;
  if (!Number.isInteger(orderLength) || orderLength <= 0) return -1;
  return Math.min(visibleCount + dropIndex, orderLength - 1);
}

/**
 * barDropToIndex(dropIndex, visibleCount)
 *
 * The MIRROR of `overflowDropToIndex`, for the OTHER direction (M15 F3 Leg 5b,
 * AC5): an overflow row dropped onto the bar.
 *
 *     toIndex = min(dropIndex, visibleCount - 1)
 *
 * `dropIndex` arrives from `dropIndexFromPointer` over the VISIBLE slot rects
 * with `draggedIndex = -1` (the external-source case — the dragged row is not on
 * the bar at all), so it ranges over `[0, visibleCount]`, and the array's index
 * IS the full-list index (the overflow hide is a strict tail — see the header
 * note). Everything below `visibleCount` therefore passes through untouched.
 *
 * ⚠ THE CLAMP IS WHAT MAKES THE INDICATOR HONEST, and it is the same
 * load-bearing shape as `overflowDropToIndex`'s. At `dropIndex === visibleCount`
 * — a release past the last visible item, where the indicator drew at that
 * item's RIGHT EDGE, i.e. "here, at the end of the bar" — the unclamped value
 * lands the item at full-list position `visibleCount`, which is the FIRST
 * OVERFLOW ROW: the bar would be visually unchanged and the operator's
 * deliberate gesture would read as "nothing happened". Clamped, it lands at the
 * last visible position and displaces whatever was there into overflow, which is
 * DD4's boundary consequence and exactly where the indicator pointed.
 *
 * Degenerate input returns `-1`, which `moveIndex` no-ops on — the
 * non-destructive outcome, reached deliberately rather than by accident.
 *
 * @param {number} dropIndex insertion index among the VISIBLE slots
 * @param {number} visibleCount how many slots those were (`slotRects.length`)
 * @returns {number}
 */
export function barDropToIndex(dropIndex, visibleCount) {
  if (!Number.isInteger(dropIndex) || dropIndex < 0) return -1;
  if (!Number.isInteger(visibleCount) || visibleCount <= 0) return -1;
  return Math.min(dropIndex, visibleCount - 1);
}

/**
 * isOverChevron(chevronRect, pointerX, pointerY)
 *
 * The spring-load hit test (Leg 5a, AC2/AC2a). Same containment rule as
 * `isInsideBar`, with one addition that matters: a ZERO-AREA rect never hits.
 * A hidden chevron is `display: none` and reports `0,0,0,0`, and `isInsideBar`'s
 * deliberately inclusive edges would match a pointer at the viewport origin —
 * springing a menu with nothing in it. Edge Case "overflow region empty /
 * chevron hidden" resolves to inert here, structurally.
 *
 * @param {BarRect} chevronRect
 * @param {number} pointerX
 * @param {number} pointerY
 * @returns {boolean}
 */
export function isOverChevron(chevronRect, pointerX, pointerY) {
  if (!chevronRect || typeof chevronRect !== 'object') return false;
  const { left, top, right, bottom } = chevronRect;
  if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) {
    return false;
  }
  if (right <= left || bottom <= top) return false; // hidden / unmeasurable — never springs
  return isInsideBar(chevronRect, pointerX, pointerY);
}
