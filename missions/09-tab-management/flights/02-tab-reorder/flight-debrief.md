# Flight Debrief: Tab Order Model and Reorder

**Date**: 2026-07-14
**Flight**: [Tab Order Model and Reorder](flight.md)
**Status**: landed
**Duration**: 2026-07-14 (single session: design → three legs incl. spike →
two Witnessed runs → land)
**Legs Completed**: 3 of 3

## Outcome Assessment

### Objectives Achieved

Full objective delivered: DOM order is now the strip's single order authority
(pure `tab-order.js` + `orderedTabIds()`/`commitTabMove()`, both prior
order-consuming sites swapped with a 10-site grep-AC judgment table);
pointer-drag reorder (transform-only displacement, model-driven drop, Escape/
pointercancel restore) and keyboard reorder (`Ctrl+Shift+Arrow` +
`#tab-status` announcements) both live; the `dragPointer` automation op
landed with four-place registration (29 tools). `tab-reorder` passed **9/9 on
its first run**; the extended `tab-keyboard-operability` passed
(8/1-inconclusive — the pre-classified WSLg focus-ring apparatus limit).
PR #85 (stacked on #84).

### Mission Criteria Advanced

- SC2 (pointer-drag reorder with live drop indication, no drag-zone fight) —
  **fully advanced**, behavior-test-backed (end-state; mid-drag motion is a
  HAT item by structural apparatus limit).
- SC3's keyboard-reorder clause — **advanced**; the tablist contract held
  and was extended.

## What Went Well

- **Spike-first gating validated by its own finding.** The premise spike
  (30-min cap, ran before any gesture code) discovered real Chromium
  coalescing — an unpaced `sendInputEvent` burst delivered ~2 of 9 moves —
  and drove the shipped design (paced `actOnPaced`, 4ms/step). Not a
  formality: it changed the op's architecture before implementation, and the
  CDP fallback divert was never needed.
- **The flight-level design review caught the flight's two most expensive
  would-be bugs before implementation**: (a) the activation-semantics hole
  (double-activation on every click + flash-activation on background-tab
  close) — the two-set-point suppression-flag ruling was written into the
  flight text and implemented verbatim; (b) the `mcp-tools.js` vs
  `mcp-server.js` ToolDef mislabel — which would have produced
  "engine.dragPointer is not a function" at jar tier.
- **Review-effort allocation worked as designed**: leg 1 tiered low (its due
  diligence had already happened at flight design review), leg 2 tiered high
  with a per-leg review; the flight-end Reviewer's attention was explicitly
  narrowed to the ONE mechanism behavior-testing structurally can't reach
  (the suppression flag internals) and traced it end-to-end.
- **Witnessed-run quality**: the `tab-reorder` spec's pinned-prediction
  discriminator (Checkpoint 6 recorded both the DD1-fixed and pre-DD1
  predictions in evidence BEFORE closing the tab) and positive controls
  (`isTrusted:false` on the synthetic click; the address input visibly
  consuming Delete in the no-hijack row) made verdicts independently
  re-derivable — both fresh validators converged on the same techniques.
- **Honest unreachability handling**: cancel-restore and mid-drag motion are
  HAT-scoped with recorded rationale (atomic op, no cancelable intermediate
  state); the keyboard selection-decoupling branch is documented as
  structurally unreachable (auto-activating arrows re-couple focus and
  selection) rather than falsely claimed covered.

## What Could Be Improved

### Process

- **Spike sequencing was a bet.** The coalescing risk was flagged in the
  flight's Open Questions before leg 1 started, but the spike was scoped to
  open leg 2. A spike failure would have re-planned the flight, not just leg
  2 — flight-gating spikes should run before the first leg when their
  failure would change the technical approach.
- **A false-positive finding cost a review cycle**: the `#tab-status`
  "lazy creation" caveat from both run logs was disproven at flight review
  (the region was static in index.html from leg 1 — an Executor misread).
  Cheap lesson: when a run-log finding names a code fact, the orchestrator
  can grep it before routing it as a fix candidate.

### Technical

- **renderer.js growth is a real trend** (Architect): 662 → 3510 lines
  (+247 this flight); the drag state machine stayed in renderer.js
  "because it's DOM-bound" — reasoning that will recur for every chrome-DOM
  feature in the multi-window flights. Watch item: flights 6–8 should
  consider a chrome-DOM module split (e.g. `renderer/tab-strip.js`) before
  piling more state machines into one file. No BACKLOG entry tracks this
  yet — added via the mission's known-issues path at the next flight design.
- **`actOnPaced` is a one-off second dispatch idiom** in input.js —
  deliberate and correct (pacing every op would slow all input ~48ms), but
  if the tear-off flight needs more multi-event gestures it should
  generalize deliberately, not accrete per-op.
- **Two zero-evidence defensive paths**: resize-mid-drag cancel (untested)
  and drag-with-sheet-open (single non-repeated screenshot). Cheap HAT
  checks; named so they don't silently regress.
- **The keyboard selection-decoupling branch rests on ephemeral evidence**
  (the leg-1 spot-check lived in /tmp). If a future flight changes the
  arrows' navigate+activate coupling, the branch becomes reachable and needs
  a durable test; until then this is a documented, bounded gap.

### Documentation

- **The CLAUDE.md doc debt is now two flights deep**: flight 1's rider
  (container-query pitfall + strip structure) never landed, and this flight
  adds DD1 (DOM-order authority + accessor pattern) and the two-set-point
  suppression flag (a pattern a future refactor could "simplify" back into
  a bug). **Consolidated doc-pass rider goes on Flight 3** — one leg item,
  four topics.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| ToolDef registered in `mcp-tools.js`, not the flight draft's `mcp-server.js` | Design-review correction: mcp-server.js is transport-only | Yes — registration-site citations in flight docs should be verified against file responsibilities, not names |
| `dragPointer` uses paced dispatch (`actOnPaced`), unlike every other op | Spike finding: Chromium coalesces unpaced synthetic move bursts | Yes — recorded in docs/CLAUDE.md; generalize only when a second gesture op needs it |
| tab-reorder spec reworded pre-first-run ("the last tab", not a count) | App boots with a default tab — premise audit before first run | Yes — the AUTHORING.md fixture-premise rule working as intended |

## Key Learnings

1. **Test metrics**: 1565/1565, 13 suites, ~1.1–1.25s wall, zero flakes
   (two timed runs). +38 vs flight 1 (1527): +24 `tab-order.test.js`,
   +14 dragPointer coverage — fully attributable to this flight's surface.
2. **The apparatus can now drag** — `dragPointer` is the enabling apparatus
   for the tear-off flight's verification, built two flights early.
3. **Apparatus facts recorded this flight** (for future spec authors):
   `pressKey` takes a generic `modifiers` array (no composite chord names);
   Chromium coalesces synthetic move bursts (pace per macrotask); `e.buttons`
   reads 0 on synthetic pointermove (never gate on it); live regions and
   the roving-tabindex coupling constrain which branches keyboard paths can
   reach.

## Recommendations

1. **Flight 3 carries the consolidated CLAUDE.md doc-pass rider** (four
   topics: strip DOM/CSS structure, container-query pitfall, DOM-order
   authority + accessors, two-set-point suppression flag).
2. **Flight 3 reuses the Checkpoint-9 no-hijack pattern** (three probes +
   positive control) — it spans exactly the three capture points keyboard
   parity must reconcile — and decides up front whether the arrows'
   navigate+activate coupling changes (making the decoupling branch
   testable) or stays (converting the ephemeral spot-check into a durable
   test).
3. **Flight-gating spikes run before leg 1** when failure would re-plan the
   flight (methodology-level; carry to mission debrief).
4. **Promote to AUTHORING.md** (mission-debrief carry): pinned-prediction
   discriminators; positive controls in negative rows; "structurally
   unreachable" as a named disposition distinct from inconclusive/HAT-scoped.
5. **HAT flight additions from this flight**: mid-drag motion legibility;
   Escape/pointercancel cancel-restore; resize-mid-drag + drag-with-menu-open
   quick checks; (standing) native-rig focus ring — now carried three times,
   make it an explicit early HAT item.

## Action Items

- [ ] Flight 3 design: doc-pass rider; no-hijack pattern reuse; coupling
      decision; renderer.js growth watch-item noted at design.
- [ ] Mission debrief carry: AUTHORING.md promotions; spike-before-leg-1
      rule; actOnPaced generalization note.
- [ ] HAT flight: items above.
