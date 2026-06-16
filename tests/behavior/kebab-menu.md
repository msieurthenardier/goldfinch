# Behavior Test: Kebab (⋮) overflow menu — presence, two items, APG keyboard operation

**Slug**: `kebab-menu`
**Status**: active
**Created**: 2026-06-06
**Last Run**: 2026-06-07-10-42-52

## Intent

Verify that Goldfinch's kebab (⋮) overflow menu — a `<button>` in the **toolbar row, immediately to
the right of the Shield button** — opens a menu exposing **exactly two items, "Settings" and
"Exit"**, and that the menu follows the WAI-ARIA APG **menu-button** pattern: it opens by mouse and
by keyboard, focus management and arrow-key navigation work, `Escape` closes and restores focus to
the trigger, and clicking outside closes it. It also confirms the trigger carries a **visible
keyboard focus indicator**. This needs a behavior test rather than a unit test because the
properties under test are *real pointer/keyboard input driving the running Electron chrome* (trusted
clicks, trusted key activation, native focus traversal, the menu's open/focus/Escape cycle) and a
*rendered-pixel* focus-ring delta — neither a jsdom DOM-attribute check nor synthetic events
faithfully model "a user can actually open this menu, navigate it by keyboard, and see where focus
is." (Mission SC3 + SC8.)

**Not covered here (by design):** **Exit** actually quitting the app (SC4) is **manual** — calling
`app.quit()` tears down the test harness, so it cannot be witnessed; this test only confirms the Exit
item is present and selectable. **Settings** opening a page (SC5+) does not exist yet — in this flight
Settings is an inert placeholder, so this test only confirms it is present, focusable, selectable,
and harmless when chosen.

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
  The Bearer rides every request the transport sends. These specs require the **admin** key — a jar
  key is refused `getChromeTarget` (`admin-only`) and cannot drive the chrome renderer.
- **This test drives the renderer (the Goldfinch chrome UI), NOT a `<webview>` guest** — the toolbar
  and kebab live in the chrome renderer. `getChromeTarget()` returns the chrome `wcId` directly; all
  drive and observe calls pass this `wcId` (no target-selection trap).
- Input must be delivered as **trusted events** via the MCP tools (`click(wcId, x, y)`,
  `pressKey(wcId, name)`) — only trusted events fire the renderer's real click/keydown handlers and
  native focus traversal.
- **Coordinate-click rule (apparatus rule from the leg-2 spike):** all clicks are coordinate-based —
  `click(wcId, x, y)` located via a `captureWindow()` screenshot. There are no CSS selectors over
  the MCP surface. Take a `captureWindow()` screenshot to locate the kebab button's coordinates
  before clicking it.
- **Focus-anchor rule (apparatus rule from the leg-2 spike):** a cold `Tab` from the bare document
  does not relocate focus — this is normal browser behavior, NOT an engine defect. **Before any
  keyboard-only sequence, establish a focus anchor by sending a `click(wcId, x, y)` into the chrome
  first.** Use a `captureWindow()` screenshot to locate the click target.
- **Do NOT select the Exit item with a committing activation** (it quits the app and ends the run).
  Exit is asserted as *present/selectable only*; its quit effect is verified manually outside this test.
- **Active precondition probe** (Step 1): confirm `tools/list` shows 17 tools including `getChromeTarget`,
  and `getChromeTarget()` returns a numeric chrome `wcId` before exercising anything.
- **Apparatus disqualification:** the `chrome-devtools` MCP does **NOT** qualify — it launches its
  own browser and never touches this app (the standing Goldfinch false-pass trap). The apparatus is
  the SDK admin MCP client over `127.0.0.1:$GOLDFINCH_MCP_PORT`, app launched via
  `npm run dev:automation`. This is **not** the CDP attach path — `npm run dev:automation` does not
  expose a DevTools port; only the admin MCP surface is used.

## Observables Required

- mcp (admin MCP tools on the chrome `wcId` — `readAxTree(wcId)` for the kebab button's presence,
  accessible name (≈ "More" / "Menu"), `aria-haspopup="menu"`, `aria-expanded`; the toolbar
  position located via a `captureWindow()` screenshot (right of the Shield button, the last
  interactive control in the toolbar); the popup's open state (visible / not `.hidden`) and its
  **`role="menu"`**; the menu items (count = **exactly 2**, each `role="menuitem"`) and their
  accessible names ("Settings", "Exit"); focused node in `readAxTree(wcId)` for focus-on-open,
  arrow roving, and Escape-restores-to-trigger; the live tab count from `enumerateTabs` or
  `readAxTree(wcId)` (to confirm the inert Settings selection changes nothing); and
  `captureWindow()` / `captureScreenshot(wcId)` screenshots for the focus-ring delta — a
  rendered-pixel property the a11y tree can't attest)
- shell (precondition probe: `tools/list` count and `getChromeTarget` result — measured via the MCP
  client or Bash)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the admin MCP client; call `tools/list`; then call `getChromeTarget()`. Note the current tab count (via `enumerateTabs` or `readAxTree(wcId)`). | `tools/list` returns **17 tools** including `getChromeTarget`. `getChromeTarget()` returns `{ wcId, kind: 'chrome', url }` where `wcId` is a **numeric** chrome identifier. Record `wcId` and the tab count. If not, halt — preconditions not met. |
| 2 | Take a `captureWindow()` screenshot; locate and inspect the **toolbar row** (the row with the address bar, Media, and Shield buttons) and the kebab control. Confirm via `readAxTree(wcId)`. | A single **kebab (⋮) button** sits **immediately to the right of the Shield button** as the **last interactive control in the toolbar** — its left edge is at/after the Shield button's right edge. It has an accessible name, `aria-haspopup="menu"`, and `aria-expanded="false"`. [a11y] |
| 3 | **Mouse — open:** take a `captureWindow()` screenshot; locate the kebab button's coordinates; call `click(wcId, x, y)` on those coordinates. Then call `readAxTree(wcId)`. | The menu opens: `aria-expanded` becomes `true`; a popup with **`role="menu"`** appears containing **exactly two `role="menuitem"` items**, with accessible names **"Settings"** and **"Exit"** (in that order). No third item. [a11y] |
| 4 | **Focus on open:** with the menu open (reopen by keyboard if Step 3 left it closed — establish a focus anchor via `click(wcId, x, y)` on the kebab coordinates, then `pressKey(wcId, 'Enter')`), call `readAxTree(wcId)` and inspect the focused node. | Opening the menu moves focus **into the menu** — the first item ("Settings") is the focused node in `readAxTree(wcId)`. Focus is never stranded on `<body>`. [a11y] |
| 5 | **Keyboard — arrow navigation:** with the menu open and the first item focused, call `pressKey(wcId, 'ArrowDown')`, then `pressKey(wcId, 'ArrowDown')` again, then `pressKey(wcId, 'ArrowUp')`; call `readAxTree(wcId)` after each. Also call `pressKey(wcId, 'Home')` and `pressKey(wcId, 'End')`. | `ArrowDown` moves focus Settings → Exit; a further `ArrowDown` wraps to Settings (or stays at Exit — record which; APG allows either, wrapping preferred); `ArrowUp` moves back up. `Home` focuses Settings; `End` focuses Exit. Focus stays within the two menu items throughout per `readAxTree(wcId)`. [a11y] |
| 6 | **Keyboard — Escape closes + restores focus:** with the menu open, call `pressKey(wcId, 'Escape')`. Then call `readAxTree(wcId)`. | The menu closes; `aria-expanded` returns to `false`; focus is **restored to the kebab trigger** (not lost to `<body>`) per `readAxTree(wcId)`. [a11y] |
| 7 | **Mouse — click-outside closes:** take a `captureWindow()` screenshot; open the menu again (locate the kebab and call `click(wcId, x, y)`), then click somewhere outside the menu (e.g. the address bar area — locate via the screenshot and call `click(wcId, x, y)` on those coordinates). Call `readAxTree(wcId)`. | The menu closes and `aria-expanded` returns to `false`. |
| 8 | **Settings is present but inert:** open the menu (locate the kebab via `captureWindow()` and `click(wcId, x, y)`); locate and click the **Settings** item (via `captureWindow()` coordinates or `pressKey(wcId, 'Enter')` when it is focused). Read the tab count and the active tab's URL via `readAxTree(wcId)` afterward. | Selecting Settings **closes the menu** and **does nothing else** — tab count is unchanged from Step 1, no new tab opened, no navigation occurred (Settings is a placeholder until the internal-page mechanism lands in a later flight). No error/crash. |
| 9 | **Focus-ring visibility:** establish a focus anchor via `click(wcId, x, y)` on the toolbar; tab to the kebab button via `pressKey(wcId, 'Tab')`; capture an unfocused `captureWindow()` before (or unfocus after), then a focused screenshot. | While focused, the kebab button shows a **visible focus indicator** against the dark toolbar background — a focused-vs-unfocused `captureWindow()` shows a clear ring/outline delta, NOT `outline:none` and NOT an invisible ring. [a11y] |
| 10 | **Exit item present (do NOT commit):** open the menu (locate via `captureWindow()` and `click(wcId, x, y)`); call `readAxTree(wcId)` to confirm the **Exit** item's accessible name and that it is keyboard-reachable. **Do not activate it** (activation quits the app and ends the run). | The Exit item is present, has accessible name "Exit", and is reachable/focusable by keyboard (`pressKey(wcId, 'ArrowDown')` reaches it). Its quit behavior (SC4) is verified **manually**, outside this test. [a11y] |
| 11 | **Menu mutual exclusion:** open the container (`▾`) menu (locate via `captureWindow()` and `click(wcId, x, y)` on `#new-tab-menu`); confirm it is open via `readAxTree(wcId)`. Then open the kebab menu (locate via `captureWindow()` and `click(wcId, x, y)` on the kebab). Read both menus' open state via `readAxTree(wcId)`. Then, with the kebab menu open, open the container menu again and re-read both. *(Note: the container menu is built dynamically and has no `role="menu"`; read its open-state authoritatively from `#new-tab-menu`'s `aria-expanded`, and the kebab's from its `aria-expanded`/hidden state in `readAxTree(wcId)` or `readDom(wcId)`.)* | Opening the kebab **closes the open container menu** (`#new-tab-menu` `aria-expanded="false"`, kebab open); and conversely, opening the container menu **closes the open kebab menu** (kebab `aria-expanded="false"`/hidden, container open). The two menus are never open simultaneously. |
| 12 | **Tab closes the kebab menu + restores focus:** open the kebab menu (focus is on the first item); then call `pressKey(wcId, 'Tab')`. Call `readAxTree(wcId)` to read the menu's open state, `aria-expanded`, and focused node. (Optionally repeat with `pressKey(wcId, 'ShiftTab')`.) | `Tab` (and `Shift+Tab`) **closes the kebab menu** (`aria-expanded="false"`, hidden) and **restores focus to the kebab trigger** (the focused node in `readAxTree(wcId)` is the kebab button), not stranded on a now-hidden menuitem or `<body>`. [a11y] |

**Row conventions:** one row = one checkpoint. `[a11y]` flags accessibility-relevant checks for the
optional Accessibility Validator.

## Out of Scope

- **Exit actually terminating the app** (SC4) — not MCP-observable (tears down the harness); manual.
- **Settings opening a page** (SC5/SC6/SC7) — the `goldfinch://` mechanism and the settings page do
  not exist yet; covered by later flights (extends `tab-scheme-guard.md` / new specs).
- Tab-strip controls, the golden pill, responsive sizing, and window controls — `unified-tab-controls.md`,
  `responsive-tab-strip.md`, `tab-keyboard-operability.md`.
- The hostile-scheme guard on tab creation — `tab-scheme-guard.md`.

## Variants (optional)

- Could parametrize Step 5 across a future menu with >2 items to exercise multi-step roving + wrap
  more thoroughly (with two items, ArrowDown/ArrowUp/Home/End cover the space).

> Note: `Tab`/`Shift+Tab` closing the menu is now a first-class checkpoint (Step 12), and menu
> mutual-exclusion is Step 11 — both added after the operator's HAT pass.
