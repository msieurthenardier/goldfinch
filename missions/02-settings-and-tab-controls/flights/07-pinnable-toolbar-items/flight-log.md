# Flight Log: Pinnable Toolbar Items (Media + Shields)

**Flight**: [Pinnable Toolbar Items (Media + Shields)](flight.md)

## Summary
Flight `in-flight` (2026-06-08). Execution via `/agentic-workflow` (Developer + Reviewer crew; leg design
reviewed per leg; code review + commit batched after the last autonomous leg). Execution notes, decisions,
deviations, and anomalies appended here during the flight.

---

## Reconnaissance Report

Source artifact: the **Flight-6 debrief** (`../06-wire-existing-controls/flight-debrief.md`, Recommendations
+ Action Items) — its carry-forwards walked against current `main` (post-v0.4.8):

| Item | Classification | Evidence | Recommendation |
|------|----------------|----------|----------------|
| Rewire "Site settings →" to the settings page (vs slide-out) | `confirmed-live` | `renderer.js` `buildSiteInfo` → the `.si-settings-btn` handler calls `togglePrivacy(true)` | Core of this flight — DD4, leg 4 |
| `buildSiteInfo` defensive `escapeHtml` on string fields | `confirmed-live` | `buildSiteInfo` escapes `host` only; counts are numbers | Fold into leg 4 (same surface) — DD5 |
| `isInternalTab` string-literal coupling comment | `confirmed-live` (minor) | `isInternalTab` checks `id === 'internal'`; the `createTab` trusted branch sets it — no cross-ref comment | Fold into leg 2 (renderer.js touched) — DD5 |
| internal-preload `onSettingsChanged`/`onShieldsChanged` unsubscribe handles | `confirmed-live` | `internal-preload.js` registers `ipcRenderer.on(...)` with no off-handle; guest reloads (electronmon) → accumulation | Fold into leg 3 (adds another subscription) — DD5 |
| `menuController` module graduation (before 4th consumer) | `confirmed-live` but **threshold not crossed** | this flight adds toolbar buttons + a popup-handler change, NOT a 4th roving-menu/popup consumer | **Assessed → not triggered**; stays deferred |
| Styling acceptance criteria for new UI controls + pre-HAT screenshot | `confirmed-live` (process) | Flight-6 controls shipped unstyled, caught at HAT | **Applied to this flight's leg specs**: the toolbar icons + Appearance pin toggles carry explicit styling criteria (match the design system / `.switch` pill model); the Developer verify step includes a screenshot before the HAT |
| Run formal Witnessed `/behavior-test settings-controls` | `confirmed-live` (carry-forward) | run logs are Flight-Director-driven | Out of this flight's scope; note for a future verification pass |
| Per-site Shields overrides (more-strict-only) | `confirmed-live` (future) | mission Known Issues | Future flight; not this one |

**Carried into this flight**: the "Site settings →" rewire (leg 4) + the three on-surface debt items (legs
2/3/4 per DD5). **Process lesson applied**: leg specs for the new toolbar icons + pin toggles include
explicit styling criteria + a pre-HAT screenshot check (the Flight-6 HAT lesson). **Assessed + deferred**:
`menuController` graduation (no 4th consumer); Witnessed re-run; per-site overrides.

---

## Flight Director Notes

### 2026-06-08 — Flight start (execution)
- **Phase file**: `.flightops/agent-crews/leg-execution.md` loaded + validated (Crew / Interaction Protocol /
  Prompts present) — same well-formed file used for flights 5–6. Crew: Developer (Sonnet), Reviewer (Sonnet,
  never Opus).
- **Branch**: `flight/7-pinnable-toolbar-items` cut from `main` (post-v0.4.8; flights 4–6 merged + released).
- **Planning baseline**: the Flight-7 planning artifacts (this flight dir + `tests/behavior/toolbar-pins.md`;
  the mission Flight-7 line was already committed during Flight-6 planning) committed at branch start.
- **Legs**: 7 autonomous + 1 optional HAT — pin-state → toolbar-icons-and-pin-apply → toolbar-context-unpin
  → settings-pin-controls → site-settings-rewire → docs → verify → HAT. Operator refinements folded in at
  planning: pin control = pushpin-icon toggle (DD3); right-click pinned icon → native "Unpin" menu (DD7).

### 2026-06-08 — Flight-level review + checkpoint commit (after legs 1–6)
- **Reviewer** (Sonnet, fresh context) over the full uncommitted diff (`git diff b61dc5e`) → **[HANDOFF:
  confirmed]**, no blocking issues. Verified: `toolbarPins` validator/normalize/freshDefaults/getAll-deep-copy;
  `applyToolbarPins` (show/hide + shortcuts ungated + focus guards); native context-menu (Menu + main-owned
  write, chrome-trusted); preload `on…`-handle + `off…` + pagehide in all 3 controllers; site-settings rewire
  + escaping; CSP discipline (Unicode toolbar glyphs, inline-svg guest pin); 10 new unit tests. Gates 221/221.
- **Non-blocking note**: both Appearance pin SVGs use the same path (filled/muted is color-only via
  `aria-pressed`) — HAT-tunable; carry to leg 8.
- **Stray assets flagged**: `src/renderer/assets/gf_01.png` + `gf_01_small.png` are untracked, unreferenced in
  `src/`, and predate this session (Jun 7 23:08) — **not** Flight-7 work. **Excluded** from the flight commit;
  not deleted (operator-created). To raise with the operator.
- Checkpoint committed (legs 1–6); live verification (leg 7) + HAT (leg 8) follow.

### Planning
- **Operator decisions** (Flight-7 planning): icon **+ count badge** (preserve media-count + blocked-tracker
  signal + Shield alert); **unpinned keeps its keyboard shortcut** (toolbar-only removal; re-pin from
  settings); pin toggles in the settings **Appearance** section; **HAT included**. Store shape:
  `toolbarPins: { media, shields }` (generic, merge-on-read for forward-compat).
- **menuController graduation**: assessed at planning — not triggered (no 4th menu/popup consumer this
  flight). Stays deferred per the Flight-5/6 debriefs.

---

## Decisions

### Per-leg design review skipped for the docs leg (leg 6)
Docs-only (`README.md`/`CLAUDE.md`) — no codebase cross-reference for a design review to add. Folded into the
flight-level Reviewer pass (reviews the whole uncommitted diff, docs included). Same call as flights 5–6.

---

## Deviations

### Witnessed-pattern deviation — FD-driven `toolbar-pins` (leg 7)
The `toolbar-pins` behavior test was driven by the Flight Director (act + observe), not a spawned
Executor/Validator pair. Compensating control: every verdict cites a raw machine-read value (DOM attribute,
`settings.json` content, tab URL/active state). Same deviation accepted in flights 5–6. The native-menu
right-click Unpin (DD7) is not CDP-drivable → carried to the HAT (leg 8).

---

## Anomalies

### Appearance pin toggle: only the first toggle worked (found + fixed live, leg 7)
Live verification caught a cross-process bug: the first Appearance pin toggle worked, but every subsequent
toggle silently no-op'd. **Root cause**: `internal-settings-set` returns the **full config** object; the pins
controller's `settingsSet(...).then(apply)` set `current` to the full config, so `current.media` became
`undefined`; the next click then sent a non-boolean-valued object as the `toolbarPins` value, the validator
rejected it, `settingsSet` threw, and `.catch` swallowed it. **Fix**: apply the locally-computed `next`
`{media,shields}` map instead of the resolution (`settings.js` pins controller). Re-verified live — 3
consecutive toggles sync. The home-page controller was checked (it ignores the resolution; no change). This
is precisely the kind of cross-process bug the behavior test exists to catch — a point for the debrief.

---

## Leg Progress

### `site-settings-rewire` — landed (2026-06-07)

**Status**: landed

**Changes**:
- `src/renderer/renderer.js` — `buildSiteInfo`:
  - Changed the `.si-settings-btn` click handler: replaced `togglePrivacy(true)` with a reuse-or-create open of `goldfinch://settings/#privacy`. Finds an existing internal tab via `[...tabs.values()].find(isInternalTab)`; if found, calls `existing.webview.loadURL('goldfinch://settings/#privacy').catch(() => {})` + `activateTab(existing.id)`; else `createTab('goldfinch://settings/#privacy', null, { trusted: true })`. `closeSiteInfo()` is still called first.
  - Wrapped the `trackers` and `permissions` number interpolations in `escapeHtml(String(...))` for uniform defense-in-depth (matching the existing `host` + `connection` escaping).

**Note**: `togglePrivacy` itself is untouched (still used by the Shields panel button + keyboard shortcut). Live open-settings flow (reuse-or-create, `#privacy` section in view) deferred to leg 7.

**Offline gates**: `npm run lint` ✓ | `npm run typecheck` ✓ | `npm test` ✓ (221/221)

---

### `settings-pin-controls` — landed (2026-06-07)

**Status**: landed

**Changes**:
- `src/preload/internal-preload.js`:
  - Added `let nextHandle = 1; const listeners = new Map();` plus `on(channel, cb)` / `off(h)` helpers inside the existing `location.origin === 'goldfinch://settings'` guard.
  - Rewrote `onSettingsChanged` and `onShieldsChanged` to use `on(...)` (returning a numeric handle).
  - Added `offSettingsChanged: (h) => off(h)` and `offShieldsChanged: (h) => off(h)` to the exposed bridge.
- `src/renderer/renderer-globals.d.ts`:
  - Changed `onSettingsChanged` / `onShieldsChanged` return type from `void` to `number`.
  - Added `offSettingsChanged(h: number): void` and `offShieldsChanged(h: number): void` to `GoldfinchInternalBridge`.
- `src/renderer/pages/settings.html`:
  - Replaced the `#appearance` placeholder `<p>` with two `.appearance-row` divs: `#pin-media` and `#pin-shields` toggle buttons, each containing an inline pushpin `<svg>` (`fill="currentColor"`, `aria-hidden="true"`, `focusable="false"`).
- `src/renderer/pages/settings.css`:
  - Added `.appearance-row` (flex; label left / button right, matching `.shield-row` layout).
  - Added `.pin-toggle` (button reset; cursor; `[aria-pressed="true"]` → `color: var(--accent)`; `[aria-pressed="false"]` → `color: var(--fg-dim)`; hover; `:focus-visible` 2px accent ring).
- `src/renderer/pages/settings.js`:
  - Added appearance pins controller IIFE: `settingsGet('toolbarPins').then(apply)`; click toggles write `settingsSet('toolbarPins', {...current, [k]: !current[k]}).then(apply)`; `onSettingsChanged` two-way sync; `pagehide` cleanup via `offSettingsChanged`.
  - Retrofitted home-page controller: captures `hSettings = onSettingsChanged(...)` + registers `pagehide` → `offSettingsChanged(hSettings)`.
  - Retrofitted shields controller: captures `hShields = onShieldsChanged(...)` + registers `pagehide` → `offShieldsChanged(hShields)`.

**Note**: live pin UI, two-way toolbar sync, and a11y verified at leg 7.

**Offline gates**: `npm run lint` ✓ | `npm run typecheck` ✓ | `npm test` ✓ (221/221)

---

### `toolbar-context-unpin` — landed (2026-06-07)

**Status**: landed

**Changes**:
- `src/main/main.js`:
  - Added `Menu` to the `require('electron')` destructure (line 3).
  - Added `ipcMain.on('toolbar-context-menu', ...)` handler after `app-quit`: validates `item` ∈ `['media','shields']`; builds a native `Menu` with a single "Unpin Media/Shields" item; the click handler writes `toolbarPins[item]=false` via `settings.set` and calls `broadcastToChromeAndInternal('settings-changed', settings.getAll())`. `menu.popup({ window: mainWindow })`.
- `src/preload/chrome-preload.js`:
  - Added `toolbarContextMenu: (item) => ipcRenderer.send('toolbar-context-menu', item)` to the `window.goldfinch` surface (alongside `windowMinimize` / `appQuit`).
- `src/renderer/renderer.js`:
  - Added `contextmenu` listener on `els.toggleMedia`: `e.preventDefault(); window.goldfinch.toolbarContextMenu('media')`.
  - Added `contextmenu` listener on `els.togglePrivacy`: `e.preventDefault(); window.goldfinch.toolbarContextMenu('shields')`.
- `src/renderer/renderer-globals.d.ts`:
  - Added `toolbarContextMenu(item: string): void` to `GoldfinchBridge` (typecheck stays green).

**Note**: native-menu "Unpin" action is HAT-verified (leg 8); the unpin effect (toolbarPins→false → toolbar hides + settings reflects) is equivalently covered by the settings-Appearance-toggle path in the `toolbar-pins` behavior test (leg 7).

**Offline gates**: `npm run lint` ✓ | `npm run typecheck` ✓ | `npm test` ✓ (221/221)

---

### `toolbar-icons-and-pin-apply` — landed (2026-06-07)

**Status**: landed

**Changes**:
- `src/renderer/index.html`:
  - Converted `#toggle-media` from `class="text-btn"` to `class="icon-btn"` with glyph span (▤, `aria-hidden="true"`) + `<span id="media-count" class="tb-badge hidden" aria-hidden="true">`. Added `aria-label="Media"`.
  - Converted `#toggle-privacy` similarly: glyph ◈, `<span id="privacy-count" class="tb-badge hidden" aria-hidden="true">`. Added `aria-label="Shields"`.
- `src/renderer/renderer.js`:
  - `renderMedia` (~917): badge text = bare count (`String(n)`), hidden at 0 (`.hidden` toggle), dynamic `aria-label` (`'Media, N items'` / `'Media'`).
  - `updatePrivacyBadge` (~1504): badge text = bare count, hidden at 0, dynamic `aria-label` (`'Shields, N blocked'` / `'Shields'`), `.alert` toggle preserved; WCAG-1.4.1 comment updated to reflect badge-carries-count.
  - `applyToolbarPins(pins)` added: toggles `.hidden` on `els.toggleMedia`/`els.togglePrivacy` per `pins.media`/`pins.shields`.
  - Startup: `window.goldfinch.settingsGet('toolbarPins').then(applyToolbarPins).catch(() => {})`.
  - `onSettingsChanged` handler extended: also calls `applyToolbarPins(all.toolbarPins)` when present (keeps `homePageCache` update).
  - Focus-restoration guard in `togglePanel`: `if (!els.toggleMedia.classList.contains('hidden')) els.toggleMedia.focus()`.
  - Focus-restoration guard in `togglePrivacy`: `if (!els.togglePrivacy.classList.contains('hidden')) els.togglePrivacy.focus()`.
  - `isInternalTab` comment added (DD5): notes `tab.container.id === 'internal'` is set at the `createTab` trusted branch (~468).
- `src/renderer/styles.css`:
  - `#toggle-media`, `#toggle-privacy`: `position: relative; width: 36px` (badge anchor).
  - `.tb-glyph`: display block, font-size 14px.
  - `.tb-badge`: absolute corner badge (top-right), 14px height, accent background, 9px bold text; hidden via `.hidden`.
  - `#toggle-privacy.alert`: updated rule — note `border-color` is vestigial on `.icon-btn` (no border); `background`/`color` carry the alert state.
  - `#toggle-privacy.alert .tb-badge`: brighter red badge for legibility on the red button.

**Glyphs chosen**: ▤ (Media — grid/layers feel, monochrome) and ◈ (Shields — diamond with dot, shield-ish, monochrome). Both HAT-tunable.

**Note**: live render / screenshot deferred to leg 7 (verify-integration).

**Offline gates**: `npm run lint` ✓ | `npm run typecheck` ✓ | `npm test` ✓ (221/221)

---

### `pin-state` — landed (2026-06-07)

**Status**: landed

**Changes**:
- `src/main/settings-store.js`:
  - Added `toolbarPins: { media: true, shields: true }` to `DEFAULTS`
  - Updated `@type` JSDoc on `DEFAULTS`, `config`, `load()` `@returns`, `getAll()` `@returns`, and `set()` `@returns` to include `toolbarPins`
  - Added `VALIDATORS.toolbarPins` — object-of-booleans check; rejects `null`, arrays, non-booleans; lenient on which keys are present (forward-compat)
  - Added `NORMALIZERS` map with `toolbarPins: (v) => ({ ...DEFAULTS.toolbarPins, ...v })` (deep-merge onto defaults)
  - Added `freshDefaults()` helper — replaces all four `{ ...DEFAULTS }` sites (module-level `config`, merge start, no-file `else`, `catch`)
  - Applied normalizer in `load()`'s merge loop after validator (both validator-branch and type-compat branch)
  - Added `typeof null === 'object'` comment at the no-validator branch explaining why object-typed keys need an explicit validator
  - Applied normalizer in `set()` after validation (`const v = NORMALIZERS[key] ? ...`)
  - Updated `getAll()` to deep-copy the nested object: `return { ...config, toolbarPins: { ...config.toolbarPins } }`
- `test/unit/settings-store.test.js`:
  - Added 10 new `toolbarPins` tests (default on first load; set full map persist+reload; set partial → normalized; set throws on null/array/string/non-boolean with prior value kept; load partial forward-compat; load malformed → default; getAll fresh object)

**Test count**: 221 total (24 settings-store tests: 14 existing + 10 new `toolbarPins`); 0 failures

**Offline gates**: `npm run lint` ✓ | `npm run typecheck` ✓ | `npm test` ✓

---

### `docs` — landed (2026-06-08)

**Status**: landed

**Changes**:
- `README.md`:
  - Updated the site-info popup bullet: "Site settings →" now described as opening the Settings page's Privacy & Shields section (not the slide-out panel).
  - Added a **Pinnable toolbar icons** bullet under Features explaining the pin/unpin model: pinned = icon in toolbar, right-click → Unpin; unpinned = icon removed (keyboard shortcut still works; re-pin from Settings → Appearance). Pin state persists.
  - Updated `internal-pages` section Appearance subsection: documents the pin-icon toggle buttons in the Settings → Appearance section, noting that changes persist and reflect live in the toolbar.
  - Corrected the Privacy/Media panel toggle descriptions to use "icon" rather than "button" phrasing; updated the Settings section's feature list to include Appearance as a working section.
- `CLAUDE.md`:
  - **`toolbarPins` setting** (Settings store section): documents the boolean map, the `VALIDATORS.toolbarPins` requirement (why the no-validator `typeof` fallback is insufficient for object-typed keys), the `NORMALIZERS.toolbarPins` deep-merge for forward-compat, and the `getAll()` deep-copy contract.
  - **Pin-state propagation** (`applyToolbarPins` + `settings-changed` broadcast): explains the startup read path, the `onSettingsChanged` live re-apply, the unpinned-but-shortcut-active guarantee, and the focus-restoration guard for hidden buttons.
  - **Right-click Unpin** (main-owned write path): documents the `contextmenu`→`toolbar-context-menu` IPC→native `Menu`→`settings.set`+broadcast chain; makes explicit that main owns the write and the renderer fires only a one-way send.
  - **Appearance pin-icon toggles** (settings page): documents the `apply(pins)` function, `aria-pressed` toggle pattern, click write path, and two-way `onSettingsChanged` sync.
  - **Internal-preload listener-handle pattern**: documents the `on(channel, cb) → numeric handle` + `off(h)` map, why it's needed (guest reloads accumulate listeners), why handles are used (contextBridge can return numbers but not functions), and the `pagehide` cleanup idiom in `settings.js` controllers.
  - **"Site settings →" destination** (address-bar chip section): documents the reuse-or-create `goldfinch://settings/#privacy` open pattern and that it replaced `togglePrivacy(true)`.

**Offline gates**: `npm run lint` ✓ (docs-only; no source changes introduced by this leg)

---

## Session Notes

_(none yet)_
