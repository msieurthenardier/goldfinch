# Behavior Test: Find-overlay geometry — float-not-inset, position-sync, internal-hidden, menu-hide

**Slug**: `find-overlay-geometry`
**Status**: active
**Created**: 2026-07-01
**Last Run**: 2026-07-02-18-12-25 (PASS 6/6 — see `find-overlay-geometry/runs/2026-07-02-18-12-25.md`;
spec errata candidates recorded in that run log's Validator closing)

> **Updated 2026-07-02 (F8 Leg 5b).** The four F7 errata + the absence-authoritativeness rule + the
> optional reopen-check from the 2026-07-02 run log's Validator closing are folded in (F7 debrief
> Rec 4). Step 6's assertion (find bar hidden while a menu is open, restored on dismiss) is
> **unchanged** — only its freeze-frame wording updates: menus now render from the menu-overlay
> sheet (Flight 8), and the hide/restore rides main's `closeMenuOverlay` close family instead of the
> retired freeze path.

> **Why this spec exists.** Flight 7 replaces the inset (push-down) find bar with a floating overlay
> `WebContentsView` stacked above the guest. The load-bearing, pixel-only properties — the bar **floats**
> over full-height guest content (no push-down), tracks the guest's top strip across resize/panel/
> tab-switch, is **hidden** on internal tabs, and **hides while a chrome menu is open** (restoring on
> dismiss) — are rendered-surface facts no unit test can reach (the renderer/view layer is unit-untestable; the
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
stray overlay); (4) **hides while a menu is open** (the menu-overlay sheet — F8 DD5 parity) and
restores on dismiss. These are rendered-surface properties (the mission's SC2 "DOM-correct ≠
render-correct" class), asserted via `captureWindow` pixels.

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

> **Apparatus technique — driving the overlay's input (established Legs 2–3, F7).** Steps that type
> into or send keys to the find bar cannot target it via `enumerateTabs` (see Note above). The working
> technique: **probe for the overlay's wcId directly** — the drive-op resolver is `fromId`-based, so
> ops accept any live wcId; probe the small id-space **around** the known chrome/guest ids — the
> overlay's id can sit BELOW the newest guest ids, not only above (2026-07-02 run errata)
> (`readDom(id)` succeeding with the find-bar markup identifies it; a failed probe on a non-existent
> id is a normal refused result, and `activateTab` on a non-tab wcId returns false harmlessly).
> **Skip every `enumerateTabs` wcId and the chrome wcId in the walk** — probing a background tab
> activates it (the eval/read ops are foreground-first), disturbing the state under test (F8 Leg-5
> lesson). Once identified, `typeText`/`pressKey` against that wcId drive the bar for real. Without
> this technique the Executor would type into the guest and every input-dependent step would
> false-fail.
>
> **DOM-anchored control location (2026-07-02 run errata).** Locate chrome controls by DOM geometry —
> `evaluate(chromeWcId, …getBoundingClientRect())` on the control (`#toggle-media`, `#win-max`) —
> rather than eyeballing pixels, and confirm state changes by DOM tells where available (e.g.
> `#win-max`'s title flips Maximize↔Restore). Coordinate clicks then use the anchored rects.
>
> **Menu DOM-bracketing technique (2026-07-02 run errata).** For the menu-interplay step, bracket
> each pixel grab with a chrome DOM read of the menu's open state (the trigger's `aria-expanded`) so
> every grab is attributable to a known menu state — the step-6 verdict depends on knowing the menu
> was genuinely open/closed when each frame was taken.
>
> **Absence-authoritativeness rule (F7 codification).** An overlay-absence pixel check is
> authoritative only after a same-run grab has shown the overlay compositing on the active capture
> path. Step 2 establishes the find bar's presence; absence checks (steps 5–7) inherit authority from
> it. Confirm which capture path is active before failing a presence check.

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
| 2 | **Float-not-inset:** open find (`pressKey Control+f`), type a term. Take `captureWindow()`. Compare the guest content's top y-position to the Step-1 baseline. | The find bar renders as a floating strip at the top of the guest region; the **guest content is NOT pushed down** — its top sits at the same y as the baseline within the **pixel-tolerance band: ≤5 px delta = compositing noise (pass); >10 px = push-down (fail)**; between, record and judge from the landmarks (2026-07-02 run errata). The content now sits under the floating bar (contrast the old inset bar, which shifted content down). [render-correct] |
| 3 | **Position-sync (panel):** locate the media-panel toggle from a `captureWindow()` screenshot, then `click(chromeWcId, x, y)` to open it. Take a `captureWindow()`. Close the panel (same locate-then-click); `captureWindow()` again. | With the panel open, the overlay bar **reflows** to the top strip of the now-narrower guest region (right edge tracks the guest, not the window); on close it restores to the full-width top strip. No drift, no stale position. [render-correct] |
| 4 | **Position-sync (resize/maximize):** toggle maximize (window control), then restore. `captureWindow()` after each. | The overlay tracks the guest's top strip at the new window size after maximize and after restore — correctly positioned, not stranded at the old bounds. [render-correct] |
| 5 | **Internal-tab hidden (DD7):** with find open on the web tab, open kebab → **Settings** (`goldfinch://settings`). Take `captureWindow()`. | On the internal tab the overlay find bar is **absent** — no floating bar over the Settings page (the overlay is hidden, not merely empty, on internal tabs). [render-correct] |
| 6 | **Menu-hide/restore (DD5):** switch back to the web tab (find still open); open the **kebab (⋮)** menu (rendered from the menu-overlay sheet over the live guest). Bracket each grab with the kebab's `aria-expanded` (menu DOM-bracketing — see apparatus notes). `captureWindow()`. Dismiss (`Escape`). `captureWindow()`. | While the menu is open the find overlay is **hidden** (the DD5 hide rides the sheet-show); on dismiss it is **restored** over the live guest at correct bounds, query intact (the restore is `closeMenuOverlay`'s explicit DD5 hook). (On the WSLg fallback, overlay-presence is best-effort — see caveat; defer to the HAT if the fallback is active.) [render-correct] |
| 7 | **Close:** `pressKey Escape` (find). `captureWindow()`. | The overlay is gone; the guest occupies the full region with no residual strip/inset. |
| 8 | **(Optional) Reopen-check — reset-on-next-open:** reopen find (`pressKey Control+f`). `captureWindow()`; read the overlay's input state via `readDom(overlayWcId)`. Close again. | The bar reappears at the correct top-strip position in a **fresh/reset** state (the lazy-singleton's DOM persists across close by design — this asserts the reset-on-next-open contract the F7 debrief flagged as unasserted). |

**Row conventions:** Row 1 is setup + the apparatus litmus. Rows 2–8 each assert one rendered-state
checkpoint (row 8 optional). `[render-correct]` flags the SC2 rendered-vs-DOM checks.

## Out of Scope

- **The find *engine result*** (match counts, stepping correctness, jar-scoping) — `find-in-page.md`
  (this spec asserts the bar's *geometry/compositing*, not its results).
- **Menus on internal tabs / the menu-overlay-sheet compositing itself** — `internal-tab-menus.md`,
  `tab-surface-geometry.md`, `menu-overlay.md` (this spec asserts only the *find overlay* geometry).
- **macOS rendering** — WSLg is the in-loop venue; macOS is the Flight-6 landing gate (which should add
  the find-overlay float + internal→new-tab as HAT steps).

## Variants (optional)

- Repeat Step 6 with the **container (▾)** and the **page context menu** (right-click) instead of the
  kebab — the overlay must hide for every menu surface (they all ride the same sheet +
  `closeMenuOverlay` machinery).
