# Behavior Test: Find-overlay geometry — float-not-inset, position-sync, internal-hidden, freeze-hide

**Slug**: `find-overlay-geometry`
**Status**: draft
**Created**: 2026-07-01
**Last Run**: never

> **Why this spec exists.** Flight 7 replaces the inset (push-down) find bar with a floating overlay
> `WebContentsView` stacked above the guest. The load-bearing, pixel-only properties — the bar **floats**
> over full-height guest content (no push-down), tracks the guest's top strip across resize/panel/
> tab-switch, is **hidden** on internal tabs, and **hides during a menu freeze** (restoring on dismiss) —
> are rendered-surface facts no unit test can reach (the renderer/view layer is unit-untestable; the
> overlay is a second native view). This spec is the re-runnable regression net for that geometry.

> **Apparatus-wiring litmus (Flight-4 carry-forward — REQUIRED before running).** Before any step,
> confirm the goldfinch MCP client is wired to **this** flight instance at the **admin** tier:
> `getChromeTarget()` returns a chrome wcId AND `enumerateTabs()` lists *this* instance's tabs (not a
> foreign session's). If either fails (e.g. `admin-only`, or an unrelated tab appears), the apparatus is
> mis-wired — **park this spec** (the HAT still covers the surface) and record. This is the exact failure
> that blocked the Flight-4 corpus.

## Intent

Verify, on the `WebContentsView` guest surface, that the floating overlay find bar (1) **floats** over the
live guest without insetting it (guest content is NOT pushed down when find opens); (2) **position-syncs**
— tracks the guest's top strip when the media/privacy panel opens/closes, on window resize/maximize, and
across tab switches; (3) is **hidden on internal `goldfinch://` tabs** (an internal view would occlude a
stray overlay); (4) **hides during a menu freeze** and restores on dismiss. These are rendered-surface
properties (the mission's SC2 "DOM-correct ≠ render-correct" class), asserted via `captureWindow` pixels.

## Preconditions

- **Apparatus-wiring litmus passed** (above) — admin MCP bound to this instance.
- App running via `npm run dev:automation` with `GOLDFINCH_AUTOMATION_DEV_MINT=1`
  `GOLDFINCH_AUTOMATION_ADMIN=1` + a pinned free `GOLDFINCH_MCP_PORT`; `adminKey` captured.
- Flight 7 landed (the overlay find bar exists; the inset `#find-bar` retired).

## Observables Required

- **browser / rendered window — AUTHORITATIVE for geometry** (`captureWindow()`): the floating bar over
  full-height guest content; its position relative to the guest's top strip; its presence/absence on
  internal tabs and during freeze. Also `getChromeTarget` → chrome wcId; `enumerateTabs` → active web tab
  wcId (litmus + setup).
- **mcp — corroborating** (`readAxTree`/`readDom(chromeWcId)`): chrome-side find open/closed state where
  observable. **Note:** the overlay is a **separate `WebContentsView`**, not an enumerable tab and not the
  chrome — its own DOM/AX is not reachable through the standard MCP surface, so the overlay's *internal*
  state is not directly readable; `captureWindow` pixels are the authoritative observable for this spec.

> **Apparatus caveat — `captureWindow` on the WSLg fallback path.** `captureWindow` has two paths: an OS
> window grab (`desktopCapturer`, primary — composites ALL views incl. the overlay) and a **WSLg/Wayland
> fallback** that composites the chrome image with only `getActiveTabContents().capturePage()` at the
> `#webviews` offset (`main.js:213-275`) — the fallback draws chrome + the **active guest** but **may not
> composite the overlay view** (a sibling child view). So on the WSLg fallback the "overlay visible over
> the guest" pixel assertion is **best-effort**; the OS-window-grab path is authoritative. The
> float-not-inset check (guest content NOT pushed down) is robust on BOTH paths — it reads the *guest*'s
> composited position, which the fallback does draw. If the overlay itself is invisible in a grab, confirm
> which path is active before failing an overlay-presence check; defer overlay-presence to the HAT if the
> fallback is in force.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Apparatus-wiring litmus: `getChromeTarget()`; `enumerateTabs()`. Open a content-rich web tab in the Default jar (e.g. a Wikipedia article) with recognizable content at the very top; record chrome + guest `wcId`. Take a baseline `captureWindow()` (find closed). | (setup) Litmus passes (admin + this instance). Record the baseline y-position of the top page content and the guest's full-height composite. |
| 2 | **Float-not-inset:** open find (`pressKey Control+f`), type a term. Take `captureWindow()`. Compare the guest content's top y-position to the Step-1 baseline. | The find bar renders as a floating strip at the top of the guest region; the **guest content is NOT pushed down** — its top sits at (approximately) the same y as the baseline, now under the floating bar (contrast the old inset bar, which shifted content down). [render-correct] |
| 3 | **Position-sync (panel):** locate the media-panel toggle from a `captureWindow()` screenshot, then `click(chromeWcId, x, y)` to open it. Take a `captureWindow()`. Close the panel (same locate-then-click); `captureWindow()` again. | With the panel open, the overlay bar **reflows** to the top strip of the now-narrower guest region (right edge tracks the guest, not the window); on close it restores to the full-width top strip. No drift, no stale position. [render-correct] |
| 4 | **Position-sync (resize/maximize):** toggle maximize (window control), then restore. `captureWindow()` after each. | The overlay tracks the guest's top strip at the new window size after maximize and after restore — correctly positioned, not stranded at the old bounds. [render-correct] |
| 5 | **Internal-tab hidden (DD7):** with find open on the web tab, open kebab → **Settings** (`goldfinch://settings`). Take `captureWindow()`. | On the internal tab the overlay find bar is **absent** — no floating bar over the Settings page (the overlay is hidden, not merely empty, on internal tabs). [render-correct] |
| 6 | **Freeze-hide/restore (DD5):** switch back to the web tab (find still open); open the **kebab (⋮)** menu (freeze). `captureWindow()`. Dismiss (`Escape`). `captureWindow()`. | While the menu is open (guest frozen) the overlay is **hidden**; on dismiss the overlay is **restored** over the live guest at correct bounds. (On the WSLg fallback, overlay-presence is best-effort — see caveat; defer to the HAT if the fallback is active.) [render-correct] |
| 7 | **Close:** `pressKey Escape` (find). `captureWindow()`. | The overlay is gone; the guest occupies the full region with no residual strip/inset. |

**Row conventions:** Row 1 is setup + the apparatus litmus. Rows 2–7 each assert one rendered-state
checkpoint. `[render-correct]` flags the SC2 rendered-vs-DOM checks.

## Out of Scope

- **The find *engine result*** (match counts, stepping correctness, jar-scoping) — `find-in-page.md`
  (this spec asserts the bar's *geometry/compositing*, not its results).
- **Menus on internal tabs / the freeze-frame menu compositing itself** — `internal-tab-menus.md`,
  `tab-surface-geometry.md` (this spec asserts only the *find overlay* geometry).
- **macOS rendering** — WSLg is the in-loop venue; macOS is the Flight-6 landing gate (which should add
  the find-overlay float + internal→new-tab as HAT steps).

## Variants (optional)

- Repeat Step 6 with the **container (▾)** and the **page context menu** (right-click) instead of the
  kebab — the overlay must hide for every freeze-triggering menu.
