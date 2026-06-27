# Behavior Test: Internal-tab menus — kebab/container render-above + freeze/restore + resize on goldfinch:// tabs

**Slug**: `internal-tab-menus`
**Status**: draft
**Created**: 2026-06-26
**Last Run**: never

> **Why this spec exists.** Flight 3 (DD0) pulled internal `goldfinch://` tabs onto the
> `WebContentsView` substrate, making them **opaque views** like web tabs. Three web-only guards
> (`!t.trusted` in `freezeGuest`/`sendActiveBounds`; `isInternalContents→null` in `capture-active-guest`)
> silently became wrong — kebab/container menus were **occluded** by the opaque internal view, and the
> internal view **didn't resize**. The per-leg review couldn't see it (cross-cutting); the HAT caught it.
> This spec is the permanent regression net for that class, asserting menus render **above** the frozen
> still and the internal view tracks geometry **while the active tab is internal**.

> **Carried WSLg known issue.** A tiny residual menu-open blip on internal tabs is an operator-accepted
> WSLg compositing artifact (Flight 3). A sub-frame blip on an otherwise-correct freeze/restore is
> recorded, not failed.

## Intent

Verify that, **while the active tab is an internal `goldfinch://` page** (Settings or Downloads), the
chrome's kebab (⋮) and container (▾) menus render **above** the page (not occluded by the opaque internal
view), the freeze-frame still paints and restores correctly, and the internal view **resizes** with the
side panel — the exact behaviors the Flight-3 substrate change regressed. These are *rendered-surface*
properties unreachable by unit tests (the occlusion was an opaque-native-view compositing fact, not a DOM
fact), so the test asserts `captureWindow` pixels corroborated by the chrome's `#webviews` style.

## Preconditions

- **Apparatus — admin MCP surface.** Goldfinch running via `npm run dev:automation` with
  `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1` and a pinned `GOLDFINCH_MCP_PORT` (free
  loopback port). Capture the `adminKey` from the `AUTOMATION_DEV_MINT` stdout line — required (a jar key
  cannot drive the chrome).
- **Opening internal tabs:** internal `goldfinch://` tabs are **not enumerable/openable through the jar
  MCP surface** (the internal-session exclusion). The test reaches them the way a user does — by driving
  the chrome with the admin key: open the **kebab → Settings** and **kebab → Downloads** items via
  trusted `click(wcId, x, y)` located from a `captureWindow()` screenshot. Confirm the internal page is
  active by its rendered content in `captureWindow()` (internal pages won't appear in `enumerateTabs`).
- **Coordinate-click rule:** all clicks are coordinate-based, located via `captureWindow()`. No CSS
  selectors over the MCP surface.
- **Apparatus disqualification:** the `chrome-devtools` MCP does NOT qualify. The apparatus is the
  goldfinch admin MCP surface.

## Observables Required

- **mcp — the AUTHORITATIVE freeze tell** (`readDom(chromeWcId)` of the `#webviews` `backgroundImage`
  inline style: a `data:` URL while frozen, `''`/`none` while live — set/cleared by `freezeGuest`/
  `unfreezeGuest`, `renderer.js:1076,1091`). Also `getChromeTarget` → chrome `wcId`;
  `readAxTree(chromeWcId)`/`readDom` for the kebab `aria-expanded` and the `#new-tab-menu` open state.
- **browser / rendered window — CORROBORATING for freeze/menu-above, AUTHORITATIVE for resize**
  (`captureWindow()`). Authoritative for the **internal-view-resizes-with-panel** check (a real bounds
  change the grab shows directly); *corroborating only* for menu-above/freeze on the WSLg fallback.

> **Apparatus caveat — `captureWindow` on the WSLg fallback path.** The WSLg/Wayland fallback composites
> the chrome image with `getActiveTabContents().capturePage()` drawn at the `#webviews` offset
> (`main.js:213-275`). During freeze the live (internal) guest is `setVisible(false)`, and the fallback
> draws that frame **over** the chrome — it can paint the internal page *on top of* an open menu,
> defeating a naive "menu pixels visible" assertion. So the menu-above pixel check is **best-effort** on
> WSLg; the freeze + menu-above is judged authoritatively by the `#webviews` `backgroundImage` tell
> (set ⇒ the live internal view was hidden and HTML chrome is compositing above the still). The whole
> point of this spec — that the opaque internal view no longer occludes the menu — is captured by that
> tell firing on an internal tab exactly as it does on a web tab.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Connect the admin MCP client; `getChromeTarget()`. Locate the kebab (⋮) via `captureWindow()`; open it and `click` the **Settings** item to open `goldfinch://settings`. Take a `captureWindow()`. | (setup) The Settings internal page is the active tab — its content is rendered in the `#webviews` region (confirmed by `captureWindow()`, since internal tabs don't appear in `enumerateTabs`). Record chrome `wcId`. |
| 2 | **Kebab renders above the internal view:** with Settings active, locate and open the kebab via `captureWindow()` + `click(wcId, x, y)`. Take `readDom(chromeWcId)` (authoritative) and a `captureWindow()` (corroborating). | **Authoritative:** `#webviews` `backgroundImage` is a `data:` URL — the internal page's still is painted and the live internal view hidden, so the HTML kebab composites **above** it (the exact F3 occlusion regression, now fixed); `readAxTree` shows kebab `aria-expanded="true"`. **Corroborating (best-effort on WSLg):** the kebab items appear above the Settings page in the screenshot. [render-correct] |
| 3 | **Freeze restores on dismiss:** `pressKey(wcId, 'Escape')`. Take `readDom(chromeWcId)` (authoritative). | `#webviews` `backgroundImage` is cleared (`''`/`none`) — the live Settings view is restored at full bounds; kebab `aria-expanded="false"`. A sub-frame WSLg blip is recorded, not failed. |
| 4 | **Container menu renders above the internal view:** with Settings still active, locate and open the container (▾) menu via `captureWindow()` + `click(wcId, x, y)` (`#new-tab-menu`). Take `readDom(chromeWcId)` (authoritative) and `readAxTree(chromeWcId)`. | **Authoritative:** `#webviews` `backgroundImage` is a `data:` URL (internal still painted, container menu composites above it); `#new-tab-menu` `aria-expanded="true"`. Corroborating screenshot best-effort on WSLg. [render-correct] |
| 5 | **Restore:** `pressKey(wcId, 'Escape')`. Take `readDom(chromeWcId)`. | `#webviews` `backgroundImage` cleared; live Settings restored at full bounds; `#new-tab-menu` `aria-expanded="false"`. |
| 6 | **Internal view resizes with the panel:** with Settings active, open the media (or privacy) side panel via `captureWindow()` + `click(wcId, x, y)`. Take a `captureWindow()`. Then close the panel and `captureWindow()` again. | While the panel is open, the **internal Settings view reflows** to the region beside the panel — no overlap, no dead band, no clipping (the F3 `sendActiveBounds` `!t.trusted` regression); on close it restores to the full region. [render-correct] |

**Row conventions:** Row 1 is setup. Rows 2–6 each assert one rendered-state checkpoint.
`[render-correct]` flags the SC2 rendered-vs-DOM checks.

## Out of Scope

- **Menu items / keyboard operation / dismissal semantics** — `kebab-menu.md`, `page-context-menu.md`,
  `menu-dismissal.md` (those assert structure + APG behavior; this spec asserts the *render-above +
  freeze + resize* compositing on the internal substrate).
- **Web-tab freeze/panel/find geometry** — `tab-surface-geometry.md`.
- **The internal trust boundary / session exclusion** — `internal-session-exclusion.md` (Flight 6).
- **macOS rendering** — WSLg is the in-loop venue; macOS is the Flight-6 landing gate.

## Variants (optional)

- **Downloads tab:** repeat Steps 1–6 opening **kebab → Downloads** (`goldfinch://downloads`) instead of
  Settings — the second internal page type, to confirm the behavior is substrate-general, not
  Settings-specific.
