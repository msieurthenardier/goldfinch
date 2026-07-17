// @ts-check

/**
 * Tab-order decision model (M09 Flight 2 DD1). Pure, no DOM, no Electron —
 * every reorder decision (keyboard move, pointer-drop index) is computed
 * here and unit-tested offline; the renderer owns only the single DOM read
 * (`orderedTabIds()`) and the DOM commit (`insertBefore`-based move).
 *
 * Indices throughout this module are visual, left-to-right order — the app
 * is LTR-only; RTL is explicitly out of scope (Flight 2 DD1/Edge Cases).
 *
 * @typedef {{ left: number, width: number }} SlotRect
 */

/**
 * moveIndex(order, fromIndex, toIndex)
 *
 * Pure reorder: returns a NEW array with the element at `fromIndex` moved to
 * `toIndex` (splice-style — `toIndex` is the element's index in the
 * resulting array). Never mutates `order`.
 *
 * No-ops (returns the SAME array reference as `order` — callers can use
 * reference equality to detect "nothing changed") when:
 *   - `order` is not an array,
 *   - `fromIndex`/`toIndex` are not integers,
 *   - `fromIndex`/`toIndex` are out of range (`< 0` or `>= order.length`),
 *   - `fromIndex === toIndex`.
 *
 * @param {Array<string>} order
 * @param {number} fromIndex
 * @param {number} toIndex
 * @returns {Array<string>}
 */
export function moveIndex(order, fromIndex, toIndex) {
  if (!Array.isArray(order)) return order;
  const n = order.length;
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    fromIndex >= n ||
    toIndex < 0 ||
    toIndex >= n ||
    fromIndex === toIndex
  ) {
    return order; // no-op — same reference signals "nothing changed"
  }
  const next = order.slice();
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

/**
 * keyboardMove(order, id, direction)
 *
 * One-slot keyboard reorder: moves `id` one position toward `direction`
 * ('left' decrements its index, 'right' increments it). Bounds like Chrome —
 * at either end the move NO-OPS (no wrap).
 *
 * Returns the SAME array reference as `order` (no-op signal) when:
 *   - `order` is not an array,
 *   - `id` is not found in `order`,
 *   - `direction` is neither `'left'` nor `'right'`,
 *   - the move would go past either end.
 * Otherwise returns a NEW array (via `moveIndex`) with `id` moved one slot.
 *
 * @param {Array<string>} order
 * @param {string} id
 * @param {'left' | 'right'} direction
 * @returns {Array<string>}
 */
export function keyboardMove(order, id, direction) {
  if (!Array.isArray(order)) return order;
  const idx = order.indexOf(id);
  if (idx === -1) return order; // unknown id — no-op
  const delta = direction === 'right' ? 1 : direction === 'left' ? -1 : 0;
  if (delta === 0) return order; // unrecognized direction — no-op
  const target = idx + delta;
  if (target < 0 || target >= order.length) return order; // at an end — no wrap, no-op
  return moveIndex(order, idx, target);
}

/**
 * dropIndexFromPointer(slotRects, pointerX, draggedIndex)
 *
 * Pointer-drag drop-index resolution (midpoint rule): given the CURRENT
 * visual slot rects (one per tab, in DOM order, `{ left, width }` — a plain
 * object or DOMRect works), the pointer's x coordinate, and the index of the
 * slot being dragged, returns the insertion index AMONG THE REMAINING SLOTS
 * (i.e. `slotRects` with the dragged slot excluded) where the drop would
 * land.
 *
 * Rule: for every non-dragged slot, if the pointer is strictly past that
 * slot's horizontal midpoint (`left + width / 2`), it counts toward the
 * returned index. A pointer sitting EXACTLY on a midpoint does not count
 * (ties resolve to "before" that slot) — this makes the boundary
 * deterministic rather than dependent on floating-point direction.
 *
 * Degenerate input (`slotRects` not an array, or empty) returns `0`.
 *
 * @param {Array<SlotRect>} slotRects
 * @param {number} pointerX
 * @param {number} draggedIndex
 * @returns {number}
 */
export function dropIndexFromPointer(slotRects, pointerX, draggedIndex) {
  if (!Array.isArray(slotRects) || slotRects.length === 0) return 0;
  let index = 0;
  for (let i = 0; i < slotRects.length; i++) {
    if (i === draggedIndex) continue;
    const rect = slotRects[i];
    if (!rect) continue;
    const midpoint = rect.left + rect.width / 2;
    if (pointerX > midpoint) index++;
  }
  return index;
}
