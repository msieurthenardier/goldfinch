# Leg: 01-f8-debt-and-move-core-fix

**Status**: completed
**Flight**: [Session Restore](../flight.md)

## Objective

Land the F8 carry-forward debts that sit on paths this flight is adjacent to — the move-core
structural fix (DD8), the extracted `shouldArm` arm-threshold predicate + its first unit test,
and two artifact-hygiene items — so the feature legs build on a clean base.

## Context

**Risk: HIGH (recorded in flight-log Flight Director Notes).** The move-core change is a
state-machine/lifecycle edit on the multi-window active-tab path, and it reverses a design
compensation F8 shipped deliberately (the pre-set + hand-compensation). Per `/agentic-workflow`
2a this leg gets its own design review.

**DD8 (corrected at flight design review):** the move-core fix is **genuine F8 debt**, NOT a
restore prerequisite — restore creates tabs fresh (DD4) through `tab-set-active`'s **armed**
guard, which never pre-sets. It lands here organizationally (bundle the F8 code-shaped debts).

**The move-core defect (F8 HIGH-1 + its residual):** `moveTabIntoWindow`
(`src/main/main.js`) pre-sets `target.activeTabWcId = p.wcId` (currently `main.js:2915`), which
**disarms** the incoming `tab-set-active` guard `owner.activeTabWcId !== null && owner.activeTabWcId !== wcId`
(currently `:3099` menu-close branch and `:3112` hide branch). That one guard gates **two**
effects — hiding the displaced tab AND `closeMenuOverlay('tab-switch')`. To compensate, the core
hand-mirrors **both** synchronously before the pre-set (`:2894–2914`). The pattern
*"disarm a guard, then hand-compensate for what it guarded"* is a latent-defect generator: it
already produced HIGH-1 (double-active) and its residual (the re-shown stale menu). The pre-set's
only legitimate job is a **transient caption**: `broadcastMoveTargetsChanged()` (`:2941`) reads
each window's `activeTabWcId` to title its move-target menu items.

## Inputs

- `src/main/main.js` — `moveTabIntoWindow` (`:2809`), the pre-set (`:2915`), the hand-compensation
  (`:2894–2914`), `broadcastMoveTargetsChanged` (`:366`), the `tab-set-active` handler (`:3045`,
  armed guard at `:3099`/`:3112`, caption broadcast at `:3119–3125`).
- `src/renderer/renderer.js` — `const DRAG_ARM_THRESHOLD_PX = 5;` (`:1423`);
  `if (Math.hypot(dx, dy) < DRAG_ARM_THRESHOLD_PX) return;` in the document `pointermove` listener
  (`:1558`); the existing ESM import of `tab-drag-zone.js` (`:22`).
- `src/shared/tab-drag-zone.js` — pure, ESM, exports `classifyDragPoint`; the intended home for
  `shouldArm` (its header already names the WINDOW-LOCAL coordinate discipline).
- `test/unit/tab-drag-zone.test.js` — house pattern (pure module, `require`d directly, masked
  source-scans); add `shouldArm` cases here.
- `test/unit/tab-drag-invariants.test.js` — the `CALL_RE` comment (`:58–59`).
- `test/helpers/source-scan.js` — `maskComments` / `findMatchingBracket` for any absence scan.
- F8 leg files under `missions/09-tab-management/flights/08-tearoff-cross-window-drag/legs/`.

## Acceptance Criteria

> **DD10: two readings per state-asserting AC, on the real artifact, both directions. Run each
> `grep -c` STANDALONE. Use MASKED greps for absence claims.**

- [x] **AC1 — the move-core no longer pre-sets `target.activeTabWcId` into a disarmed guard.**
      **Fix decided at design review: Fix 2, WITHOUT the caption override.** Remove **only** the
      pre-set (`:2915`); **keep** the synchronous hide (`prevActive.view.setVisible(false)` +
      `prevActive.active = false`) and `target.sheet?.closeMenuOverlay('tab-switch')` in the core
      (so the target is never two-guests-visible in the interim — the property that keeps leg 4's
      row 8a from flaking). Do **not** thread a caption override into `broadcastMoveTargetsChanged`
      / `move-targets.js` — the transient stale target-window caption is **doctrine-sanctioned
      cosmetic** (`move-targets.js` AUTHORITY: a stale label "can never mis-target") and
      **self-heals** on the round-trip's caption broadcast (`main.js:3125`). This keeps the change
      **main.js-only** and `move-targets.js` untouched (out of scope).
      **Two readings (masked, standalone):** `grep -c "target.activeTabWcId = p.wcId"` over
      `moveTabIntoWindow` → **0** after; mutate it back → **1**. The disarming pre-set is gone.
- [x] **AC1b — rewrite the now-false hand-compensation comment (`main.js:~2874–2913`).** Its
      current justification — *"the adopt round-trip CANNOT do the hide/close because the pre-set
      disarms the guard"* — becomes **false** once the pre-set is gone (the round-trip's guard is
      then armed and *would* do them). Rewrite the reason to: *the round-trip is **async**, so the
      core hides the displaced guest and closes the menu **synchronously** to keep the interim
      single-active/single-visible; the round-trip's now-armed guard re-does both idempotently.*
      Leaving the stale comment violates the repo's no-misleading-comment discipline.
- [x] **AC2 — the displaced-tab hide and the menu-close are still guaranteed on the
      move-into-existing-window path.** No window ends with two `active: true` tabs; no stale
      menu is re-shown. **Runtime proof is leg 4's `tab-tearoff` row 8a + the displaced-menu
      residual** (this repo has no main-process harness — `main.js` is never executed). This leg
      pins the **code shape**: a masked source-scan over `moveTabIntoWindow` asserts **both** that
      the pre-set is gone (AC1) **and** that the core still contains the synchronous
      `setVisible(false)` **and** `closeMenuOverlay('tab-switch')`; a mutation deleting **either**
      compensation breaks the pin. State honestly in the flight log that the runtime reading is leg 4's.
- [x] **AC3 — `shouldArm(dx, dy)` is a pure `tab-drag-zone.js` export, and `renderer.js` calls it.**
      Add `export function shouldArm(dx, dy)` returning `Math.hypot(dx, dy) >= DRAG_ARM_THRESHOLD_PX`
      (move the constant into the module as an export, or keep a single source of truth — design
      review confirms). Replace `renderer.js:1558` with `if (!shouldArm(dx, dy)) return;`.
      **Two readings:** `grep -c "export function shouldArm" src/shared/tab-drag-zone.js` → **1**;
      `grep -c "Math.hypot" src/renderer/renderer.js` → **0** after (`Math.hypot` occurs only at
      `:1558`; the expression moved). **Note:** `DRAG_ARM_THRESHOLD_PX` is also named in two
      renderer **comments** (`:1257`, `:1414`) besides its def (`:1423`); when the definition moves
      into `tab-drag-zone.js`, update or knowingly leave those two comments (they'll name a constant
      no longer defined in that file) — record the choice so the mutation-grep author isn't surprised.
- [x] **AC4 — `shouldArm` has a both-directions unit test that exercises the straight-down case
      the F8 change was made for.** In `test/unit/tab-drag-zone.test.js`: `shouldArm(0, 6) === true`
      (straight-down arms — `dx=0`, the exact case `Math.abs(dx)` could never arm), `shouldArm(0, 4) === false`
      (below threshold, straight down), plus `shouldArm(6, 0) === true` / `shouldArm(4, 0) === false`
      (lateral, both directions), boundary `shouldArm(0, 5) === true` (`>=`), and `shouldArm(3, 4) === true`
      (hypot = 5). **This converts the F8 lateral gap from "owed forever, needs a rig" to a unit pin.**
- [x] **AC5 — the `CALL_RE` comment off-by-one is corrected.** In
      `test/unit/tab-drag-invariants.test.js` (`:58–59`): `NINE` → `TEN`, `one prose mention` →
      `two prose mentions`. **Verify first:** `grep -c "cancelDrag()" src/renderer/renderer.js`
      (naive, unmasked) → **10** (7 calls + `function cancelDrag() {` + 2 prose mentions). The
      `CALL_RE` regex and the test's `7` assertion are correct — **comment only**.
- [x] **AC6 — F8 leg files confirmed against their logs (a confirmation pass; likely ZERO edits).**
      Design review found F8 leg 3 is **already thoroughly reconciled** — its unticked runtime ACs
      carry the correct disposition (some "genuinely owed, no DOM harness"; others "DISCHARGED BY
      LEG 5" with pointers already in the file), corroborated by the F8 log. So this AC is a
      **confirmation**: verify the leg-5 pointers resolve and no case has the log saying "pass"
      while the file lacks a pointer. **It is legitimate for this AC to produce zero file edits** —
      record that finding in the flight log rather than manufacture a change. Do **not** fabricate
      ticks; do **not** rewrite F8 log bodies (an inspection record is a snapshot).
- [x] **AC7 — gates green.** `npm test` (state the delta from 1892), `npm run lint`,
      `npm run typecheck` — each **standalone** (`grep -c` exits 1 on zero and breaks `&&` chains).

## Out of Scope

- Session-restore code (legs 2–3). The `session-store` and snapshot builder do not exist yet.
- Behavior-test runs (`tab-tearoff` row 8a, `tab-reorder` Step 4) — leg 4 owns the live rig.
- `npm run a11y` — no chrome-DOM change here; leg 4 runs it once on the final tree.

## Verification Steps

1. Every mutation reading — **both numbers in the flight log**, masked where it's an absence claim.
2. State plainly in the flight log that AC2's runtime reading is leg 4's (no main-process harness).
3. `git status --porcelain` — only the intended files changed; no stray artifacts.

## Files Affected

- `src/main/main.js` — move-core fix (AC1/AC2).
- `src/shared/tab-drag-zone.js` — `shouldArm` + threshold export (AC3).
- `src/renderer/renderer.js` — call `shouldArm` (AC3).
- `test/unit/tab-drag-zone.test.js` — `shouldArm` cases (AC4).
- `test/unit/tab-drag-invariants.test.js` — `CALL_RE` comment (AC5).
- F8 leg files (reconciliation only, AC6).

## Line Budget (DD11 — CODE lines, comments excluded)

- `src/main/main.js`: **≤ +15 code** (net; the fix may *remove* lines). Exceed ⇒ stop and report.
- `src/shared/tab-drag-zone.js`: **≤ +8 code**.
- `src/renderer/renderer.js`: **~0 net** (one call swapped for another).

---

## Post-Completion Checklist

- [x] All acceptance criteria verified (AC2 runtime reading explicitly deferred to leg 4, stated)
- [x] Tests passing (1902 pass / 0 fail / 0 skipped — delta +10 from 1892)
- [x] Update flight-log.md with leg progress entry (both readings per mutation AC)
- [x] Set this leg's status to `completed`
- [x] Check off this leg in flight.md
- [x] Do NOT commit (flight-end review + single commit per `/agentic-workflow`)
