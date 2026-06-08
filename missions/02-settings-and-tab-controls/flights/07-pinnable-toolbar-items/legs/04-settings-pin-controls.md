# Leg: settings-pin-controls

**Status**: landed
**Flight**: [Pinnable Toolbar Items (Media + Shields)](../flight.md)

## Objective
Add **pin-icon toggle buttons** for Media and Shields to the settings **Appearance** section (wired to
`toolbarPins` over the secured bridge, two-way synced), and fix the internal-preload listener accumulation by
adding explicit **off** methods + `pagehide` cleanup.

## Context
- **DD3.** The Appearance section (placeholder today) gets per-item rows — label left, a **pin-icon toggle
  button** right — using a **pushpin glyph** (inline `<svg>` is CSP-safe in the guest under `default-src
  'self'` — inline SVG markup isn't a loaded resource), **filled/accent when pinned, outline/muted when
  unpinned**, with `aria-pressed` carrying state. Wired via the Flight-6 bridge (`settingsGet`/`settingsSet`/
  `onSettingsChanged`). Toggling → `settings-changed` → the chrome `applyToolbarPins` (leg 2) shows/hides the
  toolbar icon; a right-click Unpin (leg 3) or a panel change flows back here via `onSettingsChanged`.
- **DD5.** `internal-preload.js`'s `onSettingsChanged`/`onShieldsChanged` are bare `ipcRenderer.on(...)` with
  no way to unsubscribe — and the guest **reloads** (electronmon during dev; a real `goldfinch://settings`
  reload), so listeners accumulate. `contextBridge` **can't return a function**, so the fix is: `on…(cb)`
  **returns a numeric handle** (storing the wrapper in a preload module map), and **`off…(handle)`** removes
  it via `ipcRenderer.removeListener`. The settings-page controllers capture the handle and call `off…` on
  **`pagehide`** (fires in the old page context, where the handle/wrapper still exist) — so each reload's
  listeners are removed before the next load.
- **settings.js shape:** 3 controller IIFEs today (scroll-spy; home-page ~83; shields ~118) — add a 4th
  (Appearance pins); retrofit the home + shields controllers with the same `pagehide` cleanup so all three
  subscribers stop accumulating.

## Inputs
- `src/renderer/pages/settings.html` — `#appearance` placeholder section.
- `src/renderer/pages/settings.js` — the home-page + shields controller IIFEs (pattern + their
  `onSettingsChanged`/`onShieldsChanged` subscriptions to retrofit).
- `src/renderer/pages/settings.css` — the existing control styling (the pill-switch; here a NEW pin-icon style).
- `src/preload/internal-preload.js` — `onSettingsChanged` (line ~45), `onShieldsChanged` (line ~66) to refactor.

## Outputs
- Appearance section with two pin-icon toggle buttons (`#pin-media`, `#pin-shields`).
- A settings.js Appearance-pins controller (+ `pagehide` cleanup), and `pagehide` cleanup retrofitted to the
  home + shields controllers.
- internal-preload `on…` returns handles + `offSettingsChanged`/`offShieldsChanged`.
- Pin-icon CSS.

## Acceptance Criteria
- [ ] **settings.html `#appearance`**: replace the placeholder with per-item rows (label left, pin button
  right) for **Media** and **Shields** — e.g. `<div class="appearance-row"><span>Media</span><button
  type="button" class="pin-toggle" id="pin-media" aria-pressed="true" aria-label="Pin Media to toolbar">
  {pushpin svg}</button></div>` (and `#pin-shields`). The pushpin is an **inline `<svg>`** (`currentColor`,
  `aria-hidden`/`focusable="false"`). No inline handlers (CSP).
- [ ] **settings.css**: `.pin-toggle` styling — `aria-pressed="true"` → **accent/filled** (e.g. `color:
  var(--accent)`), `aria-pressed="false"` → **muted/outline** (e.g. `color: var(--fg-dim)`; outline pin);
  hover + `:focus-visible` ring; `.appearance-row` layout (label left / button right, like the Privacy rows).
- [ ] **settings.js pins controller** (new IIFE; guard `if (!window.goldfinchInternal) return;` + element
  existence): `settingsGet('toolbarPins').then(apply)`; `apply(pins)` sets each button's
  `aria-pressed = String(!!pins[key])` and caches `current`; each button `click` → `settingsSet('toolbarPins',
  { ...current, [key]: !current[key] }).then(apply).catch(()=>{})`; `onSettingsChanged((all) => { if (all &&
  all.toolbarPins) apply(all.toolbarPins); })`. Two-way: a leg-2/leg-3 change re-syncs the buttons.
- [ ] **internal-preload (DD5)**: refactor — a module map `handle → { channel, wrapper }` + an incrementing
  counter (**declared inside the existing `location.origin` guard**); `onSettingsChanged(cb)` /
  `onShieldsChanged(cb)` register `(_e, x) => cb(x)`, store it, and **return the numeric handle**; add
  `offSettingsChanged(handle)` / `offShieldsChanged(handle)` that `ipcRenderer.removeListener(channel,
  wrapper)` + delete the map entry. (A shared `on(channel,cb)`/`off(h)` helper is fine.)
- [ ] **`renderer-globals.d.ts` updated (typecheck)**: on the `GoldfinchInternalBridge` interface, change
  `onSettingsChanged`/`onShieldsChanged` return type from `void` to `number`, and add
  `offSettingsChanged(h: number): void` + `offShieldsChanged(h: number): void` — else `tsc` errors on the
  controllers capturing the handle + calling `off…`.
- [ ] **pagehide cleanup**: the pins controller captures its `onSettingsChanged` handle and
  `window.addEventListener('pagehide', () => window.goldfinchInternal.offSettingsChanged(h), { once: true })`.
  **Retrofit** the home-page controller (`onSettingsChanged` handle) and the shields controller
  (`onShieldsChanged` handle) the same way, so all three subscribers clean up on reload.
- [ ] **a11y** (Flight-6 lesson): the pin buttons are keyboard-operable, labelled, `aria-pressed` reflects
  state; styling matches the brand. Verified by screenshot + a11y at leg 7 (before the HAT).
- [ ] `npm run lint`, `npm run typecheck`, `npm test` green (221 — no new unit tests; the guest controls +
  bridge are verified live in leg 7).

## Verification Steps
- `npm run lint && npm run typecheck && npm test` — green.
- Code read: appearance rows + inline-svg pin + aria-pressed; pins controller reads/writes `toolbarPins`
  via the bridge + re-syncs on `onSettingsChanged`; preload `on…` returns a handle + `off…` removes; all
  three controllers register a `pagehide` cleanup; no inline handlers.
- **Deferred to leg 7 (live):** toggle a pin in Appearance → toolbar icon shows/hides + `settings.json`
  persists; right-click-unpin / panel changes re-sync the Appearance pin; a11y clean; (listener-accumulation
  is a reload concern — spot-check at the HAT if convenient).

## Implementation Guidance
1. **internal-preload.js**: add `let nextHandle = 1; const listeners = new Map();` + `on(channel, cb)` /
   `off(handle)` helpers; rewrite `onSettingsChanged`/`onShieldsChanged` to `(cb) => on('settings-changed' |
   'shields-changed', cb)` (return the handle); add `offSettingsChanged`/`offShieldsChanged: (h) => off(h)`.
   Keep them inside the existing `location.origin === 'goldfinch://settings'` guard.
2. **settings.html**: build the `#appearance` rows + inline pushpin `<svg>` (a simple pin path; `fill=
   "currentColor"` as an **XML presentation attribute** — **no inline `style=""`** on the svg/children, which
   CSP would block; `aria-hidden="true" focusable="false"`).
3. **settings.css**: `.appearance-row` + `.pin-toggle` (aria-pressed states, hover, focus-visible).
4. **settings.js**: add the pins controller IIFE; retrofit home + shields controllers to capture their
   subscription handle + add the `pagehide` `off…` cleanup.

## Edge Cases
- **`pagehide` fires in the OLD page context** — the captured handle + the preload's stored wrapper are still
  valid there, so `off…` removes the right listener before the next load. (Correct place for the cleanup.)
- **`settingsSet('toolbarPins', …)` rejection** (shouldn't for a boolean map): `.catch(()=>{})` keeps the UI
  from throwing; the button reverts on the next `onSettingsChanged`/reload.
- **Inline SVG vs CSP**: inline `<svg>` markup is fine under `default-src 'self'` (not a loaded resource);
  do NOT use a data-URI/external SVG.
- **aria-pressed, not a checkbox**: a toggle button (`aria-pressed`) is the right pattern for a pin; do NOT
  reuse the Shields pill-checkbox.
- Don't forget to retrofit the existing two controllers' cleanup (else they still accumulate).

## Files Affected
- `src/renderer/pages/settings.html` — `#appearance` pin rows.
- `src/renderer/pages/settings.css` — `.appearance-row` + `.pin-toggle`.
- `src/renderer/pages/settings.js` — pins controller + `pagehide` cleanup (all three controllers; comment
  that `pagehide` fires in the old document context where the handle/wrapper are still valid).
- `src/preload/internal-preload.js` — `on…` returns handle + `offSettingsChanged`/`offShieldsChanged`.
- `src/renderer/renderer-globals.d.ts` — `GoldfinchInternalBridge`: `on…` return `number` + `off…` methods.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:** *(commit deferred to the flight-level review)*

- [ ] All acceptance criteria verified (offline; live pin UI + sync deferred to leg 7)
- [ ] Tests passing (offline gates)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed` (commit deferred)
- [ ] Check off this leg in flight.md
- [ ] Do NOT commit; do NOT signal `[HANDOFF:review-needed]`
