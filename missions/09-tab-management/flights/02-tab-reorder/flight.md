# Flight: Tab Order Model and Reorder

**Status**: completed
**Mission**: [First-Class Tab Management](../../mission.md)

## Contributing to Criteria

- [x] The operator can reorder tabs within the strip by pointer drag, with a
      live visual indication of the pending drop position — and dragging a
      tab never fights the strip's window-move drag zone.
      *(behavior-test-backed — new `tab-reorder` spec)*
- [x] (partial) Every tab-management pointer gesture has a keyboard-reachable
      equivalent: **reorder from the keyboard** lands here, and the existing
      tablist keyboard contract still holds. *(behavior-test-backed —
      `tab-keyboard-operability` extended)*

---

## Pre-Flight

### Objective

Give the strip an explicit, testable tab-order model and let the operator
reorder tabs: by pointer drag (Chrome-style live displacement of siblings, a
visible pending-drop position, drop commits instantly) and by keyboard
(`Ctrl+Shift+ArrowLeft/Right` moves the focused tab one slot, with a
screen-reader announcement). Today order is implicit — renderer `tabs` Map
insertion order happens to equal DOM append order — and two code sites
consume that accident (`closeTab`'s next-tab pick, the tablist keydown
navigation). After this flight, DOM order is the single authoritative order,
a pure `src/shared/` module owns every reorder decision, and the automation
surface gains the drag primitive the apparatus audit shows it lacks.

### Open Questions

- [x] Where does order authority live — a new array, the Map, or the DOM? →
      DOM order, with a single accessor and a pure decision module (DD1).
- [x] Can the current MCP apparatus drive a pointer drag? → **No** — the
      input surface has `click` (atomic move→down→up), `pressKey`, `scroll`;
      there is no move-only or drag primitive (this gap is already
      documented in the `responsive-tab-strip` spec's mouseleave workaround).
      Act-axis gap → the flight adds a `dragPointer` op (DD4).
- [x] Does pointer drag fight the window-move drag zone? → No at gesture
      level: `-webkit-app-region` window-drag engages on mousedown *in a
      drag region*, and every drag here starts on a `.tab` (`no-drag`).
      Passing over inter-tab gaps mid-gesture does not re-engage window
      drag. (Architect note at mission design; re-verified: `.tab` is
      `no-drag`, `#tabstrip` is the drag region.)
- [x] Does reorder need to reach the main process? → No — tab order is
      purely a chrome-renderer presentation fact today. `tabViews` (main) is
      an unordered registry keyed by wcId; `enumerateTabs` order is creation
      order and stays so (noted in the new spec's Out of Scope; the
      multi-window flights revisit if window membership makes order
      main-relevant).
- [x] Does `enumerateTabs`/`listTabs()` order need to become DOM-order-
      consistent now? → **No (FD ruling at design review)**: after this
      flight, Map/creation order permanently diverges from visual order once
      a tab is moved; `enumerateTabs` deliberately stays creation-order (its
      consumers address tabs by `wcId`, never by position), the divergence
      is documented in the new spec's Out of Scope, and the Flight-7
      automation-surface audit owns the decision of whether agents need
      visual order (e.g. an `orderIndex` field) — not this flight.
- [ ] Drop-indicator idiom — Chrome-style sibling displacement (gap opens
      where the drop would land) vs an insertion caret line. Default:
      displacement (DD2); implementer may add a caret if displacement alone
      reads ambiguously at sliver widths. Recorded at leg time.

### Design Decisions

**DD1 — DOM order is the single source of truth; a pure module decides, a
single accessor reads.** New `src/shared/tab-order.js` (ESM, unit-tested)
owns the decision logic: `moveIndex(order, fromIndex, toIndex)` (pure
reorder), `keyboardMove(order, id, direction)` (one-slot move with bounds),
and `dropIndexFromPointer(slotRects, pointerX, draggedIndex)` (midpoint rule:
the drop index is where the pointer sits relative to each slot's horizontal
midpoint). The renderer gains one accessor, `orderedTabIds()` (reads
`els.tabs` children's `dataset.id`), and **every order-consuming site
switches to it** — `closeTab`'s next-tab pick (renderer.js ~1041, currently
`[...tabs.keys()].pop()`) and the tablist keydown handler's `ids`
(~1513, currently `[...tabs.keys()]`). The `tabs` Map remains the id→tab
lookup only; its iteration order stops being load-bearing.
- Rationale: the DOM must be reordered anyway (it is the rendered truth and
  the roving-tabindex order AT users experience); duplicating order in an
  array invites drift. The pure module keeps every decision unit-testable
  offline (`node --test`), matching the shared-module house pattern.
- Trade-off: `orderedTabIds()` is a DOM read per navigation/close — trivial
  at tab-strip scale (≤ dozens of nodes).
- Grep-AC: after this flight, no order-consuming `[...tabs.keys()]` remains
  (each hit individually judged; order-agnostic `tabs.values()` iterations
  are exempt).

**DD2 — Pointer drag: pointer events + transform-only live displacement;
drop commits instantly.** `pointerdown` on a tab arms a potential drag;
crossing a small threshold (~5px horizontal) enters drag mode with
`setPointerCapture`: the dragged tab follows the pointer via
`transform: translateX(...)`, siblings shift by exactly one slot width via
transforms (the Chrome displacement idiom — the opening gap IS the live
drop indication), `dropIndexFromPointer` recomputes on every move. Drop
(`pointerup`) commits: DOM `insertBefore` per the model, all transforms
cleared in the same frame — an instant step, no settle animation. `Escape`
(or `pointercancel`) aborts and restores.
- **Activation semantics (design-review ruling)**: `pointerdown` activates
  the tab immediately (Chrome parity) — but ONLY for `e.button === 0` with a
  target outside `.tab-close` (closing a background tab must never
  flash-activate it; middle-click close likewise never activates). The
  existing `click` handler KEEPS its activate branch as a **fallback**,
  guarded by a per-gesture flag: a click immediately following a
  pointerdown-activation or a completed drag is a no-op (no
  double-activation — `activateTab` bumps suggest state and re-sends
  `tabSetActive`, so a double call is real waste), while a click that
  arrives WITHOUT a preceding pointerdown (AT default-action / synthetic
  clicks) still activates. This preserves the assistive-tech path the
  pinned keyboard contract implies.
- Close (✕ / middle) is otherwise unaffected: the threshold means a plain
  click never enters drag mode, and drags starting on the ✕ button are not
  armed at all.
- Rationale: transforms are compositor-only — no layout change anywhere near
  the guest slot (the strip is chrome DOM above the toolbar; the guest-view
  invariant is not engaged, and transforms wouldn't engage it anyway).
  Displacement doubles as the drop indicator with zero extra chrome.
- Trade-off: at sliver widths (~13px, the flight-1 pathological baseline)
  drag targets are small; the gesture still works (threshold is in pointer
  space, not tab space) but precision suffers — keyboard reorder (DD3) is
  the reliable path at pathological counts (flight-1 debrief input,
  accepted).
- Interplay pins: `freezeTabWidths` must not arm during a drag (the drag's
  own transforms own the geometry; a freeze mid-drag would fight it) — drag
  mode suppresses the freeze and `releaseTabWidths()` runs at drag start;
  the mouseleave re-expand listener ignores events while dragging.

**DD3 — Keyboard reorder: `Ctrl+Shift+ArrowLeft/Right` on the focused tab.**
Extends the existing tablist keydown handler (same no-hijack scoping — only
when focus is inside the strip): moves the focused tab one slot per press
via `keyboardMove` + the same DOM commit path as drop, keeps focus on the
moved tab, and announces "Tab {n} of {m}" via a new `aria-live="polite"`
region in the chrome. `aria-keyshortcuts` on tabs grows accordingly.
Plain arrows keep their existing select-and-focus semantics untouched.
The announcement region reuses the existing sr-only `role="status"`
`aria-live="polite"` pattern (`#media-status`, index.html — the established
precedent for transient announcements) rather than inventing new chrome.
- Rationale: issue #82 names this binding; it cannot collide — verified: the
  strip handler currently ignores modified arrows, `keydown-action.js` maps
  no Ctrl+Shift+Arrow, and the sheet-accelerator union set has none.
- Trade-off: none identified; APG permits app-specific reorder accelerators
  on tablists.

**DD4 — Apparatus: the flight adds a `dragPointer` automation op (act-axis
gap is real).** New op in `src/main/automation/input.js` following
`mouseClickEvents`'s trusted-event recipe: `dragPointer(wcId, from, to,
{ steps })` sends `mouseMove`(to from) → `mouseDown(buttons:1)` →
N interpolated `mouseMove`s (buttons:1) → `mouseUp` via `sendInputEvent`,
foreground-to-act + re-resolve discipline like every input op. Registration
is FOUR places, not two (design review — the documented "leg-05 SC8 gap"):
`input.js` op body, `engine.js` dispatch, **`scope.js` `WCID_FIRST_OPS`**
(miss it and jar keys throw "engine.dragPointer is not a function"; the
`automation-scope.test.js` guard will catch a miss), and the MCP ToolDef
(**mcp-tools.js** — corrected at leg-2 design review; mcp-server.js is
transport-only) + `docs/mcp-automation.md` (29 tools; count also pinned by
two unit tests).
**Premise spike first (design review)**: the scroll op's history (sendInputEvent
`mouseWheel` produced zero movement → CDP fallback) makes "interpolated
`mouseMove` produces real `pointermove` in the chrome renderer" a
verify-before-building premise — the pointer-drag leg opens with a
first-hour spike (send a down/move/up sequence at a test tab, evaluate
whether pointermove listeners fired and drag-arming state advanced) before
any gesture code is written; the CDP fallback path is the documented divert.
Observe axis needs nothing new: order is read via `evaluate`
(`orderedTabIds` equivalent over `els.tabs` children / `.tab-title` texts)
and `readAxTree`; both already exist.
- Rationale: without a drag primitive the flight's headline behavior is
  untestable by the Witnessed apparatus (the audit that the flight skill
  demands caught this at design time, not mid-flight). The op is also the
  enabling apparatus for the tear-off flight later this mission.
- Trade-off: the op is atomic — mid-drag states cannot be captured by a
  concurrent observe call. **Mid-drag rendered truth (displacement motion,
  indicator legibility) is HAT-scoped** (F9 lesson: discrete captures can't
  judge motion; a human eye can). The behavior spec asserts end-states
  numerically; the HAT flight owns the motion check.
- Security note: the op is drive-tier like `click` (jar-scoped keys reach
  their own tabs; chrome target admin-only) — no new trust surface.

**DD5 — Verification: new `tab-reorder` behavior spec + extend
`tab-keyboard-operability`.** The new spec (drafted this flight, run at
verify-integration) covers: pointer drag end-state (order changed per the
midpoint rule, DOM + axtree + title sequence agree), drag-cancel restores
order, keyboard reorder moves one slot with focus retained + announcement
present, reorder-then-close picks the correct DOM-order neighbor (the DD1
consumer regression), a no-window-move assertion (window position unchanged
after an in-strip drag — the drag-region coexistence check), **and an
explicit click-model regression step** (plain click activates exactly once;
✕-click and middle-click on a background tab close it WITHOUT
flash-activating it — the DD2 activation refactor is a deliberate change to
the pinned surface, so it gets its own assertion, not implicit trust).
`tab-keyboard-operability`'s now-stale Out of Scope line ("the existing
click path is unchanged") is updated to point at the `tab-reorder` spec's
click-model step.
`tab-keyboard-operability` gains the reorder keys (new step: Ctrl+Shift+
Arrow moves the focused tab, one `aria-selected` invariant holds, no-hijack
still passes with the address bar focused). Apparatus per DD4; both axes
audited: act = `dragPointer`/`pressKey` (new op + existing), observe =
`evaluate` order reads + `readAxTree` + `captureWindow` end-states.

### Prerequisites

- [x] Flight 1 landed and debriefed (this flight stacks on
      `flight/1-shrink-to-fit-strip`; PR #84 awaits operator merge — new
      branch `flight/2-tab-reorder` forks from it).
- [x] Order-consuming sites enumerated (renderer.js ~1041, ~1513 — verified
      current; all other `tabs` iterations are order-agnostic).
- [x] Binding collision check: no Ctrl+Shift+Arrow anywhere in
      `keydown-action.js`, the strip handler, or `sheet-accelerator.js`.
- [x] Apparatus audit: no drag primitive on the current 28-tool surface
      (gap confirmed); `sendInputEvent` mouseMove-with-buttons recipe
      precedented by `mouseClickEvents`' comment (buttons bitmask proven).
- [x] Behavior-test environment: same as flight 1 (dev:automation +
      admin mint + fixture server; port pin-if-free rule).

### Pre-Flight Checklist

- [x] All open questions resolved (drop-indicator refinement delegated)
- [x] Design decisions documented
- [x] Prerequisites verified
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

Three surfaces, in dependency order. (1) `src/shared/tab-order.js` + the
renderer's `orderedTabIds()` accessor + consumer swaps + keyboard reorder +
live region — pure logic first, unit-tested, then wired. (2) Pointer drag in
`renderer.js` (pointer events on tab buttons, transform-driven displacement,
model-driven drop) + strip CSS for drag-state styling (`.tab.dragging`
elevation etc.) — chrome DOM only. (3) `dragPointer` in the automation
engine + MCP tool + docs, then the new behavior spec + the
keyboard-operability extension. Main-process footprint is exactly the new
input op; no IPC, no session, no guest-view changes.

### Checkpoints

- [x] `tab-order.js` unit suite green (midpoint rule incl. dragged-slot
      exclusion, bounds, no-op moves).
- [x] Keyboard reorder works live; `tab-keyboard-operability` (extended)
      passes.
- [x] Pointer drag works live (spot-check with rect-containment-honest
      reads, per the flight-1 lesson); `tab-reorder` spec passes.
- [x] `npm run a11y` green; suites green.

### Adaptation Criteria

**Divert if**:
- `sendInputEvent` interpolated mouseMoves do not produce real `pointermove`
  events in the chrome renderer (drag never arms) → fall back to CDP
  `Input.dispatchMouseEvent` through the existing `cdp.js` shared-lock path
  (precedented by `scroll`), new DD required.
- Transform-based displacement misrenders in the live chrome (DOM/pixels
  disagree) → static insertion-caret indicator, no sibling motion; new DD.

**Acceptable variations**:
- Drop-indicator refinement (caret in addition to displacement) at sliver
  widths; drag threshold px; displacement transition timing (transforms
  only — never layout properties).
- `dragPointer` parameter shape (steps count, per-step delay) as the
  implementer finds reliable against the live renderer.

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are
> planned and created one at a time as the flight progresses. This list will
> evolve based on discoveries during implementation.

- [x] `order-model-and-keyboard-reorder` — `tab-order.js` + unit tests,
      `orderedTabIds()` + consumer swaps (grep-AC), Ctrl+Shift+Arrow
      reorder, live-region announcement, `tab-keyboard-operability`
      extension.
- [x] `pointer-drag-and-drag-op` — drag gesture (DD2) + drag-state CSS,
      `dragPointer` engine op + MCP tool + docs, new `tab-reorder` behavior
      spec authored.
- [x] `verify-integration` — run `tab-reorder` + extended
      `tab-keyboard-operability` behavior tests, a11y sweep, suites; fix
      loop as needed.

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [ ] Code merged (PR — stacks on flight 1's branch until PR #84 merges)
- [x] Tests passing
- [x] Documentation updated (`docs/mcp-automation.md` tool count + dragPointer
      reference; CLAUDE.md automation tool-count line)

### Verification

- New `tests/behavior/tab-reorder.md` passes (pointer end-state, cancel,
  keyboard reorder, reorder-then-close neighbor, no-window-move).
- Extended `tests/behavior/tab-keyboard-operability.md` passes.
- `npm run a11y` green; `npm test` / lint / typecheck green.
- Mid-drag motion legibility: deferred to the mission HAT flight (DD4).
