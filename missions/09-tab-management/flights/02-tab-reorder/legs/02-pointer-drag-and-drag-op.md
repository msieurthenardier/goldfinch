# Leg: pointer-drag-and-drag-op

**Status**: completed
**Flight**: [Tab Order Model and Reorder](../flight.md)

## Objective

Land pointer-drag tab reorder (Chrome-style transform displacement, model-
driven drop, activation-semantics ruling applied) plus the `dragPointer`
automation op, and author the `tab-reorder` behavior spec.

## Context

- Flight DD2 (incl. the design-review activation ruling): pointerdown
  activates (button 0, non-close target); click keeps a guarded fallback
  activate; drag arms at ~5px; transforms only; drop commits instantly;
  Escape/pointercancel restores; freeze suppressed during drag.
- Flight DD4 (incl. the four-place registration note + premise spike):
  `dragPointer` op — spike `sendInputEvent` interpolated mouseMove FIRST;
  CDP fallback via `cdp.js` shared lock is the divert.
- Leg 1 landed: `tab-order.js` (`dropIndexFromPointer` ready),
  `orderedTabIds()`/`commitTabMove()` exist; reorder announcements exist.
- Design-review low notes to honor: `.tab` is statically positioned —
  `.tab.dragging` needs `position: relative` (or equivalent) for any
  z-elevation; drag-state styling must not reintroduce layout shifts.

## Inputs

- Branch `flight/2-tab-reorder` with leg 1 landed (uncommitted).
- `src/main/automation/input.js` (`mouseClickEvents` recipe), `engine.js`,
  `scope.js` (`WCID_FIRST_OPS`), `mcp-server.js`, `docs/mcp-automation.md`.

## Outputs

- `src/renderer/renderer.js`: drag gesture state machine (pointerdown/move/
  up/cancel on tab buttons), activation-semantics change per DD2 ruling,
  transform displacement + drop commit via `dropIndexFromPointer` +
  `commitTabMove`, drag announcement ("Tab moved to position n of m" on
  drop; "Move canceled" on abort).
- `src/renderer/styles.css`: `.tab.dragging` styling (elevation, transform
  transition on siblings only — the dragged tab tracks the pointer with no
  transition).
- `src/main/automation/input.js` + `engine.js` + `scope.js` +
  `mcp-tools.js` (ToolDef — design review: mcp-server.js is transport-only;
  the SOLE per-op mcp-server.js touch is the optional `deriveAuditDetail`
  case, nice-to-have): `dragPointer(wcId, from, to, { steps })` (four-place
  registration), plus `docs/mcp-automation.md` (29 tools) and CLAUDE.md's
  tool-count line.
- `tests/behavior/tab-reorder.md` (new spec, per flight DD5 incl. the
  click-model regression step).
- Unit tests: extend `test/unit/tab-order.test.js` only if new pure logic
  emerges (gesture state machine is DOM-bound — behavior-spec territory);
  `automation-scope.test.js` will pin the new op's tier via its existing
  guard.

## Acceptance Criteria

- [ ] **Premise spike (FIRST, gate)**: `sendInputEvent`-driven
      down→interpolated-moves→up against the live chrome produces real
      `pointermove` events and arms the drag threshold. Record the result in
      the flight log. If it fails: STOP, record, divert to the CDP fallback
      (new flight-log decision) before continuing.
- [ ] Pointer drag reorders: dragging a tab past a neighbor's midpoint
      displaces siblings (transform-only), drop commits the new DOM order,
      transforms clear in the commit frame; order matches
      `dropIndexFromPointer`'s decision for the final pointer x.
- [ ] Activation semantics per the DD2 ruling: pointerdown (button 0,
      non-✕ target) activates once; click-after-pointerdown/drag does not
      re-activate (**verified by code review, not the behavior spec** —
      design review: the end-state is observationally identical either way
      over the automation surface, so the flight-end Reviewer traces the
      two-set-point flag logic instead); click WITHOUT pointerdown still
      activates (AT path — provable: dispatch a synthetic `click` via
      evaluate and observe activation); ✕-click and middle-click on a background tab close it
      without flash-activating it.
- [ ] Escape or pointercancel mid-drag restores the pre-drag order and
      clears all transforms; announcement "Move canceled".
- [ ] Drag never moves the window (drag starts on `.tab` = `no-drag`); a
      completed in-strip drag leaves window bounds byte-identical.
- [ ] Deferred-reflow interplay: `releaseTabWidths()` at drag start; the
      freeze never arms mid-drag; pointer-close (✕/middle) freeze behavior
      is unchanged when no drag occurs (responsive-tab-strip contract
      intact).
- [ ] `dragPointer` op: four-place registration (input.js, engine.js
      dispatch, scope.js `WCID_FIRST_OPS`, **mcp-tools.js ToolDef** — NOT
      mcp-server.js, which is transport-only; optional: a
      `deriveAuditDetail` case there for audit enrichment); follows
      resolve→activate→re-resolve; refuses internal session like `click`;
      `docs/mcp-automation.md` documents it (29 tools) and CLAUDE.md's
      count updated; `automation-scope.test.js` green with the new op.
- [ ] `tests/behavior/tab-reorder.md` authored per flight DD5: pointer
      end-state (via `dragPointer`), cancel-restores is **unconditionally
      HAT-scoped** (design review: the atomic op can't be interrupted, and
      keyboard reorder commits synchronously — there is no cancelable
      intermediate state; the spec records this with rationale), keyboard reorder step, reorder-then-close neighbor step,
      click-model regression step, no-window-move assertion, enumerateTabs
      creation-order note in Out of Scope, mid-drag motion HAT-scoped note.
- [ ] Live spot-check: real drag via `dragPointer` on the running app —
      order changes correctly; `captureWindow` confirms rendered order;
      window bounds unchanged.
- [ ] `npm test`, `npm run lint`, `npm run typecheck` green; flight log
      updated (incl. spike result + chosen steps/threshold values).

## Verification Steps

- Spike log entry first.
- `grep -n "dragPointer" src/main/automation/*.js src/main/automation/**/*.js docs/mcp-automation.md` — four registrations + docs.
- Live spot-check per AC; suites; spec read-through for internal
  consistency.

## Implementation Guidance

1. **Spike** (~30 min cap): temp script — launch dev:automation, add a
   temporary `evaluate`-installed pointermove counter on `#tabs`, send a
   hand-rolled down/move/up sequence via a scratch engine call (or a
   prototype `dragPointer` in a local branch of input.js), read the counter.
   Keep the evidence in /tmp; record verdict in the flight log.
2. **Gesture state machine** (renderer.js): module-scoped `drag` state
   (null | {pointerId, tabId, startX, startedAt, armed, startOrder,
   slotRects, currentDropIndex}). `pointerdown` (on tab btn, button 0,
   non-✕ target): activate per ruling + record potential drag.
   `pointermove` (armed via threshold): first arm → `setPointerCapture`,
   snapshot slot rects (`getBoundingClientRect` per tab), add
   `.dragging`; each move → dragged tab `translateX(dx)`, compute
   `dropIndexFromPointer`, apply `translateX(±slotWidth)` to displaced
   siblings (no transition on the dragged tab; ~80ms transform transition on
   siblings is acceptable — transforms only). `pointerup`: if armed →
   `commitTabMove` + clear transforms/classes in the same frame + announce;
   set the click-suppression flag. `pointercancel`/`Escape` (keydown while
   dragging): restore (clear transforms, no DOM change), announce cancel.
3. **Click handler adjustment**: keep close branch; activate branch becomes
   `if (!suppressClickActivate) activateTab(id)`. **TWO set-points, spelled
   out (design review — a single pointerdown-time set silently
   reintroduces double-activation)**: (a) at pointerdown-activation (plain
   click: the click event fires in the same dispatch chain, before any
   scheduled clear), AND (b) again at drag-commit/pointerup (a real drag
   spans many ticks — a pointerdown-time setTimeout(0) clear has long
   fired). Clear on the next tick after each set so genuinely synthetic
   clicks (no pointer session) always activate.
4. **`dragPointer` op** (input.js): mirror `mouseClickEvents` style —
   `dragEvents(from, to, steps)` building the event array; `actOn`-style
   wrapper with foreground-to-act; default `steps: 12` with per-step
   `mouseMove` (buttons:1) interpolation; optional small inter-event delay
   if the spike shows coalescing (keep total < 500ms). Tier: add to
   `WCID_FIRST_OPS` next to `click`.
5. **Spec authoring**: follow AUTHORING.md; apparatus preconditions inherit
   the responsive-tab-strip pattern (admin key, pin-if-free port, fixture
   distinctness, numeric-first reads, rendered-truth tie-break). The
   pointer-drag step derives from/to coordinates from rect reads (drag the
   3rd tab's center past the 5th tab's midpoint).
6. **Docs + count pins**: `grep -rn "28 tools" --include=*.md --include=*.js .`
   — the count is pinned in docs/mcp-automation.md (two places), CLAUDE.md,
   AND asserted by `test/unit/automation-mcp-tools.test.js` +
   `test/unit/automation-mcp-server.test.js`, plus the running tally
   comment in mcp-tools.js — update every site (the unit pins will fail
   loudly if missed).

## Edge Cases

- **Drag on the active tab vs background tab**: both drag; activation
  already happened on pointerdown (background tab becomes active on
  drag-start — Chrome parity).
- **Drag to the far ends**: drop index clamps (model handles bounds).
- **Pointer leaves the strip vertically mid-drag**: keep dragging (capture
  holds); drop commits wherever the x-projection lands (Chrome detaches
  into tear-off here — THAT is a later flight; for now the gesture stays
  1-D horizontal).
- **Sliver widths**: gesture works (threshold is pointer-space); precision
  degraded — accepted per DD2 trade-off.
- **Mid-drag tab close via keyboard on another tab**: freeze released at
  drag start; if the tab count changes mid-drag (e.g. Ctrl+W in another
  window path doesn't exist yet; wcId-close via automation possible) —
  cancel the drag defensively on any tab-list mutation during drag
  (MutationObserver not needed: the only mutation paths are closeTab/
  createTab — have them call `cancelDrag()` if a drag is live).
- **Drag-start while a sheet menu or find overlay is open**: the strip
  stays interactive above those overlays (they cover the guest region
  only); pointerdown's focus shift blur-closes the sheet like any chrome
  click — verify once in the spot-check that a drag with the kebab menu
  open behaves sanely (menu closes, drag proceeds), note in the flight log.
- **`slotRects` staleness mid-drag**: the snapshot is taken at arm time;
  transforms don't reflow layout so it stays valid; a window RESIZE
  mid-drag invalidates it — accept (rare), cancel the drag on `resize` as
  cheap defense.
- **`prefers-reduced-motion`**: sibling transition drops to 0ms (media
  query), displacement still occurs (position change is meaning, not
  decoration).

## Files Affected

- `src/renderer/renderer.js`, `src/renderer/styles.css`,
  `src/renderer/index.html` (only if a caret indicator element is added)
- `src/main/automation/input.js`, `engine.js`, `scope.js`, `mcp-server.js`
- `docs/mcp-automation.md`, `CLAUDE.md` (tool count)
- `tests/behavior/tab-reorder.md` (new)
- flight-log.md

---

## Post-Completion Checklist

- [ ] All acceptance criteria verified
- [ ] Tests passing
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed`
- [ ] Do NOT commit — the flight commits once after review
