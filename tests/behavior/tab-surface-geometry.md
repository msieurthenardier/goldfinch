# Behavior Test: Tab-surface geometry — menu-over-live-guest, panel-resizes-guest, find-overlay float

**Slug**: `tab-surface-geometry`
**Status**: active
**Created**: 2026-06-26
**Last Run**: never

> **Re-authored 2026-07-02 (F8 Leg 5b).** The freeze-frame rows this spec originally carried (still
> painted into `#webviews backgroundImage`, live guest hidden while a menu is open) were retired at
> the Flight-8 cutover — menus now render from the **menu-overlay sheet** (a transparent full-guest
> `WebContentsView`) over the **live** guest. The former freeze rows are now live-guest rows: **menu
> open ≠ guest hidden**. The geometry rows (panel-resizes-guest, find-overlay float) survive
> unchanged.

> **Carried WSLg known issue.** A tiny sub-frame compositing blip is an operator-accepted WSLg
> artifact (Flight 3 family) — it is NOT a correctness failure. A sub-frame blip on an
> otherwise-correct render is recorded, not failed.

## Intent

Verify, on the `WebContentsView` guest surface, the **geometry and compositing** behaviors that the
Flight-3 migration introduced and that no unit test can reach: (1) **menu-over-live-guest** — opening
a chrome menu composites the menu (rendered from the menu-overlay sheet) **above** a guest that stays
**live and full-bounds** (no still, no hide, no push-down; the sheet's bounds coincide with the guest
region); (2) **panel-resizes-guest** — opening/closing the media (or privacy) side panel reflows the
guest view to the remaining region with no clip, overlap, or dead band; (3) **find-overlay float (not
inset)** — since M05 Flight 7 the find bar is a main-owned overlay `WebContentsView` composited above
the guest; opening it must **not** change the guest's bounds (the guest keeps the full `#webviews`
slot — the old find inset was removed at the F7 cutover). These are *rendered-surface* properties
(the mission's "DOM-correct ≠ render-correct" class), so the test asserts `captureWindow` pixels —
never DOM geometry alone.

## Preconditions

- **Apparatus — admin MCP surface.** Goldfinch running via `npm run dev:automation` with
  `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1` and a pinned `GOLDFINCH_MCP_PORT`
  (pick a free loopback port; prior sessions used 49707/49710). Capture the `adminKey` from the
  `AUTOMATION_DEV_MINT` stdout line. The admin key is required — a jar key is refused `getChromeTarget`
  (`admin-only`) and cannot drive the chrome renderer.
- **This test drives the chrome renderer** (toolbar, menu triggers, and panel live in the chrome; the
  find overlay and the menu-overlay sheet are separate main-owned `WebContentsView`s — NOT in the
  chrome DOM/AX tree and not MCP-enumerable) and observes the **composited window**.
  `getChromeTarget()` returns the chrome `wcId`.
- **Liveness fixture.** The menu-over-live-guest rows need time-varying page content: use the
  `tests/behavior/fixtures/menu-overlay/` fixture (ticking seconds display), served locally (e.g.
  `python3 -m http.server` from the fixture directory) — a static page is pixel-identical live vs
  stale and cannot witness liveness.
- **Coordinate-click rule:** all clicks are coordinate-based — `click(wcId, x, y)` located via a
  `captureWindow()` screenshot. No CSS selectors over the MCP surface.
- **Apparatus disqualification:** the `chrome-devtools` MCP does NOT qualify (it launches its own
  browser and never touches this app). The apparatus is the goldfinch admin MCP surface.

## Observables Required

- **browser / rendered window — AUTHORITATIVE** (`captureWindow()`, OS-grab path): the menu composited
  over live, ticking guest content (liveness = pixel delta between successive grabs); guest bounds
  under panel open/close; the find bar's float. Also `getChromeTarget` → chrome `wcId`;
  `readAxTree(chromeWcId)` / `readDom(chromeWcId)` for menu/panel trigger state (`aria-expanded`);
  `enumerateTabs` for the active web tab `wcId`.
- **mcp — corroborating**: the menu-overlay sheet's rendered menu via `readDom(sheetWcId)` if probed
  (optional here — `menu-overlay.md` owns the sheet's DOM contract). **Sheet/find-bar DOM can never
  serve as a "closed" observable** (lazy singletons — hidden ≠ destroyed); pixels are the closed-state
  authority.

> **Apparatus caveat — `captureWindow` on the WSLg fallback path.** `captureWindow` has two paths: an
> OS window grab (`desktopCapturer`, primary — composites ALL views incl. the overlays) and a
> **WSLg/Wayland fallback** that composites the chrome image with only the active guest's
> `capturePage()` at the `#webviews` offset — the fallback may not composite sibling overlay views
> (the find bar, the menu-overlay sheet). On the fallback, overlay/menu-presence pixel checks are
> **best-effort**; the OS-grab path is authoritative. **Absence-authoritativeness rule:** an
> overlay-absence check is authoritative only after a same-run grab has shown that overlay compositing
> on the active capture path.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Connect the admin MCP client; `getChromeTarget()`. Open a web tab in the Default jar on the ticking liveness fixture (`tests/behavior/fixtures/menu-overlay/`, served locally); via `enumerateTabs` record its `wcId`. Take a `captureWindow()`. | (setup) Record chrome `wcId`, guest `wcId`, and the baseline frame (guest full-height, ticking region located, no menu). |
| 2 | **Baseline (live):** take a second `captureWindow()` ~2 s after Step 1's and compare the ticking region. | The guest page content is composited in the `#webviews` region and the ticking region **differs between the two grabs** — the guest is live at baseline (establishes the liveness observable for Step 3). |
| 3 | **Menu over live guest:** locate the kebab (⋮) via `captureWindow()`; `click(chromeWcId, x, y)` to open it. Take two `captureWindow()` grabs ~2 s apart, plus `readAxTree(chromeWcId)`. | The kebab menu is composited **above** the guest content, flush at the top edge of the guest region (the sheet covers the guest region only — F8 DD12); the guest stays **visible, live, and full-height** around it — the ticking region **differs between the two grabs** (a frozen still would be identical), and no push-down or blanking appears. `readAxTree` shows the kebab `aria-expanded="true"`. [render-correct] |
| 4 | **Dismiss restores nothing because nothing was hidden:** dismiss the menu (Escape — deliver to the sheet's webContents if probed, or `pressKey(chromeWcId, 'Escape')` after a chrome focus anchor). Take a `captureWindow()`. | The menu is gone from the pixels; the guest is still live at full bounds (it never left); kebab `aria-expanded="false"`. A sub-frame WSLg blip during the close is recorded, not failed. |
| 5 | **Panel-resizes-guest (open):** locate and open the media side panel via `captureWindow()` + `click(wcId, x, y)`. Take a `captureWindow()`. | The guest view **reflows to the region beside the panel** — the panel and the guest tile the content area with **no overlap, no gap/dead band, and no clipping** of the guest; the guest content visibly re-lays-out to the narrower width. [render-correct] |
| 6 | **Panel-resizes-guest (close):** close the panel via `captureWindow()` + `click(wcId, x, y)`. Take a `captureWindow()`. | The guest view restores to the **full** `#webviews` region; no residual inset, no dead band where the panel was. |
| 7 | **Find-overlay float (open):** record the active guest's bounds (bounds probe / `enumerateTabs`-adjacent geometry read) and the `#webviews` rect, then open find (`pressKey` Ctrl+F on the guest, or drive the chrome's `openFind()`). Take a `captureWindow()` and re-probe the guest bounds. | **Primary tell:** the find bar is composited **over** a FULL-bounds guest — the guest-bounds probe equals the full `#webviews` rect, **identical to the pre-open probe** (the bar floats; the guest is never inset). The `[ input ] n/m [↑][↓][✕]` bar is visible in the screenshot above the guest, which is not broken/clipped behind it. **AX re-scope:** the find input is NOT in the chrome AX tree (`readAxTree(chromeWcId)`) — the overlay is a separate webContents; do not assert it there (the overlay's own a11y is HAT-covered per DD12). [render-correct] |
| 8 | **Find-overlay float (close):** close find (Esc in the overlay input, or the ✕). Take a `captureWindow()` and re-probe the guest bounds. | The find bar is gone; the guest bounds are **UNCHANGED** from steps 1/7 (they never shrank — nothing to restore; the float never inset the guest). |

**Row conventions:** Row 1 is setup (no judgment). Rows 2–8 each assert one rendered-state checkpoint.
`[render-correct]` flags the SC2 rendered-vs-DOM checks; `[a11y]` flags accessibility-relevant checks.

## Out of Scope

- **Menus on internal `goldfinch://` tabs** (render-above + internal-view resize while *on* Settings /
  Downloads) — `internal-tab-menus.md`.
- **The sheet's own contract** (liveness under every surface, click-swallow dismissal, find-bar
  interplay, keyboard) — `menu-overlay.md`.
- **The find *engine result*** (match counts, stepping, jar-scoping) — `find-in-page.md` (this spec
  asserts only the bar's float/rendering and the guest's unchanged bounds, not its results).
- **Find-overlay geometry tracking** (position-sync across resize/panel/tab-switch, internal-tab
  removal, menu hide/restore) — `find-overlay-geometry.md`.
- **Menu items, keyboard operation, dismissal semantics** — `kebab-menu.md`, `page-context-menu.md`,
  `menu-dismissal.md`.
- **macOS rendering** — WSLg is the in-loop venue this mission; macOS is the Flight-6 landing gate.

## Variants (optional)

- Repeat Steps 3–4 with the **page context menu** (right-click the guest at a point away from the
  ticking region — `click(guestWcId, x, y, { button: 'right' })` fires the real guest `context-menu`
  path) instead of the kebab — exercises the main-originated (guest → main → chrome → sheet)
  invocation vs. the chrome-trigger path.
