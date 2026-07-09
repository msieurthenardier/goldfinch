# Behavior Test: Kebab (⋮) overflow menu — presence, four items, APG keyboard operation

**Slug**: `kebab-menu`
**Status**: active
**Created**: 2026-06-06
**Last Run**: 2026-06-07-10-42-52

> **Updated 2026-07-02 (F8 Leg 5b).** Since the Flight-8 cutover the kebab menu renders from the
> **menu-overlay sheet** (a separate transparent `WebContentsView`), not the chrome DOM — menu
> DOM/AX reads move from the chrome `wcId` to the **probed sheet `wcId`**; the trigger's
> `aria-expanded` stays a **chrome-side** read. The menu has carried **four items** since M04
> (Settings, Downloads, Print…, Exit — the original "exactly two" pin was stale), and Settings/
> Downloads now open real trusted internal tabs (the "Settings is inert placeholder" step inverted).

## Intent

Verify that Goldfinch's kebab (⋮) overflow menu — a `<button>` in the **toolbar row, immediately to
the right of the Shield button** — opens a menu exposing **exactly four items, "Settings",
"Downloads", "Print…", and "Exit"**, and that the menu follows the WAI-ARIA APG **menu-button**
pattern: it opens by mouse and by keyboard, focus management and arrow-key navigation work, `Escape`
closes and restores focus to the trigger, and clicking outside closes it. It also confirms the
trigger carries a **visible keyboard focus indicator**. This needs a behavior test rather than a unit
test because the properties under test are *real pointer/keyboard input driving the running Electron
chrome + the sheet view* (trusted clicks, trusted key delivery, the cross-view open/focus/Escape
cycle) and a *rendered-pixel* focus-ring delta — neither a jsdom DOM-attribute check nor synthetic
events faithfully model "a user can actually open this menu, navigate it by keyboard, and see where
focus is." (Mission SC3 + SC8; menu substrate re-verified across the F8 sheet cutover.)

**Not covered here (by design):** **Exit** actually quitting the app (SC4) is **manual** — calling
`app.quit()` tears down the test harness, so it cannot be witnessed; this test only confirms the Exit
item is present and selectable. **Print…** firing the OS print dialog is verified only by its
menu-side observables (menu closes, `aria-expanded` resets) — see the Print modal-dialog trap below.

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
  key is refused `getChromeTarget` (`admin-only`), cannot drive the chrome renderer, and cannot
  resolve the sheet's wcId (non-tab wcIds resolve only at the admin tier).
- **Two targets — chrome + sheet.** The kebab **trigger** (and its `aria-expanded`) lives in the
  chrome renderer (`getChromeTarget()` → chrome `wcId`); the **open menu** renders in the
  menu-overlay sheet — a separate `WebContentsView` addressed by **probed wcId**.
- **Sheet wcId discovery (background-tab-safe probe walk — F8 Leg-5 lesson).** The sheet is NOT in
  `enumerateTabs`; probe the small id-space around the known ids (`readDom(id)` returning the
  `menu-overlay.html` markup identifies it), **skipping every `enumerateTabs` wcId and the chrome
  wcId** — `readDom`/`evaluate` are foreground-first, so probing a background tab activates it,
  firing a tab-switch close of the menu under test. The sheet materializes lazily on first menu
  open; probe after the first open. Discover once per run.
- **Sheet menuitem activation nuance (F8 Leg-3 lesson):** `pressKey(sheetWcId, 'Enter')` on a
  focused sheet menuitem does NOT synthesize the DOM `click` a real Enter does in this multi-view
  context — scripted activation is `click(sheetWcId, x, y)` on the item, or arrow-focus +
  `evaluate(sheetWcId, 'document.activeElement.click()')`. Real-keyboard Enter activation is
  HAT-covered.
- Input must be delivered as **trusted events** via the MCP tools (`click(wcId, x, y)`,
  `pressKey(wcId, name)`) — only trusted events fire the real click/keydown handlers and native
  focus traversal.
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
- **Print modal-dialog trap (F8 Leg-2 anomaly):** activating **Print…** fires `wc.print()`, which
  opens a **blocking OS print dialog** (GTK on this rig) that is **not MCP-dismissable** — the guest
  renderer blocks until the tab (and its dialog) is destroyed. If Print activation is exercised at
  all, verify it via the menu-side observables only (menu closed, kebab `aria-expanded` reset) and
  recover by closing that tab — **never leave the dialog up**. Prefer asserting Print… as
  present/selectable, like Exit.
- **Active precondition probe** (Step 1): confirm `tools/list` includes (presence-checked, not an exact count) the tools this spec drives: `getChromeTarget`,
  and `getChromeTarget()` returns a numeric chrome `wcId` before exercising anything.
- **Apparatus disqualification:** the `chrome-devtools` MCP does **NOT** qualify — it launches its
  own browser and never touches this app (the standing Goldfinch false-pass trap). The apparatus is
  the SDK admin MCP client over `127.0.0.1:$GOLDFINCH_MCP_PORT`, app launched via
  `npm run dev:automation`. This is **not** the CDP attach path — `npm run dev:automation` does not
  expose a DevTools port; only the admin MCP surface is used.

## Observables Required

- mcp (admin MCP tools):
  - **Chrome `wcId`** (`getChromeTarget`): the kebab button's presence, accessible name
    (≈ "More" / "Menu"), `aria-haspopup="menu"`, `aria-expanded` (the open/closed authority) via
    `readAxTree(chromeWcId)`; the toolbar position located via a `captureWindow()` screenshot (right
    of the Shield button, the last interactive control in the toolbar); the focused node for
    Escape-restores-to-trigger and the focus-ring step; the address-chip `data-state` via
    `readDom(chromeWcId)` (the Settings-opens-internal observable — internal tabs are not in
    `enumerateTabs`).
  - **Sheet `wcId`** (probed): the open menu — `#sheet-menu` `data-menu-type="kebab"` with
    **`role="menu"`**; the menu items (count = **exactly 4**, each `role="menuitem"`) and their
    accessible names ("Settings", "Downloads", "Print…", "Exit"); roving tabindex / focused item for
    focus-on-open and arrow roving — via `readDom(sheetWcId)` / `readAxTree(sheetWcId)`. **Sheet DOM
    persisting after close is expected** (lazy singleton); "menu closed" is judged by the chrome
    `aria-expanded="false"` + pixels, never by sheet DOM absence.
  - The live tab count from `enumerateTabs` (Settings/Downloads open internal tabs, which do NOT
    appear there — the count is a negative control), and `captureWindow()` /
    `captureScreenshot(wcId)` screenshots for the focus-ring delta — a rendered-pixel property the
    a11y tree can't attest.
- shell (precondition probe: `tools/list` count and `getChromeTarget` result — measured via the MCP
  client or Bash)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the admin MCP client; call `tools/list`; then call `getChromeTarget()`. Note the current tab count (via `enumerateTabs`). | `tools/list` **includes** (presence-checked, not an exact count) the tools this spec drives: `getChromeTarget`. `getChromeTarget()` returns `{ wcId, kind: 'chrome', url }` where `wcId` is a **numeric** chrome identifier. Record `wcId` and the tab count. If not, halt — preconditions not met. |
| 2 | Take a `captureWindow()` screenshot; locate and inspect the **toolbar row** (the row with the address bar, Media, and Shield buttons) and the kebab control. Confirm via `readAxTree(chromeWcId)`. | A single **kebab (⋮) button** sits **immediately to the right of the Shield button** as the **last interactive control in the toolbar** — its left edge is at/after the Shield button's right edge. It has an accessible name, `aria-haspopup="menu"`, and `aria-expanded="false"`. [a11y] |
| 3 | **Mouse — open:** take a `captureWindow()` screenshot; locate the kebab button's coordinates; call `click(chromeWcId, x, y)`. Probe the sheet's wcId if not yet known (see Preconditions). Then read `readAxTree(chromeWcId)` (trigger) and `readDom(sheetWcId)` (menu). | The menu opens: the chrome trigger's `aria-expanded` becomes `true`; the sheet renders `#sheet-menu` with **`role="menu"`** containing **exactly four `role="menuitem"` items**, with accessible names **"Settings"**, **"Downloads"**, **"Print…"**, **"Exit"** (in that order). No fifth item. The menu is composited over the live guest in `captureWindow()`. [a11y] |
| 4 | **Focus on open:** with the menu open (reopen if needed: focus the kebab and `pressKey(chromeWcId, 'Enter')` — trigger-side keydown is chrome-owned), read the sheet's roving state via `readDom(sheetWcId)`. | Opening the menu moves focus **into the menu** — the first item ("Settings") is the focused/roving item (`tabindex="0"`, focused) in the sheet document. Focus is never stranded on `<body>`. [a11y] |
| 5 | **Keyboard — arrow navigation:** with the menu open and the first item focused, call `pressKey(sheetWcId, 'ArrowDown')` three times, then `pressKey(sheetWcId, 'ArrowUp')`; read the sheet's roving state after each. Also call `pressKey(sheetWcId, 'Home')` and `pressKey(sheetWcId, 'End')`. | `ArrowDown` moves focus Settings → Downloads → Print… → Exit; a further `ArrowDown` wraps to Settings (record the wrap); `ArrowUp` moves back up (wrapping from Settings to Exit). `Home` focuses Settings; `End` focuses Exit. Focus stays within the four menu items throughout per the sheet reads. [a11y] |
| 6 | **Keyboard — Escape closes + restores focus:** with the menu open, call `pressKey(sheetWcId, 'Escape')`. Then call `readAxTree(chromeWcId)`. | The menu closes; the chrome trigger's `aria-expanded` returns to `false`; focus is **restored to the kebab trigger** in the chrome (not lost to `<body>`) per the focused node in `readAxTree(chromeWcId)` — corroborate with a chrome `document.hasFocus()` eval (true on chrome after Escape). [a11y] |
| 7 | **Mouse — click-outside closes:** open the menu again (locate the kebab and `click(chromeWcId, x, y)`), then `click(sheetWcId, x, y)` at a point in the guest region **outside the menu rect**. Read `readAxTree(chromeWcId)` + `captureWindow()`. | The menu closes (`aria-expanded="false"`, menu gone from the pixels) and the outside click is swallowed (no page action — `menu-dismissal.md` owns the full swallow contract). |
| 8 | **Settings opens the internal settings tab:** note the tab count; open the menu; activate the **Settings** item (click its sheet coordinates, or arrow-focus + `evaluate(sheetWcId, 'document.activeElement.click()')` — see the activation nuance). Read the chrome address chip via `readDom(chromeWcId)` and take a `captureWindow()`. | Selecting Settings **closes the menu** and **opens/activates the trusted internal `goldfinch://settings` tab**: the address chip shows `data-state="internal"` and the Settings page renders in the guest region (pixels). The internal tab does NOT appear in `enumerateTabs` (internal-session exclusion — the unchanged tab count there is expected, not a "nothing happened" tell). No error/crash. *(This inverts the pre-M04 "Settings is inert placeholder" assertion — Settings has been a real internal page since the `goldfinch://` mechanism landed.)* |
| 9 | **Focus-ring visibility:** establish a focus anchor via `click(chromeWcId, x, y)` on the toolbar; tab to the kebab button via `pressKey(chromeWcId, 'Tab')`; capture an unfocused `captureWindow()` before (or unfocus after), then a focused screenshot. | While focused, the kebab button shows a **visible focus indicator** against the dark toolbar background — a focused-vs-unfocused `captureWindow()` shows a clear ring/outline delta, NOT `outline:none` and NOT an invisible ring. [a11y] |
| 10 | **Exit + Print… present (do NOT commit):** open the menu; call `readDom(sheetWcId)` to confirm the **Exit** and **Print…** items' accessible names and that they are keyboard-reachable (`pressKey(sheetWcId, 'End')` roves to Exit). **Do not activate Exit** (quits the app) and **do not leave a Print dialog up** (the Print modal-dialog trap — see Preconditions). | Exit and Print… are present with correct accessible names and reachable by keyboard roving. Exit's quit behavior (SC4) is verified **manually**; Print's dialog render is HAT/manual — its scripted verification, if attempted, is menu-side observables only. [a11y] |
| 11 | **Menu mutual exclusion:** open the container (`▾`) menu (locate via `captureWindow()` and `click(chromeWcId, x, y)` on `#new-tab-menu`); confirm open via `readAxTree(chromeWcId)` + the sheet's `data-menu-type="container"`. Then open the kebab menu (`click(chromeWcId, x, y)`). Read both triggers' `aria-expanded` + the sheet's `data-menu-type`. Then, with the kebab open, open the container again and re-read. | Opening the kebab **closes the container menu** (`#new-tab-menu` `aria-expanded="false"`, kebab open, sheet now `data-menu-type="kebab"` — a model-replace swap); and conversely. The two menus are never open simultaneously (one sheet, one menu at a time). |
| 12 | **Tab closes the kebab menu + restores focus:** open the kebab menu (focus is on the first item); then call `pressKey(sheetWcId, 'Tab')`. Read the chrome via `readAxTree(chromeWcId)`. (Optionally repeat with Shift+Tab.) | `Tab` (and `Shift+Tab`) **closes the kebab menu** (chrome `aria-expanded="false"`, menu gone from pixels) and **restores focus to the kebab trigger** in the chrome (the focused node in `readAxTree(chromeWcId)` is the kebab button), not stranded in the hidden sheet or on `<body>`. [a11y] |

**Row conventions:** one row = one checkpoint. `[a11y]` flags accessibility-relevant checks for the
optional Accessibility Validator. Trigger state (`aria-expanded`, focus-return) reads the **chrome**
`wcId`; menu structure/roving reads the **sheet** `wcId`; menu-closed judgments use the chrome
`aria-expanded` + pixels (sheet DOM persists hidden by design).

## Out of Scope

- **Exit actually terminating the app** (SC4) — not MCP-observable (tears down the harness); manual.
- **The Settings/Downloads pages' own content and behavior** — `settings-shell.md`,
  `settings-controls.md`, `downloads-surface.md`; the internal trust boundary —
  `tab-scheme-guard.md` / `internal-session-exclusion.md`.
- **The Print dialog's render and print output** — blocking OS dialog, not MCP-drivable (the Print
  modal-dialog trap); `print-to-pdf.md` covers the automation-surface print path.
- **The sheet mechanism itself** (live-guest compositing, click-swallow, find interplay) —
  `menu-overlay.md`; dismissal semantics across menus — `menu-dismissal.md`.
- Tab-strip controls, the golden pill, responsive sizing, and window controls — `unified-tab-controls.md`,
  `responsive-tab-strip.md`, `tab-keyboard-operability.md`.
- The hostile-scheme guard on tab creation — `tab-scheme-guard.md`.

## Variants (optional)

- **Downloads item:** repeat Step 8 activating **Downloads** — the second trusted internal tab
  (`goldfinch://downloads`; also reachable via `Ctrl+J`), same address-chip `data-state="internal"`
  observable.

> Note: `Tab`/`Shift+Tab` closing the menu is a first-class checkpoint (Step 12), and menu
> mutual-exclusion is Step 11 — both added after the operator's HAT pass. Step 8 was inverted at the
> F8 Leg-5b re-spec (Settings stopped being a placeholder back in M04; the step now asserts the
> trusted internal-tab open).
