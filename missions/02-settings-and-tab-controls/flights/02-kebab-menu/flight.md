# Flight: Kebab Menu

**Status**: landed
**Mission**: [Settings Area & Tab-Bar Controls](../../mission.md)

## Contributing to Criteria
- [x] **SC3** — A kebab/overflow menu is present in the **toolbar row, to the right of the Shield
  button**, exposing exactly two actions to begin with: open **Settings** and **Exit**
  (*behavior-test-backed* — `kebab-menu`). *(Placement amended at this flight's planning from the
  mission's original tab-bar placement; mission Outcome + SC3 updated accordingly.)* **Verified:
  `kebab-menu` behavior test PASS 10/10 (run 2026-06-07-09-56-42).**
- [x] **SC4** — Choosing **Exit** terminates the application (*manually verified — quitting tears
  down the test harness, so this is checked by hand, not by behavior test*). **Verified: trusted Exit
  click → app.quit() → clean termination (dev process exit 0, `:9222` dead, no procs left;
  Windows/Linux — macOS deferred to a mac HAT).**
- [x] **SC8** — The kebab button and its menu are keyboard-operable and introduce no new WCAG A/AA
  violations under `npm run a11y` (*behavior-test-backed / a11y gate*). **Verified: `kebab-menu`
  behavior test (APG keyboard) PASS; `npm run a11y` shows 0 kebab-attributable violations.**

> **Out of scope for this flight (deferred to later flights).** The **Settings** item is present,
> focusable, and selectable (which is what SC3 requires) but its click is an **inert placeholder**:
> the `goldfinch://` internal-page mechanism (Flight 3) and the settings page itself (Flight 4) do
> not exist yet, so there is nothing for Settings to open. **SC5/SC6/SC7 are not advanced here.**
> Wiring Settings to actually open the page happens in Flight 3+ once the internal-page path lands.

---

## Pre-Flight

### Objective

Add a kebab (⋮) overflow menu to Goldfinch's **toolbar row**, immediately to the right of the
existing Shield button (`#toggle-privacy`). The menu follows the WAI-ARIA APG **menu-button**
pattern and exposes exactly two items — **Settings** and **Exit**. **Exit** terminates the
application on every platform via a new dedicated `app-quit` IPC; **Settings** is present and fully
operable as a menu item but its action is an inert placeholder until the internal-page mechanism
arrives in a later flight. The whole surface is keyboard-operable and adds no new accessibility
violations. No tab-strip, frameless-chrome, or settings-page work is in scope.

### Open Questions
- [x] Where does the kebab live? → **Toolbar row, right of the Shield button** (`#toggle-privacy`),
  as the last child of `#toolbar`. Operator decision at planning; mission amended. See DD1.
- [x] What does **Settings** do in this flight? → **Inert placeholder** — item present/focusable/
  selectable, click handler is a documented no-op wired for real in Flight 3+. See DD2.
- [x] How does **Exit** terminate the app on all platforms? → **Dedicated `app-quit` IPC** calling
  `app.quit()` directly (the existing `window-close` path does not quit on macOS). See DD3.
- [x] Does **Exit** confirm when tabs are open? → **No, plain quit** (mission open question resolved
  here). See DD4.
- [x] Does the kebab need a contrast-safe focus-ring override like the gold pill (DD2 of Flight 1)?
  → **No.** The kebab sits on the **dark toolbar** background, not on the gold pill, so the global
  `outline: 2px solid var(--accent)` ring (`styles.css:256-267`) is gold-on-dark and visible
  (give the kebab `class="icon-btn"` to inherit it with no new CSS). The
  behavior test still captures a focus-delta screenshot to confirm empirically (Flight-1 lesson:
  treat ring visibility as verify-not-assume). See DD5.
- [x] What apparatus drives/observes the behavior test, and is every assertion observable through an
  existing surface? → see DD6 (premise-audited on both act and observe axes).
- [ ] Exact glyph/markup for the kebab button (literal `⋮` text vs a CSS-drawn three-dot icon) —
  tune at leg design / HAT. The toolbar's other controls mix text glyphs (`◀ ▶ ⟳`) and CSS-drawn
  icons (window controls); either is acceptable. Acceptable variation, not a blocker.

### Design Decisions

**DD1 — Kebab lives in the toolbar row, as the last child of `#toolbar`, right of the Shield
button**: Append a `<button id="kebab" …>` after `#toggle-privacy` (`index.html:63-65`); add a
sibling popup element `#kebab-menu` (mirroring how `#container-menu` is a body/`#tabstrip`-adjacent
sibling of its trigger). Final toolbar order:

```
#toolbar:
[ brand ][ ◀ back ][ ▶ fwd ][ ⟳ reload ][      #address-wrap      ][ Media ][ Shield ][ ⋮ kebab ]
                                                                                         ^ new, last child
```

- Rationale: operator's chosen placement; the toolbar already groups the page-level affordances
  (Media, Shield), so the overflow menu reads naturally at the end of that row.
- Trade-off: departs from the mission's *original* tab-bar placement and its "departure from
  address-bar-row menus" framing — both were amended in the mission at this flight's planning so the
  spec stays honest.
- **Position is pinned explicitly** (child order + diagram) — the Flight-1 debrief's sharpest lesson
  was that a one-line spatial ambiguity ("adjacent") cascaded into layout rework; this flight pins
  the kebab as the final `#toolbar` child so leg design and the behavior test agree on "where."

**DD2 — Settings is an inert placeholder this flight**: The Settings menu item renders, is
focusable, and is selectable (satisfying SC3's "exposes the action"), but its activation handler is
a documented no-op stub (a `// TODO(Flight 3+): open goldfinch://settings once the internal-page
path exists` comment, not a dangling/broken call). Selecting Settings closes the menu and does
nothing else.
- Rationale: the page and its `goldfinch://` scheme are built in Flights 3–5; there is nothing for
  Settings to open yet. A present-but-inert item is the cleanest seam and keeps SC3 honest without
  pre-building later flights' work.
- Trade-off: the behavior test can assert the item is present/focusable/selectable and that
  selecting it is harmless (menu closes, tab count unchanged) — it cannot assert "settings opens"
  (that becomes SC5's `tab-scheme-guard` extension in a later flight).

**DD3 — Exit terminates via a dedicated `app-quit` IPC (all platforms)**: Add
`ipcMain.on('app-quit', () => app.quit())` in `main.js`, expose `appQuit: () => ipcRenderer.send('app-quit')`
on the `window.goldfinch` bridge (`chrome-preload.js`), mirror it in `renderer-globals.d.ts`, and
wire the kebab's Exit item to `window.goldfinch.appQuit()`.
- Rationale: SC4 requires Exit to *terminate the application*. The existing `window-close` IPC
  (`main.js:440`) routes through `close()` → `window-all-closed` → `app.quit()`, but that guard
  quits **only on non-darwin** (`main.js:537`), so reusing it would leave macOS running after Exit.
  A dedicated `app-quit` calling `app.quit()` directly is platform-correct and semantically distinct
  from the window **close** button (which intentionally keeps DD6 of Flight 1's window lifecycle).
- Trade-off: a third window/app-lifecycle IPC alongside `window-close`; documented so the two are
  not conflated (close button = close the window; Exit = quit the app).
- **Verification split**: macOS quit-on-Exit cannot be verified on the Linux/WSL dev platform →
  flagged for the eventual mac HAT (consistent with the mission's mac deferrals). On Windows/Linux,
  Exit quitting is manually verified (it tears down the harness — not behavior-testable, exactly
  like Flight 1's Close).

**DD4 — Exit is a plain quit, no confirm dialog**: Resolves the mission open question. No
`dialog.showMessageBox` confirm when tabs are open.
- Rationale: matches "Exit terminates the application" literally and keeps the flight small; the
  confirm was an explicit nice-to-have, not a requirement.
- Trade-off: an accidental Exit with many tabs open quits immediately — acceptable per operator.

**DD5 — Reuse the container menu's open/close/styling mechanics and the global focus ring, but
build proper APG `role="menu"` semantics + arrow-nav fresh (a deliberate a11y step up from the
container menu)**: Borrow the working container menu's visual styling (`.cm-*` item classes) and its
open/close/focus mechanics (`#container-menu`, `renderer.js:98-151`) — `aria-haspopup="menu"`/
`aria-expanded` on the trigger, open-on-click, focus-first-item-on-open, Escape-closes-and-restores-
focus-to-trigger, click-outside-to-close. But the container menu's items are **plain `<button
class="cm-item">` with no `role="menuitem"`, no `role="menu"` on the popup, no roving tabindex, and
no arrow-key navigation** (`renderer.js:100-125`; outside-close `renderer.js:420`). The mission
constraint requires the kebab to follow the **APG menu-button pattern**, so the kebab popup MUST
carry `role="menu"`, its two items `role="menuitem"`, with **roving tabindex** and fresh keyboard
nav: open via `Enter`/`Space`/`ArrowDown`; `ArrowDown`/`ArrowUp` cycle between items; `Home`/`End`
jump; `Enter`/`Space` activate; `Escape` close + restore focus to the trigger.
- Rationale: reuse the audited open/close/focus-restore mechanics; layer on the proper APG roles +
  roving-focus the constraint demands. The kebab sits on the **dark toolbar**, so the global gold
  focus ring (`outline: 2px solid var(--accent)`, `styles.css:256-267`, which targets
  `.icon-btn`/`.text-btn`/`.cm-item:focus-visible`) is gold-on-dark and visible — **no contrast
  override needed** (unlike Flight 1's gold-on-gold pill). To inherit that ring with zero new CSS,
  give the kebab button `class="icon-btn"`.
- **Outside-close trap (Architect)**: the container menu only survives its own opening click because
  the trigger calls `e.stopPropagation()` (`renderer.js:417`) *ahead* of the global
  `document.addEventListener('click', () => closeContainerMenu())` (`renderer.js:420`). The kebab
  needs the identical discipline on its trigger, and its outside-close handler must not race the
  container menu's — pin this in leg 1.
- **A11y-divergence note (Architect)**: the kebab popup is intentionally a *fuller* APG menu
  (`role="menu"`/`menuitem` + roving tabindex) than the container menu's plain-button structure.
  This is a deliberate step up, not an inconsistency — a future "extract a shared menu helper" effort
  should know the two are not identical by design (the helper would lift the kebab's level, not the
  container menu's).
- Trade-off: the kebab menu and container menu remain parallel-but-separate implementations rather
  than a single shared helper — extracting one would touch the passing container-menu surface and is
  out of scope for a two-item menu.

**DD6 — Verification apparatus, premise-audited on BOTH axes (act + observe)**:
- *Act (can the apparatus drive it like a real actor?)* — the `kebab-menu` behavior test
  **attaches to the already-running `:9222` renderer target** via the now-committed
  `scripts/cdp-driver.mjs` (trusted `Input.dispatch{Mouse,Key}Event`; the Flight-1 hand-rolled
  driver, promoted per that debrief's action item), or the Playwright MCP with `--cdp-endpoint`.
  **Never the `chrome-devtools` MCP** (launches its own browser → false pass; the standing
  Goldfinch trap). Drivable: kebab click; keyboard open (`Enter`/`Space`/`ArrowDown` on the
  focused trigger); arrow navigation between items; `Escape`; click-outside; selecting Settings.
  **⚠ Apparatus gap (Architect):** the committed `scripts/cdp-driver.mjs` KEYS table
  (`cdp-driver.mjs:40-50`) defines only horizontal `ArrowRight`/`ArrowLeft` (built for the tablist)
  — it has **no `ArrowDown`/`ArrowUp`**, which the kebab's vertical APG nav needs. So "arrow nav is
  drivable" is only true *after* extending the driver: add `ArrowDown` (vk 40) and `ArrowUp` (vk 38)
  to KEYS. This is a tiny tooling change folded into leg 4's apparatus prep (and asserted by the
  prerequisite probe), not deferred — exactly the "assert operational availability, not mere config"
  lesson this flight cites.
  **NOT drivable → manual**: **Exit** (calls `app.quit()` → tears down the harness — verified by
  hand, exactly like Flight 1's Close / the mission's SC4 framing).
- *Observe (can every assertion be read through an existing surface?)* — all assertions read through
  existing DOM/a11y surfaces, **no new read path needs building** (contrast with Flight 1's
  maximize-state seam): the kebab button's presence + accessible name + `aria-haspopup="menu"` +
  `aria-expanded` toggle; its toolbar position via `getBoundingClientRect` (right of `#toggle-privacy`,
  last in `#toolbar`); the popup's open state (`#kebab-menu` not `.hidden`); the **exactly two**
  items and their accessible names ("Settings", "Exit") via the a11y tree / DOM; `document.activeElement`
  for open-focuses-first-item, arrow roving, and Escape-restores-to-trigger; tab count unchanged
  after selecting the inert Settings item; and a focused-vs-unfocused **screenshot** for the
  focus-ring delta (rendered pixels the a11y tree can't attest).
- Rationale: this is the both-axes premise audit the flight skill requires. Unlike Flight 1, the
  observe axis is satisfied entirely by existing surfaces — the one thing the test *cannot* observe
  (Exit terminating the app) is correctly pushed to manual, not retrofitted with a seam.
- Trade-off: Exit is the only manual check; everything else is witnessed.

### Prerequisites
- [ ] App runs via `npm run dev:debug` (CDP on `:9222`, `--remote-allow-origins=*`, `--no-sandbox`);
  `:9222` **answers** and a **renderer** target (the Goldfinch `index.html` window, not a
  `<webview>` guest) is present. *(Behavior-test execution prerequisite — apparatus-audited; assert
  operational availability, not mere config — Flight-1 lesson. Probe before the flight lands.)*
- [ ] Behavior-test apparatus operational **and able to send the keys this test needs**:
  `scripts/cdp-driver.mjs` reaches `:9222` (e.g. `node scripts/cdp-driver.mjs eval '1+1'` returns
  `2`) **and its KEYS table includes `ArrowDown`/`ArrowUp`** (added in leg 4 — see DD6; the
  committed driver ships only horizontal arrows), **or** the Playwright MCP is *connected* with
  `--cdp-endpoint http://127.0.0.1:9222` (it sends arbitrary keys natively). **The `chrome-devtools`
  MCP does NOT qualify.**
- [ ] `npm run a11y` (axe-core over CDP) operational against the running app.
- [ ] GUI/desktop runtime available (the menu and Exit are platform-visible). Dev/verify platform is
  Linux/WSL; macOS Exit-quit behavior is deferred to a mac HAT (open question / mission deferral).

### Pre-Flight Checklist
- [ ] All open questions resolved (or explicitly deferred with rationale)
- [ ] Design decisions documented
- [ ] Prerequisites verified (esp. `:9222` renderer target + apparatus reachable)
- [ ] Validation approach defined (`kebab-menu` behavior test authored + apparatus probed)
- [ ] Legs defined

---

## In-Flight

### Technical Approach

Two build legs (renderer-only, then the cross-process Exit wiring), a docs leg, a verify leg, and an
optional HAT leg. The menu UI is renderer-only (HTML/CSS/JS) and reuses the container-menu's audited
open/close/focus-restore behavior plus a fresh APG arrow-nav. The Exit wiring adds one `app-quit`
IPC across the three files that already carry the window-control IPC (`main.js`, `chrome-preload.js`,
`renderer-globals.d.ts`). Nothing touches the tab strip, the frameless chrome, or the container menu.

- **Kebab menu UI** (leg 1): add `#kebab` button (`class="icon-btn"` so it inherits the global focus
  ring with no new CSS — DD5) as the last `#toolbar` child (right of `#toggle-privacy`) with
  `aria-haspopup="menu"`/`aria-expanded`; add a `#kebab-menu` popup carrying **`role="menu"`** with
  two **`role="menuitem"`** items (Settings, Exit) + roving tabindex, reusing `.cm-*` styling; wire
  open/close (click + click-outside — with `e.stopPropagation()` on the trigger so the global
  outside-close handler doesn't immediately re-close it, mirroring `renderer.js:417/420`, and not
  racing the container menu's handler — DD5), Escape + focus-restore, and **full APG keyboard nav**
  (open via Enter/Space/ArrowDown; ArrowDown/Up cycle; Home/End; Enter/Space to activate). Settings
  handler is the inert no-op stub (DD2). Exit handler is a placeholder no-op *for this leg* (wired in
  leg 2). New `els.*` entries get the same `/** @type {HTMLButtonElement} */`/`HTMLElement` JSDoc
  casts as the existing block (`renderer.js:7-52`) or `npm run typecheck` fails (Flight-1 lesson).
  (SC3, SC8)
- **Wire Exit → quit** (leg 2): add `ipcMain.on('app-quit', () => app.quit())` (`main.js`), expose
  `appQuit` on the `window.goldfinch` bridge (`chrome-preload.js`), **mirror it in
  `renderer-globals.d.ts`** (the hand-mirrored d.ts is typecheck-gated and silently drifts otherwise
  — Flight-1 lesson), and point the kebab Exit item at `window.goldfinch.appQuit()`. (SC4)
- **Docs** (leg 3): document the kebab menu and its keys; bring the README keyboard-shortcuts table
  current — it still omits the tab-nav keys (Arrow/Home/End/Delete) and the window controls from
  Flight 1, and now the kebab adds more (open/close/arrow keys). Shared docs surface → bundled here
  per the carry-forward-debt guidance (the README table is the same surface the kebab must document).
- **Verify** (leg 4): **apparatus prep first** — extend `scripts/cdp-driver.mjs` KEYS with
  `ArrowDown` (vk 40) / `ArrowUp` (vk 38) if absent (DD6), then probe the prerequisite. Run the
  `kebab-menu` behavior test; regression `tab-keyboard-operability` and `unified-tab-controls`
  (neither should change — kebab is outside the tablist and the container menu is untouched);
  `npm run a11y` — and since the suite reports the **2 known pre-existing `scrollable-region-focusable`
  violations** (mission Known Issues), assert "no *new* violations from the kebab" against that known
  baseline, not against zero. Manual Exit-quits check (win/linux); offline gates
  (`npm test`/`typecheck`/`lint`).
- **HAT + alignment** (leg 5, optional): guided session to tune the kebab glyph, menu placement/feel,
  and keyboard flow live until the operator is satisfied.

### Checkpoints
- [ ] Kebab button renders as the last toolbar control, right of the Shield button; visible focus
  ring on the dark toolbar.
- [ ] Click (and keyboard open) toggles the menu; `aria-expanded` tracks state; exactly two items
  (Settings, Exit).
- [ ] APG keyboard nav works: open focuses first item; ArrowDown/Up cycle; Home/End jump; Escape
  closes and restores focus to the kebab trigger; click-outside closes.
- [ ] Selecting **Settings** closes the menu and does nothing else (inert placeholder; tab count
  unchanged).
- [ ] Selecting **Exit** quits the app (manual, win/linux).
- [ ] `kebab-menu` behavior test passes; `tab-keyboard-operability` + `unified-tab-controls`
  regressions still pass; `npm run a11y` clean; offline gates green.

### Adaptation Criteria

**Divert if**:
- The APG arrow-nav cannot be added cleanly without disturbing the existing container-menu behavior
  or the toolbar's focus order → reassess (this should be self-contained; the kebab menu is a new,
  separate element).

**Acceptable variations**:
- Kebab glyph/markup (literal `⋮` vs CSS-drawn dots) — tune at leg design / HAT (open question).
- Whether the menu popup anchors as a `#tabstrip`/body sibling or inside the toolbar — leg-design
  detail, as long as it visually belongs to the trigger and isn't clipped.
- Exact `.cm-*`-vs-new `.km-*` class naming for the menu items — cosmetic.

### Legs

> **Note:** Tentative; legs are created one at a time as the flight progresses.

- [x] `kebab-menu-ui` - Add the ⋮ button (`class="icon-btn"`, last `#toolbar` child, right of
  Shield) + `role="menu"` popup with two `role="menuitem"` items (Settings/Exit) + roving tabindex;
  reuse container-menu open/close/focus-restore styling; `e.stopPropagation()` on the trigger; build
  full APG keyboard nav; Settings = inert no-op stub; JSDoc-cast new `els.*`. (SC3, SC8) *(code done + reviewed; SC3/SC8 verified in leg 4)*
- [x] `wire-exit` - Add `app-quit` IPC (`main.js`) + `appQuit` bridge (`chrome-preload.js`) + d.ts
  mirror; wire the Exit item to `window.goldfinch.appQuit()`. (SC4) *(code done + reviewed; SC4 verified manually in leg 4)*
- [x] `docs-shortcuts` - Document the kebab + bring the README keyboard-shortcuts table current
  (kebab keys + carry-forward tab-nav + window-control keys from Flight 1).
- [x] `verify-integration` - Apparatus prep done; `kebab-menu` behavior test PASS 10/10; regressions
  (`tab-keyboard-operability` + `unified-tab-controls` cores) intact; `npm run a11y` 0 kebab-attributable;
  manual Exit-quits confirmed; offline gates green.
- [x] `hat-and-alignment` *(optional)* - HAT: feel approved; fixed the 2 reviewer notes (menu mutual
  exclusion + Tab-closes-menu) and re-verified live.

---

## Post-Flight

### Completion Checklist
- [x] All legs completed
- [ ] Code merged *(draft PR #23 → marked ready for review; merge is the operator's call)*
- [x] Tests passing — `kebab-menu` behavior test 10/10 + `tab-keyboard-operability` +
  `unified-tab-controls` regression cores intact + `npm run a11y` (0 kebab-attributable) + offline gates
  (`npm test` 147/147 / typecheck 0 / lint 0).
- [x] Documentation updated — README keyboard-shortcuts table current (kebab + tab-nav + window
  controls); CLAUDE.md renderer/IPC note added.

### Verification

How to confirm the flight achieved its objective:

- **Behavior test `kebab-menu`** (SC3, SC8) — kebab button present as the last toolbar control,
  right of the Shield button (`aria-haspopup="menu"`, `aria-expanded` toggles); opens by mouse and
  keyboard; exactly two items (Settings, Exit) with correct accessible names; full APG keyboard nav
  (open focuses first item; ArrowDown/Up cycle; Home/End; Escape closes + restores focus to trigger;
  click-outside closes); selecting Settings is inert (menu closes, tab count unchanged); visible
  focus-ring delta on the dark toolbar.
- **Regression: `tab-keyboard-operability`** and **`unified-tab-controls`** must still pass — the
  kebab is a new toolbar element outside the `tablist`, and the container menu is untouched.
- **`npm run a11y`** — no new WCAG A/AA violations from the kebab button or its menu.
- **Manual** (apparatus can't drive these) — **Exit** quits the app (win/linux; macOS deferred to a
  mac HAT). Tune feel via the optional HAT leg.
