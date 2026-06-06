# Behavior Test: Tab strip is keyboard- and screen-reader-operable

**Slug**: `tab-keyboard-operability`
**Status**: active
**Created**: 2026-06-06
**Last Run**: 2026-06-06-16-38-47 (PASS — 7/7 checkpoints; see runs/2026-06-06-16-38-47.md)

## Intent

Verify that a keyboard-only / screen-reader user can operate the Goldfinch tab strip: focus a tab, move focus and the active tab with the arrow keys (and Home/End), close a tab with the keyboard, and that assistive tech sees correct ARIA semantics (a `tablist` containing `tab`s, exactly one `aria-selected`, each tab's close control a `button` with a meaningful accessible name). This needs a behavior test rather than a unit test because the property under test is *real keyboard input driving native focus traversal and the renderer's keydown handlers inside the running Electron chrome*, observed through the *accessibility tree and rendered focus ring* — neither the synthetic key dispatch a jsdom unit test can do, nor a DOM-attribute check, faithfully models "a keyboard user can actually switch tabs and an AT actually announces them." (F22 — mission criterion, named regression gate in maintenance/2026-06-05.md.)

## Preconditions

- Goldfinch is running via `npm run dev:debug` (exposes `--remote-debugging-port=9222 --remote-allow-origins=*`, `--no-sandbox`). The apparatus must **attach to this already-running instance's `:9222`, never launch a fresh browser** (a fresh browser has none of the app's tabs). Qualifying clients: the **Playwright MCP** registered in `.mcp.json` with `--cdp-endpoint http://127.0.0.1:9222` (attaches), or a **raw CDP-over-Node-WebSocket** client (as used in prior Goldfinch runs). **The `chrome-devtools` MCP does NOT qualify — it launches its own browser.**
- **This test drives the renderer (the Goldfinch chrome UI), NOT a `<webview>` guest target** — the tab strip lives in the chrome renderer. Selecting a guest target is the #1 false-pass trap (see prior Electron behavior-test runs); the apparatus must select the top-level Goldfinch window target whose URL is the renderer `index.html`, not `about:blank`/`http(s)` guest pages.
- Keys must be delivered as **trusted input events** (CDP `Input.dispatchKeyEvent` / MCP `press_key`), not synthetic `dispatchEvent`/`Runtime.evaluate` KeyboardEvents — only trusted events drive native focus traversal (Tab) and fire the renderer's real keydown handlers. A spec run that synthesizes events in-page will not exercise the actual keyboard path and may false-pass or false-fail.
- **Active precondition probe** (Step 1): confirm `:9222` answers and a renderer target is present before exercising anything — a dead devtools port otherwise surfaces as a confusing mid-test cascade.
- The test operates on the chrome's own tab strip; no login is needed. Step 2 navigates the setup tabs to **distinct** URLs so that tab activation is observable (identical-URL tabs would make the address bar non-discriminating). The load-bearing discriminators are the **address-bar value + `aria-selected` + `document.activeElement`**, which hold regardless of whether the pages fully render; the "active web content changes" check is corroborating. Use distinct **local** targets if the environment is offline (e.g. the served HTTP fixture's `?n=1/2/3`, or `about:blank` variants) rather than public sites — no external network is required for the assertions.

## Observables Required

- browser (accessibility tree — `tablist`/`tab` roles, `aria-selected`, accessible names; the focused element; the visible focus ring — measured via a CDP client **attached to the app's `:9222`** (Playwright MCP `--cdp-endpoint` or raw CDP): the a11y tree (`Accessibility.getFullAXTree` / MCP `snapshot`) and `document.activeElement` as the contract for AT, **plus a screenshot as primary evidence for the visible focus indicator** since focus visibility is a rendered-pixel property the a11y tree can't attest — the Validator should compare a focused-vs-unfocused screenshot to confirm a visible focus *delta*, not merely that a ring exists in one frame). DOM `tabindex`/`aria-*` reads are supplementary diagnostic only.
- shell (precondition probe: `:9222` reachability — measured via Bash/curl).

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Probe the environment: `curl http://127.0.0.1:9222/json`. Identify the **renderer** target (the Goldfinch window whose URL is the local `index.html`). | `:9222` responds and a renderer target is listed. If not, halt — preconditions not met. |
| 2 | Open at least **three** tabs and navigate each to a URL whose **address-bar value stays distinct** so the active tab is observable. Pick targets that don't normalize/redirect to a shared address — distinct public pages, or distinct local fixture *pages/paths*. **Avoid `?query` on a server that ignores it** (e.g. a SPA that strips the query and serves one shell — the 2026-06-06 run hit this with a Concourse instance on `:8080`, collapsing all three fixture tabs to the same address and title, which weakened Step 4's middle-tab traversal). | (setup row, no judgment) |
| 3 | Move keyboard focus onto the tab strip: send `Tab` (and/or `Shift+Tab`) presses until a tab in the strip is the focused element. | The focused element is a control with role `tab` (visible in the a11y tree as a `tab` inside a `tablist`). A **visible focus indicator** is rendered on that tab — a focused-vs-unfocused screenshot shows a clear focus ring/outline delta (≥3:1 against its background); `outline:none`-with-no-replacement fails this step. [a11y] |
| 4 | With a tab focused, press `ArrowRight`. Then `ArrowLeft`. Then `Home`, then `End`. | Each arrow press moves focus to the adjacent tab and **activates** it: the a11y tree shows the focused tab and that exactly **one** tab has `aria-selected="true"` (the focused one); the active web content **and the address-bar value** change to match the newly selected tab's distinct URL. `Home`/`End` jump to the first/last tab. No press leaves focus stranded on `<body>`. [a11y] |
| 5 | Note the current tab count, then close the focused tab from the keyboard (press `Delete` — or `Backspace` — while a tab is focused). | The focused tab is removed (tab count decreases by one); focus moves to a sibling **tab** (not lost to `<body>`); a remaining tab is selected (`aria-selected="true"`) and its content is active. The window is never left with zero tabs. [a11y] |
| 6 | Inspect each tab's close affordance in the accessibility tree. | Each tab's close control is exposed as a **`button`** with a meaningful accessible name that identifies its tab (e.g. matching `/close tab/i` and including the tab's title), not an unnamed/`generic` element; the close shortcut is discoverable (e.g. `aria-keyshortcuts="Delete"` on the tab or an SR-instructions element). [a11y] |
| 7 | Read the strip's overall structure from the a11y tree. | The strip is a single `tablist` containing exactly the live tabs as `tab` children; exactly one is `selected`; the focused tab is reachable as the roving-tabindex entry (tabbing into the strip lands on the selected tab, not the first DOM node). [a11y] |
| 8 | **Negative / no-hijack:** click the address bar (`#address`) to focus it, then press `ArrowRight`/`ArrowLeft`/`Delete`. Then focus the active `<webview>` content and press `Delete`. | Tab selection and tab count are **unchanged** — the arrow/Delete tab handlers are scoped to the strip and do not fire while the address bar or web content has focus. (Guards against a `document`-level handler hijacking global input.) |

## Out of Scope

- Accessible names of the **toolbar / media-card / player / Shields** controls and the global `:focus-visible` coverage beyond the tab strip — those are F23, verified by the axe-core audit (`npm run a11y`) and the F23 leg, not this spec.
- F24 items (reduced-motion, live regions, `role="dialog"`, landmarks, contrast, color-independent cues) — verified by the axe audit + the F24 legs.
- The hostile-scheme guard on tab creation — covered by `tab-scheme-guard.md`.
- Mouse/pointer tab activation and close — the existing click path is unchanged; this spec is scoped to the *keyboard/AT* contract.

## Variants (optional)

- N/A for the draft. Could later parametrize the activation model (manual activation via Enter/Space) if the automatic-activation decision is revisited.
