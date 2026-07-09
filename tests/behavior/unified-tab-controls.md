# Behavior Test: Unified tab-bar control — new tab & container, mouse + keyboard

**Slug**: `unified-tab-controls`
**Status**: active
**Created**: 2026-06-06
**Last Run**: 2026-06-07-00-30-09

## Intent

Verify that the unified golden pill (`( + | ▾ )`) — positioned **immediately to the right of the
open tabs** (adjacent/hugging them, left-aligned in the strip; a draggable region and the window
controls sit further right) — still performs both of its actions — opening a plain new tab, and
opening a new tab in a chosen container/jar — by
**mouse and by keyboard**, preserving the behavior that previously lived in the two trailing
`#new-tab` / `#new-tab-menu` buttons, and that the pill carries a **visible keyboard focus
indicator against its golden background**. This needs a behavior test rather than a unit test
because the properties under test are *real pointer/keyboard input driving the running Electron
chrome* (trusted clicks, trusted key activation, the container menu's open/focus/Escape cycle)
and a *rendered-pixel* focus-ring delta on a gold fill — neither a jsdom DOM-attribute check nor
synthetic events faithfully model "a user can actually open these tabs and see where focus is."
(Mission SC2 + SC8; the focus-ring-on-gold check guards DD2.)

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
- **This test drives the renderer (the Goldfinch chrome UI), NOT a guest WebContentsView** — the pill
  and tab strip live in the chrome renderer. `getChromeTarget()` returns the chrome `wcId` directly
  (no target-selection trap). All drive and observe calls pass this `wcId`.
- Input must be delivered as **trusted events** via the MCP tools (`click(wcId, x, y)`,
  `pressKey(wcId, name)`), not synthetic `dispatchEvent` — only trusted events fire the renderer's
  real click/keydown handlers and native focus traversal.
- **Focus-anchor rule (apparatus rule from the leg-2 spike):** a cold `Tab` from the bare document
  does not relocate focus — this is normal browser behavior, NOT an engine defect. **Before any
  keyboard-only sequence, establish a focus anchor by sending a `click(wcId, x, y)` into the chrome
  first** (e.g. the address bar area, ≈ (400, 63) at a 1400×900 window). Exact coordinates are
  environment/zoom-dependent; use a `captureWindow()` screenshot to locate controls and confirm the
  click landed.
- **Coordinate-click rule (apparatus rule from the leg-2 spike):** all clicks are coordinate-based —
  `click(wcId, x, y)` located via a `captureWindow()` screenshot. There are no CSS selectors over
  the MCP surface; the pill's `+`/`▾`, the container menu entries, and the tab buttons are all
  located by reading a `captureWindow()` frame.
- **Active precondition probe** (Step 1): confirm `tools/list` includes (presence-checked, not an exact count) the tools this spec drives:
  `getChromeTarget`, and `getChromeTarget()` returns a numeric chrome `wcId` before exercising
  anything.
- **Apparatus disqualification:** the `chrome-devtools` MCP does **NOT** qualify — it launches its
  own browser and never touches this app (false pass). The apparatus is the SDK admin MCP client
  over `127.0.0.1:$GOLDFINCH_MCP_PORT`, app launched via `npm run dev:automation`. This is **not**
  the CDP attach path — `npm run dev:automation` does not expose a DevTools port; only the admin MCP
  surface is used.

## Observables Required

- mcp (admin MCP tools on the chrome `wcId` — measured via the admin MCP client connected with the
  admin Bearer header): tab count (number of `tab` nodes in the `tablist` via `readAxTree(wcId)`);
  the presence and accessible name of the pill's `+` and `▾` controls + the `▾` control's
  `aria-expanded` and the container menu's items/focus via `readAxTree(wcId)`; the newly-created
  tab's **jar dot** (`.tab-jar`, present only for non-default containers) via `readDom(wcId)` as the
  witness that a tab opened *in a container*; the focused node via the `focused` property of
  `readAxTree(wcId)`; and **`captureWindow()` screenshots** for the focus-ring delta (a
  rendered-pixel property the a11y tree can't attest — the Validator compares a focused-vs-unfocused
  frame to confirm a visible delta).
- shell (precondition probe: `tools/list` count and `getChromeTarget` result — measured via the MCP
  client or Bash).

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the admin MCP client; call `tools/list`; then call `getChromeTarget()`. Note the current tab count via `readAxTree(wcId)`. | `tools/list` **includes** (presence-checked, not an exact count) the tools this spec drives: `getChromeTarget`. `getChromeTarget()` returns `{ wcId, kind: 'chrome', url }` where `wcId` is a **numeric** chrome identifier. Record `wcId` and the tab count. If not, halt — preconditions not met. |
| 2 | Inspect the control region **immediately to the right of the open tabs** (between the tabs and the draggable region / window controls) via `readAxTree(wcId)` / `readDom(wcId)` and a `captureWindow()` screenshot. | A single **pill-shaped control with the golden (`--accent`) background** sits **immediately to the right of the open tabs** (adjacent/hugging them, left-aligned in the strip — not at the far-right window-controls end). It contains two operable controls: a **new-tab** button (accessible name ≈ "New tab") and a **container/menu** button (accessible name ≈ "New tab in a container", `aria-haspopup="menu"`, `aria-expanded="false"`). [a11y] |
| 3 | **Mouse — new tab:** take a `captureWindow()` screenshot to locate the `+` (new-tab) control, then `click(wcId, x, y)` on it. | Tab count increases by exactly one; the new tab becomes active. The new tab has **no** jar dot (default container — confirmed via `readDom(wcId)`). |
| 4 | **Mouse — container tab:** locate the `▾` (container) control via `captureWindow()` and `click(wcId, x, y)` on it; in the menu that opens, locate a **named container** entry (not the default) via a fresh `captureWindow()` and `click(wcId, x, y)` on it. | The `▾` control's `aria-expanded` was `true` while the menu was open (via `readAxTree(wcId)`); choosing a container opens a new tab whose strip button shows a **jar dot** (`.tab-jar`, via `readDom(wcId)`) matching that container's color. Tab count increased by one. |
| 5 | **Keyboard — new tab:** establish a focus anchor with `click(wcId, x, y)` in the chrome, then move focus to the `+` control via `pressKey(wcId, 'Tab')`/`pressKey(wcId, 'ShiftTab')`. Confirm focus via `readAxTree(wcId)`, then activate with `pressKey(wcId, 'Enter')` (and/or `pressKey(wcId, 'Space')`). | While focused, the `+` control shows a **visible focus indicator that contrasts against the golden fill** — a focused-vs-unfocused `captureWindow()` screenshot shows a clear ring/outline delta (≥3:1 against the gold), NOT a gold-on-gold (invisible) ring and NOT `outline:none`. Activation opens one new tab. [a11y] |
| 6 | **Keyboard — container tab:** focus the `▾` control (focus-anchor click first, then `pressKey(wcId, 'Tab')`/`'ShiftTab'`); `pressKey(wcId, 'Enter')` to open the menu; observe focus lands in the menu via `readAxTree(wcId)`; navigate to a named container with `pressKey(wcId, 'ArrowDown')`/`'ArrowUp'` and activate it (`pressKey(wcId, 'Enter')`). | Opening the menu by keyboard moves focus into it (first item focused); `aria-expanded` becomes `true`; activating a container entry opens a new tab with that container's **jar dot**. Focus is never stranded on `<body>` (per `readAxTree(wcId)`). [a11y] |
| 7 | **Keyboard — menu dismiss/focus restore:** open the `▾` menu again (focus the trigger, `pressKey(wcId, 'Enter')`), then `pressKey(wcId, 'Escape')`. | The menu closes, `aria-expanded` returns to `false`, and focus is **restored to the `▾` trigger** (not lost to `<body>`) per `readAxTree(wcId)`. [a11y] |
| 8 | **Regression guard — tab-strip contract intact:** read the strip structure via `readAxTree(wcId)` (the pill controls sit *outside* the `tablist`). | The strip is still a single `tablist` containing exactly the live tabs as `tab` children with exactly one `aria-selected="true"`; the pill's `+`/`▾` are **not** members of the `tablist`. (Confirms the pill restructure didn't fold non-tab controls into the tablist; full keyboard-nav coverage remains `tab-keyboard-operability.md`.) [a11y] |

**Row conventions:** one row = one checkpoint. `[a11y]` flags accessibility-relevant checks for
the optional Accessibility Validator.

## Out of Scope

- Tab **shrink/grow** sizing, the scroll fallback, **deferred resize-on-close**, and the
  **maximize/restore** window-state read path — covered by `responsive-tab-strip.md`.
- Full tab-strip **keyboard navigation** (Arrow/Home/End/Delete, roving tabindex, close-button
  names) — covered by `tab-keyboard-operability.md`; this spec only asserts the pill sits outside
  the tablist (Step 8).
- Window **drag-to-move** and **Close** — not drivable over the MCP surface / harness-destructive; manual.
- The hostile-scheme guard on tab creation — `tab-scheme-guard.md`.

## Variants (optional)

- Could parametrize Step 4/6 across multiple containers (default, a user jar, burner) to confirm
  each opens with the correct dot.
