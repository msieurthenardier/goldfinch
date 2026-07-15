# Behavior Test: Internal-tab menus — kebab/container/site-info render above live goldfinch:// tabs + resize

**Slug**: `internal-tab-menus`
**Status**: active
**Created**: 2026-06-26
**Last Run**: never

> **Why this spec exists.** Flight 3 (DD0) pulled internal `goldfinch://` tabs onto the
> `WebContentsView` substrate, making them **opaque views** like web tabs. The chrome's menus were
> **occluded** by the opaque internal view and the internal view **didn't resize** — the per-leg review
> couldn't see it (cross-cutting); the HAT caught it. This spec is the permanent regression net for
> that class: menus must render **above** the internal view, and the internal view must track geometry
> **while the active tab is internal**.
>
> **Re-authored 2026-07-02 (F8 Leg 5b).** The freeze-frame mechanism this spec originally asserted
> (`freezeGuest` still + `#webviews backgroundImage` tell) was retired at the Flight-8 cutover. Menus
> now render from the **menu-overlay sheet** — a transparent full-guest `WebContentsView` stacked
> above whichever view is active (web or internal; F8 DD7). The render-above property is now a
> **live-view compositing fact**: the menu appears in the sheet over the LIVE internal page — no
> still, no hide, no `backgroundImage` observable.

> **Carried WSLg known issue.** A tiny sub-frame blip when switching to / composing over internal tabs
> is an operator-accepted WSLg compositing artifact (Flight 3 family). A sub-frame blip on an
> otherwise-correct menu render is recorded, not failed.

## Intent

Verify that, **while the active tab is an internal `goldfinch://` page** (Settings or Downloads), the
kebab (⋮), container (▾), and site-info (🔒) menus render **above** the page (not occluded by the
opaque internal view) via the menu-overlay sheet, dismiss cleanly, and the internal view **resizes**
with the side panel — the behavior class the Flight-3 substrate change regressed. These are
*rendered-surface* properties unreachable by unit tests (the occlusion was an opaque-native-view
compositing fact, not a DOM fact), so the test asserts `captureWindow` pixels corroborated by the
sheet's DOM (menu present) and the chrome's trigger state (`aria-expanded`).

## Preconditions

- **Apparatus — admin MCP surface.** Goldfinch running via `npm run dev:automation` with
  `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1` and a pinned `GOLDFINCH_MCP_PORT` (free
  loopback port). Capture the `adminKey` from the `AUTOMATION_DEV_MINT` stdout line — required (a jar key
  cannot drive the chrome, and the sheet's wcId resolves only at the admin tier).
- **Sheet wcId discovery — `enumerateWindows` (M09 F7 DD2).** The sheet is NOT in `tabViews` and never
  appears in `enumerateTabs`: it is a per-window `WebContentsView`. Resolve it **exactly** —
  `enumerateWindows()` returns one row per window carrying `sheetWcId` and `sheetVisible`; take the row
  for the window under test. The op is **admin-only**, which this spec already requires (above).
  **`sheetWcId` is absent until the sheet is first created** (lazy), so resolve after the first menu
  open — an early read returns `undefined`, not an error.
- **Opening internal tabs:** internal `goldfinch://` tabs are **not enumerable/drivable through the jar
  MCP surface** (the internal-session exclusion), and **`evaluate` refuses internal wcIds by design even
  for admin** — so internal-tab checks re-base on **chrome tab state + pixels**: confirm the internal
  page is active via the chrome's address-chip `data-state="internal"` (`readDom(chromeWcId)`) and the
  rendered content in `captureWindow()`. Reach Settings/Downloads the way a user does: kebab →
  Settings / Downloads (activation nuance below).
- **Sheet menuitem activation nuance (F8 Leg-3 lesson):** MCP `pressKey(sheetWcId, 'Enter')` on a
  focused sheet menuitem does NOT synthesize the DOM `click` a real Enter does — activate items via
  `click(sheetWcId, x, y)` on the item's coordinates (located from `captureWindow()`), or arrow-focus
  then `evaluate(sheetWcId, 'document.activeElement.click()')`. Real-keyboard Enter activation is
  HAT-covered.
- **Do NOT activate Print… or Exit** while walking the kebab (Print opens a blocking modal print
  dialog that is not MCP-dismissable on this rig; Exit quits the app and ends the run).
- **Coordinate-click rule:** all clicks are coordinate-based, located via `captureWindow()`. No CSS
  selectors over the MCP surface.
- **Apparatus disqualification:** the `chrome-devtools` MCP does NOT qualify. The apparatus is the
  goldfinch admin MCP surface.

## Observables Required

- **browser / rendered window — AUTHORITATIVE for render-above** (`captureWindow()`, OS-grab path):
  the menu visibly composited above the internal page. Also authoritative for the
  **internal-view-resizes-with-panel** check (a real bounds change the grab shows directly).
- **mcp — corroborating**: `readDom(sheetWcId)` for the rendered menu (`#sheet-menu` with the
  expected `data-menu-type`, `role="menu"`); `readDom(chromeWcId)` / `readAxTree(chromeWcId)` for the
  trigger's `aria-expanded` and the address-chip `data-state="internal"`; `getChromeTarget` → chrome
  `wcId`. **Sheet DOM can never serve as a "menu is closed" observable** (lazy singleton — hidden ≠
  destroyed); pixels + the chrome trigger's `aria-expanded="false"` are the closed-state authority.

> **Apparatus caveat — `captureWindow` on the WSLg fallback path.** The WSLg/Wayland fallback
> composites the chrome image with only the active guest's `capturePage()` at the `#webviews` offset —
> it may not composite sibling overlay views (the sheet). On the fallback, menu-presence pixel checks
> are **best-effort**; the OS-grab path is authoritative. **Absence-authoritativeness rule:** a
> menu-absence check is authoritative only after a same-run grab has shown the sheet's menu
> compositing on the active capture path. Confirm which path is active before failing a presence
> check; defer to the HAT if the fallback is in force.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Connect the admin MCP client; `getChromeTarget()`. Resolve the sheet's wcId from `enumerateWindows()` — this window's row carries `sheetWcId` once the sheet exists (see Preconditions; it is absent until the first menu open below). Locate the kebab (⋮) via `captureWindow()`; open it (`click(chromeWcId, x, y)`) and activate the **Settings** item on the sheet (click its coordinates on `sheetWcId`, or arrow-focus + `evaluate` `activeElement.click()`). Take a `captureWindow()` and `readDom(chromeWcId)`. | (setup) The Settings internal page is the active tab — its content renders in the `#webviews` region (pixels) and the chrome address chip shows `data-state="internal"` (internal tabs don't appear in `enumerateTabs`, and `evaluate` refuses internal wcIds — chrome state + pixels are the observables). Record chrome + sheet `wcId`s. |
| 2 | **Kebab renders above the live internal view:** with Settings active, locate and open the kebab via `captureWindow()` + `click(chromeWcId, x, y)`. Take a `captureWindow()` (authoritative on the OS-grab path), `readDom(sheetWcId)`, and `readDom(chromeWcId)`. | **Authoritative (pixels):** the kebab menu is visibly composited **above** the Settings page (the exact F3 occlusion regression, now protected on the sheet path); the internal view is LIVE underneath — no still, no blanking. **Corroborating:** `readDom(sheetWcId)` shows `#sheet-menu` `data-menu-type="kebab"` rendered; the chrome kebab trigger has `aria-expanded="true"`. [render-correct] |
| 3 | **Dismiss restores cleanly:** `pressKey(sheetWcId, 'Escape')`. Take a `captureWindow()` and `readDom(chromeWcId)`. | The menu is gone from the pixels; the live Settings view renders at full bounds; kebab `aria-expanded="false"` and the kebab trigger holds focus (Escape refocus). A sub-frame WSLg blip is recorded, not failed. |
| 4 | **Container menu renders above the internal view:** with Settings still active, locate and open the container (▾) menu via a fresh `captureWindow()` + `click(chromeWcId, x, y)`. Take a `captureWindow()`, `readDom(sheetWcId)`, and `readDom(chromeWcId)`. | **Authoritative (pixels):** the container menu is composited above the live Settings page. **Corroborating:** `#sheet-menu` `data-menu-type="container"` rendered on the sheet; `#new-tab-menu` `aria-expanded="true"` on the chrome. [render-correct] |
| 5 | **Dismiss:** `pressKey(sheetWcId, 'Escape')`. Take a `captureWindow()` and `readDom(chromeWcId)`. | Menu gone (pixels); live Settings at full bounds; `#new-tab-menu` `aria-expanded="false"`. |
| 6 | **Site-info over the internal view (DD7):** locate and click the address chip (🔒) via `captureWindow()` + `click(chromeWcId, x, y)`. Take a `captureWindow()` and `readDom(sheetWcId)`. Dismiss (`pressKey(sheetWcId, 'Escape')`). | The site-info popup renders from the sheet above the live internal view, showing the **secure-page note** (internal pages get the note variant, no action row); Escape dismisses and refocuses the chip. [render-correct] |
| 7 | **Internal view resizes with the panel:** with Settings active, open the media panel via `pressKey(chromeWcId, 'Control+M')` (the toolbar media/shields buttons are disabled on internal tabs; the shortcut still reaches the panel). Take a `captureWindow()`. Then close the panel (`Control+M` again) and `captureWindow()` again. | While the panel is open, the **internal Settings view reflows** to the region beside the panel — no overlap, no dead band, no clipping (the F3 `sendActiveBounds` regression class); on close it restores to the full region. [render-correct] |

**Row conventions:** Row 1 is setup. Rows 2–7 each assert one rendered-state checkpoint.
`[render-correct]` flags the SC2 rendered-vs-DOM checks.

## Out of Scope

- **Menu items / keyboard operation / dismissal semantics** — `kebab-menu.md`, `page-context-menu.md`,
  `menu-dismissal.md` (those assert structure + APG behavior; this spec asserts the *render-above +
  resize* compositing on the internal substrate).
- **Web-tab menu-over-live-guest / panel / find geometry** — `tab-surface-geometry.md`,
  `menu-overlay.md`.
- **The page context menu on internal tabs** — it is a deliberate **no-op** there (main-side internal
  guard) — `page-context-menu.md`.
- **The internal trust boundary / session exclusion** — `internal-session-exclusion.md` (Flight 6).
- **macOS rendering** — WSLg is the in-loop venue; macOS is the Flight-6 landing gate.

## Variants (optional)

- **Downloads tab:** repeat Steps 1–7 opening **kebab → Downloads** (`goldfinch://downloads`) instead of
  Settings — the second internal page type, to confirm the behavior is substrate-general, not
  Settings-specific.
