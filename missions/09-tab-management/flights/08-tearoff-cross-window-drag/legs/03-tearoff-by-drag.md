# Leg: 03-tearoff-by-drag

**Status**: landed
**Flight**: [Tear-off and Cross-Window Drag](../flight.md)

## Objective

Dragging a tab out of the strip and releasing tears it off into its own new window,
keeping the same live `webContents`, its jar, and its page state — using **window-local
coordinates only**.

## Context

**Re-scoped at leg 2.** This leg merges the former legs 3+4: with cross-window drop
deferred (the transport is a cached fiction — see the flight log's *Flight Director
Rulings on Leg 2*), the old leg 4's substance **was** the hit-test, and it is gone.

**Tear-off survives the spike intact because it never needed a shared coordinate space.**
"Did the pointer leave the strip?" is answered entirely inside the source window's own
viewport.

**Design decisions in force**: **DD16** (window-local only — nothing reads `screenX`,
`getBounds`, `getPosition`, or `screen`), DD2 (live re-parent), DD5 (every outcome
defined), DD6 (drop-commit + `pendingDrop` + transform-only), DD7 (`adopt-tab` append
default), DD10 (two readings), DD11 (line budget).
**DD15 is STRUCK — do NOT build the `no-drag` suppression.**

## Inputs

- `src/renderer/renderer.js` — F2's drag: `pointerdown` arms on a `.tab` (button 0);
  document-level `pointermove`/`pointerup`/`pointercancel`; `DRAG_ARM_THRESHOLD_PX = 5`
  on `Math.abs(dx)`; `slotRects` snapshotted once in `armDrag` via
  `getBoundingClientRect()`; displacement is **transform-only**; `drag` has `startX` and
  **no `startY`**.
- `src/shared/tab-order.js` — `moveIndex`, `keyboardMove`, `dropIndexFromPointer(slotRects,
  pointerX, draggedIndex)`. **Pinned and passing. Its contract does not change.**
- `src/main/main.js` — `ipcMain.handle('tab-move-to-new-window', ...)`, **synchronous**,
  pinned by leg 1's `test/unit/move-tab-synchrony.test.js`.
- **Seven** `cancelDrag()` call sites: `createTab`, `pointercancel`, Escape, `resize`,
  `closeTab`, `adopt-tab`, `tab-moved-away`.
- `test/helpers/source-scan.js` — leg 1's extracted toolkit.

## Outputs

- A new pure `src/shared/` zone module + its unit tests.
- `src/renderer/renderer.js` — `startY`, zone classification, detach-pending feedback,
  `pendingDrop`.
- `src/main/main.js` — the move core factored out; tear-off entry point.
- The `renderer.js` pointer-capture comment corrected.
- Leg 1's DD1 pin **re-anchored** to the move core's new home.

## Acceptance Criteria

> **DD10 governs: two readings per state-asserting AC — the instrument on the real
> artifact when the property holds, and mutated so it does not. Equal readings, or an
> unrun mutation, means NOT discharged. Run each `grep -c` STANDALONE.**

> **Tick discipline, applied at F8's flight-end review.** An AC is ticked only where the
> readings **the AC itself specifies** were taken **by this leg**. Where the leg took a
> weaker reading than the AC asks for, the box stays open and says which half is missing —
> **pinning the code shape is not discharging a runtime AC**, and that is this flight's own
> diagnosed failure class. Where a *later* leg took the reading, the box stays open with a
> pointer to it (leg 4's convention, unchanged).

- [x] **AC1 — the zone model is a pure module with no Electron and no globals.** New
      `src/shared/` module classifying a **window-local** point into `reorder` (with an
      index, delegated to `dropIndexFromPointer`) or `tearOff`.
      **Two readings**: `grep -c "require('electron')"` on it, **masked** → **0**, and
      **masked** `grep -c "screenX\|getBounds\|getPosition\|screen\."` → **0**. Mutate the
      module in memory to add one such read → **≥1**. *(Masked, per leg 1's AC9: a naive
      grep reads 1 on a comment and has discrimination zero.)*
- [x] **AC2 — `tab-order.js`'s contract is untouched.** `git diff src/shared/tab-order.js`
      → **empty**. Its existing tests pass unchanged.
- [x] **AC3 — dragging WITHIN the strip still reorders (the F2 regression).** All existing
      `tab-order` and drag tests pass. The zone module returns `reorder` with **exactly
      the index `dropIndexFromPointer` returns** for every in-strip point.
      **Two readings**: an in-strip point → `reorder`; the same x with y below the strip →
      `tearOff`. **The y-axis must change the answer** — if both return `reorder`, the
      zone model is not reading y and the AC is not discharged.
- [ ] **AC4 — detach-pending feedback is chrome-DOM and TRANSFORM-ONLY.** When the pointer
      leaves the strip, the dragged tab renders a "will detach" state and siblings close
      ranks **via transforms only**.
      **Two readings**: after entering detach-pending and returning to the strip, a
      **fresh** `getBoundingClientRect()` on a sibling is **byte-identical** to its
      `slotRects` entry. Mutate the feedback to collapse width instead → the rects
      **differ**. *(`getBoundingClientRect()` **includes transforms**; a reflow silently
      invalidates the snapshot and `dropIndexFromPointer` then computes wrong indices on
      drag-back — no cancel, no error.)*
      **PARTIAL — the CODE SHAPE is discharged with both readings; the RUNTIME rect reading
      was NOT taken, by this leg or any later one.** `tab-drag-invariants.test.js` pins that
      the drag section writes **no** layout property (real **0** → `style.width='0px'` → **1**)
      and that the `.tab.detaching` CSS rule carries **no** layout declaration (real **0** →
      `width: 0` → **1**) — the second is what the JS scan cannot see, since a class-delivered
      reflow reads 0 layout writes in the JS. But *"a **fresh** `getBoundingClientRect()` on a
      sibling is byte-identical to its `slotRects` entry"* is a **runtime** reading and this
      repo has **no DOM harness** (bare `node --test`, no jsdom). **Leg 5 did not take it
      either** — no `tab-tearoff` row compares a live rect to the snapshot. **Genuinely owed.**
- [ ] **AC5 — `pendingDrop` is separate from `drag` and carries no visual state.**
      `drag` is nulled **synchronously** at `pointerup` exactly as today;
      `clearDragVisuals()` still runs there; `commitTabMove` is **not** called for a
      tear-off drop. `pendingDrop = {dropSeq, tabId}`, monotonic, stale replies discarded,
      cleared on strip mutation.
      **Two readings**: after a tear-off `pointerup` and **before** the reply lands, `drag`
      → **null** and a fresh sibling rect is **untransformed**. A design where the visual
      persists → the rect **differs**.
      **PARTIAL — the STRUCTURAL half is discharged; the RUNTIME rect reading was NOT taken.**
      `tab-drag-invariants.test.js` pins on the real `renderer.js`: the `pointerup` listener
      is not `async` and contains **no** `await` before `drag = null` (so the nulling is
      synchronous), `clearDragVisuals()` still runs there, `commitTabMove` is **not** called
      on the tear-off branch, `pendingDrop` is **exactly** `{dropSeq, tabId}`, and **no**
      assignment to it carries `transform`/`classList`/`btn`/`style`. *"A fresh sibling rect
      is untransformed **before the reply lands**"* is a **runtime** reading against a
      round-trip window — **not taken**, same missing instrument as AC4. **Owed with AC4.**
- [ ] **AC6 — no "Move canceled" is announced on the SUCCESS path.** The handler sends
      `tab-moved-away` to the source **before it returns**; with `drag` null the source's
      `cancelDrag()` early-returns and announces nothing.
      **Two readings**: a successful tear-off → `announceTabStatus` called with a **move**
      message, never `'Move canceled'`. Mutate so `drag` survives the round-trip →
      `'Move canceled'` **fires on a successful move**. *(This is the accessibility bug
      the design review caught; the AC pins that it stays fixed.)*
      **RUNTIME — not this leg's reading. DISCHARGED BY LEG 5**, `tab-tearoff` rows 4 and 8:
      the per-record recorder captured **exactly** `['Tab moved to a new window']` on the
      tear-off and a sequence containing `'Tab moved to another window'` and **not**
      `'Move canceled'` on the keyboard path — **the path DD6 names as the worst case**. The
      row asserts the **whole sequence**, never the final value, because the live region never
      clears. *(Named here rather than ticked from code shape — leg 3 has no DOM harness.)*
- [x] **AC7 — DD6's cancel-path claim is ASSERTED, not assumed.** A test enumerates the
      `cancelDrag()` call sites in `renderer.js` and asserts the count.
      **Two readings**: real → **7**; mutate to add an eighth → **8**, test **fails**.
      *(The draft named three, all mis-cited. An enumeration preserves arity even when it
      corrupts content — that is what a downstream re-derivation needs.)*
- [x] **AC8 — the move core is factored out and STAYS SYNCHRONOUS; leg 1's pin is
      RE-ANCHORED.** Both tear-off and the existing menu path call one core.
      **Leg 1's pin anchors on the `'tab-move-to-new-window'` handler; this leg moves the
      delete/set pair out of it.** Leg 1's vacuity guard therefore **FAILS** — that is the
      designed outcome, not a regression.
      **Two readings**: run the pin **before** re-anchoring → **FAILS** (pair not found in
      the anchored body — record the message). Re-anchor to the core's new home → **passes**,
      and the `async` and `await`-between mutations **still fail it**. **If the pin passed
      unchanged after factoring, its guard is broken — report that as a leg-1 defect.**
- [x] **AC9 — the existing menu path is byte-identical in behavior.** "Move to new window"
      from the tab context menu produces the same result as before: same wcId, jar intact,
      `adopt-tab` with **no index** (append). `tab-context-menu`'s existing coverage passes.
- [ ] **AC10 — tear-off refuses per DD5, and announces.** Sole tab → refused, tab stays at
      origin, **announced**. Internal/trusted tab → refused, announced. **No bare `null`
      reaches the renderer as silence.**
      **Two readings**: a refused drag → `announceTabStatus` called; the tab's index in
      `orderedTabIds()` **unchanged**. A successful one → index changes.
      **PARTIAL — the code shape is pinned here; the RUNTIME readings are LEG 5's.**
      `tab-drag-invariants.test.js` pins that the move core returns **no** bare `return null`
      (real **0** → sole-tab-returns-null mutation → **1**) and that the outcome→message map
      is **total** over the core's result union, so silence is unreachable *by construction* —
      a weaker property than the AC states. **Leg 5 took the stated readings**: `tab-tearoff`
      row 6 (sole tab → no third window, tab at its origin index, recorder captured exactly
      `['Cannot move the only tab to a new window']`) and row 7 (internal tab → refused,
      announced, S still at its origin index in the strip's DOM order).
- [ ] **AC11 — the torn-off tab keeps its identity.** Same `wcId` (no destroy/recreate),
      same jar/partition, live history intact (`goBack` works). **This is DD2's claim and
      the mission's absolute constraint.**
      **RUNTIME — not this leg's reading; nothing here touches it. DISCHARGED BY LEG 5**:
      T2 kept **`wcId 4`** and jar **`work`** across the tear-off (only `windowId` changed
      1→2), `history.length` held at **2**, and `goBack` (polled, 52ms) landed on page 2 with
      **both** committed markers. **`multi-window-shell` step 5 corroborated independently** —
      the moved tab kept `wcId 4` where a recreate would have minted ≥10, and **step 8's
      reopens mint 11 and 12 on that very path, so each is the other's control.** *(Leg 5 also
      folded an FD overclaim: the jar leg refutes **recreation** not at all — a tab recreated
      in the same partition reads `jarId: 'work'` identically. **TWO** independent observables,
      not three.)*
- [x] **AC12 — `renderer.js`'s pointer-capture comment is corrected.** The spike measured
      `hasPointerCapture()` **false throughout** and `e.target` = the root: **F2's drag
      works only because the listeners are document-level**, not because capture retargets
      anything. The comment claims the opposite and is **the hypothesis V1 was warned not
      to read as evidence**. Correct it to what was measured.
- [ ] **AC13 — gates green.** `npm test` (state the delta), `npm run lint`, `npm run
      typecheck`, `npm run a11y` — each **standalone**.
      **PARTIAL — three of four green; `npm run a11y` DID NOT RUN.** `npm test` **1867 pass /
      0 fail** (was 1841 — **+26**); `npm run lint` clean; `npm run typecheck` clean. **a11y
      needs a live GUI instance and an automation admin key, and it exits 1 on the MISSING
      KEY, not on a violation** — so a red here means *"no instrument"*, not *"a11y is
      broken"*. **Recorded as NOT RUN, never as green** (*not run ≠ green*). Leg 5 took both
      readings on the live rig and the exit-code defect is now a **mission Known Issue**.

## Line Budget (DD11)

- `src/main/main.js`: **net ≤ +40**. Currently **3525** (3517 + leg 1's 8). Factoring
  should move lines out, not add. **Exceed ⇒ stop and report.**
- `src/renderer/renderer.js`: **≤ +90**.
- New pure module: **≤ 120** including its header.

## Out of Scope

- **Cross-window drop / hit-testing / any global coordinate** — deferred at leg 2 (DD16).
- **DD15's `no-drag` suppression** — STRUCK.
- Keyboard "Move to window …" — leg 4.
- Behavior specs — leg 5.

## Verification Steps

1. Each of AC1, AC3-AC8, AC10's mutations run, **both numbers in the flight log**.
2. AC8's before/after pin readings recorded — **especially the FAIL before re-anchoring**.
3. Budgets checked and reported.
4. `git status --porcelain` — no mutation artifacts.
