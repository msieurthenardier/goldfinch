# Leg: bar-drag-reorder

**Status**: landed
**Flight**: [Drag Interactions](../flight.md)

## Objective

Make bookmarks bar items draggable and reorderable within the bar on native HTML5 DnD, driving the first-ever production call to `bookmarkReorder`.

## Context

Flight DD2, DD3, DD4, DD6b, DD7, DD12; closes with DD5b.

This is the mission's remaining criterion's first real slice, and the flight's first code that a user can see. Four things shape it.

**1. `bookmarkReorder` is unproven code, not shipped code.** The Flight 2 debrief states it plainly: *"zero renderer call sites; the entire DD2 position machinery is unit-test-only. Flight 3 is its first consumer and must treat it as unproven."* The chain — `bookmarks-client` → `chrome-preload.js:68` → `register-bookmarks-ipc.js:98` → `bookmarks-store.js:251` → `app-db.js`'s `reorderPositions` `BEGIN IMMEDIATE` — is individually tested at every link and has **never run end to end**. **Verify the path live before building UI on top of it** (AC1), so a failure is attributed to the store rather than to the drag.

**2. There is NO index translation to write — the earlier design decision was wrong about this.** DD3's original claim (that visible and full-list index spaces diverge under overflow) is false: `itemEls()` returns **all** `.bm-item` children in full-list order (`bookmarks-bar.js:158-160`) and the hide is a strict **tail** — `items.forEach((el, i) => el.classList.toggle('hidden', i >= visibleCount))` (`:254`). Visible index **is** full-list index. The real requirement is the opposite shape: `.bm-item.hidden` is `display: none` (`styles.css:729-731`), so hidden items report **zero-width rects at left 0**, and feeding raw `itemEls()` rects into `dropIndexFromPointer` counts every hidden one (midpoint `0 < pointerX`), inflating the index by exactly the overflow count. **Filter hidden items out of the slot array before measuring.**

**3. Native DnD fires no trailing click — do not add a suppression flag.** `CLAUDE.md`'s tab-activation invariant is explicit and applies verbatim here: *"all tab drags are native HTML5 DnD, which fires no trailing `click` — so the tab click handler's activate is unconditional (no suppression flag; don't reintroduce one)"* (`tab-controller.js:126` carries the same note). The bar item's existing `click` handler **navigates** (`bookmarks-bar.js:201`), so an implementer who assumes a drag ends in a click will invent a guard that this codebase has deliberately removed once already. It is not needed.

**4. Two things rebuild the bar out from under a live drag, and both must be suppressed.** `render()` (`bookmarks-bar.js:273-287`) calls `clearItems()` and rebuilds every `.bm-item` on any same-jar `bookmarks-changed` — so another window's edit destroys the drag source mid-gesture, reachable with no tab switch at all. The `ResizeObserver` re-partition (`:260-271`, observer at `:332`) does the same on any bar resize. One drag-session-active gate covers both, with a single flush on `dragend`.

### What this leg unblocks

`bar-overflow-drag`'s **DD8 probe is deliberately deferred until after this leg** (flight log, Operator Session 2 correction). The probe's first run used a *tab* as the drag source, which carries tear-off machinery — including a 260×28 pill raised via `addChildView` mid-drag — that no bookmark drag has. This leg produces the first real `draggable` bar item, which removes that stimulus-representativeness defect entirely. **Producing that source is an output of this leg; running the probe is not part of it.**

## Inputs

- Branch `flight/03-drag-interactions`; `automation-gate` and `carried-debt` landed (uncommitted). Suite **3394 pass / 0 fail**, typecheck and lint clean.
- `bookmarks-bar.js` (335 lines): exported constants `CHEVRON_WIDTH` `:37`, `BAR_GAP` `:52`, `BAR_PADDING_X` `:53`; `createBookmarksBar` `:144`; `itemEls()` `:158-160`; `buildItemButton` `:167`; click `:201`, auxclick `:213`, contextmenu `:226`; `applyOverflowPartition` `:240-256` with the tail-hide at `:254`; `onResize` `:260-271`; `render(jarId)` `:273-287`; `dispatch` `:315`; `closeOverflowIfOpen` `:326-329`; `new ResizeObserver(onResize)` `:332`.
- `bookmarksClient`'s public API is `{ boot, ensureJar, findByUrl, listFor, activateStar, captureEditJar, handleEditSubmit }` — **no reorder path and no fresh-read path exists yet**; both are this leg's to add.
- Bridge: `bookmarksGet` `chrome-preload.js:64`, `bookmarkReorder` `:68`.
- `tab-order.js`'s `dropIndexFromPointer(slotRects, pointerX, draggedIndex)` `:107-118` — generic `{left, width}` rects, no tab semantics, midpoint rule with ties resolving "before".
- `tab-drag-zone.js` is the purity/division-of-labour precedent: pure, no DOM, no Electron, degenerate inputs fail to the **non-destructive** outcome.
- Tab DnD reference implementation: `dragstart` `tab-controller.js:154-203` (session snapshot, `setDragImage`, `effectAllowed`), document `dragover` `:492-500` (**`dropEffect` is MANDATORY or the drop is silently rejected — "spike probe3"**), strip `drop` `:528-545` (`dropHandled` set **synchronously**, since drop fires before dragend), `dragend` `:211`.
- `bookmarks-store.js`'s `reorder(jarId, ids)` `:251-273`: unknown/duplicate/non-string ids ignored; **entries omitted from `ids` are preserved and appended in prior order**; non-array is a no-op; always `{ ok: true }`.
- `register-bookmarks-ipc.js`: reorder is one of the four mutation channels rejecting a `jarId` absent from `jars.list()` with `{ ok:false, reason:'unknown-jar' }`; broadcasts `bookmarks-changed { jarId }` on success.
- `styles.css`: `#bookmarks-bar` `:665-674` (`gap` `:673`, `padding` `:674`), `.bm-item.hidden { display: none }` `:729-731`, `#bookmarks-overflow` `:762-768`. The bar's `overflow: hidden` and fixed `height: 30px` are load-bearing — the indicator must not change either.
- CSS↔JS pin test from `carried-debt` now guards `BAR_GAP`/`BAR_PADDING_X`/`CHEVRON_WIDTH` against `styles.css`.

## Outputs

- New `src/shared/bookmark-drag.js` — pure slot assembly + drop classification.
- `bookmarks-bar.js` — `draggable` items, the four handlers, session state, insertion indicator, drag-session suppression of `render()` and the resize re-partition.
- `bookmarks-client.js` — a reorder path that re-reads through `bookmarksGet` before committing.
- `styles.css` — insertion-indicator rule.
- Unit tests for the pure module and the client's reorder path; a store-level reorder-then-fresh-load assertion.

## Acceptance Criteria

- [x] **AC1 (DD7 — do this FIRST)** — The full `bookmarkReorder` path is exercised live end to end *before* any drag UI is built on it, and the result recorded in the flight log: a reorder issued from the chrome persists, returns gap-free `0..n-1` positions, broadcasts `bookmarks-changed { jarId }`, re-renders the bar through the existing jar-filtered `onChanged` path, and does **not** spuriously hit the `unknown-jar` rejection. If the store's behaviour contradicts its unit tests, **stop and escalate** — that is a Flight 2 defect surfacing, not something to patch inside a drag leg.
  - **This is agent-drivable — no gesture needed.** Launch `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation -- --ozone-platform=x11`; capture the key from the `AUTOMATION_DEV_MINT` stdout line; **discover the bound port with `ss -ltnp` — it is NOT reliably 49707** (Operator Session 2 found 49709, nothing prints it, and a wrong guess yields a bare `UND_ERR_CONNECT_TIMEOUT`); connect via `scripts/lib/mcp-client.mjs`'s `connectAutomation()`; `getChromeTarget` to prove admin tier; then `evaluate` on the chrome to call `window.goldfinch.bookmarkReorder` / `bookmarksGet`. No seam entry is needed — the bridge is on `window`, outside the evaluate-seam closed set.
  - **If the rig is unavailable** (no display, launch fails): record AC1 as **blocked** in the flight log, fold it into the deferred operator session, and proceed on the unit-tested contract. **Do not fabricate a result** — both prior operator sessions hit rig faults, and an invented verification here is worse than none, since the entire point is that this path is unproven.
- [x] **AC2** — `src/shared/bookmark-drag.js` is pure (no DOM, no Electron, unit-tested offline) and exports:
  - **hidden-filtered slot assembly** — given per-item `{rect, hidden}` inputs, returns the `{left, width}` array for **visible items only**, in order. Because the hide is a strict tail, the returned array's index is the full-list index; the module documents that fact rather than re-deriving a translation.
  - **drop classification** — given the bar's rect and a pointer point, returns `{zone:'reorder', index}` when the point is inside the bar, else `{zone:'outside'}`. `index` is exactly `dropIndexFromPointer`'s result, which is **imported unchanged** from `tab-order.js`, never re-implemented.
  - Degenerate inputs (non-object rect, non-finite edge, empty slots) resolve to the **non-destructive** outcome — no reorder — per `tab-drag-zone.js`'s documented discipline (`:31`, `:75-76` carry the exact `{zone, …}` shape this mirrors).
  - **`moveIndex` is imported unchanged too, never hand-rolled** *(design-review finding, HIGH)*. `tab-order.js:34-52` already provides it and it composes **exactly**: `dropIndexFromPointer` returns "insertion index among the remaining slots," which is precisely `moveIndex`'s `toIndex` contract — the same pairing `commitTabMove` uses (`tab-controller.js:367-377`). It **returns the same array reference on a no-op**, giving AC4's drop-back-into-original-position check for free, and no-ops when the dragged id is absent. A hand-rolled `splice` pair is the classic forward-move off-by-one. It has **zero importers in `src/` today** — like `bookmarkReorder`, this leg is its first production consumer, so AC1 should exercise the composed pair, not the store alone.
- [x] **AC3** — Bar items are `draggable`. `dragstart` sets the three DD2 types: `application/x-goldfinch-bookmark` (the bookmark **id**), plus `text/uri-list` and `text/plain` (the url, for web interop and for `drag-onto-page`). `effectAllowed`/`dropEffect` are set such that the drop is not silently rejected — `dropEffect` in `dragover` is **mandatory**, per `tab-controller.js:499`.
  - **Assert the drag session actually arms.** This is the codebase's first `draggable` `<button>` (the tab source is a `<div>`, `tab-controller.js:86`). If it fails to arm, every downstream symptom reads as "nothing happened" — the exact ambiguity that produced this flight's withdrawn axis-(b) verdict and forced DD5b's relocation.
- [x] **AC4** — A drag within the bar reorders: the item lands at the insertion position shown, the rendered order matches the stored order, and positions stay gap-free `0..n-1`. A drop back into the original position is a **no-op** — no `bookmarkReorder` call, no broadcast.
- [x] **AC5** — An insertion indicator is visible during the drag at the computed drop position. It must not change the bar's height, must not animate, and must not push the chevron out of the `overflow: hidden` box — the `carried-debt` pin test must stay green.
  - **It must NOT participate in flex layout** *(design-review finding)*. Guidance #3's dragstart rect snapshot is valid only because the indicator does not reflow the row; an indicator inserted as a flex child of `#bookmarks-bar` reflows every item and invalidates the snapshot the drop then commits against. Absolute positioning is the safe shape — and `#bookmarks-bar` (`styles.css:665-697`) has **no `position` declaration**, so `position: relative` is a prerequisite, not an afterthought.
- [x] **AC6 (DD6b)** — The commit builds its id list from a **fresh `bookmarksGet({ jarId })`**, not from `bookmarksClient.listFor()`. Rationale is not stylistic: DD7 mandates full id lists, `listFor` is a cache read, and a bookmark added by another window and not yet broadcast would be **omitted** from the payload — whereupon the store's forgiving rule appends it silently to the end (`bookmarks-store.js:266-271`) with `{ok:true}`, relocating another window's bookmark. A unit test covers exactly that interleaving.
- [x] **AC7** — Both rebuild paths are suppressed while a drag session is live — `render()` **and** the `ResizeObserver` re-partition — with a single flush on `dragend`. A test asserts a same-jar `bookmarks-changed` arriving mid-session does not call `clearItems()`.
  - **A third path removes the source without rebuilding it** *(design-review finding)*: `window-controller.js:108-114`'s `applyBarVisibility()` sets `#bookmarks-bar.hidden` (`display:none`), reachable from `setBarSuppressed` (activation into a burner/internal tab) and from `applyBookmarksBar` on a `settings-changed` broadcast (another window toggling the bar off). It never calls `clearItems()`, so AC7's test passes while the source vanishes. **Accepted outcome, not a gate**: Chromium ends the drag, `dragend` clears the session, no commit fires — a wrong visual, never a wrong write. Stated so "both paths" is not read as a completeness claim it does not have.
- [x] **AC8** — `dropHandled` is set **synchronously** in `drop` (drop fires before dragend) so `dragend` cannot double-commit or mis-handle a committed move. Escape mid-drag folds into `dragend` with no drop and leaves the order unchanged.
- [x] **AC9** — **No click-suppression flag is introduced.** Native DnD fires no trailing click; the bar item's `click` handler stays unconditional. A drag must not navigate. Verified by test and named in a comment so it is not "fixed" later.
- [x] **AC10** — Reorder survives a restart with names, order, **and icons** intact (mission criterion 2's re-verification; `reorder()` rewrites `position` only, and no test covers reorder-then-restart today). Confirms the flight's open question about icon persistence rather than assuming it.
  - **Autonomous half**: a store-level fresh-load assertion on the established `freshStore()` + `reloaded.load(...)` idiom (`test/unit/bookmarks-store.test.js:58-60`, `:74-77`) — fully offline. The live app relaunch belongs to the HAT, not this leg.
- [x] **AC11** — Drag is inert where bookmarking is inert. **Stated precisely** *(design-review correction)*: `refreshBookmarksSurfaces` (`renderer.js:193-200`) *skips* `render()` when suppressed, so the previous jar's `.bm-item` children **remain in the DOM** beneath a `display:none` bar — a test asserting "no `.bm-item` exists on a burner tab" would fail. The operative claim is that **`#bookmarks-bar` carries `.hidden`, so no drag source is reachable**. No new guard should be needed — assert that rather than add one.
- [x] **AC12** — `npm test`, `npm run typecheck`, `npm run lint` green; suite count recorded against the **3394** baseline. `renderer.js` stays within `RENDERER_LINE_BUDGET` (1588/1650, **62 lines**) — DD12 forbids a raise; all logic belongs in `bookmarks-bar.js` and the new shared module.
  - **Trap** *(design-review finding)*: `test/unit/bookmarks-bar-css-pin.test.js:121-131` asserts `bookmarks-bar.js`'s `^export const <NUMBER>` set equals **exactly** `{BAR_GAP, BAR_PADDING_X, CHEVRON_WIDTH}`. An `export const INDICATOR_WIDTH = 2` turns the suite red. That is `carried-debt`'s deliberate under-pinning guard: a new pinned-looking constant is a **decision** (pin it in CSS too, or keep it module-private), not an edit.

## Verification Steps

- AC1 — live chrome-issued reorder against the running app; flight-log entry
- AC2 — `node --test` on the new pure module, including the degenerate and hidden-filtered cases
- AC3, AC4, AC5, AC8, AC9 — unit tests over the handlers where the DOM allows; the rendered half is operator-verified at HAT (there is no jsdom harness in this repo — every layout number in a renderer unit test is asserted by the author, not derived by a layout engine)
- AC6, AC7 — unit tests with a stubbed bridge/cache
- AC10 — reorder, restart the app, re-read `bookmarksGet` and the rendered bar
- AC11 — assert the bar is absent on burner/internal, so no `draggable` source exists
- AC12 — `npm test`, `npm run typecheck`, `npm run lint`

## Implementation Guidance

1. **AC1 before anything else.** Drive a reorder through the real chain against the running app and confirm persistence, positions, and broadcast. Only then build UI on it.

2. **`bookmark-drag.js`** — follow `tab-drag-zone.js`'s shape exactly: pure, Electron-free, phrased so unreadable inputs fall through to the non-destructive branch. Import `dropIndexFromPointer` from `tab-order.js`; do **not** re-implement the midpoint rule. Document that visible index equals full-list index because the hide is a strict tail — that is the fact a future reader will otherwise re-derive incorrectly.

3. **Session snapshot at `dragstart`**, mirroring `tab-controller.js:180-201`: the bookmark id, the full-list start order, the dragged index, and the **hidden-filtered** slot rects plus the bar's rect. Geometry is read once; the indicator must not reflow the row, so the snapshot stays valid.

4. **`dragover`**: gate on `types.includes(BOOKMARK_MIME)`, `preventDefault()`, set `dropEffect` (**mandatory**), recompute the drop index, move the indicator.

5. **`drop`**: set `dropHandled` synchronously, then commit — `await` a fresh `bookmarksGet`, apply `moveIndex(order, from, to)`, call `bookmarkReorder`. Skip entirely when `moveIndex` returns the **same reference** (nothing moved).
   - ⚠ **`dataTransfer` leaves protected mode when the dispatch ends** (flight cycle-2 finding). Any `getData`/`types` read **after** the `await` returns empty and the drop silently does nothing. The bookmark id must come from the **dragstart session snapshot** (Guidance #3 already captures it); anything that must be read off `dataTransfer` in `drop` is read into a local **before** the await.

6. **`dragend`**: clear the session, remove the indicator, lift suppression, and flush one re-render.

7. **Suppression gate**: one `dragActive` flag consulted by both `render()` and `onResize`; flush on `dragend`. Do not scatter two independent guards.

8. **Reorder path in `bookmarks-client.js`**, not `renderer.js` — DD12's budget discipline, and the module already houses the bookmark business logic the budget keeps out of the composition root.

## Edge Cases

- **Overflow active** — hidden items must not enter the slot array (AC2). This is the case a careless implementation gets wrong, and the one where a discriminating fixture is meaningful: visible items on **both** sides of the pointer *and* hidden items present.
- **Single bookmark** — nothing to reorder; drag is a no-op, not an error.
- **Drop outside the bar** — `{zone:'outside'}`; no reorder. `drag-onto-page` owns that zone later; this leg must not pre-empt it.
- **Another window mutates mid-drag** — suppressed (AC7); the flush on `dragend` reconciles.
- **Tab switch mid-drag** — `refreshBookmarksSurfaces` calls `render()`, which the same gate suppresses. Whether the drag should also be cancelled is the flight's open question; **bound it here**: the session is cleared on `dragend` regardless, so the worst case is a stale indicator, not a wrong write. If the jar changed, the commit's fresh read is against the **captured** jar — capture `jarId` at `dragstart`, never resolve it at drop time (the DD13 TOCTOU discipline the popover already follows).
- **Jar deleted mid-drag** — the commit resolves `{ok:false, reason:'unknown-jar'}`; treat as a silent no-op, consistent with `carried-debt`'s DD9 disposition of the residual-race feedback.
- **The dragged bookmark is removed by another window before the fresh read** — `moveIndex`'s `indexOf` misses, it returns the same reference, and the commit is skipped. Free with the reused helper; a hand-rolled splice would insert an unknown id (harmless, since the store ignores it, but silently wrong).
- **Duplicate/stale ids in the payload** — the store tolerates them, but AC6 means we never rely on that; the tolerance is a safety net, not an interface.

## Deferred to an operator session (NOT an acceptance criterion of this leg)

**DD5b — measure Chromium's own default URL-drop handling.** Requires a physical drag gesture, so the Flight Director runs it with the operator once this leg's code lands, and records the result in the flight log. It must happen **before `drag-onto-page` writes any preload code**, because a `dragover` `preventDefault()` there suppresses the very default being measured. The binding constraint is *before that leg*, not *inside this one*.

What it answers: when a bookmark is dragged onto an ordinary page today, does Chromium navigate the frame by itself, and does that navigation route through the existing `will-navigate` / `isSafeTabUrl` gate (`guest-wiring.js:236`)? If yes, DD5's page-wins policy holds by construction, DD6's no-authority signalling apparatus is unnecessary, and `drag-onto-page` shrinks — possibly to nothing.

**Carries DD8's negative-probe audit**: confirm a drag session actually started before writing down that the default did not fire. A `dragstart` that never fired and a default that never fired are indistinguishable from the operator's chair — and that is exactly the confusion that produced this flight's withdrawn axis-(b) verdict.

**Also enabled, not run here**: the re-run of the DD8 axis-(b) probe, which needs the real `draggable` bar item this leg produces (see Context). Its stimulus defect is fixed by this leg's existence; running it is a separate operator step.

## Files Affected

- `src/shared/bookmark-drag.js` — **new**
- `src/renderer/chrome/bookmarks-bar.js` — drag source, handlers, session, indicator, suppression
- `src/renderer/chrome/bookmarks-client.js` — reorder path with the fresh read
- `src/renderer/styles.css` — insertion indicator
- `src/renderer/renderer.js` — glue only, if any (budget: 62 lines)
- `test/unit/bookmark-drag.test.js` — **new**
- `test/unit/bookmarks-bar.test.js`, `test/unit/bookmarks-client.test.js` — extended

## Citation Audit

Verified against the working tree with `automation-gate` and `carried-debt` applied. Note `bookmarks-bar.js` line numbers shifted from the flight artifact's (written pre-`carried-debt`, which added three exports) — the flight's `:149-151`/`:245`/`:264-278`/`:317-320` are now `:158-160`/`:254`/`:273-287`/`:326-329`.

| Citation | Status |
|---|---|
| `bookmarks-bar.js:37`, `:52`, `:53`, `:144`, `:158-160`, `:167`, `:201`, `:213`, `:226`, `:240-256`, `:254`, `:260-271`, `:273-287`, `:315`, **`:328-330`**, `:332` | verified (post-`carried-debt`) |
| `bookmarks-client.js` public API — no reorder/fresh-read path exists | verified |
| `chrome-preload.js:64`, `:68` | verified |
| `tab-order.js:34-52` (`moveIndex`), `:107-118` (`dropIndexFromPointer`) | verified |
| `tab-controller.js:86`, `:126`, `:154-203`, `:211`, `:367-377`, `:492-500`, `:499`, `:528-545` | verified |
| **`bookmarks-store.js:253-276`** reorder, **`:270-272`** omitted-append, `:275` | **corrected** — `carried-debt` rewrote the `DATA_IMAGE_RE` comment at `:53-57`, shifting everything after by +2; the first draft carried pre-`carried-debt` numbers |
| `styles.css:665-674`, `:665-697` (no `position`), `:673`, `:674`, `:729-731`, **`:762-769`** | corrected |
| `guest-wiring.js:236`; `window-controller.js:108-114`; `renderer.js:127`/`:193-200`/`:556`; `bookmarks-client.js:79`/`:110`; `bookmarks-bar-css-pin.test.js:121-131`; `bookmarks-store.test.js:58-60`/`:74-77` | verified |

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with a leg progress entry and the AC1 live-verification result (or its blocked disposition)
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
- [x] **Do NOT commit** — this flight batches review and commit after the last autonomous leg
