# Leg: 04-keyboard-cross-window-move

**Status**: landed
**Flight**: [Tear-off and Cross-Window Drag](../flight.md)

## Objective

A tab moves from one window into another by a keyboard-reachable menu command, keeping
its jar identity and live page state — the only way a tab crosses windows in F8.

## Context

**This leg carries the mission criterion's surviving substance.** Leg 2 measured that
Electron's cross-window coordinates on this rig are a **cached fiction**, so the
cross-window **drag** is deferred (flight log → *Flight Director Rulings on Leg 2*). The
criterion's *gesture* is unsatisfied; its *outcome* — a tab moves A→B with jar and page
state intact — ships **here**.

**This leg needs no coordinates at all**: menu → `windowId` → main. That is why it
survives a spike that killed the transport.

**Design decisions in force**: **DD8** (flat items keyed by `windowId`; the ordinal
machinery was reversed at review), DD5 (every outcome defined; refusal is **announced,
not animated**), DD2 (live re-parent), DD7 (`adopt-tab` append default), DD10, DD11.

**DD8's boundary ruling, settled at review**: the *"the renderer is authoritative only for
url/title/jarId and **never learns windowId**"* sentence lives in **`main.js`** and
**`automation/tabs.js`** — **not** `window-census.js` — and it is an **AUTHORITY** rule
(the registry, not a renderer's claim, decides which window owns a tab: *"that filter is
what makes a double-count structurally impossible"*), **not a confidentiality rule.**
`window-census.js` **emits** `windowId` on every census row; `tab-move-to-new-window`
**returns** `{ok, windowId}` **to the chrome renderer**; `renderer-globals.d.ts` declares
it. **The chrome renderer is already handed `windowId` by the exact handler leg 3
factored.**

## Inputs

- Leg 3's factored **move core** (synchronous; pinned by the re-anchored
  `move-tab-synchrony.test.js` with guards (a) anchor, (b) pair, (c) channel-reaches-core).
- `src/shared/tab-context-model.js` — builds the tab menu model; omits "Move to new
  window" at `!isLastTab && !isInternal` (**both** conditions).
- `src/main/window-registry.js` — `records()` (insertion order), `get(winId)`,
  `getWindowForChrome(sender)`.
- The sheet renders the menu; **no submenu capability is assumed**.
- `src/renderer/renderer-globals.d.ts` — declares the move handler's return type.

## Outputs

- `tab-context-model.js` — flat "Move to window …" items + its unit tests.
- `main.js` — the window-list builder + the move-to-existing-window entry on the core.
- `renderer.js` — dispatch.
- `renderer-globals.d.ts` — updated to match any return-shape change.

## Acceptance Criteria

> **DD10: two readings per state-asserting AC — on the real artifact, both directions.
> Run each `grep -c` STANDALONE. Use MASKED greps for absence claims** (leg 1's
> `test/helpers/source-scan.js`; a naive grep reads 1 on a comment — discrimination zero).

- [x] **AC1 — one flat item per OTHER window, labeled from its active tab's title.** No
      item for the tab's own window. **No submenu.**
      **Two readings**: with 1 window → **0** items; with 3 windows → **2** items. *(A
      builder that ignores the registry returns the same count either way.)*
- [x] **AC2 — the model is pure and window-count-driven.** `tab-context-model.js` stays
      Electron-free. **Two readings**: **masked** `grep -c "require('electron')"` → **0**;
      mutate to add one → **1**.
- [x] **AC3 — the item is keyed by `windowId`, and the ordinal scheme is NOT built.** The
      renderer echoes `windowId` back.
      **Two readings**: the dispatched payload carries the **same `windowId`** main sent;
      mutate the registry order between build and dispatch → **the same window is still
      targeted** (an ordinal-keyed implementation would target a **different** one — that
      is the mis-target DD8's reversal exists to prevent, and it is the whole reason the
      ordinal scheme was deleted).
- [ ] **AC4 — a window closing between menu build and dispatch REFUSES, never
      mis-targets.** `registry.get(windowId)` → `null` → refuse (DD5).
      **Two readings**: live target → moves; target closed after build → **refused and
      announced**, tab unmoved.
      **PARTIAL — discharged at the REGISTRY, not at runtime.** `move-targets.test.js` runs the
      real mutation: build → the user picks window B → B closes → `registry.get(picked)` →
      **null** (refuse), while an ordinal-keyed dispatch resolves **C** — a different window.
      Both readings, and they disagree. The refusal's code path and its announcement arm are
      pinned in `move-authority.test.js` / `tab-drag-invariants.test.js`. *"Live target →
      moves"* and *"tab unmoved"* are RUNTIME and were **not taken** — leg 5. *(This is the AC
      the ordinal scheme made **unreachable** —
      resolving an ordinal at dispatch required either rebuilding the list, which silently
      re-points the ordinal at a different window, or caching the map, which DD8 also
      forbade.)*
- [ ] **AC5 — the AUTHORITY rule is honored on its own terms.** The echoed `windowId` is a
      **destination request**, never a claim of ownership. Main re-validates: the tab must
      belong to **`getWindowForChrome(event.sender)`**, exactly as today.
      **Two readings**: a payload naming a tab the sender does **not** own → **refused**;
      one it owns → moves. **The ownership check must be the registry's, not the
      payload's.**
      **PARTIAL — the STRUCTURAL half is discharged with both readings, the RUNTIME half is
      leg 5's.** `test/unit/move-authority.test.js` pins, on the real `main.js` and mutated:
      the source resolves from `event.sender` (real 1 → payload-as-source mutation 0), the
      destination re-resolves through `registry.get` (real 1 → cached-target mutation 0), and
      the payload is read for **exactly one** field, `payload.windowId`. *"A payload naming a
      tab the sender does not own → refused"* is a RUNTIME reading and was **not taken** —
      no DOM/main harness exists here (leg 3's finding, unchanged).
- [ ] **AC6 — refusals are announced, never silent (DD5).** Sole tab, internal/trusted tab,
      dead target, foreign tab. **No bare `null` reaches the renderer as silence.**
      **Two readings**: refused → `announceTabStatus` called, tab's index in
      `orderedTabIds()` **unchanged**; success → index changes.
      **NOT DISCHARGED — the instrument does not exist in this repo.** Both stated readings are
      RUNTIME (`announceTabStatus` observed, `orderedTabIds()` before/after). What IS pinned:
      the outcome→message map is **total** over the core's result union, every arm returns a
      non-empty literal, `no-target` has its own arm, and **both** call sites announce through
      it — so silence is unreachable *by construction*. That is a weaker property, honestly
      stated. **Leg 5 owns the reading.**
- [ ] **AC7 — the moved tab keeps its identity.** Same `wcId`, same jar/partition, live
      history intact. **Runtime claim — leg 5 owns the reading.** *(Named here rather than
      ticked from code shape; leg 3 established this repo has no DOM/main harness.)*
- [x] **AC8 — no new chord; the LOCKSTEP PIN is not engaged.** `keydown-action.js` and
      `sheet-accelerator.js` **hand-mirror** each other and must change together.
      **Two readings**: `git diff --stat src/shared/keydown-action.js
      src/shared/sheet-accelerator.js` → **empty**. *(If a chord is ever added it lands in
      **both** files in the same change. `Ctrl+Shift+N` is pre-refused — Chrome's incognito
      chord.)*
- [x] **AC9 — tear-off's keyboard equivalent already exists and is NOT re-invented.** The
      menu's "Move to new window", reachable via the Context-Menu key path F5 shipped,
      satisfies the mission's *"keyboard-**reachable** equivalent"*. **Two readings**:
      `grep -c "tab:move-new-window" src/shared/tab-context-model.js` → **≥1** before and
      after. **No new binding.**
- [x] **AC10 — `renderer-globals.d.ts` matches reality.** `npm run typecheck` is a gate.
      **Two readings**: typecheck green; mutate the declared return shape → **fails**.
- [x] **AC11 — gates green.** `npm test` (state the delta), `npm run lint`, `npm run
      typecheck` — each **standalone**.

## Line Budget (DD11 — as REFINED at leg 3: CODE lines, comments excluded)

- `src/main/main.js`: **≤ +45 code**. Currently **3565**.
- `src/shared/tab-context-model.js`: **≤ +30 code**.
- `src/renderer/renderer.js`: **≤ +25 code**.
- **Exceed ⇒ stop and report.** *(Leg 3 reported at +117 total against a +90 total budget
  and was accepted — the budget's unit was wrong, taxing exactly the documentation this
  flight's thesis demands. Comments are no longer budgeted.)*

## Out of Scope

- Cross-window **drag**, any hit-test, any global coordinate — deferred at leg 2 (DD16).
- New keyboard chords — DD8 rules the menu path sufficient.
- Behavior specs — leg 5 (which owns AC7's runtime reading).

## Verification Steps

1. Every mutation run, **both numbers in the flight log**.
2. Budgets (code lines) checked and reported.
3. `git status --porcelain` — no mutation artifacts.
