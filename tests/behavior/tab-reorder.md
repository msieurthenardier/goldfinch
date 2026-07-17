# Behavior Test: Pointer-drag and keyboard tab reorder, and the DD2 click-model regression

**Slug**: `tab-reorder`
**Status**: active
**Created**: 2026-07-14
**Last Run**: 2026-07-16-06-33-26 — **partial** (M09 F8 leg 5; **8/9 PASS**, Step 4 **INCONCLUSIVE**
— instrument limit) — [run log](tab-reorder/runs/2026-07-16-06-33-26.md).
**The F2 reorder contract SURVIVES F8's zone model**: leg 3 interposed `classifyDragPoint` on every
`pointermove` and changed the arm threshold `Math.abs(dx)` → `Math.hypot(dx, dy)`; Step 3 proves
in-strip reorder intact (independently recomputed drop index; drag provably armed, 5 moves delivered,
`detachingSeen:false`).
**Step 4 cannot fail and is filed INCONCLUSIVE, not PASS.** It reads `window.screenX` → **564** — the
exact value F8's spike proved a **cached fiction** against a Win32/RAIL witness (a *real* OS move
leaves it unchanged and fires **no event**). Its WSLg hatch fires only on *"a constant placeholder
(e.g. always 0)"* — **calibrated to the wrong tell: the failure is FROZEN, not ZERO.**
**⚠ OWNERSHIP GAP — this spec does NOT own the `Math.hypot` threshold, though `tab-tearoff.md` used to
say it did (now corrected).** Its only drag holds y constant ⇒ `dy=0` ⇒ `hypot(dx,0) ≡ abs(dx)`.
**No spec and no unit test falsifies the straight-down case (`dx=0, dy>5`) the change was made for.**
**OWED**: re-instrument or delete Step 4; add a **unit** test over the threshold predicate. **Owner: F9.**

## Intent

Verify the tab strip's pointer-drag reorder (Chrome-style live sibling displacement, model-driven
drop via `dropIndexFromPointer`), that a completed in-strip drag never moves the window, that
`closeTab`'s next-tab pick follows DOM order (not Map/creation order) after a reorder, and that the
DD2 activation-semantics refactor (pointerdown activates; click becomes a guarded fallback) has not
regressed the plain-click / ✕-click / middle-click model. This needs a behavior test because pointer
drag is *real trusted pointer-event sequencing driving a live gesture state machine in the running
Electron chrome* (arm threshold, transform displacement, `setPointerCapture`, drop commit) — a unit
test can exercise the pure `tab-order.js` decision functions (already covered by
`test/unit/tab-order.test.js`) but cannot drive the DOM-bound gesture itself. (M09 Flight 2 DD2/DD4/
DD5.)

## Preconditions

- **Apparatus — admin MCP surface.** Goldfinch is running via `npm run dev:automation` with
  `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1`. At launch, the app prints
  `AUTOMATION_DEV_MINT { "key": "...", "adminKey": "..." }` to stdout — capture the `adminKey`. The
  MCP server listens on `127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`.
- **Port (load-bearing for every URL below) — pin-if-free, else free-fallback.** Try pinning the
  listen port via `GOLDFINCH_MCP_PORT=49707`. If the launch fails to bind it, relaunch **without**
  the env pin — the server free-falls to the next available port and prints it (and a fresh
  `AUTOMATION_DEV_MINT`) to stdout. Read the actually-bound port from that output and reuse it in
  every SDK call below.
- **How the admin key attaches to the client (load-bearing).** Connect an admin MCP client (SDK
  `StreamableHTTPClientTransport`, `Authorization: Bearer <adminKey>`) on
  `127.0.0.1:$GOLDFINCH_MCP_PORT/mcp` — the Bearer rides every request. This spec requires the
  **admin** key: a jar key is refused `getChromeTarget` and cannot drive the chrome renderer.
- **Drive the renderer (chrome UI), NOT a guest WebContentsView.** `getChromeTarget()` returns the
  chrome `wcId` directly. All drive and observe calls below pass this `wcId`.
- **The apparatus act-axis gap is closed for this spec by `dragPointer` (M09 F2 Leg 2, DD4).** Prior
  specs' "no move-only primitive" workaround (a `click` at a safe coordinate to induce a
  `mouseleave` side-effect) is unrelated to and does not substitute for pointer-drag — `dragPointer
  (wcId, from, to, { steps?, stepDelayMs? })` is the dedicated primitive: mouseDown at `from`, N
  interpolated mouseMove events with the button held, mouseUp at `to`. **Apparatus fact from the
  premise spike (recorded in the flight log):** an unpaced synchronous burst of the interpolated
  moves gets coalesced by Chromium down to only a few of the sent events (typically first + a
  handful + last, not all N) — the op paces one event per macrotask (`stepDelayMs`, default 4ms) to
  improve fidelity, but even so, expect a real live drag to deliver FEWER discrete `pointermove`
  events than were sent. This is fine for this spec's assertions: `dragEvents`' last interpolated
  step is guaranteed to equal `to` exactly, so the FINAL drop position is reliable regardless of how
  many intermediate events were coalesced away — only the *motion* (how it looks mid-drag) is
  degraded, and that is HAT-scoped (see Out of Scope).
- **A live drag also holds `e.buttons === 0` on every `pointermove` after the down (apparatus fact,
  spike finding) — informational, not load-bearing.** `pointerdown`/`pointerup` correctly report the
  primary button (`buttons:1` / `button:0`), and `setPointerCapture` succeeds, but Chromium does not
  propagate a "still held" buttons bitmask onto the intervening synthetic `pointermove` events. The
  product's own gesture code does not gate on `e.buttons` (it tracks `pointerId` + a cumulative `dx`
  from the recorded pointerdown-time origin), so this does not affect any assertion below — noted so
  a future spec author isn't surprised by it.
- **Input delivered as trusted events** via the MCP tools (`dragPointer`, `click(wcId, x, y[,
  {button}])`, `pressKey(wcId, name[, modifiers])`) — only trusted events fire the renderer's real
  handlers + native focus traversal + `setPointerCapture`.
- **Numeric geometry reads are the primary observable (M09 F1 DD4 convention, carried forward).**
  Admin-tier `evaluate(chromeWcId, expression)` runs a JSON-serializable-return expression against
  the chrome document — used for DOM order (`[...document.querySelectorAll('#tabs .tab')].map(t =>
  t.dataset.id)`), tab rects (`getBoundingClientRect()` per tab, for computing drag/click
  coordinates), and the no-window-move check (`{ x: window.screenX, y: window.screenY, w:
  window.outerWidth, h: window.outerHeight }`).
  **WSLg caveat on the window-geometry read:** on some Wayland compositors `window.screenX`/
  `screenY` may report a constant placeholder (e.g. always `0`) regardless of real position — if
  the before/after reads are trivially equal only because both are the constant, note this in the
  run log and treat the check as `needs-human-recheck` rather than a hard pass; a real regression
  (the strip's `-webkit-app-region` drag region firing) would still show up as **outer size**
  changing on WSLg even when position doesn't (a window move triggered by a drag region is usually a
  full OS move, but a same-machine sanity cross-check costs nothing).
- **`captureWindow()` remains for rendered-truth** (the historical "DOM correct ≠ render correct"
  failure mode) — used to visually corroborate the post-drop order and to locate coordinates if a
  rect read looks suspect.
- **Coordinate-click rule:** all clicks/drags are coordinate-based, derived from
  `getBoundingClientRect()` reads (preferred, precise) or a `captureWindow()` screenshot (fallback).
- **Fixture-distinctness probe** (folded into Step 2): a local HTTP fixture (or distinct
  `about:blank`-style local pages) serving pages at distinct, non-normalizing URLs so the opened
  tabs are individually identifiable; confirm titles/URLs are pairwise distinct via `readAxTree`
  before relying on tab identity for any later step.
- **Active precondition probe** (Step 1): confirm `tools/list` includes (presence-checked, not an
  exact count) `getChromeTarget`, `evaluate`, `dragPointer`, `pressKey`, `click`. `getChromeTarget()`
  returns a numeric chrome `wcId`.
- **Apparatus disqualification:** the `chrome-devtools` MCP does **NOT** qualify (launches its own
  browser, never touches this app). The apparatus is the SDK admin MCP client over
  `127.0.0.1:$GOLDFINCH_MCP_PORT`, app launched via `npm run dev:automation` — not the CDP attach
  path.
- **The app boots with one default tab already open (apparatus fact, confirmed at the leg-2
  spot-check) — do not assume "open five tabs" yields exactly five.** Leave the default tab in
  place (do not close it; treat it as an ordinary tab) and record the ACTUAL DOM order/count after
  opening the fixture tabs in Step 2, rather than assuming a fixed total. Steps 3 and 6 below are
  worded in terms of "the last tab" / "the Nth-from-left tab" (whatever the observed order says),
  never a hardcoded total, so this is robust to the extra tab.
- **Cancel-restore is unconditionally HAT-scoped, not an automated step here (design-review ruling —
  see Out of Scope for the full rationale).** `dragPointer` is one atomic tool call (down → moves →
  up); the automation surface has no way to pause mid-gesture and inject an `Escape` or
  `pointercancel` between the down and the up, so there is no cancelable intermediate state this
  apparatus can reach. Keyboard reorder commits synchronously (no drag-in-progress state at all), so
  it has nothing to cancel either. This spec does not attempt an automated cancel assertion.

## Observables Required

- mcp (admin MCP tools on the chrome `wcId`, measured via the admin MCP client connected with the
  admin Bearer header): `evaluate(chromeWcId, …)` numeric reads are the primary observable for DOM
  order, tab rects, and window geometry. `readAxTree(wcId)` for tab titles/selected-state/
  `aria-keyshortcuts`. `dragPointer` for the pointer-drag gesture. `click`/`pressKey` for the
  click-model and keyboard-reorder checks. `captureWindow()` for rendered-truth corroboration.
- shell (precondition probe: `tools/list` and `getChromeTarget` — measured via the MCP client or
  Bash).

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the admin MCP client; call `tools/list`; then call `getChromeTarget()`. | `tools/list` **includes** (presence-checked) `getChromeTarget`, `evaluate`, `dragPointer`, `pressKey`, `click`. `getChromeTarget()` returns `{ wcId, kind: 'chrome', url }` with a **numeric** `wcId`. If not, halt — preconditions not met. |
| 2 | Open **five** tabs at distinct fixture URLs (titles distinguishable as Tab1..Tab5) — in addition to whatever default tab the app booted with. Confirm pairwise-distinct titles via `readAxTree(wcId)`. Record the ACTUAL resulting DOM order (`evaluate`, `.tab` `dataset.id` sequence — do not assume a fixed count) and the baseline window geometry (`evaluate`, `{screenX, screenY, outerWidth, outerHeight}`). | Titles are pairwise distinct — halt and fix the fixture if any two collide. Baseline DOM order (whatever its actual length) and window geometry are recorded for later comparison. (setup row) |
| 3 | **Pointer drag end-state.** `evaluate` each `.tab`'s `getBoundingClientRect()`. Compute `from` = the 3rd-from-left tab's center and `to` = a point past the LAST tab's horizontal midpoint (e.g. 75% across the last tab's own width — "last" meaning whichever tab the current DOM order puts furthest right, NOT an assumed count). Call `dragPointer(chromeWcId, from, to)`. Then `evaluate` the DOM order again, `readAxTree(wcId)` for the tab title sequence + `selected` state, and take a `captureWindow()`. | Because `to.x` is chosen past the tab that is CURRENTLY last, every other tab's original midpoint is necessarily to its left, so `dropIndexFromPointer` counts all of them — the dragged (3rd-from-left) tab lands **last** in the new DOM order (verify this by direct computation from the recorded rects too, not just this general argument). The DOM order read, the `readAxTree` title sequence, and the screenshot's visual left-to-right order all **agree** on this new order. The dragged tab is now the **selected** tab (drag-start activation — Chrome parity: a background tab being dragged becomes active). All sibling transforms are cleared (no lingering `translateX` — confirm via a rect re-read showing each tab's rect is a plain rectangle, not offset from where the DOM order implies it should sit). |
| 4 | **No-window-move assertion.** Immediately after Step 3 (no other action in between), `evaluate` the window geometry again (`{screenX, screenY, outerWidth, outerHeight}`). | The geometry is **byte-identical** to Step 2's baseline — the in-strip drag never engaged the `-webkit-app-region: drag` window-move region (`.tab` is `no-drag`). If the read is trivially equal only because the apparatus reports a constant placeholder (WSLg caveat, see Preconditions), mark this row `needs-human-recheck` rather than a hard pass and note it in the run log. |
| 5 | **Keyboard reorder.** Establish a focus anchor (`click` into the chrome, e.g. the address bar), `pressKey(wcId, 'Tab')` into the strip until a tab is focused, record the current DOM order (`evaluate`) and which tab is focused. Call `pressKey(wcId, 'ArrowRight', ['control', 'shift'])` (or `'ArrowLeft'` if the focused tab is already last). Re-read DOM order and `readAxTree`. | The focused tab moves exactly one slot in the pressed direction (confirmed via the DOM-order re-read, matching `keyboardMove`'s one-slot rule); focus stays on the same tab; the `selected` tab (from `readAxTree`) is **unchanged** (reorder moves DOM position only, not selection) unless the focused tab happens to already be the selected one; each tab's `aria-keyshortcuts` includes the reorder chord alongside `Delete`. |
| 6 | **Reorder-then-close neighbor (DD1 consumer regression).** Read the current DOM order (`evaluate`) and the creation order (`enumerateTabs`, which stays creation-order per the flight's own ruling — see Out of Scope). If the tab that is DOM-order-**last** is the SAME as the tab that is creation-order-**last**, perform one more keyboard reorder (Step 5's chord on the current DOM-last tab) to force them to differ. Then activate (via `click`) a tab that is neither the DOM-order-last nor the creation-order-last tab, and close it with `pressKey(wcId, 'Delete')`. | The newly-activated next tab is the one that was **DOM-order-last** immediately before the close — **not** the one that was creation-order-last (that would be the pre-DD1-fix behavior, `[...tabs.keys()].pop()`). Verify via `evaluate`/`readAxTree`: the surviving tab now `selected` matches the DOM-order-last prediction and differs from the creation-order-last one (the discriminating case this step deliberately constructs). |
| 7 | **Click-model regression, part A — synthetic click with NO preceding pointerdown still activates (AT default-action path).** Pick a currently-background tab. `evaluate` a script that dispatches `new MouseEvent('click', { bubbles: true, cancelable: true })` directly on that tab's DOM node (no `click`/`dragPointer` tool call — no pointerdown precedes it). | The tab becomes the **selected** tab (`readAxTree`) — exactly one `selected: true` afterward, and it is this tab. This proves the click handler's activate branch still fires for a click that never had a preceding pointerdown (`suppressClickActivate` defaults false). |
| 8 | **Click-model regression, part B — a real trusted click still activates exactly once.** Pick a different background tab; locate its body coordinates (rect read). Call `click(chromeWcId, x, y)` on it (a real trusted mouseMove→mouseDown→mouseUp sequence — this exercises BOTH the DD2 pointerdown-activation path and the click handler's now-guarded fallback in the same gesture, same as a real user click). | The clicked tab becomes the selected tab; exactly **one** tab is `selected: true` afterward (no double-activation artifact — the end-state is the same whichever internal path fired, which is why this is an end-state check; the two-set-point suppression-flag *logic* itself is verified by code review per the flight's design-review ruling, not by this spec). |
| 9 | **Click-model regression, part C — ✕-click and middle-click on a BACKGROUND tab close it without flash-activating it.** Note the currently-active tab. Locate a different, background tab's ✕-button coordinates (rect read) and call `click(chromeWcId, x, y)` on it. Then, with several tabs still open, locate another background tab's body (not its ✕) and call `click(chromeWcId, x, y, { button: 'middle' })` on it. | Each call removes the targeted tab (count −1 each time). After **each** close, the tab that is `selected: true` is the **same tab that was active immediately before that close** — the background close never changed the active tab, i.e. never flash-activated the closed tab en route to closing it. |

**Row conventions:** one row = one checkpoint; screenshots are captured alongside numeric reads at
Steps 3 and 4 for rendered-truth corroboration per the project's DOM-correct-≠-render-correct
lesson.

## Out of Scope

- **Cancel-restore (Escape / `pointercancel` mid-drag) is unconditionally HAT-scoped, not tested by
  this spec at all (design-review ruling).** `dragPointer` is atomic — the automation surface cannot
  pause between the mouseDown and mouseUp to inject a cancel key, so there is no reachable
  intermediate state to cancel from over this apparatus. Keyboard reorder commits synchronously (no
  drag-in-progress state), so it has no cancelable intermediate state either. A human tester
  performing a real mouse drag and pressing Escape mid-gesture is the only way to observe this
  behavior; it is verified in the mission's later HAT flight, not here.
- **Mid-drag motion legibility (sibling displacement animation smoothness, drop-indicator
  legibility while dragging) is HAT-scoped (DD4, the F9 lesson).** `dragPointer` is one atomic call;
  a concurrent `evaluate`/`captureWindow` cannot observe intermediate frames mid-gesture, and even if
  it could, a discrete capture can land on a settled frame and miss a motion defect (F9 proved
  this). This spec asserts only the drop's numeric/rendered END-STATE (Steps 3–4); a human eye
  watching the drag live is what judges whether the displacement reads smoothly.
- **`enumerateTabs`/`listTabs()` stays creation-order, not DOM-order (flight-level FD ruling, Open
  Questions).** After this flight, Map/creation order permanently diverges from visual order once a
  tab is moved. `enumerateTabs` consumers address tabs by `wcId`, never by position, so this is
  accepted — Step 6 exploits the divergence deliberately rather than treating it as a defect. Whether
  agents need a visual-order field (e.g. `orderIndex`) is a later Flight-7 automation-surface-audit
  decision, not this spec's concern.
- **Drag-start while a sheet menu or find overlay is open** — a single live spot-check (not an
  automated step) per the leg's Edge Cases; recorded in the flight log, not re-verified here on every
  run.
- **Tear-off (dragging a tab out of the strip into a new window)** — explicitly a later mission
  flight (Edge Cases: "Chrome detaches into tear-off here — THAT is a later flight; for now the
  gesture stays 1-D horizontal").
- **RTL layout** — the tab-order model is LTR-only by design (`tab-order.js`'s own doc comment);
  RTL is out of scope for the whole flight, not just this spec.
- **Sliver-width drag precision** — the gesture works at any tab count (threshold is pointer-space,
  not tab-space) but precision degrades at pathological counts; this is an accepted DD2 trade-off,
  not a regression this spec gates on. `responsive-tab-strip.md` covers the shrink-to-fit geometry
  itself.
- **Window drag-to-move** (dragging the strip's own drag region, not a tab) — covered by manual
  checks per the flight-1 spec's existing Out of Scope note; unrelated to tab reorder.
- **Live right-click / other-`auxclick`-button no-op** — same accepted scope boundary as
  `responsive-tab-strip.md`'s equivalent note; not re-verified here.

## Variants (optional)

- N/A for the initial authoring. A future variant could re-run Steps 3/8/9 at a pathological tab
  count (60+, sliver widths) to characterize (not gate) precision degradation.
