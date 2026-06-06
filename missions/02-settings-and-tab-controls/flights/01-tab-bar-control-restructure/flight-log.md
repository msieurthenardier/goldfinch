# Flight Log: Tab-Bar Control Restructure

**Flight**: [Tab-Bar Control Restructure](flight.md)

## Summary

In flight. Five autonomous build legs (`unified-pill-control`, `responsive-tab-sizing`,
`deferred-resize-on-close`, `frameless-window-shell`, `custom-window-controls`), then
`verify-integration` (behavior tests + a11y + regression), with an optional `hat-and-alignment`.
Code review and commit are deferred to a single pass after the last autonomous leg.

**Build phase complete (2026-06-06).** All 5 build legs implemented, single flight-level review
passed (`[HANDOFF:confirmed]` — no blocking issues), and committed on
`flight/01-tab-bar-control-restructure`. Build legs promoted `landed → completed`. **Flight remains
`in-flight`**: `verify-integration` (the two behavior tests + `tab-keyboard-operability` regression
+ `npm run a11y` + manual drag/close/minimize + the WSLg frameless **resize spike** / divert
decision) is deferred to a later live session per operator decision, as is the optional HAT leg.
The behavior-test-backed mission SCs stay unchecked until that live verification.

---

## Leg Progress

_Legs are designed and implemented one at a time; status tracked here as each lands._

### Leg 01 — unified-pill-control (landed, 2026-06-06)

**What changed (renderer-only, declarative — no `renderer.js` control-flow change):**
- `src/renderer/index.html`: wrapped `#new-tab` (`+`) and `#new-tab-menu` (`▾`) in a new
  `#newtab-pill` `<div>` and moved it to be the **first** child of `#tabstrip`, **before**
  `#tabs`. Both buttons keep their existing `id`/`class`/`title`/`aria-label`; `#new-tab-menu`
  keeps `aria-haspopup="menu"` + `aria-expanded="false"`. New DOM/Tab order: `+` → `▾` → tabs.
- `src/renderer/styles.css`: added `#newtab-pill` rules (gold `var(--accent)` fill, `border-radius:999px`,
  dark `var(--accent-fg)` glyphs, darkened hover, `border-left` divider before `▾`) and a
  contrast-safe `#newtab-pill .icon-btn:focus-visible` override (`outline: 2px solid var(--accent-fg)`,
  `outline-offset:-2px`) with an explanatory comment mirroring the `#address:focus-visible` carve-out.
  Re-anchored `#container-menu` from `right:8px` → `left:6px` (DD3) so the menu opens at the
  leading pill's left edge.
- `src/renderer/renderer.js`: **no change** (empty diff confirmed) — pill is purely structural;
  existing `els.newTab`/`els.newTabMenu`/`els.containerMenu` references resolve unchanged.

**Gate results:**
- `npm test` → 147 pass / 0 fail.
- `npm run typecheck` → 0 errors.
- `npm run lint` → 0 problems (exit 0).
- `npx prettier --check .` on changed files (`src/renderer/index.html`, `src/renderer/styles.css`)
  → clean ("All matched files use Prettier code style!").

**Deviation / anomaly:** `npx prettier --check .` (repo-wide) flags `.github/dependabot.yml`
(double- vs single-quote style). This violation **predates this branch/leg** (file unmodified by
this leg; not in this leg's Files Affected) and is renderer-unrelated. Left untouched to honor the
"do not modify files outside the leg" constraint — flagged here for the Flight Director / a separate
maintenance pass. (`npm run format` would auto-fix it but would introduce an out-of-scope change.)

**Deferred (verify-integration, requires live GUI):** `/behavior-test unified-tab-controls`
(live mouse+keyboard + focus-ring-on-gold screenshot delta), `tab-keyboard-operability` regression,
and `npm run a11y`. Not run in this autonomous leg.

### Leg 02 — responsive-tab-sizing (landed, 2026-06-06)

**What changed (CSS-only — no `renderer.js` / `index.html` change):**
- `src/renderer/styles.css` `.tab`: replaced the fixed `min-width:120px; max-width:220px` with a
  responsive flex share — `flex: 1 1 0` (grow to fill, shrink to floor), `min-width: 88px` (floor
  covering the container-tab-with-favicon ≈82px worst case), `max-width: 240px` (cap), and
  `overflow: hidden` (hard backstop so content never spills past the tab slot at the floor). All
  other `.tab` rules (`display:flex`, `gap`, `padding`, background, radius, `white-space:nowrap`,
  etc.) left intact.
- `src/renderer/styles.css` `.tab .tab-title`: added `min-width: 0` alongside the existing
  `overflow:hidden; text-overflow:ellipsis; flex:1` so the title flex item can shrink below its
  content width and the ellipsis engages as tabs reach the floor.
- `#tabs` left unchanged (`overflow-x: auto`, `flex: 1`, `gap: 4px`, `scrollbar-width: thin`) —
  scrollbar now renders only when summed floor widths exceed the strip (no more always-on bar at
  moderate tab counts). `.tab-fav` / `.tab-jar` / `.tab-close` left `flex: none` (the floor
  guarantee).

**Gate results:**
- `npm test` → 147 pass / 0 fail.
- `npm run typecheck` → 0 errors.
- `npm run lint` → 0 problems (exit 0).
- `npx prettier --check src/renderer/styles.css` → clean ("All matched files use Prettier code
  style!").

**Deferred (verify-integration, requires live GUI):** `/behavior-test responsive-tab-strip`
Steps 2–4 (few tabs grow to share with no scrollbar; many tabs shrink with favicon+close visible +
ellipsis; scroll only past the floor) and Step 8 (keyboard-close reflow); `npm run a11y`. Not run
in this autonomous leg.

**Leg 3 seam preserved:** `flex: 1 1 0` is overridable by an inline `flex: 0 0 <px>` (leg 3's
pointer-close freeze) and re-expands when the inline style is cleared — no `!important` or
hard-coded widths added that would block the freeze.

### Leg 03 — deferred-resize-on-close (landed, 2026-06-06)

**What changed (`renderer.js`-only — shared `closeTab` untouched):**
- `src/renderer/renderer.js` `els` block: added `tabstrip: /** @type {HTMLElement} */
  (document.getElementById('tabstrip'))` (the outer `#tabstrip`, distinct from the inner `#tabs`
  tablist) above the existing `tabs:` entry, same JSDoc-cast style as the surrounding entries.
- Added (after `activeTab()`, before the webview-wiring section) a module-scope `widthsFrozen`
  boolean and two helpers: `freezeTabWidths()` sets each live tab button's inline
  `style.flex = '0 0 <getBoundingClientRect().width>px'` and flips `widthsFrozen = true`;
  `releaseTabWidths()` early-returns when not frozen, else clears each tab button's inline
  `style.flex` and flips `widthsFrozen = false`. Registered a `#tabstrip` `mouseleave` listener →
  `releaseTabWidths` so leaving the whole strip re-expands tabs (moving onto the pill/gap does not
  release).
- Pointer-close branch in the tab-button click handler (`if (… .closest('.tab-close'))`): added
  `if (tabs.size > 1) freezeTabWidths();` immediately **before** `closeTab(id)` — last-tab
  pointer-close skips the freeze so the zero-tab-guard `createTab()` yields a clean element with no
  inherited inline width.
- Keyboard Delete/Backspace branch (`els.tabs` keydown): added `releaseTabWidths();` immediately
  **before** `closeTab(cur)` so keyboard close always reflows immediately (DD5) — including the
  mixed-input case (pointer-close, then Delete with the cursor still over the strip). This is a
  *release only*, never a freeze, so the "no freeze in the shared/keyboard path" seam holds.
- The shared `closeTab` function (incl. its zero-tab `createTab()` guard) is **unchanged**.

**No type casts needed beyond `els.tabstrip`:** `jsconfig.json` has `strict:false` (no
`strictNullChecks`), so the tab record's `btn` types as `HTMLElement` and
`.getBoundingClientRect()`/`.style.flex` resolve without extra casts — confirmed by `npm run
typecheck`.

**Gate results:**
- `npm test` → 147 pass / 0 fail.
- `npm run typecheck` → 0 errors.
- `npm run lint` → 0 problems (exit 0).
- `npx prettier --check src/renderer/renderer.js` → clean ("All matched files use Prettier code
  style!").

**Deferred (verify-integration, requires live GUI):** `/behavior-test responsive-tab-strip`
Steps 5–6 (pointer-close freeze → `#tabstrip` `mouseleave` re-expand) and Step 8 (keyboard-close
immediate reflow); `npm run a11y`. Not run in this autonomous leg.

### Leg 04 — frameless-window-shell (landed, 2026-06-06)

**What changed (frame removal + shared platform foundation; quit/closed paths untouched):**
- `src/main/main.js` `createWindow()`: added an `isMac = process.platform === 'darwin'` branch and a
  `/** @type {Electron.BrowserWindowConstructorOptions} */`-annotated `frameOpts` — `{ titleBarStyle:
  'hidden', trafficLightPosition: { x: 12, y: 14 } }` on mac, `{ frame: false }` on win/linux —
  spread (`...frameOpts`) into the existing `new BrowserWindow({...})` options between `icon` and
  `webPreferences`. `width`/`height`/`minWidth:900`/`minHeight:600`/`backgroundColor`/`title`/`icon`
  and the full `webPreferences` block are unchanged. The annotation is required: the ternary widens
  `titleBarStyle:'hidden'` to `string`, which isn't assignable to Electron's literal union without it.
  `will-attach-webview`, `mainWindow.on('closed')`, and `app.on('window-all-closed') → app.quit()`
  (non-darwin) are untouched.
- `src/preload/chrome-preload.js`: added `platform: process.platform` (new `// --- platform ---`
  group at the top of the `exposeInMainWorld('goldfinch', {...})` surface).
- `src/renderer/renderer-globals.d.ts`: added `platform: string;` to the `GoldfinchBridge` interface
  (mirrors the new preload field — required for the typecheck gate).
- `src/renderer/renderer.js`: after the `els` block, added
  `document.documentElement.classList.add(`platform-${window.goldfinch?.platform ?? 'unknown'}`)`
  (optional-chained so a non-preload load path never aborts init).
- `src/renderer/index.html`: added `<div id="window-controls"></div>` as the **last** child of
  `#tabstrip` (after `#tabs`) — empty reserved zone for leg 5's buttons.
- `src/renderer/styles.css`: merged `-webkit-app-region: drag` into the existing `#tabstrip` rule
  (strip background moves the window); added `#newtab-pill, .tab { -webkit-app-region: no-drag }`
  (pill + tabs stay clickable); added `#window-controls` (`flex:none`, `display:flex`,
  `align-items:stretch`, `width:138px` reserve); added `html.platform-darwin #tabstrip { padding-left:
  78px }` (left inset so the pill clears native traffic lights) and `html.platform-darwin
  #window-controls { display:none }` (mac uses native controls). The 78px inset and the mac
  `trafficLightPosition: {x:12,y:14}` are defaults flagged **needs-human-recheck on a mac**.

**Gate results (offline only — per operator "code 4–5 now, verify later"):**
- `npm test` → 147 pass / 0 fail.
- `npm run typecheck` → 0 errors.
- `npm run lint` → 0 problems (exit 0).
- `npx prettier --check` on the six changed files → clean ("All matched files use Prettier code
  style!").

**OUTSTANDING — resize spike deferred (NOT skipped):** the WSLg `frame:false` resize/snap spike was
**not** run in this autonomous leg (per the operator's "code 4–5 now, verify all later" decision). It
is deferred to the `verify-integration` session. The flight's **divert trigger remains armed**: if the
frameless window proves non-resizable / un-snappable on WSLg at verify time and isn't quickly fixable,
legs 4–5 split into Flight 1b and renderer-only legs 1–3 land alone. Also deferred to
`verify-integration`: manual drag-to-move, the `responsive-tab-strip` Step 7 maximize read path (leg
5), and `npm run a11y`. Two CSS defaults need a mac recheck (74→78px inset, traffic-light position),
and the `#tabs` scrollbar-thumb-in-drag-region edge case is flagged for the live verify.

**Note:** leg 4 ships a frameless win/linux window with **no** visible minimize/maximize/close
affordance — intentionally incomplete; **must not be run as a user-facing build between legs 4 and 5**
(leg 5 lands with it under the single flight-level commit).

### Leg 05 — custom-window-controls (landed, 2026-06-06)

**What changed (custom min/max/close controls + DD7 maximize read path; quit chain untouched):**
- `src/renderer/index.html`: replaced the empty `#window-controls` div (leg 4) with three real
  `<button>`s — `#win-min` (`aria-label="Minimize"`, glyph `—`), `#win-max`
  (`aria-label="Maximize"`, `data-state="normal"`, glyph `□`), `#win-close`
  (`aria-label="Close"`, glyph `✕`) — each `class="icon-btn win-ctrl"` (close also `win-close`).
- `src/preload/chrome-preload.js`: new `// --- window controls ---` group on the `goldfinch`
  bridge — `windowMinimize`/`windowToggleMaximize`/`windowClose` (`ipcRenderer.send`),
  `windowIsMaximized` (`ipcRenderer.invoke`), `onWindowMaximizedChange` (subscribes to
  `window-maximized-change`).
- `src/renderer/renderer-globals.d.ts`: mirrored all five methods into `GoldfinchBridge`
  (`windowIsMaximized(): Promise<boolean>`, the rest `void`) — required for the typecheck gate.
- `src/main/main.js`: added `ipcMain.on('window-minimize')` → `minimize()`,
  `ipcMain.on('window-toggle-maximize')` → `isMaximized() ? unmaximize() : maximize()`,
  `ipcMain.on('window-close')` → **`mainWindow.close()`** (DD6 — NOT `app.quit()`, preserving the
  `closed` → `window-all-closed` → `app.quit()` non-darwin chain), and
  `ipcMain.handle('window-is-maximized')` → `!!mainWindow?.isMaximized()`. In `createWindow` (after
  the `closed` handler) added `maximize`/`unmaximize` listeners forwarding
  `window-maximized-change` (true/false) to the renderer (DD7 read path).
- `src/renderer/renderer.js`: three new `els.*` button entries (`winMin`/`winMax`/`winClose`,
  `HTMLButtonElement` cast style); click wiring to the three send-bridge methods; a
  `setMaximized(isMax)` helper syncing `#win-max`'s `data-state`/`aria-label`/`title`/glyph
  (`❐`↔`□`); init via `windowIsMaximized().then(setMaximized)` + `onWindowMaximizedChange(setMaximized)`.
- `src/renderer/styles.css`: `.win-ctrl` (`-webkit-app-region: no-drag`, `width: 46px`,
  `border-radius: 0`) so the buttons are clickable inside the `#tabstrip` drag region and fill
  leg 4's 138px reserve; `.win-ctrl.win-close:hover` destructive red (`#e81123` bg / `#fff` glyph).
  Buttons inherit `.icon-btn` color/cursor/focus-ring (gold `:focus-visible` ring is visible on the
  dark strip — no DD2-style override needed).

**Gate results (offline only — live checks deferred per operator "code 4–5 now, verify later"):**
- `npm test` → 147 pass / 0 fail.
- `npm run typecheck` → 0 errors (the d.ts mirror covers all 5 new methods).
- `npm run lint` → 0 problems (exit 0).
- `npx prettier --check` on the six changed files → clean ("All matched files use Prettier code
  style!").

**Deferred (verify-integration, requires live GUI):** `responsive-tab-strip` **Step 7** (maximize
toggles the button's read path — `aria-label`/icon/`data-state`; `needs-human-recheck` if WSLg
maximize is flaky) + the flight's **manual Close** (quits win/linux via the `close()` chain) and
**manual minimize** (hides/restores) checks; `npm run a11y`. None run in this autonomous leg —
in-leg verification is code/markup presence + offline gates only.

---

## Flight Director Notes

- **2026-06-06** — Flight start (`/agentic-workflow`). Loaded `leg-execution.md` crew file
  (Developer/Reviewer, both Sonnet; Accessibility Reviewer disabled). Mission flipped
  `planning → active`; flight flipped `planning → in-flight`. Planning artifacts (mission.md,
  flight.md, flight-log.md, behavior specs `unified-tab-controls.md` + `responsive-tab-strip.md`)
  committed to `main` before branching. Working branch: `flight/01-tab-bar-control-restructure`.
- **Apparatus check** — goldfinch `.mcp.json` registers Playwright MCP attaching to `:9222`
  (correct per DD7; `chrome-devtools` MCP explicitly disqualified). Behavior-test execution
  prerequisites (live `npm run dev:debug` renderer target on `:9222`, free fixture port) are
  probed at the verify leg, not at build time.
- **Divert trigger noted** — leg 4 opens with a `frame:false` WSLg resize spike; if the frameless
  window goes non-resizable, split legs 4–5 into Flight 1b and land renderer-only legs 1–3.
- **2026-06-06 — Checkpoint after leg 3 (operator go/no-go).** Legs 1–3 (`unified-pill-control`,
  `responsive-tab-sizing`, `deferred-resize-on-close`) are implemented and uncommitted on
  `flight/01-tab-bar-control-restructure`; all offline gates green (test 147/0, typecheck 0, lint
  0, prettier clean on touched files). These three are renderer-only and mission-traced
  (SC1/SC2/SC8 + two flight-local tab-sizing behaviors). The flight now reaches legs 4–5
  (frameless window), which (a) **must open with the WSLg `frame:false` resize spike** — the
  flight's concrete divert trigger — and (b) together with `verify-integration` require the
  operator's live GUI session (resize spike observation, the two behavior tests over CDP/:9222,
  and manual drag/close/minimize checks). WSLg is available (`DISPLAY=:0`, Wayland). Paused for an
  operator decision on scope/sequencing before proceeding past leg 3.
- **Operator decision: "Code 4–5 now, verify all later."** Proceeding to implement legs 4–5
  (frameless shell + custom window controls) autonomously, with **all live verification deferred to
  one later verify-integration session**: the WSLg `frame:false` **resize spike is deferred, not
  skipped** — it will be run live at verify-integration, and the flight's divert trigger (split
  legs 4–5 into Flight 1b if the frameless window proves non-resizable/un-snappable on WSLg)
  remains armed and will be decided there. Legs 4–5 thus become autonomous build legs; the single
  flight-level review + commit happens after leg 5; `verify-integration` (live) and the optional
  HAT leg follow in a later session.

---

## Decisions

_Runtime decisions not in the original plan will be recorded here._

---

## Deviations

_Departures from the planned approach will be recorded here._

---

## Anomalies

_Unexpected issues encountered during execution will be recorded here._

---

## Session Notes

_Chronological notes from work sessions._
