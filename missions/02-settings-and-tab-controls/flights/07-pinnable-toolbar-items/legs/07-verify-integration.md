# Leg: verify-integration

**Status**: landed
**Flight**: [Pinnable Toolbar Items (Media + Shields)](../flight.md)

## Objective
Live-verify the pin/unpin system end-to-end (the `toolbar-pins` behavior test, FD-driven Witnessed-pattern),
a11y (chrome + guest), and regressions; surface + fix any issues before the HAT.

## Apparatus
- App via `npm run dev:debug` (CDP `:9222`); chrome driven by `scripts/cdp-driver.mjs`; the `goldfinch://
  settings` guest driven by a raw-CDP `Runtime.evaluate` helper (`/tmp/gf-guest-eval.mjs`, modeled on
  cdp-driver). **Not** the `chrome-devtools` MCP. Witnessed-pattern deviation: the Flight Director drove both
  act + observe; every verdict cites a raw machine-read value (DOM attr, `settings.json`, tab state).

## Results (2026-06-08)
- [x] **Toolbar icons render** — `#toggle-media` glyph ▤ + badge "2" (`aria-label="Media, 2 items"`),
  `#toggle-privacy` glyph ◈ (badge hidden at 0, `aria-label="Shields"`); badges `aria-hidden`; both visible
  (default pinned). Screenshot captured (icons legible; glyphs HAT-tunable).
- [x] **Forward-compat** — a pre-existing `settings.json` with no `toolbarPins` → normalize-at-load applied
  defaults → both icons shown. (Confirms DD1 forward-compat live.)
- [x] **Chrome a11y** — `npm run a11y`: no NEW violations vs the ACCEPTED baseline (icon buttons' dynamic
  `aria-label` pass).
- [x] **Appearance pin toggles** — `#pin-media`/`#pin-shields` present, `aria-pressed`, labelled, inline-SVG;
  bridge + `offSettingsChanged` exposed.
- [x] **Unpin → live two-way sync** — toggling Media off in Appearance → guest `aria-pressed=false` +
  `settings.json` `toolbarPins.media=false` (normalized to full map) + chrome `#toggle-media` hidden (via the
  `settings-changed` broadcast → `applyToolbarPins`).
- [x] **Multiple toggles** — 3 consecutive Media toggles (off→on→off) each kept button + store + chrome in
  sync. *(Verified AFTER the fix below.)*
- [x] **Shortcut survives unpin** — with Media unpinned, dispatching Ctrl+M to the chrome document opened the
  `media-panel` (`display:flex`); `aria-expanded` flipped on the hidden button → `togglePanel()` ran.
- [x] **"Site settings →"** — web tab's site-info popup → "Site settings →" reused the open settings tab,
  navigated it to `goldfinch://settings/#privacy` (active), section heading "Privacy & Shields"; the slide-out
  privacy panel stayed **collapsed** (`aria-expanded=false`) — did NOT open.
- [x] **Guest a11y** — `npm run a11y -- --target=goldfinch://settings`: no NEW violations (pin toggles pass).
- [x] **Offline gates** — `npm run lint` / `typecheck` / `test` (221/221) green.
- [~] **Right-click → native "Unpin" menu** — native Electron menu is not in the renderer DOM (not
  CDP-drivable) → **deferred to the HAT (leg 8)** per DD6/DD7.

## Bug found + fixed (live)
- **Appearance pin toggle: only the FIRST toggle worked; every subsequent toggle silently no-op'd.**
- Root cause: `internal-settings-set` returns the **full config** (`settings.set` → `{version, homePage,
  toolbarPins}`); the pins controller's `settingsSet(...).then(apply)` set `current = fullConfig` →
  `current.media` became `undefined` → the next click sent `{version, homePage, toolbarPins, media:true}` as
  the value → `VALIDATORS.toolbarPins` rejected it (version is a number) → `settingsSet` threw → `.catch`
  swallowed → silent no-op.
- Fix (`settings.js` pins controller): apply the **locally-computed** `next` map, not the resolution —
  `const next = {...current,[k]:!current[k]}; settingsSet('toolbarPins', next).then(() => apply(next))`. So
  `apply` only ever receives a clean `{media,shields}` map. (Home-page controller checked — it ignores the
  resolution; no change.) Re-verified: 3 consecutive toggles sync. This is exactly the cross-process bug the
  behavior test exists to catch.

## Files
- `src/renderer/pages/settings.js` — pins-controller fix (apply locally-computed `next`).

---

## Post-Completion Checklist
- [x] Behavior-test flow driven live (toolbar-pins): pin persists + toolbar reflects + shortcut survives +
  "Site settings →" → settings page
- [x] a11y chrome + guest clean; offline gates green
- [x] Bug found + fixed + re-verified
- [x] Flight log updated; leg status `landed`; checked off in flight.md
- [x] Right-click native menu carried to the HAT (leg 8)
