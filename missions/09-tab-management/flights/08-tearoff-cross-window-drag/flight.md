# Flight: Tear-off and Cross-Window Drag

**Status**: ready
**Mission**: [First-Class Tab Management](../../mission.md)

> **Citation convention (adopted after design-review pass 1, and load-bearing).**
> This spec anchors on **symbols and string literals**, not line numbers. Pass 1 found
> ~20 of ~60 line citations in the draft stale or wrong, two quotes invented, three
> counts wrong, and one headline claim inverted — because the draft was written from the
> **recon transcript** rather than from the code. **A recon report is a proxy for the
> source.** Leg 1's rule for the DD1 pin ("anchor on code identity, never a line
> number") is applied to this spec itself. Where a line number is unavoidable it is
> marked *(verified {date})* and is expected to drift.

## Contributing to Criteria

- [ ] A tab can be moved into its own new window — by drag (tear-off beyond the strip)
      and by explicit command. *(F6 delivered the command + a complete window; **F8
      delivers the drag**.)*
- [ ] A tab dragged from one window's strip into another window's strip moves there,
      keeping its cookie-jar identity and its page state.
- [ ] Every tab-management pointer gesture has a keyboard-reachable equivalent.
- [ ] Privacy and isolation hold everywhere tabs now move: a tab keeps its jar identity
      through tear-off and cross-window drag.
- [ ] With several windows open, per-window surfaces never cross-talk.
      *(F8 re-proves this under a live two-window handoff — the first flight that can.)*

---

## Pre-Flight

### Objective

Make a tab movable between windows by gesture. The strip's drag gains a second axis and
a zone model: dragged within the strip it reorders (F2's behavior, unchanged); dragged
out and released it either lands in another window's strip at the drop position or
becomes its own new window. Jar identity and live page state travel with the tab because
the tab is never recreated — the same `webContents` is re-parented, the mechanism F6's
spike proved. Every gesture gets a keyboard-reachable equivalent, and the flight lands
F7's blocking prerequisite **first**: the DD1 synchrony invariant this flight's own
main-side work is most likely to break, pinned as code before any leg edits `main.js`.

### Recon (digest — full fact base in the flight log)

**The transport the mission named is the transport F8 adopts. What recon killed is a
sub-mechanism, not a candidate.** The mission offers three unnumbered candidates:
*pointer tracking across window bounds + IPC handshake*; *HTML5 drag with a custom MIME*;
*screen-coordinate hit-testing on drop*. **DD1 adopts the first. DD3 adopts the third.
F8 forecloses the HTML5-drag one.** What the probe kills is the **main-side `screen`
module as a coordinate source**: `screen.getCursorScreenPoint()` returns
**`{x:0, y:0}` — silently, always, never throws** on this Wayland rig, and
`screenToDipPoint` **returns the point passed in with no changes** (the typings say
exactly that — identity degradation, which fits the silent-failure thesis *better* than
"unsupported"). `dipToScreenPoint` is documented **unsupported with no stated
degradation** — its Wayland behavior is simply unknown, and the spec does not guess.
*(Narrowed at review pass 2: the draft's correction block attributed the identity clause
to both converters; only `screenToDipPoint` carries it.)* Renderer-side
`window.screenX + e.clientX` was proven globally consistent across two windows. → DD1.

**The F7 debrief is wrong about AC27, in its own diagnosed failure mode.** It asserts
*"3 have never run at all."* **All five specs have genuine run logs**; three carry
`Last Run: never` **headers** over real runs. It read the header (a proxy) instead of
the `runs/` directory (the artifact) — proxy substitution, in the section diagnosing it.
**And its set of five is a proxy too**: `b2d3afc` touched **14** specs (13 re-pointed +
1 created), of which **12** have no post-F7 run. → DD12.

**The F2 drag has no Y-axis** (`grep -c startY src/renderer/renderer.js` → **0**), and
`dropIndexFromPointer` takes one scalar. "Beyond the strip" has nowhere to live. → DD3.

**Jar identity is carried by the live re-parent, not the payload** — so
destroy-and-recreate would lose it. → DD2.

**The apparatus cannot drive a real cross-window drag** — `sendInputEvent` injects into
one webContents. → DD9.

### Open Questions

- [x] Transport → **DD1** (renderer-side global coordinates; `screen` module banned).
- [x] Live tear-off vs drop-commit → **DD6** (drop-commit).
- [x] Does the renderer learn `windowId`? → **DD8**. **Reversed at review**: it already
      does, by design. The ordinal machinery is deleted.
- [x] Sole-tab and internal-tab semantics → **DD5**, ruled separately per case.
- [x] Is cross-window drag behavior-test-backed? → **DD9** (logic yes, OS pointer
      delivery no — named gap).
- [ ] Does cross-window drag make the DD7 blur gap rig-reachable? → **V7**. Not
      inherited blind: the accepted-gap ruling rests on **two** premises and F8 defeats
      **one**. *(Left OPEN at review pass 2: the draft marked this `[x]`, but "go measure
      it" is not an answer. Contrast DD9, which resolves to a ruling.)*
- [ ] **Does the source renderer receive `pointermove` — and `pointerup` — while the
      pointer is over another window?** → **V1**. **The flight's gate.**
- [ ] **Does `win.getBounds()` return usable values for a second window?** → **V4**.
- [ ] **Does crossing `#tabstrip-drag` hand the gesture to the OS window-move?** → **V8**.

### Design Decisions

**DD1 — Coordinate authority: the source chrome renderer, exclusively.**
The gesture's global space is `window.screenX + e.clientX` / `window.screenY + e.clientY`,
computed in the **source window's chrome renderer**, and it is the **only** coordinate
authority in the flight.
- Rationale: probed live — `screen.getCursorScreenPoint()` returns `{0,0}` **silently**
  under Wayland; `screenToDipPoint` is a documented identity pass-through and
  `dipToScreenPoint` is documented unsupported with **no stated degradation**. Renderer
  deltas were proven consistent across two windows. Main-side polling would pass unit
  tests and be wrong 100% of the time live — this codebase's own **S1 silent-success
  class**.
- **This is the mission's "pointer tracking across window bounds + IPC handshake"
  candidate**, confirmed rather than replaced. The `screen` module was never the
  candidate; it was one possible implementation of it, and it is dead here.
- **The `screen` module is banned in `src/**` for this flight** — pinned by a source-scan
  test (leg 1's extracted helper), not by convention. A silent `{0,0}` is unreviewable.
- **Corollary**: main-side `getPosition()` and renderer `screenX` disagree by a small
  constant CSD shadow margin (probed once at ~16/10px; **do not treat the exact value as
  established** — a single reading, and it falls outside the range M05 F8 logged).
  **Never mix the two.** DD3 converts once, at a single named seam.

**DD2 — Mechanism: live re-parent only. Destroy-and-recreate is foreclosed for tab
movement.**
- Rationale: jar identity is preserved **by the live re-parent** — same `webContents`,
  same session/partition. The payload's `container.partition` rebuilds only the
  renderer-side **pill**. Destroy-and-recreate would therefore **violate the mission's
  "jar identity travels with the tab" constraint**, which is absolute.
- **Attribution corrected at review**: the mission frames these as **co-equal
  alternatives for a spike to decide**, not as a ranked fallback, and it never assumed
  either was jar-neutral. F8 is not correcting a mission error; it is **supplying the
  spike answer the mission asked for**, on a ground the mission didn't anticipate (F6's
  spike answered *"can it re-parent?"*; this answers *"what does the alternative
  cost?"*).
- Trade-off: no fallback. A case that can't re-parent is refused (DD5), not degraded.

**DD3 — Drop resolution is main-side, from one global point.**
On drop the source renderer sends `{ globalX, globalY, wcId, ... }`; main hit-tests
`rec.win.getBounds()` across `registry.records()` and returns a discriminated outcome.
- **This is the mission's "screen-coordinate hit-testing on drop" candidate** — adopted,
  with the coordinate sourced per DD1 rather than from the dead `screen` module.
- **Depends on V4. `getBounds()` — the mechanism DD3's CORRECTNESS rests on — carries
  the SAME documented Wayland failure as `getPosition`**: *"On Wayland, this method will
  return `{ x: 0, y: 0, … }` as introspecting or programmatically changing the global
  window coordinates is prohibited."* *(Found at review pass 2. The draft discussed the
  typings hazard only for `getPosition`/`setPosition` — DD4's **cosmetic** concern — and
  never for `getBounds`, on which the flight's correctness depends. Recon probed
  `getPosition`, not `getBounds`: **the evidence for the primary mechanism was
  inference.**)* Probed working here; almost certainly WSLg-RAIL-specific (each window is
  a real Win32 window). **Do not generalize.**
- **TWO named degradations, and the dangerous one is a false POSITIVE:**
  1. **Hit-test resolves no window → tear-off.** User-indistinguishable from a correct
     tear-off.
  2. **All windows report origin `{0,0}` → every in-bounds point resolves to the FIRST
     record in `registry.records()` → main adopts into the WRONG window, silently.**
     *(Found at review pass 2.)* This is the **documented** failure mode, it is
     **uncovered by degradation 1**, and it is squarely the **S1 silent-success class
     this flight exists to prevent** — the drag appears to work and lands the tab in the
     wrong window every time.
- **Required guard**: if **two or more records report identical origins**, the hit-test
  **refuses** — it never resolves. *(Ruled at review: refuse rather than fall back to
  tear-off. A typings-conformant platform loses cross-window drag with a **visible
  refusal**, which is strictly better than a silent wrong-window adopt. This is the S1
  lesson applied at design time.)*
- **V4 must record THREE readings on the real rig** (DD10 applied to a design decision):
  a point inside window B resolves to **B**; a point on empty desktop resolves to
  **none**; and **two windows at known-different positions resolve to DIFFERENT
  records**. The third is the one that catches the false positive — the first two both
  pass under an all-`{0,0}` hit-test.

**DD4 — Tear-off window placement: `setPosition`, WSLg-scoped, cosmetic-only.**
- **Placement is never correctness**: if `setPosition` doesn't take, the window appears
  at the default position and the tab still moved. The move is one AC; placement is a
  separate WSLg-scoped AC that **reads the position back** rather than assuming the call
  worked.

**DD5 — Every drag outcome is defined. No bare nulls, no silent deaths.**
`tab-move-to-new-window` has **four `return null` sites** (`!source`; `!p`;
`!entry || entry.trusted || isDestroyed`; `tabViews.size <= 1`) carrying **six
conditions**, and the renderer **ignores the return entirely**. *(Draft said "5 reasons"
over 4 citations, two of which weren't returns — the parent debrief's signature failure,
reproduced in the DD written to enumerate exhaustively. Measured at review: 4 sites, 6
conditions.)*
- Correct for a menu item that can be **omitted at build time** (`tab-context-model.js`
  omits at `!isLastTab && !isInternal` — **both** conditions); **wrong for a drag**,
  which the user physically performs and which cannot be omitted.
- The drop handler returns a **discriminated result** covering **the six inherited
  conditions PLUS the F8-new ones**, enumerated: *(7) the target window is absent at
  dispatch* (`registry.get(windowId)` → null — DD8's stale-window refusal, which the
  existing handler cannot have because it **creates** its target); *(8) the hit-test is
  ambiguous* (DD3's identical-origins guard). *(The draft said "the six-condition
  discriminated refusal" — an undercount for the handler it specifies, found at review
  pass 2. An off-by-one in the DD written to enumerate exhaustively.)*
- **A refused drop leaves the tab where it started — it does not animate back.**
  *(Corrected at review pass 2; "snaps the tab back visibly" described a design the
  flight does not have.)* `clearDragVisuals()` runs at `pointerup` **exactly as today**;
  for an out-of-strip drop `commitTabMove` is simply **not called**, so the tab is
  already at its origin index before any reply lands. A refusal is therefore
  **announced, not animated**. **Silence is still not an outcome** — the announcement is
  the outcome, and it rides the existing `announceTabStatus` path.
- **Sole tab — ruled per case, and the second rationale is now the TRUE one.** The
  existing guard's stated reason is *"a sole-tab move is a no-op window swap… never
  leave the source at zero tabs."* That is **true for tear-off** (swapping one window
  for another) and **false for cross-window adopt** (dragging A's only tab into B is a
  meaningful merge; Chrome does it).
  - **Tear-off of a sole tab: refused**, on the rationale that actually applies.
  - **Cross-window adopt of a sole tab: also refused in F8** — because the source's
    `tab-moved-away` handler ends `if (next) activateTab(next); else createTab()`, so
    **an emptied strip boots a fresh, unrequested home tab.** Window A would survive
    with a home tab in it: neither Chrome parity (which closes A) nor obviously right.
    **Source-window disposal on tab exhaustion is a separate design question**, and F8
    does not open it. **Recorded as a Chrome-parity gap for the mission.**
    > *(Corrected at review pass 2. The draft refused this case because it "makes the
    > source window's destruction an outcome of a drag, coupling the drag to the
    > quit-on-last chain." **That mechanism provably does not fire**: there is no
    > `tabViews.size === 0` → close anywhere in `main.js`, and the quit chain
    > (`close` → `closed` → `window-all-closed` → `app.quit()`) is never engaged. The
    > draft replaced an **inapplicable inherited** rationale with a **false new** one —
    > in the DD pass 1 flagged for exactly that. The ruling survives; the reason had to
    > be measured, not composed.)*
- **Internal/trusted tabs**: refused, announced.

**DD6 — Drop-commit tear-off. The window is created at drop, not mid-drag.**
- Rationale: (a) DD1 makes the source renderer's pointer capture the only pointer
  authority; (b) live tear-off re-parents mid-gesture, invalidating the `slotRects`
  snapshot; (c) a window following the cursor is a continuous `setBounds` stream against
  the guest-view native-surface invariant's discrete-step reading.
- **Trade-off, named**: no "window follows the cursor" feel. A Chrome-parity gap and a
  HAT item, not a defect.
- **`pendingDrop` is a separate variable from `drag`. This is the DD, not an
  implementation note.** *(Found at review; the draft was wrong.)* The reason no cancel
  collision exists **today** is that the `pointerup` handler is **fully synchronous** and
  nulls `drag` before any IPC reply can land. DD5's snap-back requires state to survive
  an async round-trip — **the moment it does, every cancel path is live**, and there are
  **seven** `cancelDrag()` call sites, not the three the draft named (`createTab`,
  pointercancel, Escape, `resize`, `closeTab`, `adopt-tab`, `tab-moved-away`).
  **The worst case is on the SUCCESS path**: the handler sends `tab-moved-away` to the
  source **before it returns**, so the source's handler would fire `cancelDrag()` →
  `announceTabStatus('Move canceled')` **on a successful cross-window move** — a false
  screen-reader announcement, against the mission's constraint that accessibility
  contracts may only be extended. `drag` is therefore nulled synchronously at
  `pointerup` **exactly as today**; `pendingDrop` carries the round-trip state and is
  **not** what any `cancelDrag()` path touches.
- **`pendingDrop` has a declared freshness contract — it is a cache, and the draft left
  it without one.** *(Found at review pass 2: the exact category error pass 1 hunted,
  arriving through the door the pass-1 fix opened.)* Because all seven cancel sites are
  gated `if (drag)` and `cancelDrag()` early-returns on `!drag`, **nothing could ever
  clear it.**
  - **Source of truth: main.** `pendingDrop` is never consulted for *what happened* —
    only for *whether this reply is still ours*.
  - **Contents**: `{ dropSeq, tabId }` — **no visual state.** Since a refused drop leaves
    the tab at its origin (DD5) and `clearDragVisuals()` still runs at `pointerup`, **no
    transform survives the round-trip.** That is what keeps a second drag's `armDrag`
    snapshot honest: `getBoundingClientRect()` **includes CSS transforms**, so a
    persisted detach visual would make the next drag capture displaced rects and compute
    **silently wrong indices** — the identical failure DD6's transform-only constraint
    exists to prevent, and it is reachable, since a tear-off round-trips through
    `createWindow` (tens of ms). **This property is what makes the design safe, so it is
    stated rather than assumed.**
  - **Invalidation**: `dropSeq` is monotonic; a reply whose `dropSeq` is not current is
    **discarded**. Any strip mutation (`adopt-tab`, `tab-moved-away`, `closeTab`) clears
    it.
  - **A second drop while one is pending is allowed**: it bumps `dropSeq`, the stale
    reply is discarded, and main stays authoritative — if drop 1 succeeded the tab is
    gone and drop 2 refuses on `!entry`. **Self-resolving, never silently dropped.**
  - **Max staleness**: one round-trip. No TTL, and none is needed — `dropSeq` makes
    staleness *unobservable* rather than time-bounded.
- **Mid-drag feedback is chrome-DOM and TRANSFORM-ONLY.** *(Found at review.)* F2's
  `slotRects` snapshot is taken once at arm and stays valid **only because displacement
  is transform-only** — the code says so where it clears them. "Siblings close ranks" via
  width collapse or `display:none` **reflows the strip**, and `dropIndexFromPointer` then
  computes against stale rects **on drag-back-into-strip** — silently wrong indices, no
  cancel, no error. **Transform-only is a constraint, not a style preference.**

**DD7 — `adopt-tab` widens with an optional index; absent means append.**
Today it always appends (`buildStripRecord` → `appendChild`) and activates
(`activateTab`) — **drop-at-position-N is unrepresentable**.
- `{ ..., index?: number }`. **Absent = append**, preserving F6's move-to-new-window
  behavior byte-for-byte and keeping tear-off (which has no meaningful index) on the
  existing path.
- **Serialization premise — audited, and the honest result is that the hazard does NOT
  bite here.** *(Draft dramatized this; review called it "rigor-shaped, not rigorous."
  Corrected rather than deleted, because the audit is what F7 recommendation 2 asks for
  and a negative result is a result.)* Two serializations are genuinely in play — the
  IPC path is **structured clone** (`webContents.send`), the MCP path is
  **`JSON.stringify`** (`serialize` in `mcp-tools.js`, verified). They differ on
  `undefined`-valued keys, Maps, and array own-properties. **None of those differences
  reach this payload**: the adopt payload contains no array and no Map, and **the
  consumer must discriminate with `payload.index === undefined`, never `'index' in
  payload`** — under `=== undefined` both serializations read identically. **That
  discriminator is the DD.** *(Trimmed at review pass 2: the draft warned that an
  MCP-observed `index` assertion would be unfalsifiable. **That path does not exist** —
  the adopt payload travels only `webContents.send`, `index` never crosses the MCP
  boundary, and a drop-at-N behavior test asserts tab **order** via `enumerateTabs`, not
  a payload field. The discriminator stays — it is robust for free — but the
  justification was hypothetical, and dramatizing an unreachable hazard is how
  rigor-shaped prose gets mistaken for rigor.)*

**DD8 — Keyboard equivalence: flat "Move to window …" items keyed by `windowId`.**
**Reversed at review pass 1. The draft invented an opaque-ordinal scheme to protect a
boundary that does not exist on this surface, and the scheme made DD5's refusal
unreachable.**
- **Tear-off's keyboard equivalent already exists**: the tab context menu's "Move to new
  window", reachable via the Context-Menu key path F5 shipped. The mission's word is
  *"keyboard-**reachable** equivalent"*. F8 invents no chord for it.
- **The "renderer never learns windowId" sentence lives in `main.js` and
  `automation/tabs.js`, not in `window-census.js` as the draft cited it three times —
  and it is an AUTHORITY rule, not a confidentiality rule.** Its stated purpose is that
  the registry, not a renderer's claim, decides which window owns a tab — *"that filter
  is what makes a double-count structurally impossible."* It governs **census
  aggregation**. Three proofs it never governed chrome IPC: `window-census.js` **emits**
  `windowId` on every `enumerateWindows` row; `tab-move-to-new-window` **returns**
  `{ ok, windowId }` **to the chrome renderer**; and `renderer-globals.d.ts` **declares
  that return type**. **The chrome renderer is already handed `windowId` by the exact
  handler F8 is factoring.**
- So: main sends `{ windowId, label }[]`; the renderer echoes `windowId` back.
  **Refusal becomes trivial and correct**: `registry.get(windowId)` → `null` → refuse
  (DD5). The ordinal scheme could not do this — to resolve an ordinal at dispatch main
  must either rebuild the list (a closed window shortens it, so the ordinal silently
  means a **different** window — the exact mis-target it forbade), or retain the map
  (**a cache**, which it also forbade). **It manufactured the unreachability DD5
  forbids.**
- **The authority rule still binds**: the renderer's echoed `windowId` is a **request**,
  never a claim of ownership. Main re-validates against the registry and refuses on
  mismatch. That is the rule honored on its own terms.
- Flat items, one per other window, labeled from the target's active tab title. **No
  submenu capability is assumed of the sheet.** No new chord ⇒ no classifier change ⇒
  the `sheet-accelerator.js` ↔ `keydown-action.js` LOCKSTEP PIN is not engaged.

**DD9 — Apparatus: the behavior test proves transport LOGIC; OS pointer delivery is V1 +
HAT. Scoped honestly.**
- **What it CAN do**: DD1 makes the transport read `window.screenX + e.clientX`. A
  synthetic `mouseMove` with `x: 2000` injected into window A's chrome yields
  `e.clientX = 2000` against a real `screenX` — **a global point inside window B**. The
  resolve/adopt path is drivable; the Validator confirms on pixels in both windows.
- **The falsifier, named**: if Chromium **clips injected coordinates to the view
  bounds**, `e.clientX` reads ≤ viewport width and the whole synthetic path is dead.
  → **V5 measures this before leg 6 depends on it.**
- **What it CANNOT do**: prove a **real OS pointer** delivers `pointermove` to window A's
  renderer across window bounds → **V1**, then HAT.
- **The mission's "(behavior-test-backed)" for cross-window drag is therefore partially
  true, and this spec says so.** An overclaimed instrument is the defect, not the
  coverage.
- Apparatus fact carried: a live drag holds **`e.buttons === 0`** on every synthetic
  `pointermove` after the down. **Any F8 handler gating on `e.buttons` will not fire
  under test.**

**DD10 — Every state-asserting AC records TWO readings. (F7 recommendation 1.)**
An AC asserting a state records, in the leg log: the instrument's reading **on the real
artifact** when the property holds, **and** when the artifact is **mutated** so it does
not. **Equal readings, or an unrun mutation ⇒ the AC is NOT discharged.** Template:
F7 leg 4's mutation table (86 / 85+1 / 86).
- **`grep -c` exits 1 on zero matches** — it silently breaks `&&` chains and F7 lost a
  *correct* control that way. **Run each command standalone.**
- Mutations are in-memory or reverted; never committed.
- **This rule now also governs this spec's own citations** (see the header convention).
  Review pass 1's core finding: DD10 was applied to the code under test and **not to the
  instrument the spec itself is made of**.

**DD11 — Per-leg line budgets, not a flight-net target. (F7 recommendation 5.)**
`src/main/main.js` is **3517** lines (measured). Budgets are per leg, stated in each leg
artifact; a leg that would exceed its budget **stops and reports**.

**DD12 — AC27 is re-scoped to the measured footprint, and re-distributed.**
*(Reversed at review. The draft corrected the debrief's list membership while accepting
its derivation — the same proxy substitution, one level up.)*
- **Measured**: `b2d3afc` touched **14** top-level specs — **13 re-pointed + 1 created**
  (`multi-window-automation` is new, +193). *(Precision added at review pass 2: "14
  re-pointed" was the wrong word in the DD whose subject is derivation hygiene.
  Downstream arithmetic is unaffected — the created spec has post-F7 runs and is excluded
  from the 12 either way.)* **12 have no post-F7 run** (only
  `multi-window-automation` and `multi-window-shell` do). The debrief's "five" was its
  own **leg-1 deferral subset** — a proxy for the re-point footprint, not the footprint.
  `tab-surface-geometry` was **never re-pointed** and was never in the set.
- **F8 runs**: `multi-window-shell` (the **owed clean re-run** of the folded spec);
  `tab-context-menu` (**F8 modifies it** — DD8 adds items); `tab-reorder` (**F8's F2
  regression net**); and the new `tab-tearoff-cross-window`.
- **F8 does NOT run, and does not pretend to**: the remaining **11** re-pointed specs
  with no post-F7 run — `closed-tab-reopen` (34 lines re-pointed),
  `find-overlay-geometry` (74), `foreground-to-act` (19), `internal-tab-menus` (14),
  `kebab-menu` (78), `menu-dismissal` (118), `menu-overlay` (60), `omnibox-suggestions`
  (13), `page-context-menu` (12), `popup-jar-inheritance` (9), `tab-cycling` (25).
  **Owner: F10**, which exists to walk every mission behavior test with the operator.
  This is not a deferral of convenience — **F10 is the correct owner by construction**,
  and 11 specs is a flight's worth of work that F8 cannot absorb without the sizing
  objection becoming real.
- **Stale `Last Run: never` headers → leg 6's scrub is repo-wide, not the recon three.**
  *(Corrected at review pass 2.)* The draft carried "3 stale headers" — **a count
  computed over the five-spec universe DD12 had just rejected**, and its membership had
  already shifted underneath it (recon's three included `tab-surface-geometry`, which
  DD12 itself establishes was never re-pointed; within the 14 the third is actually
  `foreground-to-act`). **Repo-wide the real number is 10**: `internal-session-exclusion`,
  `chrome-guest-keyboard-nav`, `internal-tab-menus`, `mcp-loopback-origin-guard`,
  `observe-refusal-contract`, `page-context-menu`, `spellcheck`, `mcp-drive-end-to-end`,
  `foreground-to-act`, `tab-surface-geometry` — **every one carries a `never` header over
  a genuine run log on disk**, plus `kebab-menu`'s stale *date* header. It is a
  mechanical scan and cheap. **Recon's A3 thesis is stronger at 10 than at 3**: the
  header is a proxy that drifts repo-wide, not a one-off slip in five specs.

**DD13 — `getAttachedWindow`/`crossWindow` retirement is coupled to V7 and handed to
maintenance, NOT done here.**
Recon proves it production-dead (`grep -c getAttachedWindow src/main/main.js` → **0**);
the `crossWindow` branch is unreachable because the only `openMenu` call site always
hands an instance its own window's contentView. It survives on **5 unit assertions over
unreachable code**.
- **Why not here**: retiring it deletes the tests that make the DD7 blur gap *look*
  covered. That needs V7's ruling first. F8 records the coupling.

**DD14 — Leg 6 is HIGH-risk. (F7 recommendation 5's new trigger.)**
*A leg that authors the flight's assertions is HIGH-risk* — even writing no product code.
Under F7's tiering leg 6 would be LOW, and F7's leg 4, which authored the `getHistory`
gate, is precisely the leg that shipped the flight's worst defect.

**DD15 — The OS window-move region is a first-class hazard, not a CSS detail.**
*(Entirely missing from the draft; recon flagged it and the spec never referenced it.)*
`#tabstrip-drag` is a `flex:1` spacer that **inherits `-webkit-app-region: drag`** from
the strip — it spans the whole slack between the tabs and the window controls, and **it
is exactly what a torn-off tab must cross.** OS drag regions **do not deliver pointer
events to the renderer.**
- **It interacts with DD1 and could corrupt it silently**: if the OS initiates a
  window-move, `window.screenX` **changes mid-gesture**, so `screenX + e.clientX` drifts
  — and an OS move fires **`'move'`, not `'resize'`**, so the existing resize→`cancelDrag`
  guard **never trips**.
- **V8 settles it** with one probe: does `setPointerCapture` (already set at arm) survive
  the pointer crossing `#tabstrip-drag`, and does the OS take the gesture? Record
  `window.screenX` **before / during / after**.
- **V8 requires V2 as its positive control, and leg 2 must order them.** *(Found at
  review pass 2.)* A `window.screenX` that **never updates** reads identically to "the OS
  didn't take the gesture" — **discrimination zero**, the flight's own named failure.
  V2 (screenX tracks window moves) is what makes V8's null reading interpretable.
- **Predicted outcome: V8 negative — and saying so protects leg 3 from building work it
  won't need.** `-webkit-app-region` hit-testing decides **at pointerdown** whether the OS
  takes a gesture, and F8's drag arms on a `.tab`, which is `no-drag`. Crossing
  `#tabstrip-drag` mid-gesture with the button already held very likely never hands the
  gesture over. **The prediction does not discharge the verdict** — it is recorded so
  that the suppression below is understood as **contingent work**, not planned work.
- If the OS *does* take it: the strip's drag region must be **suppressed for the duration
  of an armed drag** (chrome-DOM only, `no-drag` toggle) — a change with its own
  regression surface on the window-move affordance.

### Prerequisites

- [x] F6's re-parent spike verdict **GO**. DD2 rests on it.
- [x] F7's per-window overlays landed — the registry field is **`sheet`** (not
      `menuOverlay`), and both `sheet` and `findOverlay` are **null-tolerant on a live
      record**.
- [x] `main.js` byte-unchanged since F7 landed (`git diff b2d3afc..HEAD -- src/main/main.js`
      → empty). **Leg 1 lands before any leg edits `main.js`** — the first edit above the
      pair re-drifts the pin.
- [ ] **Apparatus**: a running instance via `npm run dev:automation` (Wayland), the
      committed `tests/behavior/fixtures/tabstrip/` set, admin-tier MCP.
      **Bind-probe for a free port — `ss -ltn` cannot see WSL2 ports held by
      Windows-side listeners.**
- [ ] **Admin keys via env-var reference only, never a command literal** (standing carry).

### Pre-Flight Checklist

- [x] Recon complete, both passes read-only, tree clean at exit
- [x] Empirical DD premises probed before locking
- [x] Upstream artifact errors recorded, not inherited
- [x] **Design review pass 1** — `needs rework`; 5 high, 4 medium. DD8 reversed, DD5/DD6
      contradiction resolved, DD15 added, DD12 re-derived, citations re-anchored.
- [x] **Design review pass 2** — `approve with changes`; 7 of 9 pass-1 fixes verified at
      the artifact, 3 new HIGH found (DD3's false-positive hazard, `pendingDrop`'s
      missing cache contract, V5 absent from the gate list) and 1 pass-1 issue **not**
      fixed (DD5's sole-tab rationale was false against source). All applied above.
      **Leg 1 ruled GO and unblocked** — its premises verify independently and nothing in
      the rework touches it.
- [x] **Max design-review cycles reached (2).** No issue is escalation-worthy: the final
      review is `approve with changes`, every change is applied, and the residual open
      items are **empirical verdicts owned by leg 2**, not unresolved design.

---

## In-Flight

### Technical Approach

The gesture stays where F2 put it — pointer events in the chrome renderer, one drag
session, `slotRects` snapshotted at arm, **transform-only displacement**. Three things
change.

**The drag model gains a second axis and a zone.** `tab-order.js` keeps
`dropIndexFromPointer` unchanged (F2's contract is pinned and passing); a **new pure
module** owns zone classification from a 2-D point. Within the strip → reorder, exactly
as today. Outside → detach-pending, rendered chrome-DOM-only and transform-only.

**The drop resolves in main, from one global point.** The renderer sends
`{globalX, globalY}` at drop; main hit-tests window bounds and returns a discriminated
outcome — adopt into window B at index N, tear off, or refuse. `drag` is still nulled
synchronously at `pointerup` and `clearDragVisuals()` still runs there; for an
out-of-strip drop `commitTabMove` is simply not called, so **the tab is already at its
origin before any reply lands** — a refusal is announced, not animated. A separate
`pendingDrop` carries only `{dropSeq, tabId}` across the round-trip, untouched by any
`cancelDrag()` path, so **no transform survives to poison the next drag's rect
snapshot**. The `tab-move-to-new-window` monolith is **factored** into a reusable move
core — **which must stay synchronous, and drags leg 1's pin with it** — and both tear-off
and cross-window adopt call it, with the menu path keeping its exact behavior via the
append default.

**The keyboard equivalent rides the existing menu.** Flat "Move to window …" items keyed
by `windowId` — no new chord, no classifier change, no lockstep.

### Checkpoints

- [ ] Leg 1: the DD1 pin fails a **mutated** `main.js` and passes the real one — **both
      readings recorded** (DD10)
- [ ] Leg 2: all **8** verdicts recorded — **V1, V4, V5, V8** are the gates
      *(V5 was a gate in DD9's own text and appeared in neither list — revised-vs-
      unrevised drift, found at review pass 2)*
- [ ] Leg 3: dragging within the strip still reorders (F2 regression); `tab-order.js`
      untouched; displacement provably transform-only
- [ ] Leg 4: a tab lands in window B **at the drop index**, same wcId, jar pill intact —
      on **pixels in both windows**; **no "Move canceled" announcement on the success
      path**
- [ ] Leg 5: "Move to window …" moves the tab; a window closing mid-menu **refuses**
- [ ] Leg 6: new spec green; `multi-window-shell` clean re-run; `tab-context-menu` and
      `tab-reorder` green

### Adaptation Criteria

- **V1 negative (no `pointermove` to the source over another window)** → cross-window
  **drag** is unreachable by real gesture. The flight lands tear-off + the keyboard
  path. **This is a mission-level re-opening, not only a HAT ruling** *(corrected at
  review — the draft claimed the keyboard path "satisfies the criterion's substance")*:
  the mission criterion reads *"A tab **dragged** from one window's strip into another
  window's strip moves there"* — **the drag is the subject**, and the keyboard criterion
  is a separate line item. Under V1-negative that criterion goes **unsatisfied** and the
  mission must say so.
- **V1 must also record `pointerup` delivery** *(gap found at review)*: if capture is
  broken by the OS, the source may get neither move nor up → **`drag` never clears → a
  stuck drag with the tab frozen mid-gesture.** DD5 claims every outcome is defined; a
  **pointer-lost outcome** is required (a capture-loss / `lostpointercapture` path that
  cancels cleanly).
- **V4 negative** → cross-window drop degrades to tear-off (DD3). Same re-scope.
  **V4 ambiguous (two or more records reporting identical origins)** → the hit-test
  **refuses**, per DD3's guard. A typings-conformant platform loses cross-window drag
  with a visible refusal rather than a silent wrong-window adopt.
- **V5 negative (Chromium clips injected coordinates to the view bounds)** → the
  synthetic cross-window path is dead, and **leg 6's `tab-tearoff-cross-window` spec
  cannot verify the cross-window half at all**. The flight's behavior-test story for that
  half collapses to **HAT**, and the spec must say so in its own text rather than
  verifying a reachable subset and reading as though it covered the feature. Tear-off
  (single-window) remains fully verifiable either way.
- **V8 positive (the OS takes the gesture)** → DD15's `no-drag` suppression lands in
  leg 3, with its own regression surface on window-move.
- **V7 either way** → recorded with its scope stated. F8 does not inherit the gloss.
- Leg 4 over its `main.js` budget → **stop and report**.

### Legs

1. **`01-dd1-pin-and-test-helper`** — *(risk: **HIGH**)* Extract
   `maskComments`/`findMatchingBracket` to a shared test helper (`findMatchingBracket` is
   byte-identical across the two suites; `maskComments` is code-identical but
   text-divergent — **someone must rule which docstring survives**; "verbatim" was the
   draft's own unverified word). Land the DD1 synchrony pin, anchored on the
   `'tab-move-to-new-window'` **string literal** — never a line number, and **never the
   `F8` tag** (`grep -c "F8" src/main/main.js` → **17**, all M05/M06-era; two are real
   ordering pins, so "zero signal" would overstate — **none are about this invariant**).
   Land the comment at the site. Fix AC7 by masking.
   **The pin needs a VACUITY GUARD, and leg 4 is the reason.** It must assert that the
   delete/set pair **was found** inside the anchored body — not merely that no `await`
   was found between them. Leg 4 factors the move core **out of this handler**; if the
   pair moves to a helper, an unguarded pin finds an anchor with no pair in it and
   **passes on an empty body**, retiring itself silently at the exact moment the code it
   protects is most exposed. Guarded, leg 4's factoring **fails loudly** and forces the
   pin to be re-anchored to the pair's new home — which is the correct outcome.
   **Tier rationale (reviewed and upheld)**: a subtly broken `maskComments` does not
   fail — it **passes vacuously**, silently retiring two architectural pins while staying
   green. That is the repo's highest-consequence failure shape; DD10 is the mitigation.
   **Lands before any leg edits `main.js`.**
2. **`02-transport-spike`** — *(risk: **HIGH** — gates the flight)* Eight verdicts:
   **V1** out-of-window `pointermove` **and `pointerup`** delivery (**the gate**);
   **V2** `screenX + clientX` cross-window consistency; **V3** `getCursorScreenPoint()`
   → `{0,0}`, confirmed in-rig then banned; **V4** `getBounds()` hit-test — **three
   readings** (inside B → B; empty desktop → none; **two windows at known-different
   positions → DIFFERENT records**, the reading that catches DD3's false positive);
   **V5** `sendInputEvent` synthetic cross-window drag **and whether Chromium clips
   injected coordinates to the view bounds** (a gate — DD9's named falsifier); **V6**
   `setPosition` placement, **read back**; **V7** does drag-driven activation deliver real
   OS blur under WSLg where **scripted** `focus()` does not (note the qualifier the
   debrief's gloss dropped); **V8** `#tabstrip-drag` / OS window-move, recording
   `window.screenX` before/during/after — **ordered AFTER V2, which is its positive
   control** (a screenX that never updates reads identically to "the OS didn't take it").
3. **`03-drag-zone-model`** — *(risk: **HIGH**)* New pure `src/shared/` zone module;
   `drag` gains `startY`; **transform-only** detach-pending feedback; `pendingDrop`
   introduced distinct from `drag`, **with DD6's `dropSeq` contract**. **Assert DD6's
   cancel-path claim against the real call sites** — there are **seven**, and the draft
   named three, all mis-cited. **DD15's `no-drag` suppression is CONTINGENT on V8 —
   do not pre-build it** (V8 is predicted negative; `-webkit-app-region` decides at
   pointerdown and the drag arms on a `no-drag` `.tab`).
4. **`04-drop-resolution`** — *(risk: **HIGH**)* Factor the move core out of the
   `tab-move-to-new-window` handler; main-side hit-test **with DD3's identical-origins
   guard**; `adopt-tab` index; tear-off placement; the **eight-condition** discriminated
   refusal (six inherited + target-absent + hit-test-ambiguous).
   **The factored move core MUST stay synchronous, and leg 1's pin must still cover it.**
   Leg 1 pins the *handler*; **factoring is exactly the edit that could move the
   delete/set pair into a helper and make it async without anyone noticing** — the pin
   must follow the pair, not the handler's name. **`renderer-globals.d.ts` must change
   with the return shape** — `npm run typecheck` is a completion gate. **`main.js` budget
   stated in the leg.**
5. **`05-keyboard-equivalent`** — *(risk: **MEDIUM**, downgraded from HIGH once DD8
   collapsed)* Flat "Move to window …" items keyed by `windowId` over leg 4's move core;
   stale-window refusal via `registry.get`. No new architectural boundary is crossed.
6. **`06-verification-and-artifact-debt`** — *(risk: **HIGH** per DD14)* New
   `tab-tearoff-cross-window` spec (honestly scoped per DD9); the owed clean
   `multi-window-shell` re-run; `tab-context-menu`; `tab-reorder`. Plus the artifact
   debt moved here at review (it is artifact work, and not `main.js`-coupled): the
   **repo-wide leaked-wrapper scan** (recon found **3 more** instances in mission 03 that
   the debrief's "delete 2 lines" would have left live — and the FD reproduced the defect
   while writing this flight's own log), the `renderer.js` kebab comment (four → six,
   naming `new-window` and `jars`), the AC27 record correction, and the **repo-wide
   stale-header scrub — 10 specs, not the 3 the draft carried** (DD12).
   **Under V5-negative the new spec covers tear-off only**, and says so in its own text
   rather than verifying a reachable subset and reading as though it covered the feature.

> **Six legs, upheld at review.** Legs 2-5 are one decision cluster (DD1→DD3→DD6→DD5→DD7
> are mutually entailed) plus a mission constraint that *couples* leg 5 to them rather
> than merely bundling it. The draft's proposed cut (leg 5 + half of leg 4 → an F8b) is
> **exactly the V1-negative adaptation outcome** — already encoded as an empirical gate at
> leg 2. Pre-cutting spends the option value of V1-positive for nothing.

---

## Post-Flight

### Completion Checklist

- [ ] All legs `completed`
- [ ] `npm test`, `npm run lint`, `npm run typecheck`, `npm run a11y` green
- [ ] **`git add -A` — never `-a`/`add -u`** (they would have silently dropped **four
      product source files** in F7). **Verify `git status --porcelain` is empty after.**
- [ ] Every DD10 mutation reverted; no mutation committed
- [ ] Mission flight list updated with the honest outcome, including any V1/V4/V8 re-scope
      — and a **mission-level** entry if V1 is negative

### Verification

- **Unit**: the DD1 synchrony pin (both readings); zone-model purity; the `screen`-module
  ban; stale-window refusal.
- **Behavior**: `tab-tearoff-cross-window` (new); `multi-window-shell` (owed clean
  re-run); `tab-context-menu` (F8 modifies it); `tab-reorder` (F2 regression net).
- **Named gap (DD9)**: the spec proves the **transport logic** via synthetic events.
  **Real OS pointer delivery across window bounds is V1 + HAT**, and the spec says so in
  its own text.
- **Not verified here, by ruling (DD12)**: 11 re-pointed specs with no post-F7 run,
  enumerated by name and re-point size, owned by F10.
