# Behavior Test: Custom page context menu (+ migrated toolbar Unpin)

**Slug**: `page-context-menu`
**Status**: draft
**Created**: 2026-06-19
**Last Run**: never

## Intent

Verify SC6: right-clicking web content opens Goldfinch's **on-brand, keyboard-operable custom**
`#page-context-menu` (NOT the native OS menu), with context-appropriate sections built from the
forwarded `params` — **link** (Open in new tab / Copy link), **image** (Open / Copy image address /
Save), **selection** (Copy / Search for "…"), **editable** (Cut/Copy/Paste/Undo/Redo, `editFlags`-gated
— omitted not disabled), an optional **spelling-suggestions** section, and always **Inspect** — opened
at the cursor, navigable by keyboard, **no-op on internal `goldfinch://` pages**, and with the toolbar
right-click **Unpin** (Media/Shields/DevTools) migrated onto the **same** component (Leg 5). This needs a
behavior test, not a unit test: the menu is rendered **cross-process UI** — a guest `context-menu` event
is captured main-side (`event.preventDefault()` on the native menu), forwarded over the
`page-context-menu` IPC to the **chrome** renderer, which builds and positions `#page-context-menu` from
the payload. No unit test reproduces the guest→main→chrome path, the real `dictionarySuggestions`/
`editFlags`, the cursor mapping, or the live toolbar-pin flip + filesystem persistence.

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
  This spec requires the **admin** key — a jar key is refused `getChromeTarget` (`admin-only`) and cannot
  enumerate the internal `goldfinch://settings` guest. Only the admin identity can drive the chrome shell
  and the internal guest (admin engine built with `{ allowInternal: true }`).
- **Single target — the CHROME renderer.** The menu renders in the chrome renderer's `#page-context-menu`
  node, NOT in the guest. Acquire the chrome target via `getChromeTarget()` → numeric chrome `wcId`. Read
  it via `readDom(wcId)` / `readAxTree(wcId)` / `captureWindow()`; drive it via `click(wcId, x, y, …)` /
  `pressKey(wcId, name, modifiers)`. (The settings guest's `wcId`, used only in the toolbar-Unpin steps to
  read the live pin toggle, comes from `enumerateTabs` → the `goldfinch://settings` entry.)
- **The ACT side fires a REAL guest `context-menu` event.** `click(guestWcId, x, y, { button: 'right' })`
  on the active web tab's content dispatches a genuine native `context-menu` event in the guest
  (the M03 `input.js` `button:'right'` capability, Leg-1 spike POSITIVE) — main-side captures it,
  `preventDefault()`s the native menu, and forwards `{ wcId, params }` to the chrome. So the right-click
  must target the **guest** tab's `wcId` (its web content), while the resulting **menu** is read on the
  **chrome** `wcId`. Locate click coordinates by reading a `captureWindow()` frame (coordinate-based;
  there are no CSS selectors over the MCP surface).
- **Coordinate-click rule.** All clicks are coordinate-based — locate the target (a link, an image, an
  editable field, a menu item, a toolbar button) in a `captureWindow()` frame, then `click(wcId, x, y)`.
- **A web page with right-clickable targets.** Use a page (or a `data:`/fixture page) that contains, in
  known positions: a hyperlink, an `<img>`, a selectable paragraph, and an editable `<input>`/`<textarea>`
  (`https://example.com/` has a link + selectable text; for the image/editable rows a fixture with all
  four targets is cleaner — e.g. the `tests/behavior/fixtures/a11y-media/` page or a small `data:` doc).
- `userData/settings.json` is readable on the filesystem (the toolbar-Unpin persistence observable).
- **Active-precondition probe** (Step 1): `tools/list` includes (presence-checked, not an exact count) the
  tools this spec drives — `getChromeTarget`, `click`, `pressKey`, `readDom`, `readAxTree`, `captureWindow`,
  `enumerateTabs`, `evaluate` — and `getChromeTarget()` returns a numeric chrome `wcId`.
- **Apparatus disqualification:** the `chrome-devtools` MCP does **NOT** qualify — it launches its own
  browser and never touches this app (false pass). The apparatus is the SDK admin MCP client over
  `127.0.0.1:$GOLDFINCH_MCP_PORT`, app launched via `npm run dev:automation`.

## Observables Required

- **mcp / browser (chrome DOM + a11y tree — measured via the admin MCP client):** the `#page-context-menu`
  node's visibility (`.hidden` class absent), its rendered `cm-item role="menuitem"` items + their text,
  `role="menu"` / `role="separator"`, roving tabindex / active element, and the menu's screen position —
  all via `readDom(wcId)` / `readAxTree(wcId)` / `captureWindow()` on the **chrome** `wcId`. The toolbar
  buttons' `.hidden` state on the chrome. The settings guest's pin toggle `aria-pressed` via
  `readDom(guestWcId)` / `readAxTree(guestWcId)`.
- **filesystem (`userData/settings.json` `toolbarPins` — measured via Read/Bash):** the toolbar-Unpin
  persistence.
- **shell (precondition probe — measured via Bash):** `tools/list` presence + `getChromeTarget`.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the admin MCP client; call `tools/list`; then `getChromeTarget()` and record the chrome `wcId`. | `tools/list` **includes** (presence-checked) the tools this spec drives (`getChromeTarget`, `click`, `pressKey`, `readDom`, `readAxTree`, `captureWindow`, `enumerateTabs`, `evaluate`); `getChromeTarget()` returns a **numeric** chrome `wcId`. If the probe fails, halt. |
| 2 | Open a web tab to the target page (`https://example.com/` or the all-targets fixture); record its guest `wcId` via `enumerateTabs`; `captureWindow()` to locate the link/image/selection/editable targets. | (setup — no judgment) |
| 3 | **Right-click a link.** `click(guestWcId, x, y, { button: 'right' })` on the hyperlink. Read the chrome via `readDom(wcId)` / `readAxTree(wcId)`. | `#page-context-menu` is **visible** in the chrome DOM (`.hidden` absent) with **Open link in new tab** + **Copy link** items and always **Inspect** — it is the **custom on-brand menu**, NOT the native OS menu (the native menu is not in the chrome DOM — its absence is the negative observable). `[a11y]` the node is `role="menu"` and its items are `role="menuitem"`. |
| 4 | **Right-click an image.** `click(guestWcId, x, y, { button: 'right' })` on an `<img>`. Read the chrome. | `#page-context-menu` shows the **image** section — **Open image in new tab** + **Copy image address** + **Save image** — plus **Inspect**. |
| 5 | **Select text, right-click the selection.** Drag-select (or `evaluate` a programmatic selection) a paragraph, then `click(guestWcId, x, y, { button: 'right' })` on it. Read the chrome. | `#page-context-menu` shows the **selection** section — **Copy** + **Search for "…"** (the truncated selection text) — plus **Inspect**. |
| 6 | **Right-click an editable field.** Focus an `<input>`/`<textarea>`, `click(guestWcId, x, y, { button: 'right' })` on it. Read the chrome. | `#page-context-menu` shows the **editable** section — the `editFlags`-gated edit actions present in `params` (e.g. **Paste**, plus **Cut/Copy** when a selection exists, **Undo/Redo** when available) — plus **Inspect**. Items whose `editFlags` flag is falsy are **omitted**, not rendered disabled (the absent items are simply not in the menu). |
| 7 | **Cursor position.** For one of the right-clicks above, record the click point and read the menu node's rendered position (`evaluate` `els`-equivalent `getBoundingClientRect()` on `#page-context-menu`, or measure from `captureWindow()`). | The menu opens **at/near the right-click coordinates** (its top-left is the click point mapped through the active webview rect + viewport clamp — not pinned to a fixed corner). |
| 8 | **Keyboard nav.** With the menu open, `pressKey(wcId, 'ArrowDown')` / `'ArrowUp'` / `'Home'` / `'End'`; read `readAxTree(wcId)` between presses to observe the active item. Then `pressKey(wcId, 'Escape')`. | Arrow/Home/End move the **roving focus** across `role="menuitem"` items (the active/focused item changes); **Escape** closes the menu (`#page-context-menu` regains `.hidden`) and focus returns **off** the hidden node — it is NOT stranded on `<body>` (focus lands on the active `<webview>` for a guest right-click). `[a11y]` |
| 9 | **Shift+F10 / ContextMenu-key (chrome-focused).** Focus a **chrome** element (the address bar `#address`: `click(wcId, x, y)` on it), then `pressKey(wcId, 'F10', ['shift'])` (or `pressKey(wcId, 'ContextMenu')`). Read the chrome. | An **Inspect-only** `#page-context-menu` opens anchored at that chrome element (the chrome-focused keyboard path: no guest params → just **Inspect**). `[a11y]` *(The in-guest Shift+F10 case is covered by the right-click steps — Chromium synthesizes a real guest `context-menu` event there — and is not separately scripted; the live in-guest keyboard render under a real display is HAT, see Out of Scope.)* |
| 10 | **No-op on internal pages.** Open/activate `goldfinch://settings`; record its `wcId`; `click(thatWcId, x, y, { button: 'right' })` on the page content. Read the chrome. | **No** `#page-context-menu` appears (it stays `.hidden`) — the whole wiring sits behind the main-side `!__goldfinchInternal` guard, so the internal guest never emits a forwarded `page-context-menu`. |
| 11 | **Toolbar Unpin migration — open the menu.** On the chrome, right-click `#toggle-media` (or `#toggle-privacy` / `#toggle-devtools`): `click(wcId, x, y, { button: 'right' })` on the button. Read the chrome. | `#page-context-menu` opens (anchored just below the button) with a **single "Unpin {Media\|Shields\|DevTools}"** `cm-item role="menuitem"` — the **in-DOM custom menu**, NOT a native Electron menu (the Leg-5 migration). `[a11y]` |
| 12 | **Toolbar Unpin migration — activate + persist.** `click(wcId, x, y)` the "Unpin {item}" menu item. Re-read the chrome toolbar (`readDom(wcId)` / `captureWindow()`), read `userData/settings.json` (filesystem), and read the settings guest's Appearance pin toggle (`readAxTree(guestWcId)`, if a settings tab is open). | The targeted toolbar button gets `.hidden` **immediately** (live flip); `userData/settings.json` `toolbarPins.{item} === false` (filesystem — persisted); the settings-page pin toggle for that item reflects unpinned (`aria-pressed="false"`) **live**; and focus lands on the address bar `#address` (not stranded on the hidden button / `<body>`). |

**Row conventions:** Row 2 is pure setup (no judgment). `[a11y]`-marked rows are accessibility-relevant
(picked up by the optional Accessibility Validator). Steps 3–6 are the per-section render coverage;
step 7 the cursor mapping; step 8 keyboard nav; step 9 the chrome-focused keyboard invocation; step 10
the internal no-op; steps 11–12 the migrated toolbar Unpin. Every Expected Result is a
`getChromeTarget`-readable DOM / a11y-tree / screenshot / filesystem observable — the WSLg-acceptance
discipline.

## Out of Scope

- **The menu's pixel-level on-brand *feel*** (dark/gold styling vs the native menu; corner radius, shadow,
  hover gold) — a visual judgment, **HAT-authoritative**. This spec asserts the menu's *presence,
  structure, items, position, and keyboard contract*, not its pixels.
- **The live in-guest Shift+F10 / ContextMenu-key keyboard render under a real display** — Chromium
  synthesizes a real guest `context-menu` event for the in-page keyboard case (Leg 4 finding), which flows
  through the same path the right-click steps exercise; the *live keyboard-driven render on a real GUI* is
  **HAT-authoritative** (not separately scripted here).
- **macOS native-menu suppression confirmation** (that `event.preventDefault()` actually suppresses the OS
  menu on macOS) — **macOS-authoritative**; on the MCP surface the negative observable is the absence of a
  chrome `#page-context-menu` only when expected, and the presence of the custom menu otherwise.
- **The Inspect → detached DevTools materialization** (Inspect routes through the `toggle-devtools` IPC
  path) — **macOS-authoritative**, covered by `devtools-cdp-conflict.md` (the CDP single-client conflict).
  This spec asserts that the **Inspect item renders**, not that the DevTools window opens.
- **Pin/persist/shortcut coverage for the toolbar buttons themselves** — owned by `toolbar-pins.md`
  (which now cross-references this spec for the right-click-Unpin path rather than duplicating it).
- **The `menuController` open/close/dismissal contract regression** — owned by `menu-dismissal.md` /
  `kebab-menu.md` (the page menu is the 4th consumer of the same controller).
- **The spellcheck opt-in / egress / squiggle / suggestion-correction round-trip** — owned by
  `spellcheck.md` (this spec asserts that an editable target *renders* an editable section + that a
  suggestions section *renders* when `params` carries a `misspelledWord`; the opt-in state machine and the
  correction plumbing are `spellcheck.md`'s).

## Variants (optional)

- Repeat steps 11–12 for each of **Media**, **Shields**, and **DevTools** (the single "Unpin {item}" label
  and the persisted `toolbarPins.{item}` differ per item; DevTools starts unpinned so pin it first).
- A **union target** (a linked image, or an editable field with a live selection): the menu shows **every**
  applicable section in order (link → image → selection → editable → spelling → Inspect), separators
  between groups, Inspect last.
