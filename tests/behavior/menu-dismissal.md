# Behavior Test: Menu dismissal — menus close on any outside interaction

**Slug**: `menu-dismissal`
**Status**: active
**Created**: 2026-06-07
**Last Run**: 2026-06-07-11-58-01

> **Re-authored 2026-07-02 (F8 Leg 5b).** The chrome-side dismissal mechanism this spec originally
> pinned (the chrome `window`-blur and `document` pointerdown listeners, the freeze-frame) was retired
> at the Flight-8 cutover — menus now render from the **menu-overlay sheet** and dismissal authority
> lives in the sheet (its own pointerdown/blur/Escape) + main's `closeMenuOverlay` family. The
> **user-observable contract is unchanged** and is what this spec protects: an outside interaction
> dismisses the open menu AND is swallowed (no page action), Escape closes with focus restored to the
> trigger, and menus are mutually exclusive. Close *reasons* are internal protocol — this spec asserts
> only user-visible effects (menu gone on pixels, no navigation, trigger focus/aria state).

## Intent

Verify that Goldfinch's dropdown menus — the kebab (`⋮`) overflow menu and the container (`▾`) menu —
**dismiss reliably on any outside interaction**: a click landing in the guest region (which must be
**swallowed** — the page must not act on it), a click on the *other* menu's trigger (mutual
exclusion), and a re-click of the open menu's own trigger (toggle-close, no blink). It also confirms
Escape + focus-restore work and that the two menus are never open simultaneously. This needs a
behavior test because the properties under test are *real input crossing web-contents boundaries*
(chrome trigger → sheet menu → guest underneath) and live menu open/close state — no unit test
reaches the cross-view dismissal path. (Flight 3 contract, carried across the F8 sheet cutover;
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
  The Bearer rides every request the transport sends. This spec requires the **admin** key — the chrome
  renderer (`getChromeTarget`), the guest (`enumerateTabs`), AND the sheet (probed wcId, admin-only
  resolution) are all needed.
- **Three-`wcId` bookkeeping (load-bearing).** Three webContents participate:
  - the **chrome `wcId`** (`getChromeTarget()`) — menu *triggers*, `aria-expanded`, and focus-return
    live here;
  - the **active guest `wcId`** (`enumerateTabs`) — the page underneath, used only to verify the
    swallow (URL unchanged);
  - the **sheet `wcId`** (probed) — the rendered menu and the outside-click target live here.
- **Sheet wcId discovery (background-tab-safe probe walk — F8 Leg-5 lesson).** The sheet is NOT in
  `tabViews`/`enumerateTabs`; probe the small id-space around the known ids (`readDom(id)` returning
  the `menu-overlay.html` markup identifies it), **skipping every `enumerateTabs` wcId and the chrome
  wcId** — `readDom`/`evaluate` are foreground-first, so probing a background tab activates it, firing
  a `tab-switch` close of the menu under test. Discover once per run.
- **Sheet menuitem activation nuance (F8 Leg-3 lesson):** `pressKey(sheetWcId, 'Enter')` on a focused
  sheet menuitem does NOT synthesize the DOM click a real Enter does — activate items via
  `click(sheetWcId, x, y)` on the item's coordinates, or arrow-focus + `evaluate(sheetWcId,
  'document.activeElement.click()')`. Real-keyboard activation is HAT-covered.
- **At least one tab with a loaded guest** exists (the default homepage tab satisfies this) — the
  swallow check needs a real page underneath with a known URL.
- Input must be delivered as **trusted events** via the MCP tools (`click(wcId, x, y)`,
  `pressKey(wcId, name)`), not synthetic `dispatchEvent` — only trusted events fire the real
  pointerdown/keydown handlers.
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
- **Active precondition probe** (Step 1): confirm `tools/list` includes (presence-checked, not an exact
  count) the tools this spec drives: `getChromeTarget` and `enumerateTabs`; `getChromeTarget()` returns a
  numeric chrome `wcId`; `enumerateTabs()` lists at least one guest `wcId` (the loaded homepage tab). A
  dead or jar-identity connection otherwise surfaces as a confusing mid-test cascade.
- **Apparatus disqualification:** the `chrome-devtools` MCP does **NOT** qualify — it launches its own
  browser and never touches this app (false pass). The apparatus is the SDK admin MCP client over
  `127.0.0.1:$GOLDFINCH_MCP_PORT`, app launched via `npm run dev:automation`. This is **not** a CDP attach
  path — `npm run dev:automation` does not expose a DevTools port; only the admin MCP surface is used.

> **Apparatus limits — what stays HAT-only (F8 flight codification).**
> - **Injected clicks bypass hit-testing.** MCP `click(wcId, x, y)` delivers via `sendInputEvent` to
>   the *target* webContents regardless of view stacking — clicking the guest wcId would act on the
>   page even with the sheet correctly interposed (false FAIL on the swallow), and clicking the sheet
>   wcId makes "page did not act" trivially true for OS-level interception purposes. The property
>   "outside clicks physically land in the sheet, not the guest" is a hit-test/z-order fact only a
>   real OS pointer can exercise — **HAT-only**. This spec asserts the sheet's
>   *dismiss-without-forwarding* contract (click the probed sheet wcId), which is the drivable half.
> - **Scripted focus can't fake OS blur.** The blur dismissal flavor (app switch / OS focus leaving
>   the sheet, including real pointer clicks into chrome/toolbar that blur-dismiss) cannot be driven
>   over the MCP surface — **HAT-scoped**. Escape, outside-click-on-sheet, cross-trigger, and
>   trigger re-click ARE drivable and are scripted below.

## Observables Required

- mcp (admin MCP tools — measured via the admin MCP client connected with the admin Bearer header):
  - On the **chrome `wcId`**: each trigger's `aria-expanded` via `readAxTree(chromeWcId)` /
    `readDom(chromeWcId)` (`#kebab` / `#new-tab-menu`); **the focused node via the `focused` property
    of the `readAxTree(chromeWcId)` node array** (the tool returns the raw
    `Accessibility.getFullAXTree` array — scan it for the node whose `focused` property is set; there
    is no top-level `focused` field). `captureWindow()` to locate triggers before clicks.
  - On the **sheet `wcId`** (probed): the rendered menu (`#sheet-menu` + `data-menu-type`,
    `role="menu"`/`menuitem`, roving tabindex) via `readDom(sheetWcId)`; the outside-click target
    (`click(sheetWcId, x, y)` at guest-region coordinates outside the menu rect); Escape/Tab delivery
    (`pressKey(sheetWcId, …)`). **Sheet DOM persisting after close is expected** (lazy singleton —
    hidden ≠ destroyed): "menu closed" is judged by pixels + the chrome trigger's
    `aria-expanded="false"`, never by sheet DOM absence.
  - On the **active guest `wcId`** (`enumerateTabs`): the URL, re-read after the swallow check.
- browser / rendered window (`captureWindow()`, OS-grab path): menu present/absent in the composited
  pixels (the closed-state authority).
- shell (precondition probe: `tools/list` + `getChromeTarget` + `enumerateTabs` results — measured
  via the MCP client or Bash).

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the admin MCP client; call `tools/list`; call `getChromeTarget()`; call `enumerateTabs()`. Probe the sheet's wcId (background-tab-safe walk — see Preconditions; the sheet view materializes lazily on first menu open, so probe after Step 2's open if the walk finds nothing yet). | `tools/list` **includes** (presence-checked, not an exact count) the tools this spec drives: `getChromeTarget` and `enumerateTabs`. `getChromeTarget()` returns `{ wcId, kind: 'chrome', url }` with a **numeric** chrome `wcId`. `enumerateTabs()` lists **at least one** guest with a numeric `wcId`. Record the chrome, guest, and (possibly deferred) sheet `wcId`s. If no guest, halt — preconditions not met. |
| 2 | **Outside-click dismissal + swallow (kebab):** locate the `⋮` via `captureWindow()` and open the kebab (`click(chromeWcId, x, y)`); confirm open via `readAxTree(chromeWcId)` (`aria-expanded="true"`) + `readDom(sheetWcId)` (menu rendered). Note the active tab's URL. Then `click(sheetWcId, x, y)` at a point in the guest region **outside the menu rect** (over page dead space or a link — both must be swallowed). Read chrome state + `enumerateTabs`. Take a `captureWindow()`. | The kebab menu **closes** (`#kebab` `aria-expanded="false"`; menu gone from the pixels) AND the click is **swallowed** — the page did NOT navigate or act (`enumerateTabs` URL unchanged). No focus is stolen to the trigger (outside-click does not refocus). |
| 3 | **Outside-click dismissal + swallow (container):** locate the `▾` via a fresh `captureWindow()` and open the container menu (`click(chromeWcId, x, y)` on `#new-tab-menu`); confirm open. Then `click(sheetWcId, x, y)` outside the menu rect. Read state + `enumerateTabs`. | The container menu **closes** (`#new-tab-menu` `aria-expanded="false"`; pixels clear) and the click is swallowed (URL unchanged, no page action). |
| 4 | **Cross-trigger dismissal (mutual exclusion):** open the container menu (`click(chromeWcId,…)` on `#new-tab-menu`, re-located); then `click(chromeWcId,…)` on `#kebab`. Read both triggers via `readAxTree(chromeWcId)` and the sheet's `data-menu-type` via `readDom(sheetWcId)`. Then `click(chromeWcId,…)` on `#new-tab-menu` again. Read both. | Opening the kebab closes the container (container `aria-expanded="false"`, kebab open, sheet menu is now `data-menu-type="kebab"` — a model-replace, no flicker); opening the container closes the kebab conversely. Never both open. |
| 5 | **Trigger re-click toggles closed (no blink):** open the kebab (`click(chromeWcId,…)` on `#kebab`); then `click(chromeWcId,…)` on `#kebab` again. Read state + `captureWindow()`. | The second trigger click **closes** the menu and it **stays closed** (`aria-expanded="false"`, no menu in the pixels) — no close-then-reopen blink (the F8 re-click race is suppressed chrome-side). |
| 6 | **Escape + focus-restore intact (both):** open the kebab (`click(chromeWcId,…)`), `pressKey(sheetWcId, 'Escape')` — read chrome state + the focused node in `readAxTree(chromeWcId)`. Open the container (`▾`), `pressKey(sheetWcId, 'Escape')` — read state + the focused node. | Each menu closes on Escape and **restores focus to its own trigger** — the node whose `focused` property is set in `readAxTree(chromeWcId)` is `#kebab` / `#new-tab-menu` respectively; focus not stranded on `<body>` (corroborate with a chrome `document.hasFocus()` eval — true on chrome, false on the sheet). [a11y] |
| 7 | **Container menu is full APG (renders in the sheet):** open the container menu (`click(chromeWcId,…)`); read its `role`, its items' `role`, and the roving tabindex via `readDom(sheetWcId)`; drive `pressKey(sheetWcId, 'ArrowDown')`/`'ArrowUp'`/`'Home'`/`'End'` and after each read the focused/roving item on the sheet. | The sheet's `#sheet-menu` has `role="menu"`; items have `role="menuitem"` with roving tabindex (exactly one `tabindex="0"`); each arrow press moves the roving focus between items (wrap), Home/End jump to first/last; focus stays within the menu. [a11y] |
| 8 | **Container behavior preserved:** with the container menu open, activate a named container item — arrow-focus it, then `evaluate(sheetWcId, 'document.activeElement.click()')` (see the activation nuance), or `click(sheetWcId, x, y)` on the item. Read tab count + the new tab's jar via `enumerateTabs` / `readDom(chromeWcId)`. | A new tab opens in that container (its strip button shows the matching `.tab-jar` dot; `enumerateTabs` shows the jar); tab count +1 — the sheet migration did not break container selection. |
| 9 | **Container trigger opens by keyboard:** establish a focus anchor (`click(chromeWcId,…)` in the chrome), focus the `▾` trigger (click it, then Escape to close if it opened — or Tab to it; confirm the focused node is `#new-tab-menu`); `pressKey(chromeWcId, 'Space')`; read the chrome `aria-expanded` + the sheet's roving state. Close (`pressKey(sheetWcId, 'Escape')`). Re-focus `▾`; `pressKey(chromeWcId, 'ArrowUp')`; read open state + the sheet's roving item. | `Space` opens the container menu **exactly once** (`#new-tab-menu` `aria-expanded="true"`, menu rendered in the sheet, NOT toggled-closed) with the roving focus on the **first** item; `ArrowUp` opens it with the roving focus on the **last** item. (Trigger-side keydown stays chrome-owned — ArrowDown/Enter/Space/ArrowUp open with a `startIndex`; the sheet runs the APG contract once open.) [a11y] |

**Row conventions:** one row = one checkpoint. `[a11y]` flags accessibility-relevant checks. Chrome
focus assertions read the **focused node** (the node whose `focused` property is set) from the raw
`readAxTree(chromeWcId)` AX-node array — not an in-page `document.activeElement` eval. Sheet roving
assertions read `readDom(sheetWcId)` (tabindex/focus state in the sheet document). Menu-closed
judgments use pixels + the chrome trigger's `aria-expanded` — never sheet DOM absence.

## Out of Scope

- **OS/app-switch blur dismissal** and **real-pointer chrome/toolbar clicks that blur-dismiss** —
  scripted focus can't fake OS blur; **HAT-scoped** (F8 Leg-6).
- **OS-pointer hit-testing interception** (outside clicks physically landing in the sheet, not the
  guest) — injected clicks bypass hit-testing; **HAT-only**. This spec's swallow check asserts the
  dismiss-without-forwarding contract instead.
- The kebab menu's own APG nav + item semantics — `kebab-menu.md` (regression).
- The sheet mechanism itself (liveness, find-bar interplay, residue) — `menu-overlay.md`.
- The container menu opening tabs / pill structure beyond Step 8 — `unified-tab-controls.md`.
- Tablist roving nav — `tab-keyboard-operability.md`.
- The `goldfinch://` scheme — `tab-scheme-guard.md`.

## Variants (optional)

- Repeat Steps 2–3 with the **site-info popup** (🔒 address chip) as the open surface — same
  outside-click dismissal + swallow contract, no-items template (its Escape/Tab dismissal is its own
  keydown handler in the sheet).
