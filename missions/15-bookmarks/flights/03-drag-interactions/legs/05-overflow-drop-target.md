# Leg: overflow-drop-target

**Status**: landed
**Flight**: [Drag Interactions](../flight.md)

## Objective

Make the overflow menu a **drop target**: spring-load it from the chevron mid-drag, show a placement indicator inside it, and commit a bar → overflow reorder.

**This is leg 5a of a split** (operator ruling, 2026-08-05, after design-review cycle 2). `overflow-drag-source` (5b) makes the sheet a drag *source* for the reverse direction, and exists only if this leg's closing probe says that transport works. The seam is the probe, because 5a's transport is **measured** (session 3) and 5b's is not — and 5b carries an entire renderer/preload/globals fan-out against ~52 lines of `renderer.js` headroom.

## Context

Flight DD2, DD3, DD4, DD8; Flight 1 debrief's deferred index-vs-id question.

### What operator session 3 measured, and what it did NOT

**Measured VIABLE — chrome → sheet.** A sheet opened *mid-drag* by a spring-loaded chevron received **23 `dragenter` / 200 `dragover` / 2 `drop`**, carrying `text/plain | text/uri-list | application/x-goldfinch-bookmark | chromium/x-drag-id`. The custom MIME survives the crossing. This is the transport for **bar → overflow**.

**NOT measured — sheet → chrome.** That is a different transport question, and the reverse direction has **no drag source in existence**: `grep draggable src/renderer/menu-overlay.js` returns nothing. Symmetry is an assumption, not a finding, and this flight has already had two verdicts overturned by assuming things about drags. **AC1 measures it before the reverse direction is built.**

### The interaction is spring-loading — operator ruling, not inference

From session 3, in the operator's own framing:

1. *"the overflow panel disappears when grabbing the bookmark, **as expected**"* — the menu closing at drag start is **desired**. Do not try to keep it open; a `dismissible: false` variant was tried and did not hold it open anyway, and the closer was never identified because it stopped being worth chasing.
2. *"it should open when I hover over the chevron with the [item] I'm dragging so I can put it in there, but does not"* — **spring-loading** (the Chrome/Finder folder-target idiom) is the interaction. Without it the drop target is unreachable and the transport result is moot.
3. *"got no placement indicator"* — the sheet needs **its own** indicator. Leg 3 built the bar-side one only; inside the menu a drop position is currently unguessable.

A throwaway spring-load probe (chevron `dragover` → `openOverflowMenu`) recorded **65 dragover on the chevron** and opened the menu successfully mid-drag, so the mechanism is proven; this leg productionises it.

### DD4: membership stays derived; `bookmarkReorder` is the only mutation

Overflow membership is a *rendering* fact derived by `partitionOverflow` from measured widths. Dropping into the overflow reorders to a position at or past the last visible slot; dropping out onto the bar reorders to that slot's full-list index. **No stored flag, no schema change.** The user-visible consequence — **something is displaced, because the bar's capacity did not change** — is correct and is a HAT confirmation item, since it will read as surprising the first time. *(Phrased as "something is displaced" rather than "the last-visible item is pushed out": `partitionOverflow` re-runs against the new order and how many fit can shift by one depending on the moved item's width — design-review correction.)*

## Inputs

- Branch `flight/03-drag-interactions`; four legs landed (uncommitted). Suite **3477 pass / 0 fail**, typecheck and lint clean, `renderer.js` **1598/1650** (52 lines).
- `bookmarks-bar.js`: `overflowSnapshot` `:184`, set at `:441` (`listFor(currentJarId).slice(visibleCount)`) and cleared `:433`; `openOverflowMenu` `:494-495`; chevron click `:499`; `dispatch` `:515`; `closeOverflowIfOpen` `:527`; returns `{ render, dispatch, closeOverflowIfOpen, handleDropSignal }` `:621`. Leg 3's `dnd`/`dragActive` and leg 4's holder live here too.
- `resolveOverflowRowId(id, snapshot)` `:140` — validated-no-op index dispatch (`bookmark:<i>` / `bookmark-edit:<i>`).
- `overflowSheetModel(snapshot)` — rows are `{ id: 'bookmark:<i>', label }`, snapshot-local indices.
- Sheet preload (`menu-overlay-preload.js`): `onInit` `:27`, `onCloseReset` `:29`, `sendActivated` `:30` (channel 4, `{id, token, value?}`, **`value` is string ≤24 chars, sanitised main-side**), `sendDismissed` `:31`. Dedicated `invoke` channels exist for payloads that do not fit channel 4 (`unlockVault` `:37`, `authSubmit` `:43`) — that is the precedent if a drop payload needs more than an index.
- `dropIndexFromPointer` (`tab-order.js:107-118`) and `moveIndex` (`:34-52`) — both already imported by legs 3/4; neither is re-implemented.
- `bookmark-drag.js` exports `BOOKMARK_DND_MIME`, `visibleSlotRects`, `classifyBookmarkDrop`, `indicatorX`.

## Acceptance Criteria

- [ ] **AC1 — the sheet gains a drop target only; it is NOT yet a drag source.** Everything here rides the transport session 3 measured (23 dragenter / 200 dragover / 2 drop into a mid-drag-opened sheet, custom MIME intact). The reverse direction's transport is measured by this leg's **closing operator probe** (below), which gates 5b.

  - ⚠ **The sheet probe MUST set `BOOKMARK_DND_MIME`** *(design-review finding)*. The chrome's document `dragover` only `preventDefault()`s when that type is present (`:548-551`); without it `drop` is never dispatched and the negative is a pure artifact — the exact DD5b mechanism this flight already measured (29 dragover / 0 drop). Add it to the audit list beside "did it arm" and "is the stimulus real."
  - **Counters go on `<body>` dataset, and the sheet-side read needs a re-open**: `closeMenuOverlay` nulls `currentMenu` (`menu-overlay-manager.js:380`) and the gate refuses a null menuType (`resolve.js:200-207`), while the sheet is blur-closed at drag start (`window-factory.js:324`). DD1f deliberately preserves `<body>` attributes for exactly this (`menu-overlay.js:2277-2278`).
  - **The chrome-side counters are gate-free** (chrome contents, admin tier), so the *primary* reading needs no re-open — and leg 3's handlers already accept and safely swallow a foreign bookmark drag (`if (!dnd) return`, `:553`, `:565`), so the probe needs no guard and has no destructive side effect. **Attach the chrome-side counters to the existing leg-3 handlers** rather than parallel listeners, so the probe measures the production accept path rather than a lookalike.

- [ ] **AC2a — the spring-load must not paint two contradictory indicators** *(cycle-2 finding)*. During the dwell the pointer is inside `barRect`, so leg 3's document `dragover` classifies `reorder` and paints the **bar** indicator over the chevron while the sheet is springing. Rule which wins and suppress the other.
- [ ] **AC2 — spring-loading.** `dragover` on the chevron, gated on `types.includes(BOOKMARK_DND_MIME)`, opens the overflow menu if not already open — **via `openOverflowMenu` (`:494-496`, which calls `open` directly), never `overlayMenuClient.trigger`** *(design-review finding)*. `trigger` refuses to re-open within `BLUR_REOPEN_SUPPRESS_MS = 300` of a blur close (`overlay-menus.js:66-74`), and the sheet is closed by exactly a blur at drag start — so the chevron's own click path (`:498-500`, which uses `trigger`) is the wrong thing to copy. Session 3's throwaway probe used `open`, which is why it worked. Proven in session 3 (65 chevron dragovers, menu opened mid-drag). Include a small dwell/debounce so a drag merely passing over the chevron on its way elsewhere does not spring it.
- [ ] **AC3a — gate the sheet-side drag affordances to `bookmarks-overflow`** *(cycle-2 finding)*. `renderMenu` (`menu-overlay.js:179-262`) is shared by `kebab`, `container`, `page-context`, `tab-context` and `bookmarks-overflow`; an ungated drop target or indicator would attach to every one of them. The per-row `contextmenu` at `:246` is the precedent, gated exactly this way. Also: `renderMenu` opens with `menuNode.textContent = ''` (`:180`), so an indicator parented to `menuNode` is wiped on every render — parent it elsewhere. **`#sheet-menu` is already `position: absolute`** (`menu-overlay.css:49-56`), so do **not** add `position: relative`; that would break `positionNode`'s anchoring.
- [ ] **AC3 — sheet-side placement indicator.** The sheet's row list is **vertical**, so this needs a **y-axis sibling** of the bar's math — `dropIndexFromPointer` is x-only (`tab-order.js:107-118`) and `indicatorX` returns an x (`bookmark-drag.js:172-182`). Add an axis-generalised or y-axis pair in `bookmark-drag.js` (pure, unit-tested); do **not** hand-roll it inline in `menu-overlay.js`. The sheet shows a drop position while a bookmark drag is over it, mirroring leg 3's bar indicator. Must not participate in the row layout (leg 3's lesson: an indicator in flow invalidates the geometry the drop commits against).
- [ ] **AC4 — bar → overflow, with the index rule RULED and pinned.** ⚠ Two design-review cycles both found this wrong; the operator ruled the semantics on 2026-08-05.
  - **Semantics (operator ruling)**: *land where the indicator drew* — after the drop the item sits at **overflow position k**, and whichever item the boundary displaces is promoted onto the bar. The boundary moving is inherent (the bar's capacity is unchanged) and is a HAT confirmation item.
  - **Rule**: `toIndex = Math.min(visibleCount + k, order.length - 1)`, passed to `moveIndex` unchanged. **Verified across the whole range** against `order = A..L, visibleCount = 8`: k=0 → `overflow[AJKL]`; k=1 → `[JAKL]`; k=2 → `[JKAL]`; k=3 → `[JKLA]`; k=4 (past the last row) → `[JKLA]`, A last. The **clamp is load-bearing** — without it a drop past the last row gives `toIndex = n`, `moveIndex` returns the same reference (`tab-order.js:42-43`), and `commitReorder` reads that as "nothing moved" (`bookmarks-client.js:263`): a **silent no-op**, which the Edge Cases explicitly forbid.
  - **Pin k=0, k=1, and k=last, against a jar with ≥3 overflow rows**, each asserting the **literal expected full-list order**. A single k=0 case is decorative: k=0 is the one index where several candidate formulas agree, and 2 overflow rows never exercises the clamp.
  - *Recorded for the debrief*: cycle 2 also claimed a k≥1 off-by-one. That claim assumed a different semantic model ("insert before the original row") than the one ruled here, and was checked rather than accepted — under the ruled model the formula is correct. The **end-of-list no-op** it found was real.
  - **`visibleCount` must be STORED, not derived** *(cycle-2 finding; the derive option is deleted)*. `listFor(currentJarId).length - overflowSnapshot.length` is arithmetically correct in every state but **temporally unsafe**: `overflowSnapshot` is frozen during a drag while `listFor` is a live cache read the broadcast path updates *before* `onChanged` fires (`renderer.js:114-128`), and `render()` is suppressed by `dragActive` — so another window adding one bookmark mid-drag shifts the derived value by one and produces a wrong write. Capture it **at the same instant as the snapshot the sheet rendered**.
- [ ] **AC4b — the commit must survive `dragend`, which will win** *(design-review finding, HIGH — leg 4's lesson, repeated)*. The sheet's drop crosses sheet → main → chrome (two IPC hops) while the bar item's `dragend` fires locally at release. Leg 4 already measured this exact topology and recorded that **`dragend` wins on virtually every drop**. `dragend` (`bookmarks-bar.js:403-417`) nulls `dnd` (`:404`) and calls `render()` (`:407`), which rewrites `overflowSnapshot` (`:441`) — so by the time the drop index arrives, the bookmark id, the jar, **and the snapshot the index was computed against** are all gone. Carry `{ bookmarkId, jarId, visibleCount }` across `dragend` on the `DRAG_HOLD_MS` pattern leg 4 established (`:148-155`, `:413-416`). **Ordering is ruled, not left open**: `dragend` fires **first, always** — leg 4 measured exactly this topology — so that is the default test case, and the hold is load-bearing on the happy path rather than defensive. State whether this hold shares leg 4's `dragHoldUrl` slot/timer or is a second independent hold armed at the same `dragstart`; **both are armed on every gesture and only one can be consumed**.
- [ ] **AC6 — index-vs-id dispatch ruling** (Flight 1 debrief action item, deferred here). ⚠ **Reframed — the first draft named the wrong dependency** *(design-review finding)*. `overflowSnapshot` is written only in `applyOverflowPartition` (`:433`, `:441`), reached from `render()` (`:485`) **and `onResize()`** (`:463`); `closeOverflowIfOpen` has exactly one caller (`renderer.js:127-128`, the cache's `onChanged`), so it covers the render path and **not** the resize path — and `win.on('resize')` does not close the sheet, so **a window resize with the overflow open already rewrites the snapshot under live rows today**. The safety property is therefore **snapshot ↔ rendered-rows lockstep**, not close-on-change.
  - The coupling also runs the **opposite** way from the first draft's claim: `dragActive` already suppresses both `render()` (`:478`) and `onResize()` (`:453`), so during a drag the two are frozen *together* — suppression makes index dispatch **more** safe, not less.
  - Residual, and already handled: a stale snapshot whose bookmark was deleted resolves `order.indexOf(bookmarkId) === -1` → `moveIndex` no-ops → `commitReorder` returns false (`bookmarks-client.js:262-263`). Name this as the disposition.
  - **Dispose of the pre-existing resize desync** — fix in scope, or record it explicitly as a found-not-fixed defect. Do not leave it unstated now that it is known.
- [ ] **AC7 — `closeOverflowIfOpen` must not destroy a live drag.** Any drop mutates → broadcasts → the sheet closes `'superseded'` (`:527`). For **bar → overflow** that is the correct end-of-gesture behaviour. For **overflow → bar** it would destroy the drag **source** mid-gesture — the same class as leg 3's `render()` problem. Suppress while a drag session is live, flush on `dragend`. **The flush must include the deferred close, not just `render()`** — `dragend` calls `render()` alone (`:407`), so a suppressed close needs a pending flag flushed there or the sheet stays open over a pre-drop snapshot. State how a post-drop read of the sheet is obtained (re-open), since the spec rows depend on it.
- [ ] **AC8 — channels: pre-decided, because channel 4 is disqualified by a side-effect, not by size** *(design-review correction)*. `menu-overlay:activated` **closes the sheet** with `'activated'` (`register-overlay-ipc.js:106`) and forwards to `dispatchOverlayActivation` → `bookmarksBar.dispatch(id)`, which for a `bookmark:<i>` id **navigates the current tab** (`bookmarks-bar.js:517-518`). The 24-char cap (`menu-overlay-value.js:17-27`) applies only to `value`; `id` is unbounded. So channel 4 is unusable regardless of payload size. **Use dedicated `invoke`/`send` channels**, per the `unlockVault`/`authSubmit` precedent (`menu-overlay-preload.js:37`, `:43`), for (a) the drag lifecycle of AC7a and (b) the sheet's drop index for AC4.
  - **The bar → overflow drop payload itself needs no channel**: the chrome's document `drop` handler reads `dataTransfer` **synchronously** (`:559-579`; the protected-mode warning at `:573-577` concerns reads *after* the await), so an external drag can carry its identity in `BOOKMARK_DND_MIME`.
  - **Decide what a sheet-sourced drag carries.** `overflowSheetModel` sends only `{id: 'bookmark:<i>', label}` (`:129-131`) — the sheet does **not** know the real bookmark id or url. Either extend the model, or put a snapshot index in the MIME and resolve chrome-side. The latter preserves DD9 but means an overflow-sourced drag cannot populate `text/uri-list`/`text/plain`, so **drag-from-overflow-to-page (leg 4) would not work**. State the choice and its asymmetry.
- [ ] **AC6b — `dragend`'s unconditional `render()` has no close partner, and spring-loading makes that reachable** *(cycle-2 finding)*. `dragend` calls `render()` (`:407`), which rewrites `overflowSnapshot` (`:441`) — unlike `onChanged`, which pairs `render()` with `closeOverflowIfOpen()` (`renderer.js:127-128`). Before this leg it was harmless because the sheet could never be open during a drag. With AC2's spring-load, a live sheet is left rendering rows against a snapshot `render()` just rewrote, and a subsequent row click dispatches `bookmark:<i>` against the new one (`:515-521`). AC7's flush only fires when a close was *suppressed*; with no `bookmarks-changed` there is no pending flag. Close the sheet on the dragend flush, or re-send its model.
- [ ] **AC8b — both new channels need the channel-4 gating discipline, named as predicates** *(cycle-2 finding)*. Citing `unlockVault`/`authSubmit` gives the shape only. The sheet is one persistent document shared by every menuType (DD1/DD1a), so each new handler must replicate `menu-overlay:activated`'s guards (`register-overlay-ipc.js:86-106`): `recordForSheetSender` identity, token freshness against `getCurrentMenu()`, **and `current.menuType === 'bookmarks-overflow'`**. Without the menuType check a drop index can be accepted while `vault-unlock` is on screen. **This flight has now recorded four findings of exactly this shape** (leg 1 ×2, leg 4, and this) — naming a precedent instead of naming the predicate is the pattern the leg-4 log entry says to stop repeating.
- [ ] **AC9 — no double-handling.** A drop on the sheet must not also be handled by the bar's document-level handler (leg 3) or the guest's (leg 4). The three surfaces are separate `WebContentsView`s, so this should hold by construction — **assert it rather than guard it**.
- [ ] **AC10 — jar correctness.** The reorder targets the bar's own rendered jar (`currentJarId`), never the active tab's at drop time — the DD13 TOCTOU discipline the popover and leg 3 both follow. The commit re-reads via `bookmarksGet` before building the id list (DD6b).
- [ ] **AC11** — `npm test`, `npm run typecheck`, `npm run lint` green; suite count against the **3477** baseline; `renderer.js` within budget (1598/1650, DD12 forbids a raise).

## Verification Steps

- AC1 — instrumented probe + one operator gesture; flight-log verdict
- AC2, AC5's index math, AC6, AC7, AC9, AC10 — unit tests
- AC3, AC4, AC5 rendered behaviour — HAT (no jsdom harness in this repo; every layout number in a renderer unit test is asserted by the author, not derived by a layout engine)
- AC11 — the three gates

## Implementation Guidance

1. **AC1 before the reverse direction.** Instrument the sheet's rows as a drag source and the chrome as an observer; one gesture; read back; remove the instrumentation. Same discipline as leg 3's AC1 and session 3's probe.
2. **Spring-loading** on the chevron, `types`-gated, with dwell. Session 3's throwaway version is the shape; productionise it rather than re-derive it.
3. **Sheet indicator** out of flow (absolute), mirroring leg 3's — and note leg 3 needed `position: relative` added to its container, so check the sheet's equivalent.
4. **Suppression** (AC7): extend the drag-session gate rather than adding a second independent flag; leg 3 already established one.
5. **The reorder is `bookmarkReorder` in both directions** — DD4's single-mutation rule. Reuse `moveIndex`; do not hand-roll.

## Edge Cases

- **Overflow region empty / chevron hidden** — spring-loading has nothing to open; inert, not an error.
- **Drag passes over the chevron en route elsewhere** — the dwell prevents a spurious open (AC2).
- **Drop on the sheet's chrome (padding, not a row)** — resolve to an end-of-list position rather than a no-op, or state the choice.
- **Sheet closes mid-drag despite AC7** — the gesture ends with no commit; a wrong visual, never a wrong write (leg 3's disposition of the same class).
- **Jar switch mid-drag** — `currentJarId` is captured at `dragstart` (AC10).
- **Release *on* the chevron** — it sits inside `barRect`, so leg 3's document `drop` classifies it `reorder` (`:571`) and commits a move to the end of the visible run. Rule whether that is intended or a dwell-armed chevron should swallow the release.
- **Only one overflowed item** — dragging it out empties the overflow and hides the chevron; assert the chevron's `.hidden` follows.

## Files Affected

- `src/renderer/chrome/bookmarks-bar.js` — spring-load, suppression, both directions' commits
- `src/renderer/menu-overlay.js` — sheet drag source, drop target, indicator
- `src/renderer/menu-overlay.css` — indicator
- `src/preload/menu-overlay-preload.js` — drop channel (per AC8)
- `src/main/register-overlay-ipc.js` — the channel's main-side half
- `src/shared/tab-order.js` — JSDoc for the external-source case (AC5)
- `src/shared/bookmark-drag.js` — the y-axis drop-index/indicator pair for the sheet
- `src/renderer/menu-overlay-globals.d.ts`, `src/preload/chrome-preload.js`, `src/renderer/renderer-globals.d.ts`, `src/renderer/renderer.js` — the sheet↔chrome channel's type + wiring fan-out (**~52 lines of `renderer.js` headroom; DD12 forbids a raise**)
- tests: `tab-order.test.js` (external-source pin), `bookmarks-bar.test.js`, sheet-side pins

## Closing operator probe — gates leg 5b (NOT an acceptance criterion)

**Does a native drag STARTED INSIDE the sheet deliver to the chrome?** Session 3 measured chrome → sheet; this is the reverse and it has never been measured. Run at the close of this leg with throwaway instrumentation, one operator gesture, read back, remove — the method session 3 proved.

Audit requirements, each earned the hard way this flight:

- **The probe MUST set `BOOKMARK_DND_MIME`.** The chrome's document `dragover` only `preventDefault()`s when that type is present (`:548-551`); without it `drop` is never dispatched and the negative is a pure artifact — the DD5b mechanism a third time.
- **Count sheet-side `dragstart`/`dragend` too, not just chrome-side `dragover`/`drop`** *(cycle-2 finding)*. Whether the sheet even receives `dragend` is the load-bearing unknown for 5b: the sheet is blur-closed at drag start (`window-factory.js:324`) → `hide()` → `removeChildView`, and the `menu` template's `onClose` hides `menuNode` (`menu-overlay.js:162-165`), so the source button is `display:none` in a detached view. **If `dragend` never fires there, 5b's lifecycle gate can never be cleared and the bar would freeze for the session.**
- **Counters on `<body>` dataset**; DD1f preserves them deliberately (`menu-overlay.js:2277-2278`). The sheet-side read needs a **re-open** (the gate refuses a null menuType); the chrome-side counters are gate-free.
- **Attach the chrome-side counters to leg 3's existing handlers**, so the probe measures the production accept path rather than a lookalike. Leg 3 already swallows a foreign drag safely (`if (!dnd) return`, `:553`, `:565`), so no guard is needed and there is no destructive side effect.
- **Confirm the drag armed** before writing down any negative.

## Deferred to the HAT

Rendered behaviour for AC3/AC4/AC5, and the DD4 push-out-of-the-bar consequence (dragging an item out of overflow displaces the last-visible item) — which is *correct* but will read as surprising, so it wants an explicit operator judgement rather than a silent pass.

## Citation Audit

Verified against the working tree with four legs applied.

| Citation | Status |
|---|---|
| `bookmarks-bar.js:140`, `:184`, `:433`, `:441`, `:494-495`, `:499`, `:515`, `:527`, `:621` | verified |
| `menu-overlay-preload.js:27`, `:29`, `:30`, `:31`, `:37`, `:43` | verified |
| `tab-order.js:34-52`, `:107-118` | verified |
| `menu-overlay.js` has **no** `draggable` — the reverse direction has no source today | verified |
| Session 3 measurements (23/200/2 sheet; 65 chevron) | flight log, Operator Session 3 |

---

## Post-Completion Checklist

- [ ] All acceptance criteria verified
- [ ] Tests passing
- [ ] Update flight-log.md with a leg progress entry and the AC1 verdict
- [ ] Set this leg's status to `landed`
- [ ] Check off this leg in flight.md
- [ ] **Do NOT commit** — this flight batches review and commit after the last autonomous leg
