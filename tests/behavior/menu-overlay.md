# Behavior Test: Menu overlay sheet — live-guest float, click-swallow dismissal, find-bar interplay

**Slug**: `menu-overlay`
**Status**: active
**Created**: 2026-07-02
**Last Run**: 2026-07-06-22-07-02 (PASS 6/6 — first run; promoted draft → active. Three wording
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

## Observables Required

- **browser / rendered window — AUTHORITATIVE** (`captureWindow()`): menu compositing over live guest
  content; liveness deltas between successive grabs; find-bar presence/absence; post-dismiss
  return-to-baseline. Also `getChromeTarget` / `enumerateTabs` (litmus + setup).
- **mcp — corroborating** (`readDom(chromeWcId)`): trigger `aria-expanded` state, focus-return target.
  **Note:** the sheet is a separate non-enumerated `WebContentsView` — drive/read it by **probed wcId**
  (the F7 technique: probe the id-space around the known chrome/guest ids; `readDom(id)` returning the
  menu-overlay markup identifies it). **Background-tab-safe walk (F8 Leg-5 lesson): skip every
  `enumerateTabs` wcId and the chrome wcId** — the eval/read ops are foreground-first, so probing a
  background TAB activates it, firing a `tab-switch` close of the menu under test; the sheet is never
  in `enumerateTabs`, so nothing is lost. Discover once per run (the sheet materializes lazily on
  first menu open). The sheet's DOM persisting after dismissal is expected (lazy singleton — hidden ≠
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
> sheet's *dismiss-without-forwarding* contract (click the **probed sheet wcId**), not OS-level
> interception.

> **Absence-authoritativeness rule (F7 codification).** Sheet/find-bar *absence* checks are
> authoritative only after a same-run grab has shown the overlay compositing on the active capture
> path. Step 2 establishes this for the sheet; step 5 for the find bar. On the WSLg `captureWindow`
> fallback path (chrome + active guest only), overlay-presence checks are best-effort — confirm which
> path is active before failing a presence check; defer to the HAT if the fallback is in force.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Litmus: `getChromeTarget()`, `enumerateTabs()`. Open a web tab (Default jar) on the liveness fixture — `tests/behavior/fixtures/menu-overlay/` (**exists**, built at F8 Legs 1+4): a ticking seconds display, a **bottom-left link** (`#outside-link` — placed away from the top-right so step 3's outside-click point can never fall inside a menu rect), plus a mid-page link, a same-origin image, a selectable paragraph, and an editable input (used by `page-context-menu.md`). Serve it locally the same way the a11y fixture is. Record chrome + guest wcId **and the `#outside-link` center coordinates (getBoundingClientRect)** — step 3 clicks exactly these recorded coordinates. Baseline `captureWindow()` (no menu open). | (setup) Litmus passes. Record baseline: guest full-height, ticking-region location, **outside-link center coordinates**, no menu, no find bar. |
| 2 | **Live-guest float:** open the kebab (⋮) menu. Take `captureWindow()`, wait ~2s, take a second `captureWindow()` — **BOTH grabs taken while the menu is open** (an open-grab pair; a baseline-vs-open diff proves only change-since-baseline, not liveness under the menu). | Menu renders composited over the guest; guest content is **visible and full-height** around it (no frozen still, no push-down). The ticking region **differs between the two grabs** — the guest is live under the open menu (freeze-frame would show identical stills). [render-correct] |
| 3 | **Dismiss-without-forwarding:** with the menu open, probe the **sheet's** wcId (see Observables note); `click` the **sheet wcId** at the step-1 **recorded** `#outside-link` center coordinates (outside the menu rect — the swallow claim is vacuous if the click misses the link). `captureWindow()`; read the active tab's URL via `enumerateTabs()`. | The menu is dismissed and the click was **not forwarded** — the page did NOT navigate (URL unchanged, ticking page still at baseline framing). True OS-pointer interception (clicks physically landing in the sheet, not the guest) is verified by the **HAT**, per the apparatus-limit note. [render-correct] |
| 4 | **Keyboard contract + focus return:** re-open the kebab via keyboard from chrome (focus trigger, ArrowDown). `readDom(chromeWcId)` — trigger's `aria-expanded` **while open**; `readDom(sheetWcId)` — focused/roving item state. `pressKey ArrowDown` then `Escape` against the sheet wcId. `captureWindow()`; `readDom(chromeWcId)` for focus/aria state. | While open: trigger has `aria-expanded="true"` and the sheet shows a focused item (roving, via the sheet-wcId DOM read). After Escape: menu dismissed on pixels; `aria-expanded="false"`; focus returned to the trigger. |
| 5 | **Find-bar interplay:** open find (Ctrl+F), type a term (count corroborates). `captureWindow()`. Open the container (▾) menu. `captureWindow()`. Dismiss (Escape). `captureWindow()`. | Find bar visible pre-menu (establishes presence on this capture path). While the menu is open the find bar is **hidden**; on dismiss it is **restored** at correct bounds with query intact. [render-correct] |
| 6 | **Return-to-baseline:** ensure all menus/find closed (Escape as needed). Final `captureWindow()`. | Frame pixel-equivalent to the step-1 baseline (modulo time-varying content — **expected mutable regions: the fixture's clock/tick text and the toolbar automation-activity badge**, which increments on every MCP op): no menu, no sheet residue/strip, no find bar, guest full-height. Sheet DOM may persist hidden (lazy singleton) — pixels govern. |

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
