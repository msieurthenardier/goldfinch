// @ts-check

/**
 * Tab-drag zone model (M09 Flight 8 DD16). Pure, no DOM, no Electron — the
 * drag's "reorder here, or tear this tab off?" decision is computed here from
 * plain numbers and unit-tested offline; the renderer owns only the two DOM
 * reads (the strip's rect, the slot rects) that produce them. Same division of
 * labour as tab-order.js, whose `dropIndexFromPointer` this delegates to
 * unchanged — the reorder contract F2 pinned is not re-litigated here.
 *
 * WINDOW-LOCAL COORDINATES ONLY, and that is the design decision, not an
 * accident of scope (DD16). Every point this module sees is a viewport
 * coordinate from the SOURCE window's own `e.clientX`/`e.clientY`, measured
 * against that same window's own `getBoundingClientRect()`. Nothing here reads
 * `screenX`, `getBounds`, `getPosition`, or Electron's `screen` module: the
 * flight's transport spike brought a second instrument (Win32 `GetWindowRect`
 * over WSLg's RAIL surface) and measured every one of those to be a cached
 * fiction on this rig — a virgin window is born 363px wrong, `setPosition` is a
 * no-op, and a real OS move fires no event at all. None of them is falsifiable
 * from inside Electron, so none of them is used.
 *
 * "Did the pointer leave the strip?" never needed a shared coordinate space —
 * it is answered entirely inside one viewport. That is precisely why tear-off
 * survived the spike that killed cross-window drop.
 *
 * Indices throughout are visual, left-to-right order — LTR-only, as tab-order.js
 * (Flight 2 DD1/Edge Cases).
 *
 * @typedef {{ left: number, top: number, right: number, bottom: number }} StripRect
 * @typedef {{ left: number, width: number }} SlotRect
 * @typedef {{ zone: 'reorder', index: number } | { zone: 'tearOff' }} DragZone
 */

import { dropIndexFromPointer } from './tab-order.js';

// `shouldArm`/`DRAG_ARM_THRESHOLD_PX` were RETIRED at M09 F11 Leg 2: native HTML5 DnD owns
// arming (the browser initiates the drag past its own threshold), so the F9 pointer-travel
// predicate and its threshold — and the F9 threshold debt — are moot. `classifyDragPoint`
// (the zone decision) is what the native rewrite reuses directly — the dragover preview
// AND the dragend release-point classification; `isOutsideStrip` stays an exported pure
// test but is reused only TRANSITIVELY through it (the Leg 2 HAT fix removed the
// renderer's direct viewport-gate call).

/**
 * classifyDragPoint(stripRect, slotRects, pointerX, pointerY, draggedIndex)
 *
 * Classify one window-local pointer point into the drag's two zones:
 *
 *   - `{ zone: 'reorder', index }` — the point is within the strip's own rect.
 *     `index` is EXACTLY what `dropIndexFromPointer(slotRects, pointerX,
 *     draggedIndex)` returns for that x: this module adds the y-axis test and
 *     nothing else, so F2's reorder behavior is bit-for-bit what it was.
 *   - `{ zone: 'tearOff' }` — the point is outside the strip's rect on any
 *     edge. The drop would take the tab into its own new window.
 *
 * The rect is treated as INCLUSIVE on all four edges: a pointer exactly on the
 * boundary still reorders. Ties resolve toward the strip deliberately — the
 * conservative side of this decision is the one that does NOT move the user's
 * tab to another window, and `dropIndexFromPointer` resolves its own midpoint
 * ties the same way (toward "before"), so the two agree at their boundaries.
 *
 * Degenerate `stripRect` (not an object, or carrying a non-finite edge) returns
 * `reorder`, NOT `tearOff`. A rect this module cannot read is a failed DOM
 * measurement, and the failure must not silently spend the destructive outcome:
 * an unreadable strip makes the drag behave exactly as it did before F8.
 *
 * @param {StripRect} stripRect
 * @param {Array<SlotRect>} slotRects
 * @param {number} pointerX
 * @param {number} pointerY
 * @param {number} draggedIndex
 * @returns {DragZone}
 */
export function classifyDragPoint(stripRect, slotRects, pointerX, pointerY, draggedIndex) {
  if (isOutsideStrip(stripRect, pointerX, pointerY)) return { zone: 'tearOff' };
  return { zone: 'reorder', index: dropIndexFromPointer(slotRects, pointerX, draggedIndex) };
}

/**
 * Is the point outside the strip's rect on any edge?
 *
 * Phrased as the NEGATIVE (rather than an `isInsideStrip` the caller negates)
 * so that every unreadable input falls through to `false` — "not outside" — and
 * the caller's tear-off branch is reachable only from a rect that was actually
 * measured. See classifyDragPoint's degenerate-input note.
 *
 * @param {StripRect} stripRect
 * @param {number} pointerX
 * @param {number} pointerY
 * @returns {boolean}
 */
export function isOutsideStrip(stripRect, pointerX, pointerY) {
  if (!stripRect || typeof stripRect !== 'object') return false;
  const { left, top, right, bottom } = stripRect;
  if (
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    !Number.isFinite(right) ||
    !Number.isFinite(bottom) ||
    !Number.isFinite(pointerX) ||
    !Number.isFinite(pointerY)
  ) {
    return false; // an unmeasurable rect never tears a tab off
  }
  return pointerX < left || pointerX > right || pointerY < top || pointerY > bottom;
}
