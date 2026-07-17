# Behavior Test: Find-overlay geometry — float-not-inset, position-sync, internal-hidden, menu-hide

**Slug**: `find-overlay-geometry`
**Status**: active
**Created**: 2026-07-01
**Last Run**: 2026-07-15-17-05-00 (**PASS 8/8** — M09 F7 leg-1 invariant proof, spec UNMODIFIED;
the find overlay's extraction out of main.js into a per-window `find-overlay-manager.js` factory
left geometry landing on `computeFindOverlayBounds`'s prediction **to the pixel across three guest
widths** (1398→1007, 1038→647, 2558→2167), with exact round-trip identity — see
[run log](find-overlay-geometry/runs/2026-07-15-17-05-00.md))

> **Updated 2026-07-15 (M09 F7 leg 4).** The three queued errata are folded and this spec's overlay
> discovery is re-pointed; the annotations that queued them are retired:
> - **The "may not composite the overlay view" caveat is DELETED** — it predated M09 F7 DD5 and was
>   **false for this build**: the WSLg composite fallback DOES layer the captured window's own
>   overlays bottom-up (guest → find overlay → sheet), verified twice against `src/main/main.js`'s
>   composite. The harm was the **instruction**, not the staleness: it told a future Executor to defer
>   a fully-assertable step to the HAT. The caveat and the "defer to the HAT if the fallback is
>   active" clause it fed (step 6) are both gone. Overlay presence/absence is assertable on pixels.
> - **Step 8 is promoted from "(Optional)" to a deliberate assertion** — hide find, resize the window,
>   reopen, assert the bar lands at the **new** guest's top-right. It exercises `show()`'s live
>   `getActiveGuestBounds()` fetch, where the per-instance `lastGuestBounds` fallback would strand it —
>   directly on leg 1's state-ownership change, and previously reachable only by luck via the WSLg lag.
> - **"Default jar" → "the default jar"** — this build's fresh-profile default is named `personal`;
>   no jar named "Default" exists.
> - **Find-overlay discovery is now `enumerateWindows().findWcId`** (M09 F7 DD2), an exact resolve.

Prior: 2026-07-15-02-09-30 (PASS — regression re-run post-M09-F6 registry conversion, see
`find-overlay-geometry/runs/2026-07-15-02-09-30.md`; NEW apparatus caveat recorded there: WSLg
Wayland maximize lag-by-one — judge geometry on resizes that land; step-8 "fresh/reset" wording
errata: observed = query re-seeded with full select-all, the designed chrome-held findText behavior)

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

> **Apparatus technique — resolving the overlay's wcId via `enumerateWindows` (M09 F7 DD2).** Steps
> that type into or send keys to the find bar cannot target it via `enumerateTabs` (see Note above):
> the find overlay is a **per-window `WebContentsView`**, not a tab. Resolve it **exactly** —
> `enumerateWindows()` returns one row per window carrying **`findWcId`** and `findVisible`; take the
> row for the window under test and read `findWcId`. The op is **admin-only**, which this spec already
> requires. **`findWcId` is absent until the find overlay is first created** (it is lazy) — resolve it
> after step 2's first open; an earlier read returns `undefined`, not an error. Read **`findVisible`**
> (not id presence) to judge shown-vs-hidden: a present id means "instantiated", not "showing" — which
> is exactly what steps 5–7's absence checks turn on. Once resolved, `typeText`/`pressKey` against that
> wcId drive the bar for real. Without this the Executor would type into the guest and every
> input-dependent step would false-fail.
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

> **Apparatus note — `captureWindow`'s two paths, and why overlay pixels are assertable on both.**
> `captureWindow` has an OS window grab (`desktopCapturer`) and a **WSLg/Wayland fallback** that
> composites the chrome image with the active guest at the `#webviews` offset. **Both composite this
> window's own overlays** — the fallback layers them bottom-up (guest → find overlay → sheet), verified
> against main.js's composite. So overlay presence/absence **is** a first-class pixel assertion on this
> rig; it is not best-effort and it is **not** HAT-deferred. *(An earlier caveat here claimed the
> fallback "may not composite the overlay view" and instructed deferral to the HAT — it was false, and
> its instruction would have parked a fully-assertable step. Deleted at the M09 F7 leg-4 pass.)* The
> float-not-inset check reads the *guest*'s composited position and is robust regardless.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Apparatus-wiring litmus: `getChromeTarget()`; `enumerateTabs()`. Open a content-rich web tab in the default jar (e.g. a Wikipedia article) with recognizable content at the very top; record chrome + guest `wcId`. Take a baseline `captureWindow()` (find closed). | (setup) Litmus passes (admin + this instance). Record the baseline y-position of the top page content and the guest's full-height composite. |
| 2 | **Float-not-inset:** open find (`pressKey Control+f`), type a term. Take `captureWindow()`. Compare the guest content's top y-position to the Step-1 baseline. | The find bar renders as a floating strip at the top of the guest region; the **guest content is NOT pushed down** — its top sits at the same y as the baseline within the **pixel-tolerance band: ≤5 px delta = compositing noise (pass); >10 px = push-down (fail)**; between, record and judge from the landmarks (2026-07-02 run errata). The content now sits under the floating bar (contrast the old inset bar, which shifted content down). [render-correct] |
| 3 | **Position-sync (panel):** locate the media-panel toggle from a `captureWindow()` screenshot, then `click(chromeWcId, x, y)` to open it. Take a `captureWindow()`. Close the panel (same locate-then-click); `captureWindow()` again. | With the panel open, the overlay bar **reflows** to the top strip of the now-narrower guest region (right edge tracks the guest, not the window); on close it restores to the full-width top strip. No drift, no stale position. [render-correct] |
| 4 | **Position-sync (resize/maximize):** toggle maximize (window control), then restore. `captureWindow()` after each. | The overlay tracks the guest's top strip at the new window size after maximize and after restore — correctly positioned, not stranded at the old bounds. [render-correct] |
| 5 | **Internal-tab hidden (DD7):** with find open on the web tab, open kebab → **Settings** (`goldfinch://settings`). Take `captureWindow()`. | On the internal tab the overlay find bar is **absent** — no floating bar over the Settings page (the overlay is hidden, not merely empty, on internal tabs). [render-correct] |
| 6 | **Menu-hide/restore (DD5):** switch back to the web tab (find still open); open the **kebab (⋮)** menu (rendered from the menu-overlay sheet over the live guest). Bracket each grab with the kebab's `aria-expanded` (menu DOM-bracketing — see apparatus notes). `captureWindow()`. Dismiss (`Escape`). `captureWindow()`. | While the menu is open the find overlay is **hidden** (the DD5 hide rides the sheet-show); on dismiss it is **restored** over the live guest at correct bounds, query intact (the restore is `closeMenuOverlay`'s explicit DD5 hook). Both judgments are made on pixels — the composite layers this window's overlays on either capture path (see the apparatus note); corroborate hidden/restored with the same row's `enumerateWindows().findVisible`. [render-correct] |
| 7 | **Close:** `pressKey Escape` (find). `captureWindow()`. | The overlay is gone; the guest occupies the full region with no residual strip/inset. |
| 8 | **Reopen-after-resize — the live-bounds fetch (M09 F7 leg-1 state ownership):** with find **closed** (step 7), **resize the window** to a materially different size (toggle maximize/restore via `#win-max`, DOM-anchored — confirm the resize LANDED before proceeding: the WSLg maximize lag-by-one means an unlanded resize invalidates this step, not the code). Then reopen find (`pressKey Control+f`). `captureWindow()`; read the overlay's input state via `readDom(findWcId)`. Close again. | The bar reappears **at the NEW guest's top-right** — tracking the post-resize bounds, NOT the pre-resize ones. This is the deliberate assertion: `show()` fetches `getActiveGuestBounds()` **live**, so a stale per-instance `lastGuestBounds` fallback would strand the bar at the old geometry and be visible as a mis-placed strip. *(Promoted from "(Optional)" at the M09 F7 leg-4 pass: the 2026-07-15 run exercised this only by luck via the WSLg lag. It sits directly on leg 1's state-ownership change — `lastGuestBounds` went from a shared module slot to per-instance state.)* The **query is re-seeded and fully selected** — the chrome-held per-tab `findText` is pushed back into the input with a select-all, ready to type over (the lazy overlay's DOM persists across close by design). *(Wording erratum fixed 2026-07-15: the earlier "fresh/reset" phrasing misdescribed the DESIGNED chrome-held-findText behavior — same contract, corrected description.)* |

**Row conventions:** Row 1 is setup + the apparatus litmus. Rows 2–8 each assert one rendered-state
checkpoint. `[render-correct]` flags the SC2 rendered-vs-DOM checks.

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
