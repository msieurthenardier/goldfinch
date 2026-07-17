# Leg: order-model-and-keyboard-reorder

**Status**: completed
**Flight**: [Tab Order Model and Reorder](../flight.md)

## Objective

Land the explicit tab-order model (pure `src/shared/tab-order.js` + the
renderer's `orderedTabIds()` accessor with all order-consuming sites
switched) and keyboard reorder (`Ctrl+Shift+ArrowLeft/Right` with a
screen-reader announcement), extending the `tab-keyboard-operability` spec.

## Context

- Flight DD1: DOM order is the single source of truth. The pure module owns
  decisions; the accessor owns reads; the Map stays id→tab lookup only.
- Flight DD3: reorder keys extend the existing tablist keydown handler
  (renderer.js ~1513) under its existing no-hijack scoping; collision-checked
  (no Ctrl+Shift+Arrow in `keydown-action.js` / `sheet-accelerator.js` / the
  strip handler). Announcement reuses the `#media-status` sr-only
  `role="status" aria-live="polite"` idiom (index.html) — add a dedicated
  `#tab-status` sibling so tab announcements never race media ones.
- Flight DD5: `tab-keyboard-operability` gains a reorder step; its stale
  Out-of-Scope click line is updated to point at the (next leg's)
  `tab-reorder` spec.
- Verified order-consuming sites (design review): `closeTab`'s
  `[...tabs.keys()].pop()` (renderer.js ~1041) and the keydown handler's
  `ids = [...tabs.keys()]` (~1513). All other `tabs` iterations are
  order-agnostic — leave them.

## Inputs

- Branch `flight/2-tab-reorder` (stacked on flight/1); clean tree.
- `src/renderer/renderer.js` with the flight-1 tab strip (`.tab-row` DOM).
- `tests/behavior/tab-keyboard-operability.md` (pinned contract).

## Outputs

- `src/shared/tab-order.js` (new, ESM): `moveIndex(order, from, to)`,
  `keyboardMove(order, id, direction)`, `dropIndexFromPointer(slotRects,
  pointerX, draggedIndex)` (midpoint rule; needed next leg but designed and
  tested now so the model is complete).
- `test/unit/tab-order.test.js` (new).
- `src/renderer/renderer.js`: `orderedTabIds()` accessor; consumer swaps;
  Ctrl+Shift+Arrow branch in the strip keydown handler; DOM move commit
  helper (`insertBefore`-based, shared with next leg's drop); announcement
  wiring.
- `src/renderer/index.html`: `#tab-status` sr-only status region.
- `tests/behavior/tab-keyboard-operability.md`: extended (reorder step +
  Out-of-Scope line update).

## Acceptance Criteria

- [x] `src/shared/tab-order.js` exists as real ESM (script-tag added per the
      shared-global onboarding checklist — module `<script type="module">`
      import in the chrome; no INTERNAL_PAGES entry needed, chrome-only),
      with the three pure functions; `keyboardMove` bounds correctly (no-op
      at ends, no wrap — Chrome parity), `moveIndex` handles from==to and
      out-of-range as no-ops, `dropIndexFromPointer` implements the midpoint
      rule excluding the dragged slot.
- [x] `test/unit/tab-order.test.js` covers: single-tab order, boundary
      moves, no-op moves, midpoint boundaries (exactly-at-midpoint), dragged
      slot exclusion, and degenerate inputs (empty order, unknown id) — all
      green under `node --test`.
- [x] `orderedTabIds()` in renderer.js reads DOM order; `closeTab`'s
      next-tab pick and the keydown handler's `ids` both use it.
      Grep-AC: every remaining `[...tabs.keys()]` hit individually judged
      order-agnostic (record hits + judgments in the flight log).
- [x] `Ctrl+Shift+ArrowLeft/Right` with focus on a tab moves that tab one
      slot (DOM order changes; focus stays on the moved tab; roving
      tabindex intact; exactly one `aria-selected=true` throughout); at the
      ends it no-ops silently; plain arrows/Home/End/Delete behavior is
      byte-identical to before.
- [x] Each move announces "Tab moved to position {n} of {m}" (or equivalent)
      via the new `#tab-status` sr-only live region; `aria-keyshortcuts` on
      tabs includes the reorder chord.
- [x] No-hijack holds: Ctrl+Shift+Arrow with focus in the address bar or in
      guest content does NOT reorder (the handler is scoped to the strip).
- [x] `tests/behavior/tab-keyboard-operability.md` extended: new step for
      keyboard reorder (move right, verify order + focus + announcement +
      single aria-selected; move left restores), no-hijack step mentions the
      reorder chord, Out-of-Scope click line updated per DD5. `Last Run`
      untouched.
- [x] `npm test`, `npm run lint`, `npm run typecheck` green.
- [x] Flight log leg entry written (include the grep-AC judgment table).

## Verification Steps

- `node --test test/unit/tab-order.test.js`.
- Grep audit: `grep -n "tabs.keys()" src/renderer/renderer.js` → judged list.
- Live spot-check (dev:automation + admin MCP): focus a middle tab (click),
  `pressKey` the reorder chord, `evaluate` DOM order + activeElement +
  `#tab-status` textContent. Keep it honest per the flight-1 lesson: read
  the DOM order AND take one `captureWindow` to confirm the moved tab
  renders at its new slot.
- Full suites.

## Implementation Guidance

1. **`src/shared/tab-order.js`** — pure, no DOM. `dropIndexFromPointer`
   takes an array of `{left, width}` (or DOMRect-likes) for the CURRENT
   visual slots and the dragged index; returns the insertion index among the
   remaining slots (midpoint rule). Keep JSDoc typedefs for typecheck.
2. **Renderer wiring** — `orderedTabIds()` = `[...els.tabs.children]`
   `.filter(el => el.classList.contains('tab')).map(el => el.dataset.id)`
   (future-proof against non-tab children). Add `commitTabMove(id,
   targetIndex)` helper: `insertBefore` the tab's btn at the target position
   — instant, no animation (guest invariant not in play, but keep the
   commit-step idiom). Swap the two consumer sites.
3. **Keydown branch** — inside the existing strip handler, BEFORE the plain
   arrow branch: `if ((e.ctrlKey) && e.shiftKey && (ArrowLeft||ArrowRight))`
   → `keyboardMove` + `commitTabMove` + `focusTab(cur)` + announce; then
   `return`. Do not touch the existing branches.
4. **Announcement** — `#tab-status` next to `#media-status` in index.html,
   identical classes/attrs; a small `announceTabStatus(text)` helper.
5. **Spec extension** — keep the Witnessed structure; the new step is
   keyboard-only (pressKey apparatus, `ShiftTab` naming caveat noted in the
   spec's preconditions from flight 1's run log; the chord key name for the
   MCP pressKey should be verified against the tool's key-name list during
   the live spot-check and recorded in the spec).
6. **Docs** — none this leg (dragPointer docs land next leg).

## Edge Cases

- **Single tab**: reorder chord no-ops, no announcement spam (announce only
  on actual moves).
- **Move during frozen widths**: keyboard reorder while a pointer-close
  freeze is armed — call `releaseTabWidths()` before the commit (keyboard
  interaction always reflows immediately, matching the Delete branch).
- **Focused tab ≠ active tab**: reorder moves the FOCUSED tab (roving
  tabindex target), which may be inactive — selection must not change
  (aria-selected stays where it was).
- **RTL**: out of scope (app is LTR; note in the module JSDoc that indices
  are visual-LTR).

## Files Affected

- `src/shared/tab-order.js` (new), `test/unit/tab-order.test.js` (new)
- `src/renderer/renderer.js`, `src/renderer/index.html`
- `tests/behavior/tab-keyboard-operability.md`
- flight-log.md

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit — the flight commits once after review
