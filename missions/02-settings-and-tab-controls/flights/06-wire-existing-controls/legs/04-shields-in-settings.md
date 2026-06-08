# Leg: shields-in-settings

**Status**: landed
**Flight**: [Wire Existing Controls (Shields + Home Page) into Settings](../flight.md)

## Objective
Wire the **global Shields toggles** (`enabled`/`block`/`strip`/`isolate`/`farble`) into the settings page's
Privacy & Shields section over the secured bridge, and make changes **two-way consistent** with the existing
slide-out panel by fanning the `shields-changed` broadcast out to the settings guest (not just the chrome).

## Context
- **DD3.** The settings page wires the **global** Shields config (reusing `shields.js` `get`/`set`); the
  **per-site pause** (`pausedSites`) stays in the slide-out panel (it needs a current site, which
  `goldfinch://settings` lacks).
- **Sync fix (the key DD3 piece).** Today both the chrome `shields-set` and `shields-pause` handlers do
  `mainWindow.webContents.send('shields-changed', cfg)` — chrome-only. They must use the leg-3
  `broadcastToChromeAndInternal('shields-changed', cfg)` helper so a toggle from **either** surface reaches
  **both** the panel and the settings page. The chrome renderer already re-renders on `shields-changed`
  (`renderer.js` `onShieldsChanged` ~1519 → `renderPrivacy`); the settings guest subscribes via the leg-2
  `window.goldfinchInternal.onShieldsChanged`.
- **Bridge channels (leg-2 deferred these to here).** Add `internal-shields-get`/`internal-shields-set` via
  the leg-2 `registerInternalHandler` (origin-locked), backed by `shields.js`; `internal-shields-set`
  broadcasts `shields-changed` after the set (so both surfaces update). `internal-preload.js` already exposes
  `onShieldsChanged` (leg 2) — add `shieldsGet`/`shieldsSet`.
- **Cache-freshness contract** (DD3): source of truth = `shields.js`; rebuild trigger = `shields-changed`
  (fired on every set/pause from either surface, now fanned to both); max staleness = one IPC round-trip;
  invalidating actions = a toggle from settings OR the panel.

## Inputs
- `src/main/main.js` — the chrome `shields-set`/`shields-pause` handlers (currently chrome-only broadcast);
  `shields` module (`get`/`set`); `registerInternalHandler` (leg 2); `broadcastToChromeAndInternal` (leg 3).
- `src/preload/internal-preload.js` (leg 2 — exposes `onShieldsChanged`; add `shieldsGet`/`shieldsSet`).
- `src/main/shields.js` — `DEFAULTS` (`enabled`/`block`/`strip`/`isolate`/`farble` + `pausedSites`),
  `get`/`set`.
- `src/renderer/pages/settings.html` `#privacy` section (placeholder) + `src/renderer/pages/settings.js`
  (scroll-spy + home-page controller from leg 3).
- `src/renderer/renderer.js` — `SHIELD_ROWS` labels (`block`/`strip`/`isolate`/`farble`) + the master
  `enabled` toggle, as the label reference for the settings UI.

## Outputs
- `internal-shields-get`/`internal-shields-set` channels (origin-locked) + `shieldsGet`/`shieldsSet` on the
  guest bridge.
- The chrome `shields-set`/`shields-pause` broadcasts fanned out to the guest.
- A global-Shields toggle UI in the settings Privacy & Shields section, two-way synced with the panel.

## Acceptance Criteria
- [ ] **Bridge channels** (`main.js` via `registerInternalHandler`): `internal-shields-get` → `shields.get()`;
  `internal-shields-set` → `(_e, patch) => { const cfg = shields.set(patch || {});
  broadcastToChromeAndInternal('shields-changed', cfg); return cfg; }`. (Origin-locked — only the
  `goldfinch://settings` guest.)
- [ ] **Guest bridge** (`internal-preload.js`, inside the existing origin guard): add `shieldsGet: () =>
  ipcRenderer.invoke('internal-shields-get')` and `shieldsSet: (patch) =>
  ipcRenderer.invoke('internal-shields-set', patch)`. (`onShieldsChanged` already present from leg 2.)
- [ ] **Sync fix** (`main.js`): the existing chrome `shields-set` AND `shields-pause` handlers replace
  `mainWindow.webContents.send('shields-changed', cfg)` with `broadcastToChromeAndInternal('shields-changed',
  cfg)` — **modify** them (do not add new handlers). A panel toggle now reaches the settings page, and vice
  versa.
- [ ] **Settings UI** (`settings.html` `#privacy` + `settings.js`): the Privacy & Shields section presents
  the **global** toggles — master `enabled` + `block`/`strip`/`isolate`/`farble` — as labelled checkboxes (no
  inline handlers — CSP); a short note that per-site exceptions live in the Shields panel. `settings.js`
  populates the checkboxes from `window.goldfinchInternal.shieldsGet()`, writes on change via
  `shieldsSet({ [key]: checked })`, and re-syncs on `onShieldsChanged((cfg) => …)`. Keyboard-operable; guards
  `if (!window.goldfinchInternal) return;`.
- [ ] **Two-way consistency** (live, leg 6): toggling in settings updates the panel; toggling in the panel
  updates settings; both persist to `shields.json`.
- [ ] **Per-site pause untouched** — the settings page does NOT surface `pausedSites`; the panel keeps it.
- [ ] `npm run lint`, `npm run typecheck`, `npm test` green (210 — no new unit tests expected; the shields
  store is already covered, the wiring is verified live in leg 6).

## Verification Steps
- `npm run lint && npm run typecheck && npm test` — green.
- Code read: `internal-shields-*` channels via the wrapper; `internal-shields-set` broadcasts; the chrome
  `shields-set`/`shields-pause` now use `broadcastToChromeAndInternal`; guest bridge has `shieldsGet`/
  `shieldsSet`; settings `#privacy` checkboxes wired with no inline handlers; per-site pause not surfaced.
- **Deferred to leg 6 (live):** settings toggle ↔ panel toggle two-way sync; persistence to `shields.json`;
  guest a11y clean.

## Implementation Guidance
1. **main.js**: register via the leg-2 wrapper (near the `internal-settings-*` registrations):
   `registerInternalHandler(ipcMain, 'internal-shields-get', () => shields.get());`
   `registerInternalHandler(ipcMain, 'internal-shields-set', (_e, patch) => { const cfg = shields.set(patch ||
   {}); broadcastToChromeAndInternal('shields-changed', cfg); return cfg; });`
   Then **modify** the existing chrome `shields-set` and `shields-pause` handlers: replace the
   `if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('shields-changed', cfg);` line
   with `broadcastToChromeAndInternal('shields-changed', cfg);` (the helper already guards mainWindow).
2. **internal-preload.js**: inside the `location.origin === 'goldfinch://settings'` block, add `shieldsGet`
   and `shieldsSet` next to the settings methods (JSDoc to match the file's style).
3. **settings.html** `#privacy`: replace the placeholder `<p>` with the master toggle + 4 strategy toggles as
   labelled checkboxes **wrapped in a `<fieldset>`** so screen readers announce them as one group (pre-empts a
   leg-6 a11y grouping flag): `<fieldset><legend>Shields</legend> <label><input type="checkbox"
   id="shield-enabled" /> Shields</label> …</fieldset>` — ids `shield-block`/`shield-strip`/`shield-isolate`/
   `shield-farble`; labels from `SHIELD_ROWS` ("Block trackers", "Strip tracking params", "Isolate 3rd-party
   cookies", "Farble fingerprint"). Add a note `<p>Per-site exceptions are managed from the Shields
   panel.</p>`. Keep the `<h2>`.
4. **settings.js**: add a named `shieldsController` IIFE (after the home-page controller; keep both + the
   scroll-spy intact), guarded on `window.goldfinchInternal`. A `KEYS = ['enabled','block','strip','isolate',
   'farble']` mapped to the checkbox ids; `applyConfig(cfg)` sets each `checkbox.checked = !!cfg[key]`
   (**assign `.checked` directly — NEVER `.click()` or `.dispatchEvent(new Event('change'))`, which would
   echo-loop**); on load `shieldsGet().then(applyConfig)`; each checkbox `change` → `shieldsSet({ [key]:
   checkbox.checked })`; `onShieldsChanged(applyConfig)` re-syncs (panel→settings). Guard for element
   existence.

## Edge Cases
- **A panel toggle while settings is open** → `shields-changed` now reaches the guest → `applyConfig`
  re-syncs the checkboxes (the DD3 sync). Verify no echo loop: `shieldsSet` from settings → broadcast →
  `onShieldsChanged` → `applyConfig` sets `.checked` (no `change` event fired by programmatic `.checked`
  assignment, so no loop). Confirm `applyConfig` sets `.checked` directly (not via `.click()`).
- **`enabled` master off** — the panel grays/disables the sub-toggles via its own logic; the settings page
  can mirror that affordance or leave the sub-toggles active (they still persist; `shields.active()` gates on
  `enabled`). Keep it simple: all five are independent checkboxes that persist; the master's effect is in
  `shields.active()` already. (No need to replicate the panel's disabled-state styling unless trivial.)
- **Per-site pause NOT surfaced** — do not read/write `pausedSites` from settings.
- **Guest bridge absent** (`!window.goldfinchInternal`) — the controller no-ops (defensive).
- **Reuse `broadcastToChromeAndInternal`** — do NOT reintroduce a chrome-only `mainWindow.webContents.send`
  for shields.

## Files Affected
- `src/main/main.js` — `internal-shields-get`/`internal-shields-set` channels; `shields-set`/`shields-pause`
  broadcast via `broadcastToChromeAndInternal`.
- `src/preload/internal-preload.js` — `shieldsGet`/`shieldsSet` on the guest bridge.
- `src/renderer/pages/settings.html` — `#privacy` global-Shields toggle UI.
- `src/renderer/pages/settings.js` — shields controller.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:** *(commit deferred to the flight-level review)*

- [ ] All acceptance criteria verified (offline; live two-way sync + persistence deferred to leg 6)
- [ ] Tests passing (offline gates)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed` (commit deferred)
- [ ] Check off this leg in flight.md
- [ ] Do NOT commit; do NOT signal `[HANDOFF:review-needed]`
