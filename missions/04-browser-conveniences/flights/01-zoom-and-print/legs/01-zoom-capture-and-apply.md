# Leg: zoom-capture-and-apply

**Status**: completed
**Flight**: [Core Conveniences — Zoom & Print](../flight.md)

## Objective

Wire `Ctrl +` / `Ctrl -` / `Ctrl 0` to zoom the **active web tab's content** (captured main-side via `before-input-event` on each guest, with a renderer chrome-focused fallback), surface the current level in an address-bar zoom chip, no-op on `goldfinch://` internal tabs, and extend the automation `pressKey` key map to emit `=`/`-`/`+` so the keyboard behavior test can drive zoom.

## Context

- **DD6** — Page-scoped shortcuts are captured main-side via a `before-input-event` listener on each guest `webContents`, attached in the `web-contents-created` hook. This is the only path that fires while the **page** has focus (the normal case). The renderer `document` keydown is a fallback for when the chrome shell is focused. Both converge on one main-side apply.
- **DD2** — The level indicator is an address-bar-row chip, visible only when zoom ≠ 100%, click-to-reset. The renderer renders it from a main→renderer zoom-changed message (main owns the capture).
- **DD3** — All new controls no-op on internal tabs. The renderer fallback guards with `isInternalTab(tab)`; the main capture skips the internal session.
- **DD1** — Zoom applies to the active tab's `webContents`. The exact same-jar sharing model (per-tab vs per-origin-per-session) is **confirmed by a live check in this leg** and recorded in the flight log; SC1 mandates neither. The asserted invariant (no cross-jar leak) is tested later in `verify-integration`.
- **DD6 apparatus dependency** — `pressKey` (`src/main/automation/input.js`) cannot emit `=`/`-`/`+` today (its key builder is a named-key map + a `/^[a-z0-9]$/i` printable regex), so `Ctrl+=`/`Ctrl+-` throw `unknown key`. Extending the key map is a deliverable of **this** leg so the keyboard zoom behavior test can drive zoom-in/out. `Ctrl+0` already works via the digit regex.
- This leg establishes the `before-input-event` mechanism; leg 3 (`print-and-pdf`) extends the same handler with a `Ctrl+P` branch. Leg 2 (`zoom-mcp-tool`) builds the `getZoom`/`setZoom` automation ops independently.

## Inputs

What exists before this leg runs:
- `src/main/main.js:296` — `app.on('web-contents-created', (_event, contents) => { … })` attaching `setWindowOpenHandler` + `will-navigate` to guest webviews; **no** `before-input-event` handler yet. Internal session is discriminated by `contents.session?.__goldfinchInternal`.
- `src/renderer/renderer.js:1952` — `document.addEventListener('keydown', …)` for chrome shortcuts (`Ctrl+T/W/L/M`, `Ctrl+Shift+P`, `Ctrl+R`); guarded by `const mod = e.ctrlKey || e.metaKey; if (!mod) return;`. Active tab via `activeTab()` (`renderer.js:572` — `tabs.get(activeTabId) || null`).
- `src/renderer/renderer.js:1190` — lightbox `document` keydown handler; early-returns via `if (els.lightbox.classList.contains('hidden')) return;`, then binds bare `+`/`=`/`-`/`0` (no modifier) to the lightbox's own image zoom.
- `src/renderer/renderer.js:577` — `function isInternalTab(tab)` predicate (`tab.container.id === 'internal'` OR partition match).
- `src/renderer/index.html:49` — `<div id="toolbar">…</div>`; address bar is `#address-wrap`; toolbar buttons `#toggle-media`, `#toggle-privacy`, `#automation-indicator` (hidden, NOT pinnable), `#kebab`. Buttons use `class="icon-btn"`; counts use nested `<span class="tb-badge">`.
- `src/preload/chrome-preload.js` — `window.goldfinch.*` bridge; kebab-case channels; main→renderer push pattern e.g. `onDownloadProgress(cb)` wrapping `ipcRenderer.on('download-progress', (_e, d) => cb(d))`. Main pushes via `mainWindow.webContents.send('download-progress', …)` (`main.js:395`).
- `src/main/automation/input.js:22` — `const KEY_MAP = { Tab, Enter, Escape, Space, Arrow*, Home, End, Delete, Backspace }`; printable handling at `input.js:88` — `else if (typeof name === 'string' && /^[a-z0-9]$/i.test(name)) { keyCode = name.toUpperCase(); }`. `=`/`-`/`+` are NOT emittable.
- Tab model: `tabs` is a `Map<string, Tab>`; `Tab` carries `webview` (`Electron.WebviewTag`), `wcId` (number|null, assigned at dom-ready), and `container` (`{ id, name, color, partition, burner? }`). Main resolves a guest via `webContents.fromId(wcId)`.

## Outputs

What exists after this leg completes:
- A `before-input-event` listener on each **non-internal** guest webContents that intercepts `Ctrl +`/`Ctrl -`/`Ctrl 0`, applies `setZoomFactor` to that guest (clamped), prevents default, and broadcasts a zoom-changed message.
- A main-side `zoom-apply` IPC handler (renderer fallback path) and a `zoom-changed` push to the renderer.
- An address-bar zoom chip (`#zoom-chip`) — hidden at 100%, shows the percentage when ≠ 100%, click-to-reset, keyboard-operable.
- `pressKey` emits `=`/`-`/`+`; `test/unit/automation-input.test.js` asserts the three.
- A flight-log entry recording the **observed same-jar sharing model** (DD1 live check).

## Acceptance Criteria
- [ ] A `before-input-event` listener is attached to each **non-internal** guest webContents (in the `web-contents-created` hook); `Ctrl+=`, `Ctrl+-`, `Ctrl+0` adjust that guest's zoom via `setZoomFactor`, clamped to `[0.25, 5.0]`, and call `event.preventDefault()`. The matcher treats `input.key === '='` (**regardless of shift**) and `input.key === '+'` both as zoom-in, so US-layout `Ctrl+Shift+=` works without depending on which `input.key` Electron delivers. The internal session (`__goldfinchInternal`) gets no zoom listener (or the listener early-returns).
- [ ] After any zoom change (keyboard or chip), main pushes `zoom-changed` `{ wcId, factor }` to the renderer.
- [ ] The renderer chrome-focused fallback (in the `renderer.js:1952` keydown handler) routes `Ctrl+=`/`Ctrl+-`/`Ctrl+0` for the **active web tab** to main; it **no-ops on internal tabs** (`isInternalTab`) and **early-returns when the lightbox is open** (`!els.lightbox.classList.contains('hidden')`).
- [ ] A zoom chip (`#zoom-chip`) exists in the toolbar row: hidden when the active tab's factor is `1.0`; shows the rounded percentage (e.g. `125%`) when ≠ `1.0`; clicking it (or activating via Enter/Space) resets the active tab to `100%`. It carries an accessible name (e.g. `aria-label="Zoom level, click to reset"`).
- [ ] On tab switch, the chip reflects the newly active tab's last-known factor (renderer tracks factor per `wcId` from `zoom-changed`, default `1.0`).
- [ ] `pressKey` emits `=`, `-`, `+` as valid Electron accelerator key codes; `test/unit/automation-input.test.js` asserts what `keyEvents()` **deterministically produces** (keyCode `'='`/`'-'`/`'+'` + the chord modifiers for `Ctrl+=`), with no `unknown key` throw. (Do NOT assert end-to-end `input.key` delivery — that is not unit-testable; the live `Ctrl+=` delivery is covered by the `page-zoom` behavior test.)
- [ ] No-op confirmed on internal tabs: `Ctrl+=` while a `goldfinch://settings` tab is active does not change its zoom and raises no error (manual/HAT — formal assertion deferred to `page-zoom` step 7 under admin key).
- [ ] `npm run a11y` is clean (no new WCAG A/AA violations); the chip is keyboard-reachable with a visible focus indicator.
- [ ] `npm test` passes with no regressions.
- [ ] Flight log records the observed same-jar same-origin sharing behavior (per-tab vs per-origin) from a live check (DD1).

## Verification Steps
- `npm test` — all unit tests pass, including the new `=`/`-`/`+` `pressKey` assertions in `automation-input.test.js`.
- `npm run a11y` — no new violations; tab to the zoom chip, confirm visible focus ring and accessible name via the a11y output.
- Manual (dev run, `npm run dev`): open a web tab, focus the **page**, press `Ctrl+=` twice → page content scales up and the chip shows `> 100%`; `Ctrl+0` → chip hides (100%); click the chip after zooming → resets to 100%.
- Manual: focus the **chrome** (address bar), press `Ctrl+=` → still zooms the active web tab (fallback path).
- Manual: open `goldfinch://settings`, press `Ctrl+=` → no zoom change, no error in console.
- Manual DD1 live check: open two tabs to the **same origin in the same jar**, zoom one, observe whether the other's level follows; record the result in the flight log. **Hypothesis** (to confirm/refute): Electron's `setZoomFactor` persists per `webContents`, so the likely outcome is **per-tab** (the other tab does not follow) — but verify live, as Chromium's host-zoom map can make it per-origin within a session.
- Manual: open the media lightbox, press `=`/`-`/`0` (bare) → lightbox image zoom still works and page zoom does not also fire.

## Implementation Guidance

1. **Main-side zoom helper + capture (`src/main/main.js`)**
   - Add a small helper that, given a guest `webContents` and an action (`'in'|'out'|'reset'`), reads `wc.getZoomFactor()`, computes the next factor from a discrete ladder (mirror Chrome's familiar steps, e.g. `[0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0, 5.0]`; `reset` → `1.0`), clamps to `[0.25, 5.0]`, calls `wc.setZoomFactor(next)`, and pushes `mainWindow.webContents.send('zoom-changed', { wcId: wc.id, factor: next })`.
   - Inside `app.on('web-contents-created', …)`, in the existing `if (contents.getType() === 'webview') { … }` block, attach `contents.on('before-input-event', (event, input) => { … })`. Skip when `contents.session?.__goldfinchInternal` is truthy. Match `input.type === 'keyDown'` and `input.control` (or `input.meta`) with `input.key` of `'='`/`'+'` → `'in'` (match **both**, regardless of `input.shift`, so `Ctrl+Shift+=` works on US layouts), `'-'` → `'out'`, `'0'` → `'reset'`; call the helper and `event.preventDefault()`. Ignore other keys (let them through).
   - Add `ipcMain.on('zoom-apply', (_e, { webContentsId, action }) => { … })` resolving the guest via `webContents.fromId(webContentsId)` and calling the same helper. Guard: if the resolved contents' session is internal, return without acting (defense in depth — the renderer already filters).

2. **Preload bridge (`src/preload/chrome-preload.js`)**
   - Expose `zoomApply: ({ webContentsId, action }) => ipcRenderer.send('zoom-apply', { webContentsId, action })`.
   - Expose `onZoomChanged: (cb) => ipcRenderer.on('zoom-changed', (_e, d) => cb(d))`, mirroring `onDownloadProgress`.

3. **Renderer fallback + chip (`src/renderer/renderer.js`)**
   - In the `renderer.js:1952` keydown handler, after the existing `mod` guard, add a branch for `e.key === '='`/`'+'`/`'-'`/`'0'`: early-return if the lightbox is open (`!els.lightbox.classList.contains('hidden')`); get `const t = activeTab()`; if `!t || isInternalTab(t) || t.wcId == null` return; `e.preventDefault()`; `window.goldfinch.zoomApply({ webContentsId: t.wcId, action })`.
   - Maintain a `Map<number, number>` of `wcId → factor`. In `window.goldfinch.onZoomChanged(({ wcId, factor }) => …)`, store it and, if `wcId` is the active tab's, render the chip.
   - Render: a `renderZoomChip(factor)` that hides `#zoom-chip` when `factor === 1.0`, else sets text to `Math.round(factor * 100) + '%'` and unhides. Wire the chip's `click` to `window.goldfinch.zoomApply({ webContentsId: activeTab().wcId, action: 'reset' })`. Since it's a `<button>`, native activation already synthesizes a `click` on Enter/Space — no separate keydown handler needed (satisfies the keyboard-operable criterion).
   - On tab activation, call `renderZoomChip(factorMap.get(newActive.wcId) ?? 1.0)`. The concrete site is `activateTab` (near `renderer.js:565`), alongside the existing `updateAddressChip(tab)` call at `renderer.js:566` — wire the chip refresh there.

4. **Chip markup + style (`src/renderer/index.html`, `src/renderer/styles.css`)**
   - Add `<button id="zoom-chip" class="icon-btn hidden" type="button" aria-label="Zoom level, click to reset"></button>` in `#toolbar`, e.g. after `#toggle-privacy` and before `#automation-indicator`. The `.hidden` utility class already exists (`styles.css:882`); `#automation-indicator` (`index.html:78`) uses the same `class="icon-btn hidden"` self-managed pattern, and `applyToolbarPins` (`renderer.js:1608`) only toggles `#toggle-media`/`#toggle-privacy` by id, so it will not touch the chip — the chip self-manages `.hidden` exactly like the automation indicator.
   - **This is a text chip, not a glyph button.** `.icon-btn` (`styles.css:286`) is a fixed `32px × 32px` button; `"125%"` will overflow it. Add a `#zoom-chip` rule that overrides to `width: auto; padding: 0 6px;` (or similar) so the percentage text fits, while keeping the `.icon-btn` color/hover/focus treatment. Ensure a visible `:focus-visible` outline. (Do not confuse this with the unrelated `.lightbox-zoom .icon-btn` rule at `styles.css:852` — that's the media lightbox's own zoom UI.)

5. **Extend `pressKey` (`src/main/automation/input.js`)**
   - Widen the printable branch regex (`input.js:88`) from `/^[a-z0-9]$/i` to `/^[a-z0-9=+\-]$/i`, and set `keyCode = name` for the symbol case (no `.toUpperCase()` — symbols are case-invariant) so `=`/`-`/`+` flow through as their literal character. Keep modifier handling unchanged so `Ctrl+=` builds correctly. The existing `unknown key` throw message (asserted only loosely at `automation-input.test.js:138` for `Tab`/`ShiftTab`) stays compatible either way.
   - Numpad `+`/`-` are NOT handled — the `page-zoom` behavior test drives zoom via **main-row** `=`/`-`/`0` only, so numpad support is safely deferred (out of scope for this leg).

6. **Tests (`test/unit/automation-input.test.js`)**
   - Add assertions that `pressKey` (or the underlying `keyEvents()`) accepts `'='`, `'-'`, `'+'` and produces the expected keyCode + modifiers for a `Ctrl+=` chord, with no `unknown key` throw.

## Edge Cases
- **Clamp at bounds**: at `5.0`, `Ctrl+=` no-ops (factor unchanged, chip stays at `500%`); at `0.25`, `Ctrl+-` no-ops.
- **Numpad +/-**: out of scope — handle main-row `=`/`-`/`0` and `+` (Shift+=) only; numpad variants are deferred (the behavior test drives main-row keys).
- **Lightbox open**: the renderer fallback must early-return so page zoom and lightbox image-zoom don't both fire (they key off different modifiers, but avoid double-handling per DD6).
- **`wcId` not yet assigned**: if `t.wcId == null` (tab pre-dom-ready), the fallback no-ops.
- **Internal tab via fallback AND via main**: both paths must refuse internal — renderer via `isInternalTab`, main via the `__goldfinchInternal` session check (defense in depth).
- **Tab close**: stale `wcId` entries in the renderer factor map are harmless (never re-read after the tab is gone); optional cleanup on tab close.

## Files Affected
- `src/main/main.js` — zoom helper (ladder + clamp + broadcast); `before-input-event` capture in the `web-contents-created` hook; `zoom-apply` IPC handler.
- `src/preload/chrome-preload.js` — `zoomApply` send + `onZoomChanged` listener.
- `src/renderer/renderer.js` — fallback keydown branch; `onZoomChanged` handler; `renderZoomChip`; chip click→reset; per-`wcId` factor map; chip refresh on tab switch.
- `src/renderer/index.html` — `#zoom-chip` button in the toolbar.
- renderer stylesheet (where `.icon-btn` is defined) — chip styling + focus indicator.
- `src/main/automation/input.js` — emit `=`/`-`/`+`.
- `test/unit/automation-input.test.js` — assertions for the three new keys.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`npm test`, `npm run a11y`)
- [ ] Update flight-log.md with leg progress entry (incl. the DD1 live-check observation)
- [ ] Set this leg's status to `landed` (Flight Director defers `completed` + commit to flight-end review)
- [ ] Check off this leg in flight.md
- [ ] (Final-leg steps N/A — this is not the final leg; do NOT commit)
