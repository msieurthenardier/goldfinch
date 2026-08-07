# Behavior Test: Bookmark drag — reorder, bar ↔ overflow, and drop onto the page

**Slug**: `bookmarks-drag`
**Status**: draft
**Created**: 2026-08-04
**Last Run**: never

> ## ⚠️ THE GESTURE IS THE OPERATOR'S. THE MEASUREMENT IS THE APPARATUS'S. NEITHER SUBSTITUTES FOR THE OTHER.
>
> Bookmark drag is **native HTML5 DnD** (M15 F3 DD2), the same transport every tab drag uses.
> Two recorded facts govern this spec's apparatus:
>
> 1. **Synthetic pointer injection cannot drive the native drag loop.** `dragPointer` /
>    `sendInputEvent` do not initiate a native HTML5 drag (recorded M09 F11 Leg 2;
>    `CLAUDE.md:270` states it as a tool-surface property). A `dragPointer` row against the
>    bookmarks bar is a **dead instrument that fails**.
> 2. **⚠ FORBIDDEN — the synthetic-`DragEvent` green-wash.** The DnD handlers **are** drivable
>    by a fabricated `DragEvent`/`DataTransfer` dispatched via `evaluate`. A fabricated `drop`
>    on a bar item carrying `application/x-goldfinch-bookmark` will fire the **REAL**
>    `bookmarkReorder` IPC and go **GREEN with no OS transport exercised** — a passing test over
>    an unexercised transport. This project shipped that failure class once already
>    (`multi-window-shell` passed 9/9 over a real cross-window `activateTab` bug for an entire
>    flight). `cross-window-drag.md` carries the doctrine and it applies here verbatim: **if a
>    future author finds they can make a gesture row pass without a human hand on the mouse,
>    that is the hazard, not the win.**
>
> **Therefore this spec is HAT-apparatus.** Every gesture Action is marked **`OPERATOR:`** — the
> Orchestrator **pauses** and asks the operator to perform the physical drag and confirm. The
> Executor **NEVER attempts the gesture**. The Executor is **observe-only** (chrome `evaluate`,
> `readDom` / `readAxTree`, `enumerateTabs`, `captureWindow`, history and store reads) plus
> non-gesture provisioning (opening tabs, adding bookmarks by click, resizing the window,
> restarting the app). The Validator judges.
>
> **⚠ Carve-out — fabrication is forbidden as a SUBSTITUTE for a gesture, and REQUIRED as an
> attack simulation.** Row 10 deliberately fabricates a `DragEvent` and is the only row that may.
> The distinction is the intent: a fabricated event standing in for a gesture the operator was
> supposed to make is the green-wash this spec forbids; a fabricated event *simulating a hostile
> page* is the negative control that gives the positive rows their meaning. Row 10 asserts that
> the fabrication **fails to navigate** — a fabricated event that succeeded there would be the
> finding. Never use it in rows 3, 5, 7, 8, 11, 12, or 14.

## Intent

Verify **mission criterion 6** on the real transport: *bookmarks can be dragged to reorder within
the bar, dragged between the bar and the overflow menu in both directions, and dragged onto the
page area to load that bookmark in the current tab.*

Three of its clauses ride three different surface crossings, and they are not equally proven:
reorder is chrome-internal; drop-onto-page crosses into the guest `WebContentsView` (measured
viable at M15 F1's HAT spike, with the custom MIME surviving intact); bar ↔ overflow crosses into
the overlay sheet (measured at M15 F3 leg 1 — **this spec's rows 8–9 exist only if that verdict
was positive**).

Two things make this a behavior test rather than a unit test. First, the observable under test is
the **OS drag transport itself**, which no in-process instrument can exercise. Second, and
specific to this codebase: there is no jsdom/happy-dom harness, so every layout number in a
renderer unit test is asserted by the test author rather than derived by a layout engine —
divergence between the author's mental model and the browser's is invisible by construction (M15
F2 debrief). Drop position, insertion indicator, and overflow membership are all rendered-state
claims.

This spec also carries the **first production exercise of `bookmarkReorder`**. Every link in that
chain is unit-tested; the chain has never run (M15 F2 debrief: *"unproven code, not shipped
code"*).

## Preconditions

- **Backend — X11, and that is load-bearing.** Wayland cancels a drag that leaves its source
  surface and cannot discriminate any cross-surface row here. Confirm the session backend before
  starting; a Wayland run is **void**, not failed.
- App launched via `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`.
  Admin tier confirmed by a successful `getChromeTarget` — **not** merely by tab enumeration.
- Agents attached via `scripts/lib/mcp-client.mjs`'s `connectAutomation()` reading
  `GOLDFINCH_MCP_ADMIN_KEY`. Never a static `.mcp.json` entry — it goes stale at the next mint.
- **Operator physically present** for every `OPERATOR:` row. There is no fallback.
- Bookmarks bar enabled (Settings → Startup & appearance).
- A persistent jar (not burner) with **at least 6 bookmarks** whose titles are visually distinct
  and individually nameable — enough that a mid-window width forces overflow.
- A second persistent jar with **at least 1 bookmark**, for the cross-jar isolation control.
- A local fixture page serving a document with its **own `drop` handler** that calls
  `preventDefault()` and records what it received (row 7). Note its address before starting.
- Sheet **read** automation admitted for `bookmarks-overflow` (M15 F3 leg 1 / DD1). Rows 12–14
  depend on it; if leg 1 reverted DD1, those rows are **void**, not failed.
- The M15 F3 leg-1 **DD8 axis-(b) verdict** is recorded and positive. If it was negative, rows 12
  and 13 are **void** — the feature they test was renegotiated out of scope, not broken.

## Observables Required

- **browser — chrome DOM** (bar item order, `.bm-item.hidden` classes, insertion indicator,
  chevron `aria-expanded`) — measured via `evaluate` / `readDom` / `readAxTree` on the chrome
  target from `getChromeTarget`.
- **browser — overlay sheet DOM** (overflow row order and membership) — measured via `readDom` /
  `readAxTree` on the sheet wcId. **Newly readable as of M15 F3 DD1**; refused outright before it.
  Note `evaluate` and `injectScript` against the sheet remain refused at every tier under every
  menuType (DD1a — the sheet's JS realm outlives the menu that was open when code was injected),
  so every sheet observable here must be reachable by DOM/ax read alone.
- **browser — guest page** (did the fixture's drop handler fire, and with what) — measured via
  `evaluate` on the guest wcId.
- **application store** (canonical bookmark order per jar) — measured via
  `window.goldfinch.bookmarksGet({ jarId })` evaluated on the chrome target.
- **application topology** (tab urls, per-tab jar) — measured via `enumerateTabs` /
  `enumerateWindows`.
- **rendered pixels** — `captureWindow`, for insertion-indicator and layout claims.
- **operator eyewitness** — for animation-absence claims, which are structurally uncapturable by
  stills (M15 F1 evidentiary precedent).

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Confirm the session backend is X11. Confirm the bar is visible with ≥6 items in the fixture jar. Bank the canonical order: read `bookmarksGet({ jarId })` **and** the rendered `.bm-item` label sequence. Capture the window. | Store order and rendered order agree, item for item. The banked order is the baseline every later row diffs against. **If they already disagree, halt** — that is a pre-existing defect, not a drag finding. |
| 2 | (Setup, no judgment) Widen the window until every item fits: no `.bm-item` carries `.hidden` and `#bookmarks-overflow` is hidden. | (empty) |
| 3 | **OPERATOR:** press and hold on the **first** bar bookmark, drag it rightward until the insertion indicator sits between the third and fourth items, hold, and confirm what you see *before* releasing. Then release. | While held: an insertion indicator is visible at the drop position, and the operator confirms it sits **between the third and fourth items** — content-specific, not "an indicator appeared". After release: the rendered label sequence has that bookmark at index 3 (0-based) with all others in their prior relative order. `bookmarksGet` returns the **same** sequence — store and render agree. |
| 4 | (No actions — read only.) Re-read `bookmarksGet({ jarId })` and inspect each entry's `position` and `icon`. | Positions are gap-free `0..n-1` with no duplicates and no gaps. Every entry's `icon` is unchanged from the row-1 bank — a reorder rewrites position only. |
| 5 | Open a second window on the **same** jar and a third tab on the **other** jar. **OPERATOR:** in the first window, drag the last bar bookmark to the first position. | The second window's bar re-renders to the new order **without any interaction in that window**. The other jar's bar is **byte-identical** to before — read its `bookmarksGet` and diff. No bookmark data crosses the jar boundary on a reorder. |
| 6 | Restart the app. Reopen a tab in the fixture jar. Read the rendered bar and `bookmarksGet({ jarId })`. | Both match the order established at row 5, including icons. The restart-persistence criterion holds across a **reorder** path, which it has never been exercised on. |
| 7 | Navigate the active tab to the fixture page with its own `drop` handler. **OPERATOR:** drag a bar bookmark onto the page area and release over the fixture's drop zone. | The fixture's handler **fired** and received the bookmark's url on `text/uri-list` (read it back via guest `evaluate`). The tab did **NOT** navigate — its url is still the fixture page (`enumerateTabs`). The page won the drop, per DD5. |
| 8 | Navigate the active tab to an ordinary page with no drop handler. Bank its url. **OPERATOR:** drag a bar bookmark onto the page area and release. | The tab navigates to that bookmark's url. Confirm via `enumerateTabs` **and** the address bar's rendered value — two independent reads, because a single read cannot distinguish "navigated" from "address chip updated". The page area was the drop target, not the chrome. |
| 9 | (Negative control, part 1 — no gesture.) Attempt to reach `ipcRenderer` from the page main world via guest `evaluate`. | It is **unreachable**. Guests run `nodeIntegration: false, sandbox: true` (`register-tab-ipc.js:105-107`, `guest-wiring.js:175-177`), so the page realm has no IPC handle even though `contextIsolation` is off. **If an Executor does find a route, that is a finding and the run halts** — it would mean the preload leaked a handle, which is a larger defect than anything else this spec tests. |
| 10 | (Negative control, part 2 — the one authorised fabrication; see the banner carve-out.) With **no drag in progress**, use guest `evaluate` to dispatch a fabricated `DragEvent` of type `drop` at `document`, carrying `application/x-goldfinch-bookmark` — the realistic hostile-page route, since row 9 establishes IPC is not one. Then read the tab's url. | **Assert the observable, not the mechanism**: the tab's url is unchanged and no navigation is recorded in history. *Why* it does nothing depends on which branch leg 3 took — the declared-drag bookend refusing a session-less signal (DD6), or simply that no such path exists because Chromium's own default handling carried the feature (DD5b-positive). Either is a pass; record which. **This row is the control that gives row 8 its meaning** — without it, row 8 passing proves only that *something* navigates. A fabricated drop that *did* navigate is a security finding, not a test failure. |
| 11 | (Setup, no judgment) Narrow the window until at least two items collapse into overflow. Bank which labels are visible and which are in the overflow snapshot. | (empty) |
| 12 | *(GATED on the M15 F3 leg-1 DD8 verdict — void if not-viable.)* **OPERATOR:** open the overflow menu, then drag the **first overflow row** out onto the bar, releasing over the second visible slot. Note that the mutation broadcasts and `closeOverflowIfOpen` closes the sheet as `'superseded'` — **re-open the overflow menu before reading its contents**. | The dragged bookmark is now visible on the bar at index 1. The item that was **last-visible** before the gesture has been pushed into overflow — re-open the sheet and read its rows to confirm it is there. `bookmarksGet` reflects the new full-list order. Membership was re-derived, not stored (DD4). |
| 13 | *(GATED — void if not-viable.)* **OPERATOR:** drag a **visible** bar bookmark onto the overflow chevron and release. Re-open the overflow menu before reading it. | That bookmark is no longer among the visible `.bm-item`s and **is** among the overflow sheet's rows. Some other item became visible in its place. `bookmarksGet` order matches what bar-then-overflow reads as a single sequence. |
| 14 | *(GATED — void if DD1 was reverted.)* With the overflow menu open, run `readAxTree` against the sheet. Then, in the same session, open a vault sheet and attempt the same read. `[a11y]` | The overflow read **completes** rather than being refused — the load-bearing half of this row, since this surface has been unreachable since M15 F1. Report accessibility findings; a finding is a result, not a failure of this row. The vault read **is refused**, proving the gate discriminates rather than being open. Additionally confirm `evaluate` against the sheet is refused **even under `bookmarks-overflow`** — DD1a's op-class split, which is what stops injected code outliving the menu it was injected under. |
| 15 | **OPERATOR:** perform one more reorder drag and watch the guest page area throughout. Report specifically whether the page area moved, resized, or animated at any point. | The operator reports **no** movement, resize, or animation of the guest area. A reorder changes only the bar's contents, never its height, so nothing should reflow. Content-specific operator report required — a terse "looked fine" is insufficient corroboration for an absence claim (M15 F1 debrief). |

**Row conventions**

- One row = one logical checkpoint.
- `OPERATOR:` rows are physical gestures. The Executor does not attempt them by any means.
- Empty Expected Results = pure setup; the Validator skips judgment.
- Rows marked *(GATED)* are **void** — neither pass nor fail — when their precondition did not
  hold. Record the reason; do not silently drop them.

## Out of Scope

- Dragging a link **from a page onto the bar** to create a bookmark — reverse cross-surface drag,
  excluded at mission level (mission.md:44).
- Bookmark folders, import/export, a bookmark manager page — excluded at mission level.
- Tab drag in any form — covered by `cross-window-drag.md` and `tab-reorder`.
- Click, middle-click, and Ctrl+click activation of bar and overflow items — covered by
  `bookmarks-bar.md`.
- Jar scoping of the bar, star, and suggestions generally — covered by
  `bookmarks-jar-scoping.md`. Row 5 asserts only that **reorder** does not breach it.
- Auto-scroll when dragging past the bar's edge — an acceptable variation, not a criterion.

## Variants

None. The gesture cost is the binding constraint; a variant axis would multiply operator time
without adding a distinct claim.
