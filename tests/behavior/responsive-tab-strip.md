# Behavior Test: Responsive tab sizing, deferred resize-on-close, and maximize state

**Slug**: `responsive-tab-strip`
**Status**: active
**Created**: 2026-06-06
**Last Run**: 2026-06-07-00-44-37

## Intent

Verify three rendered-layout behaviors of the restructured tab strip and frameless window that
only exist in the running app: (1) tabs **shrink/grow to fit** the available width — no
always-on horizontal scrollbar — with a usable floor (favicon + close stay visible) and scroll
returning only past that floor; (2) closing a tab **by pointer defers the reflow** — remaining
tabs keep their width and slide left under the cursor until the pointer leaves the strip, then
re-expand; and (3) the frameless window's **maximize/restore button reflects window state**
through an observable DOM read path. These need a behavior test because they are *layout geometry
and pointer-interaction timing in the live Electron chrome* (computed widths, sibling positions
before/after `mouseleave`, real window maximize state) — unit tests can't observe rendered widths
or drive a real maximize. (Flight-local behaviors + the DD7 maximize read path; SC8 a11y is
covered by `npm run a11y`.)

## Preconditions

- Goldfinch running via `npm run dev:debug` (`:9222` CDP). The apparatus must **attach to the
  running `:9222` renderer target, never launch a fresh browser**; qualifying clients are the
  **Playwright MCP** (`--cdp-endpoint http://127.0.0.1:9222`) or a **raw CDP-over-WebSocket**
  client. **The `chrome-devtools` MCP does NOT qualify.**
- **Drive the renderer (chrome UI), NOT a `<webview>` guest.** Select the top-level Goldfinch
  window target (URL = renderer `index.html`).
- Input delivered as **trusted events** (`Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`).
  The deferred-resize check depends on **real pointer position + `mouseleave`**, so pointer moves
  must be trusted CDP mouse events at real coordinates — not synthetic events.
- A local HTTP **fixture** serving pages at **distinct, non-normalizing** URLs for the setup tabs
  (so tabs are individually identifiable). **Probe that the fixture port is free** before running
  (`:8000`/`:8080`/`:8090` collisions collapsed per-tab URLs in prior runs). Local `about:blank`
  variants are an acceptable offline fallback for identity if no fixture server is available.
- **This test exercises window maximize/restore (Step 7).** On the dev platform (Linux/WSL) the
  custom maximize button is present and clickable. **Do NOT click Close or minimize** — Close
  tears down the harness and a minimized renderer is backgrounded (both are manual checks).
- **Active precondition probe** (Step 1): `:9222` answers and a renderer target is present.

## Observables Required

- browser (rendered layout + DOM — via a CDP client **attached to `:9222`**): per-tab
  `getBoundingClientRect()` (width + left position) for all `.tab` elements; whether `#tabs`
  shows a horizontal scrollbar (`scrollWidth > clientWidth`); visibility of each tab's favicon +
  `.tab-close` at the floor; the maximize/restore button's **accessible name / icon / state
  attribute**; screenshots as corroborating evidence for the visual layout.
- shell (precondition probe: `:9222` reachability — via Bash/curl).

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Probe `http://127.0.0.1:9222/json`; identify the **renderer** target. Record the window's inner width and the current tab count. | `:9222` responds; a renderer target is listed. If not, halt — preconditions not met. |
| 2 | Open a **small** number of tabs (e.g. 3–4) at distinct fixture URLs. Measure each tab's rendered width. | Tabs **expand to share** the available strip width (each is comfortably wide, well above the floor). `#tabs` shows **no** horizontal scrollbar (`scrollWidth ≈ clientWidth`). |
| 3 | Open **many** more tabs (enough to exceed the comfortable width — e.g. 12–20+). Re-measure tab widths. | Tabs **shrink** to share the width; each remaining tab's **favicon and close button stay visible** and the title ellipsizes. Tabs do **not** keep a fixed 120–220px width with an always-on scrollbar (the old behavior). [a11y] |
| 4 | Keep opening tabs until even the floor width cannot fit all tabs in the strip. | Only **now** does a horizontal scroll affordance appear (`scrollWidth > clientWidth`) — scroll is the last-resort fallback, not the default. |
| 5 | With many tabs open, position the pointer over a **middle** tab's close button (`.tab-close`) and record (a) that tab's index/position and (b) the left positions + widths of the tabs to its right. Click to close it **by pointer**, keeping the pointer still. | The tab is removed (count −1). Remaining tabs **keep their previous widths** (no resize); the tab that was immediately to the right has **slid left into the closed tab's slot**, so its close button is now under the (unmoved) pointer. A trailing empty gap appears at the right end of the strip. |
| 6 | **Without** having moved the pointer out of the strip, close **another** tab by clicking (the one now under the cursor). Then move the pointer **out of `#tabstrip`** (e.g. into the web content area) and re-measure. | The second pointer-close again removes a tab with **no resize** (next tab slides under the cursor). After the pointer **leaves the strip** (`mouseleave`), the remaining tabs **re-expand** to fill the available width (widths grow; trailing gap disappears). |
| 7 | Click the **maximize/restore** window-control button (Linux/Windows custom control). Read its accessible name / icon / state. Click it again. | After the first click the window maximizes **and** the button's observable state flips to indicate **Restore** (accessible name and/or icon/`data-state` reflects "restore"/maximized); after the second click the window un-maximizes and the button returns to indicate **Maximize**. The button state tracks real window state (DD7 read path). **WSLg caveat**: if `win.maximize()` does not reliably maximize/fire `maximize` on the dev compositor (open question), this step is `needs-human-recheck` — assert at least that the click reached the IPC seam and fall back to a manual maximize/restore observation. [a11y] |
| 8 | **Keyboard-close reflow (contrast with Step 5):** focus a tab in the strip and close it with `Delete` (trusted key), with the pointer **not** over the strip. Re-measure. | The tab is removed and the remaining tabs **reflow immediately** (re-expand) — the deferred-resize freeze applies only to pointer-close while the pointer is over the strip, not to keyboard close. |

**Row conventions:** one row = one checkpoint; `[a11y]` flags accessibility-relevant checks.

## Out of Scope

- Pill `+`/`▾` new-tab / container operability and the focus-ring-on-gold check — covered by
  `unified-tab-controls.md`.
- Tab-strip keyboard navigation semantics (Arrow/Home/End, roving tabindex, close-button names) —
  covered by `tab-keyboard-operability.md` (Step 8 here only checks keyboard-close *reflow
  timing*, not the nav contract).
- Window **drag-to-move**, **Close** (harness-destructive), and **minimize** (backgrounded
  renderer) — manual checks per the flight's verification section.
- Exact floor px and scroll-onset count — tuned during leg design / HAT; this spec asserts the
  *qualitative* shrink-then-scroll behavior, not specific pixel thresholds.

## Variants (optional)

- Re-run Steps 2–4 at a narrow vs. wide window width to confirm the shrink/grow responds to the
  available strip width, not a fixed tab count.
