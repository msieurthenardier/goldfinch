# Leg: 02-drag-layer-rewrite

**Status**: completed
**Flight**: [Cross-Window Tab Drag](../flight.md)

> **RE-OPENED (session 2).** The boundary-death investigation ripped the (uncommitted) implementation
> down to a probe6-minimal core; root cause proved environmental (DD5 — Wayland/WSLg, not this code).
> Rebuild in progress on the minimal core per the ACs below, with two deltas: **no tear-off ghost/pill
> calls** (retired — DD4 amend; native drag image is the feedback) and the `viewportRect`/ghost portions
> of AC2/AC3/AC5 read accordingly. Invariants suite is temporarily skipped and gets re-authored +
> unskipped as part of the rebuild.

## Objective

Replace the pointer-based tab-drag machinery with native HTML5 DnD for **in-window reorder + tear-off**
(one gesture, no modifier — DD3), preserving the reorder feel, so Leg 3 can add cross-window drop on the
same gesture. The transport + disambiguation are **spike-validated** (probes 2–4, all GO).

## Context

Risk: **HIGH** — re-litigates the whole reorder/tear-off drag machinery + the `tab-drag-invariants` shape
net. Design in the flight log ("Leg 2 design"), validated by 4 by-hand probes (Q1–Q3 GO, drop GO, dragend
disambiguation GO). Design review before implementation.

**Survives untouched** (pure/reused): `classifyDragPoint`/`isOutsideStrip` (`tab-drag-zone.js`),
`dropIndexFromPointer`/`keyboardMove` (`tab-order.js`), `applyDragDisplacement`/`applyDetachDisplacement`/
`commitTabMove`/`requestTearOff`/`clearDragVisuals`/`trackTearoffGhost`/`clearTearoffGhost`/`pendingDrop`/
`dropSeq` (`renderer.js`), `moveTabIntoWindow`/`tab-tear-off`/the tearoff-overlay handlers/`move-tab-payload.js`
(`main.js`). **`shouldArm`/`DRAG_ARM_THRESHOLD_PX` go DEAD** (native owns arming; the F9 threshold debt is moot).

## Acceptance Criteria

- [x] **AC1 — the pointer drag machinery is removed** (`renderer.js`): the `pointerdown` drag-record
      (`~:1274`), document `pointermove` (`~:1596`), `pointerup` (`~:1634`), `pointercancel` (`~:1656`),
      `armDrag` (`~:1558`). The `drag` session object is replaced by a native `dnd` session.
- [x] **AC2 — tabs are `draggable` with a `dragstart`.** Every tab `btn.draggable=true` at rest (favicon
      `<img>` `draggable=false` so grabbing it drags the tab). `dragstart`: guard `wcId!=null`
      (`e.preventDefault()` else); `setData('application/x-goldfinch-tab', JSON.stringify({wcId,url,title,favicon,container}))`
      (the exact `validateMoveTabPayload`/`requestTearOff` shape); `effectAllowed='move'`;
      **`setDragImage(tab.btn, e.clientX-r.left, e.clientY-r.top)`** (cursor-follow); snapshot
      `startOrder`/`draggedIndex`/`slotRects`/`stripRect`(#tabstrip)
      into `dnd`; `.dragging` class. (The `viewportRect` snapshot was REMOVED by the Leg 2 HAT fix — see AC5.)
- [x] **AC3 — `dragover` on `#tabs` recomputes reorder/tearoff** (near-1:1 with the old `pointermove` body):
      guard the MIME is present; `preventDefault()`; **`dropEffect='move'` (MANDATORY — spike)**;
      `classifyDragPoint(dnd.stripRect, dnd.slotRects, e.clientX, e.clientY, dnd.draggedIndex)`; tearOff zone
      → `.detaching` + `applyDetachDisplacement()` + `trackTearoffGhost` (the L4 pill IPC, unchanged); reorder
      zone → `applyDragDisplacement(index)` on index change. **`#tabs { -webkit-app-region: no-drag }`**;
      **`.tab.dragging { opacity: 0 }`** (the hole — layout-neutral, keeps `slotRects` exact; the dragged
      tab's old `translate` follow is replaced by the native drag image).
- [x] **AC4 — `drop` on `#tabs`: same-window reorder ships; cross-window is the Leg 3 seam.** Set
      `dnd.dropHandled = true` synchronously; parse the payload; **if `payload.wcId === dnd.wcId`** →
      `commitTabMove(dnd.tabId, dnd.currentDropIndex ?? dnd.draggedIndex)` + announce (the old `pointerup`
      commit). **Else (cross-window)** → a documented **`// LEG 3 SEAM: tab-adopt-by-drop`** no-op (Leg 2
      ships only same-window reorder).
- [x] **AC5 — `dragend`: the tear-off gate + cleanup.** `clearDragVisuals()`; `doTearOff =
      !dnd.dropHandled && (dnd.tearOff || releaseZone.zone === 'tearOff')` — the dragover-latched flag
      OR the release-point classification (`classifyDragPoint` on the dragend's window-local
      clientX/clientY; the second HAT fix — the latch alone missed fast boundary exits); **null `dnd`
      synchronously** (the AC5 no-await property);
      `if (doTearOff) requestTearOff(tabId)`. Escape mid-drag (browser aborts → dragend, no drop) folds here:
      preserve the "Move canceled" announcement (armed-only) without `pointercancel`.
      **HAT fix (Leg 2, in-place):** the `releaseInsideViewport = !isOutsideStrip(dnd.viewportRect, …)`
      geometric gate was REMOVED. It was a design error — it conflated a cross-window release (over another
      window) with a tear-off release (over empty desktop), both reading out-of-viewport, and so killed the
      desktop tear-off (fired only unreliably on very fast drags, where `dragend`'s outside-window coordinate
      was stale). Leg 2 ships **no** cross-window drop, so releasing outside the window unambiguously means
      tear-off. Cross-window-vs-tear-off disambiguation moves to **Leg 3**, done main-side (the target's drop
      adopts the tab; the source's tear-off then finds it already gone), backstopped by `pendingDrop` freshness
      + `no-tab` idempotence — NOT via viewport geometry.
- [x] **AC6 — reorder + tear-off unregressed (HAT + unit).** The pure model is unchanged; the invariant
      re-authoring (AC7 below) pins the new shape; the live reorder/tear-off feel is the operator's HAT verify
      (the automated `dragPointer` instrument goes inert — Leg 4 dispositions it; NOT green-washed).
      *(Rebuild session HAT verdict: reorder feel PASS; tear-off PASS [release-over-content detaches —
      Chrome parity]; favicon-grab PASS; Escape-cancel = Wayland platform boundary, recorded as a DD5
      extension in flight.md.)*
- [x] **AC7 — re-author `tab-drag-invariants.test.js`** (load-bearing shape net): AC5 anchor
      `pointerup`→`dragend` (assert `dnd` nulled synchronously + the `dropHandled`/`tearOff`
      gate — the `releaseInsideViewport` gate was removed by the Leg 2 HAT fix, see AC5); AC7 re-count/re-name
      the `cancelDrag` sites (pointercancel removed); DD16 anchor
      `pointermove`→`dragover` (still `clientX/clientY`, never `screenX`). `tab-order.test.js`/
      `tab-drag-zone.test.js` unchanged (retire or document the dead `shouldArm` cases).
- [x] **AC8 — gates green** (`npm test` delta, `lint`, `typecheck` — standalone).

## Out of Scope
- Cross-window drop-adopt (the `tab-adopt-by-drop` IPC + authority ruling) — **Leg 3** (AC4's seam).
- The behavior-spec apparatus switch (HAT vs CDP) — **Leg 4**.

## Files Affected
- `src/renderer/renderer.js` (the drag rewrite), `src/renderer/styles.css` (`#tabs` no-drag, `.tab.dragging` opacity).
- `test/unit/tab-drag-invariants.test.js` (AC5/AC7/DD16 re-author). `src/shared/tab-drag-zone.js` (retire `shouldArm`?).
- `src/main/*` — **unchanged** (Leg 2).

## Line Budget (DD11 — code lines)
- `renderer.js`: **net small** (removes the pointer machine, adds the DnD handlers — report net). `styles.css`: **≤ +4**.
  Exceed the intent (a bloated rewrite) ⇒ stop and report.

---
## Post-Completion Checklist
- [x] ACs verified (invariants re-authored; operator HAT passed — see AC6 verdict)
- [x] flight-log leg entry (rebuild entry + HAT verdict appended); leg `landed`; flight.md leg checked
- [ ] Do NOT commit (flight-end review + single commit)
