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

- Goldfinch is running via `npm run dev:debug` (exposes `--remote-debugging-port=9222
  --remote-allow-origins=*`, `--no-sandbox`). The apparatus must **attach to this
  already-running instance's `:9222`, never launch a fresh browser** (a fresh browser has none of
  the app's chrome). Qualifying clients: the **Playwright MCP** registered in `.mcp.json` with
  `--cdp-endpoint http://127.0.0.1:9222`, or a **raw CDP-over-Node-WebSocket** client. **The
  `chrome-devtools` MCP does NOT qualify — it launches its own browser** (the standing Goldfinch
  false-pass trap).
- **This test drives the renderer (the Goldfinch chrome UI), NOT a `<webview>` guest** — the pill
  and tab strip live in the chrome renderer. Select the top-level Goldfinch window target whose
  URL is the renderer `index.html`, not `about:blank`/`http(s)` guest pages.
- Input must be delivered as **trusted events** (CDP `Input.dispatchMouseEvent` /
  `Input.dispatchKeyEvent`, or MCP `click`/`press_key`), not synthetic `dispatchEvent` — only
  trusted events fire the renderer's real click/keydown handlers and native focus traversal.
- **Active precondition probe** (Step 1): confirm `:9222` answers and a renderer target is present
  before exercising anything.

## Observables Required

- browser (DOM + a11y tree + rendered pixels — measured via a CDP client **attached to the app's
  `:9222`**): tab count (number of `.tab` elements / `role="tab"` nodes in the `tablist`); the
  presence and `aria-label` of the pill's `+` and `▾` controls; the `▾` control's
  `aria-expanded`; the container menu's items and focus; the newly-created tab's **jar dot**
  (`.tab-jar`, present only for non-default containers) as the witness that a tab opened *in a
  container*; `document.activeElement`; and **screenshots** for the focus-ring delta (a
  rendered-pixel property the a11y tree can't attest).
- shell (precondition probe: `:9222` reachability — measured via Bash/curl).

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Probe: `curl http://127.0.0.1:9222/json`. Identify the **renderer** target (Goldfinch window whose URL is the local `index.html`). Note the current tab count. | `:9222` responds and a renderer target is listed. Tab count is recorded. If `:9222` is dead or only guest targets exist, halt — preconditions not met. |
| 2 | Inspect the control region **immediately to the right of the open tabs** (between the tabs and the draggable region / window controls). | A single **pill-shaped control with the golden (`--accent`) background** sits **immediately to the right of the open tabs** (adjacent/hugging them, left-aligned in the strip — not at the far-right window-controls end). It contains two operable controls: a **new-tab** button (accessible name ≈ "New tab") and a **container/menu** button (accessible name ≈ "New tab in a container", `aria-haspopup="menu"`, `aria-expanded="false"`). [a11y] |
| 3 | **Mouse — new tab:** click the `+` (new-tab) control. | Tab count increases by exactly one; the new tab becomes active. The new tab has **no** jar dot (default container). |
| 4 | **Mouse — container tab:** click the `▾` (container) control; in the menu that opens, click a **named container** entry (not the default). | The `▾` control's `aria-expanded` was `true` while the menu was open; choosing a container opens a new tab whose strip button shows a **jar dot** (`.tab-jar`) matching that container's color. Tab count increased by one. |
| 5 | **Keyboard — new tab:** move focus to the `+` control via `Tab`/`Shift+Tab` (trusted key events). Confirm focus, then activate with `Enter` (and/or `Space`). | While focused, the `+` control shows a **visible focus indicator that contrasts against the golden fill** — a focused-vs-unfocused screenshot shows a clear ring/outline delta (≥3:1 against the gold), NOT a gold-on-gold (invisible) ring and NOT `outline:none`. Activation opens one new tab. [a11y] |
| 6 | **Keyboard — container tab:** focus the `▾` control; press `Enter` to open the menu; observe focus lands in the menu; navigate to a named container with the keyboard and activate it (`Enter`). | Opening the menu by keyboard moves focus into it (first item focused); `aria-expanded` becomes `true`; activating a container entry opens a new tab with that container's **jar dot**. Focus is never stranded on `<body>`. [a11y] |
| 7 | **Keyboard — menu dismiss/focus restore:** open the `▾` menu again, then press `Escape`. | The menu closes, `aria-expanded` returns to `false`, and focus is **restored to the `▾` trigger** (not lost to `<body>`). [a11y] |
| 8 | **Regression guard — tab-strip contract intact:** read the strip structure from the a11y tree (the pill controls sit *outside* the `tablist`). | The strip is still a single `tablist` containing exactly the live tabs as `tab` children with exactly one `aria-selected="true"`; the pill's `+`/`▾` are **not** members of the `tablist`. (Confirms the pill restructure didn't fold non-tab controls into the tablist; full keyboard-nav coverage remains `tab-keyboard-operability.md`.) [a11y] |

**Row conventions:** one row = one checkpoint. `[a11y]` flags accessibility-relevant checks for
the optional Accessibility Validator.

## Out of Scope

- Tab **shrink/grow** sizing, the scroll fallback, **deferred resize-on-close**, and the
  **maximize/restore** window-state read path — covered by `responsive-tab-strip.md`.
- Full tab-strip **keyboard navigation** (Arrow/Home/End/Delete, roving tabindex, close-button
  names) — covered by `tab-keyboard-operability.md`; this spec only asserts the pill sits outside
  the tablist (Step 8).
- Window **drag-to-move** and **Close** — not CDP-drivable / harness-destructive; manual.
- The hostile-scheme guard on tab creation — `tab-scheme-guard.md`.

## Variants (optional)

- Could parametrize Step 4/6 across multiple containers (default, a user jar, burner) to confirm
  each opens with the correct dot.
