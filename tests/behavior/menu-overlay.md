# Behavior Test: Menu overlay sheet — live-guest float, click-swallow dismissal, find-bar interplay

**Slug**: `menu-overlay`
**Status**: active
**Created**: 2026-07-02
**Last Run**: 2026-07-15-16-32-06 (PASS 6/6 — M09 F7 leg-1 invariant proof, spec UNMODIFIED; the
per-window overlay conversion left the guest viewport **byte-identical** to baseline, maxdelta 0 —
[run log](menu-overlay/runs/2026-07-15-16-32-06.md)). **The three errata that run's Validator
recommended are FOLDED (M09 F7 leg 4)** — the multi-view typing rule is now stated symmetrically for
the find overlay, trigger `:hover` is a declared mutable region, and step 6's scope is reconciled to
the **guest region** (which is what the sheet covers, and what this spec's Intent always said). Sheet
discovery is also re-pointed onto `enumerateWindows` (DD2).
Prior: 2026-07-06-22-07-02 (PASS 6/6 — first run; promoted draft → active. Three wording
tightenings folded in from that run's Validator: step-2 both-grabs-while-open made explicit;
step-1/step-3 recorded-coordinates dependency made explicit; the toolbar automation-activity
badge named as an expected mutable region.)

> **Why this spec exists.** Flight 8 replaces the freeze-frame menu mechanism (capture → still → hide
> live guest → chrome DOM menu) with a transparent full-guest overlay `WebContentsView` (the "sheet")
> hosting all menus over the **live** guest. The load-bearing, pixel-only properties — the guest stays
> live and visible under an open menu (no frozen still), outside-clicks dismiss AND are swallowed
> (parity), the find bar hides under a menu and restores on dismiss, and the sheet leaves no residue
> after dismissal — are rendered-surface facts no unit test can reach. This spec is the re-runnable
> regression net for that mechanism.

> **Apparatus-wiring litmus (Flight-4 carry-forward — REQUIRED before running).** Before any step,
> confirm the goldfinch MCP client is wired to **this** flight instance at the **admin** tier:
> `getChromeTarget()` returns a chrome wcId AND `enumerateTabs()` lists *this* instance's tabs. If
> either fails, the apparatus is mis-wired — **park this spec** (the HAT still covers the surface) and
> record.

## Intent

Verify, on rendered pixels, that the menu overlay sheet (1) floats menus over a **live** guest — page
content visibly continues to update while a menu is open (the anti-freeze property); (2) dismisses on
outside-click with the click **swallowed** — the page does not act on it (parity with freeze-era
dismissal); (3) hides the find overlay while a menu is open and restores it on dismiss (Flight-7 DD5
behavior, re-wired); (4) leaves no sheet residue after dismissal — the guest region returns
pixel-equivalent to baseline. These are "DOM-correct ≠ render-correct" (SC2-class) properties asserted
via `captureWindow`.

## Preconditions

- **Apparatus-wiring litmus passed** (above) — admin MCP bound to this instance.
- App running via `npm run dev:automation` with `GOLDFINCH_AUTOMATION_DEV_MINT=1`
  `GOLDFINCH_AUTOMATION_ADMIN=1` + a pinned free `GOLDFINCH_MCP_PORT`; `adminKey` captured.
- Flight 8 landed (menus render from the sheet; freeze-frame machinery deleted).
- **Multi-view targeting rule — state it for EVERY overlay view, symmetrically (M09 F7 leg 4).** This
  window hosts three distinct webContents on top of each other: the **chrome**, the **guest**, and two
  per-window overlay views — the **sheet** and the **find overlay**. Input ops target a webContents
  **by wcId**, not by what is visually on top, so **an op sent to the wrong view is silently accepted
  and does nothing visible where you expect it.** Concretely: **`typeText(guestWcId)` silently misses
  the find input** — the keystrokes land in the page underneath, the find bar stays empty, and nothing
  refuses. *(This was caught only on pixels; it is written here so the next run does not re-learn it
  the same way.)* Target the view that owns the surface: the **find input → `findWcId`**
  (`enumerateWindows().findWcId`), the **menu → `sheetWcId`**, the **page → the guest wcId**, the
  **triggers/toolbar → the chrome wcId**. The rule is symmetric across both overlays — the sheet's
  version of it was already known; the find overlay's is the same rule.
- **Trigger `:hover` is a DECLARED MUTABLE REGION.** An injected `click(chromeWcId, x, y)` leaves the
  pointer resting over the last trigger it clicked, so that trigger renders its `:hover` tint in every
  subsequent grab. This is **apparatus residue, not sheet residue** — it is expected, and it must be
  declared rather than rediscovered as an unexplained band (it is exactly what made the step-6 band
  ambiguous on the 2026-07-15 run). Either accept the trigger's hover tint as mutable, or pin the
  driver to `evaluate`-clicks (which move no pointer) when a pixel comparison spans the toolbar.

## Observables Required

- **browser / rendered window — AUTHORITATIVE** (`captureWindow()`): menu compositing over live guest
  content; liveness deltas between successive grabs; find-bar presence/absence; post-dismiss
  return-to-baseline. Also `getChromeTarget` / `enumerateTabs` (litmus + setup).
- **mcp — corroborating** (`readDom(chromeWcId)`): trigger `aria-expanded` state, focus-return target.
  **Note:** the sheet is a separate non-enumerated per-window `WebContentsView` — resolve it via
  **`enumerateWindows()`** (M09 F7 DD2), whose per-window row carries `sheetWcId` and `sheetVisible`;
  drive/read it by that wcId. The op is **admin-only** (as `getChromeTarget` already is here). The sheet
  materializes lazily on first menu open, so **`sheetWcId` is absent until then** — resolve after the
  first open. Read `sheetVisible` (not id presence) to judge shown-vs-hidden.
  The sheet's DOM persisting after dismissal is expected (lazy, per-window — hidden ≠
  destroyed); **sheet DOM can never serve as a "menu is closed" observable** — pixels are the
  closed-state authority (F7 lesson).

> **Apparatus nuances (proven at F8 Legs 3–4).** (1) `pressKey(sheetWcId, 'Enter')` on a focused
> sheet menuitem does NOT synthesize the DOM click a real Enter does in this multi-view context —
> scripted activation is `click(sheetWcId, x, y)` on the item, or arrow-focus +
> `evaluate(sheetWcId, 'document.activeElement.click()')`; real-keyboard Enter is HAT-covered.
> Escape/Arrow/Home/End DO work via `pressKey` against the sheet wcId. (2) Right-click synthesis is
> **proven**: `click(guestWcId, x, y, { button: 'right' })` fires the real guest `context-menu` path
> (the sheet menu materialized 1:1 at the click point at Leg 4) — the canonical page-context driver.

> **Apparatus limit — injected clicks bypass hit-testing (design-review).** MCP `click(wcId, x, y)`
> delivers via `sendInputEvent` to the *target* webContents regardless of view stacking: clicking the
> guest wcId would navigate the page even with the sheet correctly interposed (false FAIL), and
> clicking the sheet wcId makes "page did not navigate" trivially true (false PASS on interception).
> The property "outside-clicks physically land in the sheet" is a hit-test/z-order fact only a real OS
> pointer can exercise — it belongs to the **HAT**, not this spec. Step 3 therefore asserts the
> sheet's *dismiss-without-forwarding* contract (click the **resolved sheet wcId**), not OS-level
> interception.

> **Absence-authoritativeness rule (F7 codification).** Sheet/find-bar *absence* checks are
> authoritative only after a same-run grab has shown the overlay compositing on the active capture
> path. Step 2 establishes this for the sheet; step 5 for the find bar. **The instrument must be shown
> able to report presence before its silence counts as absence.**
>
> **Both capture paths composite this window's overlays (corrected M09 F7 leg 4).** An earlier version
> of this note said the WSLg fallback draws "chrome + active guest only", making overlay-presence
> "best-effort", and told the runner to **defer to the HAT if the fallback is in force**. That is
> **false for this build, and the instruction was the harmful part**: it would park a fully-assertable
> step. Read off the source — the fallback builds an explicit bottom-up layer list (guest → find bar →
> menu-overlay sheet), and its own comment names the failure the layers exist to prevent: *"without the
> overlay layers a Wayland-path captureWindow would silently omit an OPEN MENU / find bar that IS on
> the real screen."* Overlay presence/absence is a **first-class pixel assertion on both paths**; do not
> defer it. *(The same false caveat was folded out of `find-overlay-geometry.md` in the same pass.)*

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Litmus: `getChromeTarget()`, `enumerateTabs()`. Open a web tab (Default jar) on the liveness fixture — `tests/behavior/fixtures/menu-overlay/` (**exists**, built at F8 Legs 1+4): a ticking seconds display, a **bottom-left link** (`#outside-link` — placed away from the top-right so step 3's outside-click point can never fall inside a menu rect), plus a mid-page link, a same-origin image, a selectable paragraph, and an editable input (used by `page-context-menu.md`). Serve it locally the same way the a11y fixture is. Record chrome + guest wcId **and the `#outside-link` center coordinates (getBoundingClientRect)** — step 3 clicks exactly these recorded coordinates. Baseline `captureWindow()` (no menu open). | (setup) Litmus passes. Record baseline: guest full-height, ticking-region location, **outside-link center coordinates**, no menu, no find bar. |
| 2 | **Live-guest float:** open the kebab (⋮) menu. Take `captureWindow()`, wait ~2s, take a second `captureWindow()` — **BOTH grabs taken while the menu is open** (an open-grab pair; a baseline-vs-open diff proves only change-since-baseline, not liveness under the menu). | Menu renders composited over the guest; guest content is **visible and full-height** around it (no frozen still, no push-down). The ticking region **differs between the two grabs** — the guest is live under the open menu (freeze-frame would show identical stills). [render-correct] |
| 3 | **Dismiss-without-forwarding:** with the menu open, resolve the **sheet's** wcId from `enumerateWindows()` (see Observables note); `click` the **sheet wcId** at the step-1 **recorded** `#outside-link` center coordinates (outside the menu rect — the swallow claim is vacuous if the click misses the link). `captureWindow()`; read the active tab's URL via `enumerateTabs()`. | The menu is dismissed and the click was **not forwarded** — the page did NOT navigate (URL unchanged, ticking page still at baseline framing). True OS-pointer interception (clicks physically landing in the sheet, not the guest) is verified by the **HAT**, per the apparatus-limit note. [render-correct] |
| 4 | **Keyboard contract + focus return:** re-open the kebab via keyboard from chrome (focus trigger, ArrowDown). `readDom(chromeWcId)` — trigger's `aria-expanded` **while open**; `readDom(sheetWcId)` — focused/roving item state. `pressKey ArrowDown` then `Escape` against the sheet wcId. `captureWindow()`; `readDom(chromeWcId)` for focus/aria state. | While open: trigger has `aria-expanded="true"` and the sheet shows a focused item (roving, via the sheet-wcId DOM read). After Escape: menu dismissed on pixels; `aria-expanded="false"`; focus returned to the trigger. |
| 5 | **Find-bar interplay:** open find (Ctrl+F), type a term (count corroborates). `captureWindow()`. Open the container (▾) menu. `captureWindow()`. Dismiss (Escape). `captureWindow()`. | Find bar visible pre-menu (establishes presence on this capture path). While the menu is open the find bar is **hidden**; on dismiss it is **restored** at correct bounds with query intact. [render-correct] |
| 6 | **Return-to-baseline:** ensure all menus/find closed (Escape as needed). Final `captureWindow()`. Compare **the guest region** against the step-1 baseline's guest region. | **The GUEST REGION is pixel-equivalent to the step-1 baseline's guest region** — no menu, no sheet residue/strip, no find bar, guest full-height. **Scope is the guest region, not the whole frame** *(reconciled M09 F7 leg 4: this spec's Intent says the property is "the guest region returns pixel-equivalent to baseline" while this row previously said "Frame" — the sheet covers the guest region, so the guest region is the surface whose residue this spec owns; the disagreement is what made the 2026-07-15 band ambiguous)*. **Expected mutable regions** — the fixture's clock/tick text and, if the comparison is widened past the guest region, the toolbar automation-activity badge (increments on every MCP op) and the last-clicked trigger's `:hover` tint (see Preconditions). Sheet DOM may persist hidden (lazy, per-window) — pixels govern. |

**Row conventions:** Row 1 is setup + litmus. Rows 2–6 each assert one rendered-state checkpoint.
`[render-correct]` flags SC2 rendered-vs-DOM checks.

## Out of Scope

- **Menu item actions** (Settings opens, container tab created, copy-link, spelling fix) — covered by
  `internal-tab-menus.md`, `page-context-menu.md`, and unit tests where reachable.
- **Context-menu positioning/params content** — `page-context-menu.md`.
- **Menus over internal tabs** — `internal-tab-menus.md` (updated at Flight-8 cutover).
- **Find engine results** — `find-in-page.md`; find-bar *geometry* — `find-overlay-geometry.md`.
- **macOS rendering** — Flight-6 landing gate.

## Variants (optional)

- Repeat step 5 with the kebab and the page context menu (right-click) as the menu trigger — the find
  bar must hide for **every** menu surface, not just the container menu.
- Repeat step 2 on an internal `goldfinch://` tab (kebab only) — menu floats over the live internal
  view.
