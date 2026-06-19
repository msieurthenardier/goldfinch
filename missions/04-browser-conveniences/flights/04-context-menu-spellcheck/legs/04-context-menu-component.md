# Leg: context-menu-component

**Status**: completed
**Flight**: [Custom Page Context Menu + Spellcheck](../flight.md)

## Objective

Build the on-brand, keyboard-operable **custom page context menu** for web content. Add a new
`#page-context-menu` DOM node to the chrome (`index.html` + `styles.css`) and render it via the existing
**`menuController` as its 4th consumer** (extended **in place**, NOT graduated — DD3). The menu subscribes
to the Leg-1 `window.goldfinch.onPageContextMenu({ wcId, params })` IPC (NOT the `<webview>`-tag event —
Leg 1 deliberately wired the guest side so internal `goldfinch://` guests are auto-excluded main-side),
opens at the **cursor position**, and shows **context-appropriate sections** built per-invocation from the
forwarded `params`:

- **link** (`linkURL`): Open in new tab / Copy link
- **image** (`imageURL`/`srcURL`, `mediaType === 'image'`): Open image in new tab / Copy image address /
  Save image
- **selection** (`selectionText`): Copy / Search for "…"
- **editable** (`isEditable`, `editFlags`): Cut / Copy / Paste / (Undo / Redo if exposed), each gated by
  `editFlags`; **plus spelling suggestions** when `misspelledWord` is set (list `dictionarySuggestions`;
  choosing one round-trips through `window.goldfinch.correctMisspelling({ webContentsId: wcId, word })` —
  the Leg-1 channel)
- **always**: **Inspect** — routes through the existing Flight-3 `toggle-devtools` IPC path via
  `window.goldfinch.toggleDevtools({ webContentsId: wcId })` (NOT `devtools.js` directly; DD6)

The menu reuses the `menuController` APG keyboard contract unchanged (Enter/Space/Arrow/Esc/Tab/Home/End,
roving tabindex). Its differences — **cursor-position open**, **dynamic items rebuilt per invocation**, and
**no persistent trigger button** — are handled in its `onOpen`/`items`. a11y adds correct roles
(menu/menuitem), accessible names, roving tabindex, a **focus-return target** on close, and the
**Shift+F10 / ContextMenu-key** "open menu at the focused element/caret" invocation (menu-specific, handled
where the menu is wired — NOT via the Leg-3 `keydownToAction` mapper). Internal pages are already excluded
main-side (Leg 1), so the menu simply never fires for `goldfinch://`. **No MCP tool**; tool count stays 26
(DD7).

This leg introduces **new edit-action dispatch** (cut/copy/paste/undo/redo) that Leg 1 explicitly
deferred — see Implementation Guidance step 8 and the **Design decision for the reviewer** flagged there.

## Context

- **DD2** — Custom page context menu: guest `context-menu` event (main) → IPC → chrome renderer, rendered
  via `menuController`. Leg 1 (landed) wired the **guest `webContents`** side, forwarding the **whole**
  `params` via `mainWindow.webContents.send('page-context-menu', { wcId, params })`. This leg renders the
  `#page-context-menu` DOM node from that payload at the cursor position with context-appropriate sections.
- **DD3** — `menuController` is **extended in place as the 4th consumer; NOT graduated** to a shared
  module. It is renderer-DOM-coupled (closes over `document`, wires global `pointerdown`/`blur`). Register
  the context menu via `menuController.register({ trigger, menu, items, onOpen, onClose })`, reusing the APG
  keyboard contract unchanged. The cursor-position open, dynamic per-invocation items, and absence of a
  persistent trigger button are handled in `onOpen`/`items`. Graduation stays a future
  renderer-maintenance item.
- **DD6** — Web-content-only; the menu is inert/absent on internal pages; Inspect routes through the
  existing web-only DevTools path. The whole `context-menu` capture sits inside the `!__goldfinchInternal`
  guard in `main.js` (Leg 1), so internal guests never fire `page-context-menu` — the renderer inherits
  **no unguarded internal-page menu** and needs no renderer-side internal gate (Leg 1's spike record,
  step 89-102 of the flight log, confirms this is why the guest side was chosen over the tag path).
  **Inspect must go through the `toggle-devtools` IPC handler** (`main.js:1028`), which resolves the guest
  by `wcId` and refuses internal contents — NOT `src/main/devtools.js` directly (that helper is guard-free,
  "assumes a pre-guarded wc"). The correction round-trip (`replaceMisspelling`) likewise resolves by `wcId`
  and refuses the internal session (Leg-1 `page-context-correct`, TOCTOU discipline).
- **Leg-1 hand-off (authoritative, flight-log lines 61-120)** — the spike was **POSITIVE on both sides**;
  Leg 1 wired the **guest `webContents` → main → IPC** path. Therefore this leg subscribes to
  **`window.goldfinch.onPageContextMenu({ wcId, params })`** (NOT the `<webview>` tag). The correction
  round-trip is **`window.goldfinch.correctMisspelling({ webContentsId, word })`** → main
  `page-context-correct` → guest `replaceMisspelling`. Both bridges exist in `chrome-preload.js`
  (`:84`, `:89`). Internal pages are auto-excluded main-side. The forwarded `params` shape (observed,
  flight-log table lines 76-87) is `{ linkURL, imageURL/srcURL, mediaType, selectionText, isEditable,
  editFlags {canCut, canCopy, canPaste, canSelectAll, …}, misspelledWord, dictionarySuggestions, x, y }`.
- **Leg-1 deferral (explicit)** — Leg 1's `page-context-correct` channel performs `replaceMisspelling`
  **only**. The cut/copy/paste/undo/redo **edit-actions are NEW in this leg** and need their own dispatch
  (Implementation Guidance step 8). They are not subject to the misspelling-specific `word` guard, so they
  cannot ride the existing channel as-is.
- **Leg-2 hand-off** — Spellcheck is opt-in (default OFF), session-layer gated. When ON,
  `params.misspelledWord` / `params.dictionarySuggestions` populate on the guest `context-menu` event Leg 1
  forwards (Leg 1 observed them empty *only because spellcheck was OFF*). This leg renders the suggestions
  section + round-trips a chosen one through the Leg-1 correction channel. The user-facing squiggle wording
  is "new tabs; reload to enable on open tabs" (WSLg-inconclusive rendering — Leg-2 flight log); that does
  not change this leg's menu logic (the menu renders whatever `params.dictionarySuggestions` carries).
- **Leg-3 hand-off (no collision)** — Leg 3 extracted the pure `keydownToAction` mapper from the GLOBAL
  chrome shortcut keydown handler (`renderer.js:2256`). The context menu's internal nav (Arrow/Esc/Enter/
  Home/End) is `menuController`'s APG contract, NOT `keydownToAction`; the **Shift+F10 / ContextMenu-key**
  invocation is menu-specific and is wired where the menu is wired — it must NOT be added to the
  `keydownToAction` mapper (the test-seam leg is deliberately independent of this menu, flight DD5).
- **DD7** — No new MCP tools; tool count stays **26** (`mcp-tools.js` untouched;
  `automation-mcp-tools.test.js` "26 tools" stays green).
- This leg does NOT touch the native `toolbar-context-menu` path — that retirement / migration onto this
  component is **Leg 5** (`migrate-toolbar-unpin`). This leg builds the page-content menu only.

## Inputs

What exists before this leg runs (Legs 1, 2, 3 landed):

- `src/preload/chrome-preload.js` — `onPageContextMenu: (cb) => ipcRenderer.on('page-context-menu', …)`
  (`:84`); `correctMisspelling: ({ webContentsId, word }) => ipcRenderer.send('page-context-correct', …)`
  (`:89`); `toggleDevtools: ({ webContentsId }) => ipcRenderer.invoke('toggle-devtools', …)` (`:72`);
  `downloadMedia: (payload) => ipcRenderer.invoke('download-media', payload)` (`:24`). All confirmed
  present.
- `src/main/main.js` — guest `context-menu` listener forwarding `{ wcId, params }` inside the
  `!__goldfinchInternal` guard (`:441-446`); `page-context-correct` handler (`:1051-1056`,
  `fromId` → dead-guard → `isInternalContents` refuse → `replaceMisspelling` only); `toggle-devtools`
  handler (`:1028-1033`, `fromId` → dead-guard → `isInternalContents` refuse → `toggleDevTools(wc)`);
  `download-media` handler (`:459-476`, `fromId(webContentsId)` → `downloadURL(url)`); `clipboard.writeText`
  is imported (`:3`) but the `clipboard:write` IPC (`:897`) is **internal-origin-gated** (settings page
  only) — NOT reachable from the chrome renderer.
- `src/renderer/renderer.js` — the **`menuController` IIFE** (`:126-209`): `register({ trigger, menu,
  items?, onOpen?, onClose? })` (`:146-199`) pushes the entry, wires trigger keydown (Enter/Space/ArrowDown
  → open to first; ArrowUp → open to last, `:152-160`) and menu keydown (the full APG roving contract:
  Escape/Tab → close + focus trigger; Arrow/Home/End roving, guarded `if (!entry.items) return`,
  `:166-196`). Public API: `register`, `open(entry, startIndex)`, `close(entry)`, `closeAll`, `current`
  (`:200-208`). Global `pointerdown` outside-dismiss (`:218-224`) ignores clicks inside the open menu or on
  its trigger; global `blur` → `closeAll` (`:227`).
- `src/renderer/renderer.js` — the **three existing consumers**, each a `menuController.register({…})`
  call assigned to an `…Entry` const, with a DISTINCT thin public `close…()` wrapper that delegates to
  `menuController.close(entry)`:
  - **container picker** (`containerEntry`, `:253-302`): `trigger: els.newTabMenu`, `menu:
    els.containerMenu`, `items: containerItems` (`:247-249`, queries `[role="menuitem"]`); `onOpen` builds
    the items into `els.containerMenu.innerHTML`, shows (`classList.remove('hidden')`), anchors
    (`m.style.left = els.newTabMenu.getBoundingClientRect().left + 'px'`), sets `aria-expanded`, and calls
    `focusItem(items, startIndex === -1 ? items.length - 1 : startIndex)`; `onClose` hides + clears
    `aria-expanded`.
  - **kebab overflow** (`kebabEntry`, `:342-358`): static markup in `index.html`; `onOpen` shows +
    `positionKebabMenu()` (`:333-338`: anchors `top = rect.bottom + 4`, `right = innerWidth - rect.right`,
    `left = 'auto'`) + focus; `onClose` hides. Item click handlers wired separately (`:365-377`).
  - **site-info popup** (`siteInfoEntry`, `:446-460`): registered **WITHOUT** an `items` getter (the
    controller's roving keydown early-returns on `!entry.items`, `:167`); it is `role="dialog"`, supplies
    its **own** Escape/Tab keydown (`:477-483`) → `closeSiteInfo()` + `els.addressChip.focus()`. The
    precedent for a consumer that needs custom keyboard handling beyond the roving contract.
- `src/renderer/renderer.js` — `focusItem(items, i)` (`:328-332`): wraps the index
  (`((i % len) + len) % len`), applies **roving tabindex** (`tabIndex = j === n ? 0 : -1`), focuses
  `items[n]`. The shared roving/focus helper every menu consumer calls.
- `src/renderer/renderer.js` — `activeTab()` (`:627-629`), `isInternalTab(tab)` (`:632-639`),
  `createTab(url, container?, { trusted })` (`:487`, untrusted/web branch validates via `isSafeTabUrl`),
  `toUrl(input)` (`:880-886`, search = `https://www.google.com/search?q=${encodeURIComponent(s)}`),
  `currentHomePage()` (`:7`), `escapeHtml(s)` (`:2391`), `toast(title, body)` (`:2200`),
  `downloadItem(item, tab)` (`:1320-1327`, calls `downloadMedia({ webContentsId: tab.wcId, url,
  suggestedName })`), `openLightbox(item)` (`:1213-1229`) and its **`lbReturnFocus`** focus-return
  precedent (`:1211`, `:1214` captures `document.activeElement`).
- `src/renderer/renderer.js` — the global shortcut keydown dispatch (`:2256`, Leg 3) calling
  `keydownToAction(...)`. The Shift+F10/ContextMenu-key invocation must NOT be folded into it.
- `src/renderer/renderer.js` — `els` lookups (`:14-` block): `els.containerMenu` (`:17`), `els.webviews`
  (`:18`), `els.kebabMenu` (`:60`), `els.siteInfoPopup` (`:62`), `els.lightbox` (`:34`). The active tab's
  `<webview>` element is `activeTab().webview` (set in `createTab`, appended to `els.webviews`).
- `src/renderer/index.html` — the menu DOM block (`:42-48`): `#container-menu` (`role="menu"`),
  `#kebab-menu` (`role="menu"`, static items), `#site-info-popup` (`role="dialog"`). The new
  `#page-context-menu` node goes alongside these. `#main` (`:111`, `flex:1; position:relative`) contains
  `#webviews` (`:112`) then `#find-bar`, `#media-panel`. The CSS link is `styles.css` (`:10`).
- `src/renderer/styles.css` — `#container-menu`/`#kebab-menu` (`:1300-1325`, `position:absolute; z-index:60;
  background:var(--bg-3); border:1px solid var(--border); border-radius:8px; padding:6px; box-shadow:0 8px
  24px rgba(0,0,0,.5)`); `.cm-title` (`:1327`, presentation header), `.cm-item` (`:1334-1347`, the
  `role="menuitem"` button style), `.cm-item:hover` (`:1348`), `.cm-item.add` (`:1351`, with a top border —
  the section-separator precedent), `.cm-dot` (`:1424`). `#webviews webview` is `position:absolute;
  inset:0; width:100%; height:100%` (`:537-542`). `#lightbox` is `z-index:100` (`:958`); the context menu
  should sit at the menu tier (`z-index:60`, the other menus) — the lightbox is a modal above everything.
- `src/main/main.js:248-251` — `mainWindow` is `contextIsolation:true`, `nodeIntegration:false` with the
  `chrome-preload.js` preload. The chrome renderer has **no Node**, **no `require('electron')`**, and the
  `clipboard:write` IPC is internal-origin-gated — so it cannot write the OS clipboard directly. This
  drives the edit-action design (step 8).

## Outputs

What exists after this leg completes:

- `src/renderer/index.html` — a new `#page-context-menu` node (`role="menu"`, `class="hidden"`,
  `aria-label="Page actions"`) alongside `#container-menu`/`#kebab-menu`/`#site-info-popup` (`:42-48`).
  Items are built dynamically per-invocation (like the container menu), so the node starts empty.
- `src/renderer/styles.css` — `#page-context-menu` styling reusing the `#container-menu`/`#kebab-menu`
  chrome (dark `--bg-3`, gold-on-dark hover, `--border`, `box-shadow`), the `.cm-item`/`.cm-title` item
  styles (reused or extended), and a thin section-separator (the `.cm-item.add` top-border precedent) so
  link/image/selection/editable/suggestions/Inspect groups read as distinct sections. On-brand,
  CSP-safe (no inline JS; SVG path data only if icons are added).
- `src/renderer/renderer.js` — `els.pageContextMenu` lookup; a `pageContextEntry =
  menuController.register({ trigger, menu: els.pageContextMenu, items: pageContextItems, onOpen, onClose })`
  (the **4th consumer**, registered in place). The menu state: a module-scoped `pageContextState` holding
  the **last-received `{ wcId, params }`** and the **focus-return element** (captured at open). A
  `pageContextItems()` getter querying the live `[role="menuitem"]` set. An `onOpen` that builds the
  sections from `pageContextState.params`, positions at the cursor (mapped via the active webview rect),
  shows, applies roving/focus. An `onClose` that hides + returns focus. A subscription
  `window.goldfinch.onPageContextMenu(({ wcId, params }) => …)` that stores state and opens the menu at the
  cursor. A Shift+F10 / ContextMenu-key handler (where the menu is wired) that opens the menu at the
  focused element / caret with a synthetic/derived position. The new **edit-action dispatch** (step 8).
- `src/preload/chrome-preload.js` + `src/main/main.js` — **only if** the chosen edit-action approach needs
  a new bridge/handler (see step 8's design decision). If the minimal guest-`webContents`-edit-method
  channel is taken, a new narrow `pageContextAction({ webContentsId, action })` bridge + a guarded
  `page-context-action` main handler (mirroring `page-context-correct`'s `fromId` → dead-guard →
  `isInternalContents` refuse → allowlisted action) are added. **Flag this for the reviewer.**
- `src/renderer/renderer-globals.d.ts` / `eslint.config.mjs` — touched ONLY if a new bare global is
  introduced (not expected; the menu is wired in `renderer.js` against existing bridges).
- **No new MCP tool**; tool count unchanged (still **26**, DD7).
- No `tests/behavior/*` spec, no README/CLAUDE.md edit — those are **Leg 6** (`verify-integration`).

## Acceptance Criteria

- [x] A `#page-context-menu` node exists in `index.html` and is rendered via **`menuController` as its
  4th consumer** — registered **in place** (`menuController.register({…})`), NOT by graduating the
  controller to a shared module (DD3). The only controller change permitted is the **additive
  `focusReturn?` option** (Implementation Guidance step 3a) — existing consumers omit it and behave
  identically; the 3 existing consumers (container/kebab/site-info) still work unchanged (regression).
- [x] Right-clicking web content opens the custom menu **and it stays open** (the global `blur → closeAll`
  does not self-dismiss it — the guest-right-click blur race is verified and mitigated; see Implementation
  Guidance step 0). The native OS menu is suppressed by Leg 1.
- [x] The menu shows **context-appropriate sections** built from `params`: link → Open in new tab / Copy link; image → Open
  image / Copy image address / Save image; selection → Copy / Search for "…"; editable → Cut / Copy /
  Paste / (Undo / Redo if exposed) gated by `editFlags`; always → Inspect. A target with multiple classes
  (e.g. an editable field with selected text, or a linked image) shows the union of applicable sections.
- [x] The menu **opens at the cursor position** — `params.x`/`params.y` (guest-page coords) are mapped to
  the chrome overlay via the active `<webview>`'s `getBoundingClientRect()` offset, and the menu is
  clamped within the viewport (never clipped off the right/bottom edge).
- [x] Full **APG keyboard navigation** works (Enter/Space activate, Arrow/Home/End roving, Esc close +
  focus-return, Tab close + focus-return), reusing the `menuController` contract unchanged; **Shift+F10 and
  the ContextMenu key** open the menu at the focused element / caret (menu-specific invocation, NOT via the
  Leg-3 `keydownToAction` mapper); on close, focus returns to the recorded return target.
- [x] **Inspect** routes through the existing `toggle-devtools` IPC
  (`window.goldfinch.toggleDevtools({ webContentsId: wcId })`) — opens DevTools for the right web guest;
  it is web-only and **inert on internal pages** (the menu never fires there, and the handler refuses
  internal contents as defense-in-depth). It does NOT call `devtools.js` directly (DD6).
- [x] **Spelling suggestions** are shown when `params.misspelledWord` is set: `dictionarySuggestions` are
  listed as menuitems; choosing one calls
  `window.goldfinch.correctMisspelling({ webContentsId: wcId, word })` (the Leg-1 channel) and the
  misspelling is corrected in the guest. When `misspelledWord` is empty (spellcheck OFF / pre-dict), no
  suggestions section appears.
- [x] The **edit-actions** (Cut / Copy / Paste / Undo / Redo) work on the targeted editable guest content
  and stay **within the trust discipline** (act on the passed `wcId`, refuse internal, no
  write-into-arbitrary-`webContents` primitive) — see the reviewer-flagged design decision in step 8. The
  approach (and its trust posture) is documented in the flight log entry.
- [x] The menu is **on-brand** (dark/gold chrome matching `#container-menu`/`#kebab-menu`), with **a11y**:
  `role="menu"`/`role="menuitem"`, accessible names on every item, roving tabindex; `npm run a11y` reports
  **no new violations** (if the open-menu state needs auditing, that audit-state driver is Leg 6's scope —
  note it; this leg satisfies a11y by static inspection + the unchanged `menuController` contract, the
  Leg-3-flight precedent for a hidden/dynamic chrome surface).
- [x] The menu is **inert/absent on internal `goldfinch://` pages** — the `page-context-menu` IPC never
  fires for internal guests (Leg-1 main-side guard), so no renderer-side internal gate is required; verify
  no custom menu appears on a `goldfinch://` tab right-click.
- [x] **No new MCP tool**; tool count unchanged — still **26** (DD7; `automation-mcp-tools.test.js`
  "returns exactly the 26 tools" stays green).
- [x] `npm test`, `npm run typecheck`, and `npm run lint` pass. `npm run a11y` reports no new violations.

## Verification Steps

- **Sections per target** (`npm run dev`): right-click a link → Open in new tab / Copy link; an image →
  Open image / Copy image address / Save image; selected text → Copy / Search for "…"; an editable
  `<input>`/`textarea` → Cut/Copy/Paste (+ Undo/Redo if shown), gated by `editFlags` (e.g. Paste disabled
  when `canPaste` is false); a misspelled word in an editable field (spellcheck ON) → the suggestions list
  + Cut/Copy/Paste; every menu → Inspect at the bottom.
- **Cursor position**: right-click near the center, near the right edge, and near the bottom edge of the
  page — the menu opens at the cursor and is clamped inside the viewport (not clipped). Verify the offset is
  correct when the media panel is open (the webview is narrower) and with DevTools docked.
- **Keyboard**: open via right-click, then Arrow/Home/End to rove, Enter/Space to activate, Esc to close
  (focus returns to the recorded target); Tab closes + returns focus. Then **Shift+F10** (and the
  ContextMenu key) on a focused page element → the menu opens at that element/caret.
- **Inspect**: choose Inspect on a web tab → DevTools opens for that tab (via `toggle-devtools`). On a
  `goldfinch://` tab the menu does not appear at all (no Inspect path to test there).
- **Suggestions → correction**: enable spellcheck (Settings), type a misspelling in an editable field on a
  new/reloaded tab, right-click the squiggled word → pick a suggestion → the word is replaced
  (`correctMisspelling` round-trip). (Squiggle rendering is macOS/HAT-authoritative per Leg 2; the menu
  logic is testable wherever `params.dictionarySuggestions` is populated.)
- **Edit-actions**: select text in an editable field → Cut removes it (and places it for Paste); Copy then
  Paste into another field works; Undo/Redo reflect (if exposed). Confirm via inspection that the dispatch
  acts on the captured `wcId` and refuses internal contents (step 8).
- **Internal no-op**: on a `goldfinch://` internal tab, right-click → no custom menu (Leg-1 guard).
- **3-consumer regression**: the container picker, kebab overflow, and site-info popup still open/close/
  keyboard-navigate correctly (the controller was extended, not broken).
- **a11y / tool count**: `npm run a11y` (no new violations); `npm run dev:automation` advertises 26 tools;
  `npm test` / `npm run typecheck` / `npm run lint`.

## Implementation Guidance

0. **[FIRST-STEP VERIFICATION — the `blur → closeAll` race, design-review HIGH].** Before building
   anything else, prove the menu can *stay open* when opened from a guest right-click. The global
   `window` `blur` listener calls `menuController.closeAll()` (`renderer.js:227`); its own comment
   (`:225-226`) notes that page/webview clicks fire `window blur` (the guest is a separate web-contents
   the chrome document can't see). A right-click **inside the guest** is exactly such a click: it moves
   focus into the guest → chrome `window` fires `blur` → main forwards `page-context-menu` → the
   subscription calls `menuController.open()`. If the `blur` handler runs after `open()`, it
   `closeAll()`s the menu the instant it appears. **The page context menu is the FIRST menuController
   consumer triggered by a guest interaction rather than a chrome-element click — it is uniquely exposed
   to this race.** Verify the ordering in `npm run dev` first. If it bites, mitigate (pick the minimal
   one that holds):
   - Open the menu on a microtask / `queueMicrotask` / next tick inside the `onPageContextMenu`
     subscription, so the `blur` has already settled before `open()` runs; **and/or**
   - Have the menu pull focus back to the chrome on open (`els.pageContextMenu.focus()` as part of
     `onOpen`), so the chrome window is focused while the menu is up; **and/or**
   - Exempt the page-context entry from the global `blur → closeAll` (e.g. the blur handler skips the
     entry whose menu was just opened from a guest event) — but prefer the first two (no controller
     change). Record the observed ordering + the chosen mitigation in the flight log. **This is
     acceptance-affecting**: the "right-click opens the menu" criterion fails if the menu self-dismisses.

1. **`index.html` — add the node.** Alongside `#container-menu`/`#kebab-menu`/`#site-info-popup`
   (`:42-48`), add:
   ```html
   <div id="page-context-menu" class="hidden" role="menu" aria-label="Page actions"></div>
   ```
   Like `#container-menu`, it starts empty — items are built per-invocation. Keep it CSP-safe (no inline
   handlers; any icons are inline SVG path data, like the toolbar glyphs).

2. **`styles.css` — on-brand styling.** Add `#page-context-menu` to the `#container-menu`/`#kebab-menu`
   rule (or a new rule reusing the same tokens): `position:absolute; z-index:60; background:var(--bg-3);
   border:1px solid var(--border); border-radius:8px; padding:6px; min-width:200px; box-shadow:0 8px 24px
   rgba(0,0,0,.5)`. Reuse `.cm-item`/`.cm-item:hover` for the menuitems and `.cm-title` for any section
   labels; use the `.cm-item.add` top-border idiom (a separator class, e.g. `.cm-sep` or reuse
   `.cm-item.add`'s `border-top`) between sections. Add a disabled style (e.g. `.cm-item:disabled` /
   `[aria-disabled="true"]` — dim + `cursor:default`) for `editFlags`-gated items. Match the lightbox tier
   awareness: the context menu lives at `z-index:60` (the menu tier), below the `z-index:100` lightbox.

3. **`renderer.js` — register as the 4th consumer (in place).** Add `els.pageContextMenu` to the `els`
   block. Then register, mirroring the **container picker** (the closest precedent: dynamic items rebuilt
   in `onOpen`, anchored position):
   ```js
   /** @returns {HTMLElement[]} */
   function pageContextItems() {
     return /** @type {HTMLElement[]} */ ([...els.pageContextMenu.querySelectorAll('[role="menuitem"]')]);
   }
   // Module-scoped state: the LAST forwarded {wcId, params} and the focus-return target.
   /** @type {{ wcId: number|null, params: any, x: number, y: number, returnFocus: HTMLElement|null }} */
   const pageCtx = { wcId: null, params: null, x: 0, y: 0, returnFocus: null };

   const pageContextEntry = menuController.register({
     trigger: els.pageContextMenu,           // see step 3a — no persistent trigger button
     menu: els.pageContextMenu,
     items: pageContextItems,
     onOpen(startIndex = 0) {
       buildPageContextSections(pageCtx);     // step 4: build items from pageCtx.params
       els.pageContextMenu.classList.remove('hidden');
       positionPageContextMenu(pageCtx.x, pageCtx.y);  // step 5: cursor mapping + clamp
       const items = pageContextItems();
       if (items.length) focusItem(items, startIndex === -1 ? items.length - 1 : startIndex);
     },
     onClose() {
       els.pageContextMenu.classList.add('hidden');
       const ret = pageCtx.returnFocus;       // step 6: focus-return
       pageCtx.returnFocus = null;
       if (ret && typeof ret.focus === 'function') ret.focus();
     }
   });
   function closePageContextMenu() { menuController.close(pageContextEntry); }
   ```
   **3a. The `trigger` / focus-return decision (RESOLVED by design review — take the additive
   `focusReturn?` option).** Every existing consumer passes a real, persistent toolbar element as
   `trigger`; the controller wires keydown on it and Escape/Tab call `entry.trigger.focus()` (`:172`,
   `:176`). The page context menu has **no persistent trigger** — it is invoked by a guest right-click
   (no chrome element) or by Shift+F10 on an arbitrary focused element, and it NEEDS `items` (for the
   roving contract) so it cannot use the site-info no-`items` escape hatch.

   The naive "pass the menu node as its own `trigger` + override focus-return in `onClose`" approach was
   traced and **rejected**: the menu has `items`, so the controller's Escape/Tab branch (`:169-176`)
   *also* fires — it calls `closeEntry(entry)` (which runs `onClose` → correct focus-return to the page
   element) and *then* `entry.trigger.focus()` = `els.pageContextMenu.focus()`, focusing the now-hidden
   menu node and **stranding focus on a hidden element** (the exact failure the Edge Cases warn against).
   Two handlers fighting over focus.

   **Resolution: add a minimal, additive `focusReturn?: () => void` option to `menuController.register`.**
   When present, the controller's Escape/Tab branch calls `entry.focusReturn()` instead of
   `entry.trigger.focus()`; when absent, it defaults to `entry.trigger.focus()` exactly as today.
   Blast-radius is **nil** — the 3 existing consumers omit `focusReturn` and keep `entry.trigger.focus()`
   verbatim (verified: all three pass real, focusable trigger elements and rely on that path). The page
   context menu passes `focusReturn: () => { /* focus the captured page element / webview / address —
   step 6 */ }`. This is an **additive tweak, NOT a graduation** (DD3 honored — the controller stays an
   in-place IIFE; it is not extracted to a shared module). Document it in the flight log as a controller
   extension. (This supersedes the earlier "pass the menu as its own trigger" sketch in the code block
   above — `trigger` may still be the menu node for the open-keydown wiring, but focus-return goes through
   `focusReturn`, not `entry.trigger.focus()`.)

4. **Build the sections from `params` (`buildPageContextSections`).** Mirror the container picker's
   `innerHTML`-build + per-item `addEventListener('click', …)` wiring (`:262-289`). Set
   `els.pageContextMenu.innerHTML = ''` first, then append `role="menuitem"` buttons (class `cm-item`)
   grouped by section, with a separator between sections. Section logic (a target may match several;
   include every applicable section, Inspect last):
   - **link** if `params.linkURL`: "Open link in new tab" → `createTab(params.linkURL)` (untrusted/web
     branch — `isSafeTabUrl` rejects `goldfinch://`); "Copy link" → copy `params.linkURL` (step 7 clipboard).
   - **image** if `params.mediaType === 'image'` and (`params.srcURL` || `params.imageURL`): "Open image in
     new tab" → `createTab(src)`; "Copy image address" → copy the src (step 7); "Save image" → reuse the
     download plumbing — `window.goldfinch.downloadMedia({ webContentsId: pageCtx.wcId, url: src,
     suggestedName: <derive from URL basename> })` (mirror `downloadItem`, `:1320-1327`); `toast` on
     failure. (Confirm the field name: Leg-1's spike table shows `imageURL/srcURL`; Electron's
     `ContextMenuParams` uses `srcURL` for the media element and `mediaType`; prefer `srcURL`, fall back to
     `imageURL`.)
   - **selection** if `params.selectionText`: "Copy" → copy `params.selectionText` (step 7); "Search for
     '<truncated selectionText>'" → `createTab(toUrl(params.selectionText))` (this reuses the existing
     search resolution — `toUrl` turns a non-URL string into the configured Google search URL, `:880-886`;
     verify a multi-word selection routes to search not navigation). Truncate the label for display
     (`escapeHtml` + ellipsis).
   - **editable** if `params.isEditable`: Cut / Copy / Paste, each gated by `editFlags`
     (`editFlags.canCut`/`canCopy`/`canPaste`); Undo / Redo if `editFlags.canUndo`/`canRedo` are present.
     **Note (design-review MEDIUM): the Leg-1 spike only observed `canSelectAll`/`canPaste`/`canCopy` —
     `canCut`/`canUndo`/`canRedo` were NOT observed (the spike used a fresh `<input>` and a non-editable
     selection, so those flags never appeared).** Electron's `ContextMenuParams.editFlags` does expose
     `canCut`/`canUndo`/`canRedo`, but their population on a given target must be **confirmed live** before
     relying on them — keep the "render only if the flag is truthy" guard so an absent flag simply omits the
     item (never a broken/always-disabled entry). **Decision (resolve the omit-vs-disabled question now):
     OMIT** items whose flag is false — keep the menu tight and avoid inert menuitems in the roving set
     (a disabled item would otherwise need exclusion from the `[role="menuitem"]` roving query, complicating
     `focusItem`). Do NOT render disabled edit items. These dispatch via step 8. **The `editFlags` gating is
     a UX nicety, not a security boundary** — `wc.cut()`/`wc.copy()` on a non-editable/non-selected target
     are harmless no-ops main-side; the trust boundary is the step-8 allowlist + internal-refusal, not the
     renderer gating.
   - **spelling suggestions** if `params.misspelledWord`: a section listing each
     `params.dictionarySuggestions[i]` as a menuitem → on click,
     `window.goldfinch.correctMisspelling({ webContentsId: pageCtx.wcId, word: suggestion })` then
     `closePageContextMenu()`. If `dictionarySuggestions` is empty but `misspelledWord` is set, show a
     disabled "No suggestions" affordance (or omit). Place this section near the editable actions.
   - **always**: a separator then "Inspect" → `window.goldfinch.toggleDevtools({ webContentsId: pageCtx.wcId
     })` then `closePageContextMenu()`. (Web-only by construction; the handler refuses internal anyway.)
   Every item handler must `closePageContextMenu()` (so focus-return runs) — mirror the container items
   calling `closeContainerMenu()` before acting (`:269`).

5. **Cursor positioning (`positionPageContextMenu`).** `params.x`/`params.y` are **guest-page
   coordinates** relative to the active `<webview>`'s top-left (NOT the chrome document). The `<webview>`
   fills `#webviews` (`position:absolute; inset:0; width:100%; height:100%`, `:537-542`) inside `#main`
   (`flex:1`, below the toolbar). So map to chrome-overlay client coords via the active webview's rect:
   ```js
   function positionPageContextMenu(px, py) {
     const wv = activeTab() && activeTab().webview;
     const r = wv ? wv.getBoundingClientRect() : { left: 0, top: 0 };
     let x = r.left + px;
     let y = r.top + py;
     const m = els.pageContextMenu;          // measure after it's shown (innerHTML built, not hidden)
     const mw = m.offsetWidth, mh = m.offsetHeight;
     x = Math.min(x, window.innerWidth - mw - 4);   // clamp right edge
     y = Math.min(y, window.innerHeight - mh - 4);  // clamp bottom edge
     m.style.left = Math.max(4, x) + 'px';
     m.style.top = Math.max(4, y) + 'px';
     m.style.right = 'auto';
   }
   ```
   **Investigate / verify against live behavior**: (a) confirm `params.x`/`params.y` are webview-relative
   (the lightbox + kebab use chrome-document `getBoundingClientRect` for their anchors — the webview rect is
   the right reference here since the click happened inside the guest); (b) the media panel open/closed
   changes the webview width but `getBoundingClientRect()` reads the live rect so the offset stays correct;
   (c) account for the menu needing real dimensions before clamping — show it (remove `hidden`) BEFORE
   measuring `offsetWidth`/`offsetHeight`, as the container menu does (`onOpen` order in step 3 shows + then
   positions). If the spike-era observation that `params.x`/`y` were "populated" did not record the exact
   reference frame, treat (a) as a thing to confirm in `npm run dev` before finalizing.

6. **a11y: roles, names, roving, focus-return, Shift+F10.**
   - Roles/names: `role="menu"` on the node, `role="menuitem"` on each item, with a text label
     (accessible name). Roving tabindex via `focusItem` (already applied in `onOpen`).
   - **Focus-return** (delivered via the `focusReturn?` option from step 3a, NOT `entry.trigger.focus()`):
     capture the return target at open time. **Branch on invocation source (decision):** for a **guest
     right-click / in-page ContextMenu** invocation, return focus to the active `<webview>` (so keyboard
     focus goes back to the page where the user was working) — `document.activeElement` is typically the
     chrome `<body>` or the webview in this case, which is not a useful return target; focus
     `activeTab().webview`. For a **chrome-focused Shift+F10** invocation, capture `document.activeElement`
     at open (mirror `lbReturnFocus`, `:1214`) and return there. If the captured/derived target is null or
     unfocusable, fall back to `els.address`. Never leave focus on the hidden menu node.
   - **Shift+F10 / ContextMenu key**: wire a keydown listener (where the menu is wired in `renderer.js`,
     NOT in `keydownToAction`) that on `e.key === 'ContextMenu'` or `(e.shiftKey && e.key === 'F10')`
     opens the menu at the focused element. **Investigate**: a keyboard invocation has no
     `params.x`/`params.y` and no fresh guest `context-menu` event. Two cases: (i) chrome focus is on a
     chrome element → derive `x`/`y` from `document.activeElement.getBoundingClientRect()` and open with the
     **last/empty `params`** (or a chrome-appropriate minimal menu); (ii) the page/webview has focus → the
     guest's own caret/element should drive a real `context-menu` event. Chromium typically synthesizes a
     `context-menu` event for the keyboard ContextMenu key **inside the guest**, which would flow through
     Leg-1's listener and `onPageContextMenu` like a right-click — **verify in `npm run dev`** whether
     Shift+F10 over the focused page element already triggers the guest `context-menu` event (if so, the
     renderer needs no synthetic handling for the in-page case, only for chrome-focused invocations).
     Record the finding; do not assume.

7. **Clipboard for Copy link / Copy image address / Copy selection.** The chrome renderer is
   `contextIsolation:true`, `nodeIntegration:false` — **no `require('electron')`**, and the
   `clipboard:write` IPC is **internal-origin-gated** (settings page only, `main.js:897`), so it is NOT
   reachable here. **Decision (resolved by design review — use the bridge, NOT `navigator.clipboard`):**
   confirmed there is **zero** existing `navigator.clipboard`/`execCommand` usage in the chrome renderer,
   and `navigator.clipboard.writeText` from a `file://` document while the menu has stolen focus and the
   page just fired a `context-menu` is exactly the "not focused / blocked" case that throws inconsistently.
   So add a **narrow chrome-trusted one-way `clipboardWriteText(text)` bridge** + a NON-origin-gated
   `ipcMain.on('chrome-clipboard-write', …)` handler calling `clipboard.writeText(text)` — same trust
   domain as `window-minimize`/`zoom-apply` (chrome-only; no general-write concern: writing a *string* to
   the OS clipboard is not a guest mutation). This is the safe, reliable pick; do not depend on
   `navigator.clipboard` for menu-invoked copies.
   "Copy image" (the binary image, not its address) is explicitly out of this leg's minimal scope unless
   trivially available — "Copy image address" (the URL string) satisfies the DD2 "copy image" intent with
   the string clipboard; record if you implement binary image copy.

8. **NEW edit-action dispatch (Cut / Copy / Paste / Undo / Redo) — RESOLVED (design review approved the
   new allowlisted channel below).** Leg 1 deferred these explicitly; they are NOT misspelling corrections and cannot ride
   `page-context-correct` (which is guarded to `replaceMisspelling` + a `word` string). The edit-actions
   must operate on the **guest editable content**, NOT the chrome renderer's clipboard/DOM. The safest
   minimal approach (recommended): **a new narrow, allowlisted main-side action channel** that mirrors
   `page-context-correct`'s trust discipline exactly:
   ```js
   // main.js — near page-context-correct (~:1051). Allowlisted edit actions on the PASSED guest wcId.
   const PAGE_CONTEXT_ACTIONS = new Set(['cut', 'copy', 'paste', 'undo', 'redo']);
   ipcMain.on('page-context-action', (_e, { webContentsId, action }) => {
     const wc = typeof webContentsId === 'number' ? webContents.fromId(webContentsId) : null;
     if (!wc || wc.isDestroyed()) return;
     if (isInternalContents(wc)) return;                 // DD6 — never on goldfinch://
     if (!PAGE_CONTEXT_ACTIONS.has(action)) return;      // allowlist — not a general primitive
     wc[action]();                                        // wc.cut()/copy()/paste()/undo()/redo()
   }
   ```
   plus a `chrome-preload.js` bridge `pageContextAction: ({ webContentsId, action }) =>
   ipcRenderer.send('page-context-action', { webContentsId, action })`. This keeps the TOCTOU /
   internal-refusal discipline (act on the captured `wcId`, refuse internal, fixed allowlist — not a
   "run-any-method" primitive). **Why not renderer clipboard APIs**: the actions target the *guest*
   selection/undo-stack, which the chrome renderer cannot reach; `document.execCommand`/`navigator.clipboard`
   in the chrome would act on the chrome document, not the guest. **Why a new channel rather than extending
   `page-context-correct`**: that channel's narrow `word`-string contract is part of its audited trust
   surface (Leg-1 AC); widening it into a verb dispatcher would erode that. A separate allowlisted channel
   keeps each surface's contract self-evident. **Reviewer**: confirm this is acceptable vs. (a) folding into
   a single `page-context-correct`-renamed action channel, or (b) any concern that `wc.paste()` reads the OS
   clipboard into the guest (it does — same as a native menu Paste; this is the intended behavior and not a
   new exfiltration path since the user invoked it). Gate each rendered edit item by `editFlags` so disabled
   actions are not dispatched.

9. **Do NOT** touch the native `toolbar-context-menu` handler / the toolbar `contextmenu` listeners — that
   is **Leg 5**. **Do NOT** add an MCP tool (DD7). **Do NOT** graduate `menuController` to a shared module
   (DD3) — extend it in place; any controller change must be a minimal additive tweak (step 3a fallback),
   justified and documented, not an extraction.

10. **Update `flight-log.md`** with the Leg 4 entry: the `trigger`/focus-return decision (3a), the
    cursor-mapping reference frame confirmation (5), the Shift+F10 in-page behavior finding (6), the
    clipboard approach (7), and the **edit-action channel decision + trust posture** (8). These are the
    hand-off facts Leg 5 (which reuses this component for toolbar-mode Unpin) and Leg 6 (behavior spec /
    a11y audit-state) depend on.

## Edge Cases

- **Empty / no-applicable-sections** — a right-click on neutral page content (no link/image/selection,
  not editable, no misspelling) still shows **Inspect** (always present). The menu is never empty; if a
  future param combination yields zero items besides Inspect, that's fine (Inspect carries it). Never open
  an empty menu (the `focusItem` guard `if (items.length)` in `onOpen` prevents a NaN focus on an empty
  list — mirrors the controller's `:180`).
- **Very long suggestion lists** — `dictionarySuggestions` can be long; cap the rendered suggestions at
  the **first 8** so the menu doesn't run off-screen, and rely on the viewport clamp (step 5).
- **Coordinate mapping** — `params.x`/`params.y` are webview-relative; the offset is the active webview's
  live `getBoundingClientRect()` (correct whether the media panel is open, on any window size). If the
  reference frame turns out to be document-relative (verify in dev), drop the webview-rect offset. A menu
  opened near the right/bottom edge is clamped inside the viewport (never clipped).
- **Menu near viewport edge** — clamp `left`/`top` so `left + offsetWidth <= innerWidth - 4` and
  `top + offsetHeight <= innerHeight - 4`; measure after showing (real dimensions). Prefer flipping above/
  left only if a simple clamp visibly mispositions (start with clamp; document if flip is needed).
- **Internal pages already main-guarded** — the `page-context-menu` IPC never fires for `goldfinch://`
  guests (Leg-1 `!__goldfinchInternal` guard), so no renderer internal gate is needed; the
  `toggleDevtools`/`correctMisspelling`/edit-action handlers each also refuse internal contents as
  defense-in-depth. Do not add a redundant `isInternalTab` gate that would mask a regression if the main
  guard ever changed — instead rely on the documented main-side guarantee and note it.
- **Focus-return when right-click had no prior focus** — a guest right-click may leave
  `document.activeElement` as the chrome `<body>` or the `<webview>` element (the page itself, which the
  chrome can't focus into). Capture it anyway; on close, if the captured target is null / `<body>` /
  unfocusable, fall back to focusing the active `<webview>` (so keyboard focus returns to the page) or
  `els.address` — pick one, document it. Do NOT leave focus stranded on the hidden menu node.
- **TOCTOU on `wcId`** — like Leg 1, act on the `wcId` captured at right-click time (stored in `pageCtx`),
  never re-resolve via `activeTab()` for the correction/edit/inspect dispatch — a late tab switch must
  correct/inspect the tab the user right-clicked. (The cursor-position mapping uses the *current* active
  webview rect, which is acceptable since the menu is transient and opens immediately after the event.)
- **Menu re-opened by a second right-click** — `menuController.open` runs `closeAll()` first
  (mutual-exclusion, `:133`), so a second right-click closes the open menu and re-opens with the new
  `params`; ensure the subscription updates `pageCtx` before calling `open`.
- **Guest-right-click `blur → closeAll` race (design-review HIGH; see Implementation Guidance step 0)** —
  a right-click inside the guest fires chrome `window` `blur`, whose global listener (`:227`)
  `closeAll()`s menus; this can dismiss the page menu the instant the `onPageContextMenu` subscription
  opens it. The page context menu is the first menuController consumer triggered by a *guest* interaction,
  so it is uniquely exposed. Verify the ordering live and mitigate (microtask-deferred open, and/or
  `els.pageContextMenu.focus()` on open to keep the chrome focused, and/or exempt this entry from the
  blur close). Acceptance-affecting.
- **Spellcheck OFF / pre-dictionary** — `misspelledWord` empty → no suggestions section (correct; the menu
  still shows Copy/Cut/Paste for editable, plus Inspect).
- **Linked image** (`linkURL` and `mediaType==='image'`) — show both the link and image sections (union);
  document the order (link first, then image, matching common browser behavior).

## Files Affected

- `src/renderer/index.html` — `#page-context-menu` node.
- `src/renderer/styles.css` — `#page-context-menu` + item/section/disabled styling (reusing
  `#container-menu`/`.cm-item` chrome).
- `src/renderer/renderer.js` — `els.pageContextMenu`; `pageContextItems`; `pageCtx` state;
  `pageContextEntry = menuController.register({…})` (4th consumer); `buildPageContextSections`;
  `positionPageContextMenu`; the `onPageContextMenu` subscription (with the step-0 blur-race mitigation);
  the Shift+F10/ContextMenu-key handler; the edit-action / clipboard dispatch; `closePageContextMenu`
  wrapper; **the additive `focusReturn?` option on `menuController.register`** (step 3a — additive, existing
  consumers unaffected).
- `src/preload/chrome-preload.js` — `pageContextAction` bridge (step 8 edit-action channel) +
  `clipboardWriteText` bridge (step 7 clipboard).
- `src/main/main.js` — `page-context-action` handler (allowlisted, internal-refused, step 8) +
  a non-origin-gated `chrome-clipboard-write` handler (step 7).
- `flight-log.md` — Leg 4 progress entry with the decisions enumerated in Implementation Guidance step 10.
- `test/unit/…` — *(optional)* if a pure section-builder seam is extracted (e.g. "given params → which
  sections/items"), unit-test it; otherwise the menu is behavior-test-verified (Leg 6) + a11y-audited.
  **NOT** touched: `mcp-tools.js` / `src/main/automation/` (no new tool, DD7); the native
  `toolbar-context-menu` path (Leg 5); `tests/behavior/*`, README, CLAUDE.md (Leg 6).

---

## Post-Completion Checklist

*(Deferred-commit workflow: land the leg `in-flight`→`landed`, update the flight log, do NOT commit or
signal `[COMPLETE:leg]`/`[HANDOFF:review-needed]` — flight-level review happens after the last autonomous
leg.)*

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`, `npm run a11y` no new violations)
- [x] 3-consumer regression confirmed (container / kebab / site-info still work)
- [x] Update `flight-log.md` with the Leg 4 entry (decisions per step 10: trigger/focus-return, cursor
  mapping frame, Shift+F10 in-page finding, clipboard approach, edit-action channel + trust posture)
- [x] Set this leg's status to `landed` (deferred-commit workflow)

## Citation Audit

Citations verified against current code at leg design time. The flight spec's `menuController` cite
(`renderer.js:126-209`) is **confirmed exact** (it grew the site-info consumer since the flight was
drafted but the controller body still spans `:126-209`). The flight's "3 existing consumers
(container/kebab/site-info)" is confirmed.

- `src/renderer/renderer.js:126-209` — `menuController` IIFE; `register` `:146-199`
  (trigger keydown `:152-160`, menu keydown / APG roving `:166-196`, `if (!entry.items) return` `:167`,
  empty-list guard `:180`), public API `:200-208` (`register`/`open`/`close`/`closeAll`/`current`) — **OK,
  exact** (flight cited `:126-209`).
- `src/renderer/renderer.js:218-224` global `pointerdown` outside-dismiss; `:227` `blur → closeAll` — **OK**
  (ignores clicks inside the open menu / on its trigger — the context menu inherits this).
- `src/renderer/renderer.js:247-302` — `containerItems` (`:247-249`) + `containerEntry =
  menuController.register({…})` (`:253-302`): dynamic `innerHTML` build in `onOpen`, anchored
  `m.style.left = els.newTabMenu.getBoundingClientRect().left` (`:292`), `focusItem(items, …)` (`:296`),
  raw `onClose` hide (`:298-301`) — **OK** (the closest precedent: dynamic items + anchored position; the
  `closeContainerMenu` thin wrapper `:305-307`).
- `src/renderer/renderer.js:328-332` — `focusItem(items, i)` roving-tabindex + focus helper — **OK** (the
  shared roving helper the new menu reuses).
- `src/renderer/renderer.js:333-358` — `positionKebabMenu` (`:333-338`, rect-anchored top/right) +
  `kebabEntry` (`:342-358`) — **OK** (static-markup consumer precedent).
- `src/renderer/renderer.js:446-483` — `siteInfoEntry` registered **without `items`** (`:446-460`) + its
  own Escape/Tab keydown (`:477-483`) → `closeSiteInfo()` + `els.addressChip.focus()` — **OK** (the
  precedent for a consumer that supplies custom keyboard handling; step 3a references this).
- `src/renderer/renderer.js:627-629` `activeTab()`; `:632-639` `isInternalTab(tab)`; `:487` `createTab`;
  `:880-886` `toUrl` (search = `https://www.google.com/search?q=…` `:885`); `:7` `currentHomePage`;
  `:2391` `escapeHtml`; `:2200` `toast`; `:1320-1327` `downloadItem` (→ `downloadMedia({ webContentsId,
  url, suggestedName })`); `:1211/:1213-1229` `lbReturnFocus` + `openLightbox` (focus-return precedent;
  captures `document.activeElement` `:1214`) — **OK**.
- `src/renderer/renderer.js:2256-2281` — global shortcut keydown calling `keydownToAction` (Leg 3); the
  `devtools` dispatch `:2276-2281` — **OK** (the Shift+F10 invocation must NOT be folded here — DD5).
- `src/renderer/index.html:42-48` — `#container-menu` / `#kebab-menu` / `#site-info-popup` block (the
  `#page-context-menu` sibling location); `:10` `styles.css` link; `:111-112` `#main` / `#webviews` — **OK**.
- `src/renderer/styles.css:537-542` — `#webviews webview { position:absolute; inset:0; width:100%;
  height:100% }` (the webview-rect basis for cursor mapping); `:1300-1325` `#container-menu`/`#kebab-menu`
  chrome; `:1327` `.cm-title`; `:1334-1360` `.cm-item`/`:hover`/`.cm-item.add` (separator idiom); `:1424`
  `.cm-dot`; `:958` `#lightbox z-index:100`; menus at `z-index:60` (`:1306`/`:1319`) — **OK**.
- `src/preload/chrome-preload.js:84` `onPageContextMenu`; `:89` `correctMisspelling`; `:72` `toggleDevtools`;
  `:24` `downloadMedia` — **OK, exact** (the Leg-1 + Flight-3 bridges this leg consumes).
- `src/main/main.js:441-446` — guest `context-menu` listener forwarding `{ wcId, params }` inside
  `!__goldfinchInternal` (Leg 1; internal auto-excluded) — **OK**.
- `src/main/main.js:1028-1033` `toggle-devtools` handler (`fromId` → dead-guard → `isInternalContents`
  refuse → `toggleDevTools(wc)`) — **OK** (Inspect routes here, NOT `devtools.js`, DD6).
- `src/main/main.js:1051-1056` `page-context-correct` handler (`fromId` → dead-guard → `isInternalContents`
  refuse → `replaceMisspelling` only) — **OK** (the trust-discipline template the NEW `page-context-action`
  channel mirrors; step 8).
- `src/main/main.js:459-476` `download-media` handler (`fromId(webContentsId)` → `downloadURL(url)`) —
  **OK** (Save image reuses this).
- `src/main/main.js:3` `clipboard` imported; `:897` `clipboard:write` is `registerInternalHandler`
  (origin-gated to the settings page) — **OK** (confirms the chrome renderer cannot reach it; step 7).
- `src/main/main.js:248-251` `mainWindow` `contextIsolation:true`/`nodeIntegration:false`/chrome preload —
  **OK** (no Node / no `require('electron')` in the chrome renderer; drives steps 7-8).
- `src/main/main.js:285` `webPreferences.spellcheck = false` on the internal `will-attach-webview` branch
  (Leg 2 defense-in-depth) — **OK** (context: internal pages never produce `misspelledWord`).
- `test/unit/automation-mcp-tools.test.js` — "returns exactly the 26 tools" — **OK** (the DD7 no-new-tool
  guard; this leg adds none).
- **Negative confirmation**: `grep -rn "page-context-menu\|#page-context-menu\|pageContextMenu" src/` finds
  only the Leg-1 forward (`main.js:444`), the preload bridge (`chrome-preload.js:84`), and the comment at
  `chrome-preload.js:79-84` — **no `#page-context-menu` DOM / renderer rendering exists yet**; this leg is
  the net-new rendering layer. `grep -rn "page-context-action\|pageContextAction" src/` returns nothing
  (the edit-action channel is net-new, step 8).
