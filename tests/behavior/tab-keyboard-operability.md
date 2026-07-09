# Behavior Test: Tab strip is keyboard- and screen-reader-operable

**Slug**: `tab-keyboard-operability`
**Status**: active
**Created**: 2026-06-06
**Last Run**: 2026-06-07-01-14-27

## Intent

Verify that a keyboard-only / screen-reader user can operate the Goldfinch tab strip: focus a tab, move focus and the active tab with the arrow keys (and Home/End), close a tab with the keyboard, and that assistive tech sees correct ARIA semantics (a `tablist` containing `tab`s, exactly one `aria-selected`, each tab's close control a `button` with a meaningful accessible name). This needs a behavior test rather than a unit test because the property under test is *real keyboard input driving native focus traversal and the renderer's keydown handlers inside the running Electron chrome*, observed through the *accessibility tree and rendered focus ring* — neither the synthetic key dispatch a jsdom unit test can do, nor a DOM-attribute check, faithfully models "a keyboard user can actually switch tabs and an AT actually announces them." (F22 — mission criterion, named regression gate in maintenance/2026-06-05.md.)

## Preconditions

- **Apparatus — admin MCP surface.** Goldfinch is running via `npm run dev:automation` with `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_MCP_PORT=49707`. At launch, the app prints `AUTOMATION_DEV_MINT { "key": "...", "adminKey": "..." }` to stdout — capture the `adminKey`. The MCP server listens on `127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`.
- **Port (load-bearing for every URL below).** Pin the listen port via `GOLDFINCH_MCP_PORT` (default `49707`). Export it once at launch and reuse it in all SDK calls.
- **How the admin key attaches to the client (load-bearing).** Connect an admin MCP client (SDK `StreamableHTTPClientTransport`, `Authorization: Bearer <adminKey>`) on `127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`:
  ```js
  const port = process.env.GOLDFINCH_MCP_PORT || 49707;
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
    { requestInit: { headers: { Authorization: `Bearer ${adminKey}` } } }
  );
  ```
  The Bearer rides every request the transport sends. These specs require the **admin** key — a jar key is refused `getChromeTarget` (`admin-only`) and cannot drive the chrome renderer.
- **This test drives the renderer (the Goldfinch chrome UI), NOT a guest WebContentsView target** — the tab strip lives in the chrome renderer. `getChromeTarget()` returns the chrome `wcId` directly (no target-selection trap). All drive and observe calls pass this `wcId`.
- Input must be delivered as **trusted events** via the MCP tools (`pressKey(wcId, name)`, `click(wcId, x, y)`) — only trusted events drive native focus traversal (Tab) and fire the renderer's real keydown handlers.
- **Focus-anchor rule (apparatus rule from the leg-2 spike):** a cold `Tab` from the bare document does not relocate focus — this is normal browser behavior, NOT an engine defect. **Before any keyboard-only sequence, establish a focus anchor by sending a `click(wcId, x, y)` into the chrome first.** For the tab strip, clicking the address bar area (≈ (400, 63) at a 1400×900 window, confirmed by the leg-2 spike) anchors focus in the chrome before tabbing into the strip. Exact coordinates are environment/zoom-dependent; use a `captureWindow()` screenshot to locate controls and confirm the click landed.
- **Coordinate-click rule (apparatus rule from the leg-2 spike):** all clicks are coordinate-based — `click(wcId, x, y)` located via a `captureWindow()` screenshot. There are no CSS selectors over the MCP surface.
- **Active precondition probe** (Step 1): confirm `tools/list` includes (presence-checked, not an exact count) the tools this spec drives: `getChromeTarget`, and `getChromeTarget()` returns a numeric chrome `wcId` — a dead or jar-identity connection otherwise surfaces as a confusing mid-test cascade.
- The test operates on the chrome's own tab strip; no login is needed. Step 2 navigates the setup tabs to **distinct** URLs so that tab activation is observable (identical-URL tabs would make the address bar non-discriminating). The load-bearing discriminators are the **address-bar value + `aria-selected` + focused node in `readAxTree`**, which hold regardless of whether the pages fully render; the "active web content changes" check is corroborating. Use distinct **local** targets if the environment is offline (e.g. the served HTTP fixture's `?n=1/2/3`, or `about:blank` variants) rather than public sites — no external network is required for the assertions.
- **Apparatus disqualification:** the `chrome-devtools` MCP does **NOT** qualify — it launches its own browser and never touches this app (false pass). The apparatus is the SDK admin MCP client over `127.0.0.1:$GOLDFINCH_MCP_PORT`, app launched via `npm run dev:automation`. This is **not** the CDP attach path — `npm run dev:automation` does not expose a DevTools port; only the admin MCP surface is used.

## Observables Required

- mcp (admin MCP tools on the chrome `wcId` — `readAxTree(wcId)` for `tablist`/`tab` roles, `aria-selected`, accessible names, and the focused node via the `focused` property; `readDom(wcId)` for supplementary DOM reads; `captureWindow()` / `captureScreenshot(wcId)` as primary evidence for the visible focus ring — measured via the admin MCP client connected with the admin Bearer header. The Validator should compare a focused-vs-unfocused `captureWindow()` screenshot to confirm a visible focus *delta*, not merely that a ring exists in one frame.)
- shell (precondition probe: `tools/list` count and `getChromeTarget` result — measured via the MCP client or Bash).

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the admin MCP client; call `tools/list`; then call `getChromeTarget()`. | `tools/list` **includes** (presence-checked, not an exact count) the tools this spec drives: `getChromeTarget`. `getChromeTarget()` returns `{ wcId, kind: 'chrome', url }` where `wcId` is a **numeric** chrome identifier. Record `wcId`. If not, halt — preconditions not met. |
| 2 | Open at least **three** tabs and navigate each to a URL whose **address-bar value stays distinct** so the active tab is observable. Pick targets that don't normalize/redirect to a shared address — distinct public pages, or distinct local fixture *pages/paths*. **Avoid `?query` on a server that ignores it** (e.g. a SPA that strips the query and serves one shell — the 2026-06-06 run hit this with a Concourse instance on `:8080`, collapsing all three fixture tabs to the same address and title, which weakened Step 4's middle-tab traversal). | (setup row, no judgment) |
| 3 | **Establish a focus anchor, then move keyboard focus onto the tab strip.** First, take a `captureWindow()` screenshot and locate the address bar (≈ (400, 63) at 1400×900); send `click(wcId, 400, 63)` to anchor focus in the chrome. Then send `pressKey(wcId, 'Tab')` (and/or `pressKey(wcId, 'ShiftTab')`) presses until a tab in the strip is the focused element. Confirm via `readAxTree(wcId)`. | The focused node in `readAxTree(wcId)` is a control with role `tab` (visible in the a11y tree as a `tab` inside a `tablist`). A **visible focus indicator** is rendered on that tab — a focused-vs-unfocused `captureWindow()` screenshot shows a clear focus ring/outline delta (≥3:1 against its background); `outline:none`-with-no-replacement fails this step. [a11y] |
| 4 | With a tab focused, call `pressKey(wcId, 'ArrowRight')`. Then `pressKey(wcId, 'ArrowLeft')`. Then `pressKey(wcId, 'Home')`, then `pressKey(wcId, 'End')`. After each, call `readAxTree(wcId)`. | Each arrow press moves focus to the adjacent tab and **activates** it: `readAxTree(wcId)` shows the focused tab and that exactly **one** tab has `aria-selected="true"` (the focused one); the active web content **and the address-bar value** change to match the newly selected tab's distinct URL. `Home`/`End` jump to the first/last tab. No press leaves focus stranded on `<body>`. [a11y] |
| 5 | Note the current tab count, then close the focused tab from the keyboard: call `pressKey(wcId, 'Delete')` (or `pressKey(wcId, 'Backspace')`) while a tab is focused. | The focused tab is removed (tab count decreases by one); focus moves to a sibling **tab** (not lost to `<body>`) per `readAxTree(wcId)`; a remaining tab is selected (`aria-selected="true"`) and its content is active. The window is never left with zero tabs. [a11y] |
| 6 | Inspect each tab's close affordance via `readAxTree(wcId)`. | Each tab's close control is exposed as a **`button`** with a meaningful accessible name that identifies its tab (e.g. matching `/close tab/i` and including the tab's title), not an unnamed/`generic` element; the close shortcut is discoverable (e.g. `aria-keyshortcuts="Delete"` on the tab or an SR-instructions element). [a11y] |
| 7 | Read the strip's overall structure via `readAxTree(wcId)`. | The strip is a single `tablist` containing exactly the live tabs as `tab` children; exactly one is `selected`; the focused tab is reachable as the roving-tabindex entry (tabbing into the strip lands on the selected tab, not the first DOM node). [a11y] |
| 8 | **Negative / no-hijack:** take a `captureWindow()` screenshot to locate the address bar; call `click(wcId, x, y)` on the address bar coordinates (≈ (400, 63) at 1400×900) to focus it, then call `pressKey(wcId, 'ArrowRight')`, `pressKey(wcId, 'ArrowLeft')`, `pressKey(wcId, 'Delete')`. Then focus the active webview content (via a coordinate click on the page area) and call `pressKey(wcId, 'Delete')`. | Tab selection and tab count are **unchanged** — the arrow/Delete tab handlers are scoped to the strip and do not fire while the address bar or web content has focus. (Guards against a `document`-level handler hijacking global input.) |

## Out of Scope

- Accessible names of the **toolbar / media-card / player / Shields** controls and the global `:focus-visible` coverage beyond the tab strip — those are F23, verified by the axe-core audit (`npm run a11y`) and the F23 leg, not this spec.
- F24 items (reduced-motion, live regions, `role="dialog"`, landmarks, contrast, color-independent cues) — verified by the axe audit + the F24 legs.
- The hostile-scheme guard on tab creation — covered by `tab-scheme-guard.md`.
- Mouse/pointer tab activation and close — the existing click path is unchanged; this spec is scoped to the *keyboard/AT* contract.

## Variants (optional)

- N/A for the draft. Could later parametrize the activation model (manual activation via Enter/Space) if the automatic-activation decision is revisited.
