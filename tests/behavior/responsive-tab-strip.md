# Behavior Test: Responsive tab sizing, deferred resize-on-close, and maximize state

**Slug**: `responsive-tab-strip`
**Status**: active
**Created**: 2026-06-06
**Last Run**: 2026-07-14-15-47-10

## Intent

Verify three rendered-layout behaviors of the restructured tab strip and frameless window that
only exist in the running app: (1) tabs **shrink/grow to fit** the available width via staged
content disclosure (title-hide → inactive-tab close-hide → sliver padding) with **no scrollbar at
any tab count** — even at a pathological count no tab is clipped out of the strip — and the
active tab keeps its close affordance at every stage; (2) closing a tab **by pointer (✕ or
middle-click) defers the reflow** — remaining tabs keep their width and slide left under the
cursor until the pointer leaves the strip, then re-expand, while keyboard close reflows
immediately; and (3) the frameless window's **maximize/restore button reflects window state**
through an observable DOM read path. These need a behavior test because they are *layout geometry
and pointer-interaction timing in the live Electron chrome* (computed widths, sibling positions
before/after `mouseleave`, real window maximize state) — unit tests can't observe rendered widths
or drive a real maximize, and the disclosure stages are pure `@container` CSS with no JS state to
unit-test. (M09 Flight 1 DD1–DD5 + the DD7 maximize read path; SC8 a11y is covered by `npm run
a11y`.)

## Preconditions

- **Apparatus — admin MCP surface.** Goldfinch is running via `npm run dev:automation` with
  `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1`. At launch, the app prints
  `AUTOMATION_DEV_MINT { "key": "...", "adminKey": "..." }` to stdout — capture the `adminKey`.
  The MCP server listens on `127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`.
- **Port (load-bearing for every URL below) — pin-if-free, else free-fallback.** Try pinning the
  listen port via `GOLDFINCH_MCP_PORT=49707`. If the launch fails to bind it (a prior run's first
  live run hit this on WSL: mirrored networking can hold a port outside this WSL netns, invisible
  to `ss`, so the pin fails loudly even though nothing local is using it), relaunch **without** the
  env pin — the server free-falls to the next available port and prints it (and a fresh
  `AUTOMATION_DEV_MINT`) to stdout. Either way, read the actually-bound port from that output and
  reuse it in every SDK call below; do not assume `49707` succeeded.
- **How the admin key attaches to the client (load-bearing).** Connect an admin MCP client (SDK
  `StreamableHTTPClientTransport`, `Authorization: Bearer <adminKey>`) on
  `127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`:
  ```js
  const port = process.env.GOLDFINCH_MCP_PORT || 49707;
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
    { requestInit: { headers: { Authorization: `Bearer ${adminKey}` } } }
  );
  ```
  The Bearer rides every request the transport sends. This spec requires the **admin** key — a jar
  key is refused `getChromeTarget` (`admin-only`) and cannot drive or read the chrome renderer.
- **Drive the renderer (chrome UI), NOT a guest WebContentsView.** `getChromeTarget()` returns the
  chrome `wcId` directly (no target-selection trap). All drive and observe calls pass this `wcId`.
- Input delivered as **trusted events** via the MCP tools (`click(wcId, x, y[, { button }])`,
  `pressKey(wcId, name)`) — only trusted events fire the renderer's real handlers + native focus
  traversal. The deferred-resize check depends on the pointer leaving the strip (`mouseleave`);
  **the MCP surface has no move-only primitive** — `click` always emits move→down→up, so the
  `mouseleave` is induced by a `click(wcId, x, y)` at a safe coordinate **outside** the strip (the
  move-out is the click's `mouseMove` side-effect). See the no-move-only note below. `click` also
  forwards a `button` option (`'left' | 'right' | 'middle'`, default `left`) — `button: 'middle'`
  delivers a trusted middle-click for the Step 8 close check.
- **Numeric geometry reads are the primary layout observable (M09 F1 DD4 — supersedes the old
  screenshot-only apparatus rule).** Admin-tier `evaluate(chromeWcId, expression)` runs a
  JSON-serializable-return expression against the chrome document and is used for all
  width/overflow/visibility assertions below, e.g.:
  ```js
  // #tabs overflow check (no-scrollbar invariant)
  evaluate(chromeWcId, `(() => {
    const t = document.getElementById('tabs');
    return { scrollWidth: t.scrollWidth, clientWidth: t.clientWidth };
  })()`)
  // per-tab width + close-button visibility
  evaluate(chromeWcId, `Array.from(document.querySelectorAll('.tab')).map(tab => ({
    width: tab.getBoundingClientRect().width,
    active: tab.classList.contains('active'),
    closeVisible: getComputedStyle(tab.querySelector('.tab-close')).display !== 'none',
  }))`)
  ```
  A returned Promise is awaited and the value must be JSON-serializable (plain objects/arrays only
  — no DOM nodes). An in-page throw surfaces as an MCP error result.
- **`captureWindow()` remains for rendered-truth and the WSLg-distortion fallback.** If a numeric
  read disagrees with what a screenshot shows for the same state (the historical "DOM correct ≠
  render correct" failure mode this project has hit before — e.g. `@container` reports a `display`
  the pixels don't match), **the screenshot is authoritative** for that checkpoint; flag the
  disagreement in the run log rather than silently trusting the DOM read. Screenshots are also
  still used for the coordinate-click rule below and for the maximize/restore visual spot-check.
- **Coordinate-click rule (apparatus rule from the leg-2 spike, still in force):** all clicks are
  coordinate-based — `click(wcId, x, y)`. There are no CSS selectors over the MCP surface's drive
  path. A click coordinate for a given tab/button can now be derived either from a `captureWindow()`
  screenshot **or** computed from the same `getBoundingClientRect()` read used for the width
  assertions (more precise, avoids pixel-peeping); either is acceptable, screenshot-derived
  coordinates are the fallback if a rect read looks suspect. Exact coords are
  environment/zoom-dependent regardless of source.
- **No move-only primitive (the `mouseleave` re-expand):** to trigger the strip's deferred re-expand
  on `mouseleave`, `click(wcId, x, y)` at a safe coordinate **outside** `#tabstrip` (e.g. mid
  web-content) — the move-out is the click's side-effect. Pick a coordinate that won't activate web
  content or shift a meaningful focus.
- **Focus-anchor rule (apparatus rule from the leg-2 spike):** a cold `Tab` from the bare document
  does not relocate focus. **Before the keyboard-close sequence (Step 10), establish a focus anchor
  by sending a `click(wcId, x, y)` into the chrome first** (then `pressKey` into the strip).
- A local HTTP **fixture** serving pages at **distinct, non-normalizing** URLs for the setup tabs
  (so tabs are individually identifiable). **Probe that the fixture port is free** before running
  (`:8000`/`:8080`/`:8090` collisions collapsed per-tab URLs in prior runs). Local `about:blank`
  variants are an acceptable offline fallback for identity if no fixture server is available.
  **Fixture pages must declare `<meta charset="utf-8">`** — a prior run's fixture served no
  charset, so the page numerals/labels containing an em dash decoded as windows-1252 and rendered
  as mojibake in both the DOM and the pixels (consistent, not a strip defect, but it happened to
  ride on non-ASCII fixture text and would confuse a distinctness read that also checked exact
  string content rather than just pairwise inequality).
- **Fixture-distinctness probe (M09 F1 DD4 — new precondition, folded into Step 2 below):** a prior
  run's per-tab URLs silently collapsed to one fixture page (port collision), making the
  "slid-left" pointer-close check ambiguous. Before relying on tab identity for any check, confirm
  the opened tabs' titles/URLs are **pairwise distinct** via `readAxTree(wcId)` or an `evaluate`
  read over `.tab-title` text content — halt and fix the fixture if any collide.
- **`#window-controls` sits INSIDE `#tabstrip` (apparatus fact, codified from a live run).** The
  deferred-reflow re-expand (Steps 7–8) fires on `#tabstrip`'s `mouseleave`, and `mouseleave` only
  fires on an element's own boundary crossing, not on moving into a child — so a click on the
  minimize/maximize/close buttons does **not** end the width freeze (the pointer never leaves
  `#tabstrip`'s box). Do not use a window-control click as a stand-in for the "move outside the
  strip" step; use a coordinate in the web content area instead, as the mouseleave step already
  does.
- **This test exercises window maximize/restore (Step 9).** On the dev platform (Linux/WSL) the
  custom maximize button is present and clickable. **Do NOT click Close or minimize** — Close
  tears down the harness and a minimized renderer is backgrounded (both are manual checks).
- **Active precondition probe** (Step 1): confirm `tools/list` includes (presence-checked, not an
  exact count) the tools this spec drives: `getChromeTarget`, `evaluate`. `getChromeTarget()`
  returns a numeric chrome `wcId`.
- **Apparatus disqualification:** the `chrome-devtools` MCP does **NOT** qualify — it launches its
  own browser and never touches this app (false pass). The apparatus is the SDK admin MCP client
  over `127.0.0.1:$GOLDFINCH_MCP_PORT`, app launched via `npm run dev:automation`. This is **not**
  the CDP attach path — `npm run dev:automation` does not expose a DevTools port; only the admin MCP
  surface is used.
- **Keyboard-operability interaction (DD5, informational — not a new step):** close buttons are
  real, named `<button>` elements in the DOM at all times; the close-hidden `@container` stage is
  `display`-driven and applies only under width pressure to **inactive** tabs. The existing
  `tab-keyboard-operability` spec runs at low tab counts where every close button is visible and
  needs no change — Delete/Backspace close (which needs no button) works at every width regardless
  of disclosure stage.

## Observables Required

- mcp (admin MCP tools on the chrome `wcId` — measured via the admin MCP client connected with the
  admin Bearer header): **`evaluate(chromeWcId, …)` numeric reads are the primary layout
  observable** — `#tabs.scrollWidth` vs `clientWidth` (no-scrollbar invariant), per-tab
  `getBoundingClientRect().width` (width-invariance / shrink-growth), and `.tab-close`
  `getComputedStyle().display` (close-button visibility per stage). `captureWindow()` screenshots
  are the rendered-truth / WSLg-distortion-fallback observable and are still used to visually
  confirm disclosure stages and to locate/verify click coordinates. The maximize/restore button's
  **accessible name / icon / `data-state`** is read via `readDom(wcId)`/`readAxTree(wcId)`. Tab
  count + structure + title text via `readAxTree(wcId)`.
- shell (precondition probe: `tools/list` count and `getChromeTarget` result — measured via the MCP
  client or Bash).

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the admin MCP client; call `tools/list`; then call `getChromeTarget()`. Take a baseline `captureWindow()` and record the current tab count via `readAxTree(wcId)` and a baseline `evaluate` read of `#tabs.scrollWidth`/`clientWidth`. | `tools/list` **includes** (presence-checked, not an exact count) the tools this spec drives: `getChromeTarget`, `evaluate`. `getChromeTarget()` returns `{ wcId, kind: 'chrome', url }` where `wcId` is a **numeric** chrome identifier. Record `wcId`. If not, halt — preconditions not met. |
| 2 | Open a **small** number of tabs (e.g. 3–4) at distinct fixture URLs. **Fixture-distinctness probe:** read each tab's title/URL via `readAxTree(wcId)` and confirm they are pairwise distinct. | Titles/URLs are pairwise distinct (no port-collision collapse) — halt and fix the fixture if any two tabs read identical. Record the confirmed tab count for the next step. |
| 3 | With the same small tab count, `evaluate` each `.tab`'s `getBoundingClientRect().width` and `#tabs.scrollWidth`/`clientWidth`. Take a `captureWindow()` for visual corroboration. | Tabs **expand to share** the available strip width (each tab's width is comfortably above the disclosure thresholds — well clear of the sliver stage). `#tabs.scrollWidth <= #tabs.clientWidth` (no overflow — no horizontal scroll affordance). The screenshot visually corroborates full-width tabs with title + favicon + close all visible. |
| 4 | Open **many** more tabs (enough to exceed the comfortable width — e.g. 12–20+). `evaluate` per-tab widths, `#tabs` scrollWidth/clientWidth, and each tab's `.tab-close` `getComputedStyle().display`. Take a fresh `captureWindow()`. | Tabs **shrink** to share the width (numerically narrower than Step 3). `#tabs.scrollWidth <= #tabs.clientWidth` still holds (still no overflow). Depending on how far widths have dropped, some **inactive** tabs' `.tab-close` may report `display: none` (title-hide / close-hide disclosure stages engaging) while the **active** tab's `.tab-close` always reports a visible display value. The screenshot shows narrower tabs with ellipsized/hidden titles, consistent with the numeric reads. [a11y] |
| 5 | **(Replaces the old scroll-onset check — DD2: no hard floor on tabs in general, so scroll-onset has no code path.)** Keep opening tabs until a pathological count is reached (e.g. 60+). `evaluate` `#tabs.scrollWidth`/`clientWidth` and every `.tab`'s `getBoundingClientRect().width`. Additionally, read the active tab's own rect AND its `.tab-close` button's rect (`getBoundingClientRect()` on both). Take a `captureWindow()`, and a magnified crop of the strip's right end / the active tab if the active tab isn't visually obvious. | **No scroll affordance ever appears**: `#tabs.scrollWidth <= #tabs.clientWidth` still holds even at this pathological count. **No tab is clipped out of the strip**: every `.tab` width is `> 0` (sliver stage, not zero) and the count of `.tab` elements read equals the number of tabs opened. **Active-tab close-button containment (DD2 amendment, M09 F1 Leg 2 fix cycle):** the active tab is permitted to be numerically wider than the inactive slivers (a narrow, active-tab-only width floor) — that is the amendment working as designed, not a defect. Assert **rect containment**: the active `.tab-close`'s `getBoundingClientRect()` (`top`/`left`/`right`/`bottom`) must lie fully inside the active `.tab`'s own rect (`closeRect.left >= tabRect.left`, `closeRect.right <= tabRect.right`, and likewise for top/bottom) — not merely `display !== 'none'` in the DOM, which is supplementary corroboration only, not the primary assertion (a button can report `display:block` in the DOM while its layout box sits outside an `overflow:hidden` ancestor and is never painted — exactly the Step-5 defect this spec caught). Then confirm the **rendered pixels**: the screenshot (magnified crop if needed) shows an actual ✕ glyph inside the active tab's bounds, not just its neighboring dot/background. **DD1 premise check:** if the numeric reads and the screenshot disagree about a `display`/visibility/containment state at this count (DOM says visible/contained but pixels show otherwise, or vice versa), STOP — this is the `@container`-class misrender premise failure the leg must escalate, not paper over. |
| 6 | With many tabs open (back to a comfortable working count, e.g. the Step 4 count), locate a **middle** tab's close button (via a rect read or a `captureWindow()`); record (a) that tab's position/width and (b) the widths of the tabs to its right. `click(wcId, x, y)` on that close button to close it **by pointer**, keeping the click coordinate over the strip (do not click elsewhere afterward). `evaluate` the same rects after. | The tab is removed (count −1). Comparing the before/after `getBoundingClientRect()` reads: remaining tabs **keep their previous widths** (no resize); the tab that was immediately to the right has **slid left into the closed tab's slot**, so its close button is now at the (unmoved) click coordinate. `#tabs` **shrink-wraps its content** (`flex: 0 1 auto`), so `#tabs.scrollWidth === #tabs.clientWidth` holds throughout this step, not "clientWidth is unchanged" — assert the deferred-reflow gap **semantically** instead of via clientWidth: the remaining tabs' individual widths are frozen (byte-identical before/after), and the freed space opens as a trailing gap **at the strip's right, outside `#tabs`** (the `+` pill / drag spacer / window controls shift left to fill it — `#tabs` itself simply reports a smaller `scrollWidth`/`clientWidth` pair, still equal to each other). |
| 7 | **Without** clicking outside the strip yet, close **another** tab with `click(wcId, x, y)` on the close button now at the previous coordinate. `evaluate` widths again. Then induce `mouseleave` by `click(wcId, x, y)` at a safe coordinate **outside** `#tabstrip` (e.g. mid web-content — see the `#window-controls`-is-inside-`#tabstrip` apparatus fact in Preconditions; a window-control click does NOT induce `mouseleave`). `evaluate` widths a final time and take a `captureWindow()`. | The second pointer-close again removes a tab with **no resize** (widths unchanged in the numeric read, next tab's rect now at the coordinate) — same shrink-wrapped-`#tabs` semantics as Step 6 (scrollWidth == clientWidth throughout; judge the frozen gap by individual tab widths and where the freed space opens, not by a "clientWidth changed" comparison). After the click **outside the strip** induces `mouseleave`, the final numeric read shows the remaining tabs' widths **grew** (re-expanded to fill the available width) and the trailing gap is gone — `#tabs.scrollWidth`/`clientWidth` both grow back to the full shared-width state. The screenshot corroborates the re-expanded state. |
| 8 | **Middle-click close (M09 F1 DD3).** With several tabs open, locate a tab's body (not its close button) via a rect read or screenshot. `click(wcId, x, y, { button: 'middle' })` on that tab body. `evaluate` widths/count before and after, matching the deferred-reflow check pattern of Step 6 (do not click outside the strip afterward). | The tab is removed (count −1) through the **same deferred-reflow signature as Step 6**: remaining tabs' widths are unchanged immediately after the middle-click (no resize), and the tab to the right has slid into the closed slot. (Other pointer buttons routing through `auxclick` — e.g. back/forward buttons 3/4 — are a code-level no-op per the `e.button !== 1` filter and are not separately driven here: the MCP `click` tool only exposes `'left' | 'right' | 'middle'`, and a live right-click is out of scope for this spec — see Out of Scope.) |
| 9 | Take a `captureWindow()` to locate the **maximize/restore** window-control button (Linux/Windows custom control); `click(wcId, x, y)` on it. Read its accessible name / icon / `data-state` via `readDom(wcId)`/`readAxTree(wcId)`. `click(wcId, x, y)` on it again. | After the first click the window maximizes **and** the button's observable state flips to indicate **Restore** (accessible name and/or icon/`data-state` reflects "restore"/maximized); after the second click the window un-maximizes and the button returns to indicate **Maximize**. The button state tracks real window state (DD7 read path). **WSLg caveat**: if `win.maximize()` does not reliably maximize/fire `maximize` on the dev compositor (open question), this step is `needs-human-recheck` — assert at least that the click reached the IPC seam and fall back to a manual maximize/restore observation. [a11y] |
| 10 | **Keyboard-close reflow (contrast with Steps 6–8):** establish a focus anchor with `click(wcId, x, y)` in the chrome, then `pressKey(wcId, 'Tab')` into the strip to focus a tab and close it with `pressKey(wcId, 'Delete')` (trusted key), with the last click coordinate **not** over the strip. `evaluate` widths before/after. | The tab is removed and the remaining tabs **reflow immediately** (widths grow in the after-read) — the deferred-resize freeze applies only to pointer-close (✕ or middle-click) while the pointer is over the strip, not to keyboard close. |

**Row conventions:** one row = one checkpoint; `[a11y]` flags accessibility-relevant checks.

## Out of Scope

- Pill `+`/`▾` new-tab / container operability and the focus-ring-on-gold check — covered by
  `unified-tab-controls.md`.
- Tab-strip keyboard navigation semantics (Arrow/Home/End, roving tabindex, close-button names) —
  covered by `tab-keyboard-operability.md` (Step 10 here only checks keyboard-close *reflow
  timing*, not the nav contract).
- Window **drag-to-move**, **Close** (harness-destructive), and **minimize** (backgrounded
  renderer) — manual checks per the flight's verification section.
- **Live right-click / other-`auxclick`-button no-op.** The MCP `click` tool only exposes
  `'left' | 'right' | 'middle'`; a live `'right'` click risks popping a native/OS context menu the
  harness has no reliable way to dismiss (no context-menu handler is wired on `.tab` today — that's
  a future context-menu flight). The `e.button !== 1` filter that makes back/forward-button
  `auxclick`s a no-op is a code-level guarantee, not driven live here.
- **Exact `@container` disclosure thresholds and sliver padding.** Tuned during leg implementation
  against real rendering (recorded in the flight log); this spec asserts the *qualitative* staged
  shrink (comfortable → title-hidden → inactive-close-hidden → sliver) and the *quantitative*
  no-scroll/no-clip invariant at a pathological count, not specific pixel breakpoints.

## Variants (optional)

- Re-run Steps 3–5 at a narrow vs. wide window width to confirm the shrink/grow responds to the
  available strip width, not a fixed tab count.
