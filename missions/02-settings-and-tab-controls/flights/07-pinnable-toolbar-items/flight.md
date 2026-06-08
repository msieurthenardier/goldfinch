# Flight: Pinnable Toolbar Items (Media + Shields)

**Status**: landed
**Mission**: [Settings Area & Tab-Bar Controls](../../mission.md)

## Contributing to Criteria
- *(Flight-local — no mission success criterion.)* Like Flight 5's chips/popup, this is operator-elected UX
  on top of the settings surface. It must preserve **SC8** (keyboard-operable; no new WCAG A/AA violations)
  for everything it touches.

> **Scope.** A generic **pin/unpin** system for toolbar items (Media + Shields), stored in the Flight-6
> settings store. **Pinned → the toolbar shows the item as an icon + count badge** (replacing today's text
> buttons); **unpinned → the toolbar icon is removed** (the item is managed from settings; its keyboard
> shortcut still works). Both default **pinned** (today's UX preserved on upgrade). Pin toggles live in the
> settings **Appearance** section. Also: rewire the site-info popup's **"Site settings →"** to open the
> settings page (Privacy & Shields) instead of the now-optional slide-out panel; and fold the Flight-6
> debrief's deferred debt on these surfaces (`buildSiteInfo` escaping, `isInternalTab` comment, internal-
> preload listener unsubscribe). `menuController` graduation was assessed and is **not** triggered (no 4th
> menu/popup consumer).

---

## Pre-Flight

### Objective
Make the Media and Shields toolbar controls **pinnable** — a generic mechanism (extensible to more items
later) whose state lives in the durable settings store. A pinned item renders in the toolbar as an **icon
with a count badge** (Media file-count; Shields blocked-tracker count + alert state); an unpinned item is
removed from the toolbar and managed from the settings **Appearance** section (its keyboard shortcut
remains active). Rewire **"Site settings →"** in the site-info popup to open `goldfinch://settings` at the
Privacy & Shields section (the slide-out panel is now optional). Retire the Flight-6 carry-forward debt that
lives on the touched surfaces.

### Open Questions
- [x] Keep the count when the buttons become icons? → **Icon + small count badge** (preserve the media-count
  + blocked-tracker signal + the Shield alert state) (operator). See DD2.
- [x] Unpinned item — does its keyboard shortcut still work? → **Yes**; unpin removes the toolbar icon only
  (Ctrl+M / Ctrl+Shift+P still open the panel; re-pin from settings to restore the icon) (operator). See DD2.
- [x] Where do the pin toggles live? → The settings **Appearance** section (operator). See DD3.
- [x] Store shape for pins? → A generic `toolbarPins: { media, shields }` boolean map (extensible), read
  merged-onto-defaults for forward-compat. See DD1.
- [x] Pin control affordance? → A **pin icon** (pushpin toggle button), not a pill switch (operator). See DD3.
- [ ] Exact glyphs (toolbar Media/Shields icons + badge placement; the Appearance pushpin) — tune at leg
  design / HAT.
- [ ] "Site settings →" — open a NEW settings tab at `#privacy`, or focus an existing settings tab and
  navigate it? → leg-design detail (DD4); default: reuse an open settings tab if present, else open one.

### Design Decisions

**DD1 — Pin state in the settings store (generic, extensible, forward-compatible; normalized at load)**: Add
`toolbarPins: { media: true, shields: true }` to `settings-store.js` `DEFAULTS` (both **default `true`** —
preserve today's toolbar on upgrade). **A proper `VALIDATORS` entry is REQUIRED** (do NOT rely on the
no-validator `typeof === typeof DEFAULTS[key]` fallback — `typeof null === 'object'` and `typeof [] ===
'object'`, so the fallback would wrongly accept `null`/arrays). Validator:
`(v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => typeof x
=== 'boolean')`.
- **Normalize at LOAD, not at consumers** (Architect): after the value passes the validator in `load()`'s
  merge-with-repair, **deep-merge it onto the default** — `config.toolbarPins = { ...DEFAULTS.toolbarPins,
  ...stored.toolbarPins }`. So `store.get('toolbarPins')` **always returns a fully-populated object** with
  every known key, and a future 3rd pinnable item defaults to **pinned** for old configs without any
  per-consumer spread (and no consumer can misread a missing sub-key as falsy/unpinned). A wholly-malformed
  `toolbarPins` still drops to the default (existing repair).
- `set` writes the **full** object (settings page reads, flips one, writes the whole map).
- Rationale: reuses the Flight-6 store; load-time normalization is the safe home for the forward-compat merge.
- Trade-off: a nested object in an otherwise-flat store — confined to the validator + the one load-normalize
  line (commented, incl. the `typeof null` pitfall for future object-typed keys).

**DD2 — Chrome applies pin state to the toolbar (icon + count badge; show/hide)**: Convert `#toggle-media`
and `#toggle-privacy` from **text** buttons (`Media (N)` / `Shield (N)`) to **icon buttons with a count
badge** — an icon glyph + a small badge element showing the count (hidden at 0); the Shield keeps its `alert`
state. **Icons are Unicode/CSS-glyph only (NOT inline SVG/data-URI)** — the chrome `index.html` carries a CSP
(`<meta http-equiv="Content-Security-Policy">`), and the existing icon-btns (`◀▶⟳⋮`) are Unicode; a CSS
pseudo-element glyph in `styles.css` is also fine. No CSP change.
- `renderMedia`/`renderPrivacy` update the **badge** (not button text), and set a **dynamic `aria-label`**
  carrying the count — e.g. `els.toggleMedia.setAttribute('aria-label', n ? 'Media, ' + n + ' items' :
  'Media')` (Shields: `'Shields, ' + n + ' blocked'`/`'Shields'`) — so the accessible name stays accurate
  without a separate live region. Preserve `aria-expanded`. **Move the Shield `.alert` class onto the new
  button/icon element** during the restructure (don't lose `.classList.toggle('alert', n > 0)`).
- At startup the chrome reads `settings-get('toolbarPins')` (now load-normalized to a full object, DD1) and
  **shows/hides** each button per its pin (unpinned → `hidden`); `onSettingsChanged` re-applies live.
- **Keyboard shortcuts stay active regardless of pin.** Confirmed: `Ctrl+M`/`Ctrl+Shift+P` are a chrome
  `document` keydown (`renderer.js` ~1861) calling `togglePanel`/`togglePrivacy` — **independent of the
  button**, so hiding the button doesn't disable the shortcut. (Unpin is toolbar-presentation only.)
- **a11y/styling acceptance (Flight-6 lesson):** the icon buttons must match the toolbar's icon-btn visual
  language (glyph + badge legible on `--bg-3`) AND keep an accurate `aria-label` — verified by a **screenshot
  + an a11y read at the Developer verify step, before the HAT**.
- Rationale: operator decisions (icon+badge; shortcut survives unpin).
- Trade-off: count moves from button text to a badge — `renderMedia`/`renderPrivacy` + CSS updated.

**DD3 — Pin controls in the settings Appearance section = pin-icon toggle buttons (via the secured bridge)**:
The Appearance section (currently a placeholder) gets a per-item row (**Media**, **Shields**) — label left,
a **pin-icon toggle button** right (operator: the control is a **pin icon**, not a pill switch). Each is a
`<button>` (toggle) showing a **pushpin glyph**, **filled/accent when pinned, outline/muted when unpinned**,
with `aria-pressed` reflecting the pin state + an `aria-label` ("Pin Media to toolbar" / "Unpin Media from
toolbar" — or a static "Pin Media to toolbar" with `aria-pressed` carrying state). Keyboard-operable (native
button). **Glyph rendering:** an **inline `<svg>` pin** in `settings.html` is preferred (inline SVG markup is
CSP-safe under `default-src 'self'` — it's not a loaded resource; `currentColor` → gold when pinned), with a
Unicode pushpin as a fallback; exact glyph tuned at leg design / HAT. `settings.js` reads `toolbarPins` via
`window.goldfinchInternal.settingsGet('toolbarPins')` (load-normalized to a full object, DD1), writes the
updated full map via `settingsSet('toolbarPins', {...})`, toggling `aria-pressed`, and re-syncs on
`onSettingsChanged`. Toggling → `settings-changed` broadcast → chrome applies show/hide (DD2).
- Rationale: operator (Appearance; pin-icon affordance); reuses the Flight-6 bridge.
- Trade-off: a pin-icon toggle is a new control type in the settings page (not the pill switch) — small CSS +
  the `aria-pressed` toggle-button pattern; styling/a11y verified by screenshot at the Developer verify step.

**DD4 — "Site settings →" opens the settings page (Privacy & Shields), not the slide-out**: In
`buildSiteInfo`, the web chip's "Site settings →" handler changes from `togglePrivacy(true)` to **opening
`goldfinch://settings/#privacy`** (the Privacy & Shields section). Because the slide-out panel is now an
optional/pinnable surface, the settings page is the canonical destination (Chrome's "site settings opens
settings"). Reuse an open `goldfinch://settings` tab if present (focus it + navigate to `#privacy`), else
open a new **trusted** internal tab (`createTab('goldfinch://settings/#privacy', null, { trusted: true })`).
**Confirmed (Architect): `isInternalPageUrl` ignores the fragment** — `new URL('goldfinch://settings/#privacy')`
has `pathname:'/'`, `hash:'#privacy'`; the predicate checks pathname only, so the fragmented URL passes with
**no change to `isInternalPageUrl`**; `createTab` loads the full URL and the page native-anchors to `#privacy`.
**Reuse an open settings tab** via `[...tabs.values()].find(isInternalTab)` → `webview.loadURL('goldfinch://
settings/#privacy')` + `activateTab(tab.id)`; else open a new trusted tab. `closeSiteInfo()` first.
- Rationale: operator; aligns with the pin model (panel optional); uses existing primitives (no new IPC).
- Trade-off: a popup→tab transition instead of an inline panel.

**DD5 — Fold the Flight-6 deferred debt on the touched surfaces**: (a) **`buildSiteInfo` defensive
`escapeHtml`** on any interpolated string fields (the popup is edited by DD4); (b) **`isInternalTab`
cross-reference comment** linking its `id === 'internal'` check to the `createTab` set-site (renderer.js is
touched by DD2/DD4); (c) **internal-preload listener cleanup via explicit `off` methods** — `contextBridge` **cannot return a
function** across the boundary (it strips functions), so the fix is **not** "return an unsubscribe handle"
from `onSettingsChanged`; instead expose explicit `offSettingsChanged`/`offShieldsChanged` methods: the
preload stores each wrapper (`(_e, x) => cb(x)`) in a module-scoped ref keyed by a numeric handle that
`on…` returns (a number is serializable), and `off…(handle)` calls `ipcRenderer.removeListener` with the
stored wrapper. (The guest demonstrably reloads — electronmon during the Flight-6 HAT — so permanent
listeners would accumulate; DD3 adds a 3rd subscription, making this the moment. Only the **internal**
preload needs this — the chrome renderer process doesn't reload.) `menuController`
graduation **assessed → not triggered** (the pin work adds toolbar buttons, not a menu/popup; "Site settings →"
is a change to an existing item, not a 4th roving-menu consumer).
- Rationale: the Flight-6 debrief routed these to "Flight 7, on the touched surface."
- Trade-off: none.

**DD6 — Verification apparatus, premise-audited (act + observe)**:
- *Act* — toggle a pin in the settings guest (`scripts/cdp-driver.mjs` / node-CDP); exercise the shortcut by
  **dispatching the Ctrl+M / Ctrl+Shift+P keydown to the chrome renderer document via cdp-driver** (the
  handler is a chrome `document` keydown, so driving the chrome target directly fires it — we don't rely on
  real focus routing, which would send keys to the active webview); click the web chip's "Site settings →".
  **Not** the `chrome-devtools` MCP.
- *Observe (cite the read path)* — **toolbar**: `#toggle-media`/`#toggle-privacy` presence/`hidden` + the
  icon + count badge in the **chrome** DOM; **persistence**: `userData/settings.json` `toolbarPins`
  (filesystem); **shortcut-still-works**: panel `aria-expanded`/visible after Ctrl+M on an unpinned item;
  **"Site settings →"**: a `goldfinch://settings` tab is active at `#privacy` (tab set + the active webview
  `src`/address); **a11y**: `npm run a11y` (chrome — the icon toolbar) + `--target=goldfinch://settings`
  (the Appearance pin toggles). All existing surfaces — no new read path.
- Rationale: every assertion reads an existing surface or the store file.

**DD7 — Right-click a pinned toolbar icon → native "Unpin" context menu**: Right-clicking a pinned toolbar
icon (`#toggle-media`/`#toggle-privacy`) offers an **Unpin** action (operator). Built as a **native Electron
menu** (operator choice): the renderer adds a `contextmenu` listener on each icon → `e.preventDefault()` →
sends a `toolbar-context-menu` IPC `{ item }`; **main** builds `Menu.buildFromTemplate([{ label: 'Unpin ' +
name, click }])` and `menu.popup({ window: mainWindow })`; the click handler does the write in main —
`settings.set('toolbarPins', { ...settings.get('toolbarPins'), [item]: false })` then
`broadcastToChromeAndInternal('settings-changed', settings.getAll())`. Both surfaces update via the broadcast
(the toolbar hides the icon; the settings Appearance pin-icon toggle flips to unpinned). **No new
renderer-side write channel** — main owns the write (narrowest surface). `menuController` is untouched
(native menu — not a 4th consumer; graduation stays deferred, DD5).
- **Testability (apparatus):** a native Electron menu is **not in the renderer DOM**, so its "Unpin" click
  is **not CDP-drivable** — it is **HAT-verified** (DD6). The behavior test covers unpin-via-the-settings-
  Appearance-toggle (fully drivable); the right-click→native-menu→Unpin path is a HAT step. The
  `contextmenu`→IPC trigger is renderer-testable but the menu itself is OS-level.
- Rationale: standard right-click affordance, minimal code, main owns the write.
- Trade-off: OS-styled (not the app's custom dark menus) + the click is HAT-verified. A custom on-brand
  context menu was considered and declined (operator) — recorded as an acceptable future variation.

### Prerequisites
- [ ] App runs via `npm run dev:debug` (CDP `:9222`); `scripts/cdp-driver.mjs` reaches it. **Not** the
  `chrome-devtools` MCP.
- [ ] `userData/settings.json` writable (Flight-6 store).
- [ ] Guest-target a11y mode (`npm run a11y -- --target=goldfinch://settings`) operational.
- [ ] A reachable web page (for the web chip / "Site settings →" path).
- [ ] **Behavior-test execution prereqs** (verified at flight start): running instance on `:9222`, guest
  reachable — for `toolbar-pins`.

### Pre-Flight Checklist
- [x] Open questions resolved (or deferred to leg design: icon glyphs; the open-vs-reuse settings-tab detail)
- [x] Design decisions documented (DD1–DD7)
- [ ] Prerequisites verified at execution start (live GUI items)
- [x] Validation approach defined (`toolbar-pins` behavior test authored; apparatus premise-audited, DD6)
- [x] Legs defined

---

## In-Flight

### Technical Approach
Store first (pin state + unit tests), then the chrome toolbar apply (icons + show/hide), then the settings
Appearance pin controls, then the "Site settings →" rewire (with the popup escaping debt), then docs + verify.
The internal-preload unsubscribe fix rides with the settings-controls leg (same subscription surface); the
`isInternalTab` comment rides with the renderer-touching legs.

- **`pin-state`** (leg 1): add `toolbarPins` to `settings-store.js` `DEFAULTS` + VALIDATOR (object-of-
  booleans, lenient) + merge-on-read convention; unit tests (valid map; partial/forward-compat merge;
  malformed → default; non-boolean rejected). (DD1)
- **`toolbar-icons-and-pin-apply`** (leg 2): convert `#toggle-media`/`#toggle-privacy` to icon + count badge;
  chrome reads `toolbarPins` + shows/hides per pin at startup + on `onSettingsChanged`; keyboard shortcuts
  stay active; `renderMedia`/`renderPrivacy` update the badge. + the `isInternalTab` comment. (DD2/DD5)
- **`toolbar-context-unpin`** (leg 3): renderer `contextmenu` listener on the pinned toolbar icons → a
  `toolbar-context-menu` IPC → **main** builds + pops a native "Unpin {item}" menu, writes
  `toolbarPins[item]=false`, and broadcasts `settings-changed` (both surfaces update). (DD7)
- **`settings-pin-controls`** (leg 4): Appearance-section **pin-icon toggle buttons** (`aria-pressed`;
  filled-pinned/outline-unpinned; inline-SVG pin) wired via the bridge, two-way synced. + the internal-preload
  explicit `offSettingsChanged`/`offShieldsChanged` cleanup. (DD3/DD5)
- **`site-settings-rewire`** (leg 5): "Site settings →" opens `goldfinch://settings/#privacy` (reuse/open a
  settings tab); + `buildSiteInfo` defensive `escapeHtml`. (DD4/DD5)
- **`docs`** (leg 6): README + CLAUDE.md — the pin system + `toolbarPins` store key + the "Site settings →"
  destination change.
- **`verify-integration`** (leg 7): `toolbar-pins` behavior test; `npm run a11y` (chrome + guest); regress
  `settings-controls` / `tab-scheme-guard` / menu+tab. (SC8 preserved)
- **`hat-and-alignment`** (leg 8, optional): guided HAT — pin/unpin feel, icon+badge, right-click Unpin,
  "Site settings →".

### Checkpoints
- [x] `toolbarPins` persists/validates/merges-forward; unit tests green.
- [x] Pinned → icon+badge in the toolbar; unpinned → removed; Ctrl+M / Ctrl+Shift+P still work when unpinned.
- [ ] Right-click a pinned icon → native "Unpin {item}" menu → the item unpins (toolbar hides + the Appearance
  pin reflects via the broadcast). (HAT-verified — native menu not CDP-drivable.)
- [ ] Appearance pin-icon toggles set `toolbarPins`; toolbar reflects live (two-way).
- [ ] "Site settings →" opens `goldfinch://settings#privacy` (not the slide-out).
- [ ] `toolbar-pins` passes; a11y chrome + guest clean; regressions intact.

### Adaptation Criteria
**Divert / split if**:
- The icon+badge conversion + the count-rendering rework (DD2) proves larger than one leg → split leg 2 into
  the icon/badge conversion and the pin-apply show/hide.

**Acceptable variations**:
- Icon glyphs + badge placement; the open-vs-reuse settings-tab choice for "Site settings →"; whether the
  Appearance pin toggles get a small "Toolbar" subheading within Appearance.

### Legs
> **Note:** Tentative; legs are created one at a time as the flight progresses.
- [x] `pin-state` - `toolbarPins` in the settings store (object-of-booleans, lenient, merge-on-read);
  unit-tested. (DD1)
- [x] `toolbar-icons-and-pin-apply` - icon + count-badge Media/Shield buttons; chrome show/hide per pin;
  shortcuts stay active; + `isInternalTab` comment. (DD2)
- [x] `toolbar-context-unpin` - right-click a pinned icon → native "Unpin {item}" menu (renderer contextmenu
  → main Menu + store write + broadcast). (DD7)
- [x] `settings-pin-controls` - Appearance **pin-icon toggle buttons** (`aria-pressed`; filled/outline) via
  the bridge (two-way); + internal-preload `off…` cleanup methods. (DD3)
- [x] `site-settings-rewire` - "Site settings →" → `goldfinch://settings#privacy`; + `buildSiteInfo`
  defensive escaping. (DD4)
- [x] `docs` - pin system + `toolbarPins` + "Site settings →" destination in README/CLAUDE.md.
- [x] `verify-integration` - `toolbar-pins` behavior test (FD-driven); a11y (chrome + guest) clean; offline
  gates green; found + fixed a pin-toggle two-way-sync bug. (SC8)
- [x] `hat-and-alignment` *(optional)* - Guided HAT: operator approved (icons swapped to Lucide SVG; native
  context-menu clumsiness recorded as a future need); landed.

---

## Post-Flight

### Completion Checklist
- [x] All legs completed
- [ ] Code merged (PR #34 → main, pending)
- [x] Tests passing (221/221; lint + typecheck green; a11y chrome + guest clean)
- [x] Documentation updated (README + CLAUDE.md)

### Verification
- **Behavior test `toolbar-pins`** — toggle a pin in settings → the toolbar icon shows/hides + persists to
  `settings.json`; unpinned item's Ctrl+M / Ctrl+Shift+P still opens its panel; icon + count badge render;
  "Site settings →" opens `goldfinch://settings#privacy`.
- **`npm run a11y`** — chrome (icon toolbar) + guest (`goldfinch://settings`, Appearance pin toggles) clean
  vs the pinned `ACCEPTED` baseline.
- **Regression** — `settings-controls` (the bridge + shields/home wiring), `tab-scheme-guard`, the menu/tab
  suites still pass.
- **Offline gates** — `npm test` / `npm run typecheck` / `npm run lint` green (incl. new `toolbarPins` unit
  tests).
- **HAT/manual** — the **right-click → native "Unpin" context menu** (DD7; native menu not CDP-drivable —
  verify the item unpins + the toolbar/Appearance reflect it); icon/badge + pushpin glyph feel; macOS
  deferred to the mac HAT.
