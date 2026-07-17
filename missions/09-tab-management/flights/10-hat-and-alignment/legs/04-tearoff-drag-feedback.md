# Leg: L4 — tearoff-drag-feedback

**Status**: completed
**Flight**: [HAT & Alignment](../flight.md)

## Objective

HAT feature (T5): while a tear-off drag is in progress, show **in-source-window** feedback — a drag
ghost + a "release to open in a new window" hint — so the gesture isn't just a sliver + grab cursor.
Window-local only (a cursor-tracking OS window stays platform-fiction on this rig — DD16).

## Context

Risk: **MEDIUM** — renderer drag machinery; the hard constraint is **layout-neutrality** (the drag snapshots
slot rects at arm time; any strip reflow mid-gesture invalidates `dropIndexFromPointer`; `.tab.detaching` is
layout-neutral by mandate, pinned by `tab-drag-invariants.test.js`). Light design review.

**Anchors (recon):** drag is pointer-based, document-level, in `renderer.js`: `armDrag` (`:1513`, snapshots
`startOrder`/`slotRects`/`stripRect`), `pointermove` (`:1551`) tracks the dragged tab via inline
`transform: translate(dx,dy)` (`:1564`), the **tearOff enter/leave** transition (`:1569–1581`: sets
`drag.tearOff`, adds `.tab.detaching` `:1573`, `applyDetachDisplacement` `:1508`; removes on re-entry).
Cleanup: `clearDragVisuals` (`:1461`, called at `pointerup` `:1594` and `cancelDrag` `:1537`). Today's only
affordance is CSS `.tab.detaching` (`styles.css:351`, layout-neutral) + the translated `.tab.dragging`
(`styles.css:331`).

**Where it hooks:** the tearOff enter/leave block (`:1569–1581`) — show the ghost/hint when `drag.tearOff`
flips true, hide when false or at `pointerup`/`cancelDrag`. The ghost is a **new absolutely-positioned
element appended OUTSIDE `#tabs`** (so it never perturbs `slotRects`), following the same `dx/dy` as the
dragged tab; `drag.stripRect` (`:1529`) positions the hint below the strip.

## Acceptance Criteria

- [ ] **AC1 — an in-drag affordance appears when a tear-off is armed.** When `drag.tearOff` flips true, show
      a floating preview (a tab-ghost following the pointer and/or a "release to open in a new window" hint
      anchored to `drag.stripRect`), appended **outside `#tabs`**; hide it when `drag.tearOff` flips back
      false, at `pointerup`, and on every cancel path (`cancelDrag`, resize, Escape, `pointercancel`).
- [ ] **AC2 — strictly layout-neutral.** The affordance must not reflow `#tabstrip`/`#tabs` or change any
      `.tab` width/margin (the arm-time rect snapshot must stay valid). New CSS sits near `.tab.detaching`
      (`styles.css:351`) and is paint/position-only (absolute, transform, opacity). `tab-drag-invariants.test.js`
      and `tab-reorder.md`/`tab-tearoff.md` (rows 3–7) still pass.
- [ ] **AC3 — cleanup is complete.** No orphaned ghost element after any drag end (commit, tear-off, or any
      cancel). Verify the element is removed/hidden in `clearDragVisuals` and the cancel paths.
- [ ] **AC4 — gates green** (`npm test`, `lint`, `typecheck` — standalone). The visual is HAT-verified in the
      verification pass (no unit/behavior test asserts the transient ghost).

## Files Affected
- `src/renderer/renderer.js` — the tearOff enter/leave block (`:1569`) + cleanup (`:1461`/`:1537`).
- `src/renderer/styles.css` — a layout-neutral ghost/hint rule near `.tab.detaching`.

## Line Budget (DD11 — code lines)
- `renderer.js`: **≤ +25**. `styles.css`: **≤ +14**. Exceed ⇒ stop and report.

---
## Post-Completion Checklist
- [x] ACs verified (visual deferred to the HAT verification pass, stated)
- [x] flight-log leg entry; leg status `completed`; flight.md leg checked
- [x] Do NOT commit (flight-end review + single commit)
