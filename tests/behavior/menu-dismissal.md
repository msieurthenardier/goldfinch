# Behavior Test: Menu dismissal — both menus close on any outside interaction

**Slug**: `menu-dismissal`
**Status**: active
**Created**: 2026-06-07
**Last Run**: 2026-06-07-11-58-01

## Intent

Verify that both of Goldfinch's dropdown menus — the kebab (`⋮`) overflow menu and the container (`▾`)
menu — **dismiss reliably on any outside interaction**: a click landing in the page `<webview>` (a
separate web-contents the chrome's `document` cannot observe), a click on the *other* menu's trigger,
and an in-chrome click elsewhere. It also confirms Escape + focus-restore still work and that the two
menus are never open simultaneously. This needs a behavior test because the properties under test are
*real focus/input crossing the chrome↔webview web-contents boundary* and live menu open/close state —
neither a jsdom check nor synthetic events model the `window`-blur-on-webview-focus path or trusted
cross-trigger clicks. (Flight 3; flight-local dismissal correctness + the shared-controller behavior;
SC8-adjacent for the container menu's APG uplift.)

## Preconditions

- **Apparatus — admin MCP surface.** Goldfinch is running via `npm run dev:automation` with
  `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_MCP_PORT=49707`. At launch, the
  app prints `AUTOMATION_DEV_MINT { "key": "...", "adminKey": "..." }` to stdout — capture the `adminKey`.
  The MCP server listens on `127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`.
- **Port (load-bearing for every URL below).** Pin the listen port via `GOLDFINCH_MCP_PORT` (default
  `49707`). Export it once at launch and reuse it in all SDK calls.
- **How the admin key attaches to the client (load-bearing).** Connect an admin MCP client (SDK
  `StreamableHTTPClientTransport`, `Authorization: Bearer <adminKey>`) on `127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`:
  ```js
  const port = process.env.GOLDFINCH_MCP_PORT || 49707;
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
    { requestInit: { headers: { Authorization: `Bearer ${adminKey}` } } }
  );
  ```
  The Bearer rides every request the transport sends. This spec requires the **admin** key — both the
  chrome renderer (`getChromeTarget`) and the guest webview (`enumerateTabs`) are needed.
- **This test drives the renderer (the Goldfinch chrome UI)** for the menu triggers and keyboard — both
  menus live in the chrome renderer. `getChromeTarget()` returns the chrome `wcId` directly (no
  target-selection trap). The **page-click dismissal path additionally targets the active guest webview**
  `wcId` (from `enumerateTabs`) — see the two-`wcId` note below.
- **At least one tab with a loaded `<webview>`** exists (the default homepage tab satisfies this) — the
  page-click / webview-focus dismissal path needs a real guest to click into.
- Input must be delivered as **trusted events** via the MCP tools (`click(wcId, x, y)`,
  `pressKey(wcId, name)`), not synthetic `dispatchEvent` — only trusted events fire the renderer's real
  click/keydown handlers and the native focus-crossing that drives the `window`-blur dismissal.
- **Focus-anchor rule (apparatus rule from the leg-2 spike):** a cold `Tab`/keyboard sequence from the
  bare document does not relocate focus — this is normal browser behavior, NOT an engine defect. **Before
  any keyboard-only sequence, establish a focus anchor by sending a `click(wcId, x, y)` into the chrome
  first** (e.g. the address bar area). Where a step needs focus on a specific trigger, click that trigger
  (located via `captureWindow()`) before pressing keys.
- **Coordinate-click rule (apparatus rule from the leg-2 spike):** all clicks are coordinate-based —
  `click(wcId, x, y)` located via a `captureWindow()` screenshot. There are no CSS selectors over the MCP
  surface. **Re-locate before each click — do NOT cache.** The `▾` container trigger (and the pill) shift
  right as tabs are added (the pill hugs the tab strip), so a cached coordinate from an earlier step can
  miss the trigger (and may hit the adjacent `+` button, spawning a stray tab). Take a fresh
  `captureWindow()` immediately before clicking each trigger.
- **Two-`wcId` bookkeeping (load-bearing for the page-click dismissal).** There are **two distinct
  dismissal handlers** on different `wcId`s:
  - **Page-click dismissal (Steps 2–3)** rides the chrome's `window` **blur** handler
    (`src/renderer/renderer.js`), which fires only when native focus crosses **into the `<webview>`'s
    separate web-contents**. So the dismissing click must land on the **active guest webview `wcId`**
    (from `enumerateTabs`) — `click(guestWcId, x, y)` at a neutral page area. This is a **real trusted
    page click** (a faithful witness of the cross-web-contents path), not a stand-in.
  - **In-chrome outside-click dismissal (Step 5)** rides the `document` **pointerdown** handler, so it
    stays on the **chrome `wcId`** (`click(chromeWcId, x, y)` on the address-bar / neutral chrome area).
  Targeting the wrong `wcId` would silently fail to dismiss.
- **Active precondition probe** (Step 1): confirm `tools/list` shows 17 tools including `getChromeTarget`
  and `enumerateTabs`; `getChromeTarget()` returns a numeric chrome `wcId`; `enumerateTabs()` lists at
  least one guest webview `wcId` (the loaded homepage tab). A dead or jar-identity connection otherwise
  surfaces as a confusing mid-test cascade.
- **Apparatus disqualification:** the `chrome-devtools` MCP does **NOT** qualify — it launches its own
  browser and never touches this app (false pass). The apparatus is the SDK admin MCP client over
  `127.0.0.1:$GOLDFINCH_MCP_PORT`, app launched via `npm run dev:automation`. This is **not** a CDP attach
  path — `npm run dev:automation` does not expose a DevTools port; only the admin MCP surface is used.

## Observables Required

- mcp (admin MCP tools — measured via the admin MCP client connected with the admin Bearer header):
  - On the **chrome `wcId`** (`getChromeTarget`): each trigger's `aria-expanded` and each popup's open
    state via `readAxTree(chromeWcId)` / `readDom(chromeWcId)` (`#kebab` / `#new-tab-menu`,
    `#kebab-menu` / `#container-menu`); the container popup's `role="menu"` / item `role="menuitem"` +
    roving tabindex; **the focused node via the `focused` property of the `readAxTree(chromeWcId)` node
    array** (the tool returns the raw `Accessibility.getFullAXTree` array — scan it for the node whose
    `focused` property is set; there is no top-level `focused` field). `captureWindow()` to locate
    triggers/items before clicks.
  - On the **active guest webview `wcId`** (`enumerateTabs`): the click target for the page-click
    dismissal (Steps 2–3) — a `click(guestWcId, x, y)` into a neutral region of the loaded page.
- shell (precondition probe: `tools/list` count + `getChromeTarget` + `enumerateTabs` results — measured
  via the MCP client or Bash).

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the admin MCP client; call `tools/list`; call `getChromeTarget()`; call `enumerateTabs()`. | `tools/list` returns **17 tools** including `getChromeTarget` and `enumerateTabs`. `getChromeTarget()` returns `{ wcId, kind: 'chrome', url }` with a **numeric** chrome `wcId`. `enumerateTabs()` lists **at least one** guest webview with a numeric `wcId`. Record the chrome `wcId` and the active guest `wcId`. If no guest webview, halt — preconditions not met. |
| 2 | **Page/webview-click dismissal (kebab):** locate the `⋮` via `captureWindow()` and open the kebab (`click(chromeWcId, x, y)` on `#kebab`); confirm open via `readAxTree(chromeWcId)`. Then take a `captureWindow()`, pick a **neutral region of the loaded page** (dead space, not a link/button) and `click(guestWcId, x, y)` into the active guest webview to move native focus into the page. Read the kebab's state. | The kebab menu **closes** (`#kebab` `aria-expanded="false"`, `#kebab-menu` hidden) when focus crosses into the webview — the chrome `window`-blur dismissal fired. This is a real trusted page click on the guest web-contents. |
| 3 | **Page/webview-click dismissal (container):** locate the `▾` via a fresh `captureWindow()` and open the container menu (`click(chromeWcId, x, y)` on `#new-tab-menu`); confirm open. Then `click(guestWcId, x, y)` into a neutral region of the active guest webview. Read the container's state. | The container menu **closes** (`#new-tab-menu` `aria-expanded="false"`, `#container-menu` hidden) on the page click. |
| 4 | **Cross-trigger dismissal:** open the container menu (`click(chromeWcId,…)` on `#new-tab-menu`, re-located); then `click(chromeWcId,…)` on `#kebab`. Read both via `readAxTree(chromeWcId)`. Then `click(chromeWcId,…)` on `#new-tab-menu` again. Read both. | Opening the kebab closes the container (container `aria-expanded="false"`, kebab open); opening the container closes the kebab (kebab `aria-expanded="false"`, container open). Never both open. |
| 5 | **In-chrome outside click:** open the kebab (`click(chromeWcId,…)` on `#kebab`); then `click(chromeWcId, x, y)` on a neutral chrome area (e.g. the address-bar center, located via `captureWindow()`). Read kebab state. Repeat for the container menu. | Each menu closes on the in-chrome outside click (`aria-expanded="false"`, hidden) — the `document` pointerdown dismissal fired. |
| 6 | **Escape + focus-restore intact (both):** open the kebab (`click(chromeWcId,…)`), `pressKey(chromeWcId, 'Escape')` — read state + the focused node in `readAxTree(chromeWcId)`. Open the container (`▾`), `pressKey(chromeWcId, 'Escape')` — read state + the focused node. | Each menu closes on Escape and **restores focus to its own trigger** — the node whose `focused` property is set in `readAxTree(chromeWcId)` is `#kebab` / `#new-tab-menu` respectively; focus not stranded on `<body>`. [a11y] |
| 7 | **Container menu is now full APG:** open the container menu (`click(chromeWcId,…)`); read its `role`, its items' `role`, and the roving tabindex via `readAxTree(chromeWcId)`; drive `pressKey(chromeWcId, 'ArrowDown')`/`'ArrowUp'`/`'Home'`/`'End'` and after each read the focused node in `readAxTree(chromeWcId)`. | `#container-menu` has `role="menu"`; items have `role="menuitem"` with roving tabindex (one `tabindex="0"`); each arrow press moves the focused node between items (wrap), Home/End jump to first/last; the focused node stays within the menu. [a11y] |
| 8 | **Container behavior preserved:** with the container menu open, activate a named container item (focus it via the arrow keys, then `pressKey(chromeWcId, 'Enter')`, or `click(chromeWcId,…)` on the item located via `captureWindow()`). Read tab count + the new tab's jar dot via `readDom(chromeWcId)`/`readAxTree(chromeWcId)`. | A new tab opens in that container (its strip button shows the matching `.tab-jar` dot); tab count +1 — the APG uplift did not break container selection. |
| 9 | **Container trigger opens by keyboard:** establish a focus anchor (`click(chromeWcId,…)` in the chrome), then move focus onto the `▾` trigger (`pressKey(chromeWcId, 'Tab')`/`'ShiftTab'` until the focused node in `readAxTree(chromeWcId)` is `#new-tab-menu`, or click it then re-confirm focus); `pressKey(chromeWcId, 'Space')`; read the menu open state + the focused node. Close (`pressKey(chromeWcId, 'Escape')`). Re-focus `▾`; `pressKey(chromeWcId, 'ArrowUp')`; read open state + the focused node. | `Space` opens the container menu **exactly once** (`#new-tab-menu` `aria-expanded="true"`, menu visible, NOT toggled-closed) with the focused node on the **first** item; `ArrowUp` opens it with the focused node on the **last** item. (Witnesses the `preventDefault`-suppresses-synthetic-click contract — the subtlest part of the container uplift.) [a11y] |

**Row conventions:** one row = one checkpoint. `[a11y]` flags accessibility-relevant checks. Focus
assertions read the **focused node** (the node whose `focused` property is set) from the raw
`readAxTree(chromeWcId)` AX-node array — not an in-page `document.activeElement` eval. The page-click
dismissal (Steps 2–3) is a **real trusted page click** on the guest webview `wcId` (`click(guestWcId,…)`),
which fires the same `window`-blur handler a user's pointer click would — it is no longer a manual-only /
"not cleanly drivable" path. Only genuine **OS/app-switch focus loss** (focus leaving the whole app to
another OS window) remains manual.

## Out of Scope

- **OS/app-switch dismissal** (focus leaving the whole app to another OS window) — manual; not drivable
  over the MCP surface. The page-click dismissal (clicking into the guest webview) IS now driven (Steps
  2–3, `click(guestWcId,…)`), so it is no longer in this exclusion.
- The kebab menu's own APG nav + Settings/Exit semantics — `kebab-menu.md` (regression).
- The container menu opening tabs / pill structure beyond Step 8 — `unified-tab-controls.md`.
- Tablist roving nav — `tab-keyboard-operability.md`.
- The `goldfinch://` scheme — Flight 4 / `tab-scheme-guard.md`.

## Variants (optional)

- N/A. (The page-click dismissal is now driven directly via `click(guestWcId,…)`; no preload-forward
  fallback variant is needed on the MCP surface.)
