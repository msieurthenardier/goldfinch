# Leg: toolbar-context-unpin

**Status**: completed
**Flight**: [Pinnable Toolbar Items (Media + Shields)](../flight.md)

## Objective
Right-clicking a pinned toolbar icon (Media / Shields) shows a **native "Unpin {item}" context menu**;
choosing it sets `toolbarPins[item]=false` in the store (in main) and broadcasts `settings-changed`, so the
toolbar hides the icon and the settings Appearance pin reflects it.

## Context
- **DD7.** Built as a **native Electron menu** (operator choice): renderer `contextmenu` on the icon →
  one-way IPC → main builds + pops `Menu`, and the **click handler does the write in main**
  (`settings.set` + `broadcastToChromeAndInternal`). No new renderer-side write channel; main owns the write
  (narrowest surface; trusted `file://` chrome like `settings-get`/`shields-set`). `menuController` untouched
  (not a 4th consumer).
- **Codebase facts (verified):** `Menu` is **not** in `main.js`'s `require('electron')` destructure — add it.
  `broadcastToChromeAndInternal(channel, payload)` exists (`main.js:513`). `settings` is module-scoped in
  `main.js` (Flight 6). The chrome preload uses `ipcRenderer.send(...)` for one-way IPC (`window-minimize`
  etc.) — the pattern for the contextmenu trigger.
- **Testability (DD6/DD7):** a native menu is **not** in the renderer DOM → its "Unpin" click is **not
  CDP-drivable** → **HAT-verified** (leg 8). The unpin *effect* (toolbarPins→false → toolbar hides + settings
  reflects) is equivalently covered by the settings-Appearance-toggle path in the `toolbar-pins` behavior test
  (leg 7). The `contextmenu`→`send` trigger is renderer-side.
- **Focus note:** the native menu manages its own focus return (to the window) — there is **no renderer
  `.focus()` on the now-hidden button**, so the leg-2 focus-guard concern does not recur here.

## Inputs
- `src/main/main.js` — the `require('electron')` destructure (add `Menu`); `broadcastToChromeAndInternal`;
  the module-scoped `settings` store; `mainWindow` / `BrowserWindow`.
- `src/preload/chrome-preload.js` — `window.goldfinch` surface (add a one-way `send`).
- `src/renderer/renderer.js` — `els.toggleMedia` / `els.togglePrivacy`.

## Outputs
- A renderer `contextmenu` listener on each pinned toolbar icon → `window.goldfinch.toolbarContextMenu(item)`.
- `chrome-preload.js`: `toolbarContextMenu: (item) => ipcRenderer.send('toolbar-context-menu', item)`.
- `main.js`: an `ipcMain.on('toolbar-context-menu', …)` handler that pops a native "Unpin {item}" menu +
  writes + broadcasts. `Menu` added to the electron require.

## Acceptance Criteria
- [ ] **Renderer**: `contextmenu` listeners on `els.toggleMedia` and `els.togglePrivacy` →
  `e.preventDefault()` → `window.goldfinch.toolbarContextMenu('media' | 'shields')`. (Listeners can be always
  attached; a hidden/unpinned icon can't be right-clicked anyway.)
- [ ] **chrome-preload**: `toolbarContextMenu: (item) => ipcRenderer.send('toolbar-context-menu', item)` on
  `window.goldfinch`.
- [ ] **main**: add `Menu` to the `require('electron')` destructure; `ipcMain.on('toolbar-context-menu',
  (_e, item) => …)`:
  - **`if (!mainWindow) return;`** (same guard the other one-way window handlers use) and ignore `item` not in
    `['media','shields']`;
  - `const label = 'Unpin ' + (item === 'media' ? 'Media' : 'Shields');`
  - build `Menu.buildFromTemplate([{ label, click: () => { const pins = { ...settings.get('toolbarPins'),
    [item]: false }; settings.set('toolbarPins', pins); broadcastToChromeAndInternal('settings-changed',
    settings.getAll()); } }])` and **`menu.popup({ window: mainWindow })`** (single chrome window — simpler +
    safer than `fromWebContents`).
- [ ] **Effect**: choosing "Unpin" → the icon disappears from the toolbar (via `applyToolbarPins` on the
  `settings-changed` broadcast, leg 2) AND the settings Appearance pin toggle reflects unpinned (leg 4) — both
  through the one broadcast. `settings.json` `toolbarPins[item] === false`.
- [ ] **Trust**: the `toolbar-context-menu` channel is a chrome-trusted one-way `send` (like
  `window-minimize`) — web webviews have no `ipcRenderer`, so they can't reach it; main owns the write (no new
  renderer write surface). No origin-check needed (same trust domain as `settings-get`/`shields-set`).
- [ ] `npm run lint`, `npm run typecheck`, `npm test` green (221 — no new unit tests; the native menu is
  HAT-verified, the effect is behavior-tested via the settings path in leg 7).

## Verification Steps
- `npm run lint && npm run typecheck && npm test` — green.
- Code read: `Menu` imported; the `ipcMain.on` handler validates `item`, writes via `settings.set`, broadcasts;
  `menu.popup` targets the sender's window; the preload `send` + renderer `contextmenu` listeners wired.
- **Deferred to leg 8 (HAT):** right-click a pinned icon → native "Unpin {item}" menu → the item unpins
  (toolbar hides + Appearance pin reflects + `settings.json`). (Native menu not CDP-drivable.)

## Implementation Guidance
1. **main.js**: add `Menu` to the destructure. Near the other `ipcMain.on(...)` window handlers, add the
   `toolbar-context-menu` handler per the AC. Reuse `settings` + `broadcastToChromeAndInternal` (do NOT
   duplicate the broadcast logic). Validate `item` against `['media','shields']`.
2. **chrome-preload.js**: add `toolbarContextMenu` to `window.goldfinch` (one-way `send`).
3. **renderer.js**: attach the two `contextmenu` listeners near the existing `els.toggleMedia`/
   `els.togglePrivacy` click/handler wiring.

## Edge Cases
- **Unknown `item`**: main ignores anything not `'media'`/`'shields'` (defensive — the channel is chrome-only
  but validate anyway).
- **Right-click an already-hidden icon**: not possible (display:none) — no special handling.
- **`settings.set` throws** (shouldn't for a valid boolean map): the click handler may let it throw (logged by
  Electron); not user-facing. Optional: wrap in try/catch — minor.
- **`menu.popup` window**: target the sender's `BrowserWindow` (fallback `mainWindow`).
- Do NOT route this through `menuController` (native menu; keeps menuController at 3 consumers — graduation
  stays deferred).

## Files Affected
- `src/main/main.js` — `Menu` import + `toolbar-context-menu` IPC handler (write + broadcast).
- `src/preload/chrome-preload.js` — `toolbarContextMenu` one-way send.
- `src/renderer/renderer.js` — `contextmenu` listeners on the two toolbar icons.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:** *(commit deferred to the flight-level review)*

- [ ] All acceptance criteria verified (offline; the native-menu unpin is HAT-verified at leg 8)
- [ ] Tests passing (offline gates)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed` (commit deferred)
- [ ] Check off this leg in flight.md
- [ ] Do NOT commit; do NOT signal `[HANDOFF:review-needed]`
