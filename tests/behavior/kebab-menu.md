# Behavior Test: Kebab (⋮) overflow menu — presence, two items, APG keyboard operation

**Slug**: `kebab-menu`
**Status**: draft
**Created**: 2026-06-06
**Last Run**: never

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

- Goldfinch is running via `npm run dev:debug` (exposes `--remote-debugging-port=9222
  --remote-allow-origins=*`, `--no-sandbox`). The apparatus must **attach to this already-running
  instance's `:9222`, never launch a fresh browser** (a fresh browser has none of the app's chrome).
  Qualifying clients: the committed **`scripts/cdp-driver.mjs`** (raw CDP-over-WebSocket, trusted
  `Input.dispatch*`, attach-don't-launch), or the **Playwright MCP** registered in `.mcp.json` with
  `--cdp-endpoint http://127.0.0.1:9222`. **The `chrome-devtools` MCP does NOT qualify — it launches
  its own browser** (the standing Goldfinch false-pass trap).
- **This test drives the renderer (the Goldfinch chrome UI), NOT a `<webview>` guest** — the toolbar
  and kebab live in the chrome renderer. Select the top-level Goldfinch window target whose URL is
  the renderer `index.html`, not `about:blank`/`http(s)` guest pages.
- Input must be delivered as **trusted events** (CDP `Input.dispatchMouseEvent` /
  `Input.dispatchKeyEvent`, or MCP `click`/`press_key`), not synthetic `dispatchEvent` — only trusted
  events fire the renderer's real click/keydown handlers and native focus traversal.
- **Do NOT select the Exit item with a committing activation** (it quits the app and ends the run).
  Exit is asserted as *present/selectable only*; its quit effect is verified manually outside this test.
- **Active precondition probe** (Step 1): confirm `:9222` answers and a renderer target is present
  before exercising anything.

## Observables Required

- browser (DOM + a11y tree + rendered pixels — measured via a CDP client **attached to the app's
  `:9222`**): the kebab button's presence, accessible name (≈ "More" / "Menu"), `aria-haspopup="menu"`,
  and `aria-expanded`; its toolbar position via `getBoundingClientRect` (right of `#toggle-privacy`,
  the last interactive control in `#toolbar`); the popup's open state (visible / not `.hidden`) and
  its **`role="menu"`**; the menu items (count = **exactly 2**, each `role="menuitem"`) and their
  accessible names ("Settings", "Exit"); `document.activeElement`
  for focus-on-open, arrow roving, and Escape-restores-to-trigger; the live tab count (to confirm the
  inert Settings selection changes nothing); and **screenshots** for the focus-ring delta (a
  rendered-pixel property the a11y tree can't attest).
- shell (precondition probe: `:9222` reachability — measured via Bash/curl or
  `node scripts/cdp-driver.mjs eval '1+1'`).

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Probe: `curl http://127.0.0.1:9222/json` (or `node scripts/cdp-driver.mjs eval '1+1'`). Identify the **renderer** target (Goldfinch window whose URL is the local `index.html`). Note the current tab count. | `:9222` responds and a renderer target is listed; the apparatus is attach-capable. Tab count recorded. If `:9222` is dead or only guest targets exist, halt — preconditions not met. |
| 2 | Inspect the **toolbar row** (the row with the address bar, Media, and Shield buttons). Locate the kebab control. | A single **kebab (⋮) button** sits **immediately to the right of the Shield button** (`#toggle-privacy`) as the **last interactive control in the toolbar** — its left edge is at/after the Shield button's right edge. It has an accessible name, `aria-haspopup="menu"`, and `aria-expanded="false"`. [a11y] |
| 3 | **Mouse — open:** click the kebab button. | The menu opens: `aria-expanded` becomes `true`; a popup with **`role="menu"`** appears containing **exactly two `role="menuitem"` items**, with accessible names **"Settings"** and **"Exit"** (in that order). No third item. [a11y] |
| 4 | **Focus on open:** with the menu open (reopen by keyboard if Step 3 left it closed — focus the kebab via `Tab`, press `Enter`), read `document.activeElement`. | Opening the menu moves focus **into the menu** — the first item ("Settings") is focused. Focus is never stranded on `<body>`. [a11y] |
| 5 | **Keyboard — arrow navigation:** with the menu open and the first item focused, press `ArrowDown`, then `ArrowDown` again, then `ArrowUp`; observe `document.activeElement` after each. Also test `Home` and `End`. | `ArrowDown` moves focus Settings → Exit; a further `ArrowDown` wraps to Settings (or stays at Exit — record which; APG allows either, wrapping preferred); `ArrowUp` moves back up. `Home` focuses Settings; `End` focuses Exit. Focus stays within the two menu items throughout. [a11y] |
| 6 | **Keyboard — Escape closes + restores focus:** with the menu open, press `Escape`. | The menu closes; `aria-expanded` returns to `false`; focus is **restored to the kebab trigger** (not lost to `<body>`). [a11y] |
| 7 | **Mouse — click-outside closes:** open the menu again (click the kebab), then click somewhere outside the menu (e.g. the address bar or page area). | The menu closes and `aria-expanded` returns to `false`. |
| 8 | **Settings is present but inert:** open the menu, focus/select the **Settings** item (`Enter` or click). Read the tab count and the active tab's URL afterward. | Selecting Settings **closes the menu** and **does nothing else** — tab count is unchanged from Step 1, no new tab opened, no navigation occurred (Settings is a placeholder until the internal-page mechanism lands in a later flight). No error/crash. |
| 9 | **Focus-ring visibility:** move keyboard focus to the kebab button (via `Tab`); capture a focused screenshot and an unfocused screenshot of the button. | While focused, the kebab button shows a **visible focus indicator** against the dark toolbar background — a focused-vs-unfocused screenshot shows a clear ring/outline delta, NOT `outline:none` and NOT an invisible ring. [a11y] |
| 10 | **Exit item present (do NOT commit):** open the menu and confirm the **Exit** item is focusable/selectable, but **do not activate it** (activation quits the app and ends the run). Read its accessible name and that it is keyboard-reachable. | The Exit item is present, has accessible name "Exit", and is reachable/focusable by keyboard. Its quit behavior (SC4) is verified **manually**, outside this test. [a11y] |

**Row conventions:** one row = one checkpoint. `[a11y]` flags accessibility-relevant checks for the
optional Accessibility Validator.

## Out of Scope

- **Exit actually terminating the app** (SC4) — not CDP-observable (tears down the harness); manual.
- **Settings opening a page** (SC5/SC6/SC7) — the `goldfinch://` mechanism and the settings page do
  not exist yet; covered by later flights (extends `tab-scheme-guard.md` / new specs).
- Tab-strip controls, the golden pill, responsive sizing, and window controls — `unified-tab-controls.md`,
  `responsive-tab-strip.md`, `tab-keyboard-operability.md`.
- The hostile-scheme guard on tab creation — `tab-scheme-guard.md`.

## Variants (optional)

- Could parametrize Step 5 to also assert `Tab`/`Shift+Tab` behavior within the open menu if the APG
  implementation chooses to support it (APG menus typically use arrows, not Tab, for item movement).
