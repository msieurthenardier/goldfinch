# Leg: migrate-toolbar-unpin

**Status**: completed
**Flight**: [Custom Page Context Menu + Spellcheck](../flight.md)

## Objective

Migrate the toolbar right-click **Unpin** (for the Media / Shields / DevTools pinnable toolbar buttons)
**off the native Electron menu** (`Menu.buildFromTemplate` + `menu.popup`) and **onto the custom
`#page-context-menu` component** built in Leg 4 — invoked in a new **toolbar-mode** that renders a single
**"Unpin {Media|Shields|DevTools}"** item, anchored at the toolbar button, reusing the component's
positioning, APG keyboard contract, and focus-return.

Because the chrome renderer cannot reach the existing settings-write IPC (`internal-settings-set` is
origin-gated to `goldfinch://settings`, and the chrome preload exposes only `settingsGet`/
`onSettingsChanged`), add a **new narrow chrome-trusted one-way IPC `unpinToolbarItem(item)`** + preload
bridge (DD4 architect HIGH fix). Its main-side handler does the **same write + broadcast** the native
handler did — read-merge `toolbarPins`, `settings.set('toolbarPins', …)`, then
`broadcastToChromeAndInternal('settings-changed', …)` — so the live two-way pin sync (`applyToolbarPins`
reacting to `settings-changed`) is preserved with no staleness hole.

Then **retire** the native `toolbar-context-menu` IPC handler + the `toolbarContextMenu` preload bridge,
remove the now-dead `Menu` electron import, and rewire the three renderer `contextmenu` listeners onto the
new toolbar-mode invocation. This **closes the M02 Known Issue** (native-menu clumsiness against the
dark/gold chrome) and completes SC6's "the existing toolbar right-click (Unpin) is migrated onto the same
component, retiring the native menu."

This leg depends on Leg 4 (`context-menu-component`, landed): the `#page-context-menu` node, the
`pageContextEntry` menuController consumer, `buildPageContextSections`, `positionPageContextMenu`, the
`pageCtx` state, and the additive `focusReturn?` option all exist.

## Context

**DD4** (flight spec, verbatim):
> **DD4 — Migrate the toolbar Unpin (Media/Shields/DevTools) off the native menu onto the custom
> component.** Replace `Menu.buildFromTemplate`+`menu.popup` (`main.js:985-996`) and the three renderer
> `contextmenu` listeners (`renderer.js:988/1567/1591` → `window.goldfinch.toolbarContextMenu`) with a
> custom menu rendering driven by the same component (a toolbar-mode invocation with a single "Unpin
> {Media|Shields|DevTools}" item). Retire the `toolbar-context-menu` IPC handler + the `toolbarContextMenu`
> preload bridge. Closes the M02 Known Issue (native-menu clumsiness against the dark/gold chrome).
> - Rationale: SC6 explicitly requires retiring the native menu; consolidating both right-click surfaces
>   on one component is the point.
> - **Write-path fix (architect [HIGH]):** the renderer CANNOT use the existing settings-write IPC —
>   `internal-settings-set` (`src/main/main.js:792`) is origin-gated to `goldfinch://settings`
>   (`__goldfinchInternal`), and the chrome preload deliberately exposes only `settingsGet`/
>   `onSettingsChanged` (`chrome-preload.js:35-37`). Leg 4 adds a **new narrow chrome-trusted one-way IPC
>   `unpinToolbarItem(item)`** + preload bridge, mirroring the trust model of the retiring
>   `toolbar-context-menu` send (same domain as `window-minimize`/`app-quit`; no origin check; NOT a
>   general settings-write surface — keep the boundary narrow). Main's handler does
>   `settings.set('toolbarPins', {…, [item]: false})` + `broadcastToChromeAndInternal('settings-changed', …)`
>   — the **same** write+broadcast the native handler did, so the live two-way pin sync (`applyToolbarPins`
>   reacting to `settings-changed`, `renderer.js:1746-1748`) is preserved with no staleness hole.
> - Trade-off: one new narrow chrome IPC + bridge replacing the retired `toolbarContextMenu` send.

> *(DD4 attributes `unpinToolbarItem` to "Leg 4"; the live leg list and the flight Technical Approach put
> the toolbar migration — including this IPC + bridge — in this leg, `migrate-toolbar-unpin` = Leg 5. Leg 4
> built the page-content menu only and explicitly deferred the toolbar path: see Leg-4 artifact
> Implementation Guidance step 9, "Do NOT touch the native `toolbar-context-menu` handler — that is
> Leg 5.")*

**Leg-4 component dependency (the reuse surface this leg builds on, landed):**
- `els.pageContextMenu` (the `#page-context-menu` node), the `pageContextEntry =
  menuController.register({…})` 4th consumer, the module-scoped `pageCtx` state
  (`{ wcId, params, x, y, returnFocus, keyboard }`), `buildPageContextSections(ctx)` (reads `ctx.params`),
  `positionPageContextMenu(px, py, keyboard)` (maps guest coords to chrome client coords; **`keyboard:true`
  skips the webview offset and treats `px`/`py` as chrome client coords**), `closePageContextMenu()`, and
  the additive `focusReturn?` option (the controller calls `entry.focusReturn()` instead of
  `entry.trigger.focus()` on Escape/Tab close). All confirmed present (Citation Audit).
- The component already supports a **chrome-anchored, keyboard-driven** open: the Shift+F10 / ContextMenu
  chrome-focus handler (`renderer.js:740-759`) sets `pageCtx.keyboard = true`, derives `x`/`y` from a chrome
  element's `getBoundingClientRect()`, sets `returnFocus` to the focused element, and calls
  `menuController.open(pageContextEntry, 0)` — **this is the exact shape toolbar-mode needs**.

**M02 Known Issue (closed by this leg):** the toolbar right-click Unpin used a **native Electron menu**
(`Menu.popup`), which renders in the OS theme and looks clumsy against Goldfinch's dark/gold chrome. SC6
calls for retiring it and consolidating both right-click surfaces (page + toolbar) onto the one on-brand
component.

**The settings write — read-modify-write is REQUIRED (not a plain merge), confirmed:**
- `settings.set(key, value)` does `config = { ...config, [key]: v }` — a **top-level REPLACE** of the
  `toolbarPins` object (`settings-store.js:307`).
- `NORMALIZERS.toolbarPins = (v) => ({ ...DEFAULTS.toolbarPins, ...v })` (`settings-store.js:151`) deep-merges
  the incoming value over **`DEFAULTS`** (media:true, shields:true, devtools:false), NOT over the current
  config. So passing a bare `{ devtools: false }` would **reset media/shields to their DEFAULTS**, silently
  re-pinning a previously-unpinned item.
- Therefore the handler MUST read-merge the *current* pins first, exactly as the native handler does:
  `{ ...settings.get('toolbarPins'), [item]: false }` (`main.js:1095`). This preserves the other two items'
  live state.

**The new IPC's trust posture (DD4 HIGH fix):** narrow, item-allowlisted (`{media, shields, devtools}`),
**one-way `ipcRenderer.send`**, **no origin gate** — same chrome-trust domain as `window-minimize` /
`app-quit` / `chrome-clipboard-write` / `zoom-apply` (the chrome `file://` renderer's `window.goldfinch`
surface). It is **NOT** a general settings-write surface: it writes exactly one nested boolean to
`toolbarPins[item] = false` for an allowlisted `item`, mirroring `page-context-action`'s fixed-allowlist
discipline (Leg 4). This replaces the equivalently-trusted `toolbar-context-menu` send being retired.

## Inputs

What exists before this leg runs (Legs 1–4 landed):

- `src/main/main.js:3` — `const { app, BrowserWindow, Menu, ipcMain, session, webContents, dialog, shell,
  protocol, net, clipboard } = require('electron');` — **`Menu` is destructured here and used ONLY by the
  native `toolbar-context-menu` handler** (`:1093`); confirmed via `grep -n "\bMenu\b" src/main/main.js`
  returns exactly `:3` (import) and `:1093` (the one use). After retirement `Menu` is dead.
- `src/main/main.js:1086-1101` — the native `toolbar-context-menu` handler:
  ```js
  // Right-click a pinned toolbar icon → native "Unpin {item}" context menu.
  ipcMain.on('toolbar-context-menu', (_e, item) => {
    if (!mainWindow) return;
    if (item !== 'media' && item !== 'shields' && item !== 'devtools') return;
    const label = 'Unpin ' + (item === 'media' ? 'Media' : item === 'shields' ? 'Shields' : 'DevTools');
    const menu = Menu.buildFromTemplate([
      { label, click: () => {
        const pins = { ...settings.get('toolbarPins'), [item]: false };
        settings.set('toolbarPins', pins);
        broadcastToChromeAndInternal('settings-changed', settings.getAll());
      } }
    ]);
    menu.popup({ window: mainWindow });
  });
  ```
  (Flight cited `:985-996`; the Leg-4 review found `:1061-1073`; **current verified line is `:1086-1101`**
  — the codebase shifted as Legs 1–4 added handlers. The click callback's write+broadcast — the
  read-merge `{ ...settings.get('toolbarPins'), [item]: false }`, `settings.set`, broadcast — is the exact
  logic the new `unpinToolbarItem` handler must reproduce.)
- `src/main/main.js:971` `ipcMain.on('window-minimize', …)`; `:983` `ipcMain.on('app-quit', …)`;
  `:991` `ipcMain.on('chrome-clipboard-write', …)`; `:997` `ipcMain.on('zoom-apply', …)` — the sibling
  **chrome-trusted one-way sends** (no origin gate) whose trust model the new IPC mirrors.
- `src/main/main.js:798-807` — `broadcastToChromeAndInternal(channel, payload)`: sends to `mainWindow`
  (chrome) + every internal (`__goldfinchInternal`) webContents. The settings page (internal) updates its
  pin toggles from this; the chrome `applyToolbarPins` updates the toolbar from it.
- `src/main/main.js:1080-1084` — the **`page-context-action` handler** (Leg 4): `webContents.fromId` →
  dead-guard → `isInternalContents` refuse → `PAGE_CONTEXT_ACTIONS.has(action)` allowlist → `wc[action]()`.
  The **fixed-allowlist discipline** the new handler mirrors (item-allowlist instead of action-allowlist).
- `src/main/settings-store.js:295-310` — `set(key, value)`: validate → normalize → `config = { ...config,
  [key]: v }` (top-level replace) → `save()`. `:151` `NORMALIZERS.toolbarPins = (v) => ({
  ...DEFAULTS.toolbarPins, ...v })` (merges over DEFAULTS, NOT current config). `:110` `VALIDATORS.toolbarPins`
  (lenient boolean-map). `DEFAULTS.toolbarPins = { media: true, shields: true, devtools: false }` (`:44`).
  `get('toolbarPins')` returns the current pins (`getAll`/`get` return deep copies, `:266-270`). **Confirms
  read-modify-write is mandatory.**
- `src/preload/chrome-preload.js:19` — `toolbarContextMenu: (item) => ipcRenderer.send('toolbar-context-menu',
  item)` — the bridge to **retire**. Siblings: `:15` `windowMinimize`, `:18` `appQuit`, `:106`
  `clipboardWriteText` (chrome-trusted one-way `send`s — the model for the new bridge). `:92`
  `pageContextAction` (allowlisted send precedent).
- `src/renderer/renderer.js:1264` — `els.toggleMedia.addEventListener('contextmenu', (e) => {
  e.preventDefault(); window.goldfinch.toolbarContextMenu('media'); });`
- `src/renderer/renderer.js:1843` — `els.togglePrivacy.addEventListener('contextmenu', (e) => {
  e.preventDefault(); window.goldfinch.toolbarContextMenu('shields'); });`
- `src/renderer/renderer.js:1867` — `els.toggleDevtools.addEventListener('contextmenu', (e) => {
  e.preventDefault(); window.goldfinch.toolbarContextMenu('devtools'); });`
  (Flight cited `:988/1567/1591`; Leg-4 review confirmed `:988/1567/1591`; **current verified lines are
  `:1264/1843/1867`** — the file shifted as Leg 4 added the page-context-menu block. These three are the
  ONLY `toolbarContextMenu` callers — `grep -n "toolbarContextMenu" src/renderer/renderer.js` returns
  exactly these three.)
- `src/renderer/renderer.js:2012-2018` — `applyToolbarPins(pins)`: toggles `.hidden` on
  `els.toggleMedia`/`els.togglePrivacy`/`els.toggleDevtools` by `pins.media`/`pins.shields`/`pins.devtools`.
- `src/renderer/renderer.js:2020` — `window.goldfinch.settingsGet('toolbarPins').then(applyToolbarPins)`
  (initial hydrate); `:2022-2025` — `window.goldfinch.onSettingsChanged((all) => { … if (all &&
  all.toolbarPins) applyToolbarPins(all.toolbarPins); })` — **the live two-way sync path** the broadcast
  feeds. (Flight cited `:1746-1748`; **current verified lines are `:2022-2025`**.)
- `src/renderer/renderer.js:23/42/43` — `els.toggleMedia` (`#toggle-media`), `els.togglePrivacy`
  (`#toggle-privacy`), `els.toggleDevtools` (`#toggle-devtools`) — the three toolbar buttons; each is a real,
  focusable `HTMLButtonElement` (a valid `returnFocus` target).
- `src/renderer/renderer.js:490-759` — **the Leg-4 page-context-menu block** (the reuse surface):
  `pageContextItems` (`:501`), `pageCtx` (`:510`), `buildPageContextSections` (`:537`),
  `positionPageContextMenu(px, py, keyboard)` (`:649`), `pageContextEntry = menuController.register({…})`
  (`:664`, with `onOpen`/`onClose`/`focusReturn`), `closePageContextMenu` (`:708`), the
  `onPageContextMenu` subscription (`:718`), the Shift+F10/ContextMenu chrome-focus handler (`:740-759`,
  the `keyboard:true` chrome-anchored open precedent).
- `src/renderer/renderer.js:537-639` — `buildPageContextSections(ctx)`: `m.innerHTML = ''` then builds
  sections from `ctx.params`; uses an `item(label, onClick)` helper (`:555`) that creates a `cm-item`
  `role="menuitem"` button, `textContent = label`, and an `onClick` that calls `closePageContextMenu()`
  **then** the action. Always appends **Inspect** last (`:636-638`). **Toolbar-mode must short-circuit this
  to a single Unpin item — see Implementation Guidance.**
- `src/preload/chrome-preload.js:10` — `contextBridge.exposeInMainWorld('goldfinch', {…})` — the bridge
  object the new `unpinToolbarItem` member is added to (and `toolbarContextMenu` removed from).
- `src/renderer/renderer-globals.d.ts:34-95` — the `GoldfinchBridge` interface: `:43`
  `toolbarContextMenu(item: string): void;` (to remove); add `unpinToolbarItem(item: string): void;`.
- `eslint.config.mjs` — checked: it does **not** enumerate the `goldfinch` bridge members (no
  `toolbarContextMenu`/`unpinToolbarItem` reference). `grep` returns nothing → **no eslint edit needed**;
  the d.ts is the only type-surface touch.
- `test/unit/automation-mcp-tools.test.js:72` (`listTools returns exactly the 26 tools`) +
  `test/unit/automation-mcp-server.test.js:251` (`tools/list returns 26 tools`) — the DD7 no-new-tool
  guard; this leg adds none.
- `tests/behavior/toolbar-pins.md` — references the **native** right-click unpin (step 14, DevTools
  right-click → "native context menu"; Out-of-Scope notes Media/Shields right-click is HAT-only "because
  the native Electron menu is not in the renderer DOM"). **This spec's migrated-path update is Leg 6's
  scope** (flight Technical Approach: "update `tests/behavior/toolbar-pins.md` for the migrated unpin
  path") — note it here; do NOT edit it in this leg.

## Outputs

What exists after this leg completes:

- `src/main/main.js` — a new **`ipcMain.on('unpin-toolbar-item', …)`** handler (chrome-trusted one-way,
  item-allowlisted): validate `item ∈ {media, shields, devtools}` → read-merge `{
  ...settings.get('toolbarPins'), [item]: false }` → `settings.set('toolbarPins', pins)` →
  `broadcastToChromeAndInternal('settings-changed', settings.getAll())`. The native
  `ipcMain.on('toolbar-context-menu', …)` handler (`:1086-1101`) is **removed**. `Menu` is **removed from
  the electron destructuring import** (`:3`) — it is dead after retirement.
- `src/preload/chrome-preload.js` — `unpinToolbarItem: (item) => ipcRenderer.send('unpin-toolbar-item',
  item)` added (beside the window-control sends); `toolbarContextMenu` (`:19`) **removed**.
- `src/renderer/renderer.js` — a new **toolbar-mode invocation** of the Leg-4 component:
  `openToolbarContextMenu(item, anchorEl)` (a small function that sets `pageCtx` for a single-item Unpin
  menu anchored at the button rect and calls `menuController.open(pageContextEntry, 0)`), plus a minimal
  **toolbar-mode branch in `buildPageContextSections`** (or an equivalent reuse — see Implementation
  Guidance) that renders the single "Unpin {label}" item → `window.goldfinch.unpinToolbarItem(item)`. The
  three `contextmenu` listeners (`:1264/1843/1867`) are **rewired** from
  `window.goldfinch.toolbarContextMenu(item)` to `openToolbarContextMenu(item, <the button>)`.
- `src/renderer/renderer-globals.d.ts` — `unpinToolbarItem(item: string): void;` added to
  `GoldfinchBridge`; `toolbarContextMenu(item: string): void;` (`:43`) removed.
- **No new MCP tool**; tool count unchanged (still **26**, DD7).
- `flight-log.md` — Leg 5 progress entry (the toolbar-mode reuse approach, the read-modify-write
  confirmation, the dead-`Menu`-import removal, the live-sync preservation verification).
- **NOT touched:** `src/main/automation/mcp-tools.js` (tool count 26); `tests/behavior/*` /
  `tests/behavior/toolbar-pins.md` (Leg 6); README / CLAUDE.md (Leg 6); `eslint.config.mjs` (no bridge
  enumeration there). The page-content menu sections (Leg 4) are reused, not modified beyond the
  toolbar-mode branch.

## Acceptance Criteria

- [x] Toolbar right-click **Unpin** (Media / Shields / DevTools) opens the **custom `#page-context-menu`
  component** (the Leg-4 menuController consumer), NOT a native Electron menu — rendered on-brand
  (dark/gold chrome), with a single **"Unpin {Media|Shields|DevTools}"** `role="menuitem"` item, anchored
  at the right-clicked toolbar button. The native `Menu.buildFromTemplate`/`menu.popup` path is gone.
  *(Live on-brand render is HAT/Leg-6; code-path verified — reuses the same `cm-item` markup.)*
- [x] The component is **reused, not duplicated or forked**: the same `pageContextEntry` /
  `menuController.open` / `positionPageContextMenu` / `focusReturn` path serves toolbar-mode; there is **no
  second menu node, no second menuController registration**, and `menuController` is **not graduated**
  (DD3 honored).
- [x] A **new narrow chrome-trusted one-way IPC `unpinToolbarItem(item)`** + preload bridge exists:
  item-allowlisted (`{media, shields, devtools}`), `ipcRenderer.send` (one-way), **no origin gate** (same
  trust domain as `window-minimize`/`app-quit`/`chrome-clipboard-write`). Its main handler read-merges the
  current pins (`{ ...settings.get('toolbarPins'), [item]: false }`), `settings.set('toolbarPins', …)`,
  then `broadcastToChromeAndInternal('settings-changed', settings.getAll())` — the **same write+broadcast**
  the native handler did. It is **not** a general settings-write surface (rejects any non-allowlisted item;
  writes only the one nested boolean to `false`).
- [x] The native **`toolbar-context-menu` IPC handler** (`main.js`) and the **`toolbarContextMenu` preload
  bridge** (`chrome-preload.js`) + its `GoldfinchBridge` type entry are **removed** (no dangling references;
  `grep -rn "toolbar-context-menu\|toolbarContextMenu" src/` returns nothing).
- [x] **Pin state persists and the live two-way sync is preserved**: unpinning Media/Shields/DevTools via
  the right-click menu flips the toolbar **immediately** (the `settings-changed` broadcast → chrome
  `applyToolbarPins` hides the button) AND updates the settings page's pin toggle live (internal broadcast),
  AND **survives an app restart** (the `settings.set` persisted it). The other two items' pin state is
  **not** disturbed (read-modify-write, not a DEFAULTS-reset). *(Byte-for-byte the native broadcast; live
  flip/persistence is HAT/Leg-6.)*
- [x] The **M02 Known Issue is closed** — no native menu remains for the toolbar Unpin; both right-click
  surfaces (page content + toolbar) now render through the one on-brand component.
- [x] The toolbar Unpin menu is **on-brand and keyboard-operable**: APG keyboard nav via the inherited
  `menuController` contract (Enter/Space activate, Esc/Tab close), and **focus is never stranded on the
  hidden menu node nor on the just-unpinned (now hidden) button** — the Unpin action focuses `els.address`
  after the unpin send (since the anchoring button disappears); for a non-unpinning close, the inherited
  focus-return behavior applies. Verify a keyboard invocation path (see Edge Cases). *(Live keyboard path
  is HAT/Leg-6.)*
- [x] **Mode isolation**: both page-mode entry points (`onPageContextMenu` subscription + the Shift+F10/
  ContextMenu chrome-focus handler) reset `pageCtx.toolbarItem = null`, so a prior toolbar-mode Unpin can
  never leak a single-Unpin menu into a later page right-click (and vice-versa).
- [x] **No double-open on keyboard invocation**: the global Shift+F10/ContextMenu `keydown` handler
  returns early when `document.activeElement` is one of the three toolbar pin
  buttons, so a focused pin button + ContextMenu key opens ONLY the toolbar Unpin menu (the deterministic
  double-fire is gated, not left to runtime luck).
- [x] The now-unused **`Menu` electron import is removed** from the `require('electron')` destructuring in
  `main.js` (confirmed dead: the retired handler was its only consumer; `grep -n "\bMenu\b"
  src/main/main.js` → empty).
- [x] **No new MCP tool**; tool count unchanged — still **26** (DD7; `automation-mcp-tools.test.js` "26
  tools" + `automation-mcp-server.test.js` "26 tools" stay green).
- [x] `npm test` (879 pass / 0 fail), `npm run typecheck`, and `npm run lint` pass. `npm run a11y`
  **inconclusive under non-interactive WSLg** (needs live GUI + automation key — same fragility prior legs
  noted); static a11y satisfied (toolbar item reuses the a11y-passing page-menu `cm-item role="menuitem"`
  markup). Flagged for HAT.

## Verification Steps

- **Custom menu, native gone** (`npm run dev`): right-click `#toggle-media` → the on-brand custom menu
  appears with a single "Unpin Media" item (not the OS-theme native menu). Repeat for `#toggle-privacy`
  ("Unpin Shields") and `#toggle-devtools` ("Unpin DevTools"). Visually confirm dark/gold chrome matching
  the page context menu and `#kebab-menu`.
- **Live two-way sync**: with the menu open on Media, activate "Unpin Media" → the `#toggle-media` button
  disappears from the toolbar **immediately**. Open the settings page (`goldfinch://settings`, Appearance) →
  the Media pin toggle reads unpinned **live** (the internal broadcast). The other buttons are unaffected.
- **Persistence across restart**: after unpinning Media via right-click, quit and relaunch (`npm run dev`)
  → Media stays unpinned (the `settings.set` persisted). Re-pin via Settings → Appearance to reset.
- **Other items undisturbed (read-modify-write)**: unpin Media via right-click (Shields still pinned),
  then unpin Shields via right-click → Media stays unpinned (NOT re-pinned to its DEFAULT). Confirms the
  handler read-merges current pins rather than resetting to DEFAULTS.
- **Keyboard**: open the toolbar Unpin menu (right-click or the keyboard invocation path — see Edge Cases),
  Enter/Space on "Unpin {item}" activates; Esc closes → **focus returns to the toolbar button** (when the
  button is still visible) or the documented fallback when it was just unpinned (and is now hidden).
- **Trust posture / allowlist**: by inspection, the `unpin-toolbar-item` handler rejects an item not in
  `{media, shields, devtools}` and writes only `toolbarPins[item] = false`. It is a one-way `send` with no
  origin gate (chrome-trust domain, like `window-minimize`/`app-quit`).
- **No dangling refs**: `grep -rn "toolbar-context-menu\|toolbarContextMenu" src/` → empty;
  `grep -n "\bMenu\b" src/main/main.js` → empty (import removed); `grep -rn "unpin-toolbar-item\|
  unpinToolbarItem" src/` → the new handler, bridge, d.ts entry, and the three rewired listeners.
- **3-consumer + page-menu regression**: the container picker, kebab overflow, site-info popup, and the
  Leg-4 page-content context menu still open/close/keyboard-navigate correctly (the component was reused,
  not broken).
- **a11y / tool count**: `npm run a11y` (no new violations); `npm run dev:automation` advertises 26 tools;
  `npm test` / `npm run typecheck` / `npm run lint`.

## Implementation Guidance

1. **Add the new main-side IPC handler** (`src/main/main.js`, replacing the native handler at
   `:1086-1101`). Mirror the sibling chrome-trusted sends (`window-minimize`/`app-quit`/
   `chrome-clipboard-write`) and `page-context-action`'s allowlist discipline:
   ```js
   // Unpin a toolbar item from the custom toolbar-mode context menu (Leg 5; replaces the retired
   // native `toolbar-context-menu` Menu.popup). Chrome-trusted one-way send — same trust domain as
   // window-minimize/app-quit/chrome-clipboard-write (no origin check). NOT a general settings-write
   // surface: item-allowlisted, writes only toolbarPins[item] = false. Same write+broadcast the native
   // handler did, so applyToolbarPins' settings-changed reaction keeps the toolbar in sync live.
   ipcMain.on('unpin-toolbar-item', (_e, item) => {
     if (item !== 'media' && item !== 'shields' && item !== 'devtools') return;  // fixed allowlist
     const pins = { ...settings.get('toolbarPins'), [item]: false };             // READ-MERGE current
     settings.set('toolbarPins', pins);
     broadcastToChromeAndInternal('settings-changed', settings.getAll());
   });
   ```
   **Critical — read-modify-write, NOT a bare object.** `settings.set` top-level *replaces* `toolbarPins`,
   and the normalizer merges over `DEFAULTS` (not current config), so a bare `{ [item]: false }` would
   reset the other two items to their DEFAULTS (re-pinning a previously-unpinned one). The
   `{ ...settings.get('toolbarPins'), [item]: false }` read-merge is the verified-correct pattern (it is
   exactly what the native handler's click callback did). Do **not** drop the spread. **Deliberate omission
   (design-review):** the native handler had an `if (!mainWindow) return;` guard — that was only needed
   because it called `menu.popup({ window: mainWindow })`. The new handler never touches `mainWindow`, so the
   guard is correctly dropped; a reviewer should not flag its absence as a regression.

2. **Add the preload bridge** (`src/preload/chrome-preload.js`), beside the window-control sends (where
   `toolbarContextMenu` was, `:19`):
   ```js
   unpinToolbarItem: (item) => ipcRenderer.send('unpin-toolbar-item', item),
   ```
   and **remove** `toolbarContextMenu: (item) => ipcRenderer.send('toolbar-context-menu', item)` (`:19`).

3. **Toolbar-mode invocation of the Leg-4 component — the crux (reuse, do NOT duplicate).** The component
   already exposes everything needed: `pageCtx`, `buildPageContextSections`, `positionPageContextMenu`
   (with the `keyboard`-mode chrome-coords branch), `pageContextEntry`/`menuController.open`, and
   `focusReturn`. The cleanest reuse adds **one state field** to drive the build, and **one small
   open-helper** — no second menu, no second registration, no controller fork:

   **3a. Mark toolbar-mode in `pageCtx`.** Add a `toolbarItem` field to the `pageCtx` object literal
   (`renderer.js:510`):
   ```js
   const pageCtx = { wcId: null, params: null, x: 0, y: 0, returnFocus: null, keyboard: false,
     toolbarItem: null };  // 'media' | 'shields' | 'devtools' | null  (null = page-content mode)
   ```
   Page-content invocations (the `onPageContextMenu` subscription `:718`, the Shift+F10 handler `:740`)
   must set `pageCtx.toolbarItem = null` so they stay in page mode (add the reset to both — they currently
   only set the page-mode fields; an explicit `toolbarItem = null` keeps the two modes mutually exclusive
   across re-opens, since `pageCtx` is shared module state).

   **3b. Short-circuit `buildPageContextSections` to the single Unpin item in toolbar-mode.** At the top of
   `buildPageContextSections(ctx)` (`:537`, after `m.innerHTML = ''`), branch on `ctx.toolbarItem`:
   ```js
   if (ctx.toolbarItem) {
     const itm = ctx.toolbarItem;            // capture: ctx.toolbarItem may be reset before the click fires
     const label = 'Unpin ' + (itm === 'media' ? 'Media'
       : itm === 'shields' ? 'Shields' : 'DevTools');
     // reuse the existing `item(label, onClick)` helper so the menuitem markup, cm-item class,
     // role, textContent, and close-then-act wiring are IDENTICAL to the page-menu items:
     item(label, () => {
       window.goldfinch.unpinToolbarItem(itm);
       // FOCUS FIX (design-review HIGH): unpinning HIDES the button this menu was anchored to, so the
       //   close-path focus-return (onClose → button.focus()) would focus an about-to-be-hidden element
       //   and strand focus on <body>. Route focus to the address bar explicitly here, in the action,
       //   AFTER the unpin send. This runs regardless of mouse-vs-keyboard close (onClose's button focus
       //   is then harmless/overridden). See the Focus-return edge case.
       els.address.focus();
     });
     return;  // toolbar-mode is single-item: no page sections, no Inspect
   }
   // …existing page-content sections (link/image/selection/editable/suggestions/Inspect)…
   ```
   The `item(...)` helper already wires `closePageContextMenu()` then the action (so the menu closes, then
   the action runs) and builds the on-brand `cm-item role="menuitem"` button — reusing it means the toolbar
   Unpin item is visually and behaviorally identical to the page menu's items. (Hoist or keep `item`
   accessible at the top of the function — it is currently a local `const`; place the toolbar branch
   immediately **after** the `sep`/`item` helper definitions, e.g. right after the `item` definition.)
   **Why focus is handled in the action, not the close path (design-review HIGH):** a mouse click closes via
   `menuController.close` → `closeEntry` → **`onClose` only** (it does NOT call `focusReturn`, which fires
   only on keyboard Escape/Tab). `onClose` focuses `pageCtx.returnFocus` (the button) unconditionally, with
   no `.hidden` guard — and even a `.hidden` guard wouldn't help, because the button is still **visible** at
   close time (the unpin broadcast round-trips async and hides it ~immediately after). So the only reliable
   landing spot for the just-unpinned-button case is to focus `els.address` inside the Unpin action itself
   (above), after the send. This makes the focus behavior correct on both the mouse and keyboard close paths.

   **3c. The open-helper.** Add (near the page-context wiring, ~`:759`):
   ```js
   /**
    * Toolbar-mode invocation of the page context menu: a single "Unpin {item}" item anchored at the
    * right-clicked toolbar button. Reuses the Leg-4 component (pageContextEntry / positioning / keyboard
    * contract / focus-return) — no second menu, no second registration.
    * @param {'media'|'shields'|'devtools'} item
    * @param {HTMLElement} anchorEl  the toolbar button right-clicked
    */
   function openToolbarContextMenu(item, anchorEl) {
     const r = anchorEl.getBoundingClientRect();
     pageCtx.toolbarItem = item;
     pageCtx.params = null;
     pageCtx.wcId = null;                 // toolbar Unpin needs no guest wcId (chrome-only write)
     pageCtx.x = Math.round(r.left);      // chrome client coords (keyboard-mode skips the webview offset)
     pageCtx.y = Math.round(r.bottom);    // open just below the button
     pageCtx.keyboard = true;             // positionPageContextMenu treats x/y as chrome client coords
     pageCtx.returnFocus = anchorEl;      // focusReturn() returns to the button (keyboard-mode branch)
     menuController.open(pageContextEntry, 0);
   }
   ```
   Reusing **`keyboard: true`** is the key insight: `positionPageContextMenu(px, py, keyboard)` skips the
   active-webview offset and treats `px`/`py` as chrome client coords when `keyboard` is truthy
   (`renderer.js:651`) — exactly right for a chrome toolbar button anchor (the click is on the chrome, not
   in a guest). The viewport clamp still applies. And the `focusReturn` `keyboard`-branch (`:699-704`)
   returns focus to the captured `returnFocus` element (the button) rather than the webview — correct for a
   chrome-anchored menu. **No `menuController` change is needed** (the additive `focusReturn` option already
   landed in Leg 4).

4. **Rewire the three `contextmenu` listeners** (`renderer.js:1264/1843/1867`) from the retired bridge to
   the new helper:
   ```js
   els.toggleMedia.addEventListener('contextmenu',     (e) => { e.preventDefault(); openToolbarContextMenu('media',    els.toggleMedia); });
   els.togglePrivacy.addEventListener('contextmenu',   (e) => { e.preventDefault(); openToolbarContextMenu('shields',  els.togglePrivacy); });
   els.toggleDevtools.addEventListener('contextmenu',  (e) => { e.preventDefault(); openToolbarContextMenu('devtools', els.toggleDevtools); });
   ```
   (Keep `e.preventDefault()` so the native OS menu is still suppressed on the chrome `file://` document.)

5. **Retire the native handler + the `Menu` import.** Delete the `ipcMain.on('toolbar-context-menu', …)`
   block (`main.js:1086-1101`). Then **remove `Menu` from the destructuring import** (`main.js:3`): after
   the handler is gone, `Menu` has no other consumer (verified: `grep -n "\bMenu\b" src/main/main.js`
   returns only `:3` and `:1093` today). Re-run the grep after the edit to confirm zero matches. Leaving
   `Menu` imported-but-unused would trip lint (`no-unused-vars`).

6. **Remove the `toolbarContextMenu` type entry** from `GoldfinchBridge`
   (`renderer-globals.d.ts:43`) and add `unpinToolbarItem(item: string): void;` in its place (the
   window-controls group). `eslint.config.mjs` does not enumerate bridge members (verified) — no edit there.

7. **Preserve the live two-way sync (verify, don't re-implement).** The sync path is already complete and
   unchanged: the new handler's `broadcastToChromeAndInternal('settings-changed', settings.getAll())` feeds
   the chrome `onSettingsChanged` subscription (`renderer.js:2022-2025`) → `applyToolbarPins(all.toolbarPins)`
   → the button's `.hidden` flips; the same broadcast reaches the internal settings page so its pin toggle
   updates. This is **byte-for-byte the same broadcast** the native handler emitted, so no staleness hole is
   introduced. Verify in `npm run dev` (Verification Steps) that the toolbar flips immediately and the
   settings page reflects it.

8. **Do NOT** add an MCP tool (DD7). **Do NOT** graduate `menuController` (DD3) — toolbar-mode reuses the
   existing 4th consumer in place. **Do NOT** edit `tests/behavior/toolbar-pins.md` / README / CLAUDE.md
   (Leg 6). **Do NOT** add a second menu node or a second `menuController.register` — the whole point is
   one component.

9. **Update `flight-log.md`** with the Leg 5 entry: the toolbar-mode reuse approach (the `toolbarItem`
   field + `buildPageContextSections` short-circuit + `openToolbarContextMenu` using `keyboard`-mode
   coords), the read-modify-write confirmation (and why a bare object would corrupt the other pins), the
   `Menu` dead-import removal, and the live-sync-preserved verification. These are the hand-off facts Leg 6
   (which updates `toolbar-pins.md` for the migrated path) depends on.

## Edge Cases

- **Only one item pinned / a single item already unpinned** — the toolbar-mode menu shows exactly one
  "Unpin {item}" item for the button right-clicked, regardless of the other items' state. A button that is
  already unpinned is `.hidden` (cannot be right-clicked), so no "Unpin" can target it. Unpinning the last
  visible item is allowed (the toolbar may show zero pinnable items) — see "all three unpinned" below.
- **All three unpinned** — once Media/Shields/DevTools are all unpinned, all three buttons are `.hidden`
  (the `applyToolbarPins` toggle); there is no toolbar button left to right-click, so the toolbar Unpin
  menu has no entry point. Re-pinning is done from Settings → Appearance (the inverse path, Flight-7-era;
  unchanged by this leg). This is expected and acceptable — the right-click menu only *unpins*.
- **Keyboard invocation of the toolbar context menu** — `contextmenu` is dispatched by the browser for the
  **keyboard ContextMenu key / Shift+F10** when a chrome element is focused (not only by mouse right-click),
  so focusing a toolbar button and pressing the ContextMenu key fires the same `contextmenu` listener → the
  same `openToolbarContextMenu(item, button)`. Confirm in `npm run dev` (Verification Steps). The chrome-focus
  Shift+F10 handler at `renderer.js:740-759` is for the **page** menu (it opens an Inspect-only menu on the
  active web tab) — it must remain page-mode (`pageCtx.toolbarItem = null`); ensure the toolbar `contextmenu`
  listeners fire *before*/independently and that the two paths don't double-open (a `contextmenu` on a toolbar
  button calls `e.preventDefault()` and opens the toolbar menu; the global `keydown` ContextMenu/Shift+F10
  handler (`:740-759`) would ALSO fire. **The ContextMenu key double-fires deterministically** when a pin
  button is focused (both a `contextmenu` event AND a `keydown` reach their listeners), so this is not a
  maybe — **gate the global Shift+F10/ContextMenu handler as the DEFAULT** (design-review): at its top, skip
  (return early) when `document.activeElement` is one of the three toolbar pin buttons (`els.toggleMedia`/
  `els.togglePrivacy`/`els.toggleDevtools`), so only the toolbar `contextmenu` path opens. Do not leave this
  as a runtime "if observed" — wire the gate. Confirm the resulting single-open in `npm run dev`.)
- **Focus-return to the just-unpinned button (design-review HIGH — resolved).** The Unpin action HIDES the
  button the menu was anchored to, so close-path focus-return cannot reliably land on it. **Critical subtlety
  the close path exposes:** a **mouse click** closes via `menuController.close → closeEntry → `onClose` ONLY`
  — it does NOT call `focusReturn` (that fires only on keyboard Escape/Tab). `onClose` (`renderer.js:685`)
  focuses `pageCtx.returnFocus` = the button **unconditionally, with no `.hidden` guard** — and even adding a
  `.hidden` guard there wouldn't help, because the button is still **visible** at close time (the unpin
  broadcast round-trips async and `applyToolbarPins` hides it ~immediately *after*). So a close-path guard
  fixes nothing. **Resolution: focus `els.address` inside the Unpin action itself** (Implementation Guidance
  3b), after the `unpinToolbarItem` send — this runs on both the mouse and keyboard close paths and is the
  only spot that reliably lands focus off the disappearing button. (`onClose`/`focusReturn` focusing the
  still-visible button first is then harmless — the action's `els.address.focus()` is the final focus.) Do
  NOT rely on a `focusReturn` `.hidden` fallback for this case.
- **The menu opening at the button vs. cursor** — toolbar-mode anchors at the **button rect** (`r.left`,
  `r.bottom` → just below the button), NOT the mouse cursor, because the invocation may be keyboard-driven
  (no cursor) and a button-anchored menu reads correctly for both mouse and keyboard. This differs from the
  page menu (cursor-anchored via guest `params.x/y`) — the `keyboard`-mode coords path handles it. The
  viewport clamp (`positionPageContextMenu`) still prevents clipping near the right/bottom edge.
- **Re-open / mode switch** — `pageCtx` is shared module state across page-mode and toolbar-mode.
  `menuController.open` runs `closeAll()` first (mutual exclusion), so a toolbar right-click while the page
  menu is open closes it and re-opens in toolbar-mode (and vice-versa). The `toolbarItem = null` resets in
  the page-mode invocations (3a) keep a stale `toolbarItem` from leaking a single-Unpin menu into a later
  page right-click — **verify both page-mode entry points reset it.**
- **`isInternalContents` / wcId N/A** — toolbar Unpin is a **chrome-side settings write**, not a guest
  action. It needs no `wcId` and no internal-page guard (it never touches a guest webContents). `pageCtx.wcId
  = null` in toolbar-mode is correct; the single Unpin item's handler ignores `wcId` entirely. (Contrast the
  page menu's Inspect/edit/correct items, which DO carry `wcId` — those sections are skipped in toolbar-mode
  by the short-circuit return.)
- **Item-allowlist rejection** — the main handler silently `return`s for any `item` not in `{media, shields,
  devtools}` (mirrors the native handler's guard and `page-context-action`'s allowlist). A malformed send
  writes nothing — the narrow boundary holds.

## Files Affected

- `src/main/main.js` — remove the native `ipcMain.on('toolbar-context-menu', …)` handler (`:1086-1101`);
  add the `ipcMain.on('unpin-toolbar-item', …)` handler (allowlisted, read-merge + set + broadcast); remove
  the now-dead `Menu` from the `require('electron')` destructuring (`:3`).
- `src/preload/chrome-preload.js` — add `unpinToolbarItem` send; remove the `toolbarContextMenu` bridge
  (`:19`).
- `src/renderer/renderer.js` — add `toolbarItem` to `pageCtx` (`:510`) + reset it in the two page-mode entry
  points (`onPageContextMenu` `:718`, the Shift+F10 handler `:740`); a toolbar-mode short-circuit in
  `buildPageContextSections` (`:537`); the `openToolbarContextMenu(item, anchorEl)` helper; rewire the three
  `contextmenu` listeners (`:1264/1843/1867`) to it; (if needed for the focus-return edge case) a hidden-button
  fallback in the component's `focusReturn`.
- `src/renderer/renderer-globals.d.ts` — remove `toolbarContextMenu` (`:43`), add `unpinToolbarItem(item:
  string): void;`.
- `flight-log.md` — Leg 5 progress entry (reuse approach, read-modify-write, dead-`Menu` removal, live-sync
  preserved).
- **NOT touched:** `src/main/automation/mcp-tools.js` (tool count 26); `tests/behavior/*` /
  `tests/behavior/toolbar-pins.md`, README, CLAUDE.md (Leg 6); `eslint.config.mjs` (no bridge enumeration);
  `src/main/settings-store.js` (the set/normalizer semantics are reused as-is, not changed).

---

## Post-Completion Checklist

*(Deferred-commit workflow: land the leg `in-flight`→`landed`, update the flight log, do NOT commit or
signal `[COMPLETE:leg]`/`[HANDOFF:review-needed]` — flight-level review happens after the last autonomous
leg.)*

- [x] All acceptance criteria verified (live-UI checks flagged for HAT/Leg-6; everything else code-verified)
- [x] Tests passing (`npm test` 879/0, `npm run typecheck`, `npm run lint`; `npm run a11y` inconclusive
  under non-interactive WSLg — static a11y satisfied, flagged for HAT)
- [x] Component reuse confirmed (one menu node, one menuController registration; container/kebab/site-info
  + the Leg-4 page menu still work — regression by code-path analysis)
- [x] `grep -rn "toolbar-context-menu\|toolbarContextMenu" src/` empty; `grep -n "\bMenu\b" src/main/main.js`
  empty (dead import removed); tool count 26 confirmed
- [x] Update `flight-log.md` with the Leg 5 entry (toolbar-mode reuse approach; read-modify-write rationale;
  `Menu` dead-import removal; live two-way sync preserved)
- [x] Set this leg's status to `landed` (deferred-commit workflow)
- [x] Do NOT signal `[HANDOFF:review-needed]` per-leg — flight-level review happens after the last
  autonomous leg

## Citation Audit

All citations verified against current code at leg design time (`OK`). The codebase shifted across Legs 1–4;
where the flight spec / Leg-4 review cited stale line numbers, the **current** verified line is given.

- `src/main/main.js:3` — `const { app, BrowserWindow, Menu, ipcMain, session, webContents, dialog, shell,
  protocol, net, clipboard } = require('electron');` — **OK**. `grep -n "\bMenu\b" src/main/main.js` returns
  **exactly `:3` (import) and `:1093` (the one use)** → `Menu` is dead after the handler is retired and must
  be removed from the import. `clipboard` STAYS (used by `chrome-clipboard-write` `:992`).
- `src/main/main.js:1086-1101` — the native `toolbar-context-menu` handler
  (`Menu.buildFromTemplate`+`menu.popup`; click callback does `{ ...settings.get('toolbarPins'), [item]:
  false }` → `settings.set` → `broadcastToChromeAndInternal('settings-changed', settings.getAll())`) — **OK,
  exact**. *(Flight cited `:985-996`; Leg-4 review cited `:1061-1073`; current is `:1086-1101` — STALE in
  both; verified current.)*
- `src/main/main.js:971` `window-minimize`; `:983` `app-quit`; `:991` `chrome-clipboard-write`; `:997`
  `zoom-apply` — **OK** (the chrome-trusted one-way `ipcMain.on` siblings, no origin gate — the trust-model
  mirror for `unpin-toolbar-item`).
- `src/main/main.js:798-807` — `broadcastToChromeAndInternal(channel, payload)` (sends to `mainWindow` +
  every `__goldfinchInternal` webContents) — **OK** (feeds both the chrome `applyToolbarPins` and the
  settings-page pin toggles; the new handler reuses it verbatim).
- `src/main/main.js:1080-1084` — `page-context-action` handler (`fromId` → dead-guard → `isInternalContents`
  refuse → `PAGE_CONTEXT_ACTIONS.has(action)` allowlist → `wc[action]()`) — **OK** (the fixed-allowlist
  discipline the new item-allowlist mirrors; Leg 4).
- `src/main/settings-store.js:295-310` — `set(key, value)`: `config = { ...config, [key]: v }` (top-level
  REPLACE) after `NORMALIZERS[key](value)`. `:151` `NORMALIZERS.toolbarPins = (v) => ({ ...DEFAULTS.toolbarPins,
  ...v })` (merges over **DEFAULTS**, not current config). `:110` `VALIDATORS.toolbarPins`. `:44`
  `DEFAULTS.toolbarPins = { media: true, shields: true, devtools: false }`. `:266-270` `get`/`getAll` return
  deep copies — **OK**. **CONFIRMS read-modify-write is mandatory**: a bare `{ [item]: false }` would reset
  the other two pins to DEFAULTS (re-pinning them). The native handler's `{ ...settings.get('toolbarPins'),
  [item]: false }` read-merge is the verified-correct pattern.
- `src/preload/chrome-preload.js:19` — `toolbarContextMenu: (item) => ipcRenderer.send('toolbar-context-menu',
  item)` — **OK** (to retire). `:15` `windowMinimize`, `:18` `appQuit`, `:106` `clipboardWriteText`, `:92`
  `pageContextAction` — **OK** (the one-way `send` bridge model for `unpinToolbarItem`).
- `src/renderer/renderer.js:1264` (`toggleMedia` `contextmenu` → `toolbarContextMenu('media')`); `:1843`
  (`togglePrivacy` → `'shields'`); `:1867` (`toggleDevtools` → `'devtools'`) — **OK, exact**. *(Flight + Leg-4
  review cited `:988/1567/1591`; current is `:1264/1843/1867` — STALE; verified current. `grep -n
  "toolbarContextMenu" src/renderer/renderer.js` returns exactly these three — the only callers.)*
- `src/renderer/renderer.js:2012-2018` — `applyToolbarPins(pins)` toggles `.hidden` on
  `els.toggleMedia`/`els.togglePrivacy`/`els.toggleDevtools` by `pins.media`/`pins.shields`/`pins.devtools`
  — **OK**.
- `src/renderer/renderer.js:2020` initial `settingsGet('toolbarPins').then(applyToolbarPins)`;
  `:2022-2025` `onSettingsChanged((all) => { … if (all && all.toolbarPins) applyToolbarPins(all.toolbarPins);
  })` — **OK** (the live two-way sync the broadcast feeds). *(Flight cited `:1746-1748`; current is
  `:2022-2025` — STALE; verified current.)*
- `src/renderer/renderer.js:23/42/43` — `els.toggleMedia` (`#toggle-media`), `els.togglePrivacy`
  (`#toggle-privacy`), `els.toggleDevtools` (`#toggle-devtools`) — **OK** (focusable `HTMLButtonElement`s, valid
  `returnFocus` anchors).
- `src/renderer/renderer.js:1258-1260` — the toolbar focus-restoration guard ("if the button is unpinned
  (hidden), .focus() is a silent no-op that strands focus on <body> — skip it when hidden") — **OK** (the
  documented precedent for the focus-return-to-unpinned-button edge case).
- `src/renderer/renderer.js:490-759` — the Leg-4 page-context-menu block: `pageContextItems` (`:501`),
  `pageCtx` (`:510`, `{ wcId, params, x, y, returnFocus, keyboard }`), `buildPageContextSections` (`:537`,
  `m.innerHTML=''` then sections via the local `item(label,onClick)` helper `:555` and `sep()` `:544`;
  Inspect always last `:636-638`), `positionPageContextMenu(px, py, keyboard)` (`:649`, **`keyboard`-truthy
  skips the webview offset and treats px/py as chrome client coords** `:651`, then clamps), `pageContextEntry
  = menuController.register({…})` (`:664`, `onOpen` `:672`, `onClose` `:685`, `focusReturn` `:696` with the
  `keyboard`-branch returning to `returnFocus` `:699-704`, falling back to `els.address`), `closePageContextMenu`
  (`:708`), `onPageContextMenu` subscription (`:718`, sets page-mode fields, `keyboard=false`), the Shift+F10/
  ContextMenu chrome-focus handler (`:740-759`, the `keyboard:true` chrome-anchored open precedent) — **OK,
  exact**. This is the full reuse surface; toolbar-mode adds a `toolbarItem` field + a `buildPageContextSections`
  short-circuit + an `openToolbarContextMenu` helper, no second menu/registration, no controller change.
- `src/renderer/renderer-globals.d.ts:34-95` — `GoldfinchBridge`; `:43` `toolbarContextMenu(item: string):
  void;` (to remove), add `unpinToolbarItem(item: string): void;` — **OK**.
- `eslint.config.mjs` — `grep` for `toolbarContextMenu`/`unpinToolbarItem`/`GoldfinchBridge` bridge members
  returns **nothing** → eslint does NOT enumerate the bridge; **no eslint edit needed** (the d.ts is the only
  type surface) — **OK**.
- `test/unit/automation-mcp-tools.test.js:72` (`listTools returns exactly the 26 tools`) +
  `test/unit/automation-mcp-server.test.js:251` (`tools/list returns 26 tools`) — **OK** (the DD7 no-new-tool
  guard; this leg adds none).
- `tests/behavior/toolbar-pins.md` — references the **native** right-click unpin (step 14 "native context
  menu" for DevTools; Out-of-Scope notes Media/Shields right-click is HAT-only "because the native Electron
  menu is not in the renderer DOM, not drivable over the MCP surface"). **OK** — these become testable on the
  migrated (in-DOM) component; **updating this spec for the migrated path is Leg 6's scope** (flight Technical
  Approach), NOT this leg. Noted as a hand-off.
- **Negative confirmations**: `grep -rn "unpin-toolbar-item\|unpinToolbarItem" src/` returns **nothing** (the
  IPC + bridge are net-new this leg). `grep -rn "toolbar-context-menu\|toolbarContextMenu" src/` returns the
  4 sites to retire (`main.js:1089`, `chrome-preload.js:19`, `renderer.js:1264/1843/1867`,
  `renderer-globals.d.ts:43`). `grep -rn "toolbar-context-menu\|toolbarContextMenu\|Menu.buildFromTemplate\|
  menu.popup\|unpin" test/` returns **nothing** in `test/` (no UNIT test references the retiring path) — only
  `tests/behavior/toolbar-pins.md` (Leg 6).
