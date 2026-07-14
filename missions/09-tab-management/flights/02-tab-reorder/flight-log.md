# Flight Log: Tab Order Model and Reorder

**Flight**: [Tab Order Model and Reorder](flight.md)

## Summary

Leg 1 (`order-model-and-keyboard-reorder`) landed: the pure `src/shared/tab-order.js`
order-decision module, its unit suite, the `orderedTabIds()`/`commitTabMove()`
renderer wiring with both DD1 consumer swaps, `Ctrl+Shift+ArrowLeft/Right`
keyboard reorder with a `#tab-status` announcement, and the extended
`tab-keyboard-operability` spec are all in place. Full suites green; live
spot-check confirmed the reorder chord end-to-end against the running app.

Leg 3 (`verify-integration`) landed 2026-07-14: tab-reorder 9/9 first-run pass; tab-keyboard-operability 8/1-inconclusive (pre-classified WSLg focus-ring apparatus limit); a11y + suites green. Leg 2 (`pointer-drag-and-drag-op`) landed: the premise spike **PASSED** (paced,
not unpaced — see Decisions); pointer-drag reorder (transform-only sibling
displacement, model-driven drop via `dropIndexFromPointer`/`commitTabMove`) is
wired into the tab strip with the DD2 activation-semantics refactor
(pointerdown activates; click becomes a guarded two-set-point fallback); the
`dragPointer` automation op landed at all four registration sites plus docs/
count updates (28 → 29 tools); `tests/behavior/tab-reorder.md` is authored
(`draft`, `Last Run: never` — runs in leg 3). Full suites green (1565/1565);
lint/typecheck clean. Live spot-check against the running app confirmed the
drag end-state, no-window-move, the click-model regression (all three parts),
keyboard reorder + the DD1 reorder-then-close-neighbor integration, and the
drag-with-menu-open edge case.

---

## Leg Progress

### Leg 1 — `order-model-and-keyboard-reorder`

**Status**: landed
**Dates**: 2026-07-14 (designed and landed same session)

**Changes Made**:
- `src/shared/tab-order.js` (new, ESM): `moveIndex(order, fromIndex, toIndex)`,
  `keyboardMove(order, id, direction)`, `dropIndexFromPointer(slotRects,
  pointerX, draggedIndex)`. All three return the SAME array reference as the
  input on a no-op (bounds violation, unknown id, from===to) — callers detect
  "did anything change" via reference equality rather than a value diff.
  `dropIndexFromPointer`'s midpoint rule resolves an exact-midpoint tie to
  "before" the slot (deterministic, not float-direction-dependent).
- `test/unit/tab-order.test.js` (new): 24 cases — forward/backward moves,
  single-tab no-op, from===to, out-of-range from/to, non-integer indices,
  non-array input, no-mutation-of-input, boundary no-wrap (both directions),
  unknown id, unrecognized direction, midpoint exact-tie + one-past, dragged-
  slot exclusion, first-slot-dragged-away index shift, empty/non-array
  `slotRects`. All green.
- `src/renderer/renderer.js`: added `orderedTabIds()` (reads `els.tabs`
  children's `dataset.id`, filtered to `.tab`) and `commitTabMove(id,
  targetIndex)` (insertBefore-based DOM commit, no animation). Swapped both
  design-review-identified consumer sites: `closeTab`'s next-tab pick
  (`orderedTabIds().pop()`) and the strip keydown handler's `ids`
  (`orderedTabIds()`). Added the `Ctrl+Shift+ArrowLeft/Right` branch (checked
  BEFORE the plain-arrow branch) calling `keyboardMove` + `commitTabMove` +
  `focusTab` + `announceTabStatus`; releases any active width-freeze
  unconditionally first (DD5 parity with the Delete branch). Extended each
  tab's `aria-keyshortcuts` to include the reorder chord. Added
  `announceTabStatus(text)` writing to the new `#tab-status` region.
- `src/renderer/index.html`: added `#tab-status` sr-only `role="status"
  aria-live="polite"` region (sibling to `#media-status`, per DD3) and the
  `../shared/tab-order.js` module script tag.
- `tests/behavior/tab-keyboard-operability.md`: added a Preconditions note
  recording the confirmed `pressKey` chord invocation; added Step 8 (keyboard
  reorder: move right, verify DOM order + focus + single-selected +
  announcement + `aria-keyshortcuts`; move left restores); Step 9 (formerly
  Step 8, no-hijack) now also exercises the reorder chord from the address bar
  and web content. Out of Scope's click line updated per DD5 to point at the
  `tab-reorder` spec's click-model step. `Last Run` untouched.

**Verification**:

*Grep-AC judgment table* (`grep -n "tabs.keys()\|tabs.values()" src/renderer/renderer.js`,
10 sites total — matches the design review's "all ten tabs.keys()/values()
sites" count):

| Site (pre-leg line) | Pattern | Judgment |
|---|---|---|
| `closeTab` next-tab pick (~1041) | `tabs.keys()` | **Order-consuming — swapped** to `orderedTabIds().pop()` (DD1) |
| strip keydown handler `ids` (~1513) | `tabs.keys()` | **Order-consuming — swapped** to `orderedTabIds()` (DD1) |
| `onJarWiped` orphan-check snapshot (~176) | `tabs.values()` | Order-agnostic — filters by `container.id` match, no position dependency. Leave. |
| `refreshOpenTabJars` snapshot comment (~206) | `tabs.values()` | Order-agnostic — snapshot taken to avoid a live-iterator/mutation hazard (closeTab mutates the same Map), not for order. Leave. |
| `refreshOpenTabJars` snapshot (~221) | `tabs.values()` | Same as above — orphan collection, unordered set semantics. Leave. |
| `openSiteSettingsTab` `.find(isInternalTab)` (~755) | `tabs.values()` | Order-agnostic — finds the (at most one) internal tab by predicate, not by position. Leave. |
| `activateTab` selection loop (~1096) | `tabs.values()` | Order-agnostic — visits every tab to set `aria-selected`/`tabIndex`; order of the writes doesn't matter. Leave. |
| `freezeTabWidths` (~1243) | `tabs.values()` | Order-agnostic — freezes every tab's width; order doesn't matter. Leave. |
| `releaseTabWidths` (~1250) | `tabs.values()` | Order-agnostic — releases every tab's width; order doesn't matter. Leave. |
| `findTabByWcId` (~2166) | `tabs.values()` | Order-agnostic — unique `wcId` lookup, first (only) match wins regardless of order. Leave. |
| `window.__goldfinchAutomation.listTabs()` (~3051) | `tabs.values()` | Order-agnostic **per the flight's own FD ruling** (Open Questions): `enumerateTabs`/`listTabs()` deliberately stays creation-order; its consumers address tabs by `wcId`, never by position. Leave. |

Post-change re-grep of `tabs.keys()`: **0 hits** (both sites migrated).

- `node --test test/unit/tab-order.test.js` — 24/24 pass.
- `npm test -- --test-timeout=30000` — 1551/1551 pass (full suite, incl. the
  new file).
- `npm run lint` — clean.
- `npm run typecheck` — clean.

*Live spot-check* (`GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1
npm run dev:automation`, no port pin — app free-fell-back to port 49709 this
run; SDK client per `scripts/mcp-example-client.mjs`'s pattern, helper scripts
under `/tmp/behavior-tests/goldfinch/flight2-leg1-spotcheck/` (not committed)):
  - **Chord invocation confirmed**: `pressKey(wcId, 'ArrowRight', ['control',
    'shift'])` / `'ArrowLeft'` — the generic `modifiers` param on the existing
    arrow key names, **not** a new composite key name (unlike `ShiftTab`).
    Recorded in the extended spec's Preconditions.
  - Focused a **non-active** middle tab, pressed the chord: DOM order changed
    by exactly one slot, focus stayed on the moved (still-inactive) tab,
    `aria-selected` stayed on the original active tab throughout (exactly one
    `true`), `#tab-status` read "Tab moved to position 3 of 4". Left-chord
    restored the original order and announced "Tab moved to position 2 of 4".
  - Boundary: focused the last tab, pressed right-chord — order and
    `#tab-status` text both unchanged (silent no-op, no announcement spam).
  - No-hijack: focused the address bar, pressed the chord — DOM order
    unchanged.
  - Also exercised moving the tab that WAS the active/selected one (a
    just-opened tab): `readAxTree` showed exactly one `tab` node with
    `selected: true` after the move, and every tab's `keyshortcuts` property
    included `Control+Shift+ArrowLeft Control+Shift+ArrowRight` alongside
    `Delete`.
  - `captureWindow()` after a move (distinct-titled tabs — one tab navigated to
    `iana.org/help/example-domains` so its title was visually distinguishable
    from the other `example.com` tabs) showed the moved tab rendered in its new
    DOM-order slot (rendered order matched the DOM read; screenshots retained
    at `/tmp/behavior-tests/goldfinch/flight2-leg1-spotcheck/post-move-window.png`
    and `post-move-window2.png`, not committed — flight-1 lesson: never trust
    DOM reads alone for "is it rendered").
  - App killed after the spot-check; no lingering Electron processes.

### Leg 2 — `pointer-drag-and-drag-op`

**Status**: landed
**Dates**: 2026-07-14 (designed and landed same session)

**Premise spike (GATE) — verdict: PASS.** Ran against the live `dev:automation` chrome
renderer (helper scripts under `/tmp/behavior-tests/goldfinch/flight2-leg2/`, not
committed): an unpaced synchronous burst of `sendInputEvent` mouseMoves (down →
N moves with `buttons:1` → up, all in one JS tick) DID produce real `pointermove`
events in the chrome, and a naive client-side 5px-dx threshold armed — but the
burst coalesced down to essentially the first + last move (2 of ~9 sent events in
the first trial). Pacing one event per macrotask (`setTimeout`, not just a
microtask `await`) between sends raised fidelity to 4–6 of ~9 events with real
intermediate x-progression, and critically the LAST interpolated move (which
`dragEvents` guarantees equals `to` exactly) consistently arrived before the
mouseUp. Verdict: the premise holds for a PACED recipe — no CDP fallback needed,
no divert. Separately discovered (informational, not blocking): `pointerdown`/
`pointerup` correctly report the primary button (`buttons:1`/`button:0`) and
`setPointerCapture` succeeds, but Chromium does not propagate a "still held"
buttons bitmask onto the intervening synthetic `pointermove` events (`e.buttons`
reads `0` throughout the move phase). The renderer's gesture code does not gate
on `e.buttons` (only `pointerId` + cumulative `dx` from the recorded pointerdown
origin), so this has zero effect on correctness — recorded in `tests/behavior/
tab-reorder.md`'s Preconditions so a future spec author isn't surprised by it.

**Changes Made**:
- `src/renderer/renderer.js`: module-scoped `drag` state machine (`DRAG_ARM_THRESHOLD_PX
  = 5`); `pointerdown` on a tab (button 0, non-✕ target) activates immediately (DD2
  Chrome parity) and records a potential drag; `pointerdown`/`pointerup`/
  `pointercancel` for the live gesture are document-level listeners (not per-button)
  so a narrow sliver tab losing the pointer before arming doesn't drop the gesture —
  pointer capture (set at arm time) then retargets events to the dragged tab
  regardless of visual cursor position. `armDrag()` snapshots `orderedTabEls()` rects
  at arm time, calls `releaseTabWidths()` (AC: freeze never arms mid-drag), adds
  `.dragging`, and captures the pointer. `applyDragDisplacement(targetIndex)`
  rebuilds the hypothetical final order (same semantics as `commitTabMove`'s own
  `targetIndex`) and translates every OTHER tab by the delta between its arm-time
  rect and the rect it now visually occupies — exact for non-uniform (sliver) tab
  widths, not an approximation via one shared slot width. `pointerup` (armed) clears
  transforms, calls `commitTabMove`, announces "Tab moved to position n of m" (only
  when the DOM order actually changed — silent no-op otherwise, mirroring the
  keyboard-reorder precedent). `cancelDrag()` (Escape mid-drag, `pointercancel`, or a
  defensive call from `closeTab`/`createTab`/window `resize`) clears transforms only
  (nothing else was ever touched) and announces "Move canceled" — but only if the
  drag had actually armed. Click handler's activate branch is now `if
  (!suppressClickActivate) activateTab(id)`; `markClickSuppressed()` sets the flag
  and clears it on the next tick, called at BOTH set-points (pointerdown-activation
  and drag-commit/pointerup) per the design-review ruling.
- `src/renderer/styles.css`: `.tab.dragging` (`position: relative` — needed because
  `.tab` is otherwise statically positioned, so a bare `z-index` would have no effect;
  `z-index: 10`; `transition: none`; `cursor: grabbing`) and `.tab:not(.dragging) {
  transition: transform 80ms ease; }` for the sibling displacement. No new
  `prefers-reduced-motion` media query needed — the existing global
  `transition-duration: 0.01ms !important` rule already neutralizes it (displacement
  still occurs, just without the ease).
- `src/main/automation/input.js`: `dragEvents(from, to, steps=12)` (pure builder,
  linear interpolation, guaranteed exact final point) + `actOnPaced` (resolve →
  activate → re-resolve like `actOn`, but sends events one at a time with an
  `await setTimeout` between them — the spike-driven pacing fix) + `dragPointer(wcId,
  from, to, deps, opts)` (`steps` default 12, `stepDelayMs` default 4).
- `src/main/automation/engine.js`: `dragPointer` dispatch.
- `src/main/automation/scope.js`: `dragPointer` added to `WCID_FIRST_OPS` (jar-
  membership-checked like `click`).
- `src/main/automation/mcp-tools.js`: `dragPointer` ToolDef in `DRIVE_TOOLS`
  (`wcId`/`from`/`to` required, `steps`/`stepDelayMs` optional); tally comments
  updated (18 drive, 29 total).
- `src/main/automation/mcp-server.js`: optional `deriveAuditDetail` case for
  `dragPointer` (`(fx,fy)->(tx,ty)`); "29 tools" comment update.
- `docs/mcp-automation.md` + `CLAUDE.md`: tool count 28→29, drive count 17→18,
  `dragPointer` added to the Drive tools table, the jar-scoping tab-targeting-op
  list, the void-ops list, and the audit-detail example list.
- `test/unit/automation-mcp-tools.test.js`, `test/unit/automation-mcp-server.test.js`:
  count pins updated (28→29; `EXPECTED_TOOL_COUNT`), plus new `dragPointer` schema/
  dispatch/void-op/throw-class coverage and `deriveAuditDetail` cases — the two
  count-pin unit tests failed loudly on the stale `28` before this update, exactly as
  the guard is designed to do.
- `test/unit/automation-input.test.js`: `dragEvents` pure-builder tests (ordering,
  interpolation exactness, buttons bitmask, steps clamping) + `dragPointer` actOn
  tests (guest activate-before-send, chrome no-activate, internal-session throw,
  default-steps count) mirroring the existing `click`/`mouseClickEvents` coverage —
  not explicitly required by the leg text but matches the house convention of
  testing every pure builder + actOn-wrapped op offline.
- `tests/behavior/tab-reorder.md` (new, `draft`, `Last Run: never`): pointer
  drag end-state, no-window-move assertion, keyboard reorder, the DD1
  reorder-then-close-neighbor regression, the three-part click-model regression
  (synthetic-click-no-pointerdown / real-click / ✕-and-middle-click-no-flash-
  activate). Cancel-restore and mid-drag motion legibility are recorded as
  unconditionally HAT-scoped in both Preconditions and Out of Scope, with
  rationale, per the design-review ruling — no automated step attempts either.
  `enumerateTabs` creation-order divergence is documented in Out of Scope per the
  flight's own FD ruling.

**Verification**:

- `grep -n "dragPointer" src/main/automation/*.js docs/mcp-automation.md CLAUDE.md` —
  all four registration sites present (`input.js`, `engine.js`, `scope.js`,
  `mcp-tools.js`) plus the optional `mcp-server.js` audit-detail case and the docs/
  CLAUDE.md count updates.
- `npm test -- --test-timeout=30000` — 1565/1565 pass (full suite).
- `npm run lint` — clean.
- `npm run typecheck` — clean.

*Live spot-check* (`GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1
npm run dev:automation`, no port pin — free-fell-back to port 49709 across all
three relaunches this session; helper scripts under `/tmp/behavior-tests/goldfinch/
flight2-leg2/`, not committed):
  - **Pointer drag end-state**: dragged the 3rd-from-left tab past the current
    last tab's midpoint (rect-derived coordinates) — the dragged tab landed
    exactly last in DOM order (verified against `dropIndexFromPointer`'s own
    midpoint math by hand for the recorded rects), became the selected tab
    (drag-start activation, Chrome parity), and every tab's inline `transform`
    + `.dragging` class were fully cleared post-drop (no residue). Confirmed the
    app boots with **one default tab already open** — "open five tabs" yields
    six total, not five; caught and fixed a wrong assumption in the newly
    authored `tab-reorder.md` spec ("drag past the 5th tab's midpoint" →
    "drag past the LAST tab's midpoint", worded generically) before its first
    run — a premise-audit correction per `AUTHORING.md` ("corrections to a
    draft spec before its first pass are authoring, not drift").
  - **No-window-move**: `window.screenX/screenY/outerWidth/outerHeight` read via
    `evaluate` before and after the drag were byte-identical (`x:564,y:260,
    w:1432,h:942` both times) on this WSLg dev box — the pin held real (not the
    "always 0" WSLg degenerate case the spec's Preconditions warn about).
  - **Click-model regression, all three parts PASS**: (a) a synthetic
    `dispatchEvent(new MouseEvent('click'))` with NO preceding pointerdown still
    activated the target tab (AT default-action path); (b) a real trusted
    `click()` (mouseMove→mouseDown→mouseUp, which DOES exercise the pointerdown-
    activation path plus the click handler's guarded fallback in the same
    gesture) activated the clicked tab exactly once (single `selected` tab,
    matching the design review's "end-state is observationally identical either
    way" note); (c) both an ✕-click and a middle-click on background (non-
    active) tabs closed them while the PREVIOUSLY active tab remained selected
    throughout both closes — no flash-activation.
  - **Keyboard reorder + DD1 reorder-then-close-neighbor**: clicked a tab
    directly (focuses + activates it — Tab-traversal from the address bar does
    NOT reach the tab strip in this app, since `.tab` elements precede `#address`
    in DOM order; the strip's roving-tabindex entry is reachable by tabbing
    *before* the address bar, not after — a fixture note worth carrying into any
    future spec that anchors focus via the address bar first), then
    `Ctrl+Shift+ArrowRight`/`Left` moved it one slot with focus retained,
    `#tab-status` announcing correctly, and the reverse chord restored the
    original order. Closed the (still-active, just-reordered) tab via keyboard
    `Delete`: the newly-activated tab matched `orderedTabIds().pop()`'s
    DOM-order prediction (this run's creation-order-last tab happened to
    coincide with DOM-order-last too, so it corroborates but doesn't fully
    discriminate the two hypotheses in isolation — leg 1's unit suite + grep-AC
    review already established the fix's correctness structurally; this was an
    integration confidence pass, not a re-litigation).
  - **Drag-start while the kebab menu is open** (Edge Case spot-check): opened
    the kebab overlay (`aria-expanded="true"`), then started a drag — the menu
    closed (pointerdown's focus shift blur-closes the sheet like any chrome
    click) and the drag proceeded normally to a correct drop. Screenshot
    (`menu-open-drag.png`, not committed) confirmed clean rendering with no
    overlay residue.
  - App killed after each phase (spike, then implementation spot-check); no
    lingering Electron processes at session end.

---

### Leg 3 — `verify-integration`

**Status**: landed
**Dates**: 2026-07-14

**Verification results**:
- `/behavior-test tab-reorder` — **PASS 9/9** on the spec's FIRST run
  (`tests/behavior/tab-reorder/runs/2026-07-14-18-12-24.md`): pointer-drag
  end-state matched the midpoint-rule prediction by direct computation;
  no-window-move was a substantive hard pass (WSLg placeholder caveat
  inapplicable — real position values); the DD1 reorder-then-close
  discriminator resolved for DOM-order-last against creation-order-last;
  all three click-model regression parts passed (synthetic no-pointerdown
  click activates; trusted click activates once; background ✕/middle closes
  never flash-activate at end-state granularity). Spec `draft` → `active`.
- `/behavior-test tab-keyboard-operability` — **8 pass / 1 inconclusive**
  (`tests/behavior/tab-keyboard-operability/runs/2026-07-14-18-39-32.md`).
  The extended contract (Step 8 keyboard reorder incl. #tab-status
  announcements; Step 9 reorder chord in the no-hijack set, plus a new
  chrome-body hijack probe with a positive control) passed fully. The one
  inconclusive is Step 3's focus-ring visual — the PRE-CLASSIFIED WSLg
  apparatus limit (hasFocus false under injected input; same disposition as
  the 2026-07-08 run; no regression indicated). Native-rig ring check stays
  on the mission HAT list.
- `npm run a11y` WCAG gate — "No NEW violations" ✅.
- `npm test` 1565/1565; lint, typecheck clean on the final tree.

**Findings routed to flight review — ADJUDICATED**:
- `#tab-status` "lazy creation" — **verified FALSE POSITIVE at flight review**:
  the region was added statically to index.html at leg 1 (empty,
  role=status, aria-live=polite, sibling to #media-status);
  `announceTabStatus()` only sets textContent. The correct pre-existing-empty
  pattern is already in place; no action. (The run-log executor observation
  "not yet present" was a misread.)
- Cosmetic: automation-mcp-server test literal name still said "28 tools"
  (assertion was correct at 29) — renamed at review close.

**HAT items accumulated this flight**: mid-drag motion legibility;
Escape/pointercancel cancel-restore (apparatus cannot reach mid-gesture);
focus-ring on a native rig (reaffirmed); Step-8 selection-decoupling branch
is keyboard-unreachable (documented, covered by leg-1 spot-check +
tab-reorder pointer path).

---

## Decisions

- 2026-07-14 — Leg 1: chose to make `moveIndex`/`keyboardMove` return the
  **same array reference** as the input on every no-op path (bounds violation,
  unknown id, from===to, unrecognized direction), rather than always returning
  a defensive copy. This gives callers a cheap `result !== input` check to
  detect "did an actual move happen" without a value-level diff — used
  directly in the renderer's reorder branch to decide whether to commit/
  announce or silently no-op (Edge Case: single tab / boundary presses must
  not spam the announcement region).
- 2026-07-14 — `dropIndexFromPointer`'s midpoint tie-break was not specified
  by the leg text beyond "midpoint rule"; picked **strict `pointerX >
  midpoint`** (a pointer sitting exactly on a midpoint resolves to "before"
  that slot) for determinism, since the leg's own AC explicitly requires an
  exactly-at-midpoint unit test. Documented in the module's JSDoc; the
  pointer-drag leg (leg 2) inherits this without needing to revisit it.
- 2026-07-14 — Leg 2: **paced event dispatch for `dragPointer`** — the flight
  DD4 text anticipated needing "an optional small inter-event delay if the
  spike shows coalescing," and the spike showed exactly that (an unpaced burst
  collapsed ~9 sent events to ~2 delivered). Chose `stepDelayMs: 4` (default)
  between EVERY sent event (not just the interpolated moves) via a dedicated
  `actOnPaced` helper, distinct from the generic synchronous `actOn` every
  other input op uses — `click`/`typeText`/`pressKey`/`scroll` are unaffected.
  12 steps × 4ms ≈ 48ms of added wall time, comfortably under the "keep total
  < 500ms" guidance.
- 2026-07-14 — Leg 2: **announce "Tab moved to position n of m" on drop only
  when the DOM order actually changed** (compared before/after `orderedTabIds()`
  around the `commitTabMove` call), mirroring the keyboard-reorder precedent's
  silent-no-op-at-boundary behavior — the leg's AC text didn't explicitly
  require suppressing the announcement on a no-op drop (e.g. armed then
  dragged back near the start before release), but doing so avoids spamming
  the `aria-live` region for a drag that visually displaced tabs but landed
  back where it started.
- 2026-07-14 — Leg 2: `applyDragDisplacement` recomputes sibling transforms via
  a full "hypothetical final order" simulation (comparing each tab's arm-time
  rect at its ORIGINAL index vs. the rect it would occupy in the projected
  final order) rather than a uniform `±slotWidth` shift, per the leg's own
  Implementation Guidance suggestion of the simpler approach. Chose the exact
  simulation because it's barely more code and is provably correct for
  non-uniform (sliver-width) tabs, where a shared slot-width assumption would
  under/over-shift the displaced siblings.

---

## Deviations

- None from the leg 1 spec. The live spot-check surfaced one apparatus fact not
  anticipated in the leg's phrasing ("the tool enumerates known key names on a
  bad name; flight-1's run log notes 'ShiftTab' style naming" suggested a
  possible new composite name would be needed) — reading `src/main/automation/
  input.js` and confirming live showed the EXISTING generic `modifiers` array
  parameter already covers `Ctrl+Shift+ArrowRight` against the plain
  `ArrowRight` key name; no new `PRESS_KEY_NAMES` entry or engine change was
  needed. This is a discovery, not a deviation from any AC — recorded here so
  the pointer-drag leg's author doesn't re-spend the same investigation.
- None from the leg 2 spec's required scope either. One apparatus-level
  fixture note surfaced during the live spot-check (see Leg 2's Verification
  bullet on Tab-traversal): the app's default boot tab meant "open five tabs"
  yields six total, which required a premise-audit correction to the newly
  authored `tab-reorder.md` spec BEFORE its first run (not a deviation from
  the leg's implementation — the spec hadn't been run yet, so this is
  authoring, not drift, per `AUTHORING.md`).

---

## Anomalies

- The dev-automation launch's free-fallback port landed on **49709** rather
  than the documented default 49707 during the leg-1 spot-check, even though
  the dev profile's persisted `automationPort` setting is `49707` — something
  in the loopback range around 49707/49708 was transiently unavailable to this
  run. Not a product defect (the free-fallback mechanism is designed exactly
  for this); noted here only because the spot-check had to discover the bound
  port via `ss -ltnp` rather than a stdout print (no port is printed to
  stdout on a free-fallback bind — only `AUTOMATION_DEV_MINT` is). Future
  spot-checks on this box should check the bound port with `ss`/`netstat`
  rather than assuming the default when running without a pin.
- Leg 2's three relaunches this session all free-fell-back to the SAME port
  (49709) each time, consistent with the leg-1 note above that the documented
  default (49707) was transiently unavailable on this box; no new anomaly.

---

## Session Notes

### Flight Director Notes

- 2026-07-14 — Flight `ready` → `in-flight`; branch `flight/2-tab-reorder`
  created, STACKED on `flight/1-shrink-to-fit-strip` (PR #84 awaits operator
  merge — the auto-mode permission layer correctly declined a self-merge of
  the FD's own PR; stacking keeps the mission moving while merges stay with
  the operator).
- Leg 1 `order-model-and-keyboard-reorder` designed. **Risk tier: LOW** —
  the two order-consumer swaps were individually verified at flight design
  review (Architect read all ten `tabs.keys()/values()` sites); the pure
  module is new code with its own unit suite; the keyboard-contract change
  is additive and lands with its spec extension in the same leg. The
  riskier click-model change (DD2 activation ruling) is deliberately NOT in
  this leg — it ships with the pointer-drag leg, which will tier HIGH.
- Per-leg design review skipped for leg 1; flight-end Reviewer covers it.
- 2026-07-14 — Leg 2 `pointer-drag-and-drag-op` landed same session, per its
  own embedded design-review rulings (the leg artifact carries the reviewed
  activation-semantics ruling, the mcp-tools.js ToolDef-site correction, the
  two-set-point click-suppression flag, and the count-pin grep list — all
  honored as written). **Risk tier: HIGH** as flagged at leg-1 design time
  (the DD2 click-model activation refactor). The premise spike gated
  everything and passed (paced recipe); no divert to the CDP fallback was
  needed. Per-leg design review already embedded in the leg artifact itself;
  flight-end Reviewer still covers the two-set-point suppression-flag logic
  specifically (the design review's own note: the automation surface can't
  distinguish the two activation paths' internal mechanics, only their
  identical end-state, so code review — not the behavior spec — is the
  verification path for that one piece).
