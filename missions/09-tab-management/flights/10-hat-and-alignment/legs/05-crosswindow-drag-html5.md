# Leg: L5 — crosswindow-drag-html5

**Status**: MOVED TO FLIGHT 11 (not implemented in F10)
**Flight**: [HAT & Alignment](../flight.md)

> **This leg was escalated to its own flight (F11) at design review (operator decision).** The review
> found L5 unsatisfiable as an F10 co-leg: static `draggable=true` fires `pointercancel` and kills the
> document-level pointer reorder/tear-off; the `tearOff`-keyed dynamic toggle is structurally impossible;
> the only paths (full HTML5-DnD rewrite, or modifier-gated `draggable`-at-`pointerdown`) each need a live
> spike (draggable-at-pointerdown timing; drop delivery over the strip's `-webkit-app-region: drag` zone).
> This spec's analysis + the AC defects (payload must be `{wcId,url,title,favicon,container}`; the
> drop-side authority weakening) carry forward as F11's design inputs. **Not built in F10.**

## Objective

HAT feature (T6): drag a tab from one window's strip into **another window's strip** and it moves there,
keeping jar identity + page state — **satisfying mission criterion 8** on the HTML5-DnD transport Station C
measured **GO**. (Not tear-off-into-empty-space-with-cursor-tracking-window — that stays platform-limited.)

## Context

Risk: **HIGH (largest leg).** Design review mandatory. Station C measured a cross-`BaseWindow` HTML5 `drop`
delivers a custom-MIME payload intact (`application/x-goldfinch-tab`, `flight-log.md` Station C).

**THE CENTRAL DESIGN QUESTION (design review must settle before implementation):** the existing reorder/
tear-off drag is **pointer-events based** (`renderer.js` `pointerdown:1262` → doc `pointermove:1551` →
`pointerup:1587`, armed via `shouldArm` at 5px). Making the tab `draggable=true` lets a native `dragstart`
**pre-empt** `pointermove` — which would break in-window reorder/tear-off. The review must choose among:
(a) conditional `draggable` (hard — intent unknown at `dragstart`); (b) replace pointer-drag with HTML5 DnD
for BOTH in-window and cross-window (large rewrite of `armDrag`/`classifyDragPoint`/`commitTabMove` +
`tab-drag-zone.js` + `tab-reorder.md`); (c) parallel opt-in gating (e.g. `draggable` toggled only when the
pointer leaves the strip / a modifier). **Pick the lowest-risk path that does not regress reorder/tear-off;
if none is clean, escalate — this leg may split into its own flight.**

**The target IPC gap (recon):** all existing move IPCs resolve the SOURCE from `event.sender`
(`tab-move-to-new-window:2985`, `tab-move-to-window:3013`, `tab-tear-off:3031` → `getWindowForChrome`). A
drop lands in the **target** window, so `event.sender` is the target and the dragged tab is in a *different*
source window. **A new IPC is needed** — `tab-adopt-by-drop({ wcId, … })` — resolving
`source = registry.getWindowForGuest(payload.wcId)` (`window-registry.js:157`),
`target = registry.getWindowForChrome(event.sender)`, validating `source !== target` and web-not-internal,
then calling the EXISTING **`moveTabIntoWindow(source, p, () => target)`** (`main.js:2842`) — **reuse the
core, do not transcribe** (preserves the DD1 synchrony pin and the row-8a displaced-tab hide). Copy the
authority discipline from `tab-move-to-window` (payload is a *request*; source is registry-resolved, never
trusted from the payload; `main.js:2999–3012`).

**`-webkit-app-region`:** the drop target must be a `no-drag` element (`#tabs`/tab buttons), not the
`#tabstrip` drag background (`styles.css:57/60`).

## Acceptance Criteria

- [ ] **AC0 — coexistence approach chosen at design review and recorded**, with the reason it does not
      regress in-window reorder/tear-off (the central question above). If no clean path exists, **stop and
      escalate to a dedicated flight** rather than ship a reorder regression.
- [ ] **AC1 — tabs are `draggable` with an identity `dragstart`.** On `dragstart`, stash
      `dataTransfer.setData('application/x-goldfinch-tab', JSON.stringify({ wcId, jarId, url }))` and set
      `effectAllowed='move'`; per AC0's chosen coexistence mechanism, in-window reorder/tear-off still work.
- [ ] **AC2 — a strip `drop` handler moves the tab cross-window.** `dragover` (`preventDefault`, gated on the
      custom MIME being in `dataTransfer.types`, `dropEffect='move'`) + `drop` on the target `#tabs`/tab
      buttons reads the payload and calls the new `tab-adopt-by-drop` IPC; a drop from the **same** window is
      a no-op (or an in-window reorder, per AC0).
- [ ] **AC3 — the new `tab-adopt-by-drop` IPC reuses the move core with registry authority.** Source resolved
      via `registry.getWindowForGuest(wcId)`, target via `getWindowForChrome(sender)`; refuse if same window,
      internal/trusted, or the tab no longer exists; on success `moveTabIntoWindow(source, p, () => target)`.
      **Two readings** (masked): source is registry-resolved not payload-trusted (mutate → refuses); the
      handler calls `moveTabIntoWindow` (not a transcription).
- [ ] **AC4 — identity + jar + page state survive the drag** (criterion 8): same `wcId`, jar intact, history
      intact — the move core already guarantees this; the drag is a new *trigger* for it. Runtime proof is the
      verification pass (a rewritten `tab-tearoff.md`/new `cross-window-drag` spec using the **HTML5-DnD**
      transport, NOT synthetic pointer injection — the spec's banner warns synthetic cross-window drag goes
      green in fiction-space; the real HTML5 path is what Station C measured).
- [ ] **AC5 — no reorder/tear-off regression.** `tab-reorder.md`, `tab-tearoff.md` (rows 3–7),
      `tab-drag-zone.test.js`, `tab-drag-invariants.test.js` still pass. Update `tab-tearoff.md`'s
      cross-window-drag banner (it is finally satisfiable — via HTML5 DnD).
- [ ] **AC6 — gates green** (`npm test` delta, `lint`, `typecheck` — standalone).

## Files Affected
- `src/renderer/renderer.js` — `draggable` + `dragstart` on the tab (`:1196`), `dragover`/`drop` on `#tabs`,
  reconciliation with the `pointerdown` reorder (`:1262`) per AC0.
- `src/main/main.js` — new `tab-adopt-by-drop` IPC near the move handlers (`:2985–3037`), reusing
  `moveTabIntoWindow` (`:2842`); preload additions + `renderer-globals.d.ts`.
- `tests/behavior/tab-tearoff.md` — the cross-window-drag banner + drag rows (or a new `cross-window-drag.md`).
- A `main.js` source-scan test for the new-IPC authority pins.

## Line Budget (DD11 — code lines)
- `renderer.js`: **≤ +40** (more if AC0 chooses the rewrite — report). `main.js`: **≤ +30**. Exceed ⇒ stop and report.

---
## Post-Completion Checklist
- [ ] AC0 coexistence decision recorded; ACs verified (runtime deferred to the verification pass)
- [ ] flight-log leg entry; leg status `completed`; flight.md leg checked
- [ ] Do NOT commit (flight-end review + single commit)
