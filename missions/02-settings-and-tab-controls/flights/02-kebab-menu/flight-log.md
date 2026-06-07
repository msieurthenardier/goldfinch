# Flight Log: Kebab Menu

**Flight**: [Kebab Menu](flight.md)

## Summary

Flight is `in-flight` — design reviewed by the Architect (approve-with-changes; all issues
incorporated), operator-approved. Executing via `/agentic-workflow` (Flight Director orchestration).

---

## Flight Director Notes

- **Branch**: `flight/2-kebab-menu` created off `main` (planning artifacts carried over uncommitted).
- **Phase file**: loaded `.flightops/agent-crews/leg-execution.md` — well-formed (Crew / Interaction
  Protocol / Prompts present). Developer + Reviewer on Sonnet; Accessibility Reviewer `Enabled:false`
  per project config (a11y covered by the `kebab-menu` behavior test `[a11y]` markers + `npm run a11y`).
- **Execution model**: per-leg design + design-review; implementation deferred-commit (single flight
  review + commit after the last autonomous leg, per the agentic-workflow deferral model).
- **Leg plan**: legs 1–3 (`kebab-menu-ui`, `wire-exit`, `docs-shortcuts`) are autonomous Developer
  legs. Leg 4 (`verify-integration`) is the verification gate — apparatus prep is autonomous code,
  but the `kebab-menu` behavior test runs via `/behavior-test` (Flight Director-driven) and the Exit
  quit + a11y are partly manual; sequenced around the flight review/commit. Leg 5
  (`hat-and-alignment`) is interactive (human-driven), run after landing the autonomous work.

---

## Leg Progress

### kebab-menu-ui (leg 1)
**Status**: ready (designed) → implementing

#### Design
- Leg artifact authored; citations verified clean against current code.
- **Design review** (Developer, Sonnet): *approve with changes*. Incorporated: `#kebab-menu` MUST
  be a body-level sibling of `#container-menu` (offset-parent correctness for the dynamic `top`/`right`
  anchor); `ArrowUp` on the trigger opens to the last item (APG menu-button completeness); inline
  `move`/`focusItem` helper sketches with wrap; an AC for the kebab's `icon-btn` focus ring; and the
  reviewer's simplification to **static HTML menu items** (the two items never change → no
  rebuild-on-open). Skipped 2nd design-review cycle: all changes were direct incorporations of the
  review, no novel design.

#### Implementation
**Status**: implementing → landed

- **`src/renderer/index.html`** — added `<button id="kebab" class="icon-btn" aria-haspopup="menu"
  aria-expanded="false">⋮</button>` as the last child of `#toolbar` (immediately after
  `#toggle-privacy`); added `#kebab-menu` (`role="menu"`) as a body-level sibling of `#container-menu`
  with two static `role="menuitem"` buttons — `#kebab-settings` (`tabindex="0"`) and `#kebab-exit`
  (`tabindex="-1"`) — i.e. roving tabindex initialized in markup.
- **`src/renderer/renderer.js`** — added `els.kebab` / `els.kebabMenu` with matching JSDoc casts;
  added `kebabItems`/`focusItem`/`positionKebabMenu`/`openKebabMenu`/`closeKebabMenu` plus the
  click/keydown wiring. Trigger click calls `e.stopPropagation()` ahead of the global outside-close
  (mirrors the container-menu discipline at `renderer.js:417/420`). Full APG nav: Enter/Space/ArrowDown
  open→first, ArrowUp open→last; ArrowDown/Up wrap; Home/End jump; Escape closes + restores focus to
  trigger; click-outside closes. Settings handler is an inert no-op with the `// TODO(Flight 3+)`
  comment; Exit handler is a placeholder no-op with the `// TODO(leg 2 wire-exit)` comment (no IPC).
- **`src/renderer/styles.css`** — added `#kebab-menu` chrome (background/border/radius/shadow/padding/
  `z-index:60`, `min-width:160px`), copied from the `#container-menu` visual block minus the
  tabstrip-specific `top`/`left` (set inline via `positionKebabMenu()`); right-anchored. Items reuse
  `.cm-item`; the kebab inherits the global gold focus ring via `.icon-btn` (no new CSS).
- **Gates**: `npm run typecheck` → 0 errors; `npm run lint` → 0 problems; `npm test` → 147/147 pass.
- **Scope**: purely additive — no changes to the tab strip, `#tabs` tablist, container-menu logic, or
  window controls. No deviations from the leg guidance. Exit IPC deferred to leg 2 as specified.

---

### wire-exit (leg 2)
**Status**: ready (designed) → implementing

#### Design
- Leg artifact authored; citations verified clean.
- **Design review** (Developer, Sonnet): *approve*, no blocking issues. Confirmed the load-bearing
  claim — the existing `window-close` path does NOT quit on macOS (`main.js:536-537` darwin guard) —
  so a dedicated `app-quit` IPC is genuinely needed; `app.quit()` (graceful, all-platform) is the
  correct call over `app.exit()`/`mainWindow.close()`; the d.ts/preload mirror is typecheck-gated
  (jsconfig `checkJs:true`). No changes required.

#### Implementation
**Status**: implementing → landed

- **`src/main/main.js`** — added `ipcMain.on('app-quit', () => app.quit())` immediately after the
  `window-is-maximized` handler, with a comment noting it is the kebab-Exit path (all-platform quit,
  distinct from `window-close` whose `window-all-closed` darwin guard does not quit on macOS). `app`
  already imported.
- **`src/preload/chrome-preload.js`** — added `appQuit: () => ipcRenderer.send('app-quit')` to the
  window-controls block (after `windowClose`).
- **`src/renderer/renderer-globals.d.ts`** — added `appQuit(): void;` to the `GoldfinchBridge`
  window-controls section (after `windowClose()`), keeping the hand-mirrored surface in sync.
- **`src/renderer/renderer.js`** — replaced the `#kebab-exit` placeholder no-op body with
  `window.goldfinch.appQuit()` (after `closeKebabMenu()`); removed the `// TODO(leg 2 wire-exit)`
  comment.
- **Gates**: `npm run typecheck` → 0 errors (confirms the d.ts/preload mirror is in sync);
  `npm run lint` → 0 problems; `npm test` → 147/147 pass. `grep "app-quit"` confirms the channel name
  matches on both ends (main.js:445 / chrome-preload.js:16).
- **Scope**: `window-close` / `window-all-closed` DD6 lifecycle untouched; no other leg-1 code changed
  beyond the one-line Exit-handler swap. No deviations. Live-quit (incl. macOS) deferred to the
  verify-integration leg / mac HAT per the flight.

---

### docs-shortcuts (leg 3)
**Status**: ready (designed) → implementing

#### Design
- Leg artifact authored (docs-only); citations verified.
- **Design review** (Developer, Sonnet): *approve*. Cross-checked every documented key behavior
  against the real handlers — tab-strip nav (`renderer.js:523-547`), globals (`renderer.js:1550-1573`),
  kebab keys (`renderer.js:204-233`), window-control platform branch (`main.js:17-21`,
  `styles.css:75-76`) — all accurate; Settings correctly described as a placeholder; `update-readme.mjs`
  only regenerates the DOWNLOADS block so the table is safe to hand-edit. Fixed 3 low-severity
  citation-range clips (widened to enclose the Delete/Backspace and Ctrl+R branches).

#### Implementation
**Status**: implementing → landed

- **`README.md`** — extended the `## Keyboard shortcuts` table with four rows below the existing
  six `Ctrl+*` rows (all preserved): `←` / `→` (move between tabs when a tab is focused),
  `Home` / `End` (first / last tab), `Delete` / `Backspace` (close the focused tab), `Esc`
  (close an open menu / panel). Added two Features bullets after "Standard browser chrome":
  a **Frameless window** one-liner (custom min/max/close at the right of the tab bar on
  Windows/Linux, native traffic lights on macOS) and an **Overflow menu** bullet documenting the
  ⋮ button (right of the toolbar row) with **Settings** explicitly described as a not-yet-functional
  placeholder and **Exit** as quitting Goldfinch, plus its keyboard operation (Enter/Space/↓ to
  open, arrows to move, Esc to close). The auto-generated `DOWNLOADS` block was left untouched.
- **`CLAUDE.md`** (goldfinch's own, optional) — extended the renderer architecture bullet with a
  one-line mention of the ⋮ kebab menu (Settings placeholder + Exit) and the `app-quit` IPC →
  `app.quit()` as the only all-platform quit path (distinct from `window-close`'s macOS darwin
  guard). Fits the existing IPC-channel enumeration; no project issues recorded here.
- **No source files touched.** `git diff --name-only -- README.md CLAUDE.md` → only those two;
  the `src/**` changes in the working tree are legs 1–2 (uncommitted), untouched by this leg.
- **Gates**: `npm test` → 147/147 pass (sanity; confirms no accidental source edits).
- **Scope**: documentation-only, accurate to implemented behavior; Flight-1 debrief action item
  (tab-nav keys + window controls in the README) closed. No deviations.

---

### verify-integration (leg 4)
**Status**: ready (apparatus prep done; awaits live behavior-test run, Flight-Director-driven)

#### Apparatus prep
- **`scripts/cdp-driver.mjs`** — added `ArrowDown` (vk 40) and `ArrowUp` (vk 38) descriptors to the
  `KEYS` object, immediately after the existing `ArrowLeft` entry, matching the exact shape of the
  horizontal-arrow descriptors. The kebab menu's APG vertical nav needs these; the driver previously
  shipped only horizontal arrows. Purely additive — existing entries and formatting (incl. the
  no-trailing-comma `Backspace` last entry) preserved.
- **Checks**: `node --check scripts/cdp-driver.mjs` → no syntax errors; `npm run lint` → 0 problems;
  `npm test` → 147/147 pass.
- **Scope**: single file, additive. No behavior test run here (live GUI app required, Flight-Director
  -driven). Leg stays `ready` until the live verification run completes.

---

### Flight review + commit (deferred-commit model)
- Single Reviewer pass (Sonnet) over the full uncommitted diff (legs 1–3 + leg-4 apparatus prep):
  **[HANDOFF:confirmed]**. Reviewer ran the gates: `npm run typecheck` 0, `npm run lint` 0,
  `npm test` 147/147. Diff minimal/additive; `window-close` lifecycle intact; `app-quit` judged an
  acceptable one-way bridge addition (not guest-reachable); no path/username leaks; mission amendment
  coherent.
- Legs 1–3 → `completed` and checked off in flight.md; leg 4 → `ready` (apparatus done, live
  verification pending). **SC3/SC4/SC8 deliberately NOT yet checked** — verified in leg 4 (behavior
  test + manual Exit) against the running app. Flight stays `in-flight`. Committed on
  `flight/2-kebab-menu`; draft PR opened.
- **Two non-blocking review notes → HAT consideration (leg 5):** (1) the kebab and container menus can
  be open simultaneously (each trigger `stopPropagation`s, so opening one doesn't close the other) —
  harmless, inherited from the existing pattern; (2) `Tab` inside the open menu doesn't close it (the
  container menu doesn't either) — consistent with codebase convention. Neither blocks; revisit feel
  at HAT.
- **Remaining work needs the live GUI app**: leg 4 (behavior test `kebab-menu` + `tab-keyboard-operability`
  + `unified-tab-controls` regressions + `npm run a11y` + manual Exit-quits) and leg 5 (HAT) require
  `npm run dev:debug` on `:9222` — operator-coordinated.

---

## Decisions

_Runtime decisions not in the original plan will be recorded here._

---

## Deviations

_Departures from the planned approach will be recorded here._

---

## Anomalies

_Unexpected issues will be recorded here._

---

## Session Notes

- **Planning** — Operator amended the kebab placement from the mission's original **tab-bar**
  location to the **toolbar row, right of the Shield button**; mission Outcome + SC3 + SC9 + the
  Flight 2 breakdown line were updated to match (the "departure from address-bar-row menus" framing
  was dropped, as the new placement *is* the address-bar row). Settings resolved to an inert
  placeholder (page mechanism arrives Flight 3+); Exit resolved to a dedicated `app-quit` IPC
  (all-platform quit) with a plain quit (no confirm); optional HAT leg included.
