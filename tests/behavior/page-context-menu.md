# Behavior Test: Custom page context menu (+ migrated toolbar Unpin)

**Slug**: `page-context-menu`
**Status**: draft
**Created**: 2026-06-19
**Last Run**: never

> **Updated 2026-07-02 (F8 Leg 5b).** Since the Flight-8 cutover the menu renders from the
> **menu-overlay sheet** (a separate transparent `WebContentsView`), not the chrome's
> `#page-context-menu` node — menu reads move to the **probed sheet `wcId`**, where the menu node is
> **`#sheet-menu` with `data-menu-type="page-context"`**. Guest right-click coordinates are now
> **1:1 guest-relative** (the sheet covers exactly the guest region — the old
> webview-rect offset translation was deleted), and Escape's focus return goes to the captured
> `returnFocus` element when one exists (keyboard invocations), else the **kebab button** (`#kebab`,
> observed live in F5 Leg 5) — chrome-focused, never the guest or `<body>`.

## Intent

Verify SC6: right-clicking web content opens Goldfinch's **on-brand, keyboard-operable custom**
context menu (NOT the native OS menu), with context-appropriate sections built from the forwarded
`params` — **link** (Open in new tab / Copy link), **image** (Open / Copy image address / Save),
**selection** (Copy / Search for "…"), **editable** (Cut/Copy/Paste/Undo/Redo, `editFlags`-gated —
omitted not disabled), an optional **spelling-suggestions** section (items dispatched **by index**,
never by round-tripping the guest's suggestion strings as commands), and always **Inspect** — opened
at the cursor, navigable by keyboard, **no-op on internal `goldfinch://` pages**, and with the toolbar
right-click **Unpin** (Media/Shields/DevTools) rendered by the **same** component in toolbar-mode.
This needs a behavior test, not a unit test: the menu is rendered **cross-process UI** — a guest
`context-menu` event is captured main-side (`event.preventDefault()` on the native menu), forwarded
over the `page-context-menu` IPC to the **chrome** renderer, which builds the model
(`pageContextModel`, unit-tested pure) and opens it **on the sheet** (`menu-overlay:open`). No unit
test reproduces the guest→main→chrome→sheet path, the real `dictionarySuggestions`/`editFlags`, the
1:1 cursor mapping, or the live toolbar-pin flip + filesystem persistence.

## Preconditions

- **Apparatus — admin MCP surface.** Goldfinch is running via `npm run dev:automation` with
  `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_MCP_PORT=49707`. At launch the
  app prints `AUTOMATION_DEV_MINT { "key": "...", "adminKey": "..." }` to stdout — capture the `adminKey`.
  The MCP server listens on `127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`.
- **Port (load-bearing for every URL below).** Pin the listen port via `GOLDFINCH_MCP_PORT` (default
  `49707`). Export it once at launch and reuse it in all SDK calls.
- **Admin key attaches via the Bearer header (load-bearing).** Connect an admin MCP client (SDK
  `StreamableHTTPClientTransport`, `Authorization: Bearer <adminKey>`) on
  `127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`:
  ```js
  const port = process.env.GOLDFINCH_MCP_PORT || 49707;
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
    { requestInit: { headers: { Authorization: `Bearer ${adminKey}` } } }
  );
  ```
  This spec requires the **admin** key — a jar key is refused `getChromeTarget` (`admin-only`) and
  cannot resolve the sheet's wcId (non-tab wcIds resolve only at the admin tier).
- **Three targets — guest, chrome, sheet.** The right-click fires on the **guest** `wcId`
  (`enumerateTabs`); the trigger-side state and focus-return live on the **chrome** `wcId`
  (`getChromeTarget()`); the **rendered menu** lives on the **sheet** `wcId` (probed) as
  `#sheet-menu[data-menu-type="page-context"]`. Read the menu via `readDom(sheetWcId)` /
  `readAxTree(sheetWcId)` / `captureWindow()`; drive its keyboard via `pressKey(sheetWcId, …)`.
- **Sheet wcId discovery (background-tab-safe probe walk — F8 Leg-5 lesson).** The sheet is NOT in
  `enumerateTabs`; probe the small id-space around the known ids (`readDom(id)` returning the
  `menu-overlay.html` markup identifies it), **skipping every `enumerateTabs` wcId and the chrome
  wcId** (`readDom`/`evaluate` are foreground-first — probing a background tab activates it, closing
  the menu under test). The sheet materializes lazily on first menu open. Discover once per run.
- **The ACT side fires a REAL guest `context-menu` event — proven driver.**
  `click(guestWcId, x, y, { button: 'right' })` on the active web tab's content dispatches a genuine
  native `context-menu` event in the guest (**verified live at F8 Leg 4** — the sheet menu
  materialized at the click point with the correct link section; this is the canonical driver, not a
  fallback). Main-side captures it, `preventDefault()`s the native menu, and forwards
  `{ wcId, params }` to the chrome, which opens the sheet. So the right-click targets the **guest**
  `wcId`, while the resulting **menu** is read on the **sheet** `wcId`.
- **Item activation nuance (F8 Leg-3 lesson):** `pressKey(sheetWcId, 'Enter')` on a focused sheet
  menuitem does NOT synthesize the DOM click a real Enter does — activate items via
  `click(sheetWcId, x, y)` on the item, or arrow-focus + `evaluate(sheetWcId,
  'document.activeElement.click()')`. Real-keyboard activation is HAT-covered.
- **Coordinate-click rule.** All clicks are coordinate-based — locate the target (a link, an image, an
  editable field, a menu item, a toolbar button) in a `captureWindow()` frame, then `click(wcId, x, y)`.
- **A web page with right-clickable targets.** Use the `tests/behavior/fixtures/menu-overlay/`
  fixture — it contains, in known positions: a mid-page hyperlink, a same-origin `<img>`
  (`sample-image.png`), a selectable paragraph, and an editable `<input>` (plus the ticking display
  and bottom-left link the `menu-overlay.md` spec owns). Serve it locally the same way the a11y
  fixture is served.
- `userData/settings.json` is readable on the filesystem (the toolbar-Unpin persistence observable).
  On a dev run the profile is the sibling `goldfinch-dev` userData directory (dev profile isolation).
- **Active-precondition probe** (Step 1): `tools/list` includes (presence-checked, not an exact count) the
  tools this spec drives — `getChromeTarget`, `click`, `pressKey`, `readDom`, `readAxTree`, `captureWindow`,
  `enumerateTabs`, `evaluate` — and `getChromeTarget()` returns a numeric chrome `wcId`.
- **Apparatus disqualification:** the `chrome-devtools` MCP does **NOT** qualify — it launches its own
  browser and never touches this app (false pass). The apparatus is the SDK admin MCP client over
  `127.0.0.1:$GOLDFINCH_MCP_PORT`, app launched via `npm run dev:automation`.

## Observables Required

- **mcp / browser (sheet + chrome — measured via the admin MCP client):** the sheet's
  `#sheet-menu[data-menu-type="page-context"]` node — its rendered `cm-item role="menuitem"` items +
  their text, `role="menu"` / `role="separator"`, roving tabindex / focused item, and the menu's
  rendered position — via `readDom(sheetWcId)` / `readAxTree(sheetWcId)` / `captureWindow()`. The
  toolbar buttons' `.hidden` state and the focused node on the **chrome** `wcId`. The settings
  guest's pin toggle `aria-pressed` via `readDom(guestWcId)` / `readAxTree(guestWcId)`. **Sheet DOM
  persisting after close is expected** (lazy singleton) — "menu closed" is judged by pixels, never by
  sheet DOM absence.
- **filesystem (`userData/settings.json` `toolbarPins` — measured via Read/Bash):** the toolbar-Unpin
  persistence (dev-profile `settings.json` on a dev run).
- **shell (precondition probe — measured via Bash):** `tools/list` presence + `getChromeTarget`.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the admin MCP client; call `tools/list`; then `getChromeTarget()` and record the chrome `wcId`. | `tools/list` **includes** (presence-checked) the tools this spec drives (`getChromeTarget`, `click`, `pressKey`, `readDom`, `readAxTree`, `captureWindow`, `enumerateTabs`, `evaluate`); `getChromeTarget()` returns a **numeric** chrome `wcId`. If the probe fails, halt. |
| 2 | Open a web tab to the all-targets fixture (`tests/behavior/fixtures/menu-overlay/`, served locally); record its guest `wcId` via `enumerateTabs`; `captureWindow()` to locate the link/image/selection/editable targets. | (setup — no judgment) |
| 3 | **Right-click a link.** `click(guestWcId, x, y, { button: 'right' })` on the hyperlink. Probe the sheet's wcId if not yet known; read `readDom(sheetWcId)`. | The sheet renders `#sheet-menu[data-menu-type="page-context"]` with **Open link in new tab** + **Copy link** items and always **Inspect** — it is the **custom on-brand menu**, NOT the native OS menu (the native menu never appears in the composited window — its absence is the negative observable). `[a11y]` the node is `role="menu"` and its items are `role="menuitem"`; separators are `role="separator"` and excluded from roving. |
| 4 | **Right-click an image.** `click(guestWcId, x, y, { button: 'right' })` on the `<img>`. Read the sheet. | The menu shows the **image** section — **Open image in new tab** + **Copy image address** + **Save image** — plus **Inspect**. |
| 5 | **Select text, right-click the selection.** Drag-select (or `evaluate` a programmatic selection on the guest) a paragraph, then `click(guestWcId, x, y, { button: 'right' })` on it. Read the sheet. | The menu shows the **selection** section — **Copy** + **Search for "…"** (the truncated selection text) — plus **Inspect**. |
| 6 | **Right-click an editable field.** Focus the `<input>`, `click(guestWcId, x, y, { button: 'right' })` on it. Read the sheet. | The menu shows the **editable** section — the `editFlags`-gated edit actions present in `params` (e.g. **Paste**, plus **Cut/Copy** when a selection exists, **Undo/Redo** when available) — plus **Inspect**. Items whose `editFlags` flag is falsy are **omitted**, not rendered disabled (the absent items are simply not in the menu). |
| 7 | **Cursor position — 1:1.** For one of the right-clicks above, record the click point and read the menu node's rendered position (`evaluate(sheetWcId, …getBoundingClientRect())` on the menu node, or measure from `captureWindow()`). | The menu's top-left is **at the right-click coordinates 1:1** (the sheet covers exactly the guest region, so guest-relative `params.x/y` need no offset translation — 0 px deviation observed live at F8 Leg 4, ≤2 px tolerance), subject only to the viewport edge clamp. |
| 8 | **Keyboard nav + Escape focus-return.** With the menu open (guest right-click), `pressKey(sheetWcId, 'ArrowDown')` / `'ArrowUp'` / `'Home'` / `'End'`; read the sheet roving state between presses. Then `pressKey(sheetWcId, 'Escape')`; read the focused node in `readAxTree(chromeWcId)`. | Arrow/Home/End move the **roving focus** across `role="menuitem"` items (skipping separators/notes); **Escape** closes the menu (gone from pixels) and focus returns to the **chrome** — for a pointer-invoked (right-click) menu there is no captured `returnFocus` element, so focus lands on the **kebab button** (`#kebab`); for a keyboard invocation it returns to the invoking element (Step 9). It is NOT stranded on `<body>` — and (changed from the freeze era) it does NOT land in the guest. `[a11y]` |
| 9 | **Shift+F10 / ContextMenu-key (chrome-focused).** Focus a **chrome** element (e.g. the Reload button or the address bar: `click(chromeWcId, x, y)` on it), then `pressKey(chromeWcId, 'F10', ['shift'])` (or `pressKey(chromeWcId, 'ContextMenu')`). Read the sheet, then `pressKey(sheetWcId, 'Escape')` and read the chrome's focused node. | An **Inspect-only** menu opens on the sheet, anchored at the focused chrome element (chrome→sheet anchor translation, y-clamped to the sheet's top edge: no guest params → just **Inspect**). Escape returns focus to the **invoking chrome element** (the captured `returnFocus`). `[a11y]` *(The in-guest Shift+F10 case is covered by the right-click steps — Chromium synthesizes a real guest `context-menu` event there; the live keyboard render on a real display is HAT, see Out of Scope.)* |
| 10 | **No-op on internal pages.** Open/activate `goldfinch://settings` (kebab → Settings); `click` at page-content coordinates with `{ button: 'right' }` against the active view. Take a `captureWindow()`. | **No** context menu appears in the composited window — the wiring sits behind the main-side `!__goldfinchInternal` guard, so the internal guest never emits a forwarded `page-context-menu`. (Judge by pixels; the sheet's persisted-but-hidden DOM is not a valid observable here.) |
| 11 | **Toolbar Unpin — open the menu.** On the chrome, right-click `#toggle-media` (or `#toggle-privacy` / `#toggle-devtools`): `click(chromeWcId, x, y, { button: 'right' })` on the button. Read the sheet. | The sheet renders the page-context menu in **toolbar-mode**: a **single "Unpin {Media\|Shields\|DevTools}"** `role="menuitem"` item, anchored just below the button (chrome→sheet translation) — the custom menu, NOT a native Electron menu. `[a11y]` |
| 12 | **Toolbar Unpin — activate + persist.** Activate the "Unpin {item}" item (click its sheet coordinates, or `evaluate(sheetWcId, 'document.activeElement.click()')`). Re-read the chrome toolbar (`readDom(chromeWcId)` / `captureWindow()`), read the dev-profile `userData/settings.json` (filesystem), and read the settings guest's Appearance pin toggle (`readAxTree(guestWcId)`, if a settings tab is open). | The targeted toolbar button gets `.hidden` **immediately** (live flip); `settings.json` `toolbarPins.{item} === false` (filesystem — persisted); the settings-page pin toggle for that item reflects unpinned (`aria-pressed="false"`) **live**; and focus lands on the address bar `#address` (the unpin dispatch body's own refocus — the anchor button just hid; not stranded on `<body>`). *(Restore the pin afterward — re-enable via the settings page or restore the settings file — so the run leaves no state.)* |

**Row conventions:** Row 2 is pure setup (no judgment). `[a11y]`-marked rows are accessibility-relevant
(picked up by the optional Accessibility Validator). Steps 3–6 are the per-section render coverage;
step 7 the 1:1 cursor mapping; step 8 keyboard nav + the sheet-era Escape focus-return; step 9 the
chrome-focused keyboard invocation; step 10 the internal no-op; steps 11–12 the toolbar Unpin in
toolbar-mode. Every Expected Result is a sheet-DOM / chrome-DOM / a11y-tree / screenshot / filesystem
observable — the WSLg-acceptance discipline.

## Out of Scope

- **The menu's pixel-level on-brand *feel*** (dark/gold styling vs the native menu; corner radius, shadow,
  hover gold) — a visual judgment, **HAT-authoritative**. This spec asserts the menu's *presence,
  structure, items, position, and keyboard contract*, not its pixels.
- **The live in-guest Shift+F10 / ContextMenu-key keyboard render under a real display** — Chromium
  synthesizes a real guest `context-menu` event for the in-page keyboard case (Leg 4 finding), which flows
  through the same path the right-click steps exercise; the *live keyboard-driven render on a real GUI* is
  **HAT-authoritative** (not separately scripted here).
- **macOS native-menu suppression confirmation** (that `event.preventDefault()` actually suppresses the OS
  menu on macOS) — **macOS-authoritative**; on the MCP surface the negative observable is the absence of
  any rendered context menu when expected, and the presence of the custom sheet menu otherwise.
- **The Inspect → detached DevTools materialization** — Inspect routes through the `toggle-devtools` IPC
  path, but **DevTools does not open on this WSLg rig** (F8 Leg-4 finding: `isDevtoolsOpen` stays false
  via both the human IPC and the MCP op — environmental, not a wiring defect). The real open/close is
  **HAT-carried**; `devtools-cdp-conflict.md` covers the CDP single-client conflict
  (macOS-authoritative). This spec asserts that the **Inspect item renders**, not that the DevTools
  window opens.
- **Live spellcheck suggestions on this rig** — typed misspellings did not surface
  `dictionarySuggestions` under WSLg (F8 Leg-4 finding; the M04-F4 squiggle note is the same family).
  The suggestion **section render + index dispatch** is covered by the unit suite + the audit hook's
  synthetic params; the live correction round-trip is `spellcheck.md`'s and **HAT-carried**.
- **Pin/persist/shortcut coverage for the toolbar buttons themselves** — owned by `toolbar-pins.md`
  (which cross-references this spec for the right-click-Unpin path rather than duplicating it).
- **The open/close/dismissal contract regression** — owned by `menu-dismissal.md` / `menu-overlay.md`
  (the page menu rides the same sheet + `closeMenuOverlay` machinery).

## Variants (optional)

- Repeat steps 11–12 for each of **Media**, **Shields**, and **DevTools** (the single "Unpin {item}" label
  and the persisted `toolbarPins.{item}` differ per item; DevTools starts unpinned so pin it first).
- A **union target** (a linked image, or an editable field with a live selection): the menu shows **every**
  applicable section in order (link → image → selection → editable → spelling → Inspect), separators
  between groups, Inspect last.
