# Flight Log: Cross-Window Tab Drag

**Flight**: [Cross-Window Tab Drag](flight.md)

## Summary

Build the cross-window tab drag gesture on the HTML5-DnD transport F10 Station C measured a GO. Spike-first:
the coexistence of HTML5 `draggable` with the existing pointer-based reorder/tear-off is the make-or-break
unknown (L5 review), measured by Leg 1 before any build.

---

## Flight Director Notes

- **Branch/stack:** `flight/11-cross-window-drag` off the F10 head; stacks on `flight/10`.
- **Design input:** the L5 design-review analysis (F10 `legs/05-crosswindow-drag-html5.md`) — the coexistence
  problem, the `tab-adopt-by-drop` IPC, the payload shape, the authority ruling.
- **Leg 1 = spike, operator-run (key-free).** A throwaway Electron probe (`/tmp/gf-probe2.js`, wrapper
  `/tmp/gf-probe2.sh`) measures Q1 (draggable-at-pointerdown initiates a native drag?), Q2 (drop delivers over
  the `-webkit-app-region: drag` strip?), Q3 (pointercancel fires?). No MCP/admin key — same by-hand pattern
  as Station C.

---

## Leg Progress

### Leg 1 — transport-spike (running)
**probe2 results (operator drag):**
- **Q1 → GO (the make-or-break).** `[A] dragstart FIRED` — setting `draggable` DURING `pointerdown`
  initiates a native drag on that same gesture. **Option (c) modifier-gated draggable is VIABLE** — the
  in-window pointer reorder stays untouched; only a modified press upgrades to a native cross-window drag.
  No full rewrite needed.
- **Q2 → `dragover` delivers over BOTH the app-region:drag band and the no-drag button** (cross-window
  motion tracking works).
- **Q3 → `pointercancel` did NOT fire** (no `[A] pointercancel`/`pointerup`). The native drag silently
  swallows the pointer stream ⇒ the impl must **explicitly reset the pointer-drag record in `dragstart`**,
  not rely on `pointercancel`.
- **⚠ NO `drop` fired; `dropEffect=none`.** Unlike Station C's plain-body probe (drop fired), the
  app-region-instrumented target got no drop. The new variable is `-webkit-app-region` on the target —
  either the drag zone swallows the release (window-move) or the release landed off the no-drag button.
  → **probe3** (two big zones: PLAIN vs APP-REGION:DRAG) disambiguates.
- **Native drag image looked good visually** (operator) — confirms DD4 (the OS-native ghost crosses window
  bounds, covering the out-of-window feedback F10's window-clipped pill could not).

---

**probe3 results (drop disambiguation) — FULL GO:**
- `[B] [PLAIN] drop payload="probe3"` **and** `[B] [APP-REGION] drop payload="probe3"` — **drop delivers
  over BOTH surfaces, payload intact.** The app-region:drag zone does NOT block the drop.
- **probe2's no-drop was the missing `dropEffect`**: probe3's `dragover` sets `e.dataTransfer.dropEffect='move'`,
  reconciling `effectAllowed='move'` so the drop is accepted. **F11 impl note: the strip `dragover` handler
  MUST set `dropEffect='move'` or the drop is silently rejected.**
- Source `dragend dropEffect=none` even on a successful drop is a known cross-window quirk → the move is
  **target-driven** (the drop handler fires `tab-adopt-by-drop`); the source never learns the outcome and
  doesn't need to (matches DD1).

**Spike verdict: GO on option (c).** Q1 GO, Q2 GO (with `dropEffect`), Q3 (reset pointer-drag in `dragstart`).
Transport + coexistence + drop all de-risked. Native drag image crosses window bounds (DD4 confirmed).

## Decisions

### DD3 (coexistence) — the operator UX fork (raised; not yet locked)
The spike proved BOTH paths are mechanically viable. The remaining choice is UX vs. effort:
- **(c) modifier-gated** *(lower risk)*: plain drag = pointer reorder/tear-off **unchanged**; **modifier**+drag
  = native cross-window drag. Preserves the live-transform reorder exactly; small, low-risk. **But needs a
  modifier key** (not Chrome-parity; a plain drag can't become native mid-gesture — Q1 requires committing at
  `pointerdown`, and once native starts the pointer reorder is dead, Q3).
- **(b) unified rewrite** *(Chrome-parity, larger)*: ALL tab drags become native HTML5; reorder recomputed
  from `dragover` (classifyDragPoint stays pure math); cross-window via drop-in-other-window. One gesture, no
  modifier — but ~+100/−80 rewrite re-litigating `tab-reorder`/`tab-drag-zone`/`tab-tearoff`, and the live
  transform-follow reorder degrades to the native ghost.
→ **operator decides the UX** (modifier acceptable vs. Chrome-parity worth the rewrite).

**DD3 LOCKED (operator): option (b) — unified / Chrome-parity rewrite.** All tab drags become native HTML5
DnD: one gesture for reorder + tear-off + cross-window, no modifier. The live transform-follow reorder is
replaced by a **custom drag image** (`setDragImage`) to preserve the feel; reorder drop-index recomputed from
`dragover` (`classifyDragPoint` stays pure window-local math); tear-off = drag-end with no in-strip/other-window
drop; cross-window = drop in another window's strip → `tab-adopt-by-drop`. Re-litigates `tab-reorder`,
`tab-drag-zone.test.js`, `tab-drag-invariants.test.js`, `tab-tearoff`. **Spike Leg 1 COMPLETE (GO).**
Next: recon + design the rewrite (Leg 2) before any code.

**Hard impl notes from the spike (carry into the rewrite):** (1) the strip `dragover` handler MUST set
`e.dataTransfer.dropEffect='move'` or the drop is silently rejected (probe2 vs probe3); (2) the move is
target-driven (drop handler → IPC), the source's `dragend.dropEffect` reads `none` even on success; (3) no
`pointercancel`/pointer stream to manage anymore (all native) — the old pointer machinery is REMOVED, not
gated.

**probe4 — dragend disambiguation CONFIRMED (GO).** Same-window release: `dragend clientX=201 innerW=440 →
releaseInsideViewport=TRUE`. Cross-window release over window B: `[B] drop received` AND `dragend
clientX=711 innerW=440 → releaseInsideViewport=FALSE`. The cross-window `dragend` clientX runs **past** the
source viewport's right edge → the geometric `!dropHandled && tearOff && releaseInsideViewport` gate fires no
tear-off on the source; the drop is handled target-side. Window-local, DD16-clean. **All 4 unknowns GO — the
rewrite design is validated. Leg 1 (spike) fully complete.**

## Leg 2 design (recon+design agent) — the validated rewrite

- **Survives:** `classifyDragPoint`/`dropIndexFromPointer`/`keyboardMove`/`isOutsideStrip` (pure, window-local).
  `applyDragDisplacement`/`applyDetachDisplacement`/`commitTabMove`/`requestTearOff`/`clearDragVisuals`/
  `trackTearoffGhost`/`clearTearoffGhost`/`pendingDrop`/`dropSeq` — reused unchanged. **`shouldArm`/
  `DRAG_ARM_THRESHOLD_PX` go DEAD** (native owns arming) — retires the F9 threshold debt as moot.
- **Remove:** the pointer state machine (`pointerdown` drag-record, document `pointermove`/`pointerup`/
  `pointercancel`, `armDrag`).
- **Add:** tabs `draggable=true` at rest (favicon `draggable=false`); a `dnd` session object; `dragstart`
  (identity payload + `setDragImage` for cursor-follow + snapshot), `dragover` on `#tabs` (`preventDefault` +
  `dropEffect='move'` + `classifyDragPoint` → reorder-preview / tearOff-pill, near-1:1 with the old
  `pointermove` body), `drop` on `#tabs` (same-window → `commitTabMove`; cross-window → **Leg 3 seam**),
  `dragend` (the disambiguation gate → `requestTearOff` or cleanup). `#tabs { -webkit-app-region: no-drag }`;
  `.tab.dragging { opacity: 0 }` (the hole; layout-neutral, keeps slotRects exact).
- **Re-author (mechanical, load-bearing):** `tab-drag-invariants.test.js` AC5 (pointerup→dragend anchor),
  AC7 (cancelDrag-site count, pointercancel removed), DD16 (pointermove→dragover anchor). `tab-order.test.js`/
  `tab-drag-zone.test.js` unchanged.
- **Apparatus (Leg 4 decision):** `dragPointer`/`sendInputEvent` can't initiate native DnD → the reorder/
  tear-off/cross-window GESTURES go HAT-tier; handler logic stays unit-pinned; a synthetic DragEvent test must
  NOT green-wash the native transport (`tab-tearoff` warning).

## Leg 2 — Implementation (drag-layer-rewrite)

The validated design shipped verbatim: the pointer state machine is gone, native HTML5 DnD
owns reorder + tear-off, and the `tab-drag-invariants` shape net was re-authored to the new anchors.

**Removed (the pointer machine):** the per-tab `pointerdown` drag-record; the document-level
`pointermove`/`pointerup`/`pointercancel` listeners; `armDrag`; the `drag` session object; the
`suppressClickActivate`/`markClickSuppressed` click-suppression flag (native DnD fires no
trailing `click` after a completed drag, so the click listener's activate is now unconditional);
`shouldArm`/`DRAG_ARM_THRESHOLD_PX` (retired from `tab-drag-zone.js` — native owns arming, the
F9 threshold debt is moot).

**Added (native DnD):** `btn.draggable = true` at rest + favicon `<img draggable="false">`.
A `dnd` session `{tabId, wcId, draggedIndex, startOrder, slotRects, stripRect, viewportRect,
currentDropIndex, tearOff, dropHandled}`. Four handlers:
- **`dragstart`** (per-tab): `wcId!=null` guard (`preventDefault` else); `activateTab` (Chrome
  parity); `setData('application/x-goldfinch-tab', …{wcId,url,title,favicon,container})` — the
  EXACT `validateMoveTabPayload`/`requestTearOff` shape; `effectAllowed='move'`;
  `setDragImage(btn, e.clientX-r.left, e.clientY-r.top)`; snapshots startOrder/slotRects/
  stripRect(#tabstrip)/viewportRect(0,0,innerWidth,innerHeight).
- **`dragover`** (document — see disambiguation): MIME guard, `preventDefault`, `dropEffect='move'`
  (MANDATORY per probe3), `classifyDragPoint` → tearOff (`.detaching`+`applyDetachDisplacement`+
  `trackTearoffGhost`) / reorder (`applyDragDisplacement` on index change). Near-1:1 with the old
  `pointermove` body MINUS the arm threshold and MINUS the dragged-tab `translate`.
- **`drop`** (`#tabs`): `dnd.dropHandled=true` synchronously; parse payload;
  `payload.wcId === dnd.wcId` → `commitTabMove` + reorder announce; else the `// LEG 3 SEAM:
  tab-adopt-by-drop` no-op.
- **`dragend`** (per-tab): `releaseInsideViewport = !isOutsideStrip(viewportRect, e.clientX,
  e.clientY)`; `clearDragVisuals()`; `doTearOff = !dropHandled && tearOff && releaseInsideViewport`;
  `dnd = null` SYNCHRONOUS; `if (doTearOff) requestTearOff(tabId)` else the armed-only
  `Move canceled` announce.

**REUSED UNCHANGED:** `classifyDragPoint`/`isOutsideStrip` (the latter PROMOTED to a public
export — `dragend`'s release-inside test calls it directly now), `applyDragDisplacement`/
`applyDetachDisplacement`/`commitTabMove`/`requestTearOff`/`clearDragVisuals`/`trackTearoffGhost`/
`clearTearoffGhost`/`pendingDrop`/`dropSeq`, and all of `main.js`. The `applyDrag*`/`cancel` bodies
were mechanically retargeted `drag`→`dnd` (logic identical). The six defensive cancels
(createTab/closeTab/onAdoptTab/onTabMovedAway/resize/Escape) retarget to `cancelDnd` (null `dnd`
+ clear + announce).

**DISAMBIGUATION — `dragover` is DOCUMENT-level, not `#tabs`.** The AC/design phrasing "dragover
on #tabs" names the reorder/drop SCOPE; the LISTENER must be document-level (exactly where the old
`pointermove` sat) because tear-off detection needs pointer points OUTSIDE `#tabstrip`, and `#tabs`
⊂ `#tabstrip` — a `#tabs`-scoped `dragover` would feed `classifyDragPoint` only in-strip points and
could NEVER return `tearOff`. `drop` stays on `#tabs` (the no-drag drop target; `#tabstrip`'s
app-region:drag background cannot receive it). This is the only functionally-correct wiring and is
the literal near-1:1 map of the document-level `pointermove`. **Escape edge (noted, not green-washed):**
mid-drag Escape aborts the native drag into `dragend` (keydown is not dispatched during the native
drag loop, so the retained Escape keydown listener is defensive-only); the geometric gate then
governs, so an Escape while the pointer sits in the tear-off zone tears off rather than cancels —
a known limitation of the pure-geometric disambiguation (native `dragend` cannot distinguish
cancel from a no-target release; `dropEffect` reads `none` for both, per probe3). Reorder-zone
Escape announces `Move canceled` correctly.

**Drag-image approach:** `setDragImage(btn, …)` captures the tab bitmap at end-of-`dragstart`
dispatch while it is still opaque; `.dragging { opacity:0 }` (the layout-neutral hole) is added on
the NEXT frame (`requestAnimationFrame`) so the capture is the visible tab, not the hole. The
dragged tab no longer tracks via `translate` — the OS-native image is the cursor-follow (DD4,
crosses window bounds).

**Invariant re-authoring (`tab-drag-invariants.test.js`, load-bearing):**
- AC5: anchor `document 'pointerup'` → `btn 'dragend'`; asserts `dnd` nulled synchronously (no
  `async`/`await`), the `doTearOff = !dnd.dropHandled && dnd.tearOff && releaseInsideViewport` gate
  and `releaseInsideViewport = !isOutsideStrip(` are present, and `dnd = null` precedes
  `requestTearOff`.
- AC7: `cancelDrag`→`cancelDnd`, count SEVEN→SIX (pointercancel site removed); the six sites
  re-named/re-located (createTab/Escape/resize/closeTab/adopt-tab/tab-moved-away), plus a new
  assertion that no `pointercancel` listener survives; the `!dnd`-gate + no-`pendingDrop` property
  preserved.
- DD16: anchor `pointermove`→`dragover`, mutation targets `drag.draggedIndex`→`dnd.draggedIndex`
  on the `e.clientX, e.clientY, dnd.draggedIndex);` line — the `e.screenX` / `screen`-module
  controls still fire (real→0, mutated→2 and →1). Handlers read `e.clientX`/`e.clientY` only.
- `tab-drag-zone.test.js`: the 5 dead `shouldArm` cases retired; 3 `isOutsideStrip` cases added
  (now a public export the renderer's `dragend` depends on).

**`shouldArm` disposition:** RETIRED (not left dead-with-note) from `tab-drag-zone.js` along with
`DRAG_ARM_THRESHOLD_PX` and their test cases — native owns arming.

**FEEL is the operator's HAT verify.** The live reorder/tear-off feel is NOT automatable here:
`dragPointer`/`sendInputEvent` cannot initiate a native HTML5 drag, so the synthetic-gesture
instrument is INERT (Leg 4 dispositions it — it must NOT be green-washed with a synthetic
`DragEvent` that bypasses the native transport). Handler logic is unit-pinned; the gesture is
owed to HAT.

**Gate delta (standalone):** `npm test` **1963 pass** (baseline 1965; −2 = retired 5 `shouldArm`
cases, added 3 `isOutsideStrip` cases). `npm run lint` clean. `npm run typecheck` clean.
**DD11 line delta:** `renderer.js` net **−7 code lines** (+3 raw incl. comments — a true rewrite,
not bloat); `styles.css` net **−3** (`#tabs` no-drag +1; `.tab.dragging` collapsed 4-decl
translate-follow → 1-decl `opacity:0`); well within `≤ +4`. `src/main/*` untouched.

---

## Anomalies

_(appended as they arise)_

### Leg 2 fix (HAT) — the `releaseInsideViewport` tear-off gate was a design error

Operator HAT surfaced it: **tear-off to empty desktop did not work.** Dragging a tab out of the
window and releasing over empty space did NOT spawn a new window — except unreliably on very fast
drags. Root cause: `dragend` gated tear-off on `doTearOff = !dnd.dropHandled && dnd.tearOff &&
releaseInsideViewport`, where `releaseInsideViewport = !isOutsideStrip(dnd.viewportRect, e.clientX,
e.clientY)`. That viewport gate was meant to pre-stage Leg 3's cross-window disambiguation, but it
**conflated two distinct outside-viewport releases**: a cross-window release (over another window —
don't tear off) and a tear-off release (over empty desktop — SHOULD tear off). Both read
outside-viewport, so the gate wrongly killed the desktop tear-off. The speed-dependence was the
tell: `dragend`'s coordinate is unreliable once the cursor is outside the window, so only a fast
drag occasionally left a stale in-viewport reading that let the tear-off through.

**Correction (in-place on the uncommitted Leg 2 changes):** the viewport heuristic is REMOVED.
Leg 2 ships **no** cross-window drop (AC4's else-branch is a documented seam), so releasing outside
the window is unambiguously a tear-off — the gate is now simply `doTearOff = !dnd.dropHandled &&
dnd.tearOff`. The `viewportRect` snapshot (session construction + typedef) and the now-unused
`isOutsideStrip` import were removed with it; `dragend`'s `e` param is unused and dropped.
Tear-off-vs-cross-window disambiguation **moves to Leg 3, done main-side**: the target window's drop
adopts the tab, and the source's tear-off then finds the tab already gone via the `pendingDrop`
freshness + `no-tab` idempotence backstop — geometry was never the right instrument for it. DD16
still holds (a coordinate read was REMOVED, none added). `tab-drag-zone.js`'s `isOutsideStrip` export
and its zone tests are untouched (still a valid pure function).

`tab-drag-invariants.test.js` AC5 re-pinned: the gate is now asserted as `!dnd.dropHandled &&
dnd.tearOff` with negative pins that `releaseInsideViewport`/`isOutsideStrip` are absent from
`dragend`, plus inline discrimination (re-introducing the viewport gate, or dropping the guard,
both fail the pin). Leg spec AC5/AC2/AC7 text corrected to match.

### DRAGDIAG instrumentation (temporary — MUST be removed before Leg 2 commits)

Diagnosing why tear-off-to-empty-desktop does not fire in the real app (a probe proved `dragend`
DOES fire over the empty desktop, yet the real drag out to the desktop spawns no window).
Hypothesis: the guest `WebContentsView` occludes the chrome, so `dnd.tearOff` never flips true (or
`dnd` is cleared) before `dragend` as the cursor crosses the web page on its way out. Added
TEMPORARY `console.log('[DRAGDIAG] …')` lines to `src/renderer/renderer.js`'s native-DnD handlers
so the live drag state is visible in the dev console: `dragstart` (session tabId + stripRect), the
document `dragover` handler (raw zone every entry, plus tearOff true/false transitions), the
`dragend` handler (dnd state logged BEFORE the `if (!dnd) return` guard — the handler's `e` param
was re-added solely to log the release coordinates), and `cancelDnd` (to catch a defensive
mid-drag null-out). No drag logic changed — logs only; `npm run lint` + `npm run typecheck` stay
clean. Every line is `[DRAGDIAG]`-prefixed (greppable) and MUST be removed (and the `dragend` `e`
param dropped again) before this leg commits.

### Root cause found — resize→cancelDnd race (Heisenbug), and the fix

The DRAGDIAG round exposed the real mechanism, and it was NOT the WebContentsView-occlusion
hypothesis above. Tear-off to empty desktop was UNRELIABLE — it fired on a fast drag but not a
slow one, and ADDING logging made it fire even slow. That timing-dependence is the signature of a
race. Root cause: `window.addEventListener('resize', () => { if (dnd) cancelDnd(); });` (the cheap
"resize invalidates the slotRects snapshot" defense). On WSLg, a SPURIOUS `resize` fires when the
drag cursor crosses the window boundary on its way to the desktop; that handler calls `cancelDnd()`,
RACING the `dragend` handler. When resize/cancel wins, `dnd` is nulled and `dragend`'s tear-off
never fires; when `dragend` wins (fast drag, or a drag slowed just enough by the extra console.log
work), the tear-off fires. Hence fast-works / slow-fails / logging-fixes-it.

Fix: the `resize→cancelDnd` defense is OBSOLETE under native HTML5 DnD. A native drag captures the
pointer, so the user cannot manually resize the window mid-drag — the only mid-drag resize is the
spurious compositor event, which must NOT cancel. REMOVED the `resize→cancelDnd` listener (comment
left in its place). `test/unit/tab-drag-invariants.test.js` AC7 re-anchored: cancelDnd() call-site
count SIX → FIVE, the `resize` entry dropped from the enumeration, the +1 mutation re-anchored onto
the surviving Escape keydown listener (grafts a fabricated `blur` cancel site), and a new negative
assertion pins that no `resize`→cancelDnd listener reappears (a log-only `resize` listener is fine).

DRAGDIAG state after this fix (STILL TEMPORARY — remove in the final cleanup pass once the operator
confirms the slow-drag tear-off): kept `dragstart`, `dragend`, `cancelDnd`; REMOVED the chatty
`dragover` zone/tearOff-transition logs to cut noise; ADDED one temporary LOG-ONLY `resize` listener
(`[DRAGDIAG] RESIZE event fired …`, never cancels) to confirm on the live run that a spurious resize
does fire on cursor-exit. Remaining `[DRAGDIAG]` lines to remove in final cleanup: `dragstart` (~1311),
`dragend` (~1326, and drop the re-added `e` param), `cancelDnd` (~1596), and the log-only `resize`
listener (~1680).

---

## ★ SESSION HANDOFF STATE (context limit reached mid-Leg-2 verification)

**Leg 2 (drag-layer HTML5 rewrite) is functionally DONE and the tear-off is VERIFIED WORKING LIVE.**

**Two HAT fixes applied on top of the rewrite (both operator-driven):**
1. Removed the `resize → cancelDnd` handler (a red herring — RESIZE never fired on cursor-exit — but
   correct to remove: obsolete under native DnD). AC7 count updated 7→6→(→5 after cleanup).
2. **The real fix — release-point tear-off classification.** `dragend` now computes
   `releaseZone = classifyDragPoint(dnd.stripRect, dnd.slotRects, e.clientX, e.clientY, dnd.draggedIndex)`
   and gates `doTearOff = !dnd.dropHandled && (dnd.tearOff || releaseZone.zone === 'tearOff')`. Fixes the
   fast-window-exit gap where the dragover-latched `tearOff` flag missed (last dragover landed in the
   reorder zone before the cursor left). DD16-clean (window-local clientX/clientY).

**LIVE VERIFICATION (operator, dev build):** reorder ✓; tear-off to empty desktop ✓ — 4 consecutive
desktop releases (above/left/below the window) all `tearOff=true` → `requestTearOff CALLED` →
`tabTearOff RESULT={ok:true, windowId:2..5}`. Windows created every time. The "requestTearOff-but-no-window"
worry is resolved: main creates the window (`ok:true`). Tear-off is solid.

**⚠ IMMEDIATE NEXT STEP — strip the TEMPORARY `[DRAGDIAG]` logging from `src/renderer/renderer.js`:**
- `dragstart` log (~L1311), `dragend` log (~L1326 — but KEEP the `e` param: the release-point fix now
  genuinely uses `e.clientX/clientY`), `cancelDnd` log (~L1610), the log-only `resize` listener (~L1692-1694),
  `requestTearOff CALLED` (~L1705), `tabTearOff RESULT` (~L1711). `grep '\[DRAGDIAG\]' src/renderer/renderer.js`
  finds them all. Removing the `cancelDnd` DRAGDIAG log **self-heals the 1 currently-failing test**
  (AC7-test-3: `cancelDnd` early-returns on `!dnd` — the log sits between `{` and the guard).
- After stripping: `npm test` should return to full pass; then remove the DRAGDIAG notes from this flight log.

**THEN (Leg 2 close-out):** flight-end review of the Leg 2 diff → single commit (all F11 Leg 1 spike record +
Leg 2 rewrite + fixes). Uncommitted files on `flight/11-cross-window-drag`: `renderer.js`, `styles.css`,
`tab-drag-zone.js` (shouldArm retired, isOutsideStrip exported), `tab-drag-invariants.test.js` (AC5/AC7/DD16
re-authored), `tab-drag-zone.test.js`, + this flight dir.

**THEN Leg 3 (cross-window-drop-adopt):** implement the `// LEG 3 SEAM: tab-adopt-by-drop` in `renderer.js`'s
`#tabs` `drop` handler → new `tab-adopt-by-drop({wcId,url,title,favicon,container})` IPC in `main.js`
(source via `registry.getWindowForGuest(payload.wcId)`, target via `getWindowForChrome(sender)`, reuse
`moveTabIntoWindow(source, p, () => target)`); the DD2 authority ruling (payload-wcId source is a real
weakening — accept for single-user desktop or provenance-gate). Cross-window release currently classifies as
tearOff → tears off; Leg 3 reconciles main-side (target adopts; source tear-off finds tab gone via
pendingDrop/no-tab backstop). **THEN Leg 4** (HAT verification — the drag gesture is inert to `dragPointer`
automation; rewrite `tab-tearoff`'s cross-window-drag banner; owed row 8a). Then flight-end + debrief.

**Mission-wide status:** F9 shipped (session restore, PR+debrief). F10 shipped (HAT: 5 alignment fixes +
overlay-view primitive + debrief; a11y/behavior gauntlet owed to the operator's clean rig; T7 context-menu
item recorded). F11: transport measured GO (4 by-hand probes), Leg 2 rewrite done+verified, Leg 3/4 pending.
Standing carry from F10: the key-print discipline ("never print a key-bearing stream"). Probes at
/tmp/gf-probe{2,3,4,5}.{js,sh} (throwaway, key-free).

---

## ⟲ PIVOT (2026-07-16, session 2): Leg 2 re-opened for a clean rewrite

**The prior "LIVE VERIFICATION … Tear-off is solid" entry above is OVERTURNED.** It read the
boundary-exit `dragend` coordinates (`-10`, `-9`, edges) as successful desktop releases. They were
not. Corrected diagnosis below. The entry is kept as-is for the record, not edited in place.

### Corrected diagnosis (measured, session 2)

1. **The drag is CANCELED at the window edge, not completed.** Operator confirmation, decisive: on the
   failing gesture *the mouse was never released* — `dragend` fires on its own the instant the cursor
   crosses the window boundary (`dropEffect=none`), and our release-point classifier then reads the
   edge coordinate as "tear off," spawning a window at the boundary. So a torn-off window can never
   follow the cursor onto the desktop, and — the real cost — **cross-window drop only works when the
   windows overlap** (criterion 8's normal, non-overlapping case is impossible while the drag dies at A's edge).

2. **The transport is fine; the earlier spike was insufficient.** The F10 Station C spike and probes
   2–5 were all **single-view** windows. `/tmp/gf-probe6.js` reproduces Goldfinch's real structure — a
   multi-view window A (chrome child view **+** guest child view) and a **separate, non-overlapping**
   window B. Result: the HTML5 drag **survives to true desktop release** (`dragend` at `1060,108` /
   `948,544` / `1184,648` — hundreds of px outside A) **and** window B receives `dragenter → dragover →
   DROP` across a gap of bare desktop. So multi-view is NOT the cause; a faithful minimal HTML5-DnD
   setup delivers exactly the Chrome-parity behavior we want.

3. **The killer is a Goldfinch-only mid-drag DOM/view operation that probe6 omits.** Disabling the
   tear-off ghost (`trackTearoffGhost`/`clearTearoffGhost`, the mid-drag `addChildView` — a
   `[TEMP-DIAG]` comment-out) did **not** stop the boundary-cancel. Remaining suspects, all present in
   Goldfinch and absent from probe6: the custom `setDragImage(btn, …)` (renderer.js ~L1289), the
   `.dragging { opacity:0 }` applied to the source element next-frame (~L1312), and the sibling
   `transform` displacement (`applyDragDisplacement`/`applyDetachDisplacement`).

### Decision (operator, session 2): rip out the current drag layer and rewrite clean

Rationale: the current implementation has accreted three debug rounds on a design founded on the
insufficient single-view spike. Cheaper to rebuild from the probe6-proven baseline than to keep
bisecting the patched version. Leg 2's acceptance is superseded by the rewrite below; the leg is
re-opened (status → in-flight).

### Rewrite plan — minimal-first, survival-gated in the real app (the increments ARE the bisection)

1. **Rip out** the whole current drag layer: the `dnd` session + `dragstart`/`dragover`/`drop`/`dragend`,
   `applyDragDisplacement`/`applyDetachDisplacement`, `trackTearoffGhost`/`flushTearoffGhost`/`clearTearoffGhost`,
   `cancelDnd`, `setDragImage`, `.dragging`/`.detaching` CSS. Remove the `[TEMP-DIAG]` + `[DRAGDIAG]` scaffolding.
2. **Minimal core = probe6 in-app:** tabs `draggable`; `dragstart` sets only the identity MIME +
   `effectAllowed='move'` (NO custom drag image); `document` `dragover` `preventDefault()` +
   `dropEffect='move'`; `dragend` tears off when released outside the strip. **Operator verifies the
   drag survives to the desktop in the real app** before anything else is added.
3. **Add back one feature at a time, re-verifying desktop-survival after each:** reorder displacement →
   tear-off feedback (per DD4 the native drag image is the out-of-window feedback; the F10 pill overlay
   is redundant here and is the leading killer suspect via mid-drag `addChildView`) → Leg 3 cross-window
   drop. The addition that breaks survival is the killer, caught in the real environment.

Process: Flight Director designs each increment; a spawned Developer implements; operator's live
desktop-survival check is the per-increment acceptance gate. Recorded here per the scope-change protocol.

### ROOT CAUSE FOUND (session 2, probes 7–10 + wayland relaunch): the ozone backend, not the code

The rip-out to the minimal probe6-shaped core did NOT fix the boundary-death — and successive
fidelity probes exonerated every structural suspect: guest-view-on-top (probe7 survives), frameless
(probe8 survives), many hidden guest views (probe9 survives), real `file://` chrome + Goldfinch's
exact webPreferences (probe10 survives). All prior probes launched bare `electron` = **X11/XWayland**.

**The decisive run: the SAME probe10 relaunched with `--ozone-platform=wayland`** (the flag
`scripts/dev-launch.mjs` adds to every `npm run dev` — the M05 F8 Leg-6 fix for the WSLg X11
first-click-swallow defect) **reproduces the death exactly**: dragend at `705,604` (bottom edge +4)
and `908,296` (right edge +8) with no mouse release, vs X11's true desktop releases at `802,1057` /
`1076,1075`. Launcher mirror at `/tmp/gf-probe10-wayland.mjs` (uses the app's own
`decideOzonePlatform`).

**Mechanism:** under WSLg RAIL there is no desktop Wayland surface. When the drag cursor leaves all
surfaces of the session, the compositor cancels the Wayland DnD session → Chromium fires `dragend`
at the boundary. Over another window (a live surface) the drag survives — matching the operator's
overlapping-windows observation. `text-input-v3 not available` in the operator's earlier log was the
Wayland fingerprint.

**Implications:**
- The drag layer code (old OR new) was never the defect; the environment is. The F10 Station C GO
  and probes 2–6 measured the WRONG BACKEND (bare electron = X11). Lesson recorded: a spike must
  replicate the app's real launch flags (ozone backend), not just its window/view structure.
- On the WSLg dev rig under Wayland: tear-off-to-desktop will always terminate at the window edge
  (spawn-at-boundary), and cross-window drag works only when windows overlap (the cursor never
  leaves a surface). This is an ENVIRONMENT boundary, not an app bug.
- Packaged targets (native Windows/macOS/Linux desktops) do not run WSLg RAIL; dev-launch.mjs is
  dev-only by design. Expectation (unverifiable on this rig): full Chrome-parity behavior there,
  as measured on the X11 probes.
- Switching dev back to X11 would restore drag-survival but re-introduce the measured
  first-click-swallow defect that Wayland was chosen to fix (M05 F8). Trade-off is the operator's.

### Flight Director Notes — operator rulings on the root cause + rebuild plan (session 2)

**Operator decisions:**
1. **DD5 locked — keep Wayland, accept the boundary.** Daily dev stays on `--ozone-platform=wayland`
   (the M05 F8 first-click fix is preserved). Accepted rig behavior: tear-off spawns the new window at
   the cursor's window-exit edge; cross-window drag requires the windows to overlap along the drag
   path. Ad-hoc full-parity verification: `npm run dev -- --ozone-platform=x11` (dev-launch already
   honors a caller flag; no code change).
2. **Rebuild the stripped polish on the minimal core, then Leg 3.** The rip-out (increment 1) stays as
   the new base — the killed features were exonerated, but the minimal core is cleaner and probe-proven.
   Rebuild = increment A: setDragImage + `.dragging` hole + classifyDragPoint dragover zones +
   reorder/detach displacement + same-window drop commit + release-point dragend; re-author and unskip
   `tab-drag-invariants.test.js`. The tear-off ghost pill is NOT rebuilt (retired — DD4's native drag
   image is the out-of-window feedback; the overlay primitive stays in main for other consumers).
   Then Leg 3 (cross-window drop-adopt, HIGH risk → design review), operator HAT with overlapping
   windows (criterion 8), flight-end review, single commit, draft PR.

Execution per plan file (approved by operator). Increment A spawn: Developer, working dir goldfinch.

### Increment A — the in-window polish rebuilt on the minimal core (Developer, session 2)

The stripped polish is back on the probe6-proven minimal core, per the DD5 ruling and the DD4 amend
(NO ghost pill — the native drag image is the only out-of-window feedback). Files:
`src/renderer/renderer.js`, `src/renderer/styles.css`, `test/unit/tab-drag-invariants.test.js`.

- **`dragstart`**: `setDragImage(btn, e.clientX-r.left, e.clientY-r.top)` (cursor-follow) +
  `releaseTabWidths()` + the full session snapshot (`startOrder`/`draggedIndex`/`slotRects`/
  `stripRect`/`currentDropIndex`/`tearOff` join the minimal `{tabId,wcId,dropHandled}`; typedef
  updated; NO `viewportRect` — stays dead per the HAT fix). The `.dragging` opacity hole is added
  next-frame (rAF) so the drag-image capture sees the opaque tab.
- **Displacement pair rebuilt** to the documented semantics (exact non-uniform-width deltas off the
  dragstart slotRects; `applyDetachDisplacement = applyDragDisplacement(startOrder.length-1)`), plus
  `orderedTabEls()`/`clearDragVisuals()`. `cancelDnd()` clears visuals before nulling.
- **`dragover` (document-level)**: `classifyDragPoint` zone recompute — tearOff latch → `.detaching`
  + close-ranks; reorder → displacement on index change. No pill calls.
- **`drop` (#tabs)**: same-window payload (`payload.wcId === dnd.wcId`) commits
  `commitTabMove(tabId, currentDropIndex ?? draggedIndex)`; position announce only when the order
  actually changed (before/after `orderedTabIds()` compare). Cross-window stays the documented
  `// LEG 3 SEAM: tab-adopt-by-drop`.
- **`dragend`**: DRAGDIAG log removed; release-point classification restored —
  `doTearOff = !dnd.dropHandled && (dnd.tearOff || releaseZone.zone === 'tearOff')`;
  `clearDragVisuals()`; `dnd = null` synchronous before `requestTearOff`; armed-only 'Move canceled'.
  `isOutsideStrip` import dropped (unused once classifyDragPoint owns both call sites).
- **CSS**: `.tab.dragging { opacity: 0 }` (the layout-neutral hole) + the sibling
  `transform 80ms ease` transition. **Deviation from the old shape:** NO `.tab.detaching` CSS rule —
  it marked the dragged tab, which is now the invisible hole (opacity 0.6 + dashed outline on an
  invisible element paints nothing); the visible tear-off affordance is the siblings closing ranks +
  the native image. The `.detaching` class itself stays (JS state, cleared by clearDragVisuals).
- **Invariants re-authored + UNSKIPPED** (11 tests, 0 skips): AC7 five-site cancelDnd enumeration
  (already authored for this shape — passes as-is); AC5 no-await + the release-point OR-gate with
  three both-direction mutations; DD16 clientX-only with the `e.screenX` and `screen`-module controls
  (mutation anchor widened to two lines — the dragover arg line is a substring of dragend's
  deeper-indented twin, and a one-line anchor would mutate the wrong site); AC4 JS transform-only
  scan unchanged; AC4 CSS layout-neutral scan RE-ANCHORED `.tab.detaching` → `.tab.dragging` (the
  rule that exists); NEW DD4 pin — renderer.js must never name
  `tearoffOverlay{Show,Move,Hide}`/`*TearoffGhost` (drag path stays pill-free; the overlay primitive
  remains main/preload-only).

**Gates (standalone):** `npm test` **1964 pass / 0 fail / 0 skipped**; `npm run lint` clean;
`npm run typecheck` clean; `node --check` clean. **Line delta vs the minimal core:** renderer.js
**+136 raw** (within the ~+150–200 budget — the ghost trio was not rebuilt); styles.css **+16 raw /
+6 code lines**. `src/main/*` and preload untouched. Leg stays `in-flight`: the operator HAT of the
rebuilt reorder/tear-off feel (AC6) is the acceptance gate for this increment.

### Increment A — operator HAT verdict (live, Wayland dev build)

- **Reorder: PASS** — drag image follows the cursor, siblings slide apart, release commits ("feels right").
- **Tear-off: PASS** — release outside the strip tears off; release over the content area detaches too
  (operator confirmed released-not-holding; Chrome-parity behavior, per design).
- **Favicon grab: PASS** — dragging from the icon drags the tab.
- **Escape mid-drag: NOT AVAILABLE on this rig — platform boundary, recorded as a DD5 extension.**
  During a native drag the browser's drag loop owns input (page keydown never fires; our listener is
  defensive parity only), and Chromium's ozone-wayland backend does not itself abort the drag on
  Escape as other backends do. Practical cancel: release back onto the strip at the original slot
  (no-op commit). Not green-washed; noted for Leg 4's spec wording.

AC6 satisfied (unit + HAT). Leg 2 → `landed` (completed at the flight-end commit per convention).

### Flight Director Notes — Leg 3 design + review cycle

Leg 03 (cross-window-drop-adopt) designed and risk-tiered **HIGH** (new IPC surface + the DD2 authority
question + a cross-window announce/ordering seam + a dragover accept-gate change touching the reorder
path). Developer design review: **approve with changes** — all file/line refs verified; caught (1) the
`move-tab-synchrony` 4-site arity pin the new handler breaks (bump 4→5 per the test's own procedure),
(2) the `moveOutcomeMessage` 2-site pin (bump 2→3), (3) the reverse-ordering false "Move canceled"
(`onTabMovedAway`'s `cancelDnd` beating the source dragend) — now AC5(b) silent-clear, (4) the
same-window-null-`dnd` spurious-failure corner — now an AC2 renderer guard, (5) `WindowRecord` typedef
mechanics for `dragWcId` (checkJs), (6) the stale `allowSoleTab` JSDoc. All incorporated verbatim.

FD rulings (out loud): **DD2 = provenance gate adopted** (reviewer-endorsed; + refinement: successful
adopt consumes the registration). **Tear-off-first cross-pipe race = accept-and-document** (adopt send
strictly precedes tear-off send; failure mode is a visible, recoverable misplaced window). **No second
review cycle** — every change is verbatim incorporation of the reviewer's own prescribed fixes, no new
design introduced. Leg 03 → `ready`; spawning the implementing Developer.

## Leg 3 — Implementation (cross-window-drop-adopt) — landed

The reviewed design shipped to all 8 ACs; gates green. Criterion-8 LIVE verification (overlapping
windows on the Wayland rig) is the flight-level operator HAT, still owed.

**Files touched:** `src/main/main.js` (adopt IPC + provenance registration), `src/main/window-registry.js`
(`dragWcId` typedef + seed), `src/renderer/renderer.js` (dragover accept, drop branch, drag bookends,
both reconciliation orderings), `src/preload/chrome-preload.js` + `src/renderer/renderer-globals.d.ts`
(bridge), `test/unit/tab-adopt-by-drop.test.js` (NEW, 9 pins), `test/unit/move-tab-synchrony.test.js`,
`test/unit/tab-drag-invariants.test.js`, `test/unit/sole-tab-move-close-source.test.js` (pin bumps).

**Per AC:**
- **AC1** — document `dragover` restructured: MIME guard → `preventDefault()` + `dropEffect='move'`
  UNCONDITIONALLY → `if (!dnd) return` gates the zone/displacement body. Same-window reorder path
  byte-identical past the reorder; invariants suite (AC4/AC5/DD16 pins) still green.
- **AC2** — drop handler: malformed/no-wcId payload → return; same-window branch unchanged (dropHandled
  still set synchronously before parse; now explicit `return` after commit); cross-window branch invokes
  `tabAdoptByDrop(payload)` → `announceTabStatus(moveOutcomeMessage(result, 'this window'))`. The
  null-`dnd`-own-tab guard (`!dnd && findTabByWcId(payload.wcId)` → silent no-op) precedes the invoke.
- **AC3** — `tab-adopt-by-drop` handler with the exact chain: target = `getWindowForChrome(sender)`
  (`no-source`) → `validateMoveTabPayload` (`bad-payload`) → `getWindowForGuest(p.wcId)` (`no-tab`) →
  `source === target` (`same-window`) → `source.dragWcId !== p.wcId` (`not-dragging`) →
  `moveTabIntoWindow(source, p, () => target, true)`, result verbatim; ok-path consumes the
  registration (clears `dragWcId` + pending grace timer). Stale `allowSoleTab` JSDoc updated (two
  true-callers now).
- **AC4** — `tab-drag-started` (sender-owns-wcId verified via `rec.tabViews.has(wcId)` before recording;
  cancels its own record's pending clear) / `tab-drag-ended` (clears on a 1500 ms grace timer, never
  synchronously). Renderer bookends: `tabDragStarted` after the null-wcId gate in dragstart;
  `tabDragEnded` BEFORE dragend's null-`dnd` early return (a defensively-canceled session still ends
  its registration). Field dies with the record; timer handles live in a per-record WeakMap (see
  Deviations).
- **AC5** — both orderings: (a) `requestTearOff` `.then` suppresses exactly
  `ok===false && reason==='no-tab' && !tabs.has(tabId)`; every other outcome announces as before.
  (b) `onTabMovedAway` silently clears (`clearDragVisuals(); dnd = null`) when the departing wcId IS
  the live session's tab, before the surviving defensive `if (dnd) cancelDnd();`.
- **AC6** — `tabAdoptByDrop` invoke + `tabDragStarted`/`tabDragEnded` sends on the chrome bridge;
  `renderer-globals.d.ts` declarations (result union includes `same-window`/`not-dragging`).
- **AC7** — NEW `test/unit/tab-adopt-by-drop.test.js`: 9 source-scan pins in the house idiom, every
  one with an applied in-memory mutation control (authority chain, provenance-gate-before-core +
  allowSoleTab + consume, sender-owns verification, grace-timer-not-synchronous, renderer bookend
  ordering, AC1 accept-before-gate, AC2 guard-before-invoke, AC5a both directions, AC5b silent-clear).
  Sanctioned bumps applied: `move-tab-synchrony` anchor count 4 → 5 (all four count assertions + the
  history-note paragraph, per the test's own instruction), `tab-drag-invariants` moveOutcomeMessage
  call sites 2 → 3. Pure-module extraction DECLINED (implementer's call the AC delegates): the new
  logic is thin conditionals over live registry/DOM state — no pure seam worth a module.
- **AC8** — `npm test` **1973 pass / 0 fail / 0 skipped** (baseline 1964; +9 new pins);
  `npm run lint` clean; `npm run typecheck` clean.

**DD11 line deltas (net code lines vs budget):** `main.js` **+36** (≤ +60 ✓); `renderer.js` **+10**
(≤ +40 ✓); preload **+3** + typings **+6** = **+9** (≤ +10 ✓ — the d.ts Promise union kept on one
line to stay inside budget); `window-registry.js` **+1** (unbudgeted but spec-required — the DD2
typedef mechanics).

**Deviations (all recorded, none design-changing):**
1. **Third pin bump, not in the sanctioned pair:** `sole-tab-move-close-source.test.js` AC3 pins
   exactly ONE `() => target, true` consolidate call; the adopt handler is a legitimate second
   (leg DD5). Bumped 1 → 2 in the suite's own idiom (title/header/message updated, mutation control
   intact). Same class as the two sanctioned bumps; the review missed this one.
2. **Grace-timer storage:** per-record timer handles live in a main.js
   `WeakMap<WindowRecord, timeout>` rather than a second WindowRecord field — the typedef gains only
   `dragWcId` exactly as DD2's mechanics prescribe, and record removal GCs the entry (the
   ruled-harmless post-remove fire still just touches an unreachable record).
3. **`tab-drag-invariants` enumeration window widened 300 → 700 chars** for the tab-moved-away cancel
   site: the AC5(b) silent-clear now sits between the handler head and the defensive cancel. The site
   itself, its gating, and the 5-count are unchanged.
4. **Inverted-mask hazard honored:** `onTabMovedAway` sits past renderer.js's maskComments regex
   blind spot; the first draft's comment apostrophe corrupted three downstream source-scan pins. The
   comment is quote-free with an in-source warning, and the new AC5(b) pins scan RAW source with
   quote-free code tokens so they read identically masked or not.
5. **`dragend` bookend placement:** `tabDragEnded` fires BEFORE the null-`dnd` early return —
   otherwise a defensively-canceled drag would leak its registration until the next drag (grace timer
   still bounds a normal drag's window).

### Criterion-8 HAT — operator verdict (live)

- **X11 run (`npm run dev -- --ozone-platform=x11`): PASS.** "Works across the desktop now" — tab
  dragged from window A's strip to a NON-OVERLAPPING window B's strip moves there; tear-off follows
  the cursor and spawns at the true release point. Criterion 8 witnessed on the real HTML5 transport.
- **Latency observation (X11 only):** a slight delay on drag/reorder/drop under X11. Re-tested on
  Wayland: "fine on wayland" — **accepted as environmental** (operator ruling; X11 is the spot-check
  backend, Wayland the daily driver, packaged targets are native).
- **Wayland run: PASS** — reorder/drag feel fine on the daily-default backend.

Criterion 8 SATISFIED (drag gesture; the behavior-spec re-authoring is Leg 4). Leg 3 HAT closed.
Proceeding to flight-end review → single commit → draft PR.

### Criterion-8 HAT addendum — DD5 CORRECTION (operator observation, Wayland)

The "Wayland run: PASS" entry above is NARROWED: it covers same-window reorder and edge-spawn tear-off
only. The operator's overlap test falsified DD5's overlap concession: dragging a tab from A onto an
OVERLAPPING window B's chrome **silently cancels** (visually silent; screen-reader "Move canceled"), and
onto B's content area **spawns a new window** (tear-off). Mechanism: WSLg Wayland cancels the drag on
leaving the SOURCE SURFACE — window B never receives dragover/drop at all; A's dragend fires with stale
coordinates that classify as in-strip cancel or tear-off depending on where the cursor left. Unfixable
app-side (B hears nothing; the stale dragend is indistinguishable from a genuine gesture). DD5 corrected
in flight.md: **cross-window drag on this rig is X11-only**; the Wayland daily-driver alternative is the
F8 keyboard/menu "Move to window" path. Criterion 8 remains SATISFIED (X11 witness; packaged-native
expectation). Operator disposition: accepted as environmental.
