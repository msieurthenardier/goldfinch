# Flight: Tab-Bar Control Restructure

**Status**: in-flight
**Mission**: [Settings Area & Tab-Bar Controls](../../mission.md)

## Contributing to Criteria
- [ ] **SC1** — New Tab and container/jar picker presented as a single unified
  pill-shaped golden control, left-aligned/adjacent to the open tabs.
- [ ] **SC2** — Opening a plain new tab and a new tab in a specific container both still
  operable from the unified control, by mouse and keyboard, preserving prior behavior
  (*behavior-test-backed*).
- [ ] **SC8** — New tab-bar controls (and the new window chrome) are keyboard-operable and
  introduce no new WCAG A/AA violations under `npm run a11y` (*behavior-test / a11y gate*).
- [ ] **SC9** — The application window is **frameless**: custom minimize/maximize-restore/close
  controls in the tab bar's reserved right-side zone (Windows/Linux), native traffic lights
  retained on macOS; window stays movable (drag region) and resizable. (*Maximize state
  behavior-test-backed via an observable read path; drag + close/quit manually verified.*)

> **Flight-local scope (no mission SC — by decision).** Two behaviors the operator added during
> planning are first-class flight objectives but are **not** traced to a mission success criterion
> (operator chose "keep flight-local" for these): (a) **responsive tab sizing** — tabs shrink/grow
> to fit instead of the current horizontal scrollbar; (b) **deferred resize-on-close** — remaining
> tabs don't reflow until the pointer leaves the strip, so serial close stays under the cursor.
> They are verified here, but a future reader should know they advance no mission SC. *(The third
> pulled-in requirement — the frameless window + custom controls + reserved/draggable zone — was
> promoted to mission **SC9**.)*

---

## Pre-Flight

### Objective

Restructure the tab strip from its current "tabs first, `+`/`▾` trailing, scrollbar on
overflow, OS window frame" layout into: a single **golden pill** (`( + | ▾ )`) leading the
strip; **responsive tabs** that shrink/grow to fit (with a usable floor and scroll only as a
last resort) and that **defer reflow on close** until the pointer leaves the strip; and a
**frameless window** whose tab strip reserves a fixed right-side zone for **custom window
controls** and a **drag region**. The `+`/`▾` actions, the container menu, and the existing
ARIA `tablist`/roving-tabindex keyboard contract are all preserved; the only new color is the
existing brand accent (`--accent`/`--accent-fg`).

### Open Questions
- [x] Is the pill one composite control or two grouped buttons? → **Two real `<button>`s in a
  styled wrapper** — see DD1.
- [x] How do we handle frameless across platforms? → **Native traffic lights on mac
  (`titleBarStyle:'hidden'` + `trafficLightPosition`); custom controls on Windows/Linux
  (`frame:false`)** — see DD6.
- [x] What apparatus drives/observes the behavior tests, and is every assertion observable
  through an existing surface? → see DD7 (premise-audited on both act and observe axes).
- [x] Do the responsive/reserved-zone behaviors get mission SCs? → **No, flight-local** (operator
  decision; see scope note above).
- [ ] Exact tab **min-width floor** (px) and the count at which horizontal scroll engages —
  tune at leg design / HAT against real rendering.
- [ ] Exact macOS `trafficLightPosition` inset — dev platform is Linux/WSL, so mac inset
  coordinates are confirmed on a mac later; flagged `needs-human-recheck` for the mac build.
- [ ] Maximize-state **read-path shape** the behavior test consumes (button `aria-label`
  toggling `Maximize`↔`Restore` vs a `data-state` attribute) — confirm at leg design (DD7).
- [ ] **WSLg maximize reliability** — does clicking the custom maximize button (`win.maximize()`)
  reliably fire `maximize` and actually maximize on WSLg? `responsive-tab-strip` Step 7 + the
  maximize read path depend on it; if flaky, flag Step 7 `needs-human-recheck` with a manual
  fallback. Probe in leg 5. *(Architect.)*
- [ ] **Frameless resizability on WSLg** — with `frame:false`, are resize grips / snapping still
  functional, or does the operator get a non-resizable window? Spike at the start of leg 4 before
  leg 5 builds on it — this is the concrete divert trigger. *(Architect.)*

### Design Decisions

**DD1 — Pill is two real buttons in a styled wrapper, not a composite control**: Keep
`#new-tab` (`+`) and `#new-tab-menu` (`▾`) as distinct `<button>`s, wrapped in a new pill
container, with their existing IDs, click handlers (`renderer.js:387-392`), `aria-label`s, and
the `▾` menu-button semantics (`aria-haspopup="menu"` / `aria-expanded`) intact.
- Rationale: the change becomes almost entirely declarative (HTML reorder + CSS), preserving
  the audited a11y surface and the `els.newTab`/`els.newTabMenu`/`els.containerMenu` wiring; no
  re-implementation of the container-menu open/close/Escape/focus logic.
- Trade-off: marginally more markup than a single button; the "single control" is a visual
  grouping (golden background + internal divider), not a single focus stop.
- **Focus-order note (Architect)**: today `#new-tab`/`#new-tab-menu` follow `#tabs`
  (`index.html:15-26`); moving them *ahead* of `#tabs` means `Tab` traversal reaches the pill
  buttons **before** the roving-tabindex tab. `tab-keyboard-operability` Step 3 ("Tab until a tab
  is focused") tolerates the extra stops, so no regression is expected — but leg 1 must state the
  new DOM/focus order explicitly so the regression run isn't surprised and so the pill sits
  sensibly relative to leg 4's reserved window-control zone.

**DD2 — Focus ring must contrast against the golden pill, not reuse the accent ring**: The
global keyboard focus ring is `outline: 2px solid var(--accent)` (gold — `styles.css:110-120`).
Applied to a button **on a golden background** it is gold-on-gold and effectively invisible.
Override the pill buttons' `:focus-visible` with a ring that meets ≥3:1 against the gold fill
(e.g. the dark `--accent-fg`, or a layered dark/light ring).
- Rationale: WCAG 1.4.11 non-text contrast + the `unified-tab-controls` behavior test asserts a
  visible focused-vs-unfocused **delta**; a gold ring on gold fails both.
- Trade-off: one more focus-style rule with an explicit comment (**mirror the existing
  `#address:focus-visible` specificity-exception comment pattern** at `styles.css:121-127` — the
  codebase already documents one id-specificity carve-out; maintainers will expect the same).
- **Premise status (Architect)**: treat "gold ring on gold is invisible" as **verify-at-HAT, not
  known-true**. The global rule uses `outline-offset: 2px` (`styles.css:119`), so the ring sits
  2px *outside* the button — whether that lands on the gold pill or the dark `#tabstrip` depends
  on final pill padding. The instinct is sound and `unified-tab-controls` Step 5 guards it
  empirically; a sufficiently inset pill might keep the existing ring visible after all.

**DD3 — Container menu re-anchors to its (now leading) trigger**: `#container-menu` is a `<body>`
child positioned against the viewport (no positioned ancestor) at `top:36px; right:8px`
(`styles.css:834-845`) for a trailing `▾`. With `▾` moved to the leading pill, the re-anchor is
just swapping `right:8px` → a `left` near the pill (~`left:6px`, matching `#tabstrip` padding at
`styles.css:44`) so it doesn't float to the far right.
- Rationale: the popup must visually belong to its trigger.
- Trade-off: a positioning change; the open/close/Escape/focus behavior is otherwise untouched.

**DD4 — Responsive sizing via flex shrink/grow with a floor; scroll only past the floor**:
Replace `#tabs { overflow-x: auto }` + `.tab { min-width:120px; max-width:220px }`
(`styles.css:47-66`) with tabs that flex to share available width down to a usable **floor**
(favicon + close button stay visible, title ellipsizes); horizontal scroll returns only when
even the floor can't fit.
- Rationale: matches the operator ask and modern-browser behavior; no tab becomes unusable.
- Trade-off: the floor value and the scroll-onset count need empirical tuning (open question).

**DD5 — Deferred resize-on-close: freeze on pointer-close, release on `mouseleave`**: When a
tab is closed **by pointer while the cursor is over the strip**, freeze each remaining tab's
measured pixel width (so siblings slide left under the cursor with no resize) until the pointer
leaves `#tabstrip`, then clear the freeze and let flex re-expand. **Keyboard close (Delete/
Backspace) reflows immediately** — there is no cursor position to preserve.
- Rationale: lets the operator close a run of tabs without chasing the close button; the
  keyboard path keeps the existing `tab-keyboard-operability` behavior (immediate, no stale gap).
- Trade-off: a small amount of transient state (frozen widths + a `mouseleave` listener); must
  not strand focus or break the roving-tabindex contract.
- **Implementation seam (Architect)**: the clean pointer-vs-keyboard split DD5 relies on already
  exists in the code — pointer close runs through the click handler (`renderer.js:188-194`),
  keyboard close through the `els.tabs` keydown (`renderer.js:415-419`). **Apply the freeze in the
  click path, never inside the shared `closeTab`** (`renderer.js:203-215`), so keyboard close
  stays immediate. **Zero-tab guard interaction**: `closeTab` injects a fresh tab via `createTab()`
  when the last tab closes (`renderer.js:213`); leg 3 must key freeze state to *live* tabs and
  ensure a `createTab` during a frozen run does not inherit a stale inline width.

**DD6 — Frameless: native traffic lights on mac, custom controls on Windows/Linux**: macOS uses
`titleBarStyle:'hidden'` + `trafficLightPosition` (native 🔴🟡🟢 inset into the reserved zone);
Windows/Linux use `frame:false` with our own minimize / maximize-restore / close buttons.
Branch on `process.platform` in `main.js` (`new BrowserWindow`, `main.js:17`).
- Rationale: most native-feeling per OS; avoids replacing mac's familiar traffic lights.
- Trade-off: two platform code paths; the mac `trafficLightPosition` inset needs tuning on a mac
  (dev is Linux/WSL → deferred verification, open question).
- **Quit-path consistency (Architect)**: the custom close button should call `win.close()` (which
  fires `closed` → `window-all-closed` → `app.quit()` on non-darwin, `main.js:514-516`), **not**
  `app.quit()` directly — so the frameless close path matches the mac (traffic-light) path and the
  future kebab-Exit path (mission SC4). Pin this in leg 5.
- **Frameless-resize risk (Architect)**: with `frame:false` on Linux/WSLg, resize grips / window
  snapping vary by compositor; `minWidth:900`/`minHeight:600` (`main.js:20-21`) are preserved but
  frameless resize-edge behavior is the chief unknown. Leg 4 begins with a quick spike to confirm
  the window is still resizable before leg 5 builds on it (this is the concrete divert trigger —
  see Adaptation Criteria).

**DD7 — Verification apparatus, premise-audited on BOTH axes (act + observe)**:
- *Act (can the apparatus drive it like a real actor?)* — the behavior tests **attach to the
  already-running `:9222` renderer target** (Playwright MCP `--cdp-endpoint` per `.mcp.json`, or
  raw CDP-over-WebSocket), delivering **trusted** `Input.dispatch{Key,Mouse}Event` — never the
  `chrome-devtools` MCP (it launches its own browser → false pass; the standing Goldfinch trap).
  Drivable: pill `+`/`▾` clicks and keyboard activation; opening many tabs; pointer hover +
  close + moving the pointer out of the strip (`mouseleave`); clicking the maximize button.
  **NOT drivable → manual**: OS window **drag** (`-webkit-app-region: drag` is handled by the OS
  compositor, not DOM events, so CDP mouse-drag won't move the window) and **Close** (tears down
  the harness — verified by hand, like the mission's SC4 Exit).
- *Observe (can every assertion be read through an existing surface?)* — tab widths/positions via
  `getBoundingClientRect`/computed style + screenshots; the container's jar **dot** (`.tab-jar`)
  in the DOM proves "opened in a container"; the **focus-ring delta** via a focused-vs-unfocused
  screenshot (the a11y tree can't attest rendered pixels). **Window maximize state has a read
  path that must be built deliberately**: the maximize/restore button's accessible name + icon,
  kept in sync by `main`'s `maximize`/`unmaximize` window events forwarded over IPC — the
  `custom-window-controls` leg MUST expose this DOM read path or the maximize assertion has
  nothing to consume. **Minimize**: the *rendered* effect (a backgrounded renderer) is not
  CDP-screenshot-observable → the **visual** check stays manual; but minimize state can ride the
  *same* IPC seam as maximize (forward `minimize`/`restore` to a DOM read path), nearly free if
  the maximize read path is built anyway — so the test can at least assert the button/IPC fired.
- Rationale: this is the both-axes premise audit the flight skill requires — the act path was
  obvious; the *maximize observability* read path is the one that would otherwise surface as a
  mid-flight scramble for "how do we read window state from the test."
- Trade-off: drag, Close, and minimize are manual checks; everything else is witnessed.

### Prerequisites
- [ ] App runs via `npm run dev:debug` (exposes CDP `--remote-debugging-port=9222
  --remote-allow-origins=* --no-sandbox`); `:9222` answers and a **renderer** target (the
  Goldfinch `index.html` window, not a `<webview>` guest) is present. *(Behavior-test execution
  prerequisite — apparatus-audited; probe before the flight lands.)*
- [ ] Behavior-test apparatus available: Playwright MCP registered in `.mcp.json` with
  `--cdp-endpoint http://127.0.0.1:9222` (attaches), or a raw CDP-over-Node-WebSocket client.
  **The `chrome-devtools` MCP does NOT qualify.**
- [ ] A local HTTP **fixture** for distinct-URL tabs (responsive + deferred-resize tests need
  several tabs with distinct, non-normalizing addresses). **Probe that the chosen fixture port
  is free** before the run — `:8000`/`:8080`/`:8090` collisions bit prior Goldfinch runs.
- [ ] `npm run a11y` (axe-core over CDP) operational against the running app.
- [ ] GUI/desktop runtime available (frameless + drag + window controls are platform-visible);
  dev/verify platform is Linux/WSL — mac traffic-light inset deferred to a mac (open question).

### Pre-Flight Checklist
- [ ] All open questions resolved (or explicitly deferred with rationale)
- [ ] Design decisions documented
- [ ] Prerequisites verified (esp. `:9222` renderer target + fixture port free)
- [ ] Validation approach defined (behavior tests authored + apparatus probed)
- [ ] Legs defined

---

## In-Flight

### Technical Approach

Five build legs plus a verify leg and an optional HAT leg. The tab-strip legs (1–3) are
renderer-only (HTML/CSS/JS) and preserve the existing IDs, handlers, and the `tablist`/
roving-tabindex contract. The window-chrome legs (4–5) touch `main.js` (frame config, IPC),
the chrome preload bridge (window-control IPC + maximize-state events), and the renderer
(reserved zone, control buttons, drag/no-drag regions).

- **Pill** (leg 1): move `#new-tab` + `#new-tab-menu` ahead of `#tabs` into a pill wrapper;
  golden fill (`--accent`) + dark glyphs (`--accent-fg`) + internal divider; contrast-safe
  focus ring (DD2); re-anchor `#container-menu` (DD3). IDs/handlers/aria unchanged (DD1).
- **Responsive sizing** (leg 2): flex shrink/grow with a floor + ellipsized title; scroll only
  past the floor (DD4).
- **Deferred resize-on-close** (leg 3): freeze measured widths on pointer-close, release on
  `#tabstrip` `mouseleave`; keyboard close reflows immediately (DD5). Builds on leg 2.
- **Frameless shell** (leg 4): `process.platform` branch — `frame:false` (win/linux) vs
  `titleBarStyle:'hidden'` + `trafficLightPosition` (mac); reserved ~200px right zone in the tab
  strip marked `-webkit-app-region: drag`; interactive elements marked `no-drag` (DD6).
- **Custom window controls** (leg 5): minimize / maximize-restore / close buttons in the right
  zone (win/linux); preload IPC (`window-minimize` / `window-toggle-maximize` / `window-close`)
  + `ipcMain.handle`/`on` in `main.js`; forward `maximize`/`unmaximize` to the renderer to sync
  the maximize button's label/icon — **the behavior test's maximize read path** (DD7). Must land
  with leg 4 (don't ship a frameless win/linux window with no close affordance). Mac shows native
  traffic lights instead.

### Checkpoints
- [ ] Golden pill renders leading the strip; `+`/`▾` operable by mouse + keyboard; container
  menu opens anchored to the pill; focus ring visible on the gold fill.
- [ ] Tabs shrink/grow to fit; scroll engages only past the floor; favicon + close stay visible.
- [ ] Closing a tab by pointer leaves siblings un-resized until `mouseleave`, then they
  re-expand; keyboard close reflows immediately.
- [ ] Window is frameless with a reserved right zone + working drag region (manual) and custom
  controls (win/linux) / native traffic lights (mac).
- [ ] Maximize button toggles label/icon with window state (observable read path live).
- [ ] Both new behavior tests pass; `tab-keyboard-operability` still passes; `npm run a11y` clean.

### Adaptation Criteria

**Divert if** (concrete checkpoint, not "feels big" — Architect):
- **Leg 4 opens with a frameless-resize spike.** If, by the end of leg 4, `frame:false` on WSLg
  leaves the window non-resizable / un-snappable in a way not quickly resolvable, **split** the
  window-chrome work (legs 4–5) into a separate "Flight 1b" and land the tab-strip legs (1–3)
  independently — they are renderer-only, mission-traced (SC1/SC2/SC8), and don't depend on the
  frame change. Log the split + rationale in the flight log.
- Removing the OS frame otherwise destabilizes window behavior (resize, snap, focus) in a way
  that isn't quickly resolvable → reassess scope.

> **Sizing note**: this is the heaviest flight in the mission — tab-strip restructure (legs 1–3,
> renderer-only; SC1/SC2/SC8 plus two flight-local tab-sizing behaviors) bundled with a full
> frameless rewrite (legs 4–5, `main.js` + new IPC + new preload surface; mission SC9). It is kept
> as one flight by operator decision, with the concrete divert above as the pressure-release valve.

**Acceptable variations**:
- Exact tab min-width floor and scroll-onset count (DD4 open question) — tune during legs/HAT.
- Maximize-state read-path encoding (`aria-label` toggle vs `data-state`) (DD7 open question).
- mac `trafficLightPosition` inset — deferred to mac verification; a reasonable default now.

### Legs

> **Note:** Tentative; legs are created one at a time as the flight progresses.

- [ ] `unified-pill-control` - Move `+`/`▾` into a leading golden pill; divider; contrast-safe
  focus ring; re-anchor container menu. Preserve IDs/handlers/aria. (SC1, SC8)
- [ ] `responsive-tab-sizing` - Flex shrink/grow with a usable floor + ellipsized title; scroll
  only past the floor; remove the always-on scrollbar.
- [ ] `deferred-resize-on-close` - Freeze tab widths on pointer-close; release on `mouseleave`;
  keyboard close reflows immediately. (depends on `responsive-tab-sizing`)
- [ ] `frameless-window-shell` - `process.platform` frame branch (frame:false win/linux;
  titleBarStyle hidden + trafficLightPosition mac); reserved right zone + drag/no-drag regions. (SC8)
- [ ] `custom-window-controls` - Min/maximize-restore/close buttons (win/linux) + IPC bridge +
  maximize-state sync (the behavior-test read path); mac native traffic lights. (depends on
  `frameless-window-shell`; lands with it) (SC8)
- [ ] `verify-integration` - Run both new behavior tests; re-run `tab-keyboard-operability`
  regression; `npm run a11y`; manual drag/close/minimize checks.
- [ ] `hat-and-alignment` *(optional)* - Guided HAT session: tune the pill, frameless chrome, and
  tab shrink/close feel live with the operator until satisfied.

---

## Post-Flight

### Completion Checklist
- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing — both new behavior tests + `tab-keyboard-operability` regression + `npm run
  a11y` clean + offline gates (`npm test`/typecheck/lint/format). **New `els.*` window-control
  entries need the same `/** @type {HTMLButtonElement} */` JSDoc casts as the existing block
  (`renderer.js:7-52`) or `npm run typecheck` fails** (Architect).
- [ ] Documentation updated — README/CLAUDE.md note the new tab-bar controls + frameless window
  chrome if the controls' discoverability or architecture notes warrant it

### Verification

How to confirm the flight achieved its objective:

- **Behavior test `unified-tab-controls`** (SC2, SC8) — pill `+` opens a plain new tab and `▾`
  opens a container tab, by **mouse and keyboard**; container menu Escape/focus behavior
  preserved; focus ring visible on the gold pill (focused-vs-unfocused screenshot delta).
- **Behavior test `responsive-tab-strip`** — tabs shrink/grow to fit with scroll only past the
  floor; pointer-close freezes sibling widths until `mouseleave`, then they re-expand; maximize
  button toggles its label/icon with window state (observable read path).
- **Regression: `tab-keyboard-operability`** must still pass — the restructure must not break the
  `tablist`/roving-tabindex/Arrow-Home-End/Delete contract (the pill buttons sit outside the
  `tablist`).
- **`npm run a11y`** — no new WCAG A/AA violations from the pill, reserved zone, or window controls.
- **Manual** (apparatus can't drive these) — drag the reserved zone to move the window; Close
  quits (win/linux); minimize hides and restores. Tune feel via the optional HAT leg.
