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

- **Apparatus — admin MCP surface.** Goldfinch is running via `npm run dev:automation` with
  `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_MCP_PORT=49707`. At
  launch, the app prints `AUTOMATION_DEV_MINT { "key": "...", "adminKey": "..." }` to stdout —
  capture the `adminKey`. The MCP server listens on `127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`.
- **Port (load-bearing for every URL below).** Pin the listen port via `GOLDFINCH_MCP_PORT` (default
  `49707`). Export it once at launch and reuse it in all SDK calls.
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
  key is refused `getChromeTarget` (`admin-only`) and cannot drive the chrome renderer.
- **Drive the renderer (chrome UI), NOT a `<webview>` guest.** `getChromeTarget()` returns the
  chrome `wcId` directly (no target-selection trap). All drive and observe calls pass this `wcId`.
- Input delivered as **trusted events** via the MCP tools (`click(wcId, x, y)`,
  `pressKey(wcId, name)`) — only trusted events fire the renderer's real handlers + native focus
  traversal. The deferred-resize check depends on the pointer leaving the strip (`mouseleave`);
  **the MCP surface has no move-only primitive** — `click` always emits move→down→up, so the
  `mouseleave` is induced by a `click(wcId, x, y)` at a safe coordinate **outside** the strip (the
  move-out is the click's `mouseMove` side-effect). See the no-move-only note below.
- **Geometry is screenshot-observed (apparatus rule — there is no in-page numeric read).** The MCP
  surface has **no `getBoundingClientRect`/`scrollWidth` read** — there is no in-page eval over the
  chrome. All layout-geometry assertions are therefore **visual**: overflow/scroll-fallback,
  favicon/close visibility, and the relative tab widths are judged from `captureWindow()`
  screenshots, and the **width-invariance + reflow-timing checks are judged from before/after
  `captureWindow()` deltas** — the Validator compares two frames. The screenshot is the source of
  truth (mirror of the coordinate-click rule below). Maximize/restore state is read from the
  button's `data-state`/accessible name via `readDom(wcId)`/`readAxTree(wcId)`, not geometry.
- **Coordinate-click rule (apparatus rule from the leg-2 spike):** all clicks are coordinate-based —
  `click(wcId, x, y)` located via a `captureWindow()` screenshot. There are no CSS selectors over
  the MCP surface; tab close affordances and the maximize/restore control are located by reading a
  `captureWindow()` frame. Exact coords are environment/zoom-dependent.
- **No move-only primitive (the `mouseleave` re-expand):** to trigger the strip's deferred re-expand
  on `mouseleave`, `click(wcId, x, y)` at a safe coordinate **outside** `#tabstrip` (e.g. mid
  web-content) — the move-out is the click's side-effect. Pick a coordinate that won't activate web
  content or shift a meaningful focus.
- **Focus-anchor rule (apparatus rule from the leg-2 spike):** a cold `Tab` from the bare document
  does not relocate focus. **Before the keyboard-close sequence (Step 8), establish a focus anchor
  by sending a `click(wcId, x, y)` into the chrome first** (then `pressKey` into the strip).
- A local HTTP **fixture** serving pages at **distinct, non-normalizing** URLs for the setup tabs
  (so tabs are individually identifiable). **Probe that the fixture port is free** before running
  (`:8000`/`:8080`/`:8090` collisions collapsed per-tab URLs in prior runs). Local `about:blank`
  variants are an acceptable offline fallback for identity if no fixture server is available.
- **This test exercises window maximize/restore (Step 7).** On the dev platform (Linux/WSL) the
  custom maximize button is present and clickable. **Do NOT click Close or minimize** — Close
  tears down the harness and a minimized renderer is backgrounded (both are manual checks).
- **Active precondition probe** (Step 1): confirm `tools/list` shows 17 tools including
  `getChromeTarget`, and `getChromeTarget()` returns a numeric chrome `wcId`.
- **Apparatus disqualification:** the `chrome-devtools` MCP does **NOT** qualify — it launches its
  own browser and never touches this app (false pass). The apparatus is the SDK admin MCP client
  over `127.0.0.1:$GOLDFINCH_MCP_PORT`, app launched via `npm run dev:automation`. This is **not**
  the CDP attach path — `npm run dev:automation` does not expose a DevTools port; only the admin MCP
  surface is used.

## Observables Required

- mcp (admin MCP tools on the chrome `wcId` — measured via the admin MCP client connected with the
  admin Bearer header): **`captureWindow()` screenshots are the primary layout observable** — they
  attest tab widths, whether `#tabs` overflows into a horizontal scroll affordance, and
  favicon/`.tab-close` visibility at the floor (there is no `getBoundingClientRect`/`scrollWidth`
  read over the surface); the width-invariance and reflow-timing checks are judged from **before vs.
  after** `captureWindow()` frames. The maximize/restore button's **accessible name / icon /
  `data-state`** is read via `readDom(wcId)`/`readAxTree(wcId)`. Tab count + structure via
  `readAxTree(wcId)`.
- shell (precondition probe: `tools/list` count and `getChromeTarget` result — measured via the MCP
  client or Bash).

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the admin MCP client; call `tools/list`; then call `getChromeTarget()`. Take a baseline `captureWindow()` and record the current tab count via `readAxTree(wcId)`. | `tools/list` returns **17 tools** including `getChromeTarget`. `getChromeTarget()` returns `{ wcId, kind: 'chrome', url }` where `wcId` is a **numeric** chrome identifier. Record `wcId`. If not, halt — preconditions not met. |
| 2 | Open a **small** number of tabs (e.g. 3–4) at distinct fixture URLs. Take a `captureWindow()` screenshot and observe each tab's rendered width. | Tabs **expand to share** the available strip width (each is comfortably wide, well above the floor — judged visually from the screenshot). `#tabs` shows **no** horizontal scroll affordance (no scrollbar/overflow visible in the frame). |
| 3 | Open **many** more tabs (enough to exceed the comfortable width — e.g. 12–20+). Take a fresh `captureWindow()` and observe tab widths vs. Step 2. | Tabs **shrink** to share the width (visibly narrower than Step 2); each remaining tab's **favicon and close button stay visible** in the frame and the title ellipsizes. Tabs do **not** keep a fixed 120–220px width with an always-on scrollbar (the old behavior). [a11y] |
| 4 | Keep opening tabs until even the floor width cannot fit all tabs in the strip. Take a `captureWindow()`. | Only **now** does a horizontal scroll affordance appear in the frame (the strip overflows) — scroll is the last-resort fallback, not the default. |
| 5 | With many tabs open, take a `captureWindow()` and locate a **middle** tab's close button; record (a) that tab's position in the frame and (b) the apparent left positions + widths of the tabs to its right. `click(wcId, x, y)` on that close button to close it **by pointer**, keeping the click coordinate over the strip (do not click elsewhere afterward). Take an after `captureWindow()` and compare. | The tab is removed (count −1). Comparing the before/after frames: remaining tabs **keep their previous widths** (no resize); the tab that was immediately to the right has **slid left into the closed tab's slot**, so its close button is now under the (unmoved) click coordinate. A trailing empty gap appears at the right end of the strip. |
| 6 | **Without** clicking outside the strip yet, close **another** tab with `click(wcId, x, y)` on the close button now under the previous coordinate. Take a `captureWindow()`. Then induce `mouseleave` by `click(wcId, x, y)` at a safe coordinate **outside** `#tabstrip` (e.g. mid web-content). Take a final `captureWindow()` and compare. | The second pointer-close again removes a tab with **no resize** (before/after frames: next tab slides under the coordinate, widths unchanged). After the click **outside the strip** induces `mouseleave`, the final frame shows the remaining tabs **re-expanded** to fill the available width (widths grew; trailing gap gone). *(If the Validator cannot cleanly separate "reflow on `mouseleave`" from "reflow on the outside-click itself," flag this checkpoint as a candidate F8-eval defer and record — do not invent a numeric read.)* |
| 7 | Take a `captureWindow()` to locate the **maximize/restore** window-control button (Linux/Windows custom control); `click(wcId, x, y)` on it. Read its accessible name / icon / `data-state` via `readDom(wcId)`/`readAxTree(wcId)`. `click(wcId, x, y)` on it again. | After the first click the window maximizes **and** the button's observable state flips to indicate **Restore** (accessible name and/or icon/`data-state` reflects "restore"/maximized); after the second click the window un-maximizes and the button returns to indicate **Maximize**. The button state tracks real window state (DD7 read path). **WSLg caveat**: if `win.maximize()` does not reliably maximize/fire `maximize` on the dev compositor (open question), this step is `needs-human-recheck` — assert at least that the click reached the IPC seam and fall back to a manual maximize/restore observation. [a11y] |
| 8 | **Keyboard-close reflow (contrast with Step 5):** establish a focus anchor with `click(wcId, x, y)` in the chrome, then `pressKey(wcId, 'Tab')` into the strip to focus a tab and close it with `pressKey(wcId, 'Delete')` (trusted key), with the last click coordinate **not** over the strip. Take before/after `captureWindow()` frames and compare. | The tab is removed and the remaining tabs **reflow immediately** (re-expand — visible in the after frame) — the deferred-resize freeze applies only to pointer-close while the pointer is over the strip, not to keyboard close. |

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
