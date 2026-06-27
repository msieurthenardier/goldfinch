# Behavior Test: Tab-surface geometry — freeze/restore, panel-resizes-guest, find-bar inset

**Slug**: `tab-surface-geometry`
**Status**: draft
**Created**: 2026-06-26
**Last Run**: never

> **Carried WSLg known issue.** A tiny residual menu-open blip on the freeze paint is an
> operator-accepted WSLg compositing artifact (Flight 3) — it is NOT a freeze/restore correctness
> failure. The checkpoints below assert the still-paint, the menu-renders-above, and the live-view
> restore at correct bounds; a sub-frame blip on a passing restore is recorded, not failed.

## Intent

Verify, on the `WebContentsView` guest surface, the **geometry and compositing** behaviors that the
Flight-3 migration introduced and that no unit test can reach: (1) the **freeze-frame** cycle — opening
a chrome menu paints a still of the guest into the chrome `#webviews` layer and hides the live guest
view so HTML chrome renders **above** it, and dismissing restores the live view at correct bounds;
(2) **panel-resizes-guest** — opening/closing the media (or privacy) side panel reflows the guest view
to the remaining region with no clip, overlap, or dead band; (3) **find-bar inset** — the find overlay
renders above the guest without breaking its layout. These are *rendered-surface* properties (the
mission's "DOM-correct ≠ render-correct" class), so the test asserts `captureWindow` pixels corroborated
by the chrome's own `#webviews` style — never DOM geometry alone.

## Preconditions

- **Apparatus — admin MCP surface.** Goldfinch running via `npm run dev:automation` with
  `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1` and a pinned `GOLDFINCH_MCP_PORT`
  (pick a free loopback port; prior sessions used 49707/49710). Capture the `adminKey` from the
  `AUTOMATION_DEV_MINT` stdout line. The admin key is required — a jar key is refused `getChromeTarget`
  (`admin-only`) and cannot drive the chrome renderer.
- **This test drives the chrome renderer** (toolbar, menus, panel, find bar live in the chrome) and
  observes the **composited window**. `getChromeTarget()` returns the chrome `wcId`.
- **Coordinate-click rule:** all clicks are coordinate-based — `click(wcId, x, y)` located via a
  `captureWindow()` screenshot. No CSS selectors over the MCP surface.
- **Apparatus disqualification:** the `chrome-devtools` MCP does NOT qualify (it launches its own
  browser and never touches this app). The apparatus is the goldfinch admin MCP surface.

## Observables Required

- **mcp — the AUTHORITATIVE freeze tell** (`readDom(chromeWcId)` of the `#webviews` element's
  `backgroundImage` inline style: a `data:` URL while frozen — set by `freezeGuest`/`renderer.js:1076` —
  and `''`/`none` while live — cleared by `unfreezeGuest`/`renderer.js:1091`). Also `getChromeTarget` →
  chrome `wcId`; `readAxTree(chromeWcId)` for menu/panel open state (`aria-expanded`); `enumerateTabs`
  for the active web tab `wcId`.
- **browser / rendered window — CORROBORATING for freeze, AUTHORITATIVE for geometry** (`captureWindow()`).
  Use it as the primary observable for **panel-resizes-guest** and **find-bar inset** (a real guest-bounds
  change the window grab shows directly). For the **freeze / menu-above** checks treat it as
  *corroborating only*: see the apparatus caveat below.

> **Apparatus caveat — `captureWindow` on the WSLg fallback path.** `captureWindow` has two paths: an OS
> window grab (`desktopCapturer`, primary) and a **WSLg/Wayland fallback** that composites the
> chrome image with `getActiveTabContents().capturePage()` drawn at the `#webviews` offset
> (`main.js:213-275`). During freeze the live guest is `setVisible(false)`, and the fallback draws that
> (possibly stale) guest frame **over** the chrome — i.e. it can paint the guest *on top of* an open
> menu, defeating a naive "menu pixels are visible" assertion. So on WSLg the menu-above pixel check is
> **best-effort**; the freeze state is judged authoritatively by the `#webviews` `backgroundImage` tell.
> Also: because the freeze paints a still of the *same* page, a static page is pixel-identical frozen vs
> live — restore is judged by `backgroundImage === ''`, optionally pixel-confirmed by scrolling the live
> guest after restore (a frozen still won't scroll).

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Connect the admin MCP client; `getChromeTarget()`. Open a web tab in the Default jar to a content-rich page (e.g. `https://example.com`); via `enumerateTabs` record its `wcId`. Take a `captureWindow()` and `readDom(chromeWcId)` of the `#webviews` element. | (setup) Record chrome `wcId`, guest `wcId`, and the baseline `#webviews` style. |
| 2 | **Baseline (live, not frozen):** inspect the Step-1 `captureWindow()` and the `#webviews` `backgroundImage`. | The guest page content is composited in the `#webviews` region; `#webviews` has **no** `backgroundImage` (empty / `none`) — the live view is showing, nothing is frozen. |
| 3 | **Freeze on menu open:** locate the kebab (⋮) via `captureWindow()`; `click(wcId, x, y)` to open it. Take `readDom(chromeWcId)` (authoritative) and a `captureWindow()` (corroborating). | **Authoritative:** `#webviews` `backgroundImage` is now a `data:` URL — `freezeGuest` painted the guest still into the chrome layer and hid the live view. **Corroborating (best-effort on WSLg):** the kebab menu appears **above** the page content in the screenshot, not occluded. `readAxTree` shows the kebab `aria-expanded="true"`. [render-correct] |
| 4 | **Restore on dismiss:** `pressKey(wcId, 'Escape')`. Take `readDom(chromeWcId)` (authoritative) and a `captureWindow()`. Optionally `scroll` the guest to pixel-confirm the live view is back. | **Authoritative:** `#webviews` `backgroundImage` is cleared (`''`/`none`) — `unfreezeGuest` ran and restored the live view at full bounds. The menu is gone (`aria-expanded="false"`). Optional pixel confirm: the guest scrolls (a frozen still would not). A sub-frame WSLg blip during the swap is recorded, not failed. |
| 5 | **Panel-resizes-guest (open):** locate and open the media side panel via `captureWindow()` + `click(wcId, x, y)`. Take a `captureWindow()`. | The guest view **reflows to the region beside the panel** — the panel and the guest tile the content area with **no overlap, no gap/dead band, and no clipping** of the guest; the guest content visibly re-lays-out to the narrower width. [render-correct] |
| 6 | **Panel-resizes-guest (close):** close the panel via `captureWindow()` + `click(wcId, x, y)`. Take a `captureWindow()`. | The guest view restores to the **full** `#webviews` region; no residual inset, no dead band where the panel was. |
| 7 | **Find-bar inset (open):** establish a focus anchor with `click(wcId, x, y)` into the chrome, then open find with `pressKey(wcId, 'Control+f')` (or the find affordance). Take a `captureWindow()` and `readAxTree(chromeWcId)`. | The find-bar overlay renders **above** the guest (the `[ input ] n/m [↑][↓][✕]` bar is visible in the screenshot); the guest remains rendered and is not broken/clipped behind the bar; the find input is present and focusable per `readAxTree`. [a11y] |
| 8 | **Find-bar inset (close):** `pressKey(wcId, 'Escape')`. Take a `captureWindow()`. | The find bar is gone; the guest is restored to its full bounds with no residual inset. |

**Row conventions:** Row 1 is setup (no judgment). Rows 2–8 each assert one rendered-state checkpoint.
`[render-correct]` flags the SC2 rendered-vs-DOM checks; `[a11y]` flags accessibility-relevant checks.

## Out of Scope

- **Menus on internal `goldfinch://` tabs** (kebab/container freeze-above + restore while *on* Settings
  / Downloads, and internal-view resize) — `internal-tab-menus.md`.
- **The find *engine result*** (match counts, stepping, jar-scoping) — `find-in-page.md` (this spec
  asserts only the bar's inset/rendering, not its results).
- **Menu items, keyboard operation, dismissal semantics** — `kebab-menu.md`, `page-context-menu.md`,
  `menu-dismissal.md`.
- **macOS rendering** — WSLg is the in-loop venue this mission; macOS is the Flight-6 landing gate.

## Variants (optional)

- Repeat Steps 3–4 with the **page context menu** (right-click the guest, located via `captureWindow()`)
  instead of the kebab — exercises the main-originated freeze path (the `page-context-menu` IPC) vs. the
  renderer-originated kebab freeze.
