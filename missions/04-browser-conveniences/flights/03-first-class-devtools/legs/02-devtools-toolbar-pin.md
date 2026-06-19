# Leg: devtools-toolbar-pin

**Status**: completed
**Flight**: [First-class DevTools](../flight.md)

## Objective

Add the pinnable `#toggle-devtools` toolbar button (the third `toolbarPins` item, default unpinned)
that opens/closes DevTools via the Leg-1 launch mechanism and reflects open/closed state through
`aria-pressed` — pinnable/unpinnable from right-click and from Settings → Appearance, persisted across
restart.

## Context

- **DD4** — DevTools pin defaults to `false` (unpinned). `settings-store.js` `DEFAULTS.toolbarPins` gains
  `devtools: false`. The validator (any boolean-valued object) and normalizer (`{...DEFAULTS.toolbarPins,
  ...v}` spread) need **no logic change** and **no schema-version bump** — they are forward-compat by
  design. **Required for typecheck**: update the `@typedef Settings` `toolbarPins` type in
  `settings-store.js` (`{ media, shields }` → `{ media, shields, devtools }`) AND every renderer-side
  `{ media: boolean, shields: boolean }` annotation that types a pins map (notably in
  `pages/settings.js`), or `npm run typecheck` fails on the new key.
- **DD6** — Pin/unpin reuses the `toolbarPins` seam end-to-end; the native right-click menu is **reused,
  not migrated** (its migration to a custom menu is Flight 4). `#toggle-devtools` plugs into
  `applyToolbarPins` (the `.hidden` toggle), the Settings → Appearance `#pin-devtools` toggle + the
  `settings.js` controller key-loops, and the existing native `toolbar-context-menu` IPC handler gains a
  `devtools` item.
- **DD3 / Leg-1 result** — open/closed state source of truth is `wc.isDevToolsOpened()`. Leg 1's spike
  was **POSITIVE**: it wired a `devtools-state-changed { wcId, open }` chrome event (subscribe via
  `window.goldfinch.onDevtoolsStateChanged`) plus the on-demand `window.goldfinch.isDevtoolsOpen({
  webContentsId })` invoke. The button's `aria-pressed`/active state is driven by: (a) the post-toggle
  return of `toggleDevtools`, (b) the `devtools-state-changed` event (catches a DevTools-window-initiated
  close), and (c) an `isDevtoolsOpen` reconcile on tab activation.
- **DD5** — Button is **inert on internal tabs, NOT hidden** (`applyToolbarPins` stays pin-driven only,
  no active-tab-type coupling). The click no-ops via the same `isInternalTab` guard the shortcuts use; the
  Leg-1 main handler also refuses internal contents (defense in depth).
- **Leg dependency**: consumes the Leg-1 seam — `window.goldfinch.toggleDevtools`, `isDevtoolsOpen`,
  `onDevtoolsStateChanged` (all landed in Leg 1, verified in the flight log).

## Inputs

What exists before this leg runs (Leg 1 landed):
- `src/preload/chrome-preload.js` — `toggleDevtools({webContentsId})`, `isDevtoolsOpen({webContentsId})`,
  `onDevtoolsStateChanged(cb)` bridges (Leg 1).
- `src/main/main.js` — `toggle-devtools`/`is-devtools-open` handlers; `devtools-state-changed` forwarded
  from the guest `devtools-opened`/`devtools-closed` listener (Leg 1).
- `src/main/settings-store.js` — `DEFAULTS.toolbarPins = { media: true, shields: true }`
  (`settings-store.js:43`); `@typedef Settings` `toolbarPins: { media: boolean, shields: boolean }`
  (`settings-store.js:31`); lenient `VALIDATORS.toolbarPins` (`:101`); deep-merge `NORMALIZERS.toolbarPins`
  = `{...DEFAULTS.toolbarPins, ...v}` (`:139-142`); `freshDefaults` copies `toolbarPins` (`:72`).
- `src/renderer/index.html` — `#toggle-media` (`:79`) and `#toggle-privacy` (`:83`) buttons (icon-btn +
  inline Lucide SVG); `#automation-indicator` (`:90`, NOT pinnable — `applyToolbarPins` must never touch
  it).
- `src/renderer/renderer.js` — `applyToolbarPins(pins)` (`renderer.js:1681`: `els.toggleMedia.classList
  .toggle('hidden', !pins.media); els.togglePrivacy.classList.toggle('hidden', !pins.shields);`);
  `els.toggleMedia`/`els.togglePrivacy` lookups (`:23`,`:42`); `els.toggleMedia` click→`togglePanel()`
  + `contextmenu`→`toolbarContextMenu('media')` (`:963-964`); `els.togglePrivacy` contextmenu
  (`:1543`); `activateTab(id)` (`:572`) — the reconcile point; `isInternalTab(tab)` (`:608`).
- `src/renderer/pages/settings.html` — `#appearance` section with Media/Shields `appearance-row`s +
  `#pin-media`/`#pin-shields` `pin-toggle` buttons (`settings.html:24-40`).
- `src/renderer/pages/settings.js` — the pin controller IIFE (`settings.js:189-236`): `btns = { media,
  shields }` (`:193-196`), guard `if (!btns.media || !btns.shields) return;` (`:197`), `current` init
  (`:199-200`), `apply` loop over `['media','shields']` (`:209`), click-wire loop over `['media','shields']`
  (`:220`), `onSettingsChanged` re-sync (`:232-234`).
- `src/main/main.js` — `ipcMain.on('toolbar-context-menu', …)` (`main.js:985` — shifted from the
  flight's stale `:929` cite by Leg 1's additions): guard `if (item !== 'media' && item !== 'shields')
  return;` (`:987`) → builds an "Unpin {Media|Shields}" native menu (label `:988`) →
  `settings.set('toolbarPins', {...get, [item]: false})` → broadcast. (Leg-1 seam also lives here:
  `devtools-state-changed` forward `~:421`; `toggle-devtools`/`is-devtools-open` handlers `~:968/:975`.)

## Outputs

What exists after this leg completes:
- `src/main/settings-store.js` — `DEFAULTS.toolbarPins.devtools = false`; `@typedef Settings` toolbarPins
  type gains `devtools: boolean`. (No validator/normalizer/version change.)
- `src/renderer/index.html` — `#toggle-devtools` button (icon-btn + a DevTools/code-style Lucide SVG),
  using `aria-pressed="false"` (a toggle reflecting open state — NOT `aria-expanded`, which is for the
  Media/Shields panels), `aria-label="DevTools"`, a `title` naming the `F12` shortcut. Placed alongside
  `#toggle-privacy`.
- `src/renderer/renderer.js` — `els.toggleDevtools` lookup; `applyToolbarPins` gains
  `els.toggleDevtools.classList.toggle('hidden', !pins.devtools)` + JSDoc/type update; a click handler →
  `window.goldfinch.toggleDevtools({webContentsId})` (guarded `isInternalTab`/`wcId`) that sets
  `aria-pressed` from the returned post-state; a `contextmenu` handler → `toolbarContextMenu('devtools')`;
  an `onDevtoolsStateChanged` subscription that updates `aria-pressed`/active when the change targets the
  active tab; an `isDevtoolsOpen` reconcile inside `activateTab` so the button reflects the newly-active
  tab's DevTools state.
- `src/renderer/pages/settings.html` — a third `appearance-row` with `#pin-devtools` (`aria-pressed=
  "false"`, `aria-label="Pin DevTools to toolbar"`, a pin SVG mirroring the others).
- `src/renderer/pages/settings.js` — `btns.devtools`; guard, `current` init, `apply` loop, click-wire
  loop all extended to include `devtools`; type annotations updated to `{ media, shields, devtools }`.
- `src/main/main.js` — `toolbar-context-menu` allow-guard extended to accept `'devtools'`; the Unpin
  label maps `devtools → 'DevTools'`.
- Tests: settings-store unit coverage for the `devtools` default + persistence round-trip; any
  renderer/settings unit tests for the pin loops extended to include `devtools`.

## Acceptance Criteria

- [x] `DEFAULTS.toolbarPins.devtools === false`; a settings file written before this leg (only
  `{media,shields}`) loads with `devtools` auto-populated to `false` via the existing normalizer (no
  version bump, no migration). Verified by a settings-store unit test.
- [x] `npm run typecheck` passes — the `@typedef Settings` toolbarPins type and all renderer-side
  `{media,shields}` pin-map annotations include `devtools`.
- [x] `#toggle-devtools` exists in the toolbar, is keyboard-focusable, has an accessible name
  ("DevTools"), and uses `aria-pressed` to reflect DevTools open/closed (true when open, false when
  closed) — NOT `aria-expanded`. (static inspection — see a11y caveat below)
- [x] Clicking `#toggle-devtools` on a web tab toggles DevTools via the Leg-1 `toggleDevtools` invoke and
  updates `aria-pressed`/active styling from the authoritative post-toggle state. (code; live HAT = optional leg)
- [x] On an internal (`goldfinch://`) tab the button is **visible if pinned but inert** (click no-ops via
  `isInternalTab`; `applyToolbarPins` does NOT hide it based on tab type — only on pin state).
- [x] The button reflects a DevTools-window-initiated close (via the `onDevtoolsStateChanged`
  subscription, when the event targets the active tab) and reconciles to the correct state on tab
  activation (via `isDevtoolsOpen` in `activateTab`, with the `activeTabId===tab.id` async-race re-check) —
  no stale pressed state (DD3).
- [x] Pin/unpin works from **Settings → Appearance** (`#pin-devtools` toggles `aria-pressed` and persists)
  and from **right-click** on the pinned button (native "Unpin DevTools" menu, reused not migrated).
- [x] Pin state **persists across restart** (it is a `settings-store` field — verified by the persistence
  round-trip test + the existing persistence mechanism).
- [x] When unpinned, the `F12`/`Ctrl+Shift+I` shortcuts (Leg 1) still open DevTools (button visibility and
  shortcut availability are independent — shortcuts are wired in Leg 1, untouched here).
- [x] `npm test`, `npm run typecheck`, `npm run lint` pass; `npm run a11y` reports no new violations.
  **Coverage caveat (reviewer [medium])**: DevTools defaults to *unpinned*, so `#toggle-devtools` carries
  `.hidden` in the only toolbar-bearing audit state (`base-chrome`) and axe-core skips hidden elements —
  the default sweep does NOT exercise the button. For Leg 2 the button's a11y (accessible name + valid
  `aria-pressed`, no `aria-expanded`) is satisfied by **static inspection**; real audited coverage (a
  pin-the-button audit state in `a11y-audit.mjs`) is **Leg 3's** scope. Do not claim `npm run a11y`
  validates this button.
- [x] MCP tool count unchanged (still 26 — no automation surface change in this leg).

## Verification Steps

- **Default + persistence**: settings-store unit test — load a config with `toolbarPins: {media:true,
  shields:false}` (no `devtools`) → `get('toolbarPins').devtools === false`; `set('toolbarPins',
  {media:true,shields:true,devtools:true})` → reload → `devtools === true`.
- **Typecheck**: `npm run typecheck` (will fail if any `{media,shields}` annotation is left un-extended).
- **Button + a11y**: `npm run a11y`; inspect `#toggle-devtools` for `aria-pressed` and an accessible name;
  tab to it and activate with Enter/Space.
- **Toggle + state**: `npm run dev`; pin DevTools via Settings → Appearance; click the button on a web tab
  → DevTools opens, button shows pressed; click again → closes, unpressed; close DevTools from its own
  window → button un-presses (event-driven); switch tabs → button reflects each tab's DevTools state.
- **Internal inert**: navigate to a `goldfinch://` tab → clicking the (pinned) button does nothing.
- **Right-click unpin**: right-click the pinned button → "Unpin DevTools" → button hides, `#pin-devtools`
  in Settings reflects unpinned.
- **Restart persistence**: pin, quit, relaunch → button still pinned.
- **Unpinned shortcut**: unpin, press `F12` → DevTools still opens.
- `npm test` / `npm run typecheck` / `npm run lint`.

## Implementation Guidance

1. **settings-store.js** — add `devtools: false` to `DEFAULTS.toolbarPins` (`:43`). Update the
   `@typedef Settings` toolbarPins line (`:31`) to `{ media: boolean, shields: boolean, devtools: boolean }`.
   Do NOT touch the validator/normalizer (they are key-agnostic) and do NOT bump any version. Confirm
   `freshDefaults`'s `toolbarPins: { ...DEFAULTS.toolbarPins }` copy (`:72`) now carries `devtools`.

2. **index.html** — add `#toggle-devtools` after `#toggle-privacy` (`:86`). Mirror the icon-btn structure
   but as a **toggle reflecting open state**:
   ```html
   <button id="toggle-devtools" class="icon-btn" title="DevTools (F12)" aria-label="DevTools" aria-pressed="false">
     <svg class="tb-glyph" …>…a DevTools/code glyph (Lucide "code" or "square-terminal"), aria-hidden…</svg>
   </button>
   ```
   Use `aria-pressed` (toggle semantics) NOT `aria-expanded` (the panel toggles use that). Pick a Lucide
   ISC-licensed inline SVG consistent with the others (CSP-safe inline path data).

3. **renderer.js** —
   - Add `els.toggleDevtools` to the `els` lookup block (near `:23`/`:42`).
   - Extend `applyToolbarPins` (`:1681`) with
     `els.toggleDevtools.classList.toggle('hidden', !pins.devtools);` and update its JSDoc/param type so
     the pins param includes `devtools`. NOTE (reviewer): it's the new `pins.devtools` *access* that makes
     typecheck bite a missed annotation (TS2339 against an un-extended `{media,shields}` type) — a
     JSDoc-only edit with no body change wouldn't be cross-checked. Add both together.
   - Click handler (mirror `els.toggleMedia` at `:963`, but call the launch + reflect state):
     ```js
     els.toggleDevtools.addEventListener('click', async () => {
       const t = activeTab();
       if (!t || isInternalTab(t) || t.wcId == null) return;   // inert on internal/no-wcId
       const open = await window.goldfinch.toggleDevtools({ webContentsId: t.wcId });
       setDevtoolsPressed(!!open);
     });
     els.toggleDevtools.addEventListener('contextmenu', (e) => {
       e.preventDefault(); window.goldfinch.toolbarContextMenu('devtools');
     });
     ```
   - A small `setDevtoolsPressed(open)` helper: `els.toggleDevtools.setAttribute('aria-pressed',
     String(open)); els.toggleDevtools.classList.toggle('active', open);` (mirror the `.active` styling
     pattern the panel toggles use at `togglePanel` `:949`).
   - Subscribe to the Leg-1 event:
     ```js
     window.goldfinch.onDevtoolsStateChanged(({ wcId, open }) => {
       const t = activeTab();
       if (t && t.wcId === wcId) setDevtoolsPressed(!!open);
     });
     ```
   - Reconcile on activation: in `activateTab` (`:572`), after the tab becomes active, query
     `isDevtoolsOpen` for the new tab and set the pressed state (guard internal/no-wcId → pressed false):
     ```js
     if (!isInternalTab(tab) && tab.wcId != null) {
       window.goldfinch.isDevtoolsOpen({ webContentsId: tab.wcId })
         .then((open) => { if (activeTabId === tab.id) setDevtoolsPressed(!!open); })
         .catch(() => {});
     } else { setDevtoolsPressed(false); }
     ```
     (DD3 rebuild trigger (b): tab activation. The `activeTabId === tab.id` re-check guards the
     `isDevtoolsOpen` promise against a fast double-switch painting the wrong tab's state — this is a
     NEW async guard, not a copy of the find-restore at `:590` (that path is synchronous and has no
     race).)

4. **settings.html** — add a third `appearance-row` after Shields (`:39`), with `#pin-devtools`
   (`aria-pressed="false"`, `aria-label="Pin DevTools to toolbar"`, the same pin SVG). Label text
   "DevTools".

5. **settings.js** (the IIFE `:189`, guarded by `if (!window.goldfinchInternal) return;` at `:191`) —
   add `devtools: document.getElementById('pin-devtools')` to `btns` (`:193-196`); include it in the
   per-button guard (`:197` → `if (!btns.media || !btns.shields || !btns.devtools) return;`); extend
   `current` init (`:199-200`) to `{ media: true, shields: true, devtools: false }`; change BOTH
   `Array<'media'|'shields'>` loop casts (`:209`, `:220`) to include `'devtools'`; update the two
   `{ media: boolean, shields: boolean }` type annotations — the `current` JSDoc (`:199`) and the `apply`
   `@param` (`:205`) — to include `devtools`.

6. **main.js** `toolbar-context-menu` (`:985`) — change the allow-guard (`:987`) to also accept
   `'devtools'`: `if (item !== 'media' && item !== 'shields' && item !== 'devtools') return;`. Extend the
   label map (`:988`): `item === 'media' ? 'Media' : item === 'shields' ? 'Shields' : 'DevTools'`. The
   `settings.set('toolbarPins', {...get, [item]: false})` + broadcast logic is already key-generic.

7. **Tests** —
   - **MUST update three existing assertions in `test/unit/settings-store.test.js`** that `deepEqual`
     the full `toolbarPins` map and will break the moment `devtools:false` joins DEFAULTS: the
     first-load default (`~:335-336`), the set-full-map persist/reload (`~:351-352`), and the
     set-partial-map normalize (`~:367-368, :372`). Add `devtools: false` (or the written value) to each
     expected object. **This is not optional** — without it `npm test` fails even though every other leg
     instruction is satisfied.
   - Add a new settings-store test for the `devtools` default + a persistence round-trip (load a config
     missing `devtools` → `devtools === false`; `set` with `devtools:true` → reload → `true`).
   - If `pages/settings.js` or `applyToolbarPins` have unit coverage, extend the pin-key lists to include
     `devtools`. No MCP/tool-count changes.

## Edge Cases

- **`aria-pressed` vs `aria-expanded`**: the Media/Shields buttons control panels (`aria-expanded`); the
  DevTools button is a toggle reflecting an external window's open state (`aria-pressed`). Do not copy
  `aria-expanded` — `npm run a11y` / screen readers would misreport it.
- **Stale pressed state on a DevTools-window close**: handled by the `onDevtoolsStateChanged` subscription
  (Leg-1 positive spike). If the event ever regresses (e.g. on macOS), the `activateTab` reconcile is the
  backstop (DD3 max-staleness = until next activation).
- **Activation async race**: `isDevtoolsOpen` resolves after a tab switch; re-check `activeTabId ===
  tab.id` before applying (a fast double-switch must not paint the wrong tab's state).
- **Inert-not-hidden on internal**: `applyToolbarPins` toggles `.hidden` from pin state ONLY. On an
  internal tab a pinned button stays visible but its click no-ops (`isInternalTab` guard) and its
  pressed state is forced false by the reconcile. Do not add tab-type coupling to `applyToolbarPins`
  (DD5).
- **`#automation-indicator` is not pinnable** — `applyToolbarPins` must not touch it; only add the
  `devtools` line, leave the indicator alone.
- **Unpin while DevTools is open** (reviewer question): unpinning hides the button (`.hidden`) but the
  detached DevTools window stays open — reachable again via `F12`/`Ctrl+Shift+I` or by re-pinning. This
  is intended and consistent with Media/Shields, but unlike a panel, DevTools has out-of-toolbar state
  that survives the unpin; acceptable (the shortcuts are the always-available path, DD-by-design).
- **`onDevtoolsStateChanged` teardown** (reviewer question): the chrome renderer (`renderer.js`) is not
  reloaded the way the `goldfinch://settings` page is, and its existing `onZoomChanged`/`onSettingsChanged`
  subscriptions are fire-and-forget with no teardown — match that pattern (no `pagehide` removal). The
  settings.js `pagehide` removal exists only because that internal page DOES reload.
- **Forward-compat already proven**: Media/Shields demonstrate the normalizer fills missing keys; the
  `devtools` key inherits that. A user's existing settings file silently gains `devtools:false`.

## Files Affected

- `src/main/settings-store.js` — `DEFAULTS.toolbarPins.devtools`, `@typedef` type.
- `src/renderer/index.html` — `#toggle-devtools` button.
- `src/renderer/renderer.js` — `els.toggleDevtools`, `applyToolbarPins`, click/contextmenu handlers,
  `setDevtoolsPressed`, `onDevtoolsStateChanged` subscription, `activateTab` reconcile.
- `src/renderer/pages/settings.html` — `#pin-devtools` appearance-row.
- `src/renderer/pages/settings.js` — `btns.devtools`, guard, `current`, loops, type annotations.
- `src/main/main.js` — `toolbar-context-menu` allow-guard + label.
- `test/unit/…` — settings-store default + persistence; pin-loop coverage if present.

---

## Post-Completion Checklist

*(Deferred-commit workflow: land the leg `in-flight`→`landed`, update the flight log, do NOT commit or
signal `[COMPLETE:leg]`/`[HANDOFF:review-needed]`.)*

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`, `npm run a11y`)
- [x] Update flight-log.md with the Leg 2 progress entry (changes, any deviations/anomalies)
- [x] Set this leg's status to `landed`

## Citation Audit

Citations verified against current code at leg design time; **main.js cites repaired after Leg-1 drift**
(design review caught them):
- `settings-store.js:31` `@typedef` toolbarPins, `:43` DEFAULTS, `:101` validator, `:139-142` normalizer,
  `:72` freshDefaults — `OK`.
- `index.html:79` toggle-media, `:83` toggle-privacy, `:90` automation-indicator — `OK`.
- `renderer.js:1681` applyToolbarPins (two-line body), `:963-964` toggleMedia click+contextmenu, `:1543`
  togglePrivacy contextmenu, `:572` activateTab (find-restore `:590` is synchronous), `:608`
  isInternalTab, `:945-960` togglePanel/.active — `OK`.
- `settings.html:24-40` appearance section + pin-media/pin-shields — `OK`.
- `settings.js:189-236` pin controller IIFE (outer guard `:191`, btns `:193-196`, per-button guard `:197`,
  current `:199-200`, apply loop `:209`, click loop `:220`, onSettingsChanged `:232`, pagehide `:235`) —
  `OK`.
- `main.js` toolbar-context-menu — **`drifted` → repaired**: the flight cited `:926/:929/:931`; Leg 1's
  additions shifted the handler to **`:985`**, allow-guard to **`:987`**, label to **`:988`** (the old
  `:929` is now the `zoom-apply` handler). All body references updated.
- Leg-1 seam — `OK`: `chrome-preload.js:72-77` (`toggleDevtools`/`isDevtoolsOpen`/`onDevtoolsStateChanged`);
  `main.js:421` (`devtools-state-changed` forward), `:968/:975` (toggle/is-open handlers);
  `renderer-globals.d.ts:82-84` (bridge types already declared — this leg does NOT touch the d.ts).
- **Test impact noted**: `test/unit/settings-store.test.js:335-336/351-352/367-368,372` — three existing
  `deepEqual` assertions on the full pins map MUST be updated for the new `devtools` key (see Impl step 7).
